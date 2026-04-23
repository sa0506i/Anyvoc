/**
 * Single-word translation orchestrator — used by the Pro long-press
 * translate flow in the content-detail screen. Takes one word in the
 * learning language, returns the dictionary-base-form translation plus
 * word type and CEFR level.
 *
 * Phase 2 Slice 4 extracted from lib/claude.ts. Behaviour unchanged.
 * Single-word extraction routes v3 → v2 internally because the v3
 * re-balanced-type-emphasis motivation doesn't apply to one-word input.
 */
import { classifyWord, type SupportedLanguage } from '../classifier';
import { postProcessExtractedVocab } from '../vocabFilters';
import { callClaude } from './transport';
import { buildTranslateSingleWordPrompt, defaultPromptVersion } from './prompt';
import type { TranslateSingleWordResult } from './types';

export async function translateSingleWord(
  word: string,
  fromLanguageName: string,
  toLanguageName: string,
  fromLanguageCode: SupportedLanguage,
  toLanguageCode?: string,
): Promise<TranslateSingleWordResult> {
  // CEFR level is determined locally after the translation comes back —
  // the LLM is only responsible for formatting + translation.
  const nativeCode = toLanguageCode ?? 'en';
  const version = defaultPromptVersion();
  const systemPrompt = buildTranslateSingleWordPrompt(
    fromLanguageName,
    toLanguageName,
    fromLanguageCode,
    nativeCode,
    version,
  );

  const result = await callClaude([{ role: 'user', content: word }], systemPrompt, 4096, {
    temperature: 0,
  });

  let parsed: {
    original: string;
    translation: string;
    level: string;
    type: string;
    source_cat?: 'def' | 'indef' | 'bare';
  } = {
    original: word,
    translation: '',
    level: 'B1',
    type: 'other',
  };
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // fallback to default above
  }

  // Slice 3/7: under v1 the LLM isn't asked for source_cat — strip any
  // incidental field so v1 callers get a clean shape.
  if (version === 'v1') {
    delete parsed.source_cat;
  }

  // Post-processing: drop abbreviations / proper nouns and apply German
  // capitalisation when target is German. Architecture rule 21 enforces
  // this call site.
  const post = postProcessExtractedVocab(
    [{ original: parsed.original, translation: parsed.translation, type: parsed.type }],
    fromLanguageCode,
    toLanguageCode ?? '',
  );
  if (post.length === 0) {
    // Edge case: the LLM returned an abbreviation or proper noun. Leave
    // the parsed result as-is so the caller can show it; the UI layer
    // already deduplicates and the word never gets persisted unless the
    // user explicitly confirms.
  } else {
    parsed.translation = post[0].translation;
  }

  // Local deterministic CEFR assignment.
  try {
    parsed.level = await classifyWord(parsed.original || word, fromLanguageCode, callClaude);
  } catch (err) {
    console.warn(
      `[claude] classifyWord failed for "${parsed.original || word}" (${fromLanguageCode}):`,
      (err as Error).message,
    );
    if (!parsed.level) parsed.level = 'B1';
  }

  return parsed;
}
