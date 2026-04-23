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

/**
 * Prompt-version toggle for the Matrix-Regel A/B.
 *
 * Slice 2/7 (2026-04-23): v1 is byte-identical to the pre-Matrix-Regel baseline
 * and stays the Production default until the sweep in Slice 7 validates v2
 * end-to-end. v2 implements source-preserving extraction + matrix translation
 * targets per the user-approved 2026-04-23 matrices.
 *
 * Callers can override per-call (used by unit tests + try-pipeline). Env override
 * `ANYVOC_PROMPT_VERSION=v2` is used by the sweep scripts to switch Production
 * code paths without modifying source.
 */
export type PromptVersion = 'v1' | 'v2';

function defaultPromptVersion(): PromptVersion {
  return process.env.ANYVOC_PROMPT_VERSION === 'v2' ? 'v2' : 'v1';
}

/**
 * Per-language example bank used by the prompt builders. Each entry
 * holds the concrete lemma / counter-example shapes the LLM needs in
 * order to follow the extraction rules for THAT language only.
 *
 * Rule 46 (F11, 2026-04-22): the prompt must only carry examples in
 * the learning language of the current extraction and, for the
 * translation-side rule, in the native language. The earlier shared
 * constants (NOUN_VERB_FORMATTING_RULES, TRANSLATION_MIRROR_RULE,
 * NOUN_SHAPE_RULE, ROMANCE_ADJ_RULE, SINGLE_FORM_ADJ_RULE, the CRITICAL
 * header) mixed examples from 4-7 languages in every single prompt,
 * which diluted the signal for small models (47% Portuguese-native
 * translations leaking into English in the 2026-04-22 sweep). This
 * dict + the builder functions below replace every cross-language
 * example with a learn-lang-only one.
 */
interface LangExamples {
  /** English name for template interpolation ("German", "Portuguese"). */
  name: string;
  /** Article category of the canonical "original" field per Rule 34/41. */
  artCat: 'def' | 'indef' | 'bare';
  /** Canonical lemma shape: "der Hund" (de), "en bild" (sv), "pies" (pl). */
  nounLemma: string;
  /** Bare form for the CRITICAL header counter ("not 'Hund'"). */
  nounBare: string;
  /** Indef counter for def-cat languages ("not 'ein Hund'"). */
  nounIndef?: string;
  /** Definite form used as translation target when the source category is DEF.
   *  For articled langs this is identical to nounLemma (e.g. "der Hund") —
   *  leave undefined; consumers fall back to nounLemma.
   *  For Scandi langs this is the SUFFIX-DEFINITE form ("hunden" / "bogen" /
   *  "bilden") which differs from nounLemma (the INDEF-prefix form "en hund").
   *  For articleless langs (pl/cs) this is unused — they have no articles. */
  nounDef?: string;
  /** Example of a legit-looking attributive-adjective-plus-noun pair
   *  that must be split into two entries — for NOUN_SHAPE_RULE. */
  attrAdj?: { good: string; bad: string };
  /** Verb infinitive + a common wrong form (past participle / conjugated). */
  verbInf: string;
  verbWrong: string;
  /** Reflexive verb example if the language has a dedicated marker. */
  verbReflexive?: string;
  /** Single-form adjective example for non-Romance langs. */
  adjSingle: string;
  /** Inflected counter-form for non-Romance ("dünne" vs "dünn"). */
  adjInflected?: string;
  /** Legitimate m/f pair for Romance ("beau, belle"). */
  adjMFPair?: string;
  /** Two-line phrase example for the JSON block. */
  phraseExample: string;
  /** Translation of phraseExample — fallback if nativeLang phrase missing. */
  phraseTranslation?: string;
}

const LANG_EXAMPLES: Record<string, LangExamples> = {
  en: {
    name: 'English',
    artCat: 'def',
    nounLemma: 'the dog',
    nounBare: 'dog',
    nounIndef: 'a dog',
    attrAdj: { good: 'the power', bad: 'the political power' },
    verbInf: 'to run',
    verbWrong: 'ran',
    adjSingle: 'small',
    phraseExample: 'by the way',
  },
  de: {
    name: 'German',
    artCat: 'def',
    nounLemma: 'der Hund',
    nounBare: 'Hund',
    nounIndef: 'ein Hund',
    attrAdj: { good: 'die Gewalt', bad: 'die öffentliche Gewalt' },
    verbInf: 'laufen',
    verbWrong: 'lief',
    verbReflexive: 'sich erinnern',
    adjSingle: 'klein',
    adjInflected: 'kleine',
    phraseExample: 'im Grunde genommen',
  },
  fr: {
    name: 'French',
    artCat: 'def',
    nounLemma: 'le chien',
    nounBare: 'chien',
    nounIndef: 'un chien',
    attrAdj: { good: 'la cité', bad: 'la cité médiévale' },
    verbInf: 'courir',
    verbWrong: 'couru',
    verbReflexive: 'se souvenir',
    adjSingle: 'petit',
    adjMFPair: 'petit, petite',
    phraseExample: 'de toute façon',
  },
  es: {
    name: 'Spanish',
    artCat: 'def',
    nounLemma: 'el perro',
    nounBare: 'perro',
    nounIndef: 'un perro',
    attrAdj: { good: 'la lengua', bad: 'la lengua materna' },
    verbInf: 'correr',
    verbWrong: 'corrió',
    verbReflexive: 'acordarse',
    adjSingle: 'bonito',
    adjMFPair: 'bonito, bonita',
    phraseExample: 'de repente',
  },
  it: {
    name: 'Italian',
    artCat: 'def',
    nounLemma: 'il cane',
    nounBare: 'cane',
    nounIndef: 'un cane',
    attrAdj: { good: 'la città', bad: 'la città medievale' },
    verbInf: 'correre',
    verbWrong: 'corso',
    verbReflexive: 'ricordarsi',
    adjSingle: 'bello',
    adjMFPair: 'bello, bella',
    phraseExample: 'di solito',
  },
  pt: {
    name: 'Portuguese',
    artCat: 'def',
    nounLemma: 'o cão',
    nounBare: 'cão',
    nounIndef: 'um cão',
    attrAdj: { good: 'a cidade', bad: 'a cidade medieval' },
    verbInf: 'correr',
    verbWrong: 'correu',
    verbReflexive: 'acordar-se',
    adjSingle: 'bonito',
    adjMFPair: 'bonito, bonita',
    phraseExample: 'de repente',
  },
  nl: {
    name: 'Dutch',
    artCat: 'def',
    nounLemma: 'de hond',
    nounBare: 'hond',
    nounIndef: 'een hond',
    attrAdj: { good: 'de macht', bad: 'de politieke macht' },
    verbInf: 'lopen',
    verbWrong: 'liep',
    verbReflexive: 'zich herinneren',
    adjSingle: 'mooi',
    adjInflected: 'mooie',
    phraseExample: 'aan de slag',
  },
  sv: {
    name: 'Swedish',
    artCat: 'indef',
    nounLemma: 'en hund',
    nounBare: 'hund',
    nounDef: 'hunden',
    attrAdj: { good: 'en makt', bad: 'en politisk makt' },
    verbInf: 'att springa',
    verbWrong: 'sprang',
    adjSingle: 'stor',
    adjInflected: 'stora',
    phraseExample: 'hur som helst',
  },
  no: {
    name: 'Norwegian',
    artCat: 'indef',
    nounLemma: 'en hund',
    nounBare: 'hund',
    nounDef: 'hunden',
    attrAdj: { good: 'en makt', bad: 'en politisk makt' },
    verbInf: 'å springe',
    verbWrong: 'sprang',
    adjSingle: 'stor',
    adjInflected: 'store',
    phraseExample: 'for eksempel',
  },
  da: {
    name: 'Danish',
    artCat: 'indef',
    nounLemma: 'en hund',
    nounBare: 'hund',
    nounDef: 'hunden',
    attrAdj: { good: 'en magt', bad: 'en politisk magt' },
    verbInf: 'at løbe',
    verbWrong: 'løb',
    adjSingle: 'stor',
    adjInflected: 'store',
    phraseExample: 'for eksempel',
  },
  pl: {
    name: 'Polish',
    artCat: 'bare',
    nounLemma: 'pies',
    nounBare: 'pies',
    attrAdj: { good: 'państwo', bad: 'potężne państwo' },
    verbInf: 'biegać',
    verbWrong: 'biegł',
    adjSingle: 'wysoki',
    phraseExample: 'na przykład',
  },
  cs: {
    name: 'Czech',
    artCat: 'bare',
    nounLemma: 'pes',
    nounBare: 'pes',
    attrAdj: { good: 'stát', bad: 'mocný stát' },
    verbInf: 'běžet',
    verbWrong: 'běžel',
    adjSingle: 'vysoký',
    phraseExample: 'na příklad',
  },
};

function getLangExamples(code: string): LangExamples {
  return LANG_EXAMPLES[code] ?? LANG_EXAMPLES.en!;
}

/** Builds the "- Nouns: …" + "- Verbs: …" pair using only learn-lang
 *  examples (F11 / Rule 46). For indef-category languages (sv/no/da)
 *  the noun line is a no-op — the SCANDINAVIAN_NOUN_RULE block already
 *  covers the canonical indef-prefix convention. For bare-category
 *  languages (pl/cs) the noun line is also a no-op — SLAVIC_NOUN_RULE
 *  covers it. Only def-category languages get a "DEFINITE not
 *  indefinite" line here, and only with their own example. */
function buildNounVerbRules(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  const lines: string[] = [];
  if (ex.artCat === 'def' && ex.nounIndef) {
    lines.push(
      `- Nouns: ALWAYS include the DEFINITE article before the noun in singular form — never the indefinite. For ${ex.name}: write "${ex.nounLemma}" (not "${ex.nounIndef}", not "${ex.nounBare}"). This is mandatory. If a distinct feminine form exists, add it after a comma.`,
    );
  }
  if (learnCode !== 'de') {
    lines.push(
      `- Write nouns in lowercase consistently, even if they were capitalised in the source text (e.g. at the start of a sentence).`,
    );
  }
  lines.push(
    `- Remove hyphens that come from line breaks (e.g. "Wort-\\ntrennung" → "Worttrennung").`,
  );
  const reflexiveHint = ex.verbReflexive
    ? ` Reflexive verbs carry the pronoun: "${ex.verbReflexive}".`
    : '';
  lines.push(
    `- Verbs: always the infinitive form — never conjugated, never a past participle. For ${ex.name}: "${ex.verbInf}" (not "${ex.verbWrong}").${reflexiveHint}`,
  );
  return lines.join('\n');
}

/** Builds the adjective rule using only learn-lang examples. */
function buildAdjRule(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.adjMFPair) {
    // Romance: m + f pair is legit
    return `- Adjectives: give both masculine and feminine forms when they differ (e.g. "${ex.adjMFPair}" in ${ex.name}).`;
  }
  // All others: single form. Keep a brief counter-example when we have one.
  const counter = ex.adjInflected
    ? ` (e.g. "${ex.adjSingle}" not "${ex.adjSingle}, ${ex.adjInflected}")`
    : ` (e.g. "${ex.adjSingle}")`;
  return `- Adjectives: emit the SINGLE dictionary base form only${counter}. Never pair an adjective with its inflected form — ${ex.name} does NOT inflect adjectives by gender in the dictionary entry.`;
}

/** Builds the "one content word after the article" noun-shape rule
 *  using only the learn-lang counter-example. */
function buildNounShapeRule(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  const attrExample = ex.attrAdj
    ? ` For ${ex.name}: write "${ex.attrAdj.good}" not "${ex.attrAdj.bad}" (list the adjective as a separate entry if relevant).`
    : '';
  return `- For NOUN entries, "original" must be exactly "article + singular-noun" — a single content word after the article.${attrExample} Multi-word proper nouns (club names, organisation names, broadcaster names) are proper nouns and MUST be omitted entirely.`;
}

/** Builds the CRITICAL FORMATTING header with a single learn-lang example. */
function buildCriticalHeader(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.artCat === 'bare') {
    // pl/cs — there is no article to demand
    return `CRITICAL FORMATTING RULE: Extract each noun in its ${ex.name} dictionary base form. Example: "${ex.nounLemma}".`;
  }
  return `CRITICAL FORMATTING RULE: Every noun MUST include its article. Never write a bare noun without an article. Example for ${ex.name}: "${ex.nounLemma}" (not "${ex.nounBare}").`;
}

/** Picks the correct native-lang example form for a translation based
 *  on the learn-lang's article category (Rule 42 Mirror + F6 fallback).
 *
 *  - learn DEF → native's def form (nativeEx.nounLemma for def-cat
 *    natives; for indef-cat Scandi natives we use their nounLemma too,
 *    which is the indef-prefix lemma per Rule 34 — accepted as the
 *    Scandi dictionary convention). For bare-cat natives (pl/cs) →
 *    bare nounLemma.
 *  - learn INDEF (Scandi) → native's indef form: nativeEx.nounIndef
 *    when the native has a distinct indef article (de/fr/es/it/pt/
 *    nl/en); otherwise nativeEx.nounLemma (already indef for Scandi
 *    natives; bare for pl/cs natives).
 *  - learn BARE (pl/cs) → native's default (nativeEx.nounLemma).
 *
 *  F12 fix (2026-04-22): without this dispatch, the translation
 *  example for every combo used nativeEx.nounLemma regardless of
 *  learn's category. For INDEF-learn → def-cat native (e.g. sv→de)
 *  this produced "en hund → der Hund" — indef source mirrored to def
 *  target, which directly contradicted the Mirror rule stated in the
 *  same prompt. The LLM followed the concrete example over the
 *  abstract rule, driving INDEF→indef compliance down to 0% for
 *  de/nl/es natives in the post-F11 sweep.
 */
/** Translation-target lookup per the user-approved matrix (2026-04-23).
 *
 *  Given the article category of the source-language occurrence of a noun
 *  (`'def' | 'indef' | 'bare'`), return the translation target in the
 *  native language that matches that category's convention.
 *
 *  Rule (see `lib/__tests__/matrix-rule.test.ts` for the 12×3 ground truth):
 *   - Articleless native (pl/cs): always `nounBare` — these languages have
 *     no articles at all, so the native target is bare regardless of source.
 *   - DEF source → native's definite form. For articled natives this is
 *     `nounLemma` (which carries the DEF article in those profiles, e.g.
 *     "der Hund"); for Scandi natives this is `nounDef` (the suffix-definite
 *     form "hunden") which differs from their INDEF-prefix `nounLemma`.
 *   - INDEF or BARE source → native's indefinite form. For articled natives
 *     this is `nounIndef` ("ein Hund"); for Scandi natives this is
 *     `nounLemma` (already the INDEF-prefix lemma "en hund"). BARE mirrors
 *     to INDEF per the user comment attached to the matrix ("Fuer BARE
 *     (pl,cs), wird immer auf indef uebersetzt").
 */
export function matrixTranslationTarget(
  sourceCat: 'def' | 'indef' | 'bare',
  nativeCode: string,
): string {
  const n = getLangExamples(nativeCode);
  if (n.artCat === 'bare') return n.nounBare; // articleless native
  if (sourceCat === 'def') {
    // Scandi natives use the suffix-definite form; articled natives' lemma IS def.
    return n.artCat === 'indef' ? n.nounDef! : n.nounLemma;
  }
  // INDEF or BARE source → native's indefinite form.
  return n.artCat === 'indef' ? n.nounLemma : n.nounIndef!;
}

function pickTranslationTarget(learnCode: string, nativeCode: string): string {
  const learnEx = getLangExamples(learnCode);
  const nativeEx = getLangExamples(nativeCode);
  if (nativeEx.artCat === 'bare') {
    // pl/cs native: always bare (no articles exist)
    return nativeEx.nounLemma;
  }
  if (learnEx.artCat === 'indef' && nativeEx.nounIndef) {
    // Scandi learn → native's indef form (mirror indef category)
    return nativeEx.nounIndef;
  }
  // DEF or BARE learn → native's canonical lemma
  return nativeEx.nounLemma;
}

/** Builds the translation-side article rule using one learn-lang
 *  source and one native-lang target example. Replaces the earlier
 *  TRANSLATION_MIRROR_RULE constant which carried examples for 7
 *  natives at once. */
function buildTranslationRule(learnCode: string, nativeCode: string): string {
  const learnEx = getLangExamples(learnCode);
  const nativeEx = getLangExamples(nativeCode);
  const source = learnEx.nounLemma;
  const target = pickTranslationTarget(learnCode, nativeCode);
  const bareNote =
    nativeEx.artCat === 'bare'
      ? `${nativeEx.name} has no articles, so the translation is bare.`
      : `Use the ${nativeEx.name} dictionary form with its article, matching the definiteness category of the original.`;
  return `- "translation" field for NOUN entries: ${bareNote} Example: "${source}" (${learnEx.name}) → "${target}" (${nativeEx.name}).`;
}

/** JSON example for the trailing prompt block — now using one
 *  learn-lang noun + one native-lang translation pair instead of the
 *  PT-heavy cross-language mix the old template hard-coded. */
function buildJsonExample(learnCode: string, nativeCode: string): string {
  const le = getLangExamples(learnCode);
  const ne = getLangExamples(nativeCode);
  const nounTarget = pickTranslationTarget(learnCode, nativeCode);
  // source_forms shows an inflected form — use a plausible plural/conjugated
  // shape, falling back to the bare/wrong form if nothing better is known.
  const nounSrcForm = le.nounBare;
  const verbSrcForm = le.verbWrong;
  return `[
  { "original": "${le.nounLemma}", "translation": "${nounTarget}", "level": "", "type": "noun", "source_forms": ["${nounSrcForm}"] },
  { "original": "${le.verbInf}", "translation": "${ne.verbInf}", "level": "", "type": "verb", "source_forms": ["${verbSrcForm}"] },
  { "original": "${le.adjMFPair ?? le.adjSingle}", "translation": "${ne.adjMFPair ?? ne.adjSingle}", "level": "", "type": "adjective", "source_forms": ["${le.adjInflected ?? le.adjSingle}"] },
  { "original": "${le.phraseExample}", "translation": "${ne.phraseExample}", "level": "", "type": "phrase", "source_forms": ["${le.phraseExample}"] }
]`;
}

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
  /** v2 Matrix-Regel: article category of the first occurrence in the
   *  source text, as reported by the LLM. Present only when PROMPT_VERSION
   *  is 'v2'; stripped in v1 mode. Not persisted to SQLite — strictly
   *  pipeline metadata used by the A/B sweep to compute Translation-Target
   *  Match Rate (LLM translation vs matrixTranslationTarget expectation). */
  source_cat?: 'def' | 'indef' | 'bare';
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
const SCANDINAVIAN_NOUN_RULE = `- IMPORTANT — for Swedish (sv), Norwegian (no), and Danish (da), these languages mark definiteness as a noun SUFFIX, not a prepositive article. In the "original" field, ALWAYS prepend the INDEFINITE article based on grammatical gender: "en" (common gender, sv/no/da), "ett" (neuter, sv), "ei" (feminine, no). Examples: "en artikel", "ett språk" (sv), "ei bok" (no), "en bog" (da). This rule is UNCONDITIONAL — it applies regardless of the native language, regardless of text genre (recipes, news, legal, wikipedia), regardless of how the noun appears in the source text. If the source text has the DEFINITE-SUFFIX form, you MUST still extract the lemma with the indefinite prefix: source "folket" → extract "ett folk" (not "folket"), source "bilden" → extract "en bild" (not "bilden"), source "lagen" → extract "en lag" (not "lagen"), source "hjernen" → extract "en hjerne" (not "hjernen"), source "bogen" → extract "en bog" (not "bogen"). If the source text has the BARE form (common in running text after adjectives, in recipes, or in legal text), you MUST still add the indefinite article: source "respekt" → extract "en respekt", source "bostad" → extract "en bostad", source "utbildning" → extract "en utbildning", source "salt" → extract "ett salt", source "mjölk" → extract "en mjölk". A Scandi noun output WITHOUT "en"/"ett"/"ei" prefix is ALWAYS wrong. This applies even when you are translating into another Scandinavian language, into a Slavic language (pl, cs), into Italian/French/Romance, or into any other native — never, ever, drop the Scandi indefinite article from the "original" field.`;

/** v2 Scandi noun rule — source-preserving per the 2026-04-23 matrix.
 *
 *  Reverses the v1 "ALWAYS prepend INDEFINITE article" normalisation. The LLM
 *  now keeps the article category of the FIRST occurrence, with bare forms
 *  defaulting to indefinite-prefix. This lets DE-native learners studying
 *  Swedish see "hunden" on their vocabulary card when the text said "hunden",
 *  rather than having it silently rewritten to "en hund". */
const SCANDINAVIAN_NOUN_RULE_V2 = `- IMPORTANT — for Swedish (sv), Norwegian (no), and Danish (da), definiteness is marked as a noun SUFFIX, not a prepositive article. Preserve the article category of the FIRST occurrence of each noun:
  • SUFFIX-DEFINITE source (text shows e.g. "hunden", "bogen", "bilden", "folket"): emit as-is with source_cat="def".
  • INDEFINITE-PREFIX source (text shows "en hund", "ett språk", "ei bok"): emit with the prefix, source_cat="indef".
  • BARE source (text shows just "hund", "salt", "mjölk" — typical in recipes, legal text, or after adjectives): prepend the indefinite article by grammatical gender ("en" common / "ett" neuter sv / "ei" feminine no), source_cat="bare".
Never emit a Scandi noun that is bare of BOTH a suffix-definite marker AND an indefinite prefix. Apply this regardless of native language and text genre.`;

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

/** v2 English noun rule — source-preserving per the 2026-04-23 matrix.
 *  Reverses v1's "always 'the'" enforcement so that "a dog" stays "a dog"
 *  when the source text used the indefinite article. */
const ENGLISH_NOUN_RULE_V2 = `- IMPORTANT — for English (en), preserve the article category of the FIRST occurrence of each noun:
  • DEF source ("the dog"): emit "the dog" with source_cat="def".
  • INDEF source ("a dog"/"an apple"): emit "a dog" with source_cat="indef".
  • BARE source (headlines "Dog bites man", or bare mass nouns): emit with "a"/"an", source_cat="bare".
Never emit a bare English noun in the "original" field — always carry "the" or "a"/"an".`;

const CRITICAL_NOUN_RULE_BY_LANG: Record<string, string> = {
  sv: SCANDINAVIAN_NOUN_RULE,
  no: SCANDINAVIAN_NOUN_RULE,
  da: SCANDINAVIAN_NOUN_RULE,
  pl: SLAVIC_NOUN_RULE,
  cs: SLAVIC_NOUN_RULE,
  en: ENGLISH_NOUN_RULE,
};

/** v2 variant of the above lookup. pl/cs keep the same rule (no articles);
 *  Scandi + English switch to source-preserving variants. */
const CRITICAL_NOUN_RULE_BY_LANG_V2: Record<string, string> = {
  sv: SCANDINAVIAN_NOUN_RULE_V2,
  no: SCANDINAVIAN_NOUN_RULE_V2,
  da: SCANDINAVIAN_NOUN_RULE_V2,
  pl: SLAVIC_NOUN_RULE,
  cs: SLAVIC_NOUN_RULE,
  en: ENGLISH_NOUN_RULE_V2,
};

// ─── v2 fragment builders ─────────────────────────────────────────────
// Source-preserving extraction + matrix translation targets. Kept as
// siblings of the v1 builders so the v1 code paths stay regex-intact for
// the existing architecture tests.

/** v2 CRITICAL header — source-preserving per learn-lang article system. */
function buildCriticalHeaderV2(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  if (ex.artCat === 'bare') {
    // pl/cs — no articles exist; unchanged from v1
    return `CRITICAL FORMATTING RULE: Extract each noun in its ${ex.name} dictionary base form. Example: "${ex.nounLemma}".`;
  }
  if (ex.artCat === 'indef') {
    // Scandi — show both def-suffix and indef-prefix canonical examples
    return `CRITICAL FORMATTING RULE: Every ${ex.name} noun MUST be extracted in the form matching its FIRST occurrence in the source — suffix-definite (e.g. "${ex.nounDef}") or indefinite-prefix (e.g. "${ex.nounLemma}"). Bare source forms default to the indefinite prefix.`;
  }
  // Articled — show both def and indef canonical examples
  return `CRITICAL FORMATTING RULE: Every noun MUST include its article, matching the article used at its FIRST occurrence in the source text. Example for ${ex.name}: DEF "${ex.nounLemma}" or INDEF "${ex.nounIndef}". Never emit a bare noun.`;
}

/** v2 noun+verb rule — articled langs preserve source article category. */
function buildNounVerbRulesV2(learnCode: string): string {
  const ex = getLangExamples(learnCode);
  const lines: string[] = [];
  if (ex.artCat === 'def' && ex.nounIndef) {
    // Articled learn lang: preserve first-occurrence article category
    lines.push(
      `- Nouns: extract each noun in singular form with the article matching its FIRST occurrence in the source. For ${ex.name}: DEF source → "${ex.nounLemma}" (source_cat="def"); INDEF source → "${ex.nounIndef}" (source_cat="indef"); bare source (rare, e.g. headlines) → default to "${ex.nounIndef}" with source_cat="bare". If a distinct feminine form exists, add it after a comma.`,
    );
  }
  if (learnCode !== 'de') {
    lines.push(
      `- Write nouns in lowercase consistently, even if they were capitalised in the source text (e.g. at the start of a sentence).`,
    );
  }
  lines.push(
    `- Remove hyphens that come from line breaks (e.g. "Wort-\\ntrennung" → "Worttrennung").`,
  );
  const reflexiveHint = ex.verbReflexive
    ? ` Reflexive verbs carry the pronoun: "${ex.verbReflexive}".`
    : '';
  lines.push(
    `- Verbs: always the infinitive form — never conjugated, never a past participle. For ${ex.name}: "${ex.verbInf}" (not "${ex.verbWrong}").${reflexiveHint} For non-noun entries (verb/adjective/phrase) set source_cat="bare".`,
  );
  return lines.join('\n');
}

/** v2 translation rule — matrix-accurate, shows DEF + INDEF source examples. */
function buildTranslationRuleV2(learnCode: string, nativeCode: string): string {
  const learnEx = getLangExamples(learnCode);
  const nativeEx = getLangExamples(nativeCode);
  if (nativeEx.artCat === 'bare') {
    // Articleless native: always bare regardless of source
    return `- "translation" field for NOUN entries: ${nativeEx.name} has no articles — translation is always bare. Example: any ${learnEx.name} source → "${nativeEx.nounBare}".`;
  }
  const defTarget = matrixTranslationTarget('def', nativeCode);
  const indefTarget = matrixTranslationTarget('indef', nativeCode);
  if (learnEx.artCat === 'bare') {
    // Learn is pl/cs: source is always bare, translate to native's INDEF
    return `- "translation" field for NOUN entries: ${learnEx.name} has no articles (source is always bare), so translate to the ${nativeEx.name} indefinite form. Example: "${learnEx.nounLemma}" → "${indefTarget}".`;
  }
  // Articled or Scandi learn: show DEF-source→def-target and INDEF-source→indef-target
  const learnDefExample = learnEx.artCat === 'indef' ? learnEx.nounDef! : learnEx.nounLemma;
  const learnIndefExample = learnEx.artCat === 'indef' ? learnEx.nounLemma : learnEx.nounIndef!;
  return `- "translation" field for NOUN entries: mirror the source's article category into ${nativeEx.name}:
  • DEF source ("${learnDefExample}") → "${defTarget}" (${nativeEx.name} def).
  • INDEF source ("${learnIndefExample}") → "${indefTarget}" (${nativeEx.name} indef).
  • BARE source → "${indefTarget}" (${nativeEx.name} indef — bare mirrors to indef).`;
}

/** v2 JSON example — adds source_cat field; DEF-source shape for the noun. */
function buildJsonExampleV2(learnCode: string, nativeCode: string): string {
  const le = getLangExamples(learnCode);
  const ne = getLangExamples(nativeCode);
  // Canonical noun example uses DEF source for articled/scandi, bare for articleless.
  let sourceCat: 'def' | 'indef' | 'bare';
  let learnNoun: string;
  if (le.artCat === 'bare') {
    sourceCat = 'bare';
    learnNoun = le.nounLemma;
  } else if (le.artCat === 'indef') {
    sourceCat = 'def';
    learnNoun = le.nounDef ?? le.nounLemma;
  } else {
    sourceCat = 'def';
    learnNoun = le.nounLemma;
  }
  const nounTarget = matrixTranslationTarget(sourceCat, nativeCode);
  const nounSrcForm = le.nounBare;
  const verbSrcForm = le.verbWrong;
  return `[
  { "original": "${learnNoun}", "translation": "${nounTarget}", "level": "", "type": "noun", "source_cat": "${sourceCat}", "source_forms": ["${nounSrcForm}"] },
  { "original": "${le.verbInf}", "translation": "${ne.verbInf}", "level": "", "type": "verb", "source_cat": "bare", "source_forms": ["${verbSrcForm}"] },
  { "original": "${le.adjMFPair ?? le.adjSingle}", "translation": "${ne.adjMFPair ?? ne.adjSingle}", "level": "", "type": "adjective", "source_cat": "bare", "source_forms": ["${le.adjInflected ?? le.adjSingle}"] },
  { "original": "${le.phraseExample}", "translation": "${ne.phraseExample}", "level": "", "type": "phrase", "source_cat": "bare", "source_forms": ["${le.phraseExample}"] }
]`;
}

/**
 * Rule 42: translation article category follows the original's
 * grammatical definiteness, mapped onto the native language's own
 * article system. Three branches:
 *   - Definite original → native's definite form (bare if native
 *     has no articles, e.g. pl/cs).
 *   - Indefinite original (Scandi en/ett/ei per Rule 34) → native's
 *     indefinite form (bare if native has no articles).
 *   - Bare original (pl/cs per Rule 41 — no articles exist in those
 *     languages) → native's DEFAULT dictionary convention: definite
 *     for de/fr/es/it/pt/nl/en, indefinite en/ett/ei for Scandi, bare
 *     only for the article-less pair (cs↔pl).
 *
 * The bare-fallback in the third branch matches standard bilingual-
 * dictionary typography: a DE-PL dictionary shows `das Abitur — matura`
 * (article on the article-having side), and a PL-DE dictionary should
 * show `matura — das Abitur`, not `matura — Abitur`. An earlier
 * iteration had bare→bare on every native, which produced article-less
 * German and Romance translations that read as typos (`matura → Abitur`,
 * `pies → Hund`). See CLAUDE.md Rule 42.
 */
export function buildVocabSystemPrompt(
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: string,
  nativeLanguageCode: string,
  version: PromptVersion = defaultPromptVersion(),
): string {
  // CEFR classification is no longer the LLM's job — it is handled
  // deterministically by lib/classifier after extraction. The LLM only
  // needs to extract and format the words.
  if (version === 'v2') {
    const scandiRuleV2 = CRITICAL_NOUN_RULE_BY_LANG_V2[learningLanguageCode] ?? '';
    const verbHint = getLangExamples(learningLanguageCode).verbInf;
    return `You are a language teacher assistant. Extract all meaningful vocabulary from a given text.

${buildCriticalHeaderV2(learningLanguageCode)}

The learning language is ${learningLanguageName}; the native language is ${nativeLanguageName}.

Rules:
- Extract nouns, verbs, adjectives, and fixed expressions. Ignore function words, standalone articles, pronouns, proper nouns, abbreviations, and numbers.
- Proper nouns to ignore include: people's names, cities, countries, brand or product names, titles of works, sports clubs, and broadcaster names. Never include any of these in the output.
- Abbreviations and acronyms to ignore: any all-uppercase token of 2+ letters (e.g. "GNR", "DLRG", "EU"). Never include these in the output.
- Each distinct word may appear AT MOST ONCE in the output array. Never emit the same entry multiple times even if the source text contains it many times — use "source_forms" to record every occurrence. If the source text contains a noun with both definite and indefinite articles, use the article category of the FIRST occurrence for the "original" lemma; all other occurrences go into "source_forms".
- "original" field: the word in ${learningLanguageName}. "translation" field: the translation in ${nativeLanguageName}.
- "source_cat" field: one of "def" | "indef" | "bare" — the article category of the first occurrence (used to validate the translation target). For non-noun entries (verb/adjective/phrase) set source_cat="bare".
${buildNounShapeRule(learningLanguageCode)}
${scandiRuleV2}
${buildNounVerbRulesV2(learningLanguageCode)}
${buildAdjRule(learningLanguageCode)}
${buildTranslationRuleV2(learningLanguageCode, nativeLanguageCode)}
- List every exact word form from the source text (inflected forms, plurals, conjugations) in "source_forms".

"type" must be one of: "noun", "verb", "adjective", "phrase", "other".
Pick the type that matches each extracted word — DO NOT label every entry "noun". Verbs are infinitives (e.g. "${verbHint}"); phrases are multi-word fixed expressions.

Respond exclusively as a JSON array, no additional text. Leave "level" as "".
The example below is shape only — the actual types in your output depend on what is in the source text:
${buildJsonExampleV2(learningLanguageCode, nativeLanguageCode)}`;
  }
  // v1 path — unchanged baseline, byte-identical to pre-Slice-2.
  const scandiRule = CRITICAL_NOUN_RULE_BY_LANG[learningLanguageCode] ?? '';
  const verbHint = getLangExamples(learningLanguageCode).verbInf;
  return `You are a language teacher assistant. Extract all meaningful vocabulary from a given text.

${buildCriticalHeader(learningLanguageCode)}

The learning language is ${learningLanguageName}; the native language is ${nativeLanguageName}.

Rules:
- Extract nouns, verbs, adjectives, and fixed expressions. Ignore function words, standalone articles, pronouns, proper nouns, abbreviations, and numbers.
- Proper nouns to ignore include: people's names, cities, countries, brand or product names, titles of works, sports clubs, and broadcaster names. Never include any of these in the output.
- Abbreviations and acronyms to ignore: any all-uppercase token of 2+ letters (e.g. "GNR", "DLRG", "EU"). Never include these in the output.
- Each distinct word may appear AT MOST ONCE in the output array. Never emit the same entry multiple times even if the source text contains it many times — use "source_forms" to record every occurrence.
- "original" field: the word in ${learningLanguageName}. "translation" field: the translation in ${nativeLanguageName}.
${buildNounShapeRule(learningLanguageCode)}
${scandiRule}
${buildNounVerbRules(learningLanguageCode)}
${buildAdjRule(learningLanguageCode)}
${buildTranslationRule(learningLanguageCode, nativeLanguageCode)}
- List every exact word form from the source text (inflected forms, plurals, conjugations) in "source_forms".

"type" must be one of: "noun", "verb", "adjective", "phrase", "other".
Pick the type that matches each extracted word — DO NOT label every entry "noun". Verbs are infinitives (e.g. "${verbHint}"); phrases are multi-word fixed expressions.

Respond exclusively as a JSON array, no additional text. Leave "level" as "".
The example below is shape only — the actual types in your output depend on what is in the source text:
${buildJsonExample(learningLanguageCode, nativeLanguageCode)}`;
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
      nativeLanguageCode ?? 'en',
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

  // Slice 3/7: under v1 the LLM isn't asked for source_cat — strip any
  // incidental field so v1 callers get a clean shape. Under v2 keep it;
  // it's consumed by the sweep's Translation-Target Match Rate metric.
  if (defaultPromptVersion() === 'v1') {
    for (const vocab of allVocabs) {
      delete (vocab as { source_cat?: unknown }).source_cat;
    }
  }

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

// NB: extracted to a type alias so the translateSingleWord function signature
// stays a single line — the Rule-27/42 architecture-test regex non-greedily
// captures up to the first `\n}` and would otherwise stop at the type brace
// before reaching the function body.
export type TranslateSingleWordResult = {
  original: string;
  translation: string;
  level: string;
  type: string;
  source_cat?: 'def' | 'indef' | 'bare';
};

export async function translateSingleWord(
  word: string,
  fromLanguageName: string,
  toLanguageName: string,
  fromLanguageCode: SupportedLanguage,
  toLanguageCode?: string,
): Promise<TranslateSingleWordResult> {
  // CEFR level is determined locally after the translation comes back —
  // the LLM is only responsible for formatting + translation.
  const nativeCode = toLanguageCode ?? 'en';
  const version = defaultPromptVersion();
  // v1 path FIRST so the Rule-27/42 architecture tests (which regex-scan the
  // function body non-greedily up to the first `\n}`) see the v1 builder
  // names (`buildCriticalHeader(fromLanguageCode)`, etc.) verbatim.
  const scandiRule = CRITICAL_NOUN_RULE_BY_LANG[fromLanguageCode] ?? '';
  const systemPromptV1 = `You are a language teacher assistant. The user sends a word or phrase in ${fromLanguageName} — it may be inflected, conjugated, or in plural form. Your job: determine the dictionary base form, translate it into ${toLanguageName}, and identify its word type.

${buildCriticalHeader(fromLanguageCode)}

Formatting rules (apply to BOTH "original" and "translation" fields):
${buildNounShapeRule(fromLanguageCode)}
${scandiRule}
${buildNounVerbRules(fromLanguageCode)}
${buildAdjRule(fromLanguageCode)}
${buildTranslationRule(fromLanguageCode, nativeCode)}

Respond exclusively as a JSON object, with no additional text. Leave the level field as "" — it is set locally after translation:
{
  "original": "... (formatted base form in ${fromLanguageName})",
  "translation": "... (formatted translation in ${toLanguageName})",
  "level": "",
  "type": "noun|verb|adjective|phrase|other"
}`;
  const scandiRuleV2 = CRITICAL_NOUN_RULE_BY_LANG_V2[fromLanguageCode] ?? '';
  const systemPromptV2 = `You are a language teacher assistant. The user sends a word or phrase in ${fromLanguageName} — it may be inflected, conjugated, or in plural form. Your job: determine the dictionary base form, translate it into ${toLanguageName}, identify its word type, and record the article category of the input.

${buildCriticalHeaderV2(fromLanguageCode)}

Formatting rules (apply to BOTH "original" and "translation" fields):
${buildNounShapeRule(fromLanguageCode)}
${scandiRuleV2}
${buildNounVerbRulesV2(fromLanguageCode)}
${buildAdjRule(fromLanguageCode)}
${buildTranslationRuleV2(fromLanguageCode, nativeCode)}

Respond exclusively as a JSON object, with no additional text. Leave the level field as "" — it is set locally after translation:
{
  "original": "... (formatted base form in ${fromLanguageName})",
  "translation": "... (formatted translation in ${toLanguageName})",
  "level": "",
  "type": "noun|verb|adjective|phrase|other",
  "source_cat": "def|indef|bare"
}`;
  const systemPrompt = version === 'v2' ? systemPromptV2 : systemPromptV1;

  const result = await callClaude([{ role: 'user', content: word }], systemPrompt, 4096, {
    temperature: 0,
  });

  let parsed: {
    original: string;
    translation: string;
    level: string;
    type: string;
    source_cat?: 'def' | 'indef' | 'bare';
  } = {
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

  // Slice 3/7: under v1 the LLM isn't asked for source_cat — strip any
  // incidental field so v1 callers get a clean shape.
  if (version === 'v1') {
    delete parsed.source_cat;
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
