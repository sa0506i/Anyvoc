/**
 * v2 prompt builder — Matrix-Regel (current Production default).
 *
 * Source-preserving extraction: each noun is extracted in the article
 * category of its first occurrence (DEF / INDEF / bare) and the
 * translation target mirrors via `matrixTranslationTarget`. Shipped
 * 2026-04-23 after the Slice-7 full sweep confirmed the Go/No-Go
 * criteria.
 *
 * Phase 2 Slice 3 extracted this verbatim from lib/claude.ts. Rule 47
 * architecture sensors depend on specific symbol names in this file
 * (SCANDINAVIAN_NOUN_RULE_V2, ENGLISH_NOUN_RULE_V2,
 * CRITICAL_NOUN_RULE_BY_LANG_V2, buildCriticalHeaderV2,
 * buildNounVerbRulesV2, buildTranslationRuleV2, buildJsonExampleV2).
 */
import { getLangExamples } from '../langs';
import { buildNounShapeRule, buildAdjRule, matrixTranslationTarget } from './shared';
import { SLAVIC_NOUN_RULE } from './v1';

// ─── v2 canonical rule constants ──────────────────────────────────────

/** v2 Scandi noun rule — source-preserving per the 2026-04-23 matrix.
 *  Reverses the v1 "ALWAYS prepend INDEFINITE article" normalisation. */
export const SCANDINAVIAN_NOUN_RULE_V2 = `- IMPORTANT — for Swedish (sv), Norwegian (no), and Danish (da), definiteness is marked as a noun SUFFIX, not a prepositive article. Preserve the article category of the FIRST occurrence of each noun:
  • SUFFIX-DEFINITE source (text shows e.g. "hunden", "bogen", "bilden", "folket"): emit as-is with source_cat="def".
  • INDEFINITE-PREFIX source (text shows "en hund", "ett språk", "ei bok"): emit with the prefix, source_cat="indef".
  • BARE source (text shows just "hund", "salt", "mjölk" — typical in recipes, legal text, or after adjectives): prepend the indefinite article by grammatical gender ("en" common / "ett" neuter sv / "ei" feminine no), source_cat="bare".
Never emit a Scandi noun that is bare of BOTH a suffix-definite marker AND an indefinite prefix. Apply this regardless of native language and text genre.`;

/** v2 English noun rule — source-preserving per the 2026-04-23 matrix.
 *  Reverses v1's "always 'the'" enforcement so that "a dog" stays "a dog"
 *  when the source text used the indefinite article. */
export const ENGLISH_NOUN_RULE_V2 = `- IMPORTANT — for English (en), preserve the article category of the FIRST occurrence of each noun:
  • DEF source ("the dog"): emit "the dog" with source_cat="def".
  • INDEF source ("a dog"/"an apple"): emit "a dog" with source_cat="indef".
  • BARE source (headlines "Dog bites man", or bare mass nouns): emit with "a"/"an", source_cat="bare".
Never emit a bare English noun in the "original" field — always carry "the" or "a"/"an".`;

/** v2 lookup. pl/cs reuse SLAVIC_NOUN_RULE (no articles in those langs). */
export const CRITICAL_NOUN_RULE_BY_LANG_V2: Record<string, string> = {
  sv: SCANDINAVIAN_NOUN_RULE_V2,
  no: SCANDINAVIAN_NOUN_RULE_V2,
  da: SCANDINAVIAN_NOUN_RULE_V2,
  pl: SLAVIC_NOUN_RULE,
  cs: SLAVIC_NOUN_RULE,
  en: ENGLISH_NOUN_RULE_V2,
};

// ─── v2 fragment builders ─────────────────────────────────────────────

/** v2 CRITICAL header — source-preserving per learn-lang article system. */
export function buildCriticalHeaderV2(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.artCat === 'bare') {
    return `CRITICAL FORMATTING RULE: Extract each noun in its ${ex.name} dictionary base form. Example: "${ex.nounLemma}".`;
  }
  if (ex.artCat === 'indef') {
    return `CRITICAL FORMATTING RULE: Every ${ex.name} noun MUST be extracted in the form matching its FIRST occurrence in the source — suffix-definite (e.g. "${ex.nounDef}") or indefinite-prefix (e.g. "${ex.nounLemma}"). Bare source forms default to the indefinite prefix.`;
  }
  return `CRITICAL FORMATTING RULE: Every noun MUST include its article, matching the article used at its FIRST occurrence in the source text. Example for ${ex.name}: DEF "${ex.nounLemma}" or INDEF "${ex.nounIndef}". Never emit a bare noun.`;
}

/** v2 noun+verb rule — articled langs preserve source article category. */
export function buildNounVerbRulesV2(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  const lines: string[] = [];
  if (ex.artCat === 'def' && ex.nounIndef) {
    lines.push(
      `- Nouns: extract each noun in singular form with the article matching its FIRST occurrence in the source. For ${ex.name}: DEF source → "${ex.nounLemma}" (source_cat="def"); INDEF source → "${ex.nounIndef}" (source_cat="indef"); bare source (rare, e.g. headlines) → default to "${ex.nounIndef}" with source_cat="bare". If a distinct feminine form exists, add it after a comma.`,
    );
  }
  if (learnCode !== 'de') {
    lines.push(
      `- Write nouns in lowercase consistently, even if they were capitalised in the source text (e.g. at the start of a sentence).`,
    );
  }
  lines.push(
    `- Remove hyphens that come from line breaks (e.g. "Wort-\\ntrennung" → "Worttrennung").`,
  );
  const reflexiveHint = ex.verbReflexive
    ? ` Reflexive verbs carry the pronoun: "${ex.verbReflexive}".`
    : '';
  lines.push(
    `- Verbs: always the infinitive form — never conjugated, never a past participle. For ${ex.name}: "${ex.verbInf}" (not "${ex.verbWrong}").${reflexiveHint} For non-noun entries (verb/adjective/phrase) set source_cat="bare".`,
  );
  return lines.join('\n');
}

/** v2 translation rule — matrix-accurate, shows DEF + INDEF source examples. */
export function buildTranslationRuleV2(learnCode: string, nativeCode: string): string {
  const learnEx = getLangExamples(learnCode);
  const nativeEx = getLangExamples(nativeCode);
  if (nativeEx.artCat === 'bare') {
    return `- "translation" field for NOUN entries: ${nativeEx.name} has no articles — translation is always bare. Example: any ${learnEx.name} source → "${nativeEx.nounBare}".`;
  }
  const defTarget = matrixTranslationTarget('def', nativeCode);
  const indefTarget = matrixTranslationTarget('indef', nativeCode);
  if (learnEx.artCat === 'bare') {
    return `- "translation" field for NOUN entries: ${learnEx.name} has no articles (source is always bare), so translate to the ${nativeEx.name} indefinite form. Example: "${learnEx.nounLemma}" → "${indefTarget}".`;
  }
  const learnDefExample = learnEx.artCat === 'indef' ? learnEx.nounDef! : learnEx.nounLemma;
  const learnIndefExample = learnEx.artCat === 'indef' ? learnEx.nounLemma : learnEx.nounIndef!;
  return `- "translation" field for NOUN entries: mirror the source's article category into ${nativeEx.name}:
  • DEF source ("${learnDefExample}") → "${defTarget}" (${nativeEx.name} def).
  • INDEF source ("${learnIndefExample}") → "${indefTarget}" (${nativeEx.name} indef).
  • BARE source → "${indefTarget}" (${nativeEx.name} indef — bare mirrors to indef).`;
}

/** v2 JSON example — adds source_cat field; DEF-source shape for the noun. */
export function buildJsonExampleV2(learnCode: string, nativeCode: string): string {
  const le = getLangExamples(learnCode);
  const ne = getLangExamples(nativeCode);
  let sourceCat: 'def' | 'indef' | 'bare';
  let learnNoun: string;
  if (le.artCat === 'bare') {
    sourceCat = 'bare';
    learnNoun = le.nounLemma;
  } else if (le.artCat === 'indef') {
    sourceCat = 'def';
    learnNoun = le.nounDef ?? le.nounLemma;
  } else {
    sourceCat = 'def';
    learnNoun = le.nounLemma;
  }
  const nounTarget = matrixTranslationTarget(sourceCat, nativeCode);
  const nounSrcForm = le.nounBare;
  const verbSrcForm = le.verbWrong;
  return `[
  { "original": "${learnNoun}", "translation": "${nounTarget}", "level": "", "type": "noun", "source_cat": "${sourceCat}", "source_forms": ["${nounSrcForm}"] },
  { "original": "${le.verbInf}", "translation": "${ne.verbInf}", "level": "", "type": "verb", "source_cat": "bare", "source_forms": ["${verbSrcForm}"] },
  { "original": "${le.adjMFPair ?? le.adjSingle}", "translation": "${ne.adjMFPair ?? ne.adjSingle}", "level": "", "type": "adjective", "source_cat": "bare", "source_forms": ["${le.adjInflected ?? le.adjSingle}"] },
  { "original": "${le.phraseExample}", "translation": "${ne.phraseExample}", "level": "", "type": "phrase", "source_cat": "bare", "source_forms": ["${le.phraseExample}"] }
]`;
}

// ─── v2 top-level prompt templates ────────────────────────────────────

/** Full system prompt for bulk vocabulary extraction under v2. */
export function buildVocabSystemPromptV2(
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: string,
  nativeLanguageCode: string,
): string {
  const scandiRuleV2 = CRITICAL_NOUN_RULE_BY_LANG_V2[learningLanguageCode] ?? '';
  const verbHint = getLangExamples(learningLanguageCode).verbInf;
  return `You are a language teacher assistant. Extract all meaningful vocabulary from a given text.

${buildCriticalHeaderV2(learningLanguageCode)}

The learning language is ${learningLanguageName}; the native language is ${nativeLanguageName}.

Rules:
- Extract nouns, verbs, adjectives, and fixed expressions. Ignore function words, standalone articles, pronouns, proper nouns, abbreviations, and numbers.
- Proper nouns to ignore include: people's names, cities, countries, brand or product names, titles of works, sports clubs, and broadcaster names. Never include any of these in the output.
- Abbreviations and acronyms to ignore: any all-uppercase token of 2+ letters (e.g. "GNR", "DLRG", "EU"). Never include these in the output.
- Each distinct word may appear AT MOST ONCE in the output array. Never emit the same entry multiple times even if the source text contains it many times — use "source_forms" to record every occurrence. If the source text contains a noun with both definite and indefinite articles, use the article category of the FIRST occurrence for the "original" lemma; all other occurrences go into "source_forms".
- "original" field: the word in ${learningLanguageName}. "translation" field: the translation in ${nativeLanguageName}.
- "source_cat" field: one of "def" | "indef" | "bare" — the article category of the first occurrence (used to validate the translation target). For non-noun entries (verb/adjective/phrase) set source_cat="bare".
${buildNounShapeRule(learningLanguageCode)}
${scandiRuleV2}
${buildNounVerbRulesV2(learningLanguageCode)}
${buildAdjRule(learningLanguageCode)}
${buildTranslationRuleV2(learningLanguageCode, nativeLanguageCode)}
- List every exact word form from the source text (inflected forms, plurals, conjugations) in "source_forms".

"type" must be one of: "noun", "verb", "adjective", "phrase", "other".
Pick the type that matches each extracted word — DO NOT label every entry "noun". Verbs are infinitives (e.g. "${verbHint}"); phrases are multi-word fixed expressions.

Respond exclusively as a JSON array, no additional text. Leave "level" as "".
The example below is shape only — the actual types in your output depend on what is in the source text:
${buildJsonExampleV2(learningLanguageCode, nativeLanguageCode)}`;
}

/** Full system prompt for single-word translation under v2. */
export function buildSingleWordPromptV2(
  fromLanguageName: string,
  toLanguageName: string,
  fromLanguageCode: string,
  nativeCode: string,
): string {
  const scandiRuleV2 = CRITICAL_NOUN_RULE_BY_LANG_V2[fromLanguageCode] ?? '';
  return `You are a language teacher assistant. The user sends a word or phrase in ${fromLanguageName} — it may be inflected, conjugated, or in plural form. Your job: determine the dictionary base form, translate it into ${toLanguageName}, identify its word type, and record the article category of the input.

${buildCriticalHeaderV2(fromLanguageCode)}

Formatting rules (apply to BOTH "original" and "translation" fields):
${buildNounShapeRule(fromLanguageCode)}
${scandiRuleV2}
${buildNounVerbRulesV2(fromLanguageCode)}
${buildAdjRule(fromLanguageCode)}
${buildTranslationRuleV2(fromLanguageCode, nativeCode)}

Respond exclusively as a JSON object, with no additional text. Leave the level field as "" — it is set locally after translation:
{
  "original": "... (formatted base form in ${fromLanguageName})",
  "translation": "... (formatted translation in ${toLanguageName})",
  "level": "",
  "type": "noun|verb|adjective|phrase|other",
  "source_cat": "def|indef|bare"
}`;
}
