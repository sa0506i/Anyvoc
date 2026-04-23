/**
 * Prompt dispatcher — picks a version-specific builder based on the
 * `version` parameter (or the env-driven default). This is the single
 * entry point the extract.ts / translateSingleWord.ts orchestrators
 * call.
 *
 * Phase 2 Slice 3 (2026-04-23): extracted from the monolithic
 * lib/claude.ts. v1/v2/v3 paths each live in their own file under
 * `./`; this dispatcher keeps the selection logic local and small.
 */
import type { PromptVersion } from '../types';
import { defaultPromptVersion, matrixTranslationTarget } from './shared';
import { buildVocabSystemPromptV1, buildSingleWordPromptV1 } from './v1';
import { buildVocabSystemPromptV2, buildSingleWordPromptV2 } from './v2';
import { buildVocabSystemPromptV3 } from './v3';

export { defaultPromptVersion, matrixTranslationTarget } from './shared';

/** Top-level bulk-extraction prompt builder with version dispatch.
 *  Signature matches the pre-refactor lib/claude.ts export so callers
 *  are unaffected. Default version comes from `defaultPromptVersion()`
 *  which reads `ANYVOC_PROMPT_VERSION`. */
export function buildVocabSystemPrompt(
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: string,
  nativeLanguageCode: string,
  version: PromptVersion = defaultPromptVersion(),
): string {
  if (version === 'v2') {
    return buildVocabSystemPromptV2(
      nativeLanguageName,
      learningLanguageName,
      learningLanguageCode,
      nativeLanguageCode,
    );
  }
  if (version === 'v3') {
    return buildVocabSystemPromptV3(
      nativeLanguageName,
      learningLanguageName,
      learningLanguageCode,
      nativeLanguageCode,
    );
  }
  return buildVocabSystemPromptV1(
    nativeLanguageName,
    learningLanguageName,
    learningLanguageCode,
    nativeLanguageCode,
  );
}

/** Top-level single-word-translation prompt builder with version dispatch.
 *  v3 is routed to v2 here — single-word input has no type-drift risk
 *  that motivated v3, so there is no v3-specific single-word template. */
export function buildTranslateSingleWordPrompt(
  fromLanguageName: string,
  toLanguageName: string,
  fromLanguageCode: string,
  nativeCode: string,
  version: PromptVersion = defaultPromptVersion(),
): string {
  if (version === 'v1') {
    return buildSingleWordPromptV1(fromLanguageName, toLanguageName, fromLanguageCode, nativeCode);
  }
  // v2 AND v3 use the same single-word prompt.
  return buildSingleWordPromptV2(fromLanguageName, toLanguageName, fromLanguageCode, nativeCode);
}
