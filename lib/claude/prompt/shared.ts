/**
 * Shared prompt-building utilities used across v1, v2, and v3.
 *
 * Phase 2 Slice 3 (2026-04-23): extracted from lib/claude.ts. Contents
 * unchanged — only the file boundary moved. `buildNounShapeRule` and
 * `buildAdjRule` stayed version-agnostic during the Matrix-Regel
 * rollout because v2/v3 kept the noun-shape / adjective semantics of
 * v1; only the article + translation rules changed.
 *
 * `matrixTranslationTarget` is the Matrix-Regel core used by v2 and v3
 * (v1 doesn't need it — `pickTranslationTarget` below is the v1
 * equivalent kept for v1-path prompt building).
 *
 * `defaultPromptVersion` is the env-var-driven toggle consumed by
 * every caller that doesn't pass an explicit version argument.
 */
import { getLangExamples } from '../langs';
import type { ArticleCategory, PromptVersion } from '../types';

/**
 * Prompt-version toggle for the Matrix-Regel A/B.
 *
 * v2 is the Production default (Slice 7 flip, 2026-04-23). v1 remains
 * available as emergency rollback (env override = 'v1'). v3 is opt-in
 * while its sweep runs (Slice 7b); once validated it takes over. See
 * CLAUDE.md Rule 47 for the full cross-version policy.
 */
export function defaultPromptVersion(): PromptVersion {
  if (process.env.ANYVOC_PROMPT_VERSION === 'v1') return 'v1';
  if (process.env.ANYVOC_PROMPT_VERSION === 'v3') return 'v3';
  return 'v2';
}

/** Builds the "one content word after the article" noun-shape rule
 *  using only the learn-lang counter-example. Unchanged across v1/v2/v3. */
export function buildNounShapeRule(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  const attrExample = ex.attrAdj
    ? ` For ${ex.name}: write "${ex.attrAdj.good}" not "${ex.attrAdj.bad}" (list the adjective as a separate entry if relevant).`
    : '';
  return `- For NOUN entries, "original" must be exactly "article + singular-noun" — a single content word after the article.${attrExample} Multi-word proper nouns (club names, organisation names, broadcaster names) are proper nouns and MUST be omitted entirely.`;
}

/** Builds the adjective rule using only learn-lang examples. Unchanged
 *  across v1/v2 (both use this). v3 re-implements its own version that
 *  carries additional source_cat="bare" guidance. */
export function buildAdjRule(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.adjMFPair) {
    // Romance: m + f pair is legit
    return `- Adjectives: give both masculine and feminine forms when they differ (e.g. "${ex.adjMFPair}" in ${ex.name}).`;
  }
  // All others: single form. Keep a brief counter-example when we have one.
  const counter = ex.adjInflected
    ? ` (e.g. "${ex.adjSingle}" not "${ex.adjSingle}, ${ex.adjInflected}")`
    : ` (e.g. "${ex.adjSingle}")`;
  return `- Adjectives: emit the SINGLE dictionary base form only${counter}. Never pair an adjective with its inflected form — ${ex.name} does NOT inflect adjectives by gender in the dictionary entry.`;
}

/** Translation-target lookup per the user-approved matrix (2026-04-23).
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

/** Picks the correct native-lang example form for a translation based
 *  on the learn-lang's article category. v1-era helper kept here because
 *  the v1 prompt template still references it. v2/v3 use
 *  `matrixTranslationTarget` directly.
 *
 *  F12 fix (2026-04-22): without this dispatch, the translation example
 *  for every combo used nativeEx.nounLemma regardless of learn's category.
 *  For INDEF-learn → def-cat native (e.g. sv→de) this produced "en hund
 *  → der Hund" — indef source mirrored to def target, which directly
 *  contradicted the Mirror rule stated in the same prompt. */
export function pickTranslationTarget(learnCode: string, nativeCode: string): string {
  const learnEx = getLangExamples(learnCode);
  const nativeEx = getLangExamples(nativeCode);
  if (nativeEx.artCat === 'bare') {
    // pl/cs native: always bare (no articles exist)
    return nativeEx.nounLemma;
  }
  if (learnEx.artCat === 'indef' && nativeEx.nounIndef) {
    // Scandi learn → native's indef form (mirror indef category)
    return nativeEx.nounIndef;
  }
  // DEF or BARE learn → native's canonical lemma
  return nativeEx.nounLemma;
}
