/**
 * v3 prompt builder — re-balanced type emphasis + tightened Scandi
 * mirror + mass-noun bare allowance.
 *
 * Slice 7b.3 (2026-04-23): v3 addresses three v2 regressions surfaced
 * by the full sweep — noun-over-classification drift on noun-dense
 * text, Scandi-INDEF → articled-native DEF dictionary-lemma drift, and
 * mass-noun stilted-translation outputs. Delivered as opt-in; the v3
 * sweep (Slice 7b.4) found a counter-regression in Scandi prefix
 * compliance where the mass-noun allowance leaked into source
 * extraction. Slice 7c iterates on this. Not the current default.
 *
 * Phase 2 Slice 3 extracted this verbatim from lib/claude.ts. See
 * docs/superpowers/specs/2026-04-23-phase1-v2-vs-v3-ab.md for the
 * full v3 Go/No-Go.
 */
import { getLangExamples } from '../langs';
import { matrixTranslationTarget } from './shared';
import { SLAVIC_NOUN_RULE } from './v1';
import { buildCriticalHeaderV2, buildJsonExampleV2 } from './v2';

// ─── v3 canonical rule constants ──────────────────────────────────────

/** v3 Scandi noun rule — source-preserving with anti-regression clause.
 *
 *  Slice 7c (2026-04-23): the v3 sweep exposed that v3's translation-side
 *  mass-noun allowance ("abstract nouns may be bare in the target")
 *  leaked into source extraction — 41% of Scandi nouns came out bare
 *  instead of with the required en/ett/ei/et prefix, a 28 pp regression
 *  vs v2. The fix is a tightly-scoped anti-regression sentence on the
 *  ORIGINAL-field side of the rule: abstract meanings do NOT exempt
 *  Scandi nouns from the prefix requirement. Mass-noun allowance is
 *  strictly a translation-target concern, handled in
 *  buildTranslationRuleV3 via a separate TARGET-SIDE EXCEPTION block. */
export const SCANDINAVIAN_NOUN_RULE_V3 = `Scandi languages mark definiteness as a SUFFIX (sv/no/da). Extract each noun in the form matching its FIRST occurrence in the source:
  (a) SUFFIX-DEFINITE in text (e.g. "hunden", "bogen", "folket") → emit as-is, source_cat="def".
  (b) INDEF-PREFIX in text (e.g. "en hund", "ett språk", "ei bok", "et år") → emit with prefix, source_cat="indef".
  (c) BARE in text (recipes, legal, after adjectives) → prepend indefinite by gender: "en" (common sg/pl), "ett" (sv neuter), "et" (no/da neuter), "ei" (no feminine). source_cat="bare".
Never emit a Scandi noun that carries neither a suffix-definite marker nor an indefinite prefix. ABSTRACT Scandi nouns (respekt, språk, ansvar, frihet, likestilling, demokrati, kompetanse) ARE STILL subject to this rule — there is NO exception for abstract meanings in the ORIGINAL field. A Slice-7b.4 sweep regression: the mass-noun exception only applies to the TRANSLATION target, never to the source-side lemma.`;

/** v3 English noun rule — same source-preserving logic as v2, compact. */
export const ENGLISH_NOUN_RULE_V3 = `English (en) nouns: preserve article category of the FIRST occurrence. DEF "the dog" (source_cat="def"), INDEF "a dog"/"an apple" (source_cat="indef"), bare source → default to "a"/"an" (source_cat="bare"). Never emit a bare English noun in the "original" field.`;

export const CRITICAL_NOUN_RULE_BY_LANG_V3: Record<string, string> = {
  sv: SCANDINAVIAN_NOUN_RULE_V3,
  no: SCANDINAVIAN_NOUN_RULE_V3,
  da: SCANDINAVIAN_NOUN_RULE_V3,
  pl: SLAVIC_NOUN_RULE,
  cs: SLAVIC_NOUN_RULE,
  en: ENGLISH_NOUN_RULE_V3,
};

// ─── v3 fragment builders ─────────────────────────────────────────────

/** v3 noun rule — compact 3-case rule per learn-lang article system.
 *  Scandi defers to SCANDINAVIAN_NOUN_RULE_V3 via the outer template. */
export function buildNounRuleV3(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.artCat === 'bare') {
    return `Emit each noun in its ${ex.name} bare singular nominative base form (e.g. "${ex.nounLemma}"). ${ex.name} has no articles.`;
  }
  if (ex.artCat === 'indef') {
    return `Preserve the article category of the FIRST occurrence: suffix-definite (e.g. "${ex.nounDef}" = source_cat="def"), indefinite-prefix (e.g. "${ex.nounLemma}" = source_cat="indef"), or bare source → prepend indefinite (source_cat="bare"). See Scandi-specific rule block below for the full suffix / prefix / gender detail.`;
  }
  return `Preserve the article category of the FIRST occurrence. ${ex.name}: DEF "${ex.nounLemma}" (source_cat="def"), INDEF "${ex.nounIndef}" (source_cat="indef"), or bare source → default to "${ex.nounIndef}" (source_cat="bare"). If a distinct feminine form exists, add it after a comma.`;
}

/** v3 verb rule — instructs imperative/conjugated/participle forms to
 *  be NORMALISED to infinitive, not skipped. The "never conjugated"
 *  phrasing in v2 was observed to trigger skip-the-verb behaviour on
 *  recipe imperative text (Italian carbonara: 0 verbs extracted). */
export function buildVerbRuleV3(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  const reflexive = ex.verbReflexive
    ? ` Reflexive verbs carry the pronoun: "${ex.verbReflexive}".`
    : '';
  return `Every verb that appears in the source — regardless of its surface form (conjugated, past participle, imperative, gerund, subjunctive, …) — MUST be extracted as its INFINITIVE lemma in the "original" field. Do NOT skip verbs because they appear in a non-infinitive form; normalise them. ${ex.name}: "${ex.verbInf}" (never "${ex.verbWrong}", never any tense / person / mood surface form).${reflexive} For every verb entry set source_cat="bare". Imperatives in recipes, instructions, and directives count as verbs — extract their infinitive lemma.`;
}

/** v3 adjective rule — mirrors v2 logic but promoted to its own block. */
export function buildAdjRuleV3(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.adjMFPair) {
    return `Give BOTH masculine AND feminine forms when they differ in ${ex.name} (e.g. "${ex.adjMFPair}"). Romance languages inflect by gender; never drop one form. For every adjective entry set source_cat="bare".`;
  }
  const counter = ex.adjInflected
    ? ` (e.g. "${ex.adjSingle}" not "${ex.adjSingle}, ${ex.adjInflected}" — inflected forms belong in source_forms)`
    : ` (e.g. "${ex.adjSingle}")`;
  return `Emit the SINGLE dictionary base form only${counter}. ${ex.name} does not inflect adjectives by gender at the lexeme level. For every adjective entry set source_cat="bare".`;
}

/** v3 phrase rule — new dedicated block, gates on "multi-word fixed
 *  expression" so the LLM doesn't dump full sentences. */
export function buildPhraseRuleV3(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  return `Extract multi-word fixed expressions (idioms, collocations, set phrases) only. Example for ${ex.name}: "${ex.phraseExample}". Do NOT emit full sentences or clauses. For every phrase entry set source_cat="bare".`;
}

/** v3 CRITICAL header — identical to v2 logic, alias for clarity. */
export function buildCriticalHeaderV3(learnCode: string): string {
  return buildCriticalHeaderV2(learnCode);
}

/** v3 translation rule — Slice 7c tightened version.
 *
 *  The mass-noun allowance that leaked into source extraction under the
 *  Slice-7b.3 v3 sweep is now isolated into an explicit TARGET-SIDE
 *  EXCEPTION block rendered SEPARATELY from the main mirror rule. The
 *  wording is unambiguous: "translation-target only", "does not affect
 *  the original field". This pairs with the anti-regression sentence
 *  appended to SCANDINAVIAN_NOUN_RULE_V3 (both sides of the prompt
 *  reinforce each other). The other two v3 wins (strict Scandi-INDEF
 *  mirror + type-balance from the template structure) are unchanged. */
export function buildTranslationRuleV3(learnCode: string, nativeCode: string): string {
  const learnEx = getLangExamples(learnCode);
  const nativeEx = getLangExamples(nativeCode);

  if (nativeEx.artCat === 'bare') {
    // Articleless native (pl/cs) — bare translation, no exception needed.
    return `${nativeEx.name} has no articles. Translation is always bare regardless of source article category. Example: any ${learnEx.name} source → "${nativeEx.nounBare}".`;
  }

  const defTarget = matrixTranslationTarget('def', nativeCode);
  const indefTarget = matrixTranslationTarget('indef', nativeCode);

  // Slice 7c: mass-noun exception as a self-contained block that is
  // explicitly scoped to the TRANSLATION field. The phrasing names the
  // leak vector we observed in the Slice-7b.4 sweep.
  const massNounExceptionBlock = `

TARGET-SIDE EXCEPTION (translation only, NEVER affects the "original" field):
  If the ${nativeEx.name} dictionary form of an abstract / mass / uncountable noun is bare (e.g. "freedom", "equality", "respect", "water", "information"), the "translation" value MAY be bare — do NOT force an indefinite article where it would read as stilted. Example: avoid "un'uguaglianza" when "uguaglianza" is conventional in ${nativeEx.name}. This exception applies ONLY to the translation value; the source-side lemma in the "original" field still follows its extraction rule without exception (Scandi MUST carry en/ett/ei/et or a suffix-definite marker, articled langs MUST carry their article).`;

  if (learnEx.artCat === 'bare') {
    return `${learnEx.name} has no articles (source is always bare). Translate to the ${nativeEx.name} INDEFINITE form by default. Example: "${learnEx.nounLemma}" → "${indefTarget}".${massNounExceptionBlock}`;
  }

  if (learnEx.artCat === 'indef') {
    return `Scandi INDEF source ("en"/"ett"/"ei"/"et" prefix, e.g. "${learnEx.nounLemma}") MUST map to the ${nativeEx.name} INDEFINITE category — NEVER the definite. DEF source ("${learnEx.nounDef}") maps to ${nativeEx.name} definite. Examples: DEF "${learnEx.nounDef}" → "${defTarget}"; INDEF "${learnEx.nounLemma}" → "${indefTarget}" (NOT "${defTarget}"). BARE source → "${indefTarget}".${massNounExceptionBlock}`;
  }

  const learnDef = learnEx.nounLemma;
  const learnIndef = learnEx.nounIndef!;
  return `Mirror the source's article category into ${nativeEx.name}. DEF "${learnDef}" → "${defTarget}". INDEF "${learnIndef}" → "${indefTarget}". BARE source → "${indefTarget}".${massNounExceptionBlock}`;
}

/** v3 JSON example — identical shape to v2; delegates. */
export function buildJsonExampleV3(learnCode: string, nativeCode: string): string {
  return buildJsonExampleV2(learnCode, nativeCode);
}

// ─── v3 top-level prompt template ─────────────────────────────────────

/** Full system prompt for bulk vocabulary extraction under v3.
 *  Symmetric CAPS-headed blocks for each word type restore type-balance
 *  emphasis vs the noun-heavy v2 prose. */
export function buildVocabSystemPromptV3(
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: string,
  nativeLanguageCode: string,
): string {
  const scandiRuleV3 = CRITICAL_NOUN_RULE_BY_LANG_V3[learningLanguageCode] ?? '';
  return `You are a language teacher assistant. Extract all meaningful vocabulary from a given text.

${buildCriticalHeaderV3(learningLanguageCode)}

LEARNING LANGUAGE: ${learningLanguageName} · NATIVE LANGUAGE: ${nativeLanguageName}

General rules (apply to every extracted entry regardless of type):
- Ignore function words, standalone articles, pronouns, proper nouns (people / cities / countries / brands / works / clubs / broadcasters), abbreviations (any all-uppercase token of 2+ letters), and numbers.
- Each distinct word appears AT MOST ONCE. Further occurrences of the same lexeme (different article / tense / inflection) go into "source_forms".
- "original" field: the word in ${learningLanguageName}. "translation" field: the translation in ${nativeLanguageName}.
- "source_cat" field: one of "def" | "indef" | "bare" — marks the article category of the first occurrence of NOUN entries. For verb / adjective / phrase / other entries always set source_cat="bare".

TYPE RULES — extract FOUR equally-weighted categories:

NOUN EXTRACTION (${learningLanguageName}):
${buildNounRuleV3(learningLanguageCode)}
${scandiRuleV3 ? '\n' + scandiRuleV3 + '\n' : ''}
VERB EXTRACTION (${learningLanguageName}):
${buildVerbRuleV3(learningLanguageCode)}

ADJECTIVE EXTRACTION (${learningLanguageName}):
${buildAdjRuleV3(learningLanguageCode)}

PHRASE EXTRACTION:
${buildPhraseRuleV3(learningLanguageCode)}

TRANSLATION RULE (${nativeLanguageName} target):
${buildTranslationRuleV3(learningLanguageCode, nativeLanguageCode)}

"type" must be one of: "noun", "verb", "adjective", "phrase", "other". Pick the type that matches each extracted word — DO NOT default to "noun" for everything. A balanced text typically contains roughly 40-60% nouns, 15-30% verbs, 10-20% adjectives, and a handful of phrases.

Respond exclusively as a JSON array, no additional text. Leave "level" as "". Shape:
${buildJsonExampleV3(learningLanguageCode, nativeLanguageCode)}`;
}
