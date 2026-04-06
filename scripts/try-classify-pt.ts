/**
 * Smoke test for the Portuguese classifier across ~100 words of varying
 * difficulty. Same shape as scripts/try-classify-de.ts.
 *
 *   npx tsx scripts/try-classify-pt.ts
 *   npx tsx scripts/try-classify-pt.ts --sort
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

const WORDS: string[] = [
  // --- Expected A1 ---
  'gato', 'cão', 'casa', 'carro', 'água', 'pão', 'mãe', 'pai',
  'criança', 'dia', 'noite', 'mão', 'livro', 'mesa', 'cadeira',
  'o gato', 'a casa', 'comer', 'beber', 'dormir', 'ir', 'vir',

  // --- Expected A2 ---
  'trabalho', 'família', 'escola', 'amigo', 'dinheiro', 'tempo', 'ano',
  'semana', 'hora', 'quarto', 'janela', 'rua', 'problema', 'pergunta',
  'resposta', 'entender', 'explicar', 'pagar', 'esperar',

  // --- Expected B1 ---
  'desenvolvimento', 'sociedade', 'experiência', 'possibilidade', 'exemplo',
  'resultado', 'significado', 'razão', 'ambiente', 'governo',
  'economia', 'relação', 'alcançar', 'decidir', 'esperar', 'provar',

  // --- Expected B2 ---
  'percepção', 'pressuposto', 'desafio', 'contexto', 'confronto',
  'equilíbrio', 'comportamento', 'característica', 'tendência', 'hipótese',
  'tese', 'argumento', 'princípio', 'diversidade', 'avaliar',
  'questionar', 'contradizer',

  // --- Expected C1 ---
  'fenómeno', 'paradigma', 'discurso', 'dicotomia', 'empirismo',
  'causalidade', 'legitimação', 'ambivalência', 'contingência', 'epistemologia',
  'hermenêutica', 'dialética', 'conotação', 'constelação',
  'verificar', 'subsumir', 'filosofia',

  // --- Expected C2 ---
  'episteme', 'fenomenologia', 'transcendência', 'escatologia',
  'ontologia', 'soteriologia', 'apocatástase', 'númeno',
  'quididade', 'apriorismo', 'consubstanciação',
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
  const f = extractFeatures(word, 'pt');
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
