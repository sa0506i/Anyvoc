/**
 * Smoke test for the Dutch classifier across ~100 words of varying
 * difficulty. Same shape as scripts/try-classify-de.ts.
 *
 *   npx tsx scripts/try-classify-nl.ts
 *   npx tsx scripts/try-classify-nl.ts --sort
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

const WORDS: string[] = [
  // --- Expected A1 ---
  'kat', 'hond', 'huis', 'auto', 'water', 'brood', 'moeder', 'vader',
  'kind', 'dag', 'nacht', 'hand', 'boek', 'tafel', 'stoel',
  'de kat', 'het huis', 'eten', 'drinken', 'slapen', 'gaan', 'komen',

  // --- Expected A2 ---
  'werk', 'familie', 'school', 'vriend', 'geld', 'tijd', 'jaar',
  'week', 'uur', 'kamer', 'raam', 'straat', 'probleem', 'vraag',
  'antwoord', 'begrijpen', 'uitleggen', 'betalen', 'wachten',

  // --- Expected B1 ---
  'ontwikkeling', 'samenleving', 'ervaring', 'mogelijkheid', 'voorbeeld',
  'resultaat', 'betekenis', 'reden', 'milieu', 'regering',
  'economie', 'relatie', 'bereiken', 'beslissen', 'verwachten', 'bewijzen',

  // --- Expected B2 ---
  'waarneming', 'voorwaarde', 'uitdaging', 'context', 'confrontatie',
  'evenwicht', 'gedrag', 'kenmerk', 'tendens', 'hypothese',
  'these', 'argument', 'principe', 'diversiteit', 'beoordelen',
  'bevragen', 'tegenspreken',

  // --- Expected C1 ---
  'fenomeen', 'paradigma', 'discours', 'dichotomie', 'empirisme',
  'causaliteit', 'legitimatie', 'ambivalentie', 'contingentie', 'epistemologie',
  'hermeneutiek', 'dialectiek', 'connotatie', 'constellatie',
  'verifiëren', 'subsumeren', 'filosofie',

  // --- Expected C2 ---
  'episteme', 'fenomenologie', 'transcendentie', 'eschatologie',
  'ontologie', 'soteriologie', 'apokatastasis', 'noumenon',
  'quidditeit', 'apriorisme', 'consubstantiatie',
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
  const f = extractFeatures(word, 'nl');
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
