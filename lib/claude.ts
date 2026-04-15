import { classifyWord, type SupportedLanguage } from './classifier';
import { postProcessExtractedVocab } from './vocabFilters';
import { franc } from 'franc-min';

const API_URL = 'https://anyvoc-backend.fly.dev/api/chat';
const MODEL = 'mistral-small-2506';
const MAX_CHARS_PER_CHUNK = 5000;

/** Shared vocabulary formatting rules used in both extract and single-word prompts. */
const VOCAB_FORMATTING_RULES = `- Nouns: ALWAYS include the direct article before the noun in singular form (e.g. "der Hund", "le chat", "o passaporte", "el libro", "il cane", "de hond"). This is mandatory — never omit the article. If a distinct feminine form exists, add it after a comma (e.g. "le médecin, la médecin" / "der Arzt, die Ärztin"). Ignore proper nouns.
- In every language except German, write nouns in lowercase consistently, even if they were capitalised in the source text (e.g. at the start of a sentence).
- Remove hyphens that come from line breaks (e.g. "Wort-\\ntrennung" → "Worttrennung").
- Verbs: always in the infinitive. Always include the reflexive pronoun for reflexive verbs (e.g. "sich erinnern", "se souvenir", "acordar-se").
- Adjectives: give both masculine and feminine forms when they differ (e.g. "beau, belle" / "schön" or "petit, petite" / "klein").`;

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
}

interface ClaudeContentBlock {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface ClaudeResponse {
  content: { type: string; text: string }[];
  error?: { message: string };
}

export interface ExtractedVocab {
  original: string;
  translation: string;
  level: string;
  type: 'noun' | 'verb' | 'adjective' | 'phrase' | 'other';
  source_forms: string[];
}

interface CallClaudeOptions {
  temperature?: number;
}

export class ClaudeAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'ClaudeAPIError';
  }
}

export async function callClaude(
  messages: ClaudeMessage[],
  systemPrompt: string,
  maxTokens: number = 4096,
  options?: CallClaudeOptions,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 401) {
        throw new ClaudeAPIError('Service authentication error. Please try again later.', status);
      }
      if (status === 429) {
        throw new ClaudeAPIError(
          'API rate limit reached. Please wait a moment and try again.',
          status,
        );
      }
      const errorBody = await response.text().catch(() => '');
      throw new ClaudeAPIError(`API error (${status}): ${errorBody || 'Unknown error'}`, status);
    }

    const data: ClaudeResponse = await response.json();
    if (data.error) {
      throw new ClaudeAPIError(data.error.message);
    }

    const textBlock = data.content.find((b) => b.type === 'text');
    return textBlock?.text ?? '';
  } catch (err) {
    if (err instanceof ClaudeAPIError) throw err;
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new ClaudeAPIError('Request timed out. Please check your connection and try again.');
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ClaudeAPIError(`Network error: ${msg}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** ISO 639-3 (franc output) → ISO 639-1 (our language codes) for supported languages. */
const ISO3_TO_ISO1: Record<string, string> = {
  eng: 'en',
  deu: 'de',
  fra: 'fr',
  spa: 'es',
  ita: 'it',
  por: 'pt',
  nld: 'nl',
  swe: 'sv',
  nob: 'no',
  nno: 'no',
  dan: 'da',
  pol: 'pl',
  ces: 'cs',
};

/**
 * Detect the language of a text sample using franc (offline, synchronous).
 * Returns an ISO 639-1 code for supported languages, or null if undetermined
 * or unsupported.
 */
export function detectLanguage(text: string): string | null {
  const sample = text.substring(0, 500);
  const iso3 = franc(sample);
  if (iso3 === 'und') return null;
  return ISO3_TO_ISO1[iso3] ?? null;
}

export function chunkText(text: string, maxChars: number = MAX_CHARS_PER_CHUNK): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Find a sentence boundary near the max limit
    let splitAt = maxChars;
    const searchStart = Math.max(0, maxChars - 500);
    const searchArea = remaining.substring(searchStart, maxChars);

    // Look for sentence-ending punctuation followed by space
    const sentenceEnd = searchArea.search(/[.!?]\s+(?=\p{Lu})/u);
    if (sentenceEnd !== -1) {
      splitAt = searchStart + sentenceEnd + 1;
    }

    chunks.push(remaining.substring(0, splitAt).trim());
    remaining = remaining.substring(splitAt).trim();
  }

  return chunks;
}

function buildVocabSystemPrompt(nativeLanguageName: string, learningLanguageName: string): string {
  // CEFR classification is no longer the LLM's job — it is handled
  // deterministically by lib/classifier after extraction. The LLM only
  // needs to extract and format the words.
  return `You are a language teacher assistant. Extract all meaningful vocabulary from a given text.

CRITICAL FORMATTING RULE: Every noun MUST include its article. Never write a bare noun without an article.
Examples: "o passaporte" (not "passaporte"), "der Hund" (not "Hund"), "le chat" (not "chat"), "el libro" (not "libro").

The learning language is ${learningLanguageName}; the native language is ${nativeLanguageName}.

Rules:
- Extract nouns, verbs, adjectives, and fixed expressions. Ignore function words, standalone articles, pronouns, proper nouns, abbreviations, and numbers.
- Proper nouns to ignore include: people's names (Maria, João, Anna), cities (Berlin, Lisboa, Paris), countries (Portugal, Deutschland), brand or product names (Google, iPhone), and titles of works. Never include any of these in the output.
- Abbreviations and acronyms to ignore: any all-uppercase token of 2+ letters such as "GNR", "DLRG", "IRS", "EU", "USA". Never include these in the output.
- "original" field: the word in ${learningLanguageName}. "translation" field: the translation in ${nativeLanguageName}.
${VOCAB_FORMATTING_RULES}
- List every exact word form from the source text (inflected forms, plurals, conjugations) in "source_forms". Example: source contains "rivais", base form is "o rival" → source_forms: ["rivais"].

Respond exclusively as a JSON array, no additional text. Leave "level" as "":
[
  {
    "original": "o passaporte",
    "translation": "the passport",
    "level": "",
    "type": "noun",
    "source_forms": ["passaportes"]
  }
]`;
}

export async function extractVocabulary(
  text: string,
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: SupportedLanguage,
  nativeLanguageCode?: string,
): Promise<ExtractedVocab[]> {
  const chunks = chunkText(text);
  const allVocabs: ExtractedVocab[] = [];

  for (const chunk of chunks) {
    const systemPrompt = buildVocabSystemPrompt(nativeLanguageName, learningLanguageName);
    const responseText = await callClaude([{ role: 'user', content: chunk }], systemPrompt, 8192, {
      temperature: 0,
    });

    const arrayStart = responseText.indexOf('[');
    if (arrayStart === -1) {
      console.warn('No JSON array in vocabulary response:', responseText.substring(0, 200));
      continue;
    }

    // First try: parse from first '[' to last ']' (handles complete responses)
    let parsed: ExtractedVocab[] | null = null;
    const lastBracket = responseText.lastIndexOf(']');
    if (lastBracket > arrayStart) {
      try {
        parsed = JSON.parse(responseText.substring(arrayStart, lastBracket + 1));
      } catch {
        // fall through to repair
      }
    }

    // Repair fallback: truncate after the last fully completed top-level object
    if (!parsed) {
      try {
        const tail = responseText.substring(arrayStart);
        // Walk through and track brace depth to find completed top-level objects
        let depth = 0;
        let inString = false;
        let escape = false;
        let lastTopLevelCloseIdx = -1;
        for (let i = 0; i < tail.length; i++) {
          const c = tail[i];
          if (escape) {
            escape = false;
            continue;
          }
          if (c === '\\') {
            escape = true;
            continue;
          }
          if (c === '"') {
            inString = !inString;
            continue;
          }
          if (inString) continue;
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) lastTopLevelCloseIdx = i;
          }
        }
        if (lastTopLevelCloseIdx !== -1) {
          const repaired = tail.substring(0, lastTopLevelCloseIdx + 1) + ']';
          parsed = JSON.parse(repaired);
        }
      } catch {
        console.warn('Failed to repair vocabulary response:', responseText.substring(0, 300));
      }
    }

    if (parsed && Array.isArray(parsed)) {
      allVocabs.push(...parsed);
    }
  }

  // Post-processing: drop abbreviations + likely proper nouns the LLM let
  // through, and capitalise German noun translations. Pure, offline.
  // Architecture rule 21 enforces this call site.
  const filtered = postProcessExtractedVocab(
    allVocabs,
    learningLanguageCode,
    nativeLanguageCode ?? '',
  );
  allVocabs.length = 0;
  allVocabs.push(...filtered);

  // Deterministic CEFR classification via lib/classifier — the LLM no longer
  // assigns levels. High/medium-confidence words resolve synchronously.
  for (const vocab of allVocabs) {
    try {
      vocab.level = await classifyWord(vocab.original, learningLanguageCode, callClaude);
    } catch (err) {
      console.warn(
        `[claude] classifyWord failed for "${vocab.original}" (${learningLanguageCode}):`,
        (err as Error).message,
      );
      vocab.level = 'B1';
    }
  }

  return allVocabs;
}

export async function translateText(
  text: string,
  fromLanguageName: string,
  toLanguageName: string,
): Promise<string> {
  const chunks = chunkText(text);
  const translations: string[] = [];

  for (const chunk of chunks) {
    const systemPrompt = `You are a professional translator. Translate the following text from ${fromLanguageName} to ${toLanguageName}. Return only the translation, without any additional explanation.`;
    const result = await callClaude([{ role: 'user', content: chunk }], systemPrompt);
    translations.push(result);
  }

  return translations.join('\n\n');
}

export async function translateSingleWord(
  word: string,
  fromLanguageName: string,
  toLanguageName: string,
  fromLanguageCode: SupportedLanguage,
  toLanguageCode?: string,
): Promise<{ original: string; translation: string; level: string; type: string }> {
  // CEFR level is determined locally after the translation comes back —
  // the LLM is only responsible for formatting + translation.
  const systemPrompt = `You are a language teacher assistant. Translate the following word/phrase from ${fromLanguageName} to ${toLanguageName} and determine its word type.

Formatting rules (apply to both "original" and "translation" fields):
${VOCAB_FORMATTING_RULES}

Respond exclusively as a JSON object, with no additional text. Leave the level field as "" — it is set locally after translation:
{
  "original": "... (formatted base form in ${fromLanguageName})",
  "translation": "... (formatted translation in ${toLanguageName})",
  "level": "",
  "type": "noun|verb|adjective|phrase|other"
}`;

  const result = await callClaude([{ role: 'user', content: word }], systemPrompt, 4096, {
    temperature: 0,
  });

  let parsed: { original: string; translation: string; level: string; type: string } = {
    original: word,
    translation: '',
    level: 'B1',
    type: 'other',
  };
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // fallback to default above
  }

  // Post-processing: drop abbreviations / proper nouns and apply German
  // capitalisation when target is German. Architecture rule 21 enforces
  // this call site.
  const post = postProcessExtractedVocab(
    [{ original: parsed.original, translation: parsed.translation, type: parsed.type }],
    fromLanguageCode,
    toLanguageCode ?? '',
  );
  if (post.length === 0) {
    // Edge case: the LLM returned an abbreviation or proper noun. Leave
    // the parsed result as-is so the caller can show it; the UI layer
    // already deduplicates and the word never gets persisted unless the
    // user explicitly confirms.
  } else {
    parsed.translation = post[0].translation;
  }

  // Local deterministic CEFR assignment.
  try {
    parsed.level = await classifyWord(parsed.original || word, fromLanguageCode, callClaude);
  } catch (err) {
    console.warn(
      `[claude] classifyWord failed for "${parsed.original || word}" (${fromLanguageCode}):`,
      (err as Error).message,
    );
    if (!parsed.level) parsed.level = 'B1';
  }

  return parsed;
}

// Re-export for callers that need the classifier's supported-language type.
export type { SupportedLanguage } from './classifier';
