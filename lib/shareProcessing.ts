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
 * Processes shared or manually added text: detects language, extracts
 * vocabulary, optionally translates the text (Pro only), and inserts both
 * content and vocab into the database. Progress strings are reported via
 * onProgress.
 *
 * proMode controls three Basic-mode gates:
 *   - daily-limit: rejects immediately if 3+ contents added today
 *   - truncation: limits text to BASIC_MODE_CHAR_LIMIT chars
 *   - skip translation: translateText is not called in Basic mode
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
  onProgress: (message: string) => void,
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

  onProgress('Checking language...');
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

  onProgress('Extracting vocabulary...');
  const vocabs = await extractVocabulary(
    limitedText,
    nativeName,
    learningName,
    settings.learningLanguage as SupportedLanguage,
  );

  // 3) Full-text translation is a Pro feature.
  let translation: string | null = null;
  if (isPro) {
    onProgress('Translating text...');
    translation = await translateText(limitedText, learningName, nativeName);
  }

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
  }));

  const actuallyInserted = insertVocabularyBatch(db, vocabEntries);

  return {
    inserted: actuallyInserted,
    foundTotal: vocabs.length,
    belowLevel: vocabs.length > 0 && vocabEntries.length === 0,
    truncated,
  };
}
