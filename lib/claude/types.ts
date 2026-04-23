/**
 * Shared types for the Claude/Mistral module.
 *
 * Phase 2 struktur-refactor extracted these from the monolithic
 * `lib/claude.ts` (Slice 1). Semantics unchanged; only the file
 * boundary moved.
 */

/**
 * Prompt-version toggle for the Matrix-Regel A/B.
 *
 * v1 = pre-Matrix-Regel baseline (always force DEF for articled langs,
 * always force INDEF-prefix for Scandi). Kept for emergency rollback.
 * v2 = Matrix-Regel (source-preserving extraction + matrix translation
 * targets). Production default since Slice 7 / 2026-04-23.
 * v3 = Re-balanced prompt with symmetric NOUN/VERB/ADJ/PHRASE blocks.
 * Opt-in via env; has a known regression on Scandi prefix compliance
 * so not merged as default (see Slice 7b.4 report).
 */
export type PromptVersion = 'v1' | 'v2' | 'v3';

/** Article category of the source occurrence per the Matrix-Regel.
 *  Only meaningful for noun entries; verb/adj/phrase entries always
 *  carry "bare". */
export type ArticleCategory = 'def' | 'indef' | 'bare';

/** A single extracted vocabulary entry as returned by `extractVocabulary`
 *  and consumed by post-processing + DB insertion. source_cat is
 *  pipeline-only metadata (not persisted to SQLite). */
export interface ExtractedVocab {
  original: string;
  translation: string;
  level: string;
  type: 'noun' | 'verb' | 'adjective' | 'phrase' | 'other';
  source_forms: string[];
  /** Matrix-Regel: article category of the first occurrence in the
   *  source text, as reported by the LLM. Present only under v2/v3;
   *  stripped in v1 mode. */
  source_cat?: ArticleCategory;
}

/** Return shape of `translateSingleWord`. Carries the same source_cat
 *  metadata as bulk extraction. */
export type TranslateSingleWordResult = {
  original: string;
  translation: string;
  level: string;
  type: string;
  source_cat?: ArticleCategory;
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
