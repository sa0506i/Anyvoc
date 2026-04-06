/**
 * Quick local-only smoke test for the classifier. Bypasses cache + API.
 *   npx tsx scripts/try-classify.ts
 */
import { extractFeatures } from '../lib/classifier/features';
import { scoreDifficulty, difficultyToCefr } from '../lib/classifier/score';

function check(word: string, lang: any) {
  const f = extractFeatures(word, lang);
  const d = scoreDifficulty(f);
  console.log(
    `${word.padEnd(20)} ${lang}  → ${difficultyToCefr(d)}  | zipf=${f.zipf.toFixed(2)}  d=${d.toFixed(3)}  fb=${f.fallbackCount}`
  );
}

check('cat', 'en');
check('the', 'en');
check('philosophy', 'en');
check('quintessential', 'en');
check('xqzpv', 'en');
check('Hund', 'de');
check('der Hund', 'de');
check('Episteme', 'de');
check('Philosophie', 'de');
check('chat', 'fr');
check('le chat', 'fr');
check('chien', 'fr');
check('phénoménologie', 'fr');
