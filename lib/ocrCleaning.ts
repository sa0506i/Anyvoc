/**
 * ocrCleaning.ts — post-OCR garbage-line filter.
 *
 * After ML Kit recognises text in a photo, the raw output sometimes
 * contains tokens lifted from stylised logos, watermarks, or icon
 * fragments. Real examples seen on a Portuguese newspaper page:
 *
 *   1RABUsoupoA   ← OCR'd off a logo with rotated/mirrored text
 *   tsaLNA SOA    ← scrambled brand fragments
 *   PORTUCUTSA    ← all-caps logo letters, no real word
 *
 * These tokens flow into the LLM extraction prompt and pollute the
 * vocabulary list (and burn LLM tokens). This module drops the lines
 * that contain them BEFORE the text reaches processSharedText().
 *
 * Design constraints:
 *   - PURE. No I/O, no Expo / RN imports. Easy to unit-test.
 *   - CONSERVATIVE. Bias toward keeping rare-but-real words. Even one
 *     corpus-known token in a line saves the line.
 *   - LATIN-SCRIPT ONLY. Frequency tables (lib/data/freq_*.json) are
 *     Latin; we have no signal for Cyrillic / CJK / Arabic and pass
 *     them through unchanged.
 *
 * Wired into lib/ocr.ts > extractTextFromImageLocal after cleanOcrText
 * and before validateOcrText. See architecture test "Rule 35" for
 * the wiring invariant.
 */

import { isKnownInAnyLeipzigCorpus } from './classifier/features';

// Tokens shorter than this skip the heuristic — too noisy to judge
// (covers articles, prepositions, punctuation residue).
const MIN_TOKEN_LENGTH = 4;

// All-caps tokens of length ≥ this are suspicious if missing from any
// corpus. Below this threshold, real acronyms (UGT, IBM, EU, B2B) pass.
const SUSPICIOUS_ALLCAPS_LENGTH = 5;

// Below this many lines, the OCR output is too thin to risk filtering —
// e.g. a single sign or a one-line caption.
const MIN_LINES_FOR_FILTERING = 3;

// Phonotactics signal: unusual consonant/vowel patterns in Latin script.
const VOWELS = /[aeiouáàâãäåéèêëíìîïóòôõöúùûüýÿœæ]/i;
const CONSONANT = /[bcdfghjklmnpqrstvwxyzçñß]/i;

/** Strip leading/trailing punctuation, keep internal letters/digits. */
function stripEdgePunct(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Tokens are whitespace-separated, then edge-punct-stripped. */
function tokensOf(line: string): string[] {
  return line
    .split(/\s+/)
    .map(stripEdgePunct)
    .filter((t) => t.length > 0);
}

/** Has the token at least one Latin letter? (Otherwise we don't judge.) */
function hasLatinLetter(token: string): boolean {
  return /[\p{Script=Latin}]/u.test(token);
}

/** Does the token mix digits AND letters in a non-clean-affix pattern? */
function hasDirtyDigitLetterMix(token: string): boolean {
  const hasDigit = /\d/.test(token);
  const hasLetter = /\p{L}/u.test(token);
  if (!hasDigit || !hasLetter) return false;

  // Clean DIGIT-prefix: digits, then ALL-LOWERCASE letters (units like
  // "5km", "24h", "100kg"). Crucially the letter portion must be all
  // lowercase — otherwise "1RABUsoupoA" (1 digit + 10 mixed-case letters)
  // would slip through.
  if (/^\d+\p{Ll}+$/u.test(token)) return false;

  // Clean LETTER-prefix: letters, then digits at the end ("iPhone15",
  // "COVID19", "Windows11"). Letter portion can be any case — that's
  // a brand convention, not noise.
  if (/^\p{L}+\d+$/u.test(token)) return false;

  // Hyphenated digit suffix: "COVID-19", "Catch-22" (hyphen is internal,
  // survives the edge-punct strip).
  if (/^\p{L}+-\d+$/u.test(token)) return false;

  // Otherwise: digit interleaved with letters → dirty.
  return true;
}

/**
 * Detect token shapes that don't match any of the four real-word
 * patterns: all-lower ("berlin"), all-upper ("BERLIN"), Capitalised
 * ("Berlin"), or CamelCase-ish ("iPhone" = lower-Upper-lower).
 *
 * Catches OCR-derived oddities like:
 *   "tsaLNA"      — lower prefix + upper suffix (logo letters mis-read)
 *   "RABUsoupoA"  — alternating regions
 *   "BeRLIN"      — upper-mid-upper
 *
 * Returns false for every dictionary-shape token. The caller must
 * additionally check corpus membership before treating this as garbage,
 * because legit CamelCase brand names ("iPhone", "eBay", "JavaScript")
 * are real words that happen to be in the bundled corpora.
 */
function hasSuspiciousCasing(token: string): boolean {
  const letters = token.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return false;

  // All same case → not suspicious.
  if (letters === letters.toLowerCase()) return false;
  if (letters === letters.toUpperCase()) return false;

  // Capitalised + PascalCase: each "word" is one Upper followed by Lower+.
  //   "Berlin"      → ^(Lu Ll+)+$ ✓ (one segment)
  //   "PowerPoint"  → ^(Lu Ll+)+$ ✓ (Power + Point)
  //   "JavaScript"  → ^(Lu Ll+)+$ ✓
  //   "MyWord"      → ^(Lu Ll+)+$ ✓
  if (/^(\p{Lu}\p{Ll}+)+$/u.test(letters)) return false;

  // camelCase: lower+ then PascalCase.
  //   "iPhone"      → ^Ll+ (Lu Ll+)+$ ✓
  //   "eBay"        → ✓
  //   "javaScript"  → ✓
  if (/^\p{Ll}+(\p{Lu}\p{Ll}+)+$/u.test(letters)) return false;

  // Anything else — like "tsaLNA" (lower then upper-only suffix),
  // "RABUsoupoA" (upper-cluster + lower + upper-singleton-not-on-edge
  // wait, that's "PowerPoint"-shaped — but "RABU" is 4 uppers, fails the
  // (Lu Ll+) pattern because RABU has no Ll inside it), or "BeRLIN".
  return true;
}

/** Long all-caps token NOT in any corpus → suspicious logo fragment. */
function isSuspiciousAllCaps(token: string): boolean {
  if (token.length < SUSPICIOUS_ALLCAPS_LENGTH) return false;
  if (token !== token.toUpperCase()) return false;
  if (!hasLatinLetter(token)) return false;
  return !isKnownInAnyLeipzigCorpus(token);
}

/**
 * Unusual phonotactics: very long consonant runs OR alpha runs ≥ 5
 * with no vowels. Catches scrambles like "PRTGTSA" / "kdjfhgkj".
 */
function hasUnusualPhonotactics(token: string): boolean {
  const alpha = token.replace(/[^\p{L}]/gu, '');
  if (alpha.length < 5) return false;
  // No vowels at all in a 5+ letter run → suspicious.
  if (!VOWELS.test(alpha)) return true;
  // Consonant run of 5+ → suspicious.
  let run = 0;
  for (const ch of alpha) {
    if (CONSONANT.test(ch) && !VOWELS.test(ch)) {
      run++;
      if (run >= 5) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

/**
 * True if the token is unlikely to be a real word in any supported
 * language. Each rule below is a sufficient condition (not a score) —
 * ANY single trigger makes the token garbage. Each rule is corroborated
 * by either a structural impossibility (digit-letter interleaving real
 * words don't have) or a corpus-miss check, so legit CamelCase brand
 * names like "iPhone" / "eBay" / "Volkswagen" stay clean as long as
 * they're in any of the 12 bundled Leipzig corpora.
 *
 * Triggers:
 *   1. Dirty digit-letter mix — interleaved, not clean prefix/suffix
 *      ("1RABUsoupoA" yes, "5km" / "iPhone15" / "COVID-19" no)
 *   2. Suspicious casing AND not in any Leipzig corpus — e.g. "tsaLNA"
 *      (lower-prefix + upper-suffix) or "RABUsoupoA" (alternating
 *      regions). Real CamelCase brands ("iPhone") are corpus hits and
 *      escape here.
 *   3. All-caps ≥ 5 chars AND not in any Leipzig corpus — "PORTUCUTSA"
 *      yes, but "EXCLUSIVO" / "PORTUGAL" / "BERLIN" are corpus hits.
 *      Short acronyms (UGT, IBM, EU, B2B) pass on length alone.
 *   4. Corpus miss AND unusual phonotactics (no vowels in 5+-letter run,
 *      or 5+-consonant run) — backstop for novel scrambles like "PRTGTSA".
 */
export function isLikelyGarbageToken(token: string): boolean {
  if (token.length < MIN_TOKEN_LENGTH) return false;
  if (!hasLatinLetter(token)) return false;

  if (hasDirtyDigitLetterMix(token)) return true;

  const inCorpus = isKnownInAnyLeipzigCorpus(token);

  if (hasSuspiciousCasing(token) && !inCorpus) return true;
  if (isSuspiciousAllCaps(token)) return true; // already requires corpus miss
  if (!inCorpus && hasUnusualPhonotactics(token)) return true;

  return false;
}

/**
 * True if the line is dominated by garbage tokens.
 *
 * Conservative rule: line is garbage iff it has ≥ 1 garbage token AND
 * NO token (length ≥ MIN_TOKEN_LENGTH) is recognised in any Leipzig
 * corpus. Even one corpus-known word saves the line — this preserves
 * real headlines like "LEGISLAÇÃO LABORAL" where both tokens are
 * Portuguese-corpus hits.
 */
export function isLikelyGarbageLine(line: string): boolean {
  const toks = tokensOf(line);
  let garbageCount = 0;
  let knownCount = 0;
  for (const tok of toks) {
    if (tok.length < MIN_TOKEN_LENGTH) continue;
    if (isKnownInAnyLeipzigCorpus(tok)) knownCount++;
    if (isLikelyGarbageToken(tok)) garbageCount++;
  }
  return garbageCount >= 1 && knownCount === 0;
}

/**
 * Drops garbage lines from a multi-line OCR string. No-ops on inputs
 * with fewer than MIN_LINES_FOR_FILTERING lines (avoids over-pruning
 * tiny outputs like a single sign).
 *
 * Preserves blank lines (paragraph separators) — they pass through
 * untouched. Only non-blank lines are evaluated.
 */
export function dropGarbageLines(text: string): string {
  if (!text) return text;
  const lines = text.split('\n');
  const nonBlankCount = lines.filter((l) => l.trim().length > 0).length;
  if (nonBlankCount < MIN_LINES_FOR_FILTERING) return text;

  return lines.filter((line) => line.trim().length === 0 || !isLikelyGarbageLine(line)).join('\n');
}
