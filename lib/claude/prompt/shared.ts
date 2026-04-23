/**
 * Shared prompt-building utilities — language-agnostic helpers used by
 * both the bulk-extraction prompt (`index.ts`) and the fragment
 * builders (`builders.ts`).
 *
 * Post-cleanup (2026-04-23): what lived here during the Matrix-Regel
 * A/B (v1/v2/v3 variants) has been trimmed to the three utilities
 * the single production prompt still needs:
 * matrixTranslationTarget, buildNounShapeRule, buildAdjRule.
 */
import { getLangExamples } from '../langs';
import type { ArticleCategory } from '../types';

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

/** Translation-target lookup per the user-approved 2026-04-23 matrix.
 *
 *  Given the article category of the source-language occurrence of a noun
 *  (`'def' | 'indef' | 'bare'`), return the translation target in the
 *  native language that matches that category's convention.
 *
 *  Rule (see `lib/__tests__/matrix-rule.test.ts` for the 12×3 ground truth):
 *   - Articleless native (pl/cs): always `nounBare` — these languages have
 *     no articles at all, so the native target is bare regardless of source.
 *   - DEF source → native's definite form. For articled natives this is
 *     `nounLemma` (which carries the DEF article in those profiles, e.g.
 *     "der Hund"); for Scandi natives this is `nounDef` (the suffix-definite
 *     form "hunden") which differs from their INDEF-prefix `nounLemma`.
 *   - INDEF or BARE source → native's indefinite form. For articled natives
 *     this is `nounIndef` ("ein Hund"); for Scandi natives this is
 *     `nounLemma` (already the INDEF-prefix lemma "en hund"). BARE mirrors
 *     to INDEF per the user comment attached to the matrix ("Fuer BARE
 *     (pl,cs), wird immer auf indef uebersetzt").
 */
export function matrixTranslationTarget(sourceCat: ArticleCategory, nativeCode: string): string {
  const n = getLangExamples(nativeCode);
  if (n.artCat === 'bare') return n.nounBare; // articleless native
  if (sourceCat === 'def') {
    // Scandi natives use the suffix-definite form; articled natives' lemma IS def.
    return n.artCat === 'indef' ? n.nounDef! : n.nounLemma;
  }
  // INDEF or BARE source → native's indefinite form.
  return n.artCat === 'indef' ? n.nounLemma : n.nounIndef!;
}
