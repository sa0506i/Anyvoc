/**
 * build-gold-llm.ts
 *
 * LLM-oracle CEFR labelling for the 5 languages where no usable open
 * CEFR vocabulary list exists (Portuguese, Danish, Czech, Norwegian,
 * Polish — Norwegian's KELLY file has no CEFR column). Reads the top-N
 * words from lib/data/freq_{lang}.json, asks Claude for one CEFR label
 * per word, appends the rows to tmp/gold/gold-cefr.jsonl in the same
 * shape as build-gold.ts emits:
 *
 *   { "word": "casa", "language": "pt", "cefr": "A1", "source": "LLM-oracle" }
 *
 * NEVER wired into eas-build hooks. Dev-machine only.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npm run build:gold-llm -- --lang=pt [--top=2000] [--batch=50] [--resume]
 *   ANTHROPIC_API_KEY=sk-ant-... npm run build:gold-llm -- --lang=da
 *   ANTHROPIC_API_KEY=sk-ant-... npm run build:gold-llm -- --lang=cs
 *   ANTHROPIC_API_KEY=sk-ant-... npm run build:gold-llm -- --lang=no
 *   ANTHROPIC_API_KEY=sk-ant-... npm run build:gold-llm -- --lang=pl
 *
 * Cost: ~$0.07/lang at top=2000, ~$0.35 for all five.
 */

import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TOP = 2000;
const DEFAULT_BATCH = 50;
const ANTHROPIC_VERSION = '2023-06-01';
const SOURCE_TAG = 'LLM-oracle';

const SUPPORTED = new Set(['pt', 'da', 'cs', 'no', 'pl']);
const LANG_NAME: Record<string, string> = {
  pt: 'Portuguese',
  da: 'Danish',
  cs: 'Czech',
  no: 'Norwegian',
  pl: 'Polish',
};

type CEFR = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
const VALID_CEFR = new Set<string>(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

// Freq files are stored as parallel arrays { keys, values }. Legacy
// { words } shape also accepted. See lib/classifier/features.ts for why.
interface FreqFileArrays {
  keys: string[];
  values: number[];
}
interface FreqFileLegacy {
  words: Record<string, number>;
}
type FreqFile = FreqFileArrays | FreqFileLegacy;

function freqWords(f: FreqFile): Record<string, number> {
  if ('words' in f) return f.words;
  const out: Record<string, number> = {};
  for (let i = 0; i < f.keys.length; i++) {
    out[f.keys[i]!] = f.values[i]!;
  }
  return out;
}

interface GoldRow {
  word: string;
  language: string;
  cefr: CEFR;
  source: string;
}

function getArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a === `--${name}`) return 'true';
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return fallback;
}

function isUsableWord(w: string): boolean {
  if (w.length < 2 || w.length > 30) return false;
  return /^[\p{L}][\p{L}'-]*[\p{L}]$/u.test(w);
}

function topWords(freq: FreqFile, top: number): string[] {
  const entries = Object.entries(freqWords(freq)).filter(([w]) => isUsableWord(w));
  entries.sort((a, b) => b[1] - a[1]);
  return entries.slice(0, top).map(([w]) => w);
}

function loadExistingForLang(jsonlPath: string, lang: string): Set<string> {
  if (!fs.existsSync(jsonlPath)) return new Set();
  const seen = new Set<string>();
  const text = fs.readFileSync(jsonlPath, 'utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const r = JSON.parse(line) as GoldRow;
      if (r.language === lang && r.source === SOURCE_TAG) {
        seen.add(r.word.toLowerCase());
      }
    } catch {
      // skip malformed line
    }
  }
  return seen;
}

function appendRows(jsonlPath: string, rows: GoldRow[]) {
  if (rows.length === 0) return;
  const fd = fs.openSync(jsonlPath, 'a');
  for (const r of rows) fs.writeSync(fd, JSON.stringify(r) + '\n');
  fs.closeSync(fd);
}

function buildSystemPrompt(languageName: string): string {
  return `You are a CEFR vocabulary classifier for ${languageName}.

For each word, output its single most appropriate CEFR level using the Common European Framework of Reference for Languages:
  A1 = breakthrough  (~most basic everyday vocab: house, water, eat)
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
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
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
  return res.data.content.find((b) => b.type === 'text')?.text ?? '';
}

function parseLabels(text: string): Record<string, CEFR> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON object in response: ' + text.slice(0, 200));
  const parsed = JSON.parse(m[0]);
  const out: Record<string, CEFR> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const lvl = String(v).trim().toUpperCase();
    if (VALID_CEFR.has(lvl)) out[k.toLowerCase()] = lvl as CEFR;
  }
  return out;
}

async function main() {
  const lang = getArg('lang');
  if (!lang || !SUPPORTED.has(lang)) {
    console.error(
      `Usage: npm run build:gold-llm -- --lang=<${Array.from(SUPPORTED).join('|')}> [--top=2000] [--batch=50] [--resume]`
    );
    process.exit(1);
  }
  const top = parseInt(getArg('top', String(DEFAULT_TOP))!, 10);
  const batch = parseInt(getArg('batch', String(DEFAULT_BATCH))!, 10);
  const model = getArg('model', DEFAULT_MODEL)!;
  const resume = getArg('resume') === 'true';

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY environment variable is required.');
    process.exit(1);
  }

  const dataDir = path.resolve(__dirname, '..', 'lib', 'data');
  const goldDir = path.resolve(__dirname, '..', 'tmp', 'gold');
  const freqPath = path.join(dataDir, `freq_${lang}.json`);
  const outPath = path.join(goldDir, 'gold-cefr.jsonl');
  fs.mkdirSync(goldDir, { recursive: true });

  if (!fs.existsSync(freqPath)) {
    console.error(`Frequency file not found: ${freqPath}. Run npm run build:freq first.`);
    process.exit(1);
  }

  const freq = JSON.parse(fs.readFileSync(freqPath, 'utf8')) as FreqFile;
  const all = topWords(freq, top);
  const existing = resume ? loadExistingForLang(outPath, lang) : new Set<string>();
  const pending = all.filter((w) => !existing.has(w.toLowerCase()));

  console.log(
    `[build:gold-llm] lang=${lang} (${LANG_NAME[lang]}) top=${top} batch=${batch} model=${model}`
  );
  console.log(
    `[build:gold-llm] ${all.length} candidates; ${existing.size} already labelled; ${pending.length} to process.`
  );

  const languageName = LANG_NAME[lang];
  const systemPrompt = buildSystemPrompt(languageName);

  let processed = 0;
  let apiCalls = 0;
  let labelled = 0;
  const startedAt = Date.now();

  for (let i = 0; i < pending.length; i += batch) {
    const chunk = pending.slice(i, i + batch);
    const userMessage =
      `Label the CEFR level of each ${languageName} word. Return JSON only.\n\n` +
      JSON.stringify(chunk);

    let text: string;
    try {
      text = await callAnthropic(apiKey, model, systemPrompt, userMessage);
      apiCalls++;
    } catch (err) {
      console.warn(
        `[build:gold-llm] batch ${i}/${pending.length} failed: ${(err as Error).message}. Stopping (run again with --resume).`
      );
      process.exit(2);
    }

    let labels: Record<string, CEFR>;
    try {
      labels = parseLabels(text);
    } catch (err) {
      console.warn(`[build:gold-llm] parse failure for batch ${i}: ${(err as Error).message}. Skipping.`);
      labels = {};
    }

    const requested = new Set(chunk.map((w) => w.toLowerCase()));
    const newRows: GoldRow[] = [];
    for (const [w, lvl] of Object.entries(labels)) {
      if (!requested.has(w)) continue;
      newRows.push({ word: w, language: lang, cefr: lvl, source: SOURCE_TAG });
    }
    appendRows(outPath, newRows);
    labelled += newRows.length;
    processed += chunk.length;

    if (apiCalls % 5 === 0) {
      const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `[build:gold-llm] checkpoint: ${processed}/${pending.length} processed, ${labelled} labelled (${elapsedS}s)`
      );
    }
  }

  const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[build:gold-llm] done: ${labelled} new ${lang} rows appended → ${outPath} (${apiCalls} API calls, ${elapsedS}s)`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
