export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

export type CEFRLevel = (typeof CEFR_LEVELS)[number];

/**
 * UI-visible levels: C1 and C2 are merged into a single "C" bucket
 * because our local classifier lacks the signal to reliably distinguish
 * them. See scripts/validate-gold-all.ts — C1/C2 per-level exact
 * accuracy is < 15 % across all sources except SV, and C2 is effectively
 * unreachable by the deterministic ordinal model.
 *
 * Internal 6-level storage is preserved:
 *   - Existing SQLite vocabulary rows keep their original labels.
 *   - The Claude API fallback can still return C1 or C2.
 *   - Calibration gold stays 6-class.
 * Only the UI presents 5 buckets.
 */
export const CEFR_LEVELS_UI = ['A1', 'A2', 'B1', 'B2', 'C'] as const;

export type CEFRLevelUI = (typeof CEFR_LEVELS_UI)[number];

/** Collapse an internal level label to its UI representation. */
export function displayLevel(level: string): string {
  if (level === 'C1' || level === 'C2') return 'C';
  return level;
}

/**
 * Convert a UI chip value back to the internal level stored in
 * settings. "C" collapses to C1 because the level setting is a
 * *minimum* threshold — picking "C" means "show C1 and above", which
 * is `isAtOrAboveLevel(vocab, 'C1')`.
 */
export function uiToInternalLevel(ui: string): CEFRLevel {
  if (ui === 'C') return 'C1';
  return ui as CEFRLevel;
}

export function isAtOrAboveLevel(vocabLevel: string, minLevel: string): boolean {
  const vocabIndex = CEFR_LEVELS.indexOf(vocabLevel as CEFRLevel);
  const minIndex = CEFR_LEVELS.indexOf(minLevel as CEFRLevel);
  if (vocabIndex === -1 || minIndex === -1) return true;
  return vocabIndex >= minIndex;
}
