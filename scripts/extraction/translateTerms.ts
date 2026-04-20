/**
 * Phase 2 of the two-phase extraction validation tool.
 *
 * DEV-ONLY. Same scope note as extractTerms.ts: this module lives under
 * scripts/, is not part of the production bundle, and must never be
 * imported from app/, components/, hooks/, constants/, or lib/.
 *
 * Translates a fixed list of terms (from Phase 1) into a target native
 * language. The prompt sees ONLY the term list and the two language
 * names — never the source text. That keeps Phase 1's output stable
 * while letting Phase 2 vary per native.
 *
 * The response contract is strict: same length, same order as input.
 * If the LLM violates that (missing / extra entries, reordering), we
 * fall back to a per-entry alignment by original-string match, and
 * finally to an empty translation for anything still unmatched.
 */

import { callClaude } from '../../lib/claude';
import { parseJsonArrayWithRepair } from './parseJsonArray';
import type { ExtractedTerm } from './extractTerms';

/** Max terms per Phase-2 call. Avoids JSON-parse failures on very long
 *  outputs and keeps per-call latency bounded. 50 ≈ ~2 500 output
 *  tokens. Larger texts get batched. */
const MAX_TERMS_PER_CALL = 50;

interface TranslationEntry {
  original: string;
  translation: string;
}

function buildTranslationPrompt(
  fromLanguageName: string,
  toLanguageName: string,
  toLanguageCode: string,
): string {
  const germanTarget = toLanguageCode === 'de';
  const germanNounNote = germanTarget
    ? `\n- Target is German: capitalise the NOUN itself in noun translations (e.g. "der Hund", "die Ärztin"). Keep attributive adjectives lowercase ("die öffentliche Gewalt", NOT "die Öffentliche Gewalt").`
    : '';
  return `You are a professional dictionary translator.

The user sends a JSON array of dictionary entries in ${fromLanguageName}. Translate each entry's "original" into ${toLanguageName}.

Output rules:
- Return a JSON array of EXACTLY the same length as the input, in EXACTLY the same order.
- Each output object has two fields: "original" (copy from input) and "translation" (your translation in ${toLanguageName}).
- Preserve the article for nouns: if the input was "der Hund", the translation must include the target-language article if one applies ("the dog", "le chien").
- For reflexive verbs keep the reflexive pronoun in the target: "sich erinnern" → "to remember"; "se souvenir" → "to remember"; translating into French: "to remember" → "se souvenir".
- For m+f pairs keep the same shape if the target language has a gender distinction: "der Arzt, die Ärztin" → "the doctor" (single in English) OR "il dottore, la dottoressa" (IT).${germanNounNote}
- NO explanations, NO prose, NO extra fields. JSON array only.

Example input/output (shape only):
Input:  [{"original":"o gato","type":"noun"},{"original":"correr","type":"verb"}]
Output: [{"original":"o gato","translation":"die Katze"},{"original":"correr","translation":"laufen"}]`;
}

async function translateOneBatch(
  batch: ExtractedTerm[],
  fromLanguageName: string,
  toLanguageName: string,
  toLanguageCode: string,
): Promise<Map<string, string>> {
  const systemPrompt = buildTranslationPrompt(fromLanguageName, toLanguageName, toLanguageCode);
  const userPayload = JSON.stringify(batch.map((t) => ({ original: t.original, type: t.type })));
  const responseText = await callClaude(
    [{ role: 'user', content: userPayload }],
    systemPrompt,
    8192,
    {
      temperature: 0,
    },
  );

  const parsed = parseJsonArrayWithRepair<TranslationEntry>(responseText, 'translateTerms');
  const map = new Map<string, string>();
  if (!parsed) return map;

  // Fast path: same length → trust positional alignment AND fill the map
  // from the "original" field in the response (handles the rare reorder).
  if (parsed.length === batch.length) {
    for (let i = 0; i < batch.length; i++) {
      const inOrig = batch[i].original;
      // Trust the returned `original` as key when present and non-empty,
      // else fall back to positional.
      const outOrig = parsed[i].original || inOrig;
      const outTrans = parsed[i].translation ?? '';
      // Prefer the input's original as the key so the composer can look
      // it up later; we accept the translation even if positional.
      map.set(inOrig, outTrans);
      // Also index by returned original in case of reordering.
      if (outOrig !== inOrig) map.set(outOrig, outTrans);
    }
    return map;
  }

  // Slow path: length mismatch. Match by `original` field where possible;
  // leave the rest unmatched (composer fills with empty string).
  console.warn(
    `[translateTerms] length mismatch: sent ${batch.length} terms, got ${parsed.length}. Aligning by original field.`,
  );
  for (const p of parsed) {
    if (p.original && p.translation !== undefined) {
      map.set(p.original, p.translation);
    }
  }
  return map;
}

/**
 * Translate a list of extracted terms into the target native language.
 * Returns a Map keyed on the input `original` field. Unmatched entries
 * have no Map entry — the composer must default to empty string.
 *
 * Terms are batched at MAX_TERMS_PER_CALL to keep per-call latency and
 * token budgets bounded.
 */
export async function translateTerms(
  terms: ExtractedTerm[],
  fromLanguageName: string,
  toLanguageName: string,
  toLanguageCode: string,
): Promise<Map<string, string>> {
  const merged = new Map<string, string>();
  for (let i = 0; i < terms.length; i += MAX_TERMS_PER_CALL) {
    const batch = terms.slice(i, i + MAX_TERMS_PER_CALL);
    const partial = await translateOneBatch(
      batch,
      fromLanguageName,
      toLanguageName,
      toLanguageCode,
    );
    for (const [k, v] of partial) merged.set(k, v);
  }
  return merged;
}
