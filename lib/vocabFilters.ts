/**
 * Pure post-processing helpers for LLM-extracted vocabulary.
 *
 * Six concerns, all deterministic and offline:
 *   1. Drop all-caps abbreviations (GNR, DLRG, IRS).
 *   2. Drop likely proper nouns the LLM let through, in non-German learning
 *      languages (German nouns are always capitalised so the heuristic
 *      cannot distinguish them and we trust the LLM there).
 *   3. Drop multi-word noun-or-other entries where the LLM bundled an
 *      attributive adjective or a named entity with the noun
 *      ("le Real Madrid", "la British Broadcasting Corporation",
 *      "die öffentliche Gewalt"). Also catches 'other'-typed proper-noun
 *      leaks like "le Bayern Munich" that the LLM labelled 'other' rather
 *      than 'noun' to evade the older filter.
 *   4. Collapse spurious same-form m/f pairs ("grande, grande",
 *      "igual, igual", "fagfællebedømte, fagfællebedømte") down to a
 *      single form. Legitimate differing pairs ("haut, haute") untouched.
 *   5. Deduplicate entries within a single batch on (original, type) —
 *      catches both 2× copies and full repetition loops.
 *   6. Capitalise German noun translations (article-aware, Unicode-aware).
 *      Only the noun itself is capitalised; attributive adjectives before
 *      the noun stay lowercase (German orthography).
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
 * True when a noun (or 'other'-typed) entry looks like an attribute-
 * adjective-plus-noun concatenation or a multi-word proper-noun leak
 * (e.g. "le Real Madrid", "la British Broadcasting Corporation",
 * "die öffentliche Gewalt", "den offentliga makten"). The prompt asks
 * for "article + singular noun"; anything with two or more content
 * tokens after the article is either a proper noun the LLM let through
 * or an attributive phrase the LLM wrongly bundled.
 *
 * `type === 'other'` is included because the 2026-04-20 sweep showed
 * the LLM falling back to `other` specifically for proper-noun
 * compounds when it couldn't commit to 'noun' (`le Real Madrid` and
 * siblings across fr→{es,sv,da}). Applying the same multi-word check
 * to 'other' catches those leaks without touching legitimate
 * single-word 'other' entries.
 *
 * Single-word multi-form entries split by comma (e.g. "der Arzt, die
 * Ärztin") are analysed per-part, so they never trigger. Phrase and
 * verb entries are multi-word by design and not checked.
 */
export function isMultiWordNounLeak(
  original: string | undefined,
  type: string | undefined,
): boolean {
  if (!original) return false;
  if (type !== 'noun' && type !== 'other') return false;
  for (const rawPart of original.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const articleMatch = part.match(STRIP_PREFIX);
    const afterArticle = articleMatch ? part.slice(articleMatch[0].length) : part;
    if (/\s/.test(afterArticle.trim())) return true;
  }
  return false;
}

/**
 * Collapse a comma-separated m/f pair when both parts are identical
 * (case-insensitive). The CLAUDE.md vocab rule says "m + f forms if
 * they differ" — so `grande, grande` or `igual, igual` or
 * `fagfællebedømte, fagfællebedømte` are the LLM wrongly applying the
 * rule where the target language has no gender distinction. Strip to
 * the single form.
 *
 * Legitimate differing pairs stay untouched:
 *   - Different base forms  — `haut, haute`, `bonito, bonita`
 *   - Same base, different articles — `le médecin, la médecin` (gender-
 *     fluid profession where the noun itself doesn't inflect but the
 *     article signals gender). We deliberately do NOT strip articles
 *     before comparing; that would collapse these legitimate pairs.
 *
 * Works on both `original` and `translation` fields. Pure — returns the
 * input unchanged when nothing to do.
 */
export function collapseIdenticalFormPair(s: string | undefined): string {
  if (!s) return s ?? '';
  const parts = s.split(',').map((p) => p.trim());
  if (parts.length !== 2) return s;
  return parts[0].toLowerCase() === parts[1].toLowerCase() ? parts[0] : s;
}

/**
 * Capitalise the noun of a German translation, preserving any leading
 * article and keeping attribute adjectives lowercase. Works on multi-form
 * strings ("der arzt, die ärztin" → "der Arzt, die Ärztin") and Unicode
 * (umlauts, ß).
 *
 * Per German orthography the NOUN itself is capitalised; adjectives in
 * front of the noun stay lowercase ("die öffentliche Gewalt", not "die
 * Öffentliche Gewalt"). We therefore capitalise only the LAST non-whitespace
 * token after the article.
 *
 * No-op when type is not "noun" or when the input is already correctly cased.
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
      const afterArticle = trimmed.slice(article.length);
      if (!afterArticle) return part;
      // Split preserving whitespace so multi-word phrases keep their shape.
      // Capitalise only the LAST non-whitespace token — that's the noun.
      const tokens = afterArticle.split(/(\s+)/);
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (/\S/.test(tokens[i])) {
          tokens[i] = tokens[i].charAt(0).toLocaleUpperCase('de-DE') + tokens[i].slice(1);
          break;
        }
      }
      const leadingWs = part.match(/^\s*/)?.[0] ?? '';
      const trailingWs = part.match(/\s*$/)?.[0] ?? '';
      return `${leadingWs}${article}${tokens.join('')}${trailingWs}`;
    })
    .join(',');
}

/**
 * Single integration point: filters out abbreviations, likely proper nouns,
 * multi-word-noun leaks, and within-batch duplicates; applies German
 * capitalisation to the translation field. Returns a new array; does not
 * mutate input.
 *
 * Called from extractVocabulary() and (selectively) translateSingleWord().
 */
export function postProcessExtractedVocab<T extends VocabLike>(
  items: T[],
  learningLangCode: string,
  nativeLangCode: string,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    // Malformed item (missing original) — silently drop. Happens when the
    // LLM returns a truncated JSON object the parser accepted as `{}`.
    if (!item.original || typeof item.original !== 'string') continue;
    if (isAbbreviation(item.original)) continue;
    if (isLikelyProperNoun(item.original, learningLangCode)) continue;
    if (isMultiWordNounLeak(item.original, item.type)) continue;
    // Collapse spurious same-form m/f pairs where the target language has
    // no gender distinction ("grande, grande" → "grande"). Legitimate
    // differing pairs ("haut, haute") pass through unchanged.
    const collapsedOriginal = collapseIdenticalFormPair(item.original);
    const collapsedTranslation = collapseIdenticalFormPair(item.translation);
    // Batch-level dedup: same (original, type) within one extraction call is
    // always redundant. Catches 2× copies AND full repetition loops where
    // the LLM emits the same word 30+ times in a row. Keyed on the POST-
    // collapse original so "grande, grande" and a subsequent bare "grande"
    // dedup correctly.
    const key = collapsedOriginal.trim().toLowerCase() + '|' + (item.type ?? '');
    if (seen.has(key)) continue;
    seen.add(key);
    const staged: T =
      collapsedOriginal !== item.original || collapsedTranslation !== item.translation
        ? { ...item, original: collapsedOriginal, translation: collapsedTranslation }
        : item;
    if (nativeLangCode === 'de') {
      out.push({ ...staged, translation: capitaliseGermanNouns(staged.translation, staged.type) });
    } else {
      out.push(staged);
    }
  }
  return out;
}
