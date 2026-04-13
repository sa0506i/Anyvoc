/**
 * lib/classifier — local CEFR classifier with Claude API fallback.
 *
 * RUNTIME-ONLY MODULE. Hard rule: nothing under lib/classifier may import
 * axios, tar, node:fs, node:path, node:https, better-sqlite3, or any other
 * Node-only API. Build-time data prep lives exclusively in scripts/.
 *
 * Public API:
 *   classifyWord(word, language): Promise<CEFRLevel>
 *   classifyWordWithConfidence(word, language): Promise<{ level, confidence, difficulty, usedApiCallback }>
 *
 * Both accept BCP-47 codes from the SUPPORTED_LANGUAGES set below.
 */

import { CEFR_LEVELS, type CEFRLevel } from '../../constants/levels';
import { getLanguageEnglishName } from '../../constants/languages';
import { extractFeatures } from './features';
import { applyCognateAdjustment } from './cognates';
import { difficultyToCefr, scoreDifficulty } from './score';
import {
  computeConfidence,
  classifyViaClaude,
  type Confidence,
  type ClaudeFallbackFn,
} from './fallback';
import { getCached, setCached } from './cache';

export const SUPPORTED_LANGUAGES = [
  'en',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'sv',
  'no',
  'da',
  'pl',
  'cs',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function assertSupported(language: string): asserts language is SupportedLanguage {
  if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(language)) {
    throw new Error(
      `Unsupported language code "${language}". ` +
        `Supported codes: ${SUPPORTED_LANGUAGES.join(', ')}`,
    );
  }
}

interface LocalClassification {
  level: CEFRLevel;
  difficulty: number;
  confidence: Confidence;
}

function classifyLocally(word: string, language: SupportedLanguage): LocalClassification {
  const features = extractFeatures(word, language);
  const baseDifficulty = scoreDifficulty(features);
  const adjusted = applyCognateAdjustment(word, language, baseDifficulty);
  return {
    level: difficultyToCefr(adjusted),
    difficulty: adjusted,
    confidence: computeConfidence(features),
  };
}

/**
 * Returns a CEFR label for a word in a supported language. High/medium
 * confidence words resolve synchronously (the Promise wraps the result
 * with no await on a network call). Low confidence words go through the
 * cache → Claude → cache path.
 */
export async function classifyWord(
  word: string,
  language: string,
  claudeFn?: ClaudeFallbackFn,
): Promise<CEFRLevel> {
  assertSupported(language);
  const local = classifyLocally(word, language);
  if (local.confidence !== 'low' || !claudeFn) {
    return local.level;
  }

  const cached = getCached(word, language);
  if (cached) return cached;

  const apiResult = await classifyViaClaude(
    word,
    language,
    getLanguageEnglishName(language),
    claudeFn,
  );
  if (apiResult) {
    setCached(word, language, apiResult);
    return apiResult;
  }
  return local.level;
}

/**
 * Same as classifyWord but exposes the difficulty score, confidence bucket,
 * and whether the Claude fallback actually fired.
 */
export async function classifyWordWithConfidence(
  word: string,
  language: string,
  claudeFn?: ClaudeFallbackFn,
): Promise<{
  level: CEFRLevel;
  confidence: Confidence;
  difficulty: number;
  usedApiCallback: boolean;
}> {
  assertSupported(language);
  const local = classifyLocally(word, language);
  if (local.confidence !== 'low' || !claudeFn) {
    return {
      level: local.level,
      confidence: local.confidence,
      difficulty: local.difficulty,
      usedApiCallback: false,
    };
  }

  const cached = getCached(word, language);
  if (cached) {
    return {
      level: cached,
      confidence: 'low',
      difficulty: local.difficulty,
      usedApiCallback: false,
    };
  }

  const apiResult = await classifyViaClaude(
    word,
    language,
    getLanguageEnglishName(language),
    claudeFn,
  );
  if (apiResult) {
    setCached(word, language, apiResult);
    return {
      level: apiResult,
      confidence: 'low',
      difficulty: local.difficulty,
      usedApiCallback: true,
    };
  }
  return {
    level: local.level,
    confidence: 'low',
    difficulty: local.difficulty,
    usedApiCallback: false,
  };
}

export { CEFR_LEVELS };
