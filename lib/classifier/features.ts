/**
 * features.ts — frequency / AoA lookups normalised to [0, 1].
 *
 * RUNTIME-ONLY. Must NOT import axios, tar, node:fs, node:path, or any other
 * Node-only API. Loaded into the Expo bundle by Metro.
 *
 * History: an earlier version also exposed a Brysbaert-style concreteness
 * feature, but it was permanently fall-back-only across all 12 languages
 * (no data file was ever populated) and the calibration pipeline always
 * dropped it as a zero-variance feature. Concreteness has been removed
 * from the runtime in favour of two clean features (Zipf + AoA). See
 * lib/classifier/TODO.md, "Concreteness feature dropped" for the rationale.
 */

import type { SupportedLanguage } from './index';

// Metro requires static, literal require() paths — no template strings.
// Each frequency JSON has shape { __corpus, __attribution, keys: string[],
// values: number[] } — parallel arrays. We deliberately do NOT use a single
// { word: zipf } object because Hermes caps object property count at 196607
// (PropStorage::MAX_PROPERTY_COUNT = 0x2FFFF), and 10 of our 12 languages
// exceed that limit (en has 579k entries). Arrays have no such cap. The
// loader below materialises the parallel arrays into a Map<string, number>
// at first access, cached in getFreq.
interface FreqPayload {
  keys: string[];
  values: number[];
}
function loadFreq(language: SupportedLanguage): Map<string, number> {
  let payload: FreqPayload;
  switch (language) {
    case 'en':
      payload = require('../data/freq_en.json');
      break;
    case 'de':
      payload = require('../data/freq_de.json');
      break;
    case 'fr':
      payload = require('../data/freq_fr.json');
      break;
    case 'es':
      payload = require('../data/freq_es.json');
      break;
    case 'it':
      payload = require('../data/freq_it.json');
      break;
    case 'pt':
      payload = require('../data/freq_pt.json');
      break;
    case 'nl':
      payload = require('../data/freq_nl.json');
      break;
    case 'sv':
      payload = require('../data/freq_sv.json');
      break;
    case 'no':
      payload = require('../data/freq_no.json');
      break;
    case 'da':
      payload = require('../data/freq_da.json');
      break;
    case 'pl':
      payload = require('../data/freq_pl.json');
      break;
    case 'cs':
      payload = require('../data/freq_cs.json');
      break;
  }
  const map = new Map<string, number>();
  const keys = payload.keys;
  const values = payload.values;
  const n = keys.length;
  for (let i = 0; i < n; i++) {
    map.set(keys[i]!, values[i]!);
  }
  return map;
}

// Metro requires static require paths. Empty-placeholder shape is
// { __empty: true, words: {} } — getAoa() falls back gracefully.
function loadAoa(language: SupportedLanguage): Record<string, number> {
  switch (language) {
    case 'en':
      return require('../data/aoa_en.json').words ?? {};
    case 'de':
      return require('../data/aoa_de.json').words ?? {};
    case 'fr':
      return require('../data/aoa_fr.json').words ?? {};
    case 'es':
      return require('../data/aoa_es.json').words ?? {};
    case 'it':
      return require('../data/aoa_it.json').words ?? {};
    case 'pt':
      return require('../data/aoa_pt.json').words ?? {};
    case 'nl':
      return require('../data/aoa_nl.json').words ?? {};
    case 'sv':
      return require('../data/aoa_sv.json').words ?? {};
    case 'no':
      return require('../data/aoa_no.json').words ?? {};
    case 'da':
      return require('../data/aoa_da.json').words ?? {};
    case 'pl':
      return require('../data/aoa_pl.json').words ?? {};
    case 'cs':
      return require('../data/aoa_cs.json').words ?? {};
  }
}

// Cache module-level so we hit the require() once per language.
const freqCache: Partial<Record<SupportedLanguage, Map<string, number>>> = {};
const aoaCache: Partial<Record<SupportedLanguage, Record<string, number>>> = {};

function getFreq(language: SupportedLanguage): Map<string, number> {
  if (!freqCache[language]) freqCache[language] = loadFreq(language);
  return freqCache[language]!;
}

function getAoa(language: SupportedLanguage): Record<string, number> {
  if (!aoaCache[language]) aoaCache[language] = loadAoa(language);
  return aoaCache[language]!;
}

// Strip the leading article ("der Hund" → "hund", "le chat" → "chat",
// "se souvenir" → "souvenir") so the lookup hits the corpus form. The
// extracted base form from the LLM almost always carries an article or
// reflexive pronoun for nouns/reflexive verbs.
//
// The set is deliberately global across all 12 languages. Cross-language
// false positives are extremely rare because vocab entries come from a
// specific learning-language context, and the 2+-token guard in
// normaliseLookupKey prevents a single article-word from matching itself.
// The set MUST cover every definite + indefinite article form in every
// supported language — missing entries cause article-prefixed phrases to
// fall through to fb=2 → Claude fallback (non-deterministic) instead of
// hitting the local freq table. This used to be the cause of the
// "a posse" bug where PT 'a' was missing and the word got classified
// differently on auto-extract vs manual add.
const ARTICLE_PREFIXES = new Set([
  // English
  'the',
  'a',
  'an',
  'to',
  // German
  'zu',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einen',
  'einem',
  'eines',
  'einer',
  // French
  'le',
  'la',
  'les',
  'l',
  'un',
  'une',
  'des',
  'du',
  // Spanish
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  // Italian
  'il',
  'lo',
  'la',
  'i',
  'gli',
  'le',
  'un',
  'uno',
  'una',
  // Portuguese
  'o',
  'a',
  'os',
  'as',
  'um',
  'uma',
  'uns',
  'umas',
  // Dutch
  'de',
  'het',
  'een',
  'te',
  // Swedish / Danish / Norwegian
  'en',
  'ei',
  'ett',
  'et',
  'det',
  'att',
  'å',
  'at',
  // Reflexive pronouns
  'sich',
  'se',
  'si',
]);

function normaliseLookupKey(word: string): string {
  // Take only the first comma-separated form: "le médecin, la médecin" → "le médecin".
  const first = word.split(',')[0]!.trim().toLowerCase();
  // Remove leading article / reflexive pronoun if present.
  const tokens = first.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && ARTICLE_PREFIXES.has(tokens[0])) {
    return tokens.slice(1).join(' ');
  }
  return first;
}

export interface Features {
  zipfNorm: number;
  aoaNorm: number;
  zipf: number;
  fallbackCount: number;
  usedFallback: { zipf: boolean; aoa: boolean };
}

/**
 * Extracts the two features used by the difficulty score.
 *
 * Fallback rules:
 *   zipf:  not in lookup → 0.0,             usedFallback.zipf = true
 *   aoa:   missing in any lang → 1 - zipfNorm, usedFallback.aoa = true
 *          (EN uses Kuperman 2012; non-EN uses LLM-generated estimates
 *          from scripts/build-aoa-llm.ts. When the language's aoa JSON
 *          is empty or the specific word is missing, we degrade to the
 *          Zipf-based fallback rather than a constant.)
 *
 * Note: no suffix-strip / stemming is done here. The frequency tables
 * built from Leipzig news corpora already contain the flected forms as
 * separate tokens, so a direct lookup hits "Hundes", "gatos" etc. on
 * its own. A suffix-strip rescue layer was prototyped and rejected: the
 * risk of silently producing wrong but plausible stems (especially in
 * Slavic and Romance verb paradigms) outweighed the marginal recall gain
 * on already-covered inflection.
 */
export function extractFeatures(word: string, language: SupportedLanguage): Features {
  const key = normaliseLookupKey(word);

  const usedFallback = { zipf: false, aoa: false };

  // --- Zipf ---
  const freq = getFreq(language);
  const zipfRaw = freq.get(key);
  let zipf: number;
  let zipfNorm: number;
  if (typeof zipfRaw === 'number' && Number.isFinite(zipfRaw)) {
    zipf = zipfRaw;
    zipfNorm = Math.max(0, Math.min(1, zipf / 7));
  } else {
    zipf = 0;
    zipfNorm = 0;
    usedFallback.zipf = true;
  }

  // --- AoA (all 12 languages share the same scale 2-18) ---
  // EN  : Kuperman et al. 2012 (real human norms)
  // non-EN: LLM-generated estimates (scripts/build-aoa-llm.ts)
  // Missing → Zipf-based fallback, UNLESS zipf also fell back, in
  // which case we use a fixed neutral default (see below).
  let aoaNorm: number;
  const aoaRaw = getAoa(language)[key];
  if (typeof aoaRaw === 'number' && Number.isFinite(aoaRaw)) {
    aoaNorm = Math.max(0, Math.min(1, (aoaRaw - 2) / 16));
  } else {
    usedFallback.aoa = true;
    if (usedFallback.zipf) {
      // Double-fallback trap: the naive `1 - zipfNorm` default yields
      // aoaNorm=1 when zipfNorm=0, which forces η ≈ +4.33 and a
      // guaranteed C2 label — a mathematical corner, not a real
      // classification. NT2Lex surfaced this: 24.4 % of its rows
      // (separable-verb infinitives, MWEs, compounds) hit both
      // fallbacks and were all force-classified C2.
      //
      // In production these words are already routed to the Claude
      // API via confidence='low' (see fallback.ts), so this value is
      // only consulted when the API is rate-limited, offline, or
      // erroring. 0.4 puts η near the B2|C1 boundary (η ≈ 1.73) —
      // a plausible neutral guess for "word we know nothing about".
      aoaNorm = 0.4;
    } else {
      aoaNorm = 1 - zipfNorm;
    }
  }

  const fallbackCount = (usedFallback.zipf ? 1 : 0) + (usedFallback.aoa ? 1 : 0);

  return { zipfNorm, aoaNorm, zipf, fallbackCount, usedFallback };
}
