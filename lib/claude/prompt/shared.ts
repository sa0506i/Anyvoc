/**
 * Shared prompt-building utilities — language-agnostic helpers used by
 * both the bulk-extraction prompt (`index.ts`) and the fragment
 * builders (`builders.ts`).
 *
 * Pure-INDEF extraction (Rule 47, revised 2026-04-24): the three-way
 * source-article branching collapsed to a single native-indef target.
 * The prior per-entry article-category metadata has been removed from
 * the prompt, the LLM output, and the sweep metric input.
 */
import { getLangExamples } from '../langs';

/** Builds the "one content word after the article" noun-shape rule
 *  using only the learn-lang counter-example. */
export function buildNounShapeRule(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  const attrExample = ex.attrAdj
    ? ` For ${ex.name}: write "${ex.attrAdj.good}" not "${ex.attrAdj.bad}" (list the adjective as a separate entry if relevant).`
    : '';
  return `- For NOUN entries, "original" must be exactly "article + singular-noun" — a single content word after the article.${attrExample} Multi-word proper nouns (club names, organisation names, broadcaster names) are proper nouns and MUST be omitted entirely.`;
}

/** Builds the adjective rule using only learn-lang examples. Romance
 *  langs emit a masculine/feminine pair; everyone else emits a single
 *  dictionary base form. */
export function buildAdjRule(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.adjMFPair) {
    return `- Adjectives: give both masculine and feminine forms when they differ (e.g. "${ex.adjMFPair}" in ${ex.name}).`;
  }
  const counter = ex.adjInflected
    ? ` (e.g. "${ex.adjSingle}" not "${ex.adjSingle}, ${ex.adjInflected}")`
    : ` (e.g. "${ex.adjSingle}")`;
  return `- Adjectives: emit the SINGLE dictionary base form only${counter}. Never pair an adjective with its inflected form — ${ex.name} does NOT inflect adjectives by gender in the dictionary entry.`;
}

/** Translation-target lookup under pure-INDEF extraction (Rule 47 revised).
 *
 *  Returns the native language's indefinite form for the noun example:
 *   - Articleless native (pl/cs): `nounBare` — articleless all the way.
 *   - Scandi native (sv/no/da): `nounLemma` — this IS the INDEF-prefix
 *     lemma "en hund" in those profiles.
 *   - Articled native (de/fr/es/it/pt/nl/en): `nounIndef` — "ein Hund" /
 *     "un chien" / "a dog" / etc.
 */
export function nativeIndefTarget(nativeCode: string): string {
  const n = getLangExamples(nativeCode);
  if (n.artCat === 'bare') return n.nounBare;
  if (n.artCat === 'indef') return n.nounLemma; // Scandi INDEF-prefix lemma
  return n.nounIndef!; // articled native
}
