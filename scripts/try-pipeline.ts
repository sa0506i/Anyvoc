/**
 * try-pipeline.ts — end-to-end smoke test from URL to classified vocabulary.
 *
 * Runs the real production path:
 *   URL → fetchArticleContent (Readability + Claude fallback)
 *       → extractVocabulary   (Mistral via backend proxy)
 *       → classifyWord        (local CEFR, deterministic)
 *
 * URL sources (mutually exclusive):
 *   --url=<url>            Single ad-hoc URL.
 *   --lang=<code>          Read tmp/validation/validation_corpus.json for
 *                          that learning language. With --limit the URLs
 *                          are sampled WITHOUT REPLACEMENT from the block;
 *                          without --limit the whole block runs in order.
 *   --all                  Walk every language in the corpus (12 × 10 = 120).
 *
 * Options:
 *   --native=<code>        Native (translation target) language, default "en".
 *                          Ignored in --sweep mode (use --natives).
 *   --sweep                Matrix mode: for each sampled URL, run
 *                          extractVocabulary once per native language.
 *                          Implies --all unless --lang pins a single
 *                          learning language. Diagonal cases (native ==
 *                          lang) are automatically skipped. The article is
 *                          fetched ONCE per URL and reused across natives,
 *                          so the cost is N natives × LLM calls (not
 *                          N × HTTP fetches).
 *   --natives=<csv>        With --sweep, restrict natives to this
 *                          comma-separated list. Default: all 12.
 *   --top=<n>              How many vocab entries to print per URL (default 15).
 *                          Pass 0 to suppress; useful in --sweep runs.
 *   --out=<path>           Write a JSON summary of the whole run.
 *   --index=<n>            With --lang/--all, pick only the n-th entry (0-based)
 *                          — deterministic, overrides random sampling.
 *   --skip=<n>             With --lang/--all, drop first n entries before
 *                          sampling / walking.
 *   --limit=<n>            With --lang/--all, sample n URLs at random from
 *                          each language block (no repeats). Omit to walk all.
 *   --seed=<n>             Seed the random sampler for reproducible runs.
 *                          Default: time-seeded.
 *
 * IMPORTANT — this script imports lib/claude.ts, which imports
 * `expo-constants`. Real expo-constants transitively loads Flow-typed RN
 * source that tsx cannot transform. Run via:
 *
 *   npx tsx --tsconfig scripts/tsconfig.pipeline.json scripts/try-pipeline.ts ...
 *
 * That tsconfig aliases `expo-constants` to `scripts/_shims/expo-constants.ts`.
 *
 * Cost: one Mistral extraction call per URL (text is capped at 2 000 chars
 * by default — see DEFAULT_MAX_CHARS / --max-chars). Budget accordingly
 * before running with --all.
 *
 * Dev-machine only. Never wired into eas-build.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchArticleContent } from '../lib/urlExtractor';
import { extractVocabulary, type ExtractedVocab } from '../lib/claude';
import { extractVocabularyTwoPhase } from './extraction/extractVocabularyTwoPhase';
import { getLanguageEnglishName } from '../constants/languages';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../lib/classifier';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CORPUS_PATH = path.join(PROJECT_ROOT, 'tmp', 'validation', 'validation_corpus.json');

interface CorpusEntry {
  url: string;
  domain: string;
  title: string;
  text_type: string;
  difficulty_estimate: string;
  notes: string;
}

interface Corpus {
  _meta: { languages: string[]; [k: string]: unknown };
  [lang: string]: CorpusEntry[] | unknown;
}

interface UrlResult {
  url: string;
  lang: SupportedLanguage;
  native: string;
  corpusIndex?: number;
  corpus?: { difficulty_estimate: string; text_type: string; domain: string };
  ok: boolean;
  error?: string;
  title?: string;
  textLength?: number;
  processedTextLength?: number;
  truncated?: boolean;
  elapsedMs: number;
  vocabCount?: number;
  levelDistribution?: Record<string, number>;
  typeDistribution?: Record<string, number>;
  vocab?: ExtractedVocab[];
}

/** Default char cap for extractVocabulary input. Low enough to stay well
 *  inside one Mistral chunk (MAX_CHARS_PER_CHUNK = 5 000 in lib/claude.ts),
 *  which keeps per-URL cost and latency predictable for smoke tests. */
const DEFAULT_MAX_CHARS = 2000;

type ExtractionMode = 'monolithic' | 'two-phase';

interface CliArgs {
  url?: string;
  lang?: string;
  native: string;
  all: boolean;
  top: number;
  out?: string;
  index?: number;
  skip: number;
  limit?: number;
  maxChars: number;
  seed: number;
  sweep: boolean;
  natives?: SupportedLanguage[];
  mode: ExtractionMode;
  /** Prompt-version toggle for the Matrix-Regel A/B (Slice 7/7).
   *  Sets ANYVOC_PROMPT_VERSION at runtime so lib/claude's
   *  defaultPromptVersion() picks up the chosen path. */
  prompt: 'v1' | 'v2';
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    native: 'en',
    all: false,
    top: 15,
    skip: 0,
    maxChars: DEFAULT_MAX_CHARS,
    seed: Date.now() >>> 0,
    sweep: false,
    mode: 'monolithic',
    prompt: 'v1',
  };
  for (const raw of argv.slice(2)) {
    const m = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    const [, key, value] = m;
    switch (key) {
      case 'url':
        args.url = value;
        break;
      case 'lang':
        args.lang = value;
        break;
      case 'native':
        args.native = value ?? 'en';
        break;
      case 'all':
        args.all = true;
        break;
      case 'top':
        args.top = Number(value ?? '15');
        break;
      case 'out':
        args.out = value;
        break;
      case 'index':
        args.index = Number(value);
        break;
      case 'skip':
        args.skip = Number(value ?? '0');
        break;
      case 'limit':
        args.limit = Number(value);
        break;
      case 'max-chars': {
        const n = Number(value ?? `${DEFAULT_MAX_CHARS}`);
        if (!Number.isFinite(n) || n < 0) {
          console.error(`Invalid --max-chars value: ${value}`);
          process.exit(2);
        }
        args.maxChars = n;
        break;
      }
      case 'seed': {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) {
          console.error(`Invalid --seed value: ${value}`);
          process.exit(2);
        }
        args.seed = n >>> 0;
        break;
      }
      case 'sweep':
        args.sweep = true;
        break;
      case 'mode': {
        if (value !== 'monolithic' && value !== 'two-phase') {
          console.error(`Invalid --mode value "${value}". Use "monolithic" or "two-phase".`);
          process.exit(2);
        }
        args.mode = value;
        break;
      }
      case 'prompt': {
        if (value !== 'v1' && value !== 'v2') {
          console.error(`Invalid --prompt value "${value}". Use "v1" or "v2".`);
          process.exit(2);
        }
        args.prompt = value;
        break;
      }
      case 'natives': {
        if (!value) {
          console.error('--natives requires a comma-separated list of language codes');
          process.exit(2);
        }
        const codes = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        for (const c of codes) {
          if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(c)) {
            console.error(
              `--natives: unsupported code "${c}". Supported: ${SUPPORTED_LANGUAGES.join(', ')}`,
            );
            process.exit(2);
          }
        }
        args.natives = codes as SupportedLanguage[];
        break;
      }
      case 'help':
      case 'h':
        printHelp();
        process.exit(0);
      default:
        console.error(`Unknown flag: --${key}`);
        process.exit(2);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`try-pipeline — URL → Readability → extractVocabulary → classifyWord

Usage:
  npx tsx --tsconfig scripts/tsconfig.pipeline.json scripts/try-pipeline.ts <source> [options]

Source (pick one):
  --url=<url>             Single ad-hoc URL. Requires --lang.
  --lang=<code>           Walk tmp/validation/validation_corpus.json[<code>].
  --all                   Walk every language block in the corpus.

Options:
  --native=<code>         Native/target language (default en). Ignored with
                          --sweep — use --natives instead.
  --sweep                 Matrix mode: each sampled URL is fetched once and
                          extracted once per native language. Implies --all
                          unless --lang pins a single learning language.
                          native == lang is auto-skipped (diagonal).
  --natives=<csv>         With --sweep, restrict natives to this list
                          (default: all 12).
  --top=<n>               Max vocab entries to print per URL (default 15;
                          0 suppresses — useful with --sweep).
  --index=<n>             Pick only the n-th entry (0-based). Deterministic,
                          overrides random sampling.
  --skip=<n>              Drop first n entries before sampling / walking.
  --limit=<n>             Sample n URLs at random (no repeats) from each
                          language block. Omit to walk the whole block in
                          corpus order.
  --seed=<n>              Seed the random sampler for reproducible runs
                          (default: time-seeded; value is logged per run).
  --max-chars=<n>         Truncate article text to n characters before
                          extractVocabulary (default ${DEFAULT_MAX_CHARS};
                          MAX_CHARS_PER_CHUNK in lib/claude.ts is 5 000, so
                          this stays well inside one Mistral call). Use 0
                          for unlimited.
  --mode=<mode>           Extraction backend: "monolithic" (default, calls
                          lib/claude.ts extractVocabulary — the production
                          path) or "two-phase" (calls
                          scripts/extraction/extractVocabularyTwoPhase —
                          native-agnostic Phase 1 + per-native Phase 2).
                          Two-phase is dev-only; the production app is
                          unaffected (enforced by architecture Rule 35).
  --prompt=<v1|v2>        Prompt-version toggle for the Matrix-Regel A/B
                          (default v1). v2 = source-preserving extraction
                          + matrix translation targets per the 2026-04-23
                          user-approved matrices. Sets
                          ANYVOC_PROMPT_VERSION; see CLAUDE.md Rule 47.
  --out=<path>            Write full JSON summary to <path>.
  --help                  Show this message.

Examples:
  # One URL, German learning, English native:
  npx tsx --tsconfig scripts/tsconfig.pipeline.json scripts/try-pipeline.ts \\
    --url=https://de.wikipedia.org/wiki/Klimawandel --lang=de

  # First two German corpus entries, save summary:
  npx tsx --tsconfig scripts/tsconfig.pipeline.json scripts/try-pipeline.ts \\
    --lang=de --limit=2 --out=tmp/pipeline-de.json

  # Smoke-test one entry per language:
  npx tsx --tsconfig scripts/tsconfig.pipeline.json scripts/try-pipeline.ts \\
    --all --limit=1 --out=tmp/pipeline-smoke.json

  # Full lang × native matrix, 1 URL per learning lang, one fetch per URL:
  npx tsx --tsconfig scripts/tsconfig.pipeline.json scripts/try-pipeline.ts \\
    --sweep --limit=1 --seed=42 --top=0 --out=tmp/pipeline-sweep.json
`);
}

function assertSupportedLang(code: string): asserts code is SupportedLanguage {
  if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(code)) {
    throw new Error(
      `Unsupported language code "${code}". Supported: ${SUPPORTED_LANGUAGES.join(', ')}`,
    );
  }
}

function loadCorpus(): Corpus {
  if (!fs.existsSync(CORPUS_PATH)) {
    throw new Error(`Corpus not found at ${CORPUS_PATH}`);
  }
  const raw = fs.readFileSync(CORPUS_PATH, 'utf8');
  return JSON.parse(raw) as Corpus;
}

/** Small seeded PRNG (mulberry32). Deterministic, 32-bit state, plenty good
 *  for sampling a few entries without replacement. Stateful: each call mutates. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates: return the first `k` items of a shuffled copy of `items`. */
function sampleWithoutReplacement<T>(items: T[], k: number, rng: () => number): T[] {
  const arr = items.slice();
  const n = Math.min(k, arr.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

interface PickedEntry {
  entry: CorpusEntry;
  index: number;
}

function pickEntries(
  corpus: Corpus,
  lang: string,
  args: CliArgs,
  rng: () => number,
): PickedEntry[] {
  const block = corpus[lang];
  if (!Array.isArray(block)) {
    throw new Error(`No corpus entries for language "${lang}".`);
  }
  const full = block as CorpusEntry[];

  // --index is an explicit pick — deterministic, ignores limit/skip/random.
  if (args.index !== undefined) {
    const picked = full[args.index];
    if (!picked) throw new Error(`--index=${args.index} out of range for ${lang}`);
    return [{ entry: picked, index: args.index }];
  }

  // Keep the original corpus index alongside each candidate so the output
  // can tell the user which slot was drawn.
  let pool: PickedEntry[] = full.map((entry, index) => ({ entry, index }));
  if (args.skip > 0) pool = pool.slice(args.skip);

  if (args.limit !== undefined) {
    return sampleWithoutReplacement(pool, args.limit, rng);
  }
  return pool;
}

function histogram(values: string[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (const v of values) h[v] = (h[v] ?? 0) + 1;
  return h;
}

function formatHistogram(h: Record<string, number>): string {
  const keys = Object.keys(h).sort();
  return keys.map((k) => `${k}:${h[k]}`).join(' ');
}

function corpusBrief(
  meta?: CorpusEntry,
): { difficulty_estimate: string; text_type: string; domain: string } | undefined {
  return (
    meta && {
      difficulty_estimate: meta.difficulty_estimate,
      text_type: meta.text_type,
      domain: meta.domain,
    }
  );
}

type Prepared =
  | {
      ok: true;
      article: { title: string; text: string };
      processedText: string;
      truncated: boolean;
      startedAt: number;
    }
  | { ok: false; startedAt: number; error: string };

/** Fetch + preview + truncate an article. Logs the URL header and fetch
 *  outcome. The caller drives per-native extraction afterwards. */
async function loadAndPrep(
  url: string,
  learningCode: SupportedLanguage,
  maxChars: number,
  corpusMeta?: CorpusEntry,
  corpusIndex?: number,
): Promise<Prepared> {
  const started = Date.now();
  const idxTag = corpusIndex !== undefined ? `#${corpusIndex} ` : '';
  const header = corpusMeta
    ? `[${learningCode}] ${idxTag}${corpusMeta.text_type}/${corpusMeta.difficulty_estimate}  ${url}`
    : `[${learningCode}]  ${url}`;
  console.log(`\n→ ${header}`);

  try {
    const article = await fetchArticleContent(url);
    const preview = article.text.substring(0, 120).replace(/\s+/g, ' ').trim();
    console.log(`  ✓ article: "${article.title}"  (${article.text.length.toLocaleString()} chars)`);
    console.log(`    ${preview}${article.text.length > 120 ? '…' : ''}`);

    const truncated = maxChars > 0 && article.text.length > maxChars;
    const processedText = truncated ? article.text.substring(0, maxChars) : article.text;
    if (truncated) {
      console.log(
        `    (truncated to ${maxChars.toLocaleString()} chars for extraction — ` +
          `${(article.text.length - maxChars).toLocaleString()} chars dropped)`,
      );
    }
    return { ok: true, article, processedText, truncated, startedAt: started };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ fetch failed: ${msg}`);
    return { ok: false, startedAt: started, error: msg };
  }
}

/** Run extractVocabulary for one (learning, native) pair against a prepared
 *  article. Logs a lang→native result line and top-N preview. */
async function extractAndReport(
  prep: Extract<Prepared, { ok: true }>,
  url: string,
  learningCode: SupportedLanguage,
  nativeCode: string,
  top: number,
  mode: ExtractionMode,
  corpusMeta?: CorpusEntry,
  corpusIndex?: number,
): Promise<UrlResult> {
  const subStarted = Date.now();
  const pairTag = `${learningCode}→${nativeCode}`;

  const extractFn = mode === 'two-phase' ? extractVocabularyTwoPhase : extractVocabulary;
  let vocab: ExtractedVocab[];
  try {
    vocab = await extractFn(
      prep.processedText,
      getLanguageEnglishName(nativeCode),
      getLanguageEnglishName(learningCode),
      learningCode,
      nativeCode,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⤷ ${pairTag}: ✗ extract failed: ${msg}`);
    return {
      url,
      lang: learningCode,
      native: nativeCode,
      corpusIndex,
      corpus: corpusBrief(corpusMeta),
      ok: false,
      error: msg,
      title: prep.article.title,
      textLength: prep.article.text.length,
      elapsedMs: Date.now() - subStarted,
    };
  }

  const levelDist = histogram(vocab.map((v) => v.level));
  const typeDist = histogram(vocab.map((v) => v.type));
  const elapsedMs = Date.now() - subStarted;
  console.log(
    `  ⤷ ${pairTag}: ${vocab.length} vocab in ${(elapsedMs / 1000).toFixed(1)}s` +
      `  | levels: ${formatHistogram(levelDist)}` +
      `  | types: ${formatHistogram(typeDist)}`,
  );

  if (top > 0 && vocab.length > 0) {
    const sample = vocab.slice(0, top);
    for (const v of sample) {
      const orig = v.original.length > 28 ? v.original.substring(0, 27) + '…' : v.original;
      const trans =
        v.translation.length > 32 ? v.translation.substring(0, 31) + '…' : v.translation;
      console.log(`      [${v.level}] ${orig.padEnd(28)} → ${trans.padEnd(32)} (${v.type})`);
    }
    if (vocab.length > top) {
      console.log(`      … and ${vocab.length - top} more`);
    }
  }

  return {
    url,
    lang: learningCode,
    native: nativeCode,
    corpusIndex,
    corpus: corpusBrief(corpusMeta),
    ok: true,
    title: prep.article.title,
    textLength: prep.article.text.length,
    processedTextLength: prep.processedText.length,
    truncated: prep.truncated,
    elapsedMs,
    vocabCount: vocab.length,
    levelDistribution: levelDist,
    typeDistribution: typeDist,
    vocab,
  };
}

/** Single-combo path: one URL, one native. */
async function processOne(
  url: string,
  learningCode: SupportedLanguage,
  nativeCode: string,
  top: number,
  maxChars: number,
  mode: ExtractionMode,
  corpusMeta?: CorpusEntry,
  corpusIndex?: number,
): Promise<UrlResult> {
  const prep = await loadAndPrep(url, learningCode, maxChars, corpusMeta, corpusIndex);
  if (!prep.ok) {
    return {
      url,
      lang: learningCode,
      native: nativeCode,
      corpusIndex,
      corpus: corpusBrief(corpusMeta),
      ok: false,
      error: prep.error,
      elapsedMs: Date.now() - prep.startedAt,
    };
  }
  return extractAndReport(prep, url, learningCode, nativeCode, top, mode, corpusMeta, corpusIndex);
}

/** Sweep path: one URL, many natives. Fetches once, diagonal cases skipped. */
async function processOneSweep(
  url: string,
  learningCode: SupportedLanguage,
  natives: SupportedLanguage[],
  top: number,
  maxChars: number,
  mode: ExtractionMode,
  corpusMeta?: CorpusEntry,
  corpusIndex?: number,
): Promise<UrlResult[]> {
  const prep = await loadAndPrep(url, learningCode, maxChars, corpusMeta, corpusIndex);
  const effectiveNatives = natives.filter((n) => n !== learningCode);
  if (effectiveNatives.length !== natives.length) {
    console.log(`  (skipping diagonal: native == ${learningCode})`);
  }
  if (!prep.ok) {
    // Surface the same fetch error for every (skipped) native so the
    // summary totals reflect the true number of attempted combos.
    return effectiveNatives.map((native) => ({
      url,
      lang: learningCode,
      native,
      corpusIndex,
      corpus: corpusBrief(corpusMeta),
      ok: false,
      error: prep.error,
      elapsedMs: Date.now() - prep.startedAt,
    }));
  }
  const results: UrlResult[] = [];
  for (const native of effectiveNatives) {
    const r = await extractAndReport(
      prep,
      url,
      learningCode,
      native,
      top,
      mode,
      corpusMeta,
      corpusIndex,
    );
    results.push(r);
  }
  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Propagate prompt-version choice to lib/claude BEFORE any extractVocabulary
  // call. defaultPromptVersion() reads this env var on every builder
  // invocation, so setting it here affects all downstream processOne() calls.
  process.env.ANYVOC_PROMPT_VERSION = args.prompt;

  if (!args.url && !args.lang && !args.all && !args.sweep) {
    printHelp();
    process.exit(2);
  }

  assertSupportedLang(args.native);

  const results: UrlResult[] = [];
  const overallStart = Date.now();
  // Resolved once we know whether we're in sweep mode + know the corpus.
  let sweepNatives: SupportedLanguage[] | undefined;

  if (args.url) {
    if (args.sweep) {
      console.error('--sweep is not supported with --url (no corpus sampling).');
      process.exit(2);
    }
    if (!args.lang) {
      console.error('--url requires --lang=<code> (learning language of the URL content).');
      process.exit(2);
    }
    assertSupportedLang(args.lang);
    const r = await processOne(
      args.url,
      args.lang,
      args.native,
      args.top,
      args.maxChars,
      args.mode,
    );
    results.push(r);
  } else {
    const corpus = loadCorpus();
    // --sweep defaults to all learning languages when --lang isn't set; in
    // non-sweep mode the classic --all flag controls it.
    const langs = args.lang
      ? [args.lang]
      : args.all || args.sweep
        ? (corpus._meta.languages as string[])
        : [];
    if (langs.length === 0) {
      console.error('Need --lang=<code>, --all, or --sweep to pick learning languages.');
      process.exit(2);
    }
    // Shared RNG across languages so --seed makes the whole run reproducible,
    // not just each language in isolation.
    const rng = mulberry32(args.seed);
    if (args.limit !== undefined && args.index === undefined) {
      console.log(`(sampling ${args.limit} URL(s) per language at random, seed=${args.seed})`);
    }

    const natives: SupportedLanguage[] = args.sweep
      ? (args.natives ?? (corpus._meta.languages as SupportedLanguage[]))
      : [];
    if (args.sweep) {
      sweepNatives = natives;
      console.log(
        `(sweep: ${langs.length} learning × ${natives.length} native(s) = ` +
          `${langs.reduce((a, l) => a + natives.filter((n) => n !== l).length, 0)} non-diagonal combos)`,
      );
    }

    for (const lang of langs) {
      assertSupportedLang(lang);
      const picked = pickEntries(corpus, lang, args, rng);
      const idxList = picked.map((p) => `#${p.index}`).join(', ');
      console.log(
        `\n=== ${lang.toUpperCase()} — ${picked.length} URL(s) from corpus` +
          (idxList ? `: ${idxList}` : '') +
          ` ===`,
      );
      for (const { entry, index } of picked) {
        if (args.sweep) {
          const subs = await processOneSweep(
            entry.url,
            lang,
            natives,
            args.top,
            args.maxChars,
            args.mode,
            entry,
            index,
          );
          results.push(...subs);
        } else {
          const r = await processOne(
            entry.url,
            lang,
            args.native,
            args.top,
            args.maxChars,
            args.mode,
            entry,
            index,
          );
          results.push(r);
        }
      }
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  const totalVocab = results.reduce((a, r) => a + (r.vocabCount ?? 0), 0);
  const wallSec = ((Date.now() - overallStart) / 1000).toFixed(1);
  console.log(
    `\n=== Summary: ${ok}/${results.length} ok, ${failed} failed, ` +
      `${totalVocab} vocab total, ${wallSec}s wall ===`,
  );

  if (args.out) {
    const outPath = path.isAbsolute(args.out) ? args.out : path.join(PROJECT_ROOT, args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          seed: args.seed,
          maxChars: args.maxChars,
          mode: args.mode,
          promptVersion: args.prompt,
          sweep: args.sweep,
          natives: sweepNatives,
          totals: {
            combos: results.length,
            ok,
            failed,
            vocab: totalVocab,
            wallSec: Number(wallSec),
          },
          results,
        },
        null,
        2,
      ),
    );
    console.log(`Wrote ${outPath}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
