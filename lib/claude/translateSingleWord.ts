/**
 * Single-word translation orchestrator — used by the Pro long-press
 * translate flow in the content-detail screen. Takes one word in the
 * learning language, returns the dictionary-base-form translation plus
 * word type and CEFR level.
 */
import { classifyWord, type SupportedLanguage } from '../classifier';
import { postProcessExtractedVocab } from '../vocabFilters';
import { ensureIndefArticle } from '../articleEnforcer';
import { callClaude } from './transport';
import { buildTranslateSingleWordPrompt } from './prompt';
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
  const systemPrompt = buildTranslateSingleWordPrompt(
    fromLanguageName,
    toLanguageName,
    fromLanguageCode,
    nativeCode,
  );

  const result = await callClaude([{ role: 'user', content: word }], systemPrompt, 4096, {
    temperature: 0,
  });

  let raw: {
    original?: string;
    translation?: string;
    level?: string;
    type?: string;
  } = {};
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      raw = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // fallback handled below
  }
  const parsed = {
    original: raw.original ?? word,
    translation: raw.translation ?? '',
    level: raw.level ?? 'B1',
    type: raw.type ?? 'other',
  };

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

  // Pure-INDEF safety net (Rule 47): add/normalise the INDEF article on
  // both sides for noun entries. No source-text context here (single-word
  // flow), so we rely on DEF detection + ending heuristics. See
  // lib/articleEnforcer.ts.
  if (parsed.type === 'noun') {
    parsed.original = ensureIndefArticle(parsed.original, [word], word, fromLanguageCode);
    if (toLanguageCode) {
      parsed.translation = ensureIndefArticle(parsed.translation, [], '', toLanguageCode);
    }
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
