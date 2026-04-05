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
  learningLanguageName: string,
  level: string
): string {
  return `Du bist ein Sprachlehrer-Assistent. Deine Aufgabe ist es, aus einem gegebenen Text Vokabeln zu extrahieren, deren CEFR-Niveau ${level} oder höher ist. Ignoriere Wörter unter Niveau ${level} (z.B. bei ${level}: keine ${level === 'A2' ? 'A1' : level === 'B1' ? 'A1/A2' : level === 'B2' ? 'A1-B1' : level === 'C1' ? 'A1-B2' : level === 'C2' ? 'A1-C1' : 'niedrigeren'}-Wörter).

Die Lernsprache ist ${learningLanguageName}, die Muttersprache ist ${nativeLanguageName}.

Regeln für die Formatierung:
- Substantive: immer im Singular mit direktem Artikel (der/die/das, le/la, o/a etc. je nach Sprache) – sowohl im "original"-Feld (Lernsprache) als auch im "translation"-Feld (Muttersprache). Falls eine weibliche Sonderform existiert, diese mit Komma dahinter angeben (z.B. original: "le médecin, la médecin" / translation: "der Arzt, die Ärztin"). Eigennamen ignorieren.
- In allen Sprachen außer Deutsch Substantive konsequent klein schreiben, auch wenn sie im Quelltext großgeschrieben waren (z.B. Satzanfang).
- Bindestriche aus Zeilenumbrüchen entfernen (z.B. "Wort-\\ntrennung" → "Worttrennung").
- Verben: immer im Infinitiv. Reflexive Verben immer mit Reflexivpronomen angeben (z.B. "sich erinnern", "se souvenir", "acordar-se")
- Adjektive: maskuline und feminine Form angeben, falls es Unterschiede gibt (z.B. "beau, belle" / "schön" oder "petit, petite" / "klein")

Zusätzlich: Gib im Feld "source_forms" alle exakten Wortformen an, die im Quelltext vorkommen (flektierte Formen, Plurale, Konjugationen etc.). Beispiel: Wenn im Text "rivais" steht und die Grundform "um rival" ist, dann source_forms: ["rivais"].

Regeln für die CEFR-Einstufung:
- A1: Sehr häufige Alltagswörter (Zahlen, Farben, Familie, Essen, einfache Verben wie "sein", "haben", "gehen")
- A2: Häufige, aber etwas spezifischere Wörter (Berufe, Hobbys, Einkaufen, Wetter, Wegbeschreibung)
- B1: Mittelstufe-Wortschatz – gebräuchlich, aber nicht elementar (Meinungsäußerung, Gefühle, Reisen, Gesundheit)
- B2: Abstrakterer oder weniger häufiger Wortschatz (Politik, Umwelt, differenzierte Beschreibungen, idiomatische Wendungen)
- C1: Fortgeschrittener, akademischer oder fachspezifischer Wortschatz (Fachbegriffe, formelle Sprache, Nuancen)
- C2: Seltene, hochspezialisierte oder literarische Wörter (archaische Ausdrücke, fachliche Terminologie, stilistisch gehobene Sprache)

Wichtige Einstufungsregeln:
- Häufigkeitsprinzip: Hochfrequente Wörter → niedrigeres CEFR-Niveau; seltene Wörter → höheres Niveau
- Konservative Einstufung: Im Zweifelsfall zwischen zwei Niveaus IMMER das niedrigere wählen
- Konsistenz: Gleiche Eingabe muss immer die gleiche Einstufung ergeben

Antworte ausschließlich als JSON-Array ohne weiteren Text:
[
  {
    "original": "...",
    "translation": "...",
    "level": "A1|A2|B1|B2|C1|C2",
    "type": "noun|verb|adjective|phrase|other",
    "source_forms": ["..."]
  }
]`;
}

export async function extractVocabulary(
  text: string,
  nativeLanguageName: string,
  learningLanguageName: string,
  level: string
): Promise<ExtractedVocab[]> {
  const chunks = chunkText(text);
  const allVocabs: ExtractedVocab[] = [];

  for (const chunk of chunks) {
    const systemPrompt = buildVocabSystemPrompt(nativeLanguageName, learningLanguageName, level);
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
  toLanguageName: string
): Promise<{ original: string; translation: string; level: string; type: string }> {
  const systemPrompt = `Du bist ein Sprachlehrer-Assistent. Übersetze das folgende Wort/die folgende Phrase von ${fromLanguageName} nach ${toLanguageName} und bestimme das CEFR-Niveau und die Wortart.

Regeln für die Formatierung:
- Substantive: immer im Singular mit direktem Artikel (der/die/das, le/la, o/a etc. je nach Sprache) – sowohl im "original"-Feld (${fromLanguageName}) als auch im "translation"-Feld (${toLanguageName}). Falls eine weibliche Sonderform existiert, diese mit Komma dahinter angeben (z.B. original: "le médecin, la médecin" / translation: "der Arzt, die Ärztin"). Eigennamen ignorieren.
- In allen Sprachen außer Deutsch Substantive konsequent klein schreiben, auch wenn sie im Quelltext großgeschrieben waren (z.B. Satzanfang).
- Bindestriche aus Zeilenumbrüchen entfernen (z.B. "Wort-\\ntrennung" → "Worttrennung").
- Verben: immer im Infinitiv. Reflexive Verben immer mit Reflexivpronomen angeben (z.B. "sich erinnern", "se souvenir", "acordar-se")
- Adjektive: maskuline und feminine Form angeben, falls es Unterschiede gibt (z.B. "beau, belle" / "schön" oder "petit, petite" / "klein")

Regeln für die CEFR-Einstufung:
- A1: Sehr häufige Alltagswörter (Zahlen, Farben, Familie, Essen, einfache Verben wie "sein", "haben", "gehen")
- A2: Häufige, aber etwas spezifischere Wörter (Berufe, Hobbys, Einkaufen, Wetter, Wegbeschreibung)
- B1: Mittelstufe-Wortschatz – gebräuchlich, aber nicht elementar (Meinungsäußerung, Gefühle, Reisen, Gesundheit)
- B2: Abstrakterer oder weniger häufiger Wortschatz (Politik, Umwelt, differenzierte Beschreibungen, idiomatische Wendungen)
- C1: Fortgeschrittener, akademischer oder fachspezifischer Wortschatz (Fachbegriffe, formelle Sprache, Nuancen)
- C2: Seltene, hochspezialisierte oder literarische Wörter (archaische Ausdrücke, fachliche Terminologie, stilistisch gehobene Sprache)

Wichtige Einstufungsregeln:
- Häufigkeitsprinzip: Hochfrequente Wörter → niedrigeres CEFR-Niveau; seltene Wörter → höheres Niveau
- Konservative Einstufung: Im Zweifelsfall zwischen zwei Niveaus IMMER das niedrigere wählen
- Konsistenz: Gleiche Eingabe muss immer die gleiche Einstufung ergeben

Antworte ausschließlich als JSON-Objekt ohne weiteren Text:
{
  "original": "... (formatierte Grundform in ${fromLanguageName})",
  "translation": "... (formatierte Übersetzung in ${toLanguageName})",
  "level": "A1|A2|B1|B2|C1|C2",
  "type": "noun|verb|adjective|phrase|other"
}`;

  const result = await callClaude(
    [{ role: 'user', content: word }],
    systemPrompt,
    4096,
    { temperature: 0, top_p: 1 }
  );

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // fallback
  }

  return { original: word, translation: '', level: 'B1', type: 'other' };
}
