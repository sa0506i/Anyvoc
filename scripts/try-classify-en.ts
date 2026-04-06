/**
 * Smoke test for the English classifier across ~100 words of varying
 * difficulty. Same shape as scripts/try-classify-de.ts.
 *
 *   npx tsx scripts/try-classify-en.ts
 *   npx tsx scripts/try-classify-en.ts --sort
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

const WORDS: string[] = [
  // --- Expected A1: very common, concrete, everyday ---
  'cat', 'dog', 'house', 'car', 'water', 'bread', 'mother', 'father',
  'child', 'day', 'night', 'hand', 'book', 'table', 'chair',
  'eat', 'drink', 'sleep', 'go', 'come', 'see', 'good', 'bad',

  // --- Expected A2: common, slightly more abstract ---
  'work', 'family', 'school', 'friend', 'money', 'time', 'year',
  'week', 'hour', 'room', 'window', 'street', 'problem', 'question',
  'answer', 'understand', 'explain', 'pay', 'wait',

  // --- Expected B1: mid-frequency, more abstract ---
  'development', 'society', 'experience', 'possibility', 'example',
  'result', 'meaning', 'reason', 'environment', 'government',
  'economy', 'relationship', 'achieve', 'decide', 'expect', 'prove',

  // --- Expected B2: abstract / academic-adjacent ---
  'perception', 'prerequisite', 'challenge', 'context', 'confrontation',
  'equilibrium', 'behaviour', 'characteristic', 'tendency', 'hypothesis',
  'thesis', 'argument', 'principle', 'diversity', 'evaluate',
  'question', 'contradict',

  // --- Expected C1: academic, technical ---
  'phenomenon', 'paradigm', 'discourse', 'dichotomy', 'empiricism',
  'causality', 'legitimation', 'ambivalence', 'contingency', 'epistemology',
  'hermeneutics', 'dialectic', 'connotation', 'constellation',
  'verify', 'subsume', 'philosophy',

  // --- Expected C2: rare, highly specialized ---
  'episteme', 'phenomenology', 'transcendence', 'eschatology',
  'ontology', 'soteriology', 'apokatastasis', 'noumenon',
  'quiddity', 'apriorism', 'consubstantiation',
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
  const f = extractFeatures(word, 'en');
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
