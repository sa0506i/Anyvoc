import { classifyWord, type SupportedLanguage } from './classifier';

const API_URL = 'https://anyvoc-backend.fly.dev/api/chat';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_CHARS_PER_CHUNK = 5000;

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
    public statusCode?: number
  ) {
    super(message);
    this.name = 'ClaudeAPIError';
  }
}

export async function callClaude(
  messages: ClaudeMessage[],
  systemPrompt: string,
  maxTokens: number = 4096,
  options?: CallClaudeOptions
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

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
        throw new ClaudeAPIError('API rate limit reached. Please wait a moment and try again.', status);
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

export async function detectLanguage(text: string): Promise<string> {
  const sample = text.substring(0, 500);
  const systemPrompt = 'You are a language detection tool. Given a text sample, reply with ONLY the ISO 639-1 two-letter language code (e.g. "en", "de", "fr", "pt"). Nothing else.';
  const result = await callClaude(
    [{ role: 'user', content: sample }],
    systemPrompt,
    10
  );
  return result.trim().toLowerCase().substring(0, 2);
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
    const sentenceEnd = searchArea.search(/[.!?]\s+(?=[A-ZÀ-ÿ])/);
    if (sentenceEnd !== -1) {
      splitAt = searchStart + sentenceEnd + 1;
    }

    chunks.push(remaining.substring(0, splitAt).trim());
    remaining = remaining.substring(splitAt).trim();
  }

  return chunks;
}

function buildVocabSystemPrompt(
  nativeLanguageName: string,
  learningLanguageName: string
): string {
  // CEFR classification is no longer the LLM's job — it is handled
  // deterministically by lib/classifier after extraction. The LLM only
  // needs to extract and format the words.
  return `You are a language teacher assistant. Your task is to extract all meaningful vocabulary (nouns, verbs, adjectives, fixed expressions) from a given text. Ignore function words, standalone articles, pronouns, proper nouns, and numbers.

The learning language is ${learningLanguageName}; the native language is ${nativeLanguageName}.

Formatting rules:
- Nouns: always singular with their direct article (der/die/das, le/la, o/a, etc., depending on the language) — in both the "original" field (learning language) and the "translation" field (native language). If a distinct feminine form exists, add it after a comma (e.g. original: "le médecin, la médecin" / translation: "der Arzt, die Ärztin"). Ignore proper nouns.
- In every language except German, write nouns in lowercase consistently, even if they were capitalised in the source text (e.g. at the start of a sentence).
- Remove hyphens that come from line breaks (e.g. "Wort-\\ntrennung" → "Worttrennung").
- Verbs: always in the infinitive. Always include the reflexive pronoun for reflexive verbs (e.g. "sich erinnern", "se souvenir", "acordar-se").
- Adjectives: give both masculine and feminine forms when they differ (e.g. "beau, belle" / "schön" or "petit, petite" / "klein").

Additionally, list every exact word form that occurs in the source text (inflected forms, plurals, conjugations, etc.) in the "source_forms" field. Example: if the source contains "rivais" and the base form is "um rival", then source_forms: ["rivais"].

Respond exclusively as a JSON array, with no additional text. Leave the level field as "" — it is set locally after extraction:
[
  {
    "original": "...",
    "translation": "...",
    "level": "",
    "type": "noun|verb|adjective|phrase|other",
    "source_forms": ["..."]
  }
]`;
}

export async function extractVocabulary(
  text: string,
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: SupportedLanguage
): Promise<ExtractedVocab[]> {
  const chunks = chunkText(text);
  const allVocabs: ExtractedVocab[] = [];

  for (const chunk of chunks) {
    const systemPrompt = buildVocabSystemPrompt(nativeLanguageName, learningLanguageName);
    const responseText = await callClaude(
      [{ role: 'user', content: chunk }],
      systemPrompt,
      8192,
      { temperature: 0 }
    );

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
          if (escape) { escape = false; continue; }
          if (c === '\\') { escape = true; continue; }
          if (c === '"') { inString = !inString; continue; }
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

  // Deterministic CEFR classification via lib/classifier — the LLM no longer
  // assigns levels. High/medium-confidence words resolve synchronously.
  for (const vocab of allVocabs) {
    try {
      vocab.level = await classifyWord(vocab.original, learningLanguageCode);
    } catch (err) {
      console.warn(
        `[claude] classifyWord failed for "${vocab.original}" (${learningLanguageCode}):`,
        (err as Error).message
      );
      vocab.level = 'B1';
    }
  }

  return allVocabs;
}

export async function translateText(
  text: string,
  fromLanguageName: string,
  toLanguageName: string
): Promise<string> {
  const chunks = chunkText(text);
  const translations: string[] = [];

  for (const chunk of chunks) {
    const systemPrompt = `You are a professional translator. Translate the following text from ${fromLanguageName} to ${toLanguageName}. Return only the translation, without any additional explanation.`;
    const result = await callClaude(
      [{ role: 'user', content: chunk }],
      systemPrompt
    );
    translations.push(result);
  }

  return translations.join('\n\n');
}

export async function translateSingleWord(
  word: string,
  fromLanguageName: string,
  toLanguageName: string,
  fromLanguageCode: SupportedLanguage
): Promise<{ original: string; translation: string; level: string; type: string }> {
  // CEFR level is determined locally after the translation comes back —
  // the LLM is only responsible for formatting + translation.
  const systemPrompt = `You are a language teacher assistant. Translate the following word/phrase from ${fromLanguageName} to ${toLanguageName} and determine its word type.

Formatting rules:
- Nouns: always singular with their direct article (der/die/das, le/la, o/a, etc., depending on the language) — in both the "original" field (${fromLanguageName}) and the "translation" field (${toLanguageName}). If a distinct feminine form exists, add it after a comma (e.g. original: "le médecin, la médecin" / translation: "der Arzt, die Ärztin"). Ignore proper nouns.
- In every language except German, write nouns in lowercase consistently, even if they were capitalised in the source text (e.g. at the start of a sentence).
- Remove hyphens that come from line breaks (e.g. "Wort-\\ntrennung" → "Worttrennung").
- Verbs: always in the infinitive. Always include the reflexive pronoun for reflexive verbs (e.g. "sich erinnern", "se souvenir", "acordar-se").
- Adjectives: give both masculine and feminine forms when they differ (e.g. "beau, belle" / "schön" or "petit, petite" / "klein").

Respond exclusively as a JSON object, with no additional text. Leave the level field as "" — it is set locally after translation:
{
  "original": "... (formatted base form in ${fromLanguageName})",
  "translation": "... (formatted translation in ${toLanguageName})",
  "level": "",
  "type": "noun|verb|adjective|phrase|other"
}`;

  const result = await callClaude(
    [{ role: 'user', content: word }],
    systemPrompt,
    4096,
    { temperature: 0 }
  );

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

  // Local deterministic CEFR assignment.
  try {
    parsed.level = await classifyWord(parsed.original || word, fromLanguageCode);
  } catch (err) {
    console.warn(
      `[claude] classifyWord failed for "${parsed.original || word}" (${fromLanguageCode}):`,
      (err as Error).message
    );
    if (!parsed.level) parsed.level = 'B1';
  }

  return parsed;
}

// Re-export for callers that need the classifier's supported-language type.
export type { SupportedLanguage } from './classifier';
