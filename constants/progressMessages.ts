/**
 * Centralised progress-overlay messages for the four content-input
 * pipelines (system share, manual link, manual image, manual text).
 *
 * All three input types share the same LLM + save phase, so the
 * downstream messages (`LLM_ROTATION`, `SAVING`) are reused verbatim
 * across flows. The per-input lead-in constants encode the only
 * parts that actually differ.
 *
 * Rotation cadence is `ROTATION_INTERVAL_MS` (4 s) — comfortably
 * below the product requirement that no message sits on screen for
 * more than 5 s. The LLM rotation stops on its last entry; if the
 * LLM hangs beyond the full rotation length, the final message stays
 * until `Promise.all` resolves.
 *
 * Architecture Rule 32 forbids string-literal messages in the share
 * pipeline — all callers must import from this file.
 */

export const ROTATION_INTERVAL_MS = 4000;

export const INTRO = {
  link: 'Got your link — standby…',
  image: 'Got your image — standby…',
  text: 'Got your text — standby…',
} as const;

export const FETCH = {
  fast: 'Downloading the article…',
  slow: 'Still downloading (slower server)…',
  verySlow: 'The server really wants us to wait…',
} as const;

export const FETCH_ROTATION = [FETCH.fast, FETCH.slow, FETCH.verySlow] as const;

export const OCR = {
  fast: 'Reading text from the image…',
  slow: 'Still reading (big image)…',
} as const;

export const OCR_ROTATION = [OCR.fast, OCR.slow] as const;

export const LLM_ROTATION = [
  'Sending your text to the AI…',
  'The AI is reading every word…',
  'Extracting vocabulary…',
  'Translating the full text in parallel…',
  'Still extracting — looks like a juicy one…',
  'Filtering out abbreviations and names…',
  'Almost there — thanks for your patience…',
  'Just a moment more…',
] as const;

export const SAVING = 'Scoring difficulty (A1–C2) and saving…';
