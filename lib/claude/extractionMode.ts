/**
 * Feature flag for extractVocabulary's execution mode.
 *
 * 'parallel' (default, shipped 2026-04-24):
 *   Split input text at 2500 chars and fire the per-chunk LLM calls
 *   concurrently via Promise.all. Pro-Mode 5000-char texts split into
 *   2 chunks, cutting wall-time by ~40-50% at ~+14% per-call API cost
 *   (the system prompt is sent twice). Cross-chunk duplicates are
 *   collapsed by postProcessExtractedVocab's (original, type) dedup.
 *
 * 'serial' (pre-2026-04-24 behaviour, kill-switch):
 *   Keep the text in a single 5000-char chunk and iterate chunks with
 *   for-await. Exists as a rollback path if a parallelisation-induced
 *   quality regression surfaces in production (cross-chunk context
 *   loss, dedup over-merging, LLM behaving differently on smaller
 *   inputs). Flip the const below and ship a new release to revert.
 *
 * No UI is exposed for this flag — it's a one-line kill-switch, not a
 * user setting. Both paths are covered by unit tests so either can be
 * activated without additional verification beyond `npm test`.
 */

export type ExtractionMode = 'parallel' | 'serial';

export const EXTRACTION_MODE: ExtractionMode = 'parallel';
