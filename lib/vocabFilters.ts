/**
 * Pure post-processing helpers for LLM-extracted vocabulary.
 *
 * Three concerns, all deterministic and offline:
 *   1. Drop all-caps abbreviations (GNR, DLRG, IRS).
 *   2. Drop likely proper nouns the LLM let through, in non-German learning
 *      languages (German nouns are always capitalised so the heuristic
 *      cannot distinguish them and we trust the LLM there).
 *   3. Capitalise German noun translations (article-aware, Unicode-aware).
 *
 * Architecture rule 22 forbids any I/O / database / network imports here.
 * Keep this module a pure function library so tests stay fast and the
 * batch-classification scripts can reuse it.
 */

import { STRIP_PREFIX } from './vocabSort';

interface VocabLike {
  original: string;
  translation: string;
  type: string;
}

/** Strip leading article(s) so we look at the noun itself. */
function stripArticles(s: string): string {
  let out = s.trim();
  // The STRIP_PREFIX regex only matches one prefix; loop in case there are
  // stacked articles (rare but possible after mid-extraction edits).
  while (true) {
    const next = out.replace(STRIP_PREFIX, '').trim();
    if (next === out) return out;
    out = next;
  }
}

/**
 * True when the word is a likely abbreviation: 2+ characters, all letters
 * uppercase, no lowercase letter present. Digits allowed (so "B2B" matches).
 *
 * We test the *first comma-separated form* after stripping articles — many
 * LLM responses give a single token for abbreviations anyway, but we want
 * to be safe for the edge "GNR, GNR" case.
 */
export function isAbbreviation(original: string | undefined): boolean {
  if (!original) return false;
  const first = original.split(',')[0] ?? '';
  const base = stripArticles(first);
  if (base.length < 2) return false;
  // Must contain at least one letter, no lowercase letter, and only letters
  // or digits (no spaces, no dots — "U.S.A." is a different shape we leave
  // to the LLM).
  if (!/^[\p{Lu}\p{N}]+$/u.test(base)) return false;
  if (/\p{Ll}/u.test(base)) return false;
  if (!/\p{Lu}/u.test(base)) return false;
  return true;
}

/**
 * Heuristic: in non-German learning languages, drop bare single-word
 * capitalised entries — these are almost always proper nouns the LLM let
 * through despite being told to ignore them ("Maria", "Berlin", "Lisboa").
 *
 * Why "bare"? Our prompt forces the LLM to add an article in front of every
 * common noun. If a capitalised word arrives WITHOUT a leading article, it
 * is overwhelmingly a proper noun. Common nouns (which carry an article
 * after extraction, e.g. "die Gemütlichkeit") are kept even when they
 * appear in a non-German learning-language stream. This avoids wiping out
 * legitimate cross-lingual entries while still catching the "Maria, João,
 * Berlin" mistake class.
 *
 * German is excluded entirely because every German common noun is
 * capitalised — the heuristic cannot distinguish there.
 */
export function isLikelyProperNoun(
  original: string | undefined,
  learningLangCode: string,
): boolean {
  if (!original) return false;
  if (learningLangCode === 'de') return false;
  const first = (original.split(',')[0] ?? '').trim();
  if (!first) return false;
  // If an article exists, the LLM treated this as a common noun — keep it.
  const stripped = first.replace(STRIP_PREFIX, '').trim();
  if (stripped !== first) return false;
  // Multi-word bare entries are usually fixed expressions — keep them too.
  if (/\s/.test(first)) return false;
  const firstChar = first.charAt(0);
  return firstChar === firstChar.toLocaleUpperCase() && firstChar !== firstChar.toLocaleLowerCase();
}

/**
 * Capitalise the noun part of a German translation, preserving any leading
 * article. Works on multi-form strings ("der arzt, die ärztin" →
 * "der Arzt, die Ärztin") and Unicode (umlauts, ß).
 *
 * No-op when type is not "noun" or when the input is already capitalised.
 */
export function capitaliseGermanNouns(translation: string | undefined, type?: string): string {
  if (!translation) return translation ?? '';
  if (type !== 'noun') return translation;
  return translation
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return part;
      const articleMatch = trimmed.match(STRIP_PREFIX);
      const article = articleMatch ? articleMatch[0] : '';
      const noun = trimmed.slice(article.length);
      if (!noun) return part;
      const capitalised = noun.charAt(0).toLocaleUpperCase('de-DE') + noun.slice(1);
      // Preserve original surrounding whitespace by reassembling from
      // `trimmed` then re-prefixing the original leading whitespace.
      const leadingWs = part.match(/^\s*/)?.[0] ?? '';
      const trailingWs = part.match(/\s*$/)?.[0] ?? '';
      return `${leadingWs}${article}${capitalised}${trailingWs}`;
    })
    .join(',');
}

/**
 * Single integration point: filters out abbreviations + likely proper nouns
 * and applies German capitalisation to the translation field. Returns a new
 * array; does not mutate input.
 *
 * Called from extractVocabulary() and (selectively) translateSingleWord().
 */
export function postProcessExtractedVocab<T extends VocabLike>(
  items: T[],
  learningLangCode: string,
  nativeLangCode: string,
): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (isAbbreviation(item.original)) continue;
    if (isLikelyProperNoun(item.original, learningLangCode)) continue;
    if (nativeLangCode === 'de') {
      out.push({ ...item, translation: capitaliseGermanNouns(item.translation, item.type) });
    } else {
      out.push(item);
    }
  }
  return out;
}
