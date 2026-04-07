// Articles and reflexive pronouns to strip from vocab entries.
// Used for both text-matching (search terms) and A–Z sorting (so that
// "o gato" sorts under "g", not under "o").
export const STRIP_PREFIX = /^(ein|eine|einen|einem|einer|der|die|das|dem|den|des|un|une|des|du|le|la|les|l'|el|la|los|las|un|una|unos|unas|il|lo|la|i|gli|le|un|uno|una|un'|the|a|an|o|os|a|as|um|uma|uns|umas|de|het|een|en|ett|się|se|si|s'|sich)\s+/i;

/**
 * Returns a normalised sort key for a vocab entry's "original" field:
 * leading article stripped, lowercased, only the first comma-separated form.
 * Example: "o gato" → "gato", "der Arzt, die Ärztin" → "arzt".
 */
export function sortKey(original: string): string {
  const first = original.split(/,/)[0].trim();
  return first.replace(STRIP_PREFIX, '').trim().toLowerCase();
}
