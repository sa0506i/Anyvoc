/**
 * HTTP transport + retry for the Claude-API-shaped Fly backend proxy.
 *
 * The proxy at `https://anyvoc-backend.fly.dev/api/chat` accepts
 * Claude Messages API format and transforms to Mistral format upstream.
 * No API key ships with the client — the secret lives only on the Fly
 * machine (see CLAUDE.md "Security" + backend/server.js).
 *
 * Phase 2 Slice 1 extracted this from the monolithic lib/claude.ts.
 * Behaviour is byte-identical to the pre-refactor version.
 */
import Constants from 'expo-constants';
import type { CallClaudeOptions, ClaudeMessage, ClaudeResponse } from './types';

// Read the backend URL from app.json.extra so it lives in one place
// (config). Fallback to the Fly.dev URL so unit tests and anything
// that imports this module outside the Expo runtime still work.
const DEFAULT_API_URL = 'https://anyvoc-backend.fly.dev/api/chat';
const API_URL =
  (Constants?.expoConfig?.extra as { backendApiUrl?: string } | undefined)?.backendApiUrl ??
  DEFAULT_API_URL;
const MODEL = 'mistral-small-2506';

export class ClaudeAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'ClaudeAPIError';
  }
}

// Retry policy for transient upstream failures (5xx, 429, generic network
// errors). Other 4xx status codes and AbortError (timeout) are NOT retried —
// they're caller/config problems or user-visible timeouts. Backoff is
// jittered exponentially. 429 uses a doubled backoff base so retries step
// out of the rate-limit window rather than colliding with the same edge.
// Zeroed in tests so the existing suite stays fast without fake timers.
const MAX_RETRIES = 2; // 3 total attempts
const RETRY_BASE_MS = process.env.NODE_ENV === 'test' ? 0 : 400;

function isRetryable(err: unknown): boolean {
  if (err instanceof ClaudeAPIError) {
    if (err.statusCode === undefined) return false;
    // 5xx = transient upstream failure. 429 = rate limit — retry with a
    // longer delay so we land outside the proxy's 60s window. Parallel
    // chunk extraction (Pro Mode) relies on this: without 429 retry a
    // single bursted-too-fast request would abort the whole Promise.all.
    return err.statusCode >= 500 || err.statusCode === 429;
  }
  // Non-ClaudeAPIError errors reach us only as network failures —
  // AbortError is wrapped into a ClaudeAPIError above, so anything
  // else is a transient fetch/DNS/TLS hiccup worth retrying.
  return err instanceof Error;
}

function retryDelayMs(attempt: number, err: unknown): number {
  if (RETRY_BASE_MS === 0) return 0;
  // 429 → double the base so we retry at 0.8s / 1.6s / 3.2s instead of
  // 0.4s / 0.8s / 1.6s. The proxy's rate-limit window is 60s and most
  // spikes are short; a longer delay materially improves success odds.
  const is429 = err instanceof ClaudeAPIError && err.statusCode === 429;
  const factor = is429 ? 2 : 1;
  const base = RETRY_BASE_MS * factor * Math.pow(2, attempt);
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
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, err)));
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
  // 240s client-side abort cap. Was 120s pre-2026-04-23 but the
  // Phase-2 parity sweep hit the 120s cliff 9× out of 132 combos
  // on a slow-Mistral day (all failures elapsed at exactly 120.000 ms,
  // and 50+ successful combos took over 60s). 240s gives generous
  // headroom for Mistral peak-load windows + Fly cold-start latency
  // without making a genuinely-stuck request wait obscenely long.
  // If p99 sweeps start exceeding this, there's a real backend
  // problem worth investigating — don't blindly bump further.
  const timeoutId = setTimeout(() => controller.abort(), 240_000);

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
