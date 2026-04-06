/**
 * Smoke test for the Swedish classifier across ~100 words of varying
 * difficulty. Same shape as scripts/try-classify-de.ts.
 *
 *   npx tsx scripts/try-classify-sv.ts
 *   npx tsx scripts/try-classify-sv.ts --sort
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

const WORDS: string[] = [
  // --- Expected A1 ---
  'katt', 'hund', 'hus', 'bil', 'vatten', 'bröd', 'mor', 'far',
  'barn', 'dag', 'natt', 'hand', 'bok', 'bord', 'stol',
  'äta', 'dricka', 'sova', 'gå', 'komma', 'se', 'bra', 'dålig',

  // --- Expected A2 ---
  'arbete', 'familj', 'skola', 'vän', 'pengar', 'tid', 'år',
  'vecka', 'timme', 'rum', 'fönster', 'gata', 'problem', 'fråga',
  'svar', 'förstå', 'förklara', 'betala', 'vänta',

  // --- Expected B1 ---
  'utveckling', 'samhälle', 'erfarenhet', 'möjlighet', 'exempel',
  'resultat', 'betydelse', 'orsak', 'miljö', 'regering',
  'ekonomi', 'relation', 'uppnå', 'bestämma', 'förvänta', 'bevisa',

  // --- Expected B2 ---
  'uppfattning', 'förutsättning', 'utmaning', 'sammanhang', 'konfrontation',
  'jämvikt', 'beteende', 'egenskap', 'tendens', 'hypotes',
  'tes', 'argument', 'princip', 'mångfald', 'bedöma',
  'ifrågasätta', 'motsäga',

  // --- Expected C1 ---
  'fenomen', 'paradigm', 'diskurs', 'dikotomi', 'empirism',
  'kausalitet', 'legitimering', 'ambivalens', 'kontingens', 'epistemologi',
  'hermeneutik', 'dialektik', 'konnotation', 'konstellation',
  'verifiera', 'subsumera', 'filosofi',

  // --- Expected C2 ---
  'episteme', 'fenomenologi', 'transcendens', 'eskatologi',
  'ontologi', 'soteriologi', 'apokatastasis', 'noumenon',
  'kvidditet', 'apriorism', 'konsubstantiation',
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
  const f = extractFeatures(word, 'sv');
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
