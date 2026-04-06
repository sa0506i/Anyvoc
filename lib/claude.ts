import { classifyWord, type SupportedLanguage } from './classifier';

const API_URL = 'https://anyvoc-backend.fly.dev/api/chat';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_CHARS_PER_CHUNK = 15000;

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
  return `Du bist ein Sprachlehrer-Assistent. Deine Aufgabe ist es, aus einem gegebenen Text alle bedeutungstragenden Vokabeln zu extrahieren (Substantive, Verben, Adjektive, feste Wendungen). Ignoriere Funktionswörter, Artikel alleine, Pronomen, Eigennamen und Zahlen.

Die Lernsprache ist ${learningLanguageName}, die Muttersprache ist ${nativeLanguageName}.

Regeln für die Formatierung:
- Substantive: immer im Singular mit direktem Artikel (der/die/das, le/la, o/a etc. je nach Sprache) – sowohl im "original"-Feld (Lernsprache) als auch im "translation"-Feld (Muttersprache). Falls eine weibliche Sonderform existiert, diese mit Komma dahinter angeben (z.B. original: "le médecin, la médecin" / translation: "der Arzt, die Ärztin"). Eigennamen ignorieren.
- In allen Sprachen außer Deutsch Substantive konsequent klein schreiben, auch wenn sie im Quelltext großgeschrieben waren (z.B. Satzanfang).
- Bindestriche aus Zeilenumbrüchen entfernen (z.B. "Wort-\\ntrennung" → "Worttrennung").
- Verben: immer im Infinitiv. Reflexive Verben immer mit Reflexivpronomen angeben (z.B. "sich erinnern", "se souvenir", "acordar-se")
- Adjektive: maskuline und feminine Form angeben, falls es Unterschiede gibt (z.B. "beau, belle" / "schön" oder "petit, petite" / "klein")

Zusätzlich: Gib im Feld "source_forms" alle exakten Wortformen an, die im Quelltext vorkommen (flektierte Formen, Plurale, Konjugationen etc.). Beispiel: Wenn im Text "rivais" steht und die Grundform "um rival" ist, dann source_forms: ["rivais"].

Antworte ausschließlich als JSON-Array ohne weiteren Text. Lass das level-Feld auf "" — es wird nach der Extraktion lokal gesetzt:
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

    try {
      // Extract JSON array from response (handle potential markdown wrapping)
      let jsonStr = responseText.match(/\[[\s\S]*\]/)?.[0];

      // If no complete array found, try to repair truncated JSON
      if (!jsonStr) {
        const arrayStart = responseText.indexOf('[');
        if (arrayStart !== -1) {
          jsonStr = responseText.substring(arrayStart);
          // Remove last incomplete object (after last '}')
          const lastComplete = jsonStr.lastIndexOf('}');
          if (lastComplete !== -1) {
            jsonStr = jsonStr.substring(0, lastComplete + 1) + ']';
          }
        }
      }

      if (jsonStr) {
        const parsed = JSON.parse(jsonStr) as ExtractedVocab[];
        allVocabs.push(...parsed);
      }
    } catch {
      console.warn('Failed to parse vocabulary response:', responseText.substring(0, 200));
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
    const systemPrompt = `Du bist ein professioneller Übersetzer. Übersetze den folgenden Text von ${fromLanguageName} nach ${toLanguageName}. Gib nur die Übersetzung zurück, ohne zusätzliche Erklärungen.`;
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
  const systemPrompt = `Du bist ein Sprachlehrer-Assistent. Übersetze das folgende Wort/die folgende Phrase von ${fromLanguageName} nach ${toLanguageName} und bestimme die Wortart.

Regeln für die Formatierung:
- Substantive: immer im Singular mit direktem Artikel (der/die/das, le/la, o/a etc. je nach Sprache) – sowohl im "original"-Feld (${fromLanguageName}) als auch im "translation"-Feld (${toLanguageName}). Falls eine weibliche Sonderform existiert, diese mit Komma dahinter angeben (z.B. original: "le médecin, la médecin" / translation: "der Arzt, die Ärztin"). Eigennamen ignorieren.
- In allen Sprachen außer Deutsch Substantive konsequent klein schreiben, auch wenn sie im Quelltext großgeschrieben waren (z.B. Satzanfang).
- Bindestriche aus Zeilenumbrüchen entfernen (z.B. "Wort-\\ntrennung" → "Worttrennung").
- Verben: immer im Infinitiv. Reflexive Verben immer mit Reflexivpronomen angeben (z.B. "sich erinnern", "se souvenir", "acordar-se")
- Adjektive: maskuline und feminine Form angeben, falls es Unterschiede gibt (z.B. "beau, belle" / "schön" oder "petit, petite" / "klein")

Antworte ausschließlich als JSON-Objekt ohne weiteren Text. Lass das level-Feld auf "" — es wird nach der Übersetzung lokal gesetzt:
{
  "original": "... (formatierte Grundform in ${fromLanguageName})",
  "translation": "... (formatierte Übersetzung in ${toLanguageName})",
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
