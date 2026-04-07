/**
 * benchmark-vs-llm.ts
 *
 * Head-to-head: our deployed local CEFR classifier vs. "just ask Claude
 * Haiku 4.5". Samples a balanced test set from tmp/gold/features.csv
 * (N words per language × CEFR level, seeded random), classifies each
 * word with BOTH models, and reports per-language and aggregated
 * exact / ±1 / MAE plus a local-vs-LLM agreement matrix.
 *
 * Local path: computes η = W_ZIPF*zipfNorm + W_AOA*aoaNorm using the
 * current deployed constants (mirroring lib/classifier/score.ts) and
 * maps to CEFR via the same θ cut points. No cache, no LLM fallback —
 * this is the pure "what does our ordinal model say" signal.
 *
 * LLM path: batches N words per Anthropic call with the same
 * language-specific system prompt shape used by build-gold-llm.ts
 * (detailed CEFR rubric + explicit JSON output). Temperature 0,
 * claude-haiku-4-5-20251001 to mirror the in-app fallback model.
 *
 * Cost: ~1440 words at batch=50 ≈ 30 API calls ≈ $0.10–0.20.
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/benchmark-vs-llm.ts
 *     [--per-cell=20] [--batch=50] [--model=claude-haiku-4-5-20251001]
 *     [--langs=en,de,fr]
 *
 * Output: prints tables to stdout and writes tmp/gold/benchmark-vs-llm.json
 * with the full per-word result set for later drill-down.
 *
 * Dev-machine only. Never wired into eas-build.
 */

import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---- Deployed model constants — must mirror lib/classifier/score.ts ----
const W_ZIPF = -1.9267;
const W_AOA = 4.7804;
const THETA = [-0.1559, 0.6753, 1.5918, 2.0130, 2.6026];

const CEFR_LABELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
type CEFR = (typeof CEFR_LABELS)[number];
const CEFR_IDX: Record<string, number> = {
  A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5,
};

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const LANG_NAME: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  pl: 'Polish',
  cs: 'Czech',
};

interface Row {
  word: string;
  language: string;
  zipfNorm: number;
  aoaNorm: number;
  fbZipf: number;
  fbAoa: number;
  cefr: CEFR;
  source: string;
}

function getArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return fallback;
}

function loadFeatures(csvPath: string): Row[] {
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const headers = lines[0].split(',');
  const idx = (name: string) => headers.indexOf(name);
  const iWord = idx('word');
  const iLang = idx('language');
  const iZn = idx('zipfNorm');
  const iAn = idx('aoaNorm');
  const iFbZ = idx('fb_zipf');
  const iFbA = idx('fb_aoa');
  const iCefr = idx('cefr');
  const iSrc = idx('source');
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const fbZ = parseInt(c[iFbZ], 10);
    const fbA = parseInt(c[iFbA], 10);
    let aoaNorm = parseFloat(c[iAn]);
    // Mirror the runtime double-fallback rescue.
    if (fbZ === 1 && fbA === 1) aoaNorm = 0.4;
    out.push({
      word: c[iWord],
      language: c[iLang],
      zipfNorm: parseFloat(c[iZn]),
      aoaNorm,
      fbZipf: fbZ,
      fbAoa: fbA,
      cefr: c[iCefr] as CEFR,
      source: c[iSrc],
    });
  }
  return out;
}

// Deterministic PRNG (mulberry32) so the sampled benchmark set is stable
// across runs without pulling in a crypto dep.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleBalanced(
  rows: Row[],
  langs: string[],
  perCell: number,
  seed: number
): Record<string, Row[]> {
  const rand = mulberry32(seed);
  const sample: Record<string, Row[]> = {};
  for (const lang of langs) {
    const langRows = rows.filter((r) => r.language === lang);
    const byLevel: Record<CEFR, Row[]> = {
      A1: [], A2: [], B1: [], B2: [], C1: [], C2: [],
    };
    for (const r of langRows) {
      if (CEFR_IDX[r.cefr] !== undefined) byLevel[r.cefr].push(r);
    }
    const picked: Row[] = [];
    const seen = new Set<string>();
    for (const lvl of CEFR_LABELS) {
      const bucket = byLevel[lvl].slice();
      // Fisher–Yates shuffle with our seeded PRNG.
      for (let i = bucket.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [bucket[i], bucket[j]] = [bucket[j], bucket[i]];
      }
      for (const r of bucket) {
        if (picked.filter((p) => p.cefr === lvl).length >= perCell) break;
        if (seen.has(r.word)) continue;
        seen.add(r.word);
        picked.push(r);
      }
    }
    sample[lang] = picked;
  }
  return sample;
}

function predictLocal(r: Row): CEFR {
  const eta = W_ZIPF * r.zipfNorm + W_AOA * r.aoaNorm;
  for (let i = 0; i < THETA.length; i++) {
    if (eta < THETA[i]) return CEFR_LABELS[i];
  }
  return 'C2';
}

function buildSystemPrompt(languageName: string): string {
  return `You are a CEFR vocabulary classifier for ${languageName}.

For each word, output its single most appropriate CEFR level using the Common European Framework of Reference for Languages:
  A1 = breakthrough  (most basic everyday vocab: house, water, eat)
  A2 = waystage      (everyday, common: family, work, problem)
  B1 = threshold     (intermediate, abstract everyday: experience, society, decision)
  B2 = vantage       (upper-intermediate, abstract / academic-adjacent: hypothesis, perception)
  C1 = effective     (advanced, academic: phenomenon, dialectic, ambivalence)
  C2 = mastery       (rare, technical, scholarly: epistemology, transcendence, eschatology)

Rules:
  - Output ONLY a valid JSON object mapping each input word (lowercased, exactly as given) to its CEFR level as a string.
  - Use exactly one of: "A1","A2","B1","B2","C1","C2".
  - No prose, no markdown fences, no commentary.
  - Judge each word on its most common everyday meaning in ${languageName}.
  - Function words (articles, prepositions, pronouns, common conjunctions) are A1.
  - Be consistent: the same word must always get the same level.

Example: {"casa":"A1","sociedade":"B1","epistemologia":"C2"}`;
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  error?: { message: string };
  usage?: { input_tokens: number; output_tokens: number };
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string
): Promise<{ text: string; usage: { input: number; output: number } }> {
  const res = await axios.post<AnthropicResponse>(
    ANTHROPIC_URL,
    {
      model,
      max_tokens: 4096,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    },
    {
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      timeout: 120_000,
    }
  );
  if (res.data.error) throw new Error(res.data.error.message);
  const text = res.data.content.find((b) => b.type === 'text')?.text ?? '';
  const usage = {
    input: res.data.usage?.input_tokens ?? 0,
    output: res.data.usage?.output_tokens ?? 0,
  };
  return { text, usage };
}

function parseLabels(text: string): Record<string, CEFR> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON object in response: ' + text.slice(0, 200));
  const parsed = JSON.parse(m[0]);
  const out: Record<string, CEFR> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const lvl = String(v).trim().toUpperCase();
    if (CEFR_IDX[lvl] !== undefined) out[k.toLowerCase()] = lvl as CEFR;
  }
  return out;
}

interface Metrics {
  n: number;
  exact: number;
  within1: number;
  mae: number;
  perLevelN: number[];
  perLevelExact: number[];
}

function evaluate(pairs: Array<{ gold: CEFR; pred: CEFR | null }>): Metrics {
  let n = 0;
  let exact = 0;
  let within1 = 0;
  let maeSum = 0;
  const perLevelN = new Array(6).fill(0);
  const perLevelExact = new Array(6).fill(0);
  for (const { gold, pred } of pairs) {
    if (!pred) continue;
    n++;
    const g = CEFR_IDX[gold];
    const p = CEFR_IDX[pred];
    perLevelN[g]++;
    const d = Math.abs(g - p);
    if (d === 0) {
      exact++;
      perLevelExact[g]++;
    }
    if (d <= 1) within1++;
    maeSum += d;
  }
  return {
    n,
    exact: n ? exact / n : 0,
    within1: n ? within1 / n : 0,
    mae: n ? maeSum / n : 0,
    perLevelN,
    perLevelExact,
  };
}

function padL(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}
function padR(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

interface LangResult {
  lang: string;
  n: number;
  local: Metrics;
  llm: Metrics;
  agreement: number;
  agreeBothRight: number;
  agreeBothWrong: number;
  localRightLlmWrong: number;
  llmRightLocalWrong: number;
}

async function main(): Promise<void> {
  const perCell = parseInt(getArg('per-cell', '20')!, 10);
  const batch = parseInt(getArg('batch', '50')!, 10);
  const model = getArg('model', DEFAULT_MODEL)!;
  const langsArg = getArg('langs');
  const seed = parseInt(getArg('seed', '42')!, 10);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY environment variable is required.');
    process.exit(1);
  }

  const csvPath = path.resolve(__dirname, '..', 'tmp', 'gold', 'features.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`[benchmark] missing ${csvPath}`);
    process.exit(1);
  }
  console.log(`[benchmark] reading ${csvPath}`);
  const all = loadFeatures(csvPath);
  console.log(`  loaded ${all.length} feature rows`);

  const allLangs = Object.keys(LANG_NAME);
  const langs = langsArg ? langsArg.split(',') : allLangs;
  console.log(`[benchmark] sampling per-cell=${perCell} langs=${langs.join(',')} seed=${seed}`);
  const sample = sampleBalanced(all, langs, perCell, seed);

  for (const lang of langs) {
    const s = sample[lang] ?? [];
    const byLevel: Record<string, number> = {};
    for (const r of s) byLevel[r.cefr] = (byLevel[r.cefr] ?? 0) + 1;
    console.log(
      `  ${lang}: ${s.length} words  ` +
        CEFR_LABELS.map((l) => `${l}=${byLevel[l] ?? 0}`).join(' ')
    );
  }

  // --- LLM pass: batch N words per call, per language ---
  console.log(`\n[benchmark] querying ${model} (batch=${batch}) ...`);
  let totalCalls = 0;
  let totalInTok = 0;
  let totalOutTok = 0;

  const llmResults: Record<string, Map<string, CEFR>> = {};
  for (const lang of langs) {
    const words = (sample[lang] ?? []).map((r) => r.word);
    if (words.length === 0) continue;
    const labels = new Map<string, CEFR>();
    const systemPrompt = buildSystemPrompt(LANG_NAME[lang]);
    for (let i = 0; i < words.length; i += batch) {
      const chunk = words.slice(i, i + batch);
      const userMessage =
        `Label the CEFR level of each ${LANG_NAME[lang]} word. Return JSON only.\n\n` +
        JSON.stringify(chunk);
      try {
        const { text, usage } = await callAnthropic(apiKey, model, systemPrompt, userMessage);
        totalCalls++;
        totalInTok += usage.input;
        totalOutTok += usage.output;
        const parsed = parseLabels(text);
        for (const [k, v] of Object.entries(parsed)) labels.set(k, v);
      } catch (err) {
        console.warn(
          `  [${lang}] batch ${i}/${words.length} failed: ${(err as Error).message}`
        );
      }
    }
    llmResults[lang] = labels;
    console.log(
      `  ${lang}: labelled ${labels.size}/${words.length}  ` +
        `(cumulative calls=${totalCalls} in=${totalInTok} out=${totalOutTok})`
    );
  }

  // Rough Haiku 4.5 pricing: $1/MTok input, $5/MTok output.
  const dollars = (totalInTok * 1) / 1e6 + (totalOutTok * 5) / 1e6;
  console.log(
    `\n[benchmark] total API: calls=${totalCalls} in=${totalInTok} out=${totalOutTok} ≈ $${dollars.toFixed(4)}`
  );

  // --- Evaluate per language ---
  const results: LangResult[] = [];
  const perWord: Array<{
    lang: string;
    word: string;
    gold: CEFR;
    local: CEFR;
    llm: CEFR | null;
  }> = [];

  for (const lang of langs) {
    const rows = sample[lang] ?? [];
    if (rows.length === 0) continue;
    const llmLabels = llmResults[lang] ?? new Map();

    const localPairs: Array<{ gold: CEFR; pred: CEFR | null }> = [];
    const llmPairs: Array<{ gold: CEFR; pred: CEFR | null }> = [];
    let agreement = 0;
    let bothRight = 0;
    let bothWrong = 0;
    let localRight = 0;
    let llmRight = 0;

    for (const r of rows) {
      const local = predictLocal(r);
      const llm = llmLabels.get(r.word.toLowerCase()) ?? null;
      localPairs.push({ gold: r.cefr, pred: local });
      llmPairs.push({ gold: r.cefr, pred: llm });
      perWord.push({ lang, word: r.word, gold: r.cefr, local, llm });
      if (llm && llm === local) agreement++;
      const lOk = local === r.cefr;
      const aiOk = llm === r.cefr;
      if (lOk && aiOk) bothRight++;
      if (!lOk && llm && !aiOk) bothWrong++;
      if (lOk && llm && !aiOk) localRight++;
      if (!lOk && aiOk) llmRight++;
    }

    results.push({
      lang,
      n: rows.length,
      local: evaluate(localPairs),
      llm: evaluate(llmPairs),
      agreement,
      agreeBothRight: bothRight,
      agreeBothWrong: bothWrong,
      localRightLlmWrong: localRight,
      llmRightLocalWrong: llmRight,
    });
  }

  // --- Print tables ---
  console.log('\n' + '='.repeat(78));
  console.log('Per-language head-to-head (local ordinal vs ' + model + ')');
  console.log('='.repeat(78));
  console.log(
    padR('lang', 5) +
      padL('n', 5) +
      padL('L-exact', 10) +
      padL('X-exact', 10) +
      padL('L-±1', 8) +
      padL('X-±1', 8) +
      padL('L-MAE', 8) +
      padL('X-MAE', 8)
  );
  console.log('-'.repeat(62));
  for (const r of results) {
    console.log(
      padR(r.lang, 5) +
        padL(String(r.n), 5) +
        padL((r.local.exact * 100).toFixed(1) + '%', 10) +
        padL((r.llm.exact * 100).toFixed(1) + '%', 10) +
        padL((r.local.within1 * 100).toFixed(1) + '%', 8) +
        padL((r.llm.within1 * 100).toFixed(1) + '%', 8) +
        padL(r.local.mae.toFixed(3), 8) +
        padL(r.llm.mae.toFixed(3), 8)
    );
  }
  // Unweighted mean across languages.
  const mean = (f: (r: LangResult) => number) =>
    results.reduce((a, r) => a + f(r), 0) / (results.length || 1);
  console.log('-'.repeat(62));
  console.log(
    padR('MEAN', 5) +
      padL('', 5) +
      padL((mean((r) => r.local.exact) * 100).toFixed(1) + '%', 10) +
      padL((mean((r) => r.llm.exact) * 100).toFixed(1) + '%', 10) +
      padL((mean((r) => r.local.within1) * 100).toFixed(1) + '%', 8) +
      padL((mean((r) => r.llm.within1) * 100).toFixed(1) + '%', 8) +
      padL(mean((r) => r.local.mae).toFixed(3), 8) +
      padL(mean((r) => r.llm.mae).toFixed(3), 8)
  );

  console.log('\n' + '='.repeat(78));
  console.log('Agreement breakdown');
  console.log('='.repeat(78));
  console.log(
    padR('lang', 5) +
      padL('agree', 8) +
      padL('bothOK', 8) +
      padL('bothX', 8) +
      padL('L>X', 8) +
      padL('X>L', 8)
  );
  console.log('-'.repeat(45));
  for (const r of results) {
    console.log(
      padR(r.lang, 5) +
        padL(`${r.agreement}/${r.n}`, 8) +
        padL(String(r.agreeBothRight), 8) +
        padL(String(r.agreeBothWrong), 8) +
        padL(String(r.localRightLlmWrong), 8) +
        padL(String(r.llmRightLocalWrong), 8)
    );
  }

  // Save raw results for drill-down.
  const outPath = path.resolve(__dirname, '..', 'tmp', 'gold', 'benchmark-vs-llm.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        model,
        perCell,
        seed,
        deployedConstants: { W_ZIPF, W_AOA, THETA },
        apiUsage: { calls: totalCalls, inputTokens: totalInTok, outputTokens: totalOutTok, dollars },
        perLanguage: results,
        perWord,
      },
      null,
      2
    )
  );
  console.log(`\n[benchmark] wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
