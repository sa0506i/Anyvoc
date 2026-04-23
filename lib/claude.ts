import { classifyWord, type SupportedLanguage } from './classifier';
import { postProcessExtractedVocab } from './vocabFilters';
// Phase 2 Slice 1: transport, chunking, detection, and shared types
// live in dedicated files under ./claude/. lib/claude.ts continues to
// re-export them so existing callers (shareProcessing, urlExtractor,
// etc.) keep working unchanged.
import { callClaude, ClaudeAPIError } from './claude/transport';
import { chunkText } from './claude/chunk';
import { detectLanguage } from './claude/detectLanguage';
import type {
  ExtractedVocab,
  TranslateSingleWordResult,
  ClaudeMessage,
  PromptVersion,
} from './claude/types';

export { callClaude, ClaudeAPIError } from './claude/transport';
export { chunkText } from './claude/chunk';
export { detectLanguage } from './claude/detectLanguage';
export type {
  ExtractedVocab,
  TranslateSingleWordResult,
  PromptVersion,
  ArticleCategory,
} from './claude/types';

function defaultPromptVersion(): PromptVersion {
  // Slice 7/7 (2026-04-23): flipped from v1 → v2 after the full sweep
  // confirmed v2 meets every Go/No-Go criterion in the plan file. See
  // docs/superpowers/specs/2026-04-23-phase1-go-nogo.md for the full
  // KPI diff. Env override ANYVOC_PROMPT_VERSION=v1 remains available
  // for emergency rollback without code change.
  //
  // Slice 7b (2026-04-23): v3 added as an opt-in variant while its sweep
  // runs; once validated it will take over as the default. v3 rebalances
  // type emphasis (NOUN/VERB/ADJECTIVE/PHRASE as symmetric blocks),
  // strengthens the Scandi-INDEF → articled-INDEF mirror against the
  // dictionary-lemma drift observed in the v2 full sweep, and allows
  // bare-to-bare translation for abstract/mass nouns.
  if (process.env.ANYVOC_PROMPT_VERSION === 'v1') return 'v1';
  if (process.env.ANYVOC_PROMPT_VERSION === 'v3') return 'v3';
  return 'v2';
}

/**
 * Per-language example bank used by the prompt builders. Each entry
 * holds the concrete lemma / counter-example shapes the LLM needs in
 * order to follow the extraction rules for THAT language only.
 *
 * Rule 46 (F11, 2026-04-22): the prompt must only carry examples in
 * the learning language of the current extraction and, for the
 * translation-side rule, in the native language. The earlier shared
 * constants (NOUN_VERB_FORMATTING_RULES, TRANSLATION_MIRROR_RULE,
 * NOUN_SHAPE_RULE, ROMANCE_ADJ_RULE, SINGLE_FORM_ADJ_RULE, the CRITICAL
 * header) mixed examples from 4-7 languages in every single prompt,
 * which diluted the signal for small models (47% Portuguese-native
 * translations leaking into English in the 2026-04-22 sweep). This
 * dict + the builder functions below replace every cross-language
 * example with a learn-lang-only one.
 */
interface LangExamples {
  /** English name for template interpolation ("German", "Portuguese"). */
  name: string;
  /** Article category of the canonical "original" field per Rule 34/41. */
  artCat: 'def' | 'indef' | 'bare';
  /** Canonical lemma shape: "der Hund" (de), "en bild" (sv), "pies" (pl). */
  nounLemma: string;
  /** Bare form for the CRITICAL header counter ("not 'Hund'"). */
  nounBare: string;
  /** Indef counter for def-cat languages ("not 'ein Hund'"). */
  nounIndef?: string;
  /** Definite form used as translation target when the source category is DEF.
   *  For articled langs this is identical to nounLemma (e.g. "der Hund") —
   *  leave undefined; consumers fall back to nounLemma.
   *  For Scandi langs this is the SUFFIX-DEFINITE form ("hunden" / "bogen" /
   *  "bilden") which differs from nounLemma (the INDEF-prefix form "en hund").
   *  For articleless langs (pl/cs) this is unused — they have no articles. */
  nounDef?: string;
  /** Example of a legit-looking attributive-adjective-plus-noun pair
   *  that must be split into two entries — for NOUN_SHAPE_RULE. */
  attrAdj?: { good: string; bad: string };
  /** Verb infinitive + a common wrong form (past participle / conjugated). */
  verbInf: string;
  verbWrong: string;
  /** Reflexive verb example if the language has a dedicated marker. */
  verbReflexive?: string;
  /** Single-form adjective example for non-Romance langs. */
  adjSingle: string;
  /** Inflected counter-form for non-Romance ("dünne" vs "dünn"). */
  adjInflected?: string;
  /** Legitimate m/f pair for Romance ("beau, belle"). */
  adjMFPair?: string;
  /** Two-line phrase example for the JSON block. */
  phraseExample: string;
  /** Translation of phraseExample — fallback if nativeLang phrase missing. */
  phraseTranslation?: string;
}

const LANG_EXAMPLES: Record<string, LangExamples> = {
  en: {
    name: 'English',
    artCat: 'def',
    nounLemma: 'the dog',
    nounBare: 'dog',
    nounIndef: 'a dog',
    attrAdj: { good: 'the power', bad: 'the political power' },
    verbInf: 'to run',
    verbWrong: 'ran',
    adjSingle: 'small',
    phraseExample: 'by the way',
  },
  de: {
    name: 'German',
    artCat: 'def',
    nounLemma: 'der Hund',
    nounBare: 'Hund',
    nounIndef: 'ein Hund',
    attrAdj: { good: 'die Gewalt', bad: 'die öffentliche Gewalt' },
    verbInf: 'laufen',
    verbWrong: 'lief',
    verbReflexive: 'sich erinnern',
    adjSingle: 'klein',
    adjInflected: 'kleine',
    phraseExample: 'im Grunde genommen',
  },
  fr: {
    name: 'French',
    artCat: 'def',
    nounLemma: 'le chien',
    nounBare: 'chien',
    nounIndef: 'un chien',
    attrAdj: { good: 'la cité', bad: 'la cité médiévale' },
    verbInf: 'courir',
    verbWrong: 'couru',
    verbReflexive: 'se souvenir',
    adjSingle: 'petit',
    adjMFPair: 'petit, petite',
    phraseExample: 'de toute façon',
  },
  es: {
    name: 'Spanish',
    artCat: 'def',
    nounLemma: 'el perro',
    nounBare: 'perro',
    nounIndef: 'un perro',
    attrAdj: { good: 'la lengua', bad: 'la lengua materna' },
    verbInf: 'correr',
    verbWrong: 'corrió',
    verbReflexive: 'acordarse',
    adjSingle: 'bonito',
    adjMFPair: 'bonito, bonita',
    phraseExample: 'de repente',
  },
  it: {
    name: 'Italian',
    artCat: 'def',
    nounLemma: 'il cane',
    nounBare: 'cane',
    nounIndef: 'un cane',
    attrAdj: { good: 'la città', bad: 'la città medievale' },
    verbInf: 'correre',
    verbWrong: 'corso',
    verbReflexive: 'ricordarsi',
    adjSingle: 'bello',
    adjMFPair: 'bello, bella',
    phraseExample: 'di solito',
  },
  pt: {
    name: 'Portuguese',
    artCat: 'def',
    nounLemma: 'o cão',
    nounBare: 'cão',
    nounIndef: 'um cão',
    attrAdj: { good: 'a cidade', bad: 'a cidade medieval' },
    verbInf: 'correr',
    verbWrong: 'correu',
    verbReflexive: 'acordar-se',
    adjSingle: 'bonito',
    adjMFPair: 'bonito, bonita',
    phraseExample: 'de repente',
  },
  nl: {
    name: 'Dutch',
    artCat: 'def',
    nounLemma: 'de hond',
    nounBare: 'hond',
    nounIndef: 'een hond',
    attrAdj: { good: 'de macht', bad: 'de politieke macht' },
    verbInf: 'lopen',
    verbWrong: 'liep',
    verbReflexive: 'zich herinneren',
    adjSingle: 'mooi',
    adjInflected: 'mooie',
    phraseExample: 'aan de slag',
  },
  sv: {
    name: 'Swedish',
    artCat: 'indef',
    nounLemma: 'en hund',
    nounBare: 'hund',
    nounDef: 'hunden',
    attrAdj: { good: 'en makt', bad: 'en politisk makt' },
    verbInf: 'att springa',
    verbWrong: 'sprang',
    adjSingle: 'stor',
    adjInflected: 'stora',
    phraseExample: 'hur som helst',
  },
  no: {
    name: 'Norwegian',
    artCat: 'indef',
    nounLemma: 'en hund',
    nounBare: 'hund',
    nounDef: 'hunden',
    attrAdj: { good: 'en makt', bad: 'en politisk makt' },
    verbInf: 'å springe',
    verbWrong: 'sprang',
    adjSingle: 'stor',
    adjInflected: 'store',
    phraseExample: 'for eksempel',
  },
  da: {
    name: 'Danish',
    artCat: 'indef',
    nounLemma: 'en hund',
    nounBare: 'hund',
    nounDef: 'hunden',
    attrAdj: { good: 'en magt', bad: 'en politisk magt' },
    verbInf: 'at løbe',
    verbWrong: 'løb',
    adjSingle: 'stor',
    adjInflected: 'store',
    phraseExample: 'for eksempel',
  },
  pl: {
    name: 'Polish',
    artCat: 'bare',
    nounLemma: 'pies',
    nounBare: 'pies',
    attrAdj: { good: 'państwo', bad: 'potężne państwo' },
    verbInf: 'biegać',
    verbWrong: 'biegł',
    adjSingle: 'wysoki',
    phraseExample: 'na przykład',
  },
  cs: {
    name: 'Czech',
    artCat: 'bare',
    nounLemma: 'pes',
    nounBare: 'pes',
    attrAdj: { good: 'stát', bad: 'mocný stát' },
    verbInf: 'běžet',
    verbWrong: 'běžel',
    adjSingle: 'vysoký',
    phraseExample: 'na příklad',
  },
};

function getLangExamples(code: string): LangExamples {
  return LANG_EXAMPLES[code] ?? LANG_EXAMPLES.en!;
}

/** Builds the "- Nouns: …" + "- Verbs: …" pair using only learn-lang
 *  examples (F11 / Rule 46). For indef-category languages (sv/no/da)
 *  the noun line is a no-op — the SCANDINAVIAN_NOUN_RULE block already
 *  covers the canonical indef-prefix convention. For bare-category
 *  languages (pl/cs) the noun line is also a no-op — SLAVIC_NOUN_RULE
 *  covers it. Only def-category languages get a "DEFINITE not
 *  indefinite" line here, and only with their own example. */
function buildNounVerbRules(learnCode: string): string {
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

/** Builds the adjective rule using only learn-lang examples. */
function buildAdjRule(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.adjMFPair) {
    // Romance: m + f pair is legit
    return `- Adjectives: give both masculine and feminine forms when they differ (e.g. "${ex.adjMFPair}" in ${ex.name}).`;
  }
  // All others: single form. Keep a brief counter-example when we have one.
  const counter = ex.adjInflected
    ? ` (e.g. "${ex.adjSingle}" not "${ex.adjSingle}, ${ex.adjInflected}")`
    : ` (e.g. "${ex.adjSingle}")`;
  return `- Adjectives: emit the SINGLE dictionary base form only${counter}. Never pair an adjective with its inflected form — ${ex.name} does NOT inflect adjectives by gender in the dictionary entry.`;
}

/** Builds the "one content word after the article" noun-shape rule
 *  using only the learn-lang counter-example. */
function buildNounShapeRule(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  const attrExample = ex.attrAdj
    ? ` For ${ex.name}: write "${ex.attrAdj.good}" not "${ex.attrAdj.bad}" (list the adjective as a separate entry if relevant).`
    : '';
  return `- For NOUN entries, "original" must be exactly "article + singular-noun" — a single content word after the article.${attrExample} Multi-word proper nouns (club names, organisation names, broadcaster names) are proper nouns and MUST be omitted entirely.`;
}

/** Builds the CRITICAL FORMATTING header with a single learn-lang example. */
function buildCriticalHeader(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.artCat === 'bare') {
    // pl/cs — there is no article to demand
    return `CRITICAL FORMATTING RULE: Extract each noun in its ${ex.name} dictionary base form. Example: "${ex.nounLemma}".`;
  }
  return `CRITICAL FORMATTING RULE: Every noun MUST include its article. Never write a bare noun without an article. Example for ${ex.name}: "${ex.nounLemma}" (not "${ex.nounBare}").`;
}

/** Picks the correct native-lang example form for a translation based
 *  on the learn-lang's article category (Rule 42 Mirror + F6 fallback).
 *
 *  - learn DEF → native's def form (nativeEx.nounLemma for def-cat
 *    natives; for indef-cat Scandi natives we use their nounLemma too,
 *    which is the indef-prefix lemma per Rule 34 — accepted as the
 *    Scandi dictionary convention). For bare-cat natives (pl/cs) →
 *    bare nounLemma.
 *  - learn INDEF (Scandi) → native's indef form: nativeEx.nounIndef
 *    when the native has a distinct indef article (de/fr/es/it/pt/
 *    nl/en); otherwise nativeEx.nounLemma (already indef for Scandi
 *    natives; bare for pl/cs natives).
 *  - learn BARE (pl/cs) → native's default (nativeEx.nounLemma).
 *
 *  F12 fix (2026-04-22): without this dispatch, the translation
 *  example for every combo used nativeEx.nounLemma regardless of
 *  learn's category. For INDEF-learn → def-cat native (e.g. sv→de)
 *  this produced "en hund → der Hund" — indef source mirrored to def
 *  target, which directly contradicted the Mirror rule stated in the
 *  same prompt. The LLM followed the concrete example over the
 *  abstract rule, driving INDEF→indef compliance down to 0% for
 *  de/nl/es natives in the post-F11 sweep.
 */
/** Translation-target lookup per the user-approved matrix (2026-04-23).
 *
 *  Given the article category of the source-language occurrence of a noun
 *  (`'def' | 'indef' | 'bare'`), return the translation target in the
 *  native language that matches that category's convention.
 *
 *  Rule (see `lib/__tests__/matrix-rule.test.ts` for the 12×3 ground truth):
 *   - Articleless native (pl/cs): always `nounBare` — these languages have
 *     no articles at all, so the native target is bare regardless of source.
 *   - DEF source → native's definite form. For articled natives this is
 *     `nounLemma` (which carries the DEF article in those profiles, e.g.
 *     "der Hund"); for Scandi natives this is `nounDef` (the suffix-definite
 *     form "hunden") which differs from their INDEF-prefix `nounLemma`.
 *   - INDEF or BARE source → native's indefinite form. For articled natives
 *     this is `nounIndef` ("ein Hund"); for Scandi natives this is
 *     `nounLemma` (already the INDEF-prefix lemma "en hund"). BARE mirrors
 *     to INDEF per the user comment attached to the matrix ("Fuer BARE
 *     (pl,cs), wird immer auf indef uebersetzt").
 */
export function matrixTranslationTarget(
  sourceCat: 'def' | 'indef' | 'bare',
  nativeCode: string,
): string {
  const n = getLangExamples(nativeCode);
  if (n.artCat === 'bare') return n.nounBare; // articleless native
  if (sourceCat === 'def') {
    // Scandi natives use the suffix-definite form; articled natives' lemma IS def.
    return n.artCat === 'indef' ? n.nounDef! : n.nounLemma;
  }
  // INDEF or BARE source → native's indefinite form.
  return n.artCat === 'indef' ? n.nounLemma : n.nounIndef!;
}

function pickTranslationTarget(learnCode: string, nativeCode: string): string {
  const learnEx = getLangExamples(learnCode);
  const nativeEx = getLangExamples(nativeCode);
  if (nativeEx.artCat === 'bare') {
    // pl/cs native: always bare (no articles exist)
    return nativeEx.nounLemma;
  }
  if (learnEx.artCat === 'indef' && nativeEx.nounIndef) {
    // Scandi learn → native's indef form (mirror indef category)
    return nativeEx.nounIndef;
  }
  // DEF or BARE learn → native's canonical lemma
  return nativeEx.nounLemma;
}

/** Builds the translation-side article rule using one learn-lang
 *  source and one native-lang target example. Replaces the earlier
 *  TRANSLATION_MIRROR_RULE constant which carried examples for 7
 *  natives at once. */
function buildTranslationRule(learnCode: string, nativeCode: string): string {
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

/** JSON example for the trailing prompt block — now using one
 *  learn-lang noun + one native-lang translation pair instead of the
 *  PT-heavy cross-language mix the old template hard-coded. */
function buildJsonExample(learnCode: string, nativeCode: string): string {
  const le = getLangExamples(learnCode);
  const ne = getLangExamples(nativeCode);
  const nounTarget = pickTranslationTarget(learnCode, nativeCode);
  // source_forms shows an inflected form — use a plausible plural/conjugated
  // shape, falling back to the bare/wrong form if nothing better is known.
  const nounSrcForm = le.nounBare;
  const verbSrcForm = le.verbWrong;
  return `[
  { "original": "${le.nounLemma}", "translation": "${nounTarget}", "level": "", "type": "noun", "source_forms": ["${nounSrcForm}"] },
  { "original": "${le.verbInf}", "translation": "${ne.verbInf}", "level": "", "type": "verb", "source_forms": ["${verbSrcForm}"] },
  { "original": "${le.adjMFPair ?? le.adjSingle}", "translation": "${ne.adjMFPair ?? ne.adjSingle}", "level": "", "type": "adjective", "source_forms": ["${le.adjInflected ?? le.adjSingle}"] },
  { "original": "${le.phraseExample}", "translation": "${ne.phraseExample}", "level": "", "type": "phrase", "source_forms": ["${le.phraseExample}"] }
]`;
}

// Transport types (ClaudeMessage, ClaudeContentBlock, ClaudeResponse,
// CallClaudeOptions), ClaudeAPIError, callClaude + retry, ExtractedVocab,
// TranslateSingleWordResult, PromptVersion, ArticleCategory, chunkText,
// and detectLanguage all moved to lib/claude/{types,transport,chunk,
// detectLanguage}.ts in Phase 2 Slice 1. They're imported + re-exported
// at the top of this file so external callers keep working unchanged.

/** Scandinavian languages mark definiteness with a noun suffix rather than
 *  a prepositive article, so the generic "direct article" rule breaks down.
 *  For da/sv/no we instruct the model to prepend the INDEFINITE article
 *  based on grammatical gender (en/ett/ei), making the output cross-
 *  linguistically comparable. */
const SCANDINAVIAN_NOUN_RULE = `- IMPORTANT — for Swedish (sv), Norwegian (no), and Danish (da), these languages mark definiteness as a noun SUFFIX, not a prepositive article. In the "original" field, ALWAYS prepend the INDEFINITE article based on grammatical gender: "en" (common gender, sv/no/da), "ett" (neuter, sv), "ei" (feminine, no). Examples: "en artikel", "ett språk" (sv), "ei bok" (no), "en bog" (da). This rule is UNCONDITIONAL — it applies regardless of the native language, regardless of text genre (recipes, news, legal, wikipedia), regardless of how the noun appears in the source text. If the source text has the DEFINITE-SUFFIX form, you MUST still extract the lemma with the indefinite prefix: source "folket" → extract "ett folk" (not "folket"), source "bilden" → extract "en bild" (not "bilden"), source "lagen" → extract "en lag" (not "lagen"), source "hjernen" → extract "en hjerne" (not "hjernen"), source "bogen" → extract "en bog" (not "bogen"). If the source text has the BARE form (common in running text after adjectives, in recipes, or in legal text), you MUST still add the indefinite article: source "respekt" → extract "en respekt", source "bostad" → extract "en bostad", source "utbildning" → extract "en utbildning", source "salt" → extract "ett salt", source "mjölk" → extract "en mjölk". A Scandi noun output WITHOUT "en"/"ett"/"ei" prefix is ALWAYS wrong. This applies even when you are translating into another Scandinavian language, into a Slavic language (pl, cs), into Italian/French/Romance, or into any other native — never, ever, drop the Scandi indefinite article from the "original" field.`;

/** v2 Scandi noun rule — source-preserving per the 2026-04-23 matrix.
 *
 *  Reverses the v1 "ALWAYS prepend INDEFINITE article" normalisation. The LLM
 *  now keeps the article category of the FIRST occurrence, with bare forms
 *  defaulting to indefinite-prefix. This lets DE-native learners studying
 *  Swedish see "hunden" on their vocabulary card when the text said "hunden",
 *  rather than having it silently rewritten to "en hund". */
const SCANDINAVIAN_NOUN_RULE_V2 = `- IMPORTANT — for Swedish (sv), Norwegian (no), and Danish (da), definiteness is marked as a noun SUFFIX, not a prepositive article. Preserve the article category of the FIRST occurrence of each noun:
  • SUFFIX-DEFINITE source (text shows e.g. "hunden", "bogen", "bilden", "folket"): emit as-is with source_cat="def".
  • INDEFINITE-PREFIX source (text shows "en hund", "ett språk", "ei bok"): emit with the prefix, source_cat="indef".
  • BARE source (text shows just "hund", "salt", "mjölk" — typical in recipes, legal text, or after adjectives): prepend the indefinite article by grammatical gender ("en" common / "ett" neuter sv / "ei" feminine no), source_cat="bare".
Never emit a Scandi noun that is bare of BOTH a suffix-definite marker AND an indefinite prefix. Apply this regardless of native language and text genre.`;

/** Polish and Czech have no articles at all. The generic "ALWAYS include
 *  the direct article" line is vacuous for them — there is no article to
 *  include. We make it explicit so small models don't try to prepend a
 *  non-existent article or switch languages (e.g. slipping a Russian,
 *  German, or — observed in the 2026-04-21 validation-B run — a
 *  Portuguese "o" / "a" article in front of Polish m/f pairs like
 *  "o Europejczyk, Europejka". See CLAUDE.md Rule 41. */
const SLAVIC_NOUN_RULE = `- IMPORTANT — for Polish (pl) and Czech (cs), these languages have NO articles at all. In the "original" field, emit nouns in the BARE singular nominative form — NEVER prepend any article or determiner. This applies to SINGLE entries AND to m/f pairs: write "Europejczyk, Europejka" (not "o Europejczyk, Europejka"), "mieszkaniec, mieszkanka" (not "o mieszkaniec, mieszkanka"), "tekst" (not "ten tekst"), "vedení" (not "to vedení"). Never borrow an article from another language (no Portuguese "o"/"a", no German "der"/"die", no English "the"). This OVERRIDES the generic "include article" rule above for these two languages.`;

/** English is treated like the Germanic/Romance group: always prepend the
 *  definite article "the" to the singular noun. This keeps the extraction
 *  output shape consistent across languages in the app (every de/fr/es/it/
 *  pt/nl/en noun carries a prefix) and matches user expectation — a
 *  vocabulary card shows "the house" / "der Hund" / "le chat", not a mix
 *  of bare and article forms. The classifier's ARTICLE_PREFIXES already
 *  handles "the"/"a"/"an" stripping during lookup, so consistency on the
 *  output side is free. */
const ENGLISH_NOUN_RULE = `- IMPORTANT — for English (en), ALWAYS prepend the definite article "the" to the noun in singular form. Examples: "the house", "the child", "the book". Never emit a bare noun; never use the indefinite articles "a" or "an" in the "original" field (the lemma always takes "the").`;

/** v2 English noun rule — source-preserving per the 2026-04-23 matrix.
 *  Reverses v1's "always 'the'" enforcement so that "a dog" stays "a dog"
 *  when the source text used the indefinite article. */
const ENGLISH_NOUN_RULE_V2 = `- IMPORTANT — for English (en), preserve the article category of the FIRST occurrence of each noun:
  • DEF source ("the dog"): emit "the dog" with source_cat="def".
  • INDEF source ("a dog"/"an apple"): emit "a dog" with source_cat="indef".
  • BARE source (headlines "Dog bites man", or bare mass nouns): emit with "a"/"an", source_cat="bare".
Never emit a bare English noun in the "original" field — always carry "the" or "a"/"an".`;

const CRITICAL_NOUN_RULE_BY_LANG: Record<string, string> = {
  sv: SCANDINAVIAN_NOUN_RULE,
  no: SCANDINAVIAN_NOUN_RULE,
  da: SCANDINAVIAN_NOUN_RULE,
  pl: SLAVIC_NOUN_RULE,
  cs: SLAVIC_NOUN_RULE,
  en: ENGLISH_NOUN_RULE,
};

/** v2 variant of the above lookup. pl/cs keep the same rule (no articles);
 *  Scandi + English switch to source-preserving variants. */
const CRITICAL_NOUN_RULE_BY_LANG_V2: Record<string, string> = {
  sv: SCANDINAVIAN_NOUN_RULE_V2,
  no: SCANDINAVIAN_NOUN_RULE_V2,
  da: SCANDINAVIAN_NOUN_RULE_V2,
  pl: SLAVIC_NOUN_RULE,
  cs: SLAVIC_NOUN_RULE,
  en: ENGLISH_NOUN_RULE_V2,
};

// ─── v2 fragment builders ─────────────────────────────────────────────
// Source-preserving extraction + matrix translation targets. Kept as
// siblings of the v1 builders so the v1 code paths stay regex-intact for
// the existing architecture tests.

/** v2 CRITICAL header — source-preserving per learn-lang article system. */
function buildCriticalHeaderV2(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.artCat === 'bare') {
    // pl/cs — no articles exist; unchanged from v1
    return `CRITICAL FORMATTING RULE: Extract each noun in its ${ex.name} dictionary base form. Example: "${ex.nounLemma}".`;
  }
  if (ex.artCat === 'indef') {
    // Scandi — show both def-suffix and indef-prefix canonical examples
    return `CRITICAL FORMATTING RULE: Every ${ex.name} noun MUST be extracted in the form matching its FIRST occurrence in the source — suffix-definite (e.g. "${ex.nounDef}") or indefinite-prefix (e.g. "${ex.nounLemma}"). Bare source forms default to the indefinite prefix.`;
  }
  // Articled — show both def and indef canonical examples
  return `CRITICAL FORMATTING RULE: Every noun MUST include its article, matching the article used at its FIRST occurrence in the source text. Example for ${ex.name}: DEF "${ex.nounLemma}" or INDEF "${ex.nounIndef}". Never emit a bare noun.`;
}

/** v2 noun+verb rule — articled langs preserve source article category. */
function buildNounVerbRulesV2(learnCode: string): string {
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

/** v2 translation rule — matrix-accurate, shows DEF + INDEF source examples. */
function buildTranslationRuleV2(learnCode: string, nativeCode: string): string {
  const learnEx = getLangExamples(learnCode);
  const nativeEx = getLangExamples(nativeCode);
  if (nativeEx.artCat === 'bare') {
    // Articleless native: always bare regardless of source
    return `- "translation" field for NOUN entries: ${nativeEx.name} has no articles — translation is always bare. Example: any ${learnEx.name} source → "${nativeEx.nounBare}".`;
  }
  const defTarget = matrixTranslationTarget('def', nativeCode);
  const indefTarget = matrixTranslationTarget('indef', nativeCode);
  if (learnEx.artCat === 'bare') {
    // Learn is pl/cs: source is always bare, translate to native's INDEF
    return `- "translation" field for NOUN entries: ${learnEx.name} has no articles (source is always bare), so translate to the ${nativeEx.name} indefinite form. Example: "${learnEx.nounLemma}" → "${indefTarget}".`;
  }
  // Articled or Scandi learn: show DEF-source→def-target and INDEF-source→indef-target
  const learnDefExample = learnEx.artCat === 'indef' ? learnEx.nounDef! : learnEx.nounLemma;
  const learnIndefExample = learnEx.artCat === 'indef' ? learnEx.nounLemma : learnEx.nounIndef!;
  return `- "translation" field for NOUN entries: mirror the source's article category into ${nativeEx.name}:
  • DEF source ("${learnDefExample}") → "${defTarget}" (${nativeEx.name} def).
  • INDEF source ("${learnIndefExample}") → "${indefTarget}" (${nativeEx.name} indef).
  • BARE source → "${indefTarget}" (${nativeEx.name} indef — bare mirrors to indef).`;
}

/** v2 JSON example — adds source_cat field; DEF-source shape for the noun. */
function buildJsonExampleV2(learnCode: string, nativeCode: string): string {
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

// ─── v3 fragment builders ─────────────────────────────────────────────
// Slice 7b.3 — v3 re-balances type emphasis after the v2 sweep revealed
// noun-over-classification (Italian carbonara: 36/36 typed 'noun', 0
// verbs). v3's type rules live in 4 CAPS-headed symmetric blocks so the
// LLM sees noun/verb/adjective/phrase as equal-weight categories. v2
// semantics (source-preserving extraction + matrix translation) are
// carried over unchanged.

/** v3 noun rule — matches v2's source-preserving logic but shorter,
 *  moved into its own NOUN EXTRACTION block. For articled learn langs
 *  it compactly lists the three source_cat cases; for Scandi and
 *  articleless it defers to SCANDINAVIAN_NOUN_RULE_V3 / SLAVIC_NOUN_RULE
 *  rendered separately in buildVocabSystemPrompt so the NOUN block
 *  stays focused. */
function buildNounRuleV3(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.artCat === 'bare') {
    // pl/cs — SLAVIC_NOUN_RULE handles it; the NOUN block stays bare.
    return `Emit each noun in its ${ex.name} bare singular nominative base form (e.g. "${ex.nounLemma}"). ${ex.name} has no articles.`;
  }
  if (ex.artCat === 'indef') {
    // Scandi — defer to the scandi-specific block; summarise here.
    return `Preserve the article category of the FIRST occurrence: suffix-definite (e.g. "${ex.nounDef}" = source_cat="def"), indefinite-prefix (e.g. "${ex.nounLemma}" = source_cat="indef"), or bare source → prepend indefinite (source_cat="bare"). See Scandi-specific rule block below for the full suffix / prefix / gender detail.`;
  }
  // Articled — compact 3-case rule.
  return `Preserve the article category of the FIRST occurrence. ${ex.name}: DEF "${ex.nounLemma}" (source_cat="def"), INDEF "${ex.nounIndef}" (source_cat="indef"), or bare source → default to "${ex.nounIndef}" (source_cat="bare"). If a distinct feminine form exists, add it after a comma.`;
}

/** v3 verb rule — promoted to its own VERB EXTRACTION block, no longer
 *  a trailing bullet on the noun rule. The Slice-7b.2 investigation
 *  showed that v2's noun-heavy prose caused the LLM to drop verb
 *  extraction entirely on noun-dense text. Making the verb rule a
 *  peer-level block restores balance. The "normalise to infinitive"
 *  wording is intentional — v2's "never conjugated" phrasing was
 *  observed on the carbonara sweep to trigger skip-the-verb instead
 *  of normalise-to-infinitive behaviour on imperative-heavy recipe
 *  text (zero verbs extracted from "aggiungi/taglia/..."). */
function buildVerbRuleV3(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  const reflexive = ex.verbReflexive
    ? ` Reflexive verbs carry the pronoun: "${ex.verbReflexive}".`
    : '';
  return `Every verb that appears in the source — regardless of its surface form (conjugated, past participle, imperative, gerund, subjunctive, …) — MUST be extracted as its INFINITIVE lemma in the "original" field. Do NOT skip verbs because they appear in a non-infinitive form; normalise them. ${ex.name}: "${ex.verbInf}" (never "${ex.verbWrong}", never any tense / person / mood surface form).${reflexive} For every verb entry set source_cat="bare". Imperatives in recipes, instructions, and directives count as verbs — extract their infinitive lemma.`;
}

/** v3 adjective rule — mirror of v2 logic but promoted to its own block. */
function buildAdjRuleV3(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.adjMFPair) {
    return `Give BOTH masculine AND feminine forms when they differ in ${ex.name} (e.g. "${ex.adjMFPair}"). Romance languages inflect by gender; never drop one form. For every adjective entry set source_cat="bare".`;
  }
  const counter = ex.adjInflected
    ? ` (e.g. "${ex.adjSingle}" not "${ex.adjSingle}, ${ex.adjInflected}" — inflected forms belong in source_forms)`
    : ` (e.g. "${ex.adjSingle}")`;
  return `Emit the SINGLE dictionary base form only${counter}. ${ex.name} does not inflect adjectives by gender at the lexeme level. For every adjective entry set source_cat="bare".`;
}

/** v3 phrase rule — new dedicated block, briefly gates on "multi-word
 *  fixed expression" so the LLM doesn't dump full sentences. */
function buildPhraseRuleV3(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  return `Extract multi-word fixed expressions (idioms, collocations, set phrases) only. Example for ${ex.name}: "${ex.phraseExample}". Do NOT emit full sentences or clauses. For every phrase entry set source_cat="bare".`;
}

/** v3 Scandi noun rule — same source-preserving logic as v2 but the
 *  prose is tightened: bare-source default to INDEF-prefix is mentioned
 *  once, not repeated. Neutrum/feminine gender rule kept. */
const SCANDINAVIAN_NOUN_RULE_V3 = `Scandi languages mark definiteness as a SUFFIX (sv/no/da). Extract each noun in the form matching its FIRST occurrence in the source:
  (a) SUFFIX-DEFINITE in text (e.g. "hunden", "bogen", "folket") → emit as-is, source_cat="def".
  (b) INDEF-PREFIX in text (e.g. "en hund", "ett språk", "ei bok", "et år") → emit with prefix, source_cat="indef".
  (c) BARE in text (recipes, legal, after adjectives) → prepend indefinite by gender: "en" (common sg/pl), "ett" (sv neuter), "et" (no/da neuter), "ei" (no feminine). source_cat="bare".
Never emit a Scandi noun that carries neither a suffix-definite marker nor an indefinite prefix.`;

/** v3 English noun rule — same source-preserving logic as v2, compact. */
const ENGLISH_NOUN_RULE_V3 = `English (en) nouns: preserve article category of the FIRST occurrence. DEF "the dog" (source_cat="def"), INDEF "a dog"/"an apple" (source_cat="indef"), bare source → default to "a"/"an" (source_cat="bare"). Never emit a bare English noun in the "original" field.`;

const CRITICAL_NOUN_RULE_BY_LANG_V3: Record<string, string> = {
  sv: SCANDINAVIAN_NOUN_RULE_V3,
  no: SCANDINAVIAN_NOUN_RULE_V3,
  da: SCANDINAVIAN_NOUN_RULE_V3,
  pl: SLAVIC_NOUN_RULE,
  cs: SLAVIC_NOUN_RULE,
  en: ENGLISH_NOUN_RULE_V3,
};

/** v3 CRITICAL header — identical to v2 logic but renamed for consistency. */
function buildCriticalHeaderV3(learnCode: string): string {
  return buildCriticalHeaderV2(learnCode);
}

/** v3 translation rule — two fixes vs v2:
 *  (1) Scandi-INDEF source → articled-native INDEF (strict anti-drift
 *      against v2's observed "en makt → die Macht" dictionary-lemma
 *      leakage). The example explicitly names the wrong target.
 *  (2) Bare-source → articled-/Scandi-native INDEF BY DEFAULT, but
 *      abstract/mass nouns are permitted to stay bare in the target if
 *      that is the natural dictionary form ("likestilling → equality"
 *      not forced to "un'equaglianza"). Prevents stilted translations
 *      for abstract vocabulary. */
function buildTranslationRuleV3(learnCode: string, nativeCode: string): string {
  const learnEx = getLangExamples(learnCode);
  const nativeEx = getLangExamples(nativeCode);

  if (nativeEx.artCat === 'bare') {
    // Articleless native (pl/cs) — always bare, unchanged from v2.
    return `${nativeEx.name} has no articles. Translation is always bare regardless of source article category. Example: any ${learnEx.name} source → "${nativeEx.nounBare}".`;
  }

  const defTarget = matrixTranslationTarget('def', nativeCode);
  const indefTarget = matrixTranslationTarget('indef', nativeCode);
  const massNounNote = ` For abstract / mass / uncountable nouns (freedom, equality, respect, water, information) whose natural dictionary form in ${nativeEx.name} goes bare, emit bare — do NOT force an indefinite article where it would read as stilted (e.g. do not force "un'uguaglianza" when "uguaglianza" is conventional).`;

  if (learnEx.artCat === 'bare') {
    // pl/cs source → default INDEF in articled/scandi native, with mass-noun allowance.
    return `${learnEx.name} has no articles (source is always bare). Translate to the ${nativeEx.name} INDEFINITE form by default. Example: "${learnEx.nounLemma}" → "${indefTarget}".${massNounNote}`;
  }

  if (learnEx.artCat === 'indef') {
    // Scandi source — critical strict-mirror block with anti-example.
    return `Scandi INDEF source ("en"/"ett"/"ei"/"et" prefix, e.g. "${learnEx.nounLemma}") MUST map to the ${nativeEx.name} INDEFINITE category — NEVER the definite. DEF source ("${learnEx.nounDef}") maps to ${nativeEx.name} definite. Examples: DEF "${learnEx.nounDef}" → "${defTarget}"; INDEF "${learnEx.nounLemma}" → "${indefTarget}" (NOT "${defTarget}"). BARE source → "${indefTarget}".${massNounNote}`;
  }

  // Articled learn (de/fr/es/it/pt/nl/en) — standard mirror, with mass-noun allowance.
  const learnDef = learnEx.nounLemma;
  const learnIndef = learnEx.nounIndef!;
  return `Mirror the source's article category into ${nativeEx.name}. DEF "${learnDef}" → "${defTarget}". INDEF "${learnIndef}" → "${indefTarget}". BARE source → "${indefTarget}".${massNounNote}`;
}

/** v3 JSON example — identical shape to v2. */
function buildJsonExampleV3(learnCode: string, nativeCode: string): string {
  return buildJsonExampleV2(learnCode, nativeCode);
}

/**
 * Rule 42: translation article category follows the original's
 * grammatical definiteness, mapped onto the native language's own
 * article system. Three branches:
 *   - Definite original → native's definite form (bare if native
 *     has no articles, e.g. pl/cs).
 *   - Indefinite original (Scandi en/ett/ei per Rule 34) → native's
 *     indefinite form (bare if native has no articles).
 *   - Bare original (pl/cs per Rule 41 — no articles exist in those
 *     languages) → native's DEFAULT dictionary convention: definite
 *     for de/fr/es/it/pt/nl/en, indefinite en/ett/ei for Scandi, bare
 *     only for the article-less pair (cs↔pl).
 *
 * The bare-fallback in the third branch matches standard bilingual-
 * dictionary typography: a DE-PL dictionary shows `das Abitur — matura`
 * (article on the article-having side), and a PL-DE dictionary should
 * show `matura — das Abitur`, not `matura — Abitur`. An earlier
 * iteration had bare→bare on every native, which produced article-less
 * German and Romance translations that read as typos (`matura → Abitur`,
 * `pies → Hund`). See CLAUDE.md Rule 42.
 */
export function buildVocabSystemPrompt(
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: string,
  nativeLanguageCode: string,
  version: PromptVersion = defaultPromptVersion(),
): string {
  // CEFR classification is no longer the LLM's job — it is handled
  // deterministically by lib/classifier after extraction. The LLM only
  // needs to extract and format the words.
  if (version === 'v2') {
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
  if (version === 'v3') {
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
  // v1 path — unchanged baseline, byte-identical to pre-Slice-2.
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

export async function extractVocabulary(
  text: string,
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: SupportedLanguage,
  nativeLanguageCode?: string,
): Promise<ExtractedVocab[]> {
  const chunks = chunkText(text);
  const allVocabs: ExtractedVocab[] = [];

  for (const chunk of chunks) {
    const systemPrompt = buildVocabSystemPrompt(
      nativeLanguageName,
      learningLanguageName,
      learningLanguageCode,
      nativeLanguageCode ?? 'en',
    );
    const responseText = await callClaude([{ role: 'user', content: chunk }], systemPrompt, 8192, {
      temperature: 0,
    });

    const arrayStart = responseText.indexOf('[');
    if (arrayStart === -1) {
      console.warn('No JSON array in vocabulary response:', responseText.substring(0, 200));
      continue;
    }

    // First try: parse from first '[' to last ']' (handles complete responses)
    let parsed: ExtractedVocab[] | null = null;
    const lastBracket = responseText.lastIndexOf(']');
    if (lastBracket > arrayStart) {
      try {
        parsed = JSON.parse(responseText.substring(arrayStart, lastBracket + 1));
      } catch {
        // fall through to repair
      }
    }

    // Repair fallback: truncate after the last fully completed top-level object
    if (!parsed) {
      try {
        const tail = responseText.substring(arrayStart);
        // Walk through and track brace depth to find completed top-level objects
        let depth = 0;
        let inString = false;
        let escape = false;
        let lastTopLevelCloseIdx = -1;
        for (let i = 0; i < tail.length; i++) {
          const c = tail[i];
          if (escape) {
            escape = false;
            continue;
          }
          if (c === '\\') {
            escape = true;
            continue;
          }
          if (c === '"') {
            inString = !inString;
            continue;
          }
          if (inString) continue;
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) lastTopLevelCloseIdx = i;
          }
        }
        if (lastTopLevelCloseIdx !== -1) {
          const repaired = tail.substring(0, lastTopLevelCloseIdx + 1) + ']';
          parsed = JSON.parse(repaired);
        }
      } catch {
        console.warn('Failed to repair vocabulary response:', responseText.substring(0, 300));
      }
    }

    if (parsed && Array.isArray(parsed)) {
      // Diagnostic: warn when the parsed array contains ≥3 consecutive
      // identical (original, type) entries — the hallmark of the repetition
      // loop failure mode observed in the 2026-04-20 sweep (être × 37,
      // la perfetta × 39). postProcessExtractedVocab collapses them to one
      // entry; the log surfaces prompt drift in production.
      let run = 0;
      let runKey = '';
      for (const v of parsed) {
        const key = (v as { original?: string }).original + '|' + (v as { type?: string }).type;
        if (key === runKey) {
          run++;
          if (run === 3) {
            console.warn(
              `[extractVocabulary] repetition loop detected for "${(v as { original?: string }).original}" (${learningLanguageCode} → ${nativeLanguageCode ?? '?'}); dedup will collapse it to one entry`,
            );
          }
        } else {
          run = 1;
          runKey = key;
        }
      }
      allVocabs.push(...parsed);
    }
  }

  // Post-processing: drop abbreviations, likely proper nouns, multi-word
  // noun leaks; deduplicate on (original, type); capitalise German noun
  // translations. Pure, offline. Architecture rule 21 enforces this call site.
  const filtered = postProcessExtractedVocab(
    allVocabs,
    learningLanguageCode,
    nativeLanguageCode ?? '',
  );
  allVocabs.length = 0;
  allVocabs.push(...filtered);

  // Slice 3/7: under v1 the LLM isn't asked for source_cat — strip any
  // incidental field so v1 callers get a clean shape. Under v2 keep it;
  // it's consumed by the sweep's Translation-Target Match Rate metric.
  if (defaultPromptVersion() === 'v1') {
    for (const vocab of allVocabs) {
      delete (vocab as { source_cat?: unknown }).source_cat;
    }
  }

  // Deterministic CEFR classification via lib/classifier — the LLM no longer
  // assigns levels. High/medium-confidence words resolve synchronously.
  for (const vocab of allVocabs) {
    try {
      vocab.level = await classifyWord(vocab.original, learningLanguageCode, callClaude);
    } catch (err) {
      console.warn(
        `[claude] classifyWord failed for "${vocab.original}" (${learningLanguageCode}):`,
        (err as Error).message,
      );
      vocab.level = 'B1';
    }
  }

  return allVocabs;
}

export async function translateText(
  text: string,
  fromLanguageName: string,
  toLanguageName: string,
): Promise<string> {
  const chunks = chunkText(text);
  const translations: string[] = [];

  for (const chunk of chunks) {
    const systemPrompt = `You are a professional translator. Translate the following text from ${fromLanguageName} to ${toLanguageName}. Return only the translation, without any additional explanation.`;
    const result = await callClaude([{ role: 'user', content: chunk }], systemPrompt);
    translations.push(result);
  }

  return translations.join('\n\n');
}

// NB: TranslateSingleWordResult (extracted to a type alias so the
// translateSingleWord signature stays single-line — the Rule-27/42
// regex is non-greedy up to the first `\n}`) now lives in
// lib/claude/types.ts. Re-exported at the top of this file.

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
  // v1 path FIRST so the Rule-27/42 architecture tests (which regex-scan the
  // function body non-greedily up to the first `\n}`) see the v1 builder
  // names (`buildCriticalHeader(fromLanguageCode)`, etc.) verbatim.
  const scandiRule = CRITICAL_NOUN_RULE_BY_LANG[fromLanguageCode] ?? '';
  const systemPromptV1 = `You are a language teacher assistant. The user sends a word or phrase in ${fromLanguageName} — it may be inflected, conjugated, or in plural form. Your job: determine the dictionary base form, translate it into ${toLanguageName}, and identify its word type.

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
  const scandiRuleV2 = CRITICAL_NOUN_RULE_BY_LANG_V2[fromLanguageCode] ?? '';
  const systemPromptV2 = `You are a language teacher assistant. The user sends a word or phrase in ${fromLanguageName} — it may be inflected, conjugated, or in plural form. Your job: determine the dictionary base form, translate it into ${toLanguageName}, identify its word type, and record the article category of the input.

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
  // Single-word extraction doesn't suffer from the type-classification
  // drift that motivated v3 (there's only one input word). Route v3 →
  // v2 here so the Pro long-press translate flow stays on stable v2
  // semantics. v3 is a bulk-extraction-specific variant.
  const systemPrompt = version === 'v1' ? systemPromptV1 : systemPromptV2;

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

// Re-export for callers that need the classifier's supported-language type.
export type { SupportedLanguage } from './classifier';
