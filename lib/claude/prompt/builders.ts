/**
 * Prompt fragment builders for the Matrix-Regel (the canonical Anyvoc
 * vocabulary-extraction prompt).
 *
 * History: this file replaces the per-version split under
 * `prompt/{v1,v2,v3}.ts` that existed during the 2026-04-23 A/B runs.
 * Once v2 (Matrix-Regel) proved itself as the production default, v1
 * (pre-Matrix-Regel baseline) and v3 (re-balanced type emphasis with
 * scope-fenced mass-noun allowance) were removed. What remains is
 * the single code path shipped to users.
 *
 * See CLAUDE.md §"Vocabulary Formatting Rules" for the cross-language
 * prompt policy, and `lib/__tests__/matrix-rule.test.ts` for the
 * 12×3 translation-target ground truth that `matrixTranslationTarget`
 * (in `./shared.ts`) satisfies.
 */
import { getLangExamples } from '../langs';
import { matrixTranslationTarget } from './shared';

// ─── Canonical rule constants (load-bearing symbol names for architecture tests) ───

/** Scandinavian nouns preserve the article category of the first
 *  occurrence. Suffix-definite (hunden), indefinite-prefix (en hund),
 *  or bare-with-prefix-added (recipes/legal/after-adjectives). */
export const SCANDINAVIAN_NOUN_RULE = `- IMPORTANT — for Swedish (sv), Norwegian (no), and Danish (da), definiteness is marked as a noun SUFFIX, not a prepositive article. Preserve the article category of the FIRST occurrence of each noun:
  • SUFFIX-DEFINITE source (text shows e.g. "hunden", "bogen", "bilden", "folket"): emit as-is with source_cat="def".
  • INDEFINITE-PREFIX source (text shows "en hund", "ett språk", "ei bok"): emit with the prefix, source_cat="indef".
  • BARE source (text shows just "hund", "salt", "mjölk" — typical in recipes, legal text, or after adjectives): prepend the indefinite article by grammatical gender ("en" common / "ett" neuter sv / "ei" feminine no), source_cat="bare".
Never emit a Scandi noun that is bare of BOTH a suffix-definite marker AND an indefinite prefix. Apply this regardless of native language and text genre.`;

/** Polish and Czech have no articles at all. Nouns come out bare. */
export const SLAVIC_NOUN_RULE = `- IMPORTANT — for Polish (pl) and Czech (cs), these languages have NO articles at all. In the "original" field, emit nouns in the BARE singular nominative form — NEVER prepend any article or determiner. This applies to SINGLE entries AND to m/f pairs: write "Europejczyk, Europejka" (not "o Europejczyk, Europejka"), "mieszkaniec, mieszkanka" (not "o mieszkaniec, mieszkanka"), "tekst" (not "ten tekst"), "vedení" (not "to vedení"). Never borrow an article from another language (no Portuguese "o"/"a", no German "der"/"die", no English "the"). This OVERRIDES the generic "include article" rule above for these two languages.`;

/** English nouns preserve the article category of the first occurrence. */
export const ENGLISH_NOUN_RULE = `- IMPORTANT — for English (en), preserve the article category of the FIRST occurrence of each noun:
  • DEF source ("the dog"): emit "the dog" with source_cat="def".
  • INDEF source ("a dog"/"an apple"): emit "a dog" with source_cat="indef".
  • BARE source (headlines "Dog bites man", or bare mass nouns): emit with "a"/"an", source_cat="bare".
Never emit a bare English noun in the "original" field — always carry "the" or "a"/"an".`;

/** Per-learning-language lookup for the language-specific noun rule
 *  block. Languages not listed get no inline rule — the per-language
 *  example in buildNounVerbRules carries the policy. */
export const CRITICAL_NOUN_RULE_BY_LANG: Record<string, string> = {
  sv: SCANDINAVIAN_NOUN_RULE,
  no: SCANDINAVIAN_NOUN_RULE,
  da: SCANDINAVIAN_NOUN_RULE,
  pl: SLAVIC_NOUN_RULE,
  cs: SLAVIC_NOUN_RULE,
  en: ENGLISH_NOUN_RULE,
};

// ─── Fragment builders ─────────────────────────────────────────────────

/** Top-of-prompt header naming the concrete learn-lang example shape. */
export function buildCriticalHeader(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.artCat === 'bare') {
    return `CRITICAL FORMATTING RULE: Extract each noun in its ${ex.name} dictionary base form. Example: "${ex.nounLemma}".`;
  }
  if (ex.artCat === 'indef') {
    // Scandi — show both def-suffix and indef-prefix canonical examples
    return `CRITICAL FORMATTING RULE: Every ${ex.name} noun MUST be extracted in the form matching its FIRST occurrence in the source — suffix-definite (e.g. "${ex.nounDef}") or indefinite-prefix (e.g. "${ex.nounLemma}"). Bare source forms default to the indefinite prefix.`;
  }
  // Articled — show both def and indef canonical examples
  return `CRITICAL FORMATTING RULE: Every noun MUST include its article, matching the article used at its FIRST occurrence in the source text. Example for ${ex.name}: DEF "${ex.nounLemma}" or INDEF "${ex.nounIndef}". Never emit a bare noun.`;
}

/** Noun + verb rules block. Articled langs get source-preserving noun
 *  preservation here; Scandi and articleless langs defer to
 *  CRITICAL_NOUN_RULE_BY_LANG for the noun shape. Verb rule is always
 *  infinitive-or-skip. */
export function buildNounVerbRules(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  const lines: string[] = [];
  if (ex.artCat === 'def' && ex.nounIndef) {
    // Articled learn lang: preserve first-occurrence article category
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

/** Translation-side article rule. Articled + Scandi native show both
 *  DEF-source and INDEF-source target examples. Articleless native
 *  always bare. Articleless source → native indefinite (bare default). */
export function buildTranslationRule(learnCode: string, nativeCode: string): string {
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

/** JSON example for the trailing prompt block — one-entry-per-type
 *  covering all four of noun/verb/adjective/phrase so the LLM sees
 *  every type anchored and doesn't cargo-cult "noun" on everything. */
export function buildJsonExample(learnCode: string, nativeCode: string): string {
  const le = getLangExamples(learnCode);
  const ne = getLangExamples(nativeCode);
  // Canonical noun example uses DEF source for articled/scandi, bare for articleless.
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
