/**
 * Smoke test for the French classifier across ~100 words of varying
 * difficulty. Same shape as scripts/try-classify-de.ts.
 *
 *   npx tsx scripts/try-classify-fr.ts
 *   npx tsx scripts/try-classify-fr.ts --sort
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

const WORDS: string[] = [
  // --- Expected A1 ---
  'chat', 'chien', 'maison', 'voiture', 'eau', 'pain', 'mère', 'père',
  'enfant', 'jour', 'nuit', 'main', 'livre', 'table', 'chaise',
  'le chat', 'la maison', 'manger', 'boire', 'dormir', 'aller', 'venir',

  // --- Expected A2 ---
  'travail', 'famille', 'école', 'ami', 'argent', 'temps', 'année',
  'semaine', 'heure', 'chambre', 'fenêtre', 'rue', 'problème', 'question',
  'réponse', 'comprendre', 'expliquer', 'payer', 'attendre',

  // --- Expected B1 ---
  'développement', 'société', 'expérience', 'possibilité', 'exemple',
  'résultat', 'signification', 'raison', 'environnement', 'gouvernement',
  'économie', 'relation', 'atteindre', 'décider', 'attendre', 'prouver',

  // --- Expected B2 ---
  'perception', 'condition', 'défi', 'contexte', 'confrontation',
  'équilibre', 'comportement', 'caractéristique', 'tendance', 'hypothèse',
  'thèse', 'argument', 'principe', 'diversité', 'évaluer',
  'questionner', 'contredire',

  // --- Expected C1 ---
  'phénomène', 'paradigme', 'discours', 'dichotomie', 'empirisme',
  'causalité', 'légitimation', 'ambivalence', 'contingence', 'épistémologie',
  'herméneutique', 'dialectique', 'connotation', 'constellation',
  'vérifier', 'subsumer', 'philosophie',

  // --- Expected C2 ---
  'épistémè', 'phénoménologie', 'transcendance', 'eschatologie',
  'ontologie', 'sotériologie', 'apocatastase', 'noumène',
  'quiddité', 'apriorisme', 'consubstantiation',
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
  const f = extractFeatures(word, 'fr');
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
