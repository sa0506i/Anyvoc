import type { SQLiteDatabase } from 'expo-sqlite';
import { extractVocabulary, translateText, detectLanguage, type SupportedLanguage } from './claude';
import {
  insertContent,
  insertVocabularyBatch,
  countContentsAddedToday,
  recordContentAdd,
  BASIC_MODE_DAILY_CONTENT_LIMIT,
  type Content,
  type Vocabulary,
} from './database';
import { applyBasicLimit } from './truncate';
import { getLanguageEnglishName } from '../constants/languages';
import { isAtOrAboveLevel } from '../constants/levels';
import { generateUUID } from './uuid';

export interface ShareProcessingSettings {
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  proMode?: boolean; // defaults to true (Pro) when omitted
}

export interface ShareProcessingResult {
  inserted: number;
  foundTotal: number;
  belowLevel: boolean;
  truncated: boolean;
  rejected?: 'daily-limit';
}

/**
 * Progress events emitted by processSharedText. The caller maps each
 * event to a concrete overlay-state transition (typically a rotation
 * for `llm-start` and a single message for `saving`). Kept as opaque
 * event codes rather than strings so the UI layer owns the copy —
 * see constants/progressMessages.ts.
 */
export type ShareProgressEvent = 'llm-start' | 'saving';

/**
 * Processes shared or manually added text: detects language, extracts
 * vocabulary, optionally translates the text (Pro only), and inserts both
 * content and vocab into the database. Progress strings are reported via
 * onProgress.
 *
 * proMode controls three gates:
 *   - daily-limit (Basic only): rejects immediately if 3+ contents added today
 *   - truncation: limits text to BASIC_MODE_CHAR_LIMIT (2000) in Basic mode
 *     and PRO_MODE_CHAR_LIMIT (5000) in Pro mode — see applyBasicLimit
 *   - skip translation (Basic only): translateText is not called in Basic mode
 *
 * Throws on errors (including ClaudeAPIError and language mismatch). The
 * caller is responsible for handling errors and showing alerts.
 */
export async function processSharedText(
  db: SQLiteDatabase,
  text: string,
  title: string,
  sourceType: Content['source_type'],
  sourceUrl: string | undefined,
  settings: ShareProcessingSettings,
  onProgress: (event: ShareProgressEvent) => void,
): Promise<ShareProcessingResult> {
  const isPro = settings.proMode ?? true;

  // 1) Daily-limit gate (Basic mode only). No API call on rejection.
  if (!isPro && countContentsAddedToday(db) >= BASIC_MODE_DAILY_CONTENT_LIMIT) {
    return {
      inserted: 0,
      foundTotal: 0,
      belowLevel: false,
      truncated: false,
      rejected: 'daily-limit',
    };
  }

  // 2) Truncation gate (Basic mode only).
  const { text: limitedText, truncated } = applyBasicLimit(text, isPro);

  const contentId = generateUUID();
  // Use English names for API prompts (Mistral needs unambiguous language names)
  const nativeName = getLanguageEnglishName(settings.nativeLanguage);
  const learningName = getLanguageEnglishName(settings.learningLanguage);

  // Language check is sub-millisecond (franc-min, offline); no overlay
  // transition for it — the user couldn't read it anyway.
  const detectedLang = await detectLanguage(limitedText);
  if (detectedLang !== null && detectedLang !== settings.learningLanguage) {
    if (sourceType === 'image') {
      throw new Error('No usable text could be found in this image. Please try a clearer image.');
    }
    const detectedName = getLanguageEnglishName(detectedLang);
    throw new Error(
      `The content appears to be in ${detectedName}, but your learning language is set to ${learningName}. Please add content in your learning language.`,
    );
  }

  onProgress('llm-start');
  const [vocabs, translation] = await Promise.all([
    extractVocabulary(
      limitedText,
      nativeName,
      learningName,
      settings.learningLanguage as SupportedLanguage,
      settings.nativeLanguage,
    ),
    isPro
      ? translateText(limitedText, learningName, nativeName)
      : Promise.resolve<string | null>(null),
  ]);

  onProgress('saving');

  const now = Date.now();
  insertContent(db, {
    id: contentId,
    title: title || limitedText.substring(0, 50).trim() + (limitedText.length > 50 ? '...' : ''),
    original_text: limitedText,
    translated_text: translation,
    source_type: sourceType,
    source_url: sourceUrl ?? null,
    created_at: now,
  });
  recordContentAdd(db);

  const filteredVocabs = vocabs.filter((v) => isAtOrAboveLevel(v.level, settings.level));

  const vocabEntries: Vocabulary[] = filteredVocabs.map((v) => ({
    id: generateUUID(),
    content_id: contentId,
    original: v.original,
    translation: v.translation,
    level: v.level,
    word_type: v.type,
    source_forms: v.source_forms?.length ? JSON.stringify(v.source_forms) : null,
    leitner_box: 1,
    last_reviewed: null,
    correct_count: 0,
    incorrect_count: 0,
    created_at: now,
    user_added: 0,
  }));

  const actuallyInserted = insertVocabularyBatch(db, vocabEntries);

  return {
    inserted: actuallyInserted,
    foundTotal: vocabs.length,
    belowLevel: vocabs.length > 0 && vocabEntries.length === 0,
    truncated,
  };
}
