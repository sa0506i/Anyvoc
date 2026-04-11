import type { SQLiteDatabase } from 'expo-sqlite';
import {
  extractVocabulary,
  translateText,
  detectLanguage,
  type SupportedLanguage,
} from './claude';
import {
  insertContent,
  insertVocabularyBatch,
  type Content,
  type Vocabulary,
} from './database';
import { getLanguageName } from '../constants/languages';
import { isAtOrAboveLevel } from '../constants/levels';
import { generateUUID } from './uuid';

export interface ShareProcessingSettings {
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
}

export interface ShareProcessingResult {
  inserted: number;
  foundTotal: number;
  belowLevel: boolean;
}

/**
 * Processes shared or manually added text: detects language, extracts
 * vocabulary, translates the text, and inserts both content and vocab into
 * the database. Progress strings are reported via onProgress.
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
  const contentId = generateUUID();
  const nativeName = getLanguageName(settings.nativeLanguage);
  const learningName = getLanguageName(settings.learningLanguage);

  onProgress('Checking language...');
  const detectedLang = await detectLanguage(text);
  if (detectedLang !== null && detectedLang !== settings.learningLanguage) {
    if (sourceType === 'image') {
      throw new Error('No usable text could be found in this image. Please try a clearer image.');
    }
    const detectedName = getLanguageName(detectedLang);
    throw new Error(
      `The content appears to be in ${detectedName}, but your learning language is set to ${learningName}. Please add content in your learning language.`
    );
  }

  onProgress('Extracting vocabulary...');
  const vocabs = await extractVocabulary(
    text,
    nativeName,
    learningName,
    settings.learningLanguage as SupportedLanguage
  );

  onProgress('Translating text...');
  const translation = await translateText(text, learningName, nativeName);

  const now = Date.now();
  insertContent(db, {
    id: contentId,
    title: title || text.substring(0, 50).trim() + (text.length > 50 ? '...' : ''),
    original_text: text,
    translated_text: translation,
    source_type: sourceType,
    source_url: sourceUrl ?? null,
    created_at: now,
  });

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

  insertVocabularyBatch(db, vocabEntries);

  return {
    inserted: vocabEntries.length,
    foundTotal: vocabs.length,
    belowLevel: vocabs.length > 0 && vocabEntries.length === 0,
  };
}
