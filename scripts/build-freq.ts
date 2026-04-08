/**
 * build-freq.ts
 *
 * Downloads Leipzig Corpora Collection news word-frequency lists for the 12
 * languages Anyvoc supports, computes Zipf scores, and writes them to
 * lib/data/freq_{bcp47}.json so the runtime classifier can do an offline
 * lookup.
 *
 * NEVER wire this into eas-build-pre-install or any other Expo/EAS hook.
 * It is a dev-machine-only build step. The generated JSON files are
 * committed to the repo so EAS Build sees them as static assets.
 *
 * Run: npm run build:freq [year]
 *
 * Attribution:
 *   Word frequency data: Leipzig Corpora Collection
 *   Goldhahn, Eckart & Quasthoff (2012), LREC, CC BY 4.0
 *   https://wortschatz.uni-leipzig.de
 */

import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';

export const LANGUAGES = [
  { bcp47: 'en', leipzig: 'eng' },
  { bcp47: 'de', leipzig: 'deu' },
  { bcp47: 'fr', leipzig: 'fra' },
  { bcp47: 'es', leipzig: 'spa' },
  { bcp47: 'it', leipzig: 'ita' },
  { bcp47: 'pt', leipzig: 'por' },
  { bcp47: 'nl', leipzig: 'nld' },
  { bcp47: 'sv', leipzig: 'swe' },
  // Norwegian: empirically 'nor' is the code Leipzig actually keeps current
  // (2019–2023). 'nob' exists only as 2012–2013 archives. The spec assumed
  // the opposite — verify with `axios.head` if Leipzig reorganises again.
  { bcp47: 'no', leipzig: 'nor' },
  { bcp47: 'da', leipzig: 'dan' },
  { bcp47: 'pl', leipzig: 'pol' },
  { bcp47: 'cs', leipzig: 'ces' },
] as const;

const SIZES = ['300K', '100K', '30K', '10K'] as const;

/**
 * Per-language size override. Languages listed here probe a larger
 * tier before falling through the default SIZES cascade. Rationale:
 * English is the most common learning language, and a bigger corpus
 * reduces the rare-word coverage gap that drove 58 % misses in the
 * independent CEFR-J validation. Other languages stay at 300K to keep
 * the APK bundle reasonable.
 *
 * Leipzig hosts eng_news_{year}_1M for most recent years. If a 1M
 * archive is unavailable the usual 300K→10K fallback kicks in.
 */
const SIZE_OVERRIDES: Record<string, readonly string[]> = {
  en: ['1M', '300K', '100K', '30K', '10K'],
};

const MAX_YEAR_FALLBACK = 5;

const BASE = 'https://downloads.wortschatz-leipzig.de/corpora';

function corpusUrl(leipzig: string, year: number, size: string): string {
  return `${BASE}/${leipzig}_news_${year}_${size}.tar.gz`;
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const res = await axios.head(url, { timeout: 15000, validateStatus: () => true });
    return res.status === 200;
  } catch {
    return false;
  }
}

export interface ResolvedCorpus {
  url: string;
  size: string;
  year: number;
  triedSizes: string[];
}

/**
 * Probes Leipzig URLs in size order (300K → 100K → 30K → 10K by default,
 * or a per-language override like ['1M', '300K', ...] for English) for
 * the given year. Returns the first that responds 200, or null if none do.
 */
export async function resolveCorpusUrl(
  leipzig: string,
  year: number,
  sizes: readonly string[] = SIZES
): Promise<ResolvedCorpus | null> {
  const tried: string[] = [];
  for (const size of sizes) {
    tried.push(size);
    const url = corpusUrl(leipzig, year, size);
    if (await urlExists(url)) {
      return { url, size, year, triedSizes: tried };
    }
  }
  return null;
}

/**
 * Resolves a corpus, walking back up to MAX_YEAR_FALLBACK years if no size
 * is available for the requested year. Throws if nothing is found.
 */
async function resolveWithYearFallback(
  bcp47: string,
  leipzig: string,
  startYear: number
): Promise<ResolvedCorpus> {
  const sizes = SIZE_OVERRIDES[bcp47] ?? SIZES;
  for (let i = 0; i < MAX_YEAR_FALLBACK; i++) {
    const year = startYear - i;
    const r = await resolveCorpusUrl(leipzig, year, sizes);
    if (r) return r;
  }
  throw new Error(
    `[build:freq] No Leipzig corpus available for "${leipzig}" within years ` +
      `${startYear - MAX_YEAR_FALLBACK + 1}–${startYear}. Check the language code or ` +
      `Leipzig server availability.`
  );
}

async function downloadAndExtract(
  url: string,
  outDir: string
): Promise<string> {
  const res = await axios.get(url, { responseType: 'stream', timeout: 120000 });
  fs.mkdirSync(outDir, { recursive: true });
  await pipeline(res.data, zlib.createGunzip(), tar.extract({ cwd: outDir }));

  // The archive layout is {leipzig}_news_{year}_{size}/{leipzig}_news_{year}_{size}-words.txt
  const findWordsFile = (dir: string): string | null => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findWordsFile(full);
        if (found) return found;
      } else if (entry.name.endsWith('-words.txt') || entry.name.endsWith('_words.txt')) {
        return full;
      }
    }
    return null;
  };

  const wordsFile = findWordsFile(outDir);
  if (!wordsFile) {
    throw new Error(`No *-words.txt file found in extracted archive at ${outDir}`);
  }
  return wordsFile;
}

interface FreqRow {
  word: string;
  count: number;
}

function parseWordsFile(filePath: string): FreqRow[] {
  const rows: FreqRow[] = [];
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    // Tab-separated: rank \t word \t count
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const word = parts[1];
    const count = parseInt(parts[2], 10);
    if (!word || !Number.isFinite(count)) continue;
    rows.push({ word, count });
  }
  return rows;
}

function computeZipfMap(rows: FreqRow[]): Record<string, number> {
  // Sum counts across case-folded forms first ("The" + "the" → "the").
  // The Leipzig _words.txt is sorted by raw frequency, so naively writing
  // the lowercase key would let a later, lower-count capitalised duplicate
  // overwrite the dominant entry — that's what was producing Zipf 4.1 for
  // "the" instead of the correct 7.6.
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    total += r.count;
    const key = r.word.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + r.count);
  }
  if (total === 0) return {};
  const out: Record<string, number> = {};
  for (const [word, count] of counts) {
    const zipf = Math.log10((count / total) * 1_000_000_000);
    // Round to 3 decimals to keep the JSON compact.
    out[word] = Math.round(zipf * 1000) / 1000;
  }
  return out;
}

function attributionHeader(leipzig: string, year: number, size: string): string {
  return [
    '// Word frequency data: Leipzig Corpora Collection',
    '// Goldhahn, Eckart & Quasthoff (2012), LREC, CC BY 4.0',
    '// https://wortschatz.uni-leipzig.de',
    `// Corpus: ${leipzig}_news_${year}_${size}`,
  ].join('\n');
}

async function buildLanguage(
  bcp47: string,
  leipzig: string,
  startYear: number,
  outDataDir: string
): Promise<void> {
  const resolved = await resolveWithYearFallback(bcp47, leipzig, startYear);
  const expectedSize = (SIZE_OVERRIDES[bcp47] ?? SIZES)[0];
  const usedFallback =
    resolved.size !== expectedSize || resolved.year !== startYear
      ? ' ⚠ Fallback'
      : ' ✓';
  const fallbackDetails =
    resolved.triedSizes.length > 1
      ? ` von ${resolved.triedSizes.slice(0, -1).join(', ')}`
      : '';
  console.log(
    `[build:freq] ${leipzig} → ${resolved.size} (${resolved.year})${usedFallback}${
      resolved.size !== '300K' ? fallbackDetails : ''
    }`
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `anyvoc-freq-${bcp47}-`));
  try {
    const wordsFile = await downloadAndExtract(resolved.url, tmpDir);
    const rows = parseWordsFile(wordsFile);
    const zipf = computeZipfMap(rows);

    // No top-N cap: corpus size tier is the only size knob (per design decision).
    const outFile = path.join(outDataDir, `freq_${bcp47}.json`);
    const header = attributionHeader(leipzig, resolved.year, resolved.size);
    // JSON files cannot have comments, so we emit a sibling .txt with attribution
    // and put the same metadata as a magic key in the JSON. Metro can require()
    // the JSON cleanly, and the attribution stays alongside it.
    //
    // Payload shape: parallel arrays { keys, values }, NOT a { word: zipf } map.
    // Hermes caps object property count at 196607; 10 of our 12 languages
    // exceed that (en ≈ 580k), so a single big object would crash the runtime
    // with "Property storage exceeds 196607 properties" at require() time.
    // See lib/classifier/features.ts loadFreq() for the matching reader.
    const entries = Object.entries(zipf);
    const keys = new Array<string>(entries.length);
    const values = new Array<number>(entries.length);
    for (let i = 0; i < entries.length; i++) {
      keys[i] = entries[i]![0];
      values[i] = entries[i]![1];
    }
    const payload = {
      __attribution: 'Leipzig Corpora Collection (CC BY 4.0) — see ATTRIBUTION.md',
      __corpus: `${leipzig}_news_${resolved.year}_${resolved.size}`,
      keys,
      values,
    };
    fs.writeFileSync(outFile, JSON.stringify(payload));
    fs.writeFileSync(
      path.join(outDataDir, `freq_${bcp47}.attribution.txt`),
      header + '\n'
    );
    console.log(
      `[build:freq] ${bcp47}: wrote ${entries.length} words → ${path.relative(
        process.cwd(),
        outFile
      )}`
    );
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  // Args: [year?] [--only=en,de,...]
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
  const yearArg = args.find((a) => !a.startsWith('--'));
  const startYear = yearArg ? parseInt(yearArg, 10) : new Date().getFullYear();
  if (!Number.isFinite(startYear)) {
    throw new Error(`Invalid year argument: ${yearArg}`);
  }

  const outDataDir = path.resolve(__dirname, '..', 'lib', 'data');
  fs.mkdirSync(outDataDir, { recursive: true });

  const targets = only ? LANGUAGES.filter((l) => only.has(l.bcp47)) : LANGUAGES;
  console.log(
    `[build:freq] starting (year=${startYear}, targets=${targets
      .map((l) => l.bcp47)
      .join(',')})`
  );
  for (const lang of targets) {
    try {
      await buildLanguage(lang.bcp47, lang.leipzig, startYear, outDataDir);
    } catch (err) {
      console.error(
        `[build:freq] FAILED for ${lang.bcp47} (${lang.leipzig}):`,
        (err as Error).message
      );
    }
  }
  console.log('[build:freq] done');
}

// Only run main when executed directly via tsx, not when imported by tests.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
