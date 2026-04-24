/**
 * Shared types for the Claude/Mistral module.
 *
 * Phase 2 struktur-refactor extracted these from the monolithic
 * `lib/claude.ts` (Slice 1). Semantics unchanged; only the file
 * boundary moved.
 */

/** A single extracted vocabulary entry as returned by `extractVocabulary`
 *  and consumed by post-processing + DB insertion.
 *
 *  Pure-INDEF extraction (Rule 47, revised): every noun is emitted in its
 *  INDEFINITE form (article-tagged for articled langs, indef-prefixed for
 *  Scandi, bare for pl/cs) regardless of how it appeared in the source.
 *  The prior `source_cat` metadata field has been removed. */
export interface ExtractedVocab {
  original: string;
  translation: string;
  level: string;
  type: 'noun' | 'verb' | 'adjective' | 'phrase' | 'other';
  source_forms: string[];
}

/** Return shape of `translateSingleWord`. */
export type TranslateSingleWordResult = {
  original: string;
  translation: string;
  level: string;
  type: string;
};

/** Transport message shape — Claude Messages API format (translated by
 *  the Fly backend proxy into Mistral chat format). Kept here so
 *  `prompt.ts`, `extract.ts`, `translateSingleWord.ts` can construct
 *  messages without pulling in `transport.ts`. */
export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
}

export interface ClaudeContentBlock {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

/** Internal transport response shape — Claude Messages API format. */
export interface ClaudeResponse {
  content: { type: string; text: string }[];
  error?: { message: string };
}

export interface CallClaudeOptions {
  temperature?: number;
}

/**
 * Per-language example bank used by the prompt builders. Each entry
 * holds the concrete lemma / counter-example shapes the LLM needs in
 * order to follow the extraction rules for THAT language only.
 *
 * Rule 46 (F11, 2026-04-22): the prompt must only carry examples in
 * the learning language of the current extraction and, for the
 * translation-side rule, in the native language. Centralising the
 * interface here keeps prompt.ts decoupled from the per-language
 * profile files under `./langs/`.
 */
export interface LangExamples {
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
