/**
 * Smoke test for the German classifier across 100 words of varying
 * difficulty. Used to inspect the effect of LLM-generated AoA data in
 * lib/data/aoa_de.json — run this before and after `npm run build:aoa-llm
 * -- --lang=de` to see how classification shifts.
 *
 *   npx tsx scripts/try-classify-de.ts
 *   npx tsx scripts/try-classify-de.ts --sort   # sort by difficulty
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

// 100 German words, curated to span A1 → C2. Grouped by expected level
// so the "before AoA" output is easy to eyeball. Includes nouns with
// articles to exercise the article-stripping path.
const WORDS: string[] = [
  // --- Expected A1: very common, concrete, everyday ---
  'Hund', 'Katze', 'Haus', 'Auto', 'Wasser', 'Brot', 'Mutter', 'Vater',
  'Kind', 'Tag', 'Nacht', 'Hand', 'Buch', 'Tisch', 'Stuhl', 'der Hund',
  'die Katze', 'das Haus', 'essen', 'trinken', 'schlafen', 'gehen',

  // --- Expected A2: common, slightly more abstract ---
  'Arbeit', 'Familie', 'Schule', 'Freund', 'Geld', 'Zeit', 'Jahr',
  'Woche', 'Stunde', 'Zimmer', 'Fenster', 'Straße', 'Problem', 'Frage',
  'Antwort', 'verstehen', 'erklären', 'bezahlen', 'warten',

  // --- Expected B1: mid-frequency, more abstract ---
  'Entwicklung', 'Gesellschaft', 'Erfahrung', 'Möglichkeit', 'Beispiel',
  'Ergebnis', 'Bedeutung', 'Grund', 'Bereich', 'Umwelt', 'Regierung',
  'Wirtschaft', 'Beziehung', 'erreichen', 'entscheiden', 'erwarten',
  'beweisen',

  // --- Expected B2: abstract / academic-adjacent ---
  'Wahrnehmung', 'Voraussetzung', 'Herausforderung', 'Zusammenhang',
  'Auseinandersetzung', 'Gleichgewicht', 'Verhaltensweise', 'Eigenschaft',
  'Tendenz', 'Hypothese', 'These', 'Argument', 'Prinzip', 'Vielfalt',
  'beurteilen', 'hinterfragen', 'widersprechen',

  // --- Expected C1: academic, technical ---
  'Phänomen', 'Paradigma', 'Diskurs', 'Dichotomie', 'Empirie',
  'Kausalität', 'Legitimation', 'Ambivalenz', 'Kontingenz', 'Epistemologie',
  'Hermeneutik', 'Dialektik', 'Konnotation', 'Konstellation',
  'verifizieren', 'subsumieren',

  // --- Expected C2: rare, highly specialized ---
  'Episteme', 'Phänomenologie', 'Transzendenz', 'Eschatologie',
  'Ontologie', 'Soteriologie', 'Apokatastasis', 'Noumenon',
  'Quidditas', 'Apriorismus', 'Konsubstantiation',
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
  const f = extractFeatures(word, 'de');
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
