/**
 * export-features.ts
 *
 * Reads tmp/gold/gold-cefr.jsonl, runs every row through the runtime
 * `extractFeatures()` (the same function the classifier uses at runtime),
 * and writes a CSV at tmp/gold/features.csv with one row per word:
 *
 *   word,language,zipf,zipfNorm,aoaNorm,fb_zipf,fb_aoa,cefr,cefr_ord,source
 *
 * `cefr_ord` is the integer encoding 0..5 for A1..C2, suitable for
 * statsmodels.OrderedModel. Subsequent step:
 *
 *   python scripts/calibrate-model.py
 *
 * Dev-machine only. Output is gitignored under tmp/.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { extractFeatures } from '../lib/classifier/features';
import type { SupportedLanguage } from '../lib/classifier';

const CEFR_ORD: Record<string, number> = {
  A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5,
};

const SUPPORTED_LANGS = new Set([
  'en', 'de', 'fr', 'es', 'it', 'pt',
  'nl', 'sv', 'no', 'da', 'pl', 'cs',
]);

interface GoldRow {
  word: string;
  language: string;
  cefr: string;
  source: string;
}

function main() {
  const goldDir = path.resolve(__dirname, '..', 'tmp', 'gold');
  const inPath = path.join(goldDir, 'gold-cefr.jsonl');
  const outPath = path.join(goldDir, 'features.csv');

  if (!fs.existsSync(inPath)) {
    console.error(`Input not found: ${inPath}\nRun npm run build:gold first.`);
    process.exit(1);
  }

  const lines = fs.readFileSync(inPath, 'utf8').split('\n').filter(Boolean);
  console.log(`[export-features] reading ${lines.length} gold rows from ${inPath}`);

  const fd = fs.openSync(outPath, 'w');
  fs.writeSync(
    fd,
    'word,language,zipf,zipfNorm,aoaNorm,fb_zipf,fb_aoa,cefr,cefr_ord,source\n'
  );

  let written = 0;
  let skipped = 0;
  const perLang: Record<string, number> = {};
  const perCefr: Record<string, number> = {};

  for (const line of lines) {
    let row: GoldRow;
    try {
      row = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (!SUPPORTED_LANGS.has(row.language)) {
      skipped++;
      continue;
    }
    const ord = CEFR_ORD[row.cefr];
    if (ord === undefined) {
      skipped++;
      continue;
    }
    let f;
    try {
      f = extractFeatures(row.word, row.language as SupportedLanguage);
    } catch {
      skipped++;
      continue;
    }

    // CSV-escape word for safety (commas/quotes are rare but possible).
    const safeWord = row.word.includes(',') || row.word.includes('"')
      ? `"${row.word.replace(/"/g, '""')}"`
      : row.word;

    fs.writeSync(
      fd,
      `${safeWord},${row.language},${f.zipf.toFixed(4)},${f.zipfNorm.toFixed(4)},${f.aoaNorm.toFixed(4)},${f.usedFallback.zipf ? 1 : 0},${f.usedFallback.aoa ? 1 : 0},${row.cefr},${ord},${row.source}\n`
    );
    written++;
    perLang[row.language] = (perLang[row.language] ?? 0) + 1;
    perCefr[row.cefr] = (perCefr[row.cefr] ?? 0) + 1;
  }

  fs.closeSync(fd);

  console.log(`[export-features] wrote ${written} rows → ${outPath} (${skipped} skipped)`);
  console.log('Per language:');
  for (const [k, v] of Object.entries(perLang).sort()) console.log(`  ${k}: ${v}`);
  console.log('Per CEFR:');
  for (const [k, v] of Object.entries(perCefr).sort()) console.log(`  ${k}: ${v}`);
}

main();
