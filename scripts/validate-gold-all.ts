/**
 * validate-gold-all.ts
 *
 * Evaluates the deployed English/multilingual ordinal-logit model
 * against every gold source that fed into the calibration, one
 * language at a time. This is NOT an independent test — it's a
 * per-language sanity check on the training set. Use
 * `validate-words-cefr-en.ts` for independent EN validation.
 *
 * Source mapping:
 *   en → KELLY-en
 *   it → KELLY-it
 *   sv → KELLY-sv
 *   es → ELELex     (CEFRLex)
 *   fr → FLELex     (CEFRLex)
 *   nl → NT2Lex     (CEFRLex)
 *   de → Goethe-A1 + Goethe-A2 + Goethe-B1 (combined)
 *   no → no gold source available (LLM-oracle only — skipped here
 *        because self-evaluating the oracle that trained the model
 *        is circular)
 *
 * Per user request the "ALL" variant is reported — i.e., no rows
 * are dropped (KELLY-en's C2 catch-all stays in). Feature fallback
 * rows are also kept so the numbers reflect end-to-end model
 * quality on the unfiltered gold.
 *
 * Run:
 *   npm run validate:gold-all
 *   # or
 *   npx tsx scripts/validate-gold-all.ts
 *
 * Input  : tmp/gold/features.csv  (produced by `npm run build:export-features`)
 * Output : stdout only. Read-only, no file writes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { CEFR_LEVELS, type CEFRLevel } from '../constants/levels';

// Deployed coefficients — must mirror lib/classifier/score.ts.
const W_ZIPF = -1.9267;
const W_AOA = 4.7804;
const THETA = [-0.1559, 0.6753, 1.5918, 2.0130, 2.6026];

function predictIdx(eta: number): number {
  for (let i = 0; i < THETA.length; i++) {
    if (eta < THETA[i]) return i;
  }
  return 5;
}

interface Row {
  word: string;
  language: string;
  zipfNorm: number;
  aoaNorm: number;
  fbZipf: number;
  fbAoa: number;
  cefr: CEFRLevel;
  source: string;
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
    // Mirror the post-fix features.ts behavior: when both features
    // fall back, override aoaNorm to the neutral B2|C1 default
    // (0.4) instead of the old 1-zipfNorm=1 C2-trap.
    if (fbZ === 1 && fbA === 1) aoaNorm = 0.4;
    out.push({
      word: c[iWord],
      language: c[iLang],
      zipfNorm: parseFloat(c[iZn]),
      aoaNorm,
      fbZipf: fbZ,
      fbAoa: fbA,
      cefr: c[iCefr] as CEFRLevel,
      source: c[iSrc],
    });
  }
  return out;
}

interface Metrics {
  n: number;
  exact: number;
  within1: number;
  mae: number;
  confusion: number[][];
  perLevelN: number[];
  perLevelExact: number[];
}

function evaluate(rows: Row[]): Metrics {
  const confusion: number[][] = Array.from({ length: 6 }, () =>
    new Array(6).fill(0)
  );
  const perLevelN = new Array(6).fill(0);
  const perLevelExact = new Array(6).fill(0);
  let n = 0;
  let exact = 0;
  let within1 = 0;
  let maeSum = 0;
  for (const r of rows) {
    const eta = W_ZIPF * r.zipfNorm + W_AOA * r.aoaNorm;
    const p = predictIdx(eta);
    const g = CEFR_LEVELS.indexOf(r.cefr);
    if (g < 0) continue;
    n++;
    confusion[g][p]++;
    perLevelN[g]++;
    const d = Math.abs(p - g);
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
    confusion,
    perLevelN,
    perLevelExact,
  };
}

/**
 * Deterministic per-level downsample: group rows by their gold CEFR
 * label, sort each bucket alphabetically (stable, no RNG), and take
 * the first min(bucketSize) rows from each. Produces a balanced
 * sub-gold with exactly the same number of rows at every level the
 * source provides — mirroring the shape KELLY-sv already has by
 * construction. Levels absent from the source (e.g. C2 in NT2Lex)
 * stay absent; the balance is across "present" levels only.
 */
function downsampleBalanced(rows: Row[]): Row[] {
  const byLevel = new Map<CEFRLevel, Row[]>();
  for (const r of rows) {
    if (!byLevel.has(r.cefr)) byLevel.set(r.cefr, []);
    byLevel.get(r.cefr)!.push(r);
  }
  for (const bucket of byLevel.values()) {
    bucket.sort((a, b) => a.word.localeCompare(b.word));
  }
  const target = Math.min(...Array.from(byLevel.values(), (b) => b.length));
  const out: Row[] = [];
  for (const bucket of byLevel.values()) out.push(...bucket.slice(0, target));
  return out;
}

interface LangSpec {
  lang: string;
  sources: string[];
  label: string;
}

const SPECS: LangSpec[] = [
  { lang: 'en', sources: ['KELLY-en'], label: 'KELLY-en' },
  { lang: 'en', sources: ['Oxford-5000'], label: 'Oxford-5000' },
  {
    lang: 'en',
    sources: ['KELLY-en', 'Oxford-5000'],
    label: 'KELLY+Oxford',
  },
  { lang: 'it', sources: ['KELLY-it'], label: 'KELLY-it' },
  { lang: 'sv', sources: ['KELLY-sv'], label: 'KELLY-sv' },
  { lang: 'es', sources: ['ELELex'], label: 'ELELex' },
  { lang: 'fr', sources: ['FLELex'], label: 'FLELex' },
  { lang: 'nl', sources: ['NT2Lex'], label: 'NT2Lex' },
  {
    lang: 'de',
    sources: ['Goethe-A1', 'Goethe-A2', 'Goethe-B1'],
    label: 'Goethe (A1+A2+B1)',
  },
  {
    lang: 'de',
    sources: [
      'Goethe-A1',
      'Goethe-A2',
      'Goethe-B1',
      'Aspekte-B2',
      'Aspekte-C1',
    ],
    label: 'Goethe+Aspekte (A1-C1)',
  },
];

function padLeft(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}
function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printSummary(
  title: string,
  results: Array<{ spec: LangSpec; m: Metrics }>
): void {
  console.log('');
  console.log('='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));
  console.log(
    padRight('lang', 6) +
      padRight('source', 20) +
      padLeft('n', 8) +
      padLeft('exact', 10) +
      padLeft('±1', 10) +
      padLeft('MAE', 10)
  );
  console.log('-'.repeat(64));
  for (const { spec, m } of results) {
    console.log(
      padRight(spec.lang, 6) +
        padRight(spec.label, 20) +
        padLeft(String(m.n), 8) +
        padLeft((m.exact * 100).toFixed(1) + '%', 10) +
        padLeft((m.within1 * 100).toFixed(1) + '%', 10) +
        padLeft(m.mae.toFixed(3), 10)
    );
  }
  console.log('');
}

function printConfusion(spec: LangSpec, m: Metrics): void {
  console.log('');
  console.log('='.repeat(78));
  console.log(`${spec.lang.toUpperCase()} — ${spec.label}   (n=${m.n})`);
  console.log('='.repeat(78));
  console.log(
    `exact=${(m.exact * 100).toFixed(1)}%  ` +
      `±1=${(m.within1 * 100).toFixed(1)}%  ` +
      `MAE=${m.mae.toFixed(3)}`
  );
  console.log('');
  console.log('Per gold-level exact accuracy:');
  for (let i = 0; i < 6; i++) {
    if (m.perLevelN[i] === 0) {
      console.log(`  ${CEFR_LEVELS[i]}  n=${padLeft('0', 6)}  exact=   — `);
      continue;
    }
    const acc = m.perLevelExact[i] / m.perLevelN[i];
    console.log(
      `  ${CEFR_LEVELS[i]}  n=${padLeft(String(m.perLevelN[i]), 6)}  ` +
        `exact=${padLeft((acc * 100).toFixed(1), 5)}%`
    );
  }
  console.log('');
  console.log('Confusion matrix (rows = gold, cols = predicted):');
  console.log(
    '         ' + CEFR_LEVELS.map((l) => padLeft(l, 7)).join('') + '     total'
  );
  for (let i = 0; i < 6; i++) {
    const total = m.confusion[i].reduce((a, b) => a + b, 0);
    const row =
      `  ${CEFR_LEVELS[i]}    ` +
      m.confusion[i].map((x) => padLeft(String(x), 7)).join('') +
      `   ${padLeft(String(total), 7)}`;
    console.log(row);
  }
}

function main(): void {
  const csvPath = path.resolve(__dirname, '..', 'tmp', 'gold', 'features.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(
      `[validate:gold-all] missing ${csvPath}\n` +
        `Run \`npm run build:export-features\` first.`
    );
    process.exit(1);
  }
  console.log(`[validate:gold-all] reading ${csvPath} ...`);
  const all = loadFeatures(csvPath);
  console.log(`  loaded ${all.length} feature rows`);

  const resultsA: Array<{ spec: LangSpec; m: Metrics }> = [];
  const resultsB: Array<{ spec: LangSpec; m: Metrics }> = [];
  const resultsC: Array<{ spec: LangSpec; m: Metrics; perLevel: number }> = [];
  for (const spec of SPECS) {
    const rows = all.filter(
      (r) => r.language === spec.lang && spec.sources.includes(r.source)
    );
    if (rows.length === 0) {
      console.warn(
        `[validate:gold-all] WARN: no rows for ${spec.lang} / ${spec.label}`
      );
      continue;
    }
    const covered = rows.filter((r) => r.fbZipf + r.fbAoa < 2);
    const balanced = downsampleBalanced(rows);
    const perLevel = balanced.length
      ? balanced.length /
        new Set(balanced.map((r) => r.cefr)).size
      : 0;
    resultsA.push({ spec, m: evaluate(rows) });
    resultsB.push({ spec, m: evaluate(covered) });
    resultsC.push({ spec, m: evaluate(balanced), perLevel });
  }

  console.log(
    `[validate:gold-all] NOTE: no gold source for 'no' (Norwegian) — LLM-oracle only, skipped.`
  );

  printSummary(
    'VARIANT A — ALL rows, double-fallback rescue aoaNorm=0.4 (post-fix)',
    resultsA
  );
  printSummary(
    'VARIANT B — classifier-covered only, fb<2 (mirrors app path: fb>=2 goes to Claude)',
    resultsB
  );
  printSummary(
    'VARIANT C — per-level balanced sub-gold (like KELLY-sv by construction)',
    resultsC
  );
  console.log('  Per-level row counts in VARIANT C:');
  for (const { spec, m, perLevel } of resultsC) {
    const present = m.perLevelN.filter((n) => n > 0).length;
    console.log(
      `    ${padRight(spec.lang, 4)} ${padRight(spec.label, 20)} ${padLeft(String(perLevel), 6)} rows × ${present} levels = ${m.n}`
    );
  }
  console.log('');
  console.log('--- Per-language confusion matrices (VARIANT A) ---');
  for (const r of resultsA) printConfusion(r.spec, r.m);
  console.log('');
  console.log('--- Per-language confusion matrices (VARIANT B) ---');
  for (const r of resultsB) printConfusion(r.spec, r.m);
  console.log('');
  console.log('--- Per-language confusion matrices (VARIANT C — balanced) ---');
  for (const r of resultsC) printConfusion(r.spec, r.m);

  console.log('');
  console.log(
    `Deployed model: w_zipf=${W_ZIPF}  w_aoa=${W_AOA}  ` +
      `th=(${THETA.join(', ')})`
  );
  console.log(
    'Reminder: these gold sources were the calibration data, so this is a ' +
      'training-set sanity check, not an independent validation.'
  );
}

main();
