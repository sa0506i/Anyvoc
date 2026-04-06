/**
 * Smoke test for the Spanish classifier across ~100 words of varying
 * difficulty. Same shape as scripts/try-classify-de.ts.
 *
 *   npx tsx scripts/try-classify-es.ts
 *   npx tsx scripts/try-classify-es.ts --sort
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

const WORDS: string[] = [
  // --- Expected A1 ---
  'gato', 'perro', 'casa', 'coche', 'agua', 'pan', 'madre', 'padre',
  'niño', 'día', 'noche', 'mano', 'libro', 'mesa', 'silla',
  'el gato', 'la casa', 'comer', 'beber', 'dormir', 'ir', 'venir',

  // --- Expected A2 ---
  'trabajo', 'familia', 'escuela', 'amigo', 'dinero', 'tiempo', 'año',
  'semana', 'hora', 'habitación', 'ventana', 'calle', 'problema', 'pregunta',
  'respuesta', 'entender', 'explicar', 'pagar', 'esperar',

  // --- Expected B1 ---
  'desarrollo', 'sociedad', 'experiencia', 'posibilidad', 'ejemplo',
  'resultado', 'significado', 'razón', 'medio ambiente', 'gobierno',
  'economía', 'relación', 'alcanzar', 'decidir', 'esperar', 'demostrar',

  // --- Expected B2 ---
  'percepción', 'requisito', 'desafío', 'contexto', 'enfrentamiento',
  'equilibrio', 'comportamiento', 'característica', 'tendencia', 'hipótesis',
  'tesis', 'argumento', 'principio', 'diversidad', 'evaluar',
  'cuestionar', 'contradecir',

  // --- Expected C1 ---
  'fenómeno', 'paradigma', 'discurso', 'dicotomía', 'empirismo',
  'causalidad', 'legitimación', 'ambivalencia', 'contingencia', 'epistemología',
  'hermenéutica', 'dialéctica', 'connotación', 'constelación',
  'verificar', 'subsumir', 'filosofía',

  // --- Expected C2 ---
  'episteme', 'fenomenología', 'trascendencia', 'escatología',
  'ontología', 'soteriología', 'apocatástasis', 'noúmeno',
  'quididad', 'apriorismo', 'consustanciación',
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
  const f = extractFeatures(word, 'es');
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
