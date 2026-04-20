/**
 * build-aoa-llm.ts
 *
 * Generates LLM-estimated Age-of-Acquisition (AoA) ratings for the top-N
 * words of a non-English language, using the Mistral chat completions API.
 * Writes the output to lib/data/aoa_{lang}.json in the same shape as the
 * Kuperman EN file.
 *
 * This is the "TODO #3" build step — see lib/classifier/TODO.md. It is
 * dev-machine only, NEVER wired into eas-build hooks. The generated JSON
 * is committed to the repo so EAS Build sees it as a static asset.
 *
 * Run:
 *   MISTRAL_API_KEY=... npm run build:aoa-llm -- --lang=de [--top=5000] [--batch=50] [--resume]
 *
 * Behaviour:
 *  - Reads top-N words from lib/data/freq_{lang}.json (sorted by Zipf desc).
 *  - Skips tokens that don't look like content words (punctuation, numbers,
 *    function words of length <= 1, etc.).
 *  - Calls the Mistral chat completions API directly (axios) with
 *    temperature: 0 and a system prompt asking for a JSON mapping word →
 *    AoA (scale 2-18).
 *  - Writes the file incrementally every BATCH so a crash mid-run can be
 *    resumed with --resume (skips words already in the existing output).
 *
 * Cost estimate (mistral-small-2506): small-model pricing, inexpensive for
 * the full 11-language sweep at top=5000.
 *
 * The EN Kuperman norms remain the gold standard — these estimates are a
 * pragmatic stand-in so the classifier doesn't have to fall back to
 * (1 - zipfNorm) for 11 of 12 supported languages.
 */

import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';
const DEFAULT_MODEL = 'mistral-small-2506';
const DEFAULT_TOP = 5000;
const DEFAULT_BATCH = 50;

const SUPPORTED = new Set(['de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'no', 'da', 'pl', 'cs']);

const LANG_NAME: Record<string, string> = {
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

// Freq files are stored as parallel arrays { keys, values } — see
// lib/classifier/features.ts for the rationale (Hermes 196607-property cap).
// Older files used { words: { k: v, ... } }; we still accept both here so
// this dev script keeps working during the migration window.
interface FreqFileArrays {
  __corpus?: string;
  __attribution?: string;
  keys: string[];
  values: number[];
}
interface FreqFileLegacy {
  __corpus?: string;
  __attribution?: string;
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

interface AoaFile {
  __attribution: string;
  __scale: string;
  __lang: string;
  __model: string;
  __count: number;
  words: Record<string, number>;
}

function getArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a === `--${name}`) return 'true';
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return fallback;
}

// Keep only content-word candidates: letters + optional hyphen/apostrophe,
// min length 2. Excludes punctuation, digits, single letters.
function isUsableWord(w: string): boolean {
  if (w.length < 2 || w.length > 30) return false;
  return /^[\p{L}][\p{L}'-]*[\p{L}]$/u.test(w);
}

function topWords(freq: FreqFile, top: number): string[] {
  const entries = Object.entries(freqWords(freq)).filter(([w]) => isUsableWord(w));
  entries.sort((a, b) => b[1] - a[1]);
  return entries.slice(0, top).map(([w]) => w);
}

function loadExisting(outPath: string): Record<string, number> {
  if (!fs.existsSync(outPath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    if (raw && typeof raw === 'object' && raw.words && !raw.__empty) {
      return raw.words;
    }
  } catch {
    // fall through
  }
  return {};
}

function writeOut(outPath: string, lang: string, model: string, words: Record<string, number>) {
  const doc: AoaFile = {
    __attribution:
      'LLM-estimated AoA ratings via Mistral chat completions API. Calibrated against ' +
      'Kuperman et al. (2012) English norms. Scale 2-18 (years).',
    __scale: '2-18',
    __lang: lang,
    __model: model,
    __count: Object.keys(words).length,
    words,
  };
  fs.writeFileSync(outPath, JSON.stringify(doc));
}

function buildSystemPrompt(languageName: string): string {
  return `You are a psycholinguistic rater. Your task is to estimate the Age of Acquisition (AoA) for ${languageName} words — the age in years at which a native speaker typically learns the meaning of the word.

Use the scale from Kuperman, Stadthagen-Gonzalez & Brysbaert (2012):
  2  = learned as a toddler (mama, dog, ball)
  4  = learned by age 4 (red, jump, happy)
  6  = learned by age 6 (school, lion, remember)
  8  = learned by age 8 (museum, plan, earth)
  10 = learned by early teens (experience, political, century)
  12 = learned by mid teens (philosophy, economy, theory)
  14 = learned late teens / adult (hypothesis, metaphor)
  16 = specialized adult vocabulary (epistemology, etymology)
  18 = rare, technical, or academic (phenomenology, heuristic)

Rules:
  - Output ONLY a valid JSON object mapping each input word (lowercased) to its AoA as a number. No prose, no markdown fences.
  - Use one decimal place (e.g. 4.5, 11.2).
  - Judge each word on its most common everyday meaning.
  - Function words (articles, prepositions, pronouns) should receive AoA 2-3.
  - Proper nouns should receive AoA 4-6 if commonly known.
  - Be consistent: the same word must always get the same rating.

Example output: {"hund":4.2,"philosophie":12.5}`;
}

interface MistralResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message: string };
}

async function callMistral(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const res = await axios.post<MistralResponse>(
    MISTRAL_URL,
    {
      model,
      max_tokens: 4096,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    },
    {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      timeout: 120_000,
    },
  );

  if (res.data.error) throw new Error(res.data.error.message);
  return res.data.choices?.[0]?.message?.content ?? '';
}

function parseRatings(text: string): Record<string, number> {
  // Extract the JSON object — tolerate stray whitespace / fences.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object in response: ' + text.slice(0, 200));
  const parsed = JSON.parse(match[0]);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n) && n >= 1 && n <= 20) {
      out[k.toLowerCase()] = Math.round(n * 10) / 10;
    }
  }
  return out;
}

async function main() {
  const lang = getArg('lang');
  if (!lang || !SUPPORTED.has(lang)) {
    console.error(
      `Usage: npm run build:aoa-llm -- --lang=<${Array.from(SUPPORTED).join('|')}> [--top=5000] [--batch=50] [--model=...] [--resume]`,
    );
    process.exit(1);
  }
  const top = parseInt(getArg('top', String(DEFAULT_TOP))!, 10);
  const batch = parseInt(getArg('batch', String(DEFAULT_BATCH))!, 10);
  const model = getArg('model', DEFAULT_MODEL)!;
  const resume = getArg('resume') === 'true';

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.error('MISTRAL_API_KEY environment variable is required.');
    process.exit(1);
  }

  const dataDir = path.resolve(__dirname, '..', 'lib', 'data');
  const freqPath = path.join(dataDir, `freq_${lang}.json`);
  const outPath = path.join(dataDir, `aoa_${lang}.json`);

  if (!fs.existsSync(freqPath)) {
    console.error(`Frequency file not found: ${freqPath}. Run npm run build:freq first.`);
    process.exit(1);
  }

  const freq = JSON.parse(fs.readFileSync(freqPath, 'utf8')) as FreqFile;
  const all = topWords(freq, top);

  const existing = resume ? loadExisting(outPath) : {};
  const pending = all.filter((w) => !(w.toLowerCase() in existing));
  const ratings: Record<string, number> = { ...existing };

  console.log(
    `[build:aoa-llm] lang=${lang} (${LANG_NAME[lang]}) top=${top} batch=${batch} model=${model}`,
  );
  console.log(
    `[build:aoa-llm] ${all.length} candidate words; ${Object.keys(existing).length} already rated; ${pending.length} to process.`,
  );

  const languageName = LANG_NAME[lang];
  const systemPrompt = buildSystemPrompt(languageName);

  let processed = 0;
  let apiCalls = 0;
  const startedAt = Date.now();

  for (let i = 0; i < pending.length; i += batch) {
    const chunk = pending.slice(i, i + batch);
    const userMessage =
      `Rate the AoA for these ${languageName} words. Return JSON only.\n\n` + JSON.stringify(chunk);

    let text: string;
    try {
      text = await callMistral(apiKey, model, systemPrompt, userMessage);
      apiCalls++;
    } catch (err) {
      console.warn(
        `[build:aoa-llm] batch ${i}/${pending.length} failed: ${(err as Error).message}. Writing checkpoint and exiting.`,
      );
      writeOut(outPath, lang, model, ratings);
      process.exit(2);
    }

    let parsed: Record<string, number>;
    try {
      parsed = parseRatings(text);
    } catch (err) {
      console.warn(
        `[build:aoa-llm] parse failure for batch ${i}: ${(err as Error).message}. Skipping batch.`,
      );
      parsed = {};
    }

    // Only keep ratings for words we actually asked about.
    const requested = new Set(chunk.map((w) => w.toLowerCase()));
    for (const [w, v] of Object.entries(parsed)) {
      if (requested.has(w)) ratings[w] = v;
    }
    processed += chunk.length;

    // Checkpoint every 10 batches so a crash late in the run doesn't lose work.
    if (apiCalls % 10 === 0) {
      writeOut(outPath, lang, model, ratings);
      const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `[build:aoa-llm] checkpoint: ${processed}/${pending.length} processed (${Object.keys(ratings).length} total, ${elapsedS}s)`,
      );
    }
  }

  writeOut(outPath, lang, model, ratings);
  const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[build:aoa-llm] done: ${Object.keys(ratings).length} words → ${outPath} (${apiCalls} API calls, ${elapsedS}s)`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
