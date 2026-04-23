/**
 * v1 prompt builder — pre-Matrix-Regel baseline.
 *
 * Forces DEF article on articled learn langs and INDEF prefix on Scandi,
 * regardless of source-text form. Kept in-source for emergency rollback
 * via `ANYVOC_PROMPT_VERSION=v1`. Phase 2 Slice 3 extracted this
 * verbatim from lib/claude.ts.
 *
 * v1 semantics are byte-frozen — Rule 34 / 41 / 42 architecture
 * sensors depend on specific symbol names (SCANDINAVIAN_NOUN_RULE,
 * SLAVIC_NOUN_RULE, ENGLISH_NOUN_RULE, CRITICAL_NOUN_RULE_BY_LANG,
 * buildTranslationRule) being present verbatim in this file.
 */
import { getLangExamples } from '../langs';
import { buildNounShapeRule, buildAdjRule, pickTranslationTarget } from './shared';

// ─── v1 canonical rule constants ──────────────────────────────────────
// Names are load-bearing for Rule-41 architecture tests.

/** Scandinavian languages mark definiteness with a noun suffix rather than
 *  a prepositive article, so the generic "direct article" rule breaks down.
 *  For da/sv/no we instruct the model to prepend the INDEFINITE article
 *  based on grammatical gender (en/ett/ei), making the output cross-
 *  linguistically comparable. */
export const SCANDINAVIAN_NOUN_RULE = `- IMPORTANT — for Swedish (sv), Norwegian (no), and Danish (da), these languages mark definiteness as a noun SUFFIX, not a prepositive article. In the "original" field, ALWAYS prepend the INDEFINITE article based on grammatical gender: "en" (common gender, sv/no/da), "ett" (neuter, sv), "ei" (feminine, no). Examples: "en artikel", "ett språk" (sv), "ei bok" (no), "en bog" (da). This rule is UNCONDITIONAL — it applies regardless of the native language, regardless of text genre (recipes, news, legal, wikipedia), regardless of how the noun appears in the source text. If the source text has the DEFINITE-SUFFIX form, you MUST still extract the lemma with the indefinite prefix: source "folket" → extract "ett folk" (not "folket"), source "bilden" → extract "en bild" (not "bilden"), source "lagen" → extract "en lag" (not "lagen"), source "hjernen" → extract "en hjerne" (not "hjernen"), source "bogen" → extract "en bog" (not "bogen"). If the source text has the BARE form (common in running text after adjectives, in recipes, or in legal text), you MUST still add the indefinite article: source "respekt" → extract "en respekt", source "bostad" → extract "en bostad", source "utbildning" → extract "en utbildning", source "salt" → extract "ett salt", source "mjölk" → extract "en mjölk". A Scandi noun output WITHOUT "en"/"ett"/"ei" prefix is ALWAYS wrong. This applies even when you are translating into another Scandinavian language, into a Slavic language (pl, cs), into Italian/French/Romance, or into any other native — never, ever, drop the Scandi indefinite article from the "original" field.`;

/** Polish and Czech have no articles at all. */
export const SLAVIC_NOUN_RULE = `- IMPORTANT — for Polish (pl) and Czech (cs), these languages have NO articles at all. In the "original" field, emit nouns in the BARE singular nominative form — NEVER prepend any article or determiner. This applies to SINGLE entries AND to m/f pairs: write "Europejczyk, Europejka" (not "o Europejczyk, Europejka"), "mieszkaniec, mieszkanka" (not "o mieszkaniec, mieszkanka"), "tekst" (not "ten tekst"), "vedení" (not "to vedení"). Never borrow an article from another language (no Portuguese "o"/"a", no German "der"/"die", no English "the"). This OVERRIDES the generic "include article" rule above for these two languages.`;

/** English in v1 always carries "the" for cross-language output shape consistency. */
export const ENGLISH_NOUN_RULE = `- IMPORTANT — for English (en), ALWAYS prepend the definite article "the" to the noun in singular form. Examples: "the house", "the child", "the book". Never emit a bare noun; never use the indefinite articles "a" or "an" in the "original" field (the lemma always takes "the").`;

export const CRITICAL_NOUN_RULE_BY_LANG: Record<string, string> = {
  sv: SCANDINAVIAN_NOUN_RULE,
  no: SCANDINAVIAN_NOUN_RULE,
  da: SCANDINAVIAN_NOUN_RULE,
  pl: SLAVIC_NOUN_RULE,
  cs: SLAVIC_NOUN_RULE,
  en: ENGLISH_NOUN_RULE,
};

// ─── v1 fragment builders ─────────────────────────────────────────────

/** Builds the "- Nouns: …" + "- Verbs: …" pair using only learn-lang
 *  examples (F11 / Rule 46). For indef-category languages (sv/no/da)
 *  the noun line is a no-op — the SCANDINAVIAN_NOUN_RULE block already
 *  covers the canonical indef-prefix convention. For bare-category
 *  languages (pl/cs) the noun line is also a no-op — SLAVIC_NOUN_RULE
 *  covers it. Only def-category languages get a "DEFINITE not
 *  indefinite" line here, and only with their own example. */
export function buildNounVerbRules(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  const lines: string[] = [];
  if (ex.artCat === 'def' && ex.nounIndef) {
    lines.push(
      `- Nouns: ALWAYS include the DEFINITE article before the noun in singular form — never the indefinite. For ${ex.name}: write "${ex.nounLemma}" (not "${ex.nounIndef}", not "${ex.nounBare}"). This is mandatory. If a distinct feminine form exists, add it after a comma.`,
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
    `- Verbs: always the infinitive form — never conjugated, never a past participle. For ${ex.name}: "${ex.verbInf}" (not "${ex.verbWrong}").${reflexiveHint}`,
  );
  return lines.join('\n');
}

/** Builds the CRITICAL FORMATTING header with a single learn-lang example. */
export function buildCriticalHeader(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.artCat === 'bare') {
    return `CRITICAL FORMATTING RULE: Extract each noun in its ${ex.name} dictionary base form. Example: "${ex.nounLemma}".`;
  }
  return `CRITICAL FORMATTING RULE: Every noun MUST include its article. Never write a bare noun without an article. Example for ${ex.name}: "${ex.nounLemma}" (not "${ex.nounBare}").`;
}

/** Builds the translation-side article rule using one learn-lang
 *  source and one native-lang target example. */
export function buildTranslationRule(learnCode: string, nativeCode: string): string {
  const learnEx = getLangExamples(learnCode);
  const nativeEx = getLangExamples(nativeCode);
  const source = learnEx.nounLemma;
  const target = pickTranslationTarget(learnCode, nativeCode);
  const bareNote =
    nativeEx.artCat === 'bare'
      ? `${nativeEx.name} has no articles, so the translation is bare.`
      : `Use the ${nativeEx.name} dictionary form with its article, matching the definiteness category of the original.`;
  return `- "translation" field for NOUN entries: ${bareNote} Example: "${source}" (${learnEx.name}) → "${target}" (${nativeEx.name}).`;
}

/** JSON example for the trailing prompt block — one learn-lang noun +
 *  one native-lang translation pair. */
export function buildJsonExample(learnCode: string, nativeCode: string): string {
  const le = getLangExamples(learnCode);
  const ne = getLangExamples(nativeCode);
  const nounTarget = pickTranslationTarget(learnCode, nativeCode);
  const nounSrcForm = le.nounBare;
  const verbSrcForm = le.verbWrong;
  return `[
  { "original": "${le.nounLemma}", "translation": "${nounTarget}", "level": "", "type": "noun", "source_forms": ["${nounSrcForm}"] },
  { "original": "${le.verbInf}", "translation": "${ne.verbInf}", "level": "", "type": "verb", "source_forms": ["${verbSrcForm}"] },
  { "original": "${le.adjMFPair ?? le.adjSingle}", "translation": "${ne.adjMFPair ?? ne.adjSingle}", "level": "", "type": "adjective", "source_forms": ["${le.adjInflected ?? le.adjSingle}"] },
  { "original": "${le.phraseExample}", "translation": "${ne.phraseExample}", "level": "", "type": "phrase", "source_forms": ["${le.phraseExample}"] }
]`;
}

// ─── v1 top-level prompt templates ────────────────────────────────────

/** Full system prompt for bulk vocabulary extraction under v1. Output
 *  byte-identical to the pre-Slice-2 baseline. */
export function buildVocabSystemPromptV1(
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
- Each distinct word may appear AT MOST ONCE in the output array. Never emit the same entry multiple times even if the source text contains it many times — use "source_forms" to record every occurrence.
- "original" field: the word in ${learningLanguageName}. "translation" field: the translation in ${nativeLanguageName}.
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

/** Full system prompt for single-word translation under v1. */
export function buildSingleWordPromptV1(
  fromLanguageName: string,
  toLanguageName: string,
  fromLanguageCode: string,
  nativeCode: string,
): string {
  const scandiRule = CRITICAL_NOUN_RULE_BY_LANG[fromLanguageCode] ?? '';
  return `You are a language teacher assistant. The user sends a word or phrase in ${fromLanguageName} — it may be inflected, conjugated, or in plural form. Your job: determine the dictionary base form, translate it into ${toLanguageName}, and identify its word type.

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
  "type": "noun|verb|adjective|phrase|other"
}`;
}
