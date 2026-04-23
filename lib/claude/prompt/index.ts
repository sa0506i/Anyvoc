/**
 * Top-level prompt builders for bulk extraction + single-word translation.
 *
 * This is the single code path — the A/B variants (v1 pre-Matrix-Regel,
 * v3 re-balanced type emphasis) that lived here during the 2026-04-23
 * rollout are gone; the Matrix-Regel is now _the_ prompt.
 *
 * Consumers:
 *   - `lib/claude/extract.ts` (bulk URL-to-vocab pipeline)
 *   - `lib/claude/translateSingleWord.ts` (Pro long-press flow)
 *   - test fixtures / snapshots / scripts
 */
import { getLangExamples } from '../langs';
import { matrixTranslationTarget, buildNounShapeRule, buildAdjRule } from './shared';
import {
  CRITICAL_NOUN_RULE_BY_LANG,
  buildCriticalHeader,
  buildNounVerbRules,
  buildTranslationRule,
  buildJsonExample,
} from './builders';

export { matrixTranslationTarget } from './shared';
export {
  SCANDINAVIAN_NOUN_RULE,
  SLAVIC_NOUN_RULE,
  ENGLISH_NOUN_RULE,
  CRITICAL_NOUN_RULE_BY_LANG,
  buildCriticalHeader,
  buildNounVerbRules,
  buildTranslationRule,
  buildJsonExample,
} from './builders';

/** Full system prompt for bulk vocabulary extraction. */
export function buildVocabSystemPrompt(
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: string,
  nativeLanguageCode: string,
): string {
  const scandiRule = CRITICAL_NOUN_RULE_BY_LANG[learningLanguageCode] ?? '';
  const verbHint = getLangExamples(learningLanguageCode).verbInf;
  return `You are a language teacher assistant. Extract all meaningful vocabulary from a given text.

${buildCriticalHeader(learningLanguageCode)}

The learning language is ${learningLanguageName}; the native language is ${nativeLanguageName}.

Rules:
- Extract nouns, verbs, adjectives, and fixed expressions. Ignore function words, standalone articles, pronouns, proper nouns, abbreviations, and numbers.
- Proper nouns to ignore include: people's names, cities, countries, brand or product names, titles of works, sports clubs, and broadcaster names. Never include any of these in the output.
- Abbreviations and acronyms to ignore: any all-uppercase token of 2+ letters (e.g. "GNR", "DLRG", "EU"). Never include these in the output.
- Each distinct word may appear AT MOST ONCE in the output array. Never emit the same entry multiple times even if the source text contains it many times — use "source_forms" to record every occurrence. If the source text contains a noun with both definite and indefinite articles, use the article category of the FIRST occurrence for the "original" lemma; all other occurrences go into "source_forms".
- "original" field: the word in ${learningLanguageName}. "translation" field: the translation in ${nativeLanguageName}.
- "source_cat" field: one of "def" | "indef" | "bare" — the article category of the first occurrence (used to validate the translation target). For non-noun entries (verb/adjective/phrase) set source_cat="bare".
${buildNounShapeRule(learningLanguageCode)}
${scandiRule}
${buildNounVerbRules(learningLanguageCode)}
${buildAdjRule(learningLanguageCode)}
${buildTranslationRule(learningLanguageCode, nativeLanguageCode)}
- List every exact word form from the source text (inflected forms, plurals, conjugations) in "source_forms".

"type" must be one of: "noun", "verb", "adjective", "phrase", "other".
Pick the type that matches each extracted word — DO NOT label every entry "noun". Verbs are infinitives (e.g. "${verbHint}"); phrases are multi-word fixed expressions.

Respond exclusively as a JSON array, no additional text. Leave "level" as "".
The example below is shape only — the actual types in your output depend on what is in the source text:
${buildJsonExample(learningLanguageCode, nativeLanguageCode)}`;
}

/** Full system prompt for single-word translation (Pro long-press flow). */
export function buildTranslateSingleWordPrompt(
  fromLanguageName: string,
  toLanguageName: string,
  fromLanguageCode: string,
  nativeCode: string,
): string {
  const scandiRule = CRITICAL_NOUN_RULE_BY_LANG[fromLanguageCode] ?? '';
  return `You are a language teacher assistant. The user sends a word or phrase in ${fromLanguageName} — it may be inflected, conjugated, or in plural form. Your job: determine the dictionary base form, translate it into ${toLanguageName}, identify its word type, and record the article category of the input.

${buildCriticalHeader(fromLanguageCode)}

Formatting rules (apply to BOTH "original" and "translation" fields):
${buildNounShapeRule(fromLanguageCode)}
${scandiRule}
${buildNounVerbRules(fromLanguageCode)}
${buildAdjRule(fromLanguageCode)}
${buildTranslationRule(fromLanguageCode, nativeCode)}

Respond exclusively as a JSON object, with no additional text. Leave the level field as "" — it is set locally after translation:
{
  "original": "... (formatted base form in ${fromLanguageName})",
  "translation": "... (formatted translation in ${toLanguageName})",
  "level": "",
  "type": "noun|verb|adjective|phrase|other",
  "source_cat": "def|indef|bare"
}`;
}
