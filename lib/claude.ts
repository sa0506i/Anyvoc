import Constants from 'expo-constants';
import { classifyWord, type SupportedLanguage } from './classifier';
import { postProcessExtractedVocab } from './vocabFilters';
import { franc } from 'franc-min';

// Read the backend URL from app.json.extra so it lives in one place
// (config). Fallback to the Fly.dev URL so unit tests and anything
// that imports this module outside the Expo runtime still work.
const DEFAULT_API_URL = 'https://anyvoc-backend.fly.dev/api/chat';
const API_URL =
  (Constants?.expoConfig?.extra as { backendApiUrl?: string } | undefined)?.backendApiUrl ??
  DEFAULT_API_URL;
const MODEL = 'mistral-small-2506';
const MAX_CHARS_PER_CHUNK = 5000;

/** Shared vocabulary formatting rules used in both extract and single-word prompts.
 *
 * Adjective rule is language-scoped: Romance languages (fr, es, it, pt)
 * inflect adjectives by gender in the base form ("beau, belle"), so both
 * forms are requested. German / Dutch / Scandinavian / Slavic adjectives
 * do NOT carry gender in the dictionary form — "dünn" is the base, "dünne"
 * is an inflected form (weak declension). Emitting "dünn, dünne" pairs is
 * a category error. See CLAUDE.md Rule 38. */
const ROMANCE_ADJ_RULE = `- Adjectives: give both masculine and feminine forms when they differ (e.g. "beau, belle" / "petit, petite" / "bonito, bonita").`;
const SINGLE_FORM_ADJ_RULE = `- Adjectives: emit the SINGLE dictionary base form only (e.g. "dünn" not "dünn, dünne"; "mooi" not "mooi, mooie"; "stor" not "stor, stora"). Never pair an adjective with its inflected form — the language you are extracting does NOT inflect adjectives by gender in the dictionary entry.`;

function adjRuleForLang(learningLanguageCode: string): string {
  switch (learningLanguageCode) {
    case 'fr':
    case 'es':
    case 'it':
    case 'pt':
      return ROMANCE_ADJ_RULE;
    default:
      return SINGLE_FORM_ADJ_RULE;
  }
}

/** Shared non-adjective formatting rules. */
const NOUN_VERB_FORMATTING_RULES = `- Nouns: ALWAYS include the DEFINITE article before the noun in singular form — never the indefinite. German "der Hund" (not "ein Hund"), French "le chat" (not "un chat"), Portuguese "o passaporte" (not "um passaporte"), Spanish "el libro" (not "un libro"), Italian "il cane" (not "un cane"), Dutch "de hond" (not "een hond"). This is mandatory — never omit the article, never substitute the indefinite form. If a distinct feminine form exists, add it after a comma (e.g. "le médecin, la médecin" / "der Arzt, die Ärztin"). Ignore proper nouns.
- In every language except German, write nouns in lowercase consistently, even if they were capitalised in the source text (e.g. at the start of a sentence).
- Remove hyphens that come from line breaks (e.g. "Wort-\\ntrennung" → "Worttrennung").
- Verbs: always in the infinitive form — never conjugated, never a past participle. Portuguese "morrer" (not "morreu" / "morrido"), German "installieren" (not "installiert" / "zahlt"), Italian "rendere" (not "render" / "distingue"), French "constituer" (not "constitué"). Always include the reflexive pronoun for reflexive verbs (e.g. "sich erinnern", "se souvenir", "acordar-se").`;

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

// Retry policy for transient upstream failures (5xx + generic network
// errors). 4xx status codes and AbortError (timeout) are NOT retried —
// they're caller/config problems or user-visible timeouts. Backoff is
// jittered exponentially. Zeroed in tests so the existing suite stays
// fast without needing fake timers.
const MAX_RETRIES = 2; // 3 total attempts
const RETRY_BASE_MS = process.env.NODE_ENV === 'test' ? 0 : 400;

function isRetryable(err: unknown): boolean {
  if (err instanceof ClaudeAPIError) {
    return err.statusCode !== undefined && err.statusCode >= 500;
  }
  // Non-ClaudeAPIError errors reach us only as network failures —
  // AbortError is wrapped into a ClaudeAPIError above, so anything
  // else is a transient fetch/DNS/TLS hiccup worth retrying.
  return err instanceof Error;
}

function retryDelayMs(attempt: number): number {
  if (RETRY_BASE_MS === 0) return 0;
  const base = RETRY_BASE_MS * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 100);
  return base + jitter;
}

export async function callClaude(
  messages: ClaudeMessage[],
  systemPrompt: string,
  maxTokens: number = 4096,
  options?: CallClaudeOptions,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callClaudeOnce(messages, systemPrompt, maxTokens, options);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryable(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
    }
  }
  throw lastErr;
}

async function callClaudeOnce(
  messages: ClaudeMessage[],
  systemPrompt: string,
  maxTokens: number,
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
      let detail = 'Unknown error';
      if (errorBody) {
        try {
          const parsed = JSON.parse(errorBody) as { error?: { message?: string } };
          if (parsed?.error?.message) detail = parsed.error.message;
        } catch {
          detail = errorBody;
        }
      }
      throw new ClaudeAPIError(`API error (${status}): ${detail}`, status);
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

/** Scandinavian languages mark definiteness with a noun suffix rather than
 *  a prepositive article, so the generic "direct article" rule breaks down.
 *  For da/sv/no we instruct the model to prepend the INDEFINITE article
 *  based on grammatical gender (en/ett/ei), making the output cross-
 *  linguistically comparable. */
const SCANDINAVIAN_NOUN_RULE = `- IMPORTANT — for Swedish (sv), Norwegian (no), and Danish (da), these languages mark definiteness as a noun SUFFIX, not a prepositive article. In the "original" field, ALWAYS prepend the INDEFINITE article based on grammatical gender: "en" (common gender, sv/no/da), "ett" (neuter, sv), "ei" (feminine, no). Examples: "en artikel", "ett språk" (sv), "ei bok" (no), "en bog" (da). This applies to EVERY Scandi noun without exception, including MASS NOUNS and INGREDIENT NOUNS that often appear bare in recipes or health texts: write "ett salt" (not "salt"), "en mjölk" (not "mjölk"), "ett socker" (not "socker"), "en pepper" (not "pepper"), "ett smør" (not "smør"), "en information" (not "information"). A bare Scandi noun in the output is ALWAYS wrong, regardless of text genre or how the noun appears in the source.`;

/** Polish and Czech have no articles at all. The generic "ALWAYS include
 *  the direct article" line is vacuous for them — there is no article to
 *  include. We make it explicit so small models don't try to prepend a
 *  non-existent article or switch languages (e.g. slipping a Russian,
 *  German, or — observed in the 2026-04-21 validation-B run — a
 *  Portuguese "o" / "a" article in front of Polish m/f pairs like
 *  "o Europejczyk, Europejka". See CLAUDE.md Rule 41. */
const SLAVIC_NOUN_RULE = `- IMPORTANT — for Polish (pl) and Czech (cs), these languages have NO articles at all. In the "original" field, emit nouns in the BARE singular nominative form — NEVER prepend any article or determiner. This applies to SINGLE entries AND to m/f pairs: write "Europejczyk, Europejka" (not "o Europejczyk, Europejka"), "mieszkaniec, mieszkanka" (not "o mieszkaniec, mieszkanka"), "tekst" (not "ten tekst"), "vedení" (not "to vedení"). Never borrow an article from another language (no Portuguese "o"/"a", no German "der"/"die", no English "the"). This OVERRIDES the generic "include article" rule above for these two languages.`;

/** English is treated like the Germanic/Romance group: always prepend the
 *  definite article "the" to the singular noun. This keeps the extraction
 *  output shape consistent across languages in the app (every de/fr/es/it/
 *  pt/nl/en noun carries a prefix) and matches user expectation — a
 *  vocabulary card shows "the house" / "der Hund" / "le chat", not a mix
 *  of bare and article forms. The classifier's ARTICLE_PREFIXES already
 *  handles "the"/"a"/"an" stripping during lookup, so consistency on the
 *  output side is free. */
const ENGLISH_NOUN_RULE = `- IMPORTANT — for English (en), ALWAYS prepend the definite article "the" to the noun in singular form. Examples: "the house", "the child", "the book". Never emit a bare noun; never use the indefinite articles "a" or "an" in the "original" field (the lemma always takes "the").`;

const CRITICAL_NOUN_RULE_BY_LANG: Record<string, string> = {
  sv: SCANDINAVIAN_NOUN_RULE,
  no: SCANDINAVIAN_NOUN_RULE,
  da: SCANDINAVIAN_NOUN_RULE,
  pl: SLAVIC_NOUN_RULE,
  cs: SLAVIC_NOUN_RULE,
  en: ENGLISH_NOUN_RULE,
};

/**
 * Terse per-language formula for how nouns must appear in a given
 * language. Used in the prompt to pin down the "translation" field —
 * without this, the LLM mirrors the source-language register: bare in
 * Polish/Czech recipe contexts ("jídlo → dish"), definite in German
 * news ("die Lage → the situation"), indefinite in Swedish Wikipedia
 * ("en artikel → an article"). The 2026-04-21 validation-B run had EN
 * translations in all four flavours (bare / "a" / "an" / "the") across
 * different combos of the same run. Rule 42 forces one convention per
 * language so vocabulary cards look uniform.
 *
 * Each entry is a short phrase designed to fit inline in a prompt
 * sentence like "Use … for the translation." The examples duplicate
 * the source-side noun rules (SCANDINAVIAN / SLAVIC / ENGLISH /
 * generic) — that duplication is intentional: we cannot assume the
 * LLM will cross-reference the original-side rule when formatting the
 * translation.
 */
export function nounArticleHintFor(langCode: string | undefined): string {
  if (!langCode) return '';
  switch (langCode) {
    case 'en':
      return '"the" + singular noun (e.g. "the dog", "the book", "the year") — never bare, never "a"/"an"';
    case 'de':
      return 'German definite article + capitalised singular noun (e.g. "der Hund", "die Katze", "das Buch")';
    case 'fr':
      return '"le"/"la"/"l\'" + singular noun (e.g. "le chien", "la voiture", "l\'année")';
    case 'es':
      return '"el"/"la" + singular noun (e.g. "el libro", "la casa")';
    case 'it':
      return '"il"/"la"/"lo"/"l\'" + singular noun (e.g. "il cane", "la casa", "l\'uovo")';
    case 'pt':
      return '"o"/"a" + singular noun (e.g. "o passaporte", "a casa")';
    case 'nl':
      return '"de"/"het" + singular noun (e.g. "de hond", "het huis")';
    case 'sv':
      return 'indefinite "en"/"ett" + singular noun (Scandi convention: "en artikel", "ett språk")';
    case 'no':
      return 'indefinite "en"/"ei"/"et" + singular noun (Scandi convention: "en bil", "ei bok", "et hus")';
    case 'da':
      return 'indefinite "en"/"et" + singular noun (Scandi convention: "en bog", "et hus")';
    case 'pl':
    case 'cs':
      return 'bare singular nominative — no article, no determiner';
    default:
      return '';
  }
}

/** Avoid the two classes of multi-word noun leak we see most often: the
 *  LLM bundling an attributive adjective with the noun ("die öffentliche
 *  Gewalt") and the LLM labelling multi-word named entities as common
 *  nouns ("le Real Madrid"). */
const NOUN_SHAPE_RULE = `- For NOUN entries, "original" must be exactly "article + singular-noun" — a single content word after the article. Never bundle an attributive adjective with the noun (write "die Gewalt" not "die öffentliche Gewalt"; if the adjective is relevant, list it as a separate adjective entry). Multi-word proper nouns ("le Real Madrid", "la British Broadcasting Corporation") are proper nouns and MUST be omitted entirely.`;

function buildVocabSystemPrompt(
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: string,
  nativeLanguageCode?: string,
): string {
  // CEFR classification is no longer the LLM's job — it is handled
  // deterministically by lib/classifier after extraction. The LLM only
  // needs to extract and format the words.
  const scandiRule = CRITICAL_NOUN_RULE_BY_LANG[learningLanguageCode] ?? '';
  const translationNounHint = nounArticleHintFor(nativeLanguageCode);
  const translationRule = translationNounHint
    ? `- "translation" field for NOUN entries: follow the ${nativeLanguageName} convention — ${translationNounHint}. Apply this CONSISTENTLY across every noun translation, regardless of source-text genre (recipes, news, wikipedia all use the same form).`
    : '';
  return `You are a language teacher assistant. Extract all meaningful vocabulary from a given text.

CRITICAL FORMATTING RULE: Every noun MUST include its article. Never write a bare noun without an article.
Examples: "o passaporte" (not "passaporte"), "der Hund" (not "Hund"), "le chat" (not "chat"), "el libro" (not "libro").

The learning language is ${learningLanguageName}; the native language is ${nativeLanguageName}.

Rules:
- Extract nouns, verbs, adjectives, and fixed expressions. Ignore function words, standalone articles, pronouns, proper nouns, abbreviations, and numbers.
- Proper nouns to ignore include: people's names (Maria, João, Anna), cities (Berlin, Lisboa, Paris), countries (Portugal, Deutschland), brand or product names (Google, iPhone), titles of works, sports clubs (Real Madrid, FC Barcelona, Bayern Munich), and broadcaster names (BBC, HBO Max). Never include any of these in the output.
- Abbreviations and acronyms to ignore: any all-uppercase token of 2+ letters such as "GNR", "DLRG", "IRS", "EU", "USA". Never include these in the output.
- Each distinct word may appear AT MOST ONCE in the output array. Never emit the same entry multiple times even if the source text contains it many times — use "source_forms" to record every occurrence.
- "original" field: the word in ${learningLanguageName}. "translation" field: the translation in ${nativeLanguageName}.
${NOUN_SHAPE_RULE}
${scandiRule}
${NOUN_VERB_FORMATTING_RULES}
${adjRuleForLang(learningLanguageCode)}
${translationRule}
- List every exact word form from the source text (inflected forms, plurals, conjugations) in "source_forms". Example: source contains "rivais", base form is "o rival" → source_forms: ["rivais"].

"type" must be one of: "noun", "verb", "adjective", "phrase", "other".
Pick the type that matches each extracted word — DO NOT label every entry "noun".
Examples: verbs are infinitives ("correr", "sich erinnern"); phrases are multi-word fixed expressions ("de repente").

Respond exclusively as a JSON array, no additional text. Leave "level" as "".
The example below is shape only — the actual types in your output depend on what is in the source text:
[
  { "original": "o passaporte", "translation": "the passport", "level": "", "type": "noun", "source_forms": ["passaportes"] },
  { "original": "correr", "translation": "to run", "level": "", "type": "verb", "source_forms": ["corre", "corremos"] },
  { "original": "bonito, bonita", "translation": "beautiful", "level": "", "type": "adjective", "source_forms": ["bonitos"] },
  { "original": "de repente", "translation": "suddenly", "level": "", "type": "phrase", "source_forms": ["de repente"] }
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
    const systemPrompt = buildVocabSystemPrompt(
      nativeLanguageName,
      learningLanguageName,
      learningLanguageCode,
      nativeLanguageCode,
    );
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
      // Diagnostic: warn when the parsed array contains ≥3 consecutive
      // identical (original, type) entries — the hallmark of the repetition
      // loop failure mode observed in the 2026-04-20 sweep (être × 37,
      // la perfetta × 39). postProcessExtractedVocab collapses them to one
      // entry; the log surfaces prompt drift in production.
      let run = 0;
      let runKey = '';
      for (const v of parsed) {
        const key = (v as { original?: string }).original + '|' + (v as { type?: string }).type;
        if (key === runKey) {
          run++;
          if (run === 3) {
            console.warn(
              `[extractVocabulary] repetition loop detected for "${(v as { original?: string }).original}" (${learningLanguageCode} → ${nativeLanguageCode ?? '?'}); dedup will collapse it to one entry`,
            );
          }
        } else {
          run = 1;
          runKey = key;
        }
      }
      allVocabs.push(...parsed);
    }
  }

  // Post-processing: drop abbreviations, likely proper nouns, multi-word
  // noun leaks; deduplicate on (original, type); capitalise German noun
  // translations. Pure, offline. Architecture rule 21 enforces this call site.
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
  const systemPrompt = `You are a language teacher assistant. The user sends a word or phrase in ${fromLanguageName} — it may be inflected, conjugated, or in plural form. Your job: determine the dictionary base form, translate it into ${toLanguageName}, and identify its word type.

CRITICAL FORMATTING RULE: Every noun MUST include its article in the base form. Never write a bare noun without an article.
Examples: "o passaporte" (not "passaporte"), "der Hund" (not "Hund"), "le chat" (not "chat"), "el libro" (not "libro").

Formatting rules (apply to BOTH "original" and "translation" fields):
${NOUN_VERB_FORMATTING_RULES}
${adjRuleForLang(fromLanguageCode)}
${
  nounArticleHintFor(toLanguageCode)
    ? `- "translation" field for NOUN entries: follow the ${toLanguageName} convention — ${nounArticleHintFor(toLanguageCode)}. Apply this regardless of how the source word appears.`
    : ''
}

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
