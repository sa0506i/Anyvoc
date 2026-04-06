/**
 * Smoke test for the Italian classifier across ~100 words of varying
 * difficulty. Same shape as scripts/try-classify-de.ts.
 *
 *   npx tsx scripts/try-classify-it.ts
 *   npx tsx scripts/try-classify-it.ts --sort
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

const WORDS: string[] = [
  // --- Expected A1 ---
  'gatto', 'cane', 'casa', 'macchina', 'acqua', 'pane', 'madre', 'padre',
  'bambino', 'giorno', 'notte', 'mano', 'libro', 'tavolo', 'sedia',
  'il gatto', 'la casa', 'mangiare', 'bere', 'dormire', 'andare', 'venire',

  // --- Expected A2 ---
  'lavoro', 'famiglia', 'scuola', 'amico', 'denaro', 'tempo', 'anno',
  'settimana', 'ora', 'camera', 'finestra', 'strada', 'problema', 'domanda',
  'risposta', 'capire', 'spiegare', 'pagare', 'aspettare',

  // --- Expected B1 ---
  'sviluppo', 'società', 'esperienza', 'possibilità', 'esempio',
  'risultato', 'significato', 'ragione', 'ambiente', 'governo',
  'economia', 'relazione', 'raggiungere', 'decidere', 'aspettarsi', 'dimostrare',

  // --- Expected B2 ---
  'percezione', 'presupposto', 'sfida', 'contesto', 'confronto',
  'equilibrio', 'comportamento', 'caratteristica', 'tendenza', 'ipotesi',
  'tesi', 'argomento', 'principio', 'diversità', 'valutare',
  'mettere in dubbio', 'contraddire',

  // --- Expected C1 ---
  'fenomeno', 'paradigma', 'discorso', 'dicotomia', 'empirismo',
  'causalità', 'legittimazione', 'ambivalenza', 'contingenza', 'epistemologia',
  'ermeneutica', 'dialettica', 'connotazione', 'costellazione',
  'verificare', 'sussumere', 'filosofia',

  // --- Expected C2 ---
  'episteme', 'fenomenologia', 'trascendenza', 'escatologia',
  'ontologia', 'soteriologia', 'apocatastasi', 'noumeno',
  'quiddità', 'apriorismo', 'consustanziazione',
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
  const f = extractFeatures(word, 'it');
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
