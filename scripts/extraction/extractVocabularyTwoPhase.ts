/**
 * Composer for the two-phase extraction validation tool.
 *
 * DEV-ONLY. Same scope note as extractTerms.ts / translateTerms.ts:
 * this module lives under scripts/, is not part of the production
 * bundle, and must never be imported from app/, components/, hooks/,
 * constants/, or lib/.
 *
 * Public signature matches lib/claude.ts's `extractVocabulary` so the
 * sweep script can drop this in as a comparison backend via --mode=
 * two-phase. It does NOT replace the production path.
 *
 * Internally:
 *   1. Phase 1 — `extractTerms(text, learningLang)`  (native-agnostic,
 *                                                     cached per text+lang)
 *   2. Phase 2 — `translateTerms(terms, from, to)`    (per-native)
 *   3. Classifier — assigns CEFR per term (native-independent)
 *   4. `postProcessExtractedVocab` — final DE-capitalisation pass
 *
 * The filtering/dedup in postProcessExtractedVocab runs twice overall
 * (inside extractTerms and once more here), which is cheap and
 * idempotent. The second pass only does real work for native=de.
 */

import { callClaude, type ExtractedVocab } from '../../lib/claude';
import { classifyWord, type SupportedLanguage } from '../../lib/classifier';
import { postProcessExtractedVocab } from '../../lib/vocabFilters';
import { extractTerms, type ExtractedTerm } from './extractTerms';
import { translateTerms } from './translateTerms';

/** In-memory Phase-1 cache keyed on (text-hash, learningLang). Phase 1
 *  is native-agnostic by design — if the same text + learning language
 *  are processed N times with different natives, we should only extract
 *  terms ONCE. That's the architectural win that drives Cross-Native
 *  Jaccard toward 1.0. The cache is process-scoped (cleared on reload)
 *  and module-level so the sweep script can benefit without wiring a
 *  persistent store. */
const termCache = new Map<string, ExtractedTerm[]>();

function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function extractTermsCached(
  text: string,
  learningLanguageName: string,
  learningLanguageCode: SupportedLanguage,
): Promise<ExtractedTerm[]> {
  const key = `${learningLanguageCode}:${djb2Hash(text)}`;
  const cached = termCache.get(key);
  if (cached) return cached;
  const terms = await extractTerms(text, learningLanguageName, learningLanguageCode);
  termCache.set(key, terms);
  return terms;
}

/** Test / script hook: clear the in-memory Phase-1 cache. Used to
 *  disable cache hits when measuring single-run Phase-1 variance. */
export function __clearExtractionCacheForTests(): void {
  termCache.clear();
}

export async function extractVocabularyTwoPhase(
  text: string,
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: SupportedLanguage,
  nativeLanguageCode?: string,
): Promise<ExtractedVocab[]> {
  // Phase 1: native-agnostic term extraction (+ internal filter/dedup).
  // Cached on (text-hash, learn) so repeat calls for different natives
  // share the SAME term list — the architectural lever that drives
  // cross-native determinism in the spike.
  const terms = await extractTermsCached(text, learningLanguageName, learningLanguageCode);
  if (terms.length === 0) return [];

  // Phase 2: translate the fixed term list into the target native.
  const translations = await translateTerms(
    terms,
    learningLanguageName,
    nativeLanguageName,
    nativeLanguageCode ?? '',
  );

  // Merge into ExtractedVocab shape.
  const merged: ExtractedVocab[] = terms.map((t) => ({
    original: t.original,
    translation: translations.get(t.original) ?? '',
    level: '',
    type: t.type,
    source_forms: t.source_forms,
  }));

  // Second pass: DE-capitalisation of translations (if native=de).
  // The filter/dedup passes are no-ops here because Phase 1 already
  // cleaned the terms, but we keep the call so any future post-step
  // (e.g. translation-level dedup) has a single integration point.
  const processed = postProcessExtractedVocab(
    merged,
    learningLanguageCode,
    nativeLanguageCode ?? '',
  );

  // Classifier — same deterministic native-agnostic classifier as the
  // monolithic path. Falls back to B1 on error, matching existing
  // behaviour.
  for (const v of processed) {
    try {
      v.level = await classifyWord(v.original, learningLanguageCode, callClaude);
    } catch (err) {
      console.warn(
        `[extractVocabularyTwoPhase] classifyWord failed for "${v.original}" (${learningLanguageCode}):`,
        (err as Error).message,
      );
      v.level = 'B1';
    }
  }

  return processed;
}
