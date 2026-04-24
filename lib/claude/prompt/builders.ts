/**
 * Prompt fragment builders for the pure-INDEF extraction prompt
 * (Rule 47, revised 2026-04-24).
 *
 * Every noun is emitted in its INDEFINITE form regardless of the
 * source-text article category. The prior three-branch per-lang rules
 * (def / indef-prefix / bare) and the `source_cat` round-trip field are
 * gone; see CLAUDE.md §"Vocabulary Formatting Rules" for the why.
 */
import { getLangExamples } from '../langs';
import { nativeIndefTarget } from './shared';

// ─── Canonical rule constants (load-bearing symbol names for architecture tests) ───

/** Scandinavian nouns: always emit with INDEFINITE prefix per grammatical
 *  gender — regardless of how the noun appears in the source. */
export const SCANDINAVIAN_NOUN_RULE = `- IMPORTANT — for Swedish (sv), Norwegian (no), and Danish (da): emit every noun with its INDEFINITE prefix matching grammatical gender ("en" common / "ett" neuter sv / "ei" feminine no / "et" neuter da). Regardless of how the noun appears in source — as "hunden" (suffix-definite), "en hund" (with prefix), or bare "hund" (e.g. in recipes or after adjectives) — output "en hund". Never emit a Scandi noun without its indefinite prefix and never emit the suffix-definite form.`;

/** Polish and Czech have no articles at all. Nouns come out bare. */
export const SLAVIC_NOUN_RULE = `- IMPORTANT — for Polish (pl) and Czech (cs), these languages have NO articles at all. In the "original" field, emit nouns in the BARE singular nominative form — NEVER prepend any article or determiner. This applies to SINGLE entries AND to m/f pairs: write "Europejczyk, Europejka" (not "o Europejczyk, Europejka"), "mieszkaniec, mieszkanka" (not "o mieszkaniec, mieszkanka"), "tekst" (not "ten tekst"), "vedení" (not "to vedení"). Never borrow an article from another language (no Portuguese "o"/"a", no German "der"/"die", no English "the"). This OVERRIDES the generic "include article" rule above for these two languages.`;

/** English nouns: always "a" or "an" by phonetics, never "the". */
export const ENGLISH_NOUN_RULE = `- IMPORTANT — for English (en): emit every noun with the INDEFINITE article. Use "an" before a vowel SOUND, "a" before a consonant sound — "an apple" / "an ancestor" / "an ability" / "an octopus" / "an arm" / "an eye" / "an hour", but "a dog" / "a university" / "a one-way". Never write "a apple" or "a ancestor" — the a/an distinction is phonological, not orthographic. Regardless of how the noun appears in source ("the dog", bare "Dog", "a dog"), output "a dog". Never emit a bare English noun and never emit the definite "the" form.`;

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
    return `CRITICAL FORMATTING RULE: Extract each noun in its ${ex.name} dictionary base form (bare — no articles, since ${ex.name} has none). Example: "${ex.nounLemma}".`;
  }
  if (ex.artCat === 'indef') {
    // Scandi — INDEF-prefix canonical example
    return `CRITICAL FORMATTING RULE: Every ${ex.name} noun MUST be extracted with its INDEFINITE prefix per gender (e.g. "${ex.nounLemma}"). Never the suffix-definite form, never bare.`;
  }
  // Articled — INDEF-article canonical example
  return `CRITICAL FORMATTING RULE: Every ${ex.name} noun MUST be extracted with its INDEFINITE article (e.g. "${ex.nounIndef}"). Never the definite article, never bare.`;
}

/** Noun + verb rules block. For articled learn langs the noun line names
 *  the INDEF article + counter to the DEF form. For articleless / Scandi
 *  langs the noun rule is carried by CRITICAL_NOUN_RULE_BY_LANG above.
 *  Verb rule is always infinitive-or-skip. */
export function buildNounVerbRules(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  const lines: string[] = [];
  if (ex.artCat === 'def' && ex.nounIndef) {
    // Articled learn lang: enforce INDEF article, name DEF form as counter.
    lines.push(
      `- Nouns: extract each noun in singular form with the INDEFINITE article. For ${ex.name}: "${ex.nounIndef}" (not "${ex.nounLemma}"). If a distinct feminine form exists, add it after a comma.`,
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

/** Translation-side article rule. Always the native's indefinite form
 *  (or bare for articleless natives). Carries an explicit "abstract
 *  nouns also INDEF" reinforcement per native — the 2026-04-24 sweep
 *  showed the LLM defaults to the dictionary-def convention for
 *  abstract/institutional/geographic nouns (`die Macht`, `le nord`,
 *  `het zuiden`) and bare forms for Scandi concepts (`person`, `område`),
 *  overriding the generic INDEF rule. These negative examples push back. */
export function buildTranslationRule(learnCode: string, nativeCode: string): string {
  const learnEx = getLangExamples(learnCode);
  const nativeEx = getLangExamples(nativeCode);
  const target = nativeIndefTarget(nativeCode);
  if (nativeEx.artCat === 'bare') {
    return `- "translation" field for NOUN entries: ${nativeEx.name} has no articles — translation is always bare. Example: ${learnEx.name} "${learnIndefExample(learnEx)}" → "${target}".`;
  }
  const abstractHint = abstractNounHint(nativeCode);
  return `- "translation" field for NOUN entries: always use the ${nativeEx.name} INDEFINITE form — including for abstract, mass, institutional, and geographic nouns (no exceptions).${abstractHint} Example: ${learnEx.name} "${learnIndefExample(learnEx)}" → "${target}" (${nativeEx.name} indef).`;
}

/** Per-native negative-example reinforcement: the LLM's "dictionary
 *  instinct" for abstract/institutional/geographic nouns tends to use
 *  the definite article (or bare for Scandi). These inline
 *  counter-examples name the failure mode explicitly so it does not
 *  slip past the generic INDEF rule. Calibrated from the 2026-04-24
 *  sweep; patterns: DE die/das, FR le/la, IT il/la, NL de/het, Scandi
 *  bare-for-concepts. */
function abstractNounHint(nativeCode: string): string {
  switch (nativeCode) {
    case 'de':
      return ' Examples: "eine Macht" (not "die Macht"), "eine Freiheit" (not "die Freiheit"), "ein Gesetz" (not "das Gesetz"), "eine Staatsform" (not "die Staatsform").';
    case 'fr':
      return ' Examples: "un pouvoir" (not "le pouvoir"), "une liberté" (not "la liberté"), "un nord" (not "le nord").';
    case 'es':
      return ' Examples: "un poder" (not "el poder"), "una libertad" (not "la libertad"), "una costa" (not "la costa").';
    case 'it':
      return ' Examples: "un potere" (not "il potere"), "una libertà" (not "la libertà"), "un nord" (not "il nord"), "una costa" (not "la costa").';
    case 'pt':
      return ' Examples: "um poder" (not "o poder"), "uma liberdade" (not "a liberdade").';
    case 'nl':
      return ' Examples: "een macht" (not "de macht"), "een onderzoek" (not bare "onderzoek"), "een kind" (not bare "kind").';
    case 'en':
      return ' Examples: "a power" (not "the power"), "a freedom" (not bare "freedom"). Use "an" before a vowel sound: "an ability", "an ancestor", "an hour".';
    case 'sv':
    case 'no':
    case 'da':
      return ' Always prepend en/ett/ei/et even for abstract, mass, or geographic nouns: "en person" (not bare "person"), "en befolkning" (not bare "befolkning"), "ett område" (not bare "område"), "en gräns" (not bare "gräns"). Never emit a Scandi noun without the INDEFINITE prefix.';
    default:
      return '';
  }
}

/** INDEF-form example of a learn-lang noun for rule example lines.
 *  Articled: nounIndef ("ein Hund"). Scandi: nounLemma (already INDEF-prefix
 *  "en hund"). Articleless: nounLemma ("pies", bare). */
function learnIndefExample(learnEx: ReturnType<typeof getLangExamples>): string {
  if (learnEx.artCat === 'bare') return learnEx.nounLemma;
  if (learnEx.artCat === 'indef') return learnEx.nounLemma;
  return learnEx.nounIndef!;
}

/** JSON example for the trailing prompt block — one-entry-per-type
 *  covering all four of noun/verb/adjective/phrase so the LLM sees
 *  every type anchored and doesn't cargo-cult "noun" on everything. */
export function buildJsonExample(learnCode: string, nativeCode: string): string {
  const le = getLangExamples(learnCode);
  const ne = getLangExamples(nativeCode);
  const learnNoun = learnIndefExample(le);
  const nounTarget = nativeIndefTarget(nativeCode);
  const nounSrcForm = le.nounBare;
  const verbSrcForm = le.verbWrong;
  return `[
  { "original": "${learnNoun}", "translation": "${nounTarget}", "level": "", "type": "noun", "source_forms": ["${nounSrcForm}"] },
  { "original": "${le.verbInf}", "translation": "${ne.verbInf}", "level": "", "type": "verb", "source_forms": ["${verbSrcForm}"] },
  { "original": "${le.adjMFPair ?? le.adjSingle}", "translation": "${ne.adjMFPair ?? ne.adjSingle}", "level": "", "type": "adjective", "source_forms": ["${le.adjInflected ?? le.adjSingle}"] },
  { "original": "${le.phraseExample}", "translation": "${ne.phraseExample}", "level": "", "type": "phrase", "source_forms": ["${le.phraseExample}"] }
]`;
}
