/**
 * Truncation utilities for Basic mode content limits. Pure TypeScript,
 * no external dependencies. See docs/superpowers/specs/2026-04-14-basic-pro-mode-design.md.
 */

export const BASIC_MODE_CHAR_LIMIT = 2000;

/** Characters that end a sentence. */
const SENTENCE_ENDINGS = new Set(['.', '!', '?', '…']);
/** Closing punctuation that may follow a sentence ending and is kept with it. */
const CLOSERS = new Set(['"', "'", '»', ')', ']']);

/**
 * Truncates `text` to roughly `maxChars`, preferring a sentence boundary and
 * falling back to a word boundary. The returned text is trimmed of trailing
 * whitespace. When a word boundary is used, the result may exceed `maxChars`
 * by up to the length of the straddling word.
 */
export function truncateAtSentence(
  text: string,
  maxChars: number = BASIC_MODE_CHAR_LIMIT,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };

  // 1) Last sentence-ending punctuation at or before maxChars
  const head = text.slice(0, maxChars);
  for (let i = head.length - 1; i >= 0; i--) {
    const ch = head[i];
    if (SENTENCE_ENDINGS.has(ch)) {
      // Optionally include a trailing closer (e.g. the `"` in `."`)
      let end = i;
      if (end + 1 < text.length && CLOSERS.has(text[end + 1])) {
        end = end + 1;
      }
      return { text: text.slice(0, end + 1).trimEnd(), truncated: true };
    }
  }

  // 2) Fall back to the next whitespace at or after maxChars
  for (let i = maxChars; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      return { text: text.slice(0, i).trimEnd(), truncated: true };
    }
  }

  // 3) Pathological: single long token, nothing to cut.
  return { text, truncated: true };
}

/** Applies the Basic-mode truncation only when `proMode` is false. */
export function applyBasicLimit(
  text: string,
  proMode: boolean,
): { text: string; truncated: boolean } {
  if (proMode) return { text, truncated: false };
  return truncateAtSentence(text);
}
