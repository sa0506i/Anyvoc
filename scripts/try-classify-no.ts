/**
 * Smoke test for the Norwegian classifier across ~100 words of varying
 * difficulty. Same shape as scripts/try-classify-de.ts.
 *
 *   npx tsx scripts/try-classify-no.ts
 *   npx tsx scripts/try-classify-no.ts --sort
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

const WORDS: string[] = [
  // --- Expected A1 ---
  'katt', 'hund', 'hus', 'bil', 'vann', 'brød', 'mor', 'far',
  'barn', 'dag', 'natt', 'hånd', 'bok', 'bord', 'stol',
  'spise', 'drikke', 'sove', 'gå', 'komme', 'se', 'bra', 'dårlig',

  // --- Expected A2 ---
  'arbeid', 'familie', 'skole', 'venn', 'penger', 'tid', 'år',
  'uke', 'time', 'rom', 'vindu', 'gate', 'problem', 'spørsmål',
  'svar', 'forstå', 'forklare', 'betale', 'vente',

  // --- Expected B1 ---
  'utvikling', 'samfunn', 'erfaring', 'mulighet', 'eksempel',
  'resultat', 'betydning', 'grunn', 'miljø', 'regjering',
  'økonomi', 'forhold', 'oppnå', 'bestemme', 'forvente', 'bevise',

  // --- Expected B2 ---
  'oppfatning', 'forutsetning', 'utfordring', 'sammenheng', 'konfrontasjon',
  'likevekt', 'oppførsel', 'egenskap', 'tendens', 'hypotese',
  'tese', 'argument', 'prinsipp', 'mangfold', 'bedømme',
  'stille spørsmål', 'motsi',

  // --- Expected C1 ---
  'fenomen', 'paradigme', 'diskurs', 'dikotomi', 'empirisme',
  'kausalitet', 'legitimering', 'ambivalens', 'kontingens', 'epistemologi',
  'hermeneutikk', 'dialektikk', 'konnotasjon', 'konstellasjon',
  'verifisere', 'subsumere', 'filosofi',

  // --- Expected C2 ---
  'episteme', 'fenomenologi', 'transcendens', 'eskatologi',
  'ontologi', 'soteriologi', 'apokatastasis', 'noumenon',
  'kvidditet', 'apriorisme', 'konsubstansiasjon',
];

function pad(s: string, n: number) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

interface Row {
  word: string;
  zipf: number;
  aoaNorm: number;
  usedAoaFallback: boolean;
  difficulty: number;
  level: string;
  fb: number;
}

function classify(word: string): Row {
  const f = extractFeatures(word, 'no');
  const d = scoreDifficulty(f);
  return {
    word,
    zipf: f.zipf,
    aoaNorm: f.aoaNorm,
    usedAoaFallback: f.usedFallback.aoa,
    difficulty: d,
    level: difficultyToCefr(d),
    fb: f.fallbackCount,
  };
}

function main() {
  const sort = process.argv.includes('--sort');
  const rows = WORDS.map(classify);
  if (sort) rows.sort((a, b) => a.difficulty - b.difficulty);

  const header =
    `${pad('word', 22)} ${pad('level', 6)} ${pad('zipf', 6)} ${pad('aoaN', 6)} ${pad('aoa?', 6)} ${pad('d', 6)} fb`;
  console.log(header);
  console.log('-'.repeat(header.length));

  const counts: Record<string, number> = {};
  for (const r of rows) {
    counts[r.level] = (counts[r.level] ?? 0) + 1;
    console.log(
      `${pad(r.word, 22)} ${pad(r.level, 6)} ${pad(r.zipf.toFixed(2), 6)} ${pad(r.aoaNorm.toFixed(2), 6)} ${pad(r.usedAoaFallback ? 'fallb' : 'real', 6)} ${pad(r.difficulty.toFixed(3), 6)} ${r.fb}`
    );
  }

  console.log('-'.repeat(header.length));
  const realAoa = rows.filter((r) => !r.usedAoaFallback).length;
  console.log(
    `Distribution: ${Object.entries(counts).sort().map(([k, v]) => `${k}=${v}`).join('  ')}`
  );
  console.log(
    `AoA coverage: ${realAoa}/${rows.length} words have real AoA data (rest uses 1-zipfNorm fallback)`
  );
}

main();
