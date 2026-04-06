/**
 * Smoke test for the Czech classifier across ~100 words of varying
 * difficulty. Same shape as scripts/try-classify-de.ts.
 *
 *   npx tsx scripts/try-classify-cs.ts
 *   npx tsx scripts/try-classify-cs.ts --sort
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

const WORDS: string[] = [
  // --- Expected A1 ---
  'kočka', 'pes', 'dům', 'auto', 'voda', 'chléb', 'matka', 'otec',
  'dítě', 'den', 'noc', 'ruka', 'kniha', 'stůl', 'židle',
  'jíst', 'pít', 'spát', 'jít', 'přijít', 'vidět', 'dobrý', 'špatný',

  // --- Expected A2 ---
  'práce', 'rodina', 'škola', 'přítel', 'peníze', 'čas', 'rok',
  'týden', 'hodina', 'pokoj', 'okno', 'ulice', 'problém', 'otázka',
  'odpověď', 'rozumět', 'vysvětlit', 'platit', 'čekat',

  // --- Expected B1 ---
  'vývoj', 'společnost', 'zkušenost', 'možnost', 'příklad',
  'výsledek', 'význam', 'důvod', 'prostředí', 'vláda',
  'ekonomika', 'vztah', 'dosáhnout', 'rozhodnout', 'očekávat', 'dokázat',

  // --- Expected B2 ---
  'vnímání', 'předpoklad', 'výzva', 'kontext', 'konfrontace',
  'rovnováha', 'chování', 'vlastnost', 'tendence', 'hypotéza',
  'teze', 'argument', 'princip', 'rozmanitost', 'hodnotit',
  'zpochybňovat', 'popírat',

  // --- Expected C1 ---
  'fenomén', 'paradigma', 'diskurz', 'dichotomie', 'empirismus',
  'kauzalita', 'legitimace', 'ambivalence', 'kontingence', 'epistemologie',
  'hermeneutika', 'dialektika', 'konotace', 'konstelace',
  'verifikovat', 'subsumovat', 'filozofie',

  // --- Expected C2 ---
  'epistémé', 'fenomenologie', 'transcendence', 'eschatologie',
  'ontologie', 'soteriologie', 'apokatastáze', 'noumenon',
  'kviddita', 'apriorismus', 'konsubstanciace',
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
  const f = extractFeatures(word, 'cs');
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
