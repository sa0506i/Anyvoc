/**
 * Phase 1 of the two-phase extraction validation tool.
 *
 * DEV-ONLY. Lives under scripts/ (not lib/) because this whole two-phase
 * path is a validation / A-B comparison harness for the sweep script,
 * NOT production code. It must never be imported from app/, components/,
 * hooks/, constants/, or lib/. The architecture test "two-phase
 * extraction tool stays out of the production bundle" enforces the
 * boundary.
 *
 * Extracts vocabulary CANDIDATES from a text with the LLM. The prompt
 * knows the LEARNING language but NOT the native language. No
 * "translation" field in the output. Phase-1 output is native-agnostic
 * by construction.
 *
 * Why this exists: the 2026-04-20 sweep showed the production monolithic
 * extractVocabulary (in lib/claude.ts) is conditioned on the native-
 * language name in its prompt, producing cross-native Jaccard ≈ 0.50
 * even for identical text at temperature 0. This tool lets us measure
 * how much of that variance comes from the coupled extract+translate
 * step — without touching lib/claude.ts.
 */

import { callClaude, chunkText, type SupportedLanguage } from '../../lib/claude';
import { postProcessExtractedVocab } from '../../lib/vocabFilters';
import { parseJsonArrayWithRepair } from './parseJsonArray';

export interface ExtractedTerm {
  original: string;
  /** LLM-assigned type. The level is set by the classifier in Phase 3 (the composer). */
  type: 'noun' | 'verb' | 'adjective' | 'phrase' | 'other';
  source_forms: string[];
}

function buildExtractionPrompt(learningLanguageName: string, learningLanguageCode: string): string {
  const scandinavian = new Set(['sv', 'no', 'da']);
  const scandiRule = scandinavian.has(learningLanguageCode)
    ? `
- IMPORTANT — for ${learningLanguageName}, definiteness is marked as a noun SUFFIX, not a prepositive article. Prepend the INDEFINITE article based on grammatical gender: "en" (common gender, sv/no/da), "ett" (neuter, sv), "ei" (feminine, no). Examples: "en artikel", "ett språk", "ei bok".`
    : '';

  return `You are a language teacher assistant. Extract all meaningful vocabulary from a given text.

The learning language is ${learningLanguageName}.

Rules:
- Extract nouns, verbs, adjectives, and fixed expressions. Ignore function words, standalone articles, pronouns, proper nouns, abbreviations, and numbers.
- Proper nouns to ignore include: people's names (Maria, João, Anna), cities (Berlin, Lisboa, Paris), countries (Portugal, Deutschland), brand or product names (Google, iPhone), titles of works, sports clubs (Real Madrid, FC Barcelona, Bayern Munich), and broadcaster names (BBC, HBO Max). Never include any of these in the output.
- Abbreviations and acronyms to ignore: any all-uppercase token of 2+ letters such as "GNR", "DLRG", "IRS", "EU", "USA". Never include these in the output.
- Each distinct word may appear AT MOST ONCE in the output array. Never emit the same entry multiple times even if the source text contains it many times — use "source_forms" to record every occurrence.
- For NOUN entries, "original" must be exactly "article + singular-noun" — a single content word after the article. Never bundle an attributive adjective with the noun (write "die Gewalt" not "die öffentliche Gewalt"; if the adjective is relevant, list it as a separate adjective entry). Multi-word proper nouns ("le Real Madrid") are proper nouns and MUST be omitted entirely.${scandiRule}
- Nouns: ALWAYS include the direct article before the noun in singular form (e.g. "der Hund", "le chat", "o passaporte"). If a distinct feminine form exists, add it after a comma ("le médecin, la médecin" / "der Arzt, die Ärztin").
- In every language except German, write nouns in lowercase consistently, even if they were capitalised in the source text.
- Remove hyphens from line breaks ("Wort-\\ntrennung" → "Worttrennung").
- Verbs: always in the infinitive. Always include the reflexive pronoun for reflexive verbs ("sich erinnern", "se souvenir", "acordar-se").
- Adjectives: give m + f forms when they differ ("beau, belle"). For single-gender languages give the uninflected base form only.
- List every exact word form from the source text in "source_forms". Example: source contains "rivais", base form is "o rival" → source_forms: ["rivais"].

"type" must be one of: "noun", "verb", "adjective", "phrase", "other".
Pick the type that matches each extracted word — DO NOT label every entry "noun".

Respond exclusively as a JSON array of dictionary entries. NO "translation" field — that is handled separately.
The example below is shape only — actual types depend on source text:
[
  { "original": "o passaporte", "type": "noun", "source_forms": ["passaportes"] },
  { "original": "correr", "type": "verb", "source_forms": ["corre", "corremos"] },
  { "original": "bonito, bonita", "type": "adjective", "source_forms": ["bonitos"] },
  { "original": "de repente", "type": "phrase", "source_forms": ["de repente"] }
]`;
}

/**
 * Native-agnostic extraction. Returns a deduplicated, filter-cleaned
 * term list ready to be paired with per-native translations.
 *
 * The filter + dedup pipeline is the same `postProcessExtractedVocab`
 * used by the monolithic path — same invariants (multi-word-noun reject,
 * proper-noun reject, abbreviation reject, batch-dedup). Translation
 * field is stubbed to empty since Phase 1 doesn't produce one.
 */
export async function extractTerms(
  text: string,
  learningLanguageName: string,
  learningLanguageCode: SupportedLanguage,
): Promise<ExtractedTerm[]> {
  const chunks = chunkText(text);
  const all: ExtractedTerm[] = [];

  for (const chunk of chunks) {
    const systemPrompt = buildExtractionPrompt(learningLanguageName, learningLanguageCode);
    const responseText = await callClaude([{ role: 'user', content: chunk }], systemPrompt, 8192, {
      temperature: 0,
    });
    const parsed = parseJsonArrayWithRepair<ExtractedTerm>(responseText, 'extractTerms');
    if (parsed) all.push(...parsed);
  }

  // Reuse the same post-processing as the monolithic path. We pass an
  // empty `nativeLangCode` so capitaliseGermanNouns becomes a no-op —
  // Phase 1 doesn't produce translations anyway.
  const postItems = all.map((t) => ({
    original: t.original,
    translation: '',
    type: t.type,
    source_forms: t.source_forms,
  }));
  const filtered = postProcessExtractedVocab(postItems, learningLanguageCode, '');
  return filtered.map((f) => ({
    original: f.original,
    type: f.type as ExtractedTerm['type'],
    source_forms: (f as { source_forms?: string[] }).source_forms ?? [],
  }));
}
