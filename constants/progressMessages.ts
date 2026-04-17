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

/**
 * LLM-phase message pools. Each inner array is a "phase" tied to an
 * elapsed-time window; at each 4 s tick the overlay picks one random
 * unused message from the next phase's pool. Once the final phase is
 * reached the rotation stays there — never loops back to earlier
 * phases — and picks a fresh random entry from the phase-13 pool on
 * every further tick (allowing repeats only after the pool is
 * exhausted).
 *
 * Tone rules baked into the pools:
 * - No apologies, no "please wait", no "thanks for your patience".
 * - No meta-commentary about the wait being long.
 * - From phase 7 onwards, messages flatter the user's text or frame
 *   the delay as thoroughness — never as a problem.
 */
export const LLM_PHASES = [
  // Phase 1 — 0–4 s — Opening
  [
    'Sending your text to the AI…',
    'Handing your text over to the AI…',
    'The AI is opening your text…',
    'Getting your text settled in…',
    "Your text has arrived at the AI's desk…",
    'Unpacking your text…',
    'The AI is taking a first look…',
    'Your text is in good hands…',
  ],
  // Phase 2 — 4–8 s — Reading
  [
    'Reading every word…',
    'Taking in your text carefully…',
    'The AI is reading, slowly and carefully…',
    'Soaking up every sentence…',
    'Moving through line by line…',
    'Paying attention to the details…',
    'Reading with a highlighter in hand…',
    'Catching every nuance…',
  ],
  // Phase 3 — 8–12 s — Vocabulary Extraction
  [
    'Extracting vocabulary…',
    'Pulling out the interesting words…',
    'Spotting the words worth keeping…',
    'Picking out vocabulary…',
    'Collecting the good stuff…',
    'Building your word list…',
    'Gathering words of interest…',
    'Marking the keepers…',
  ],
  // Phase 4 — 12–16 s — Parallel Translation
  [
    'Running the translation in parallel…',
    'Translation desk working alongside…',
    'Translating in the background…',
    'Parallel translation underway…',
    'Translator is on it…',
    'Translation running in another window…',
    'Working on the translation at the same time…',
    'Side-by-side translation in progress…',
  ],
  // Phase 5 — 16–20 s — Appreciation
  [
    'Interesting text — flagging a few gems…',
    'Your text has good bones…',
    'Noticing some nice word choices…',
    "Ooh, that's a lovely sentence…",
    "There's some texture here…",
    'Your text has range…',
    'Some well-crafted passages in here…',
    'Spotting a few standout words…',
    "This one's got character…",
    "Your writer's ear is showing…",
  ],
  // Phase 6 — 20–24 s — Filtering
  [
    'Setting aside abbreviations and names…',
    'Filtering out the proper nouns…',
    'Skipping the obvious stuff…',
    'Moving abbreviations to the side…',
    'Trimming out names and initials…',
    'Keeping only the words worth learning…',
    'Clearing the noise…',
    'Parking the acronyms…',
  ],
  // Phase 7 — 24–28 s — Deeper Work (flattery begins)
  [
    'Your text has an impressive vocabulary range…',
    'Your text is richer than average — giving it more time…',
    "There's more here than meets the eye…",
    'Your vocabulary is doing interesting things…',
    'The AI is genuinely enjoying this one…',
    'Your text is earning its stripes…',
    'Noticing some unusual word choices — worth a closer look…',
    'Your text rewards careful reading…',
    'This is a dense one, in the best way…',
    'Your writing has layers — peeling them…',
  ],
  // Phase 8 — 28–32 s — Hunting the Rare
  [
    'Hunting down the rarer words…',
    'Tracking a particularly elusive verb…',
    'Chasing down a compound noun…',
    'Flushing out the uncommon ones…',
    'Fishing out some rare specimens…',
    'Digging through the deeper vocabulary…',
    'Following a word down a rabbit hole…',
    'The AI is underlining the good stuff…',
    'Circling the unusual words…',
    'Finding the hidden gems…',
  ],
  // Phase 9 — 32–36 s — Cross-Referencing
  [
    'Cross-referencing a few idioms…',
    'Double-checking some expressions…',
    'Consulting the reference shelf…',
    'Looking up a tricky phrase…',
    'Verifying a few definitions…',
    'Comparing similar words…',
    'Sorting out the synonyms…',
    'Checking context clues…',
    'Weighing a few candidates…',
    'Settling on the right translation…',
  ],
  // Phase 10 — 36–40 s — Earning Its Time
  [
    "This one's earning its processing time…",
    'Your text is worth the extra seconds…',
    'Taking the time this deserves…',
    'Quality takes a moment…',
    'Good texts get the full treatment…',
    'Not rushing this one…',
    'Giving it the attention it deserves…',
    "This isn't a text to skim…",
    'Slow cooking, not fast food…',
    'The AI refuses to cut corners…',
  ],
  // Phase 11 — 40–44 s — Finalizing
  [
    'Finalizing the word list…',
    'Polishing the entries…',
    'Smoothing out the list…',
    'Doing one more pass…',
    'Tightening up the selection…',
    'Trimming the final list…',
    'Refining the word choices…',
    'Cleaning up the edges…',
    'Putting the finishing touches on…',
    'Locking in the vocabulary…',
  ],
  // Phase 12 — 44–48 s — Organizing
  [
    'Organizing by difficulty…',
    'Sorting everything into order…',
    'Arranging your word list…',
    'Putting it all in sequence…',
    'Alphabetizing the keepers…',
    'Structuring the output…',
    'Laying everything out nicely…',
    'Giving it a sensible order…',
  ],
  // Phase 13 — 48 s+ — Handoff (repeatable if processing runs long)
  [
    'Almost in your hands…',
    'Just about to hand it over…',
    'Wrapping it up now…',
    'Coming your way…',
    'Delivery imminent…',
    'Any second now…',
    'Bringing it to you…',
    'Last breath before handoff…',
  ],
] as const;

export const SAVING = 'Scoring difficulty (A1–C2) and saving…';
