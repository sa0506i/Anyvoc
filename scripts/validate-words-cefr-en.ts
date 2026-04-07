/**
 * validate-words-cefr-en.ts
 *
 * Independent validation of the English classifier against the
 * Maximax67/Words-CEFR-Dataset (MIT, derived from CEFR-J + n-gram freq).
 *
 *   https://github.com/Maximax67/Words-CEFR-Dataset
 *
 * This is an INDEPENDENT gold source: our classifier was calibrated on
 * KELLY-en (European KELLY project, CC BY-NC-SA). CEFR-J is a Japanese
 * learner-oriented CEFR word list. Agreement between two unrelated
 * sources is a much stronger signal than hold-out accuracy on the
 * calibration gold itself.
 *
 * Input  : tmp/validation/words-cefr/{words,word_pos}.csv
 *          (manually downloaded — see "Preparing inputs" below)
 * Output : stdout only. No file writes, no cache changes, no model
 *          updates. Pure read-only validation.
 *
 * Run:
 *   npm run validate:en-cefrj
 *   # or
 *   npx tsx scripts/validate-words-cefr-en.ts
 *
 * Preparing inputs (one-time, ~13 MB):
 *   mkdir -p tmp/validation/words-cefr
 *   curl -sSL -o tmp/validation/words-cefr/words.csv \
 *     https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/words.csv
 *   curl -sSL -o tmp/validation/words-cefr/word_pos.csv \
 *     https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/word_pos.csv
 *
 * Notes on the dataset's `level` column:
 *   - It's a continuous float from 1.0 to 6.0, mapping 1→A1, 2→A2, …, 6→C2.
 *   - Integers are "pristine" CEFR-J assignments; non-integers are the
 *     repo author's frequency-based interpolation for words not in CEFR-J.
 *   - Level 6.0 exactly is the default-high bucket containing ~167 k rows
 *     (67 % of the file). Most of those are rare words where the author
 *     couldn't assign a level and defaulted to "hardest". We print two
 *     variants of the metrics: one with level=6.0 included, one excluding
 *     it. The excluded variant is a fairer apples-to-apples comparison
 *     for our mid-range classifier (the "6.0" bucket is not a genuine
 *     C2 signal, it's an unknown-word signal).
 *
 * Design:
 *   - We round `level` to the nearest integer and map to CEFR labels.
 *     Min level per word (i.e., easiest POS sense) is used to dedupe.
 *   - We filter to words that contain only ASCII letters + hyphens +
 *     apostrophes, matching the shape of our Leipzig freq table keys.
 *   - We compute exact accuracy, ±1 level accuracy, MAE in level units,
 *     and a full confusion matrix. No ordinal distance weighting.
 *   - Words our features layer falls back on (fb=2, neither Zipf nor
 *     real AoA) are counted separately so the reader can tell whether
 *     low accuracy comes from the classifier or from coverage gaps.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { CEFR_LEVELS, type CEFRLevel } from '../constants/levels';
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

const DATA_DIR = path.resolve(__dirname, '..', 'tmp', 'validation', 'words-cefr');
const WORDS_CSV = path.join(DATA_DIR, 'words.csv');
const WORD_POS_CSV = path.join(DATA_DIR, 'word_pos.csv');

const LEVEL_TO_CEFR: Record<number, CEFRLevel> = {
  1: 'A1',
  2: 'A2',
  3: 'B1',
  4: 'B2',
  5: 'C1',
  6: 'C2',
};

// The words.csv / word_pos.csv files use simple comma-separated quoted
// fields with no embedded commas or quotes. A proper CSV library would
// be overkill — a line-level split + strip-quotes pass handles the
// entire file in one streaming read.
function parseSimpleCsv(filePath: string): Record<string, string>[] {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const out: Record<string, string>[] = new Array(lines.length - 1);
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? '';
    }
    out[i - 1] = row;
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  // Fast path: all fields are either bare or "..."-quoted, no embedded
  // commas. Regex-split on `,` is safe after we verify no quoted cell
  // contains a comma (true for this dataset — checked by inspection).
  return line.split(',').map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  });
}

// Shape of a word worth scoring.
const WORD_RE = /^[a-z][a-z'\-]*$/;

function ensureInputsExist(): void {
  const missing: string[] = [];
  if (!fs.existsSync(WORDS_CSV)) missing.push(WORDS_CSV);
  if (!fs.existsSync(WORD_POS_CSV)) missing.push(WORD_POS_CSV);
  if (missing.length === 0) return;
  console.error(
    `[validate:en-cefrj] missing input files:\n` +
      missing.map((f) => `  - ${f}`).join('\n') +
      `\n\nDownload them once with:\n` +
      `  mkdir -p tmp/validation/words-cefr\n` +
      `  curl -sSL -o tmp/validation/words-cefr/words.csv \\\n` +
      `    https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/words.csv\n` +
      `  curl -sSL -o tmp/validation/words-cefr/word_pos.csv \\\n` +
      `    https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/word_pos.csv\n`
  );
  process.exit(1);
}

interface GoldEntry {
  word: string;
  /** integer 1..6, i.e. A1..C2 index. */
  levelIdx: number;
  /** was this derived from a pristine integer CEFR-J level, or an interpolated float? */
  pristine: boolean;
  /** raw continuous level from the dataset, kept for the "exclude 6.0" filter. */
  rawLevel: number;
}

function loadGold(): GoldEntry[] {
  console.log(`[validate:en-cefrj] reading ${path.basename(WORDS_CSV)} ...`);
  const words = parseSimpleCsv(WORDS_CSV);
  const id2word: Map<string, string> = new Map();
  for (const row of words) {
    id2word.set(row['word_id'], row['word']);
  }
  console.log(`  loaded ${id2word.size} word rows`);

  console.log(`[validate:en-cefrj] reading ${path.basename(WORD_POS_CSV)} ...`);
  const wordPos = parseSimpleCsv(WORD_POS_CSV);
  console.log(`  loaded ${wordPos.length} word_pos rows`);

  // Per word: take the MIN level across all POS tags (easiest sense).
  // Also track whether the word has at least one pristine integer row.
  interface Agg {
    word: string;
    bestRaw: number;
    bestPristine: boolean;
    anyPristine: boolean;
  }
  const agg: Map<string, Agg> = new Map();
  for (const row of wordPos) {
    const word = id2word.get(row['word_id']);
    if (!word) continue;
    const wl = word.toLowerCase();
    if (!WORD_RE.test(wl)) continue;
    const raw = parseFloat(row['level']);
    if (!Number.isFinite(raw) || raw < 1 || raw > 6) continue;
    const pristine = raw === Math.floor(raw);
    const prev = agg.get(wl);
    if (prev === undefined || raw < prev.bestRaw) {
      agg.set(wl, {
        word: wl,
        bestRaw: raw,
        bestPristine: pristine,
        anyPristine: prev?.anyPristine === true || pristine,
      });
    } else if (pristine) {
      prev.anyPristine = true;
    }
  }

  const out: GoldEntry[] = [];
  for (const a of agg.values()) {
    const levelIdx = Math.max(1, Math.min(6, Math.round(a.bestRaw)));
    out.push({
      word: a.word,
      levelIdx,
      pristine: a.bestPristine,
      rawLevel: a.bestRaw,
    });
  }
  return out;
}

interface Metrics {
  n: number;
  exact: number;
  within1: number;
  mae: number;
  fb2: number;
  confusion: number[][]; // [goldIdx-1][predIdx-1]
  perLevelN: number[];
  perLevelExact: number[];
}

interface EvalOptions {
  /** if true, drop rows where extractFeatures returns fallbackCount >= 2 */
  dropFb2?: boolean;
}

function evaluate(gold: GoldEntry[], opts: EvalOptions = {}): Metrics {
  const confusion: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const perLevelN: number[] = new Array(6).fill(0);
  const perLevelExact: number[] = new Array(6).fill(0);
  let n = 0;
  let exact = 0;
  let within1 = 0;
  let maeSum = 0;
  let fb2 = 0;
  for (const g of gold) {
    const f = extractFeatures(g.word, 'en');
    const isFb2 = f.fallbackCount >= 2;
    if (isFb2) fb2++;
    if (opts.dropFb2 && isFb2) continue;
    n++;
    const d = scoreDifficulty(f);
    const predLabel = difficultyToCefr(d);
    const predIdx = CEFR_LEVELS.indexOf(predLabel) + 1; // 1..6
    const goldIdx = g.levelIdx;
    confusion[goldIdx - 1][predIdx - 1]++;
    perLevelN[goldIdx - 1]++;
    const diff = Math.abs(predIdx - goldIdx);
    if (diff === 0) {
      exact++;
      perLevelExact[goldIdx - 1]++;
    }
    if (diff <= 1) within1++;
    maeSum += diff;
  }
  return {
    n,
    exact: n ? exact / n : 0,
    within1: n ? within1 / n : 0,
    mae: n ? maeSum / n : 0,
    fb2,
    confusion,
    perLevelN,
    perLevelExact,
  };
}

function printMetrics(title: string, m: Metrics): void {
  console.log('');
  console.log('='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));
  console.log(
    `n=${m.n}  exact=${(m.exact * 100).toFixed(1)}%  ` +
      `±1=${(m.within1 * 100).toFixed(1)}%  mae=${m.mae.toFixed(3)}  ` +
      `fb2 (no zipf+no aoa)=${m.fb2} (${((m.fb2 / m.n) * 100).toFixed(1)}%)`
  );
  console.log('');
  console.log('Per gold-level accuracy:');
  for (let i = 0; i < 6; i++) {
    if (m.perLevelN[i] === 0) {
      console.log(`  ${CEFR_LEVELS[i]}  n=${String(0).padStart(6)}  exact=   — `);
      continue;
    }
    const acc = m.perLevelExact[i] / m.perLevelN[i];
    console.log(
      `  ${CEFR_LEVELS[i]}  n=${String(m.perLevelN[i]).padStart(6)}  ` +
        `exact=${(acc * 100).toFixed(1).padStart(5)}%`
    );
  }
  console.log('');
  console.log('Confusion matrix (rows = gold, cols = predicted):');
  const header = '         ' + CEFR_LEVELS.map((l) => l.padStart(7)).join('') + '     total';
  console.log(header);
  for (let i = 0; i < 6; i++) {
    const total = m.confusion[i].reduce((a, b) => a + b, 0);
    const row =
      `  ${CEFR_LEVELS[i]}    ` +
      m.confusion[i].map((x) => String(x).padStart(7)).join('') +
      `   ${String(total).padStart(7)}`;
    console.log(row);
  }
}

function main(): void {
  ensureInputsExist();

  const gold = loadGold();
  console.log(
    `[validate:en-cefrj] ${gold.length} unique ASCII words after dedup + filter`
  );
  const pristineCount = gold.filter((g) => g.pristine).length;
  console.log(
    `  of which pristine CEFR-J integers: ${pristineCount} ` +
      `(${((pristineCount / gold.length) * 100).toFixed(1)}%)`
  );
  const rawLevelCounts: Record<number, number> = {};
  for (const g of gold) {
    const k = g.levelIdx;
    rawLevelCounts[k] = (rawLevelCounts[k] ?? 0) + 1;
  }
  console.log(
    `  gold level distribution after rounding: ` +
      CEFR_LEVELS.map(
        (l, i) => `${l}=${rawLevelCounts[i + 1] ?? 0}`
      ).join('  ')
  );

  // Variant 1: all rounded levels (including 6.0 default bucket).
  printMetrics(
    'VARIANT A: all levels (includes the level=6.0 default-high bucket)',
    evaluate(gold)
  );

  // Variant 2: exclude rows whose raw level == 6.0 exactly (repo author's
  // fallback for words not in CEFR-J).
  const without6 = gold.filter((g) => g.rawLevel !== 6.0);
  printMetrics(
    `VARIANT B: excluding raw level==6.0 (dropped ${gold.length - without6.length} rows)`,
    evaluate(without6)
  );

  // Variant 3: pristine CEFR-J integers only (no interpolated rows).
  const pristineOnly = gold.filter((g) => g.pristine && g.rawLevel !== 6.0);
  printMetrics(
    `VARIANT C: pristine CEFR-J integers only, excluding level=6.0 (n=${pristineOnly.length})`,
    evaluate(pristineOnly)
  );

  // Variant 4: same as B but also drop rows where our classifier has
  // neither Zipf nor real AoA (fallbackCount >= 2). This isolates the
  // question "when we HAVE data, how well do we agree with CEFR-J?" from
  // "how often do we fall back to the default?".
  printMetrics(
    'VARIANT D: VARIANT B but drop words with fb>=2 (classifier-covered only)',
    evaluate(without6, { dropFb2: true })
  );

  console.log('');
  console.log('Deployed model in lib/classifier/score.ts:');
  console.log(
    '  w_zipf=-2.3129  w_aoa=+4.5481  ' +
      'th=(-0.4555, +0.4272, +1.4421, +1.8400, +2.3073)'
  );
  console.log('');
  console.log(
    'Interpretation: VARIANT B (exclude level=6.0 default bucket) is the ' +
      'fairest apples-to-apples score. VARIANT C is the cleanest gold but ' +
      'small and biased toward basic vocab.'
  );
}

main();
