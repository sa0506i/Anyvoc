import { CEFR_LEVELS } from '../constants/levels';

// Articles and reflexive pronouns to strip from vocab entries.
// Used for both text-matching (search terms) and A–Z sorting (so that
// "o gato" sorts under "g", not under "o").
export const STRIP_PREFIX =
  /^(ein|eine|einen|einem|einer|der|die|das|dem|den|des|un|une|des|du|le|la|les|l'|el|la|los|las|un|una|unos|unas|il|lo|la|i|gli|le|un|uno|una|un'|the|a|an|o|os|a|as|um|uma|uns|umas|de|het|een|en|ett|się|se|si|s'|sich)\s+/i;

export type SortOption = 'date' | 'alphabetical' | 'level' | 'box';

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'alphabetical', label: 'A\u2013Z' },
  { value: 'level', label: 'Level' },
  { value: 'box', label: 'Maturity' },
];

/**
 * Returns a normalised sort key for a vocab entry's "original" field:
 * leading article stripped, lowercased, only the first comma-separated form.
 * Example: "o gato" → "gato", "der Arzt, die Ärztin" → "arzt".
 */
export function sortKey(original: string): string {
  const first = original.split(/,/)[0].trim();
  return first.replace(STRIP_PREFIX, '').trim().toLowerCase();
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract search terms from a vocab entry's "original" field.
 * Handles:
 * - Comma-separated forms: "un médecin, une médecin" → ["médecin"]
 * - Articles: "une maison" → ["maison"]
 * - Reflexive verbs: "se souvenir" → ["souvenir"]
 * - Adjective forms: "beau, belle" → ["beau", "belle"]
 */
export function extractSearchTerms(original: string): string[] {
  const terms = new Set<string>();

  // Split on comma to handle multiple forms
  const parts = original
    .split(/,/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    // Strip leading articles / reflexive pronouns
    const stripped = part.replace(STRIP_PREFIX, '').trim();
    if (stripped) {
      terms.add(stripped);
      // Also add individual words for multi-word entries
      const words = stripped.split(/\s+/);
      if (words.length > 1) {
        for (const w of words) {
          if (w.length >= 3) terms.add(w);
        }
      }
    }
  }

  // Also try the full original (without article) as one term
  const fullStripped = original.replace(STRIP_PREFIX, '').split(',')[0].trim();
  if (fullStripped) terms.add(fullStripped);

  return Array.from(terms);
}

/** Sort vocabulary entries by the given option. Returns a new sorted array. */
export function sortVocabulary<
  T extends { original: string; level: string; leitner_box: number; created_at: number },
>(items: T[], by: SortOption): T[] {
  return [...items].sort((a, b) => {
    switch (by) {
      case 'alphabetical':
        return sortKey(a.original).localeCompare(sortKey(b.original));
      case 'level':
        return CEFR_LEVELS.indexOf(a.level as any) - CEFR_LEVELS.indexOf(b.level as any);
      case 'box':
        return a.leitner_box - b.leitner_box;
      case 'date':
      default:
        return b.created_at - a.created_at;
    }
  });
}
