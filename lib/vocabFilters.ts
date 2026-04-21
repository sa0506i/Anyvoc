/**
 * Pure post-processing helpers for LLM-extracted vocabulary.
 *
 * All deterministic and offline:
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
 *   7. Collapse adjective m/f pairs in non-Romance learning languages
 *      ("dünn, dünne" → "dünn" for de/nl/sv/no/da/pl/cs). Romance pairs
 *      ("beau, belle") stay untouched. See CLAUDE.md Rule 38.
 *   8. Drop non-infinitive verbs ("installiert", "morreu", "distingue") —
 *      the LLM occasionally emits conjugated / past-participle forms as
 *      type=verb. Per-language regex mirrors scripts/compare-sweeps.ts
 *      isInfinitive. See CLAUDE.md Rule 39.
 *   9. Normalise typographic apostrophes (\u2019 → ') in original and
 *      source_forms so "l\u2019année" and "l'année" dedup correctly and
 *      both hit the classifier's apostrophe-strip. See CLAUDE.md Rule 40.
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
 * Languages whose adjectives do NOT carry gender in the dictionary base
 * form. For these, the prompt asks for a single form — any comma-separated
 * pair the LLM emits is the LLM mis-applying the Romance "m + f" rule
 * ("dünn, dünne" in German, "mooi, mooie" in Dutch, "stor, stora" in
 * Swedish). The second half is an inflected form, not a separate gender.
 *
 * Collapses to the SHORTER of the two parts — in every Germanic language
 * the uninflected dictionary form is shorter than the inflected variant
 * ("dünn" < "dünne", "stor" < "stora", "mooi" < "mooie"). This keeps the
 * function deterministic without a per-language inflection table.
 *
 * Romance languages (fr, es, it, pt) where "beau, belle" / "bonito, bonita"
 * are legitimate are NOT in this set and pairs pass through unchanged.
 */
const NO_GENDER_ADJ_LANGS = new Set(['de', 'nl', 'sv', 'no', 'da', 'pl', 'cs', 'en']);

export function collapseAdjectivePair(
  s: string | undefined,
  type: string | undefined,
  learningLangCode: string | undefined,
): string {
  if (!s) return s ?? '';
  if (type !== 'adjective') return s;
  if (!learningLangCode || !NO_GENDER_ADJ_LANGS.has(learningLangCode)) return s;
  const parts = s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length !== 2) return s;
  // Already identical — collapseIdenticalFormPair handles this; no-op here.
  if (parts[0].toLowerCase() === parts[1].toLowerCase()) return s;
  // Shorter form is the uninflected base in Germanic / Slavic languages.
  return parts[0].length <= parts[1].length ? parts[0] : parts[1];
}

/**
 * Per-language infinitive ending regex, mirroring
 * scripts/compare-sweeps.ts isInfinitive. Used to drop LLM-emitted
 * conjugated / past-participle forms that were mis-typed as 'verb'
 * (e.g. German "installiert" / "zahlt", Portuguese "morreu" / "registado",
 * Italian "distingue"). Languages without reliable infinitive morphology
 * (Scandi + Slavic) auto-pass — we cannot tell conjugated from infinitive
 * without a lemmatiser.
 *
 * Returns true when the entry should be DROPPED.
 */
export function isNonInfinitiveVerb(
  original: string | undefined,
  type: string | undefined,
  learningLangCode: string | undefined,
): boolean {
  if (!original || type !== 'verb' || !learningLangCode) return false;
  // Normalise diacritics so Spanish "freír" / "reír" match -ir; the accented
  // character is otherwise a different codepoint in the simple regex.
  const low = original
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  switch (learningLangCode) {
    case 'de':
      // German infinitive ends in -en / -rn / -ln, optionally prefixed with
      // "sich " for reflexives. Drops "installiert" (partizip) /
      // "zahlt" (konjugiert) / "auf" (preposition) / "fündig" (adjective).
      return !/^(sich )?\S+(e?(n|rn|ln))$/.test(low);
    case 'fr':
      // French infinitive endings. Reflexives begin with "se " or "s'" /
      // "s\u2019". Drops "constitué" (past participle) and conjugated forms.
      return !(
        low.startsWith('se ') ||
        low.startsWith("s'") ||
        low.startsWith('s\u2019') ||
        /(er|ir|re|oir|oire)$/.test(low)
      );
    case 'es':
      return !/(ar|er|ir|arse|erse|irse)$/.test(low);
    case 'it':
      // -rre class (tradurre, disporre, porre, trarre) is legitimate.
      return !/(are|ere|ire|rre|arsi|ersi|irsi)$/.test(low);
    case 'pt':
      return !/(ar|er|ir|or|ar-se|er-se|ir-se)$/.test(low);
    case 'nl':
      // Dutch infinitives end in -en / -n (after long vowel: zijn, gaan,
      // staan, bestaan, opengaan, doen).
      return !/(en|an|on|un|ijn)$/.test(low);
    case 'en':
      return !low.startsWith('to ');
    default:
      // Scandinavian + Slavic: can't tell without lemmatiser. Pass.
      return false;
  }
}

/**
 * Normalise typographic apostrophes (\u2019 RIGHT SINGLE QUOTATION MARK)
 * to ASCII (\u0027). Readability-extracted HTML carries curly apostrophes
 * while the prompt examples + classifier regex use the ASCII form. Without
 * this, "l\u2019année" and "l'année" hash to different dedup keys and the
 * classifier's apostrophe-elision strip (Rule 36) misses the curly form,
 * falling back to zero-zipf for legitimate common French/Italian nouns.
 */
export function normaliseApostrophes(s: string | undefined): string {
  if (!s) return s ?? '';
  return s.replace(/\u2019/g, "'");
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
  for (const rawItem of items) {
    // Malformed item (missing original) — silently drop. Happens when the
    // LLM returns a truncated JSON object the parser accepted as `{}`.
    if (!rawItem.original || typeof rawItem.original !== 'string') continue;
    // Rule 40: normalise curly apostrophes (\u2019 → ') so dedup keys and
    // classifier lookup agree with the ASCII form the prompt examples use.
    const item: T = {
      ...rawItem,
      original: normaliseApostrophes(rawItem.original),
      translation: normaliseApostrophes(rawItem.translation),
    } as T;
    if (isAbbreviation(item.original)) continue;
    if (isLikelyProperNoun(item.original, learningLangCode)) continue;
    if (isMultiWordNounLeak(item.original, item.type)) continue;
    // Rule 39: drop LLM-emitted conjugated / past-participle forms that
    // slipped past "Verbs: always infinitive". Only runs for languages
    // with a reliable infinitive regex (Germanic + Romance); Scandi and
    // Slavic pass unchanged because infinitive morphology is too varied.
    if (isNonInfinitiveVerb(item.original, item.type, learningLangCode)) continue;
    // Rule 38: collapse non-Romance adjective m/f pairs in the ORIGINAL
    // ("dünn, dünne" in German → "dünn"). Applied to original only, keyed
    // on learningLangCode — the native side is not LLM-generated gendered
    // lexicon, just a translation that happens to share the shape.
    // Romance originals ("beau, belle") untouched.
    let collapsedOriginal = collapseAdjectivePair(item.original, item.type, learningLangCode);
    // Collapse spurious same-form m/f pairs where the target language has
    // no gender distinction ("grande, grande" → "grande"). Legitimate
    // differing pairs ("haut, haute") pass through unchanged.
    collapsedOriginal = collapseIdenticalFormPair(collapsedOriginal);
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
