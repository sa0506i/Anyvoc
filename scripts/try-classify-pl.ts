/**
 * Smoke test for the Polish classifier across ~100 words of varying
 * difficulty. Same shape as scripts/try-classify-de.ts.
 *
 *   npx tsx scripts/try-classify-pl.ts
 *   npx tsx scripts/try-classify-pl.ts --sort
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

const WORDS: string[] = [
  // --- Expected A1 ---
  'kot', 'pies', 'dom', 'samochód', 'woda', 'chleb', 'matka', 'ojciec',
  'dziecko', 'dzień', 'noc', 'ręka', 'książka', 'stół', 'krzesło',
  'jeść', 'pić', 'spać', 'iść', 'przyjść', 'widzieć', 'dobry', 'zły',

  // --- Expected A2 ---
  'praca', 'rodzina', 'szkoła', 'przyjaciel', 'pieniądze', 'czas', 'rok',
  'tydzień', 'godzina', 'pokój', 'okno', 'ulica', 'problem', 'pytanie',
  'odpowiedź', 'rozumieć', 'wyjaśnić', 'płacić', 'czekać',

  // --- Expected B1 ---
  'rozwój', 'społeczeństwo', 'doświadczenie', 'możliwość', 'przykład',
  'wynik', 'znaczenie', 'powód', 'środowisko', 'rząd',
  'gospodarka', 'związek', 'osiągnąć', 'zdecydować', 'oczekiwać', 'udowodnić',

  // --- Expected B2 ---
  'percepcja', 'warunek wstępny', 'wyzwanie', 'kontekst', 'konfrontacja',
  'równowaga', 'zachowanie', 'cecha', 'tendencja', 'hipoteza',
  'teza', 'argument', 'zasada', 'różnorodność', 'oceniać',
  'kwestionować', 'zaprzeczać',

  // --- Expected C1 ---
  'fenomen', 'paradygmat', 'dyskurs', 'dychotomia', 'empiryzm',
  'przyczynowość', 'legitymizacja', 'ambiwalencja', 'kontyngencja', 'epistemologia',
  'hermeneutyka', 'dialektyka', 'konotacja', 'konstelacja',
  'weryfikować', 'subsumować', 'filozofia',

  // --- Expected C2 ---
  'episteme', 'fenomenologia', 'transcendencja', 'eschatologia',
  'ontologia', 'soteriologia', 'apokatastaza', 'noumen',
  'quidditas', 'aprioryzm', 'konsubstancjacja',
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
  const f = extractFeatures(word, 'pl');
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
