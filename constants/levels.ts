export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

export type CEFRLevel = (typeof CEFR_LEVELS)[number];

export function isAtOrAboveLevel(vocabLevel: string, minLevel: string): boolean {
  const vocabIndex = CEFR_LEVELS.indexOf(vocabLevel as CEFRLevel);
  const minIndex = CEFR_LEVELS.indexOf(minLevel as CEFRLevel);
  if (vocabIndex === -1 || minIndex === -1) return true;
  return vocabIndex >= minIndex;
}
