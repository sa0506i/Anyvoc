/**
 * Smoke test for the Danish classifier across ~100 words of varying
 * difficulty. Same shape as scripts/try-classify-de.ts.
 *
 *   npx tsx scripts/try-classify-da.ts
 *   npx tsx scripts/try-classify-da.ts --sort
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

const WORDS: string[] = [
  // --- Expected A1 ---
  'kat', 'hund', 'hus', 'bil', 'vand', 'brød', 'mor', 'far',
  'barn', 'dag', 'nat', 'hånd', 'bog', 'bord', 'stol',
  'spise', 'drikke', 'sove', 'gå', 'komme', 'se', 'god', 'dårlig',

  // --- Expected A2 ---
  'arbejde', 'familie', 'skole', 'ven', 'penge', 'tid', 'år',
  'uge', 'time', 'værelse', 'vindue', 'gade', 'problem', 'spørgsmål',
  'svar', 'forstå', 'forklare', 'betale', 'vente',

  // --- Expected B1 ---
  'udvikling', 'samfund', 'erfaring', 'mulighed', 'eksempel',
  'resultat', 'betydning', 'grund', 'miljø', 'regering',
  'økonomi', 'forhold', 'opnå', 'beslutte', 'forvente', 'bevise',

  // --- Expected B2 ---
  'opfattelse', 'forudsætning', 'udfordring', 'sammenhæng', 'konfrontation',
  'ligevægt', 'adfærd', 'egenskab', 'tendens', 'hypotese',
  'tese', 'argument', 'princip', 'mangfoldighed', 'bedømme',
  'sætte spørgsmålstegn', 'modsige',

  // --- Expected C1 ---
  'fænomen', 'paradigme', 'diskurs', 'dikotomi', 'empirisme',
  'kausalitet', 'legitimering', 'ambivalens', 'kontingens', 'epistemologi',
  'hermeneutik', 'dialektik', 'konnotation', 'konstellation',
  'verificere', 'subsumere', 'filosofi',

  // --- Expected C2 ---
  'episteme', 'fænomenologi', 'transcendens', 'eskatologi',
  'ontologi', 'soteriologi', 'apokatastasis', 'noumenon',
  'kvidditet', 'apriorisme', 'konsubstantiation',
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
  const f = extractFeatures(word, 'da');
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
