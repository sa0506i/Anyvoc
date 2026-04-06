/**
 * build-norms.ts
 *
 * Converts the Kuperman et al. (2012) Age-of-Acquisition norms into a
 * compact JSON lookup the runtime classifier can read.
 *
 * Kuperman is ENGLISH-ONLY. For other languages, lib/data/aoa_<lang>.json
 * is populated by scripts/build-aoa-llm.ts (Claude Haiku).
 *
 * (Earlier versions of this script also wrote conc_en.json from the
 * Brysbaert et al. (2014) Concreteness ratings. Concreteness has since
 * been removed from the runtime feature vector — see lib/classifier/
 * TODO.md "Resolved" — and the --conc flag has been removed accordingly.)
 *
 * Run:
 *   npm run build:norms -- --aoa=path/to/AoA_ratings.xlsx
 *
 * The CSV/XLSX is not redistributable from this repo. Download from:
 *   AoA  : http://crr.ugent.be/papers/AoA_51715_words.zip   (Kuperman 2012)
 *
 * Expected columns:
 *   XLSX: Word, AoA_Kup
 *   CSV : Word, Rating.Mean (backward compatibility)
 *
 * NEVER wire this into eas-build-pre-install or any other Expo/EAS hook.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as XLSX from 'xlsx';

interface ParsedNorm {
  outName: string;
  data: Record<string, number>;
  count: number;
}

function parseXlsx(
  filePath: string,
  wordCol: string,
  valueCol: string
): Record<string, number> {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (rows.length === 0) return {};
  const headers = Object.keys(rows[0]);
  if (!headers.includes(wordCol) || !headers.includes(valueCol)) {
    throw new Error(
      `Could not find columns "${wordCol}"/"${valueCol}" in ${filePath}. ` +
        `Headers found: ${headers.join(', ')}`
    );
  }
  const out: Record<string, number> = {};
  for (const row of rows) {
    const word = String(row[wordCol] ?? '').trim().toLowerCase();
    const val = parseFloat(String(row[valueCol] ?? ''));
    if (!word || !Number.isFinite(val)) continue;
    out[word] = Math.round(val * 100) / 100;
  }
  return out;
}

function parseDelimited(
  filePath: string,
  wordCol: string,
  valueCol: string,
  delimiter: string
): Record<string, number> {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return {};
  const header = lines[0].split(delimiter).map((h) => h.trim());
  const wordIdx = header.indexOf(wordCol);
  const valIdx = header.indexOf(valueCol);
  if (wordIdx === -1 || valIdx === -1) {
    throw new Error(
      `Could not find columns "${wordCol}"/"${valueCol}" in ${filePath}. ` +
        `Headers found: ${header.join(', ')}`
    );
  }
  const out: Record<string, number> = {};
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delimiter);
    const word = (parts[wordIdx] ?? '').trim().toLowerCase();
    const val = parseFloat(parts[valIdx] ?? '');
    if (!word || !Number.isFinite(val)) continue;
    out[word] = Math.round(val * 100) / 100;
  }
  return out;
}

function buildAoa(inPath: string): ParsedNorm {
  // Kuperman 2012 is published as an XLSX with columns:
  //   Word, Alternative.spelling, Freq_pm, …, AoA_Kup, Perc_known, AoA_Kup_lem, …
  // AoA_Kup = mean age of acquisition from the Mechanical Turk study (scale 2–18).
  // Accepts CSV (with "Rating.Mean") as well for backward compatibility.
  const isXlsx = inPath.toLowerCase().endsWith('.xlsx');
  const data = isXlsx
    ? parseXlsx(inPath, 'Word', 'AoA_Kup')
    : parseDelimited(inPath, 'Word', 'Rating.Mean', ',');
  return { outName: 'aoa_en.json', data, count: Object.keys(data).length };
}

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return null;
}

async function main() {
  const aoaPath = getArg('aoa');

  const outDir = path.resolve(__dirname, '..', 'lib', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  if (!aoaPath) {
    console.warn(
      '[build:norms] No --aoa path provided. Writing empty placeholder JSON ' +
        'so the runtime classifier resolves require() cleanly. Re-run with the CSV ' +
        'path once you have downloaded the norm file (see file header).'
    );
    fs.writeFileSync(path.join(outDir, 'aoa_en.json'), JSON.stringify({ __empty: true, words: {} }));
    return;
  }

  const norm = buildAoa(aoaPath);
  fs.writeFileSync(
    path.join(outDir, norm.outName),
    JSON.stringify({
      __attribution:
        'Kuperman, Stadthagen-Gonzalez & Brysbaert (2012) — AoA ratings for 30,000 English words',
      __scale: '2-18',
      words: norm.data,
    })
  );
  console.log(`[build:norms] AoA: wrote ${norm.count} words → lib/data/${norm.outName}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
