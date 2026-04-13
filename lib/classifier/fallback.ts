/**
 * fallback.ts — confidence gauge + Claude-API fallback for hard cases.
 *
 * The local classifier handles 99% of words. For the remaining tail
 * (words missing from the frequency table on top of any other fallback),
 * we ask Claude — once, then cache forever (or 30 days).
 *
 * Rate limited to 10 calls per rolling 60-second window. If we hit the
 * limit we return the local label and warn — never block, never throw.
 */

import type { CEFRLevel } from '../../constants/levels';
import { isValidCefr } from './score';
import type { Features } from './features';
import type { SupportedLanguage } from './index';

/** Callback type matching callClaude's signature (messages, system, maxTokens, options). */
export type ClaudeFallbackFn = (
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string,
  maxTokens: number,
  options?: { temperature?: number },
) => Promise<string>;

export type Confidence = 'high' | 'medium' | 'low';

// callClaude already pins the model to claude-haiku-4-5-20251001 internally;
// we don't need to override it here.
const SYSTEM_PROMPT =
  'You are a CEFR vocabulary classifier. Respond with exactly one label: A1, A2, B1, B2, C1, or C2. Nothing else.';

export function computeConfidence(features: Features): Confidence {
  // After dropping concreteness the feature vector has just two slots
  // (zipf, aoa). High = both real. Medium = one fallback. Low = both
  // fallbacks AND we have no Zipf signal (i.e. zipf === 0). The "both
  // fallbacks but zipf > 0" case can't occur today because aoaNorm
  // only falls back when its language map lacks the word, which is
  // independent of Zipf — but the implementation is conservative and
  // only escalates to a Claude call when the Zipf lookup itself failed.
  if (features.fallbackCount === 0) return 'high';
  if (features.fallbackCount === 1) return 'medium';
  if (features.fallbackCount >= 2 && features.zipf === 0) return 'low';
  return 'medium';
}

// --- Sliding-window rate limit (10 calls / 60s) ---
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const callTimestamps: number[] = [];

function tryConsumeRateBudget(): boolean {
  const now = Date.now();
  // Drop timestamps outside the window.
  while (callTimestamps.length > 0 && now - callTimestamps[0] > RATE_WINDOW_MS) {
    callTimestamps.shift();
  }
  if (callTimestamps.length >= RATE_LIMIT) return false;
  callTimestamps.push(now);
  return true;
}

/** Test helper: clear the rate-limit window. */
export function __resetRateLimitForTests(): void {
  callTimestamps.length = 0;
}

/**
 * Asks Claude to classify a word. Returns null on any failure (parse error,
 * rate-limit hit, network error, invalid label) so the caller can fall back
 * to the local label.
 */
export async function classifyViaClaude(
  word: string,
  language: SupportedLanguage,
  languageName: string,
  claudeFn: ClaudeFallbackFn,
): Promise<CEFRLevel | null> {
  if (!tryConsumeRateBudget()) {
    console.warn(
      `[classifier] rate limit reached (${RATE_LIMIT}/min) — using local label for "${word}" (${language})`,
    );
    return null;
  }

  let response: string;
  try {
    response = await claudeFn(
      [
        {
          role: 'user',
          content: `What is the CEFR level of the word '${word}' in ${languageName}?`,
        },
      ],
      SYSTEM_PROMPT,
      10,
      { temperature: 0 },
    );
  } catch (err) {
    console.warn(
      `[classifier] Claude fallback call failed for "${word}" (${language}):`,
      (err as Error).message,
    );
    return null;
  }

  if (typeof response !== 'string' || response.length === 0) {
    return null;
  }
  const match = response.match(/\b(A1|A2|B1|B2|C1|C2)\b/);
  if (!match || !isValidCefr(match[1])) {
    console.warn(
      `[classifier] invalid Claude fallback response for "${word}" (${language}): ${response}`,
    );
    return null;
  }
  return match[1];
}
