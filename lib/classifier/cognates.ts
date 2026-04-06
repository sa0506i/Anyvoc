/**
 * cognates.ts — adjusts difficulty downward for likely English cognates and
 * upward for "false friends" / very dissimilar pairs.
 *
 * Strategy: compute the Normalised Levenshtein Distance (NLD) between the
 * source word and its English translation. Low NLD → looks like English →
 * easier for an English-native learner.
 *
 * // TODO(classifier): real Wiktionary lookup for the English gloss. Right
 * // now there is no offline translation source on-device, so getEnglishGloss()
 * // returns null and NLD defaults to 0. The hook is in place — once an
 * // offline gloss store exists (e.g. a stripped Wiktionary dump bundled
 * // alongside freq_*.json), only getEnglishGloss() needs replacing; the
 * // rest of this file stays the same.
 */

import { distance } from 'fastest-levenshtein';
import { clamp01 } from './score';
import type { SupportedLanguage } from './index';

/**
 * Normalised Levenshtein Distance between two strings.
 * 0 = identical, 1 = completely different.
 */
export function nld(a: string, b: string): number {
  if (!a && !b) return 0;
  const m = Math.max(a.length, b.length);
  if (m === 0) return 0;
  return distance(a, b) / m;
}

/**
 * Returns null until a real offline gloss source is wired up.
 * // TODO(classifier): Wiktionary-backed implementation.
 */
function getEnglishGloss(_word: string, _language: SupportedLanguage): string | null {
  return null;
}

/**
 * Applies the cognate-based adjustment to a difficulty score and clamps to [0,1].
 * Spec rules:
 *   NLD < 0.3 → -0.08 (looks like English; easier)
 *   NLD > 0.8 → +0.04 (very dissimilar; slightly harder)
 *   else      → no change
 */
export function applyCognateAdjustment(
  word: string,
  language: SupportedLanguage,
  difficulty: number
): number {
  const gloss = getEnglishGloss(word, language);
  // Placeholder per spec: NLD = 0 when no gloss is available.
  // This means the placeholder branch never triggers either bonus/penalty,
  // because computeNld(0) = 0 < 0.3, which would always apply -0.08 — that
  // would distort every score. So we explicitly skip the adjustment when
  // we don't actually know the gloss.
  if (gloss === null) {
    return clamp01(difficulty);
  }

  const score = nld(word.toLowerCase(), gloss.toLowerCase());
  if (score < 0.3) return clamp01(difficulty - 0.08);
  if (score > 0.8) return clamp01(difficulty + 0.04);
  return clamp01(difficulty);
}
