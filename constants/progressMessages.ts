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

/**
 * OCR-phase message pools. Matches the LLM pool shape so the overlay
 * behavior (random pick per phase, no-repeat until exhausted,
 * stay-on-last) is consistent across the two long-running operations
 * the user watches. Cadence is the same `ROTATION_INTERVAL_MS` (4 s).
 *
 * OCR typically finishes in Phase 1 (~500 ms–2 s on-device ML Kit);
 * Phase 2 only appears for large/dense images and picks up the
 * flattering-thoroughness tone from LLM phases 7+.
 */
export const OCR_PHASES = [
  // Phase 1 — 0–4 s — Reading the image
  [
    'Reading text from the image…',
    'Looking at your page…',
    'Scanning the picture…',
    'The AI is reading your image…',
    'Picking the words off the image…',
    'Running OCR on your picture…',
    'Making out the text…',
    'Eyes on your image…',
  ],
  // Phase 2 — 4 s+ — Big image (dense / high-resolution)
  [
    'Dense image — taking the time it needs…',
    'Lots of text on this one…',
    'Working through a large page…',
    'This is a substantial image…',
    'Tracing every character carefully…',
    'Rich image — still reading…',
  ],
] as const;

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
 *
 * Two variants exist for Phase 4: Pro mode runs `translateText`
 * parallel to extraction (`Promise.all` in lib/shareProcessing.ts),
 * Basic mode does not. Showing translation messages to Basic users
 * would be a UX lie, so the only delta between the two arrays is the
 * Phase-4 pool. Callers pick via `proMode ? LLM_PHASES_PRO : LLM_PHASES_BASIC`.
 * Phases 1–3 and 5–13 are shared verbatim via the `PHASE_N` consts.
 */

const PHASE_1_OPENING = [
  'Sending your text to the AI…',
  'Handing your text over to the AI…',
  'The AI is opening your text…',
  'Getting your text settled in…',
  "Your text has arrived at the AI's desk…",
  'Unpacking your text…',
  'The AI is taking a first look…',
  'Your text is in good hands…',
] as const;

const PHASE_2_READING = [
  'Reading every word…',
  'Taking in your text carefully…',
  'The AI is reading, slowly and carefully…',
  'Soaking up every sentence…',
  'Moving through line by line…',
  'Paying attention to the details…',
  'Reading with a highlighter in hand…',
  'Catching every nuance…',
] as const;

const PHASE_3_EXTRACTION = [
  'Extracting vocabulary…',
  'Pulling out the interesting words…',
  'Spotting the words worth keeping…',
  'Picking out vocabulary…',
  'Collecting the good stuff…',
  'Building your word list…',
  'Gathering words of interest…',
  'Marking the keepers…',
] as const;

const PHASE_4_PRO_PARALLEL_TRANSLATION = [
  'Running the translation in parallel…',
  'Translation desk working alongside…',
  'Translating in the background…',
  'Parallel translation underway…',
  'Translator is on it…',
  'Translation running in another window…',
  'Working on the translation at the same time…',
  'Side-by-side translation in progress…',
] as const;

// Basic mode skips translateText, so Phase 4 stays on extraction —
// a second pass, subtler terms, cross-checking. No translation refs.
const PHASE_4_BASIC_DEEP_EXTRACTION = [
  'Still working through the text…',
  'Making sure nothing slips through…',
  'Doing a second sweep…',
  'Going over the finer details…',
  'Catching the subtler terms…',
  'Cross-checking the extraction…',
  'Following up on tricky words…',
  'Pausing on the unusual bits…',
] as const;
const PHASE_5_APPRECIATION = [
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
] as const;

const PHASE_6_FILTERING = [
  'Setting aside abbreviations and names…',
  'Filtering out the proper nouns…',
  'Skipping the obvious stuff…',
  'Moving abbreviations to the side…',
  'Trimming out names and initials…',
  'Keeping only the words worth learning…',
  'Clearing the noise…',
  'Parking the acronyms…',
] as const;

const PHASE_7_DEEPER_WORK = [
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
] as const;

const PHASE_8_HUNTING = [
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
] as const;

const PHASE_9_CROSS_REF = [
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
] as const;

const PHASE_10_EARNING = [
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
] as const;

const PHASE_11_FINALIZING = [
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
] as const;

const PHASE_12_ORGANIZING = [
  'Organizing by difficulty…',
  'Sorting everything into order…',
  'Arranging your word list…',
  'Putting it all in sequence…',
  'Alphabetizing the keepers…',
  'Structuring the output…',
  'Laying everything out nicely…',
  'Giving it a sensible order…',
] as const;

const PHASE_13_HANDOFF = [
  'Almost in your hands…',
  'Just about to hand it over…',
  'Wrapping it up now…',
  'Coming your way…',
  'Delivery imminent…',
  'Any second now…',
  'Bringing it to you…',
  'Last breath before handoff…',
] as const;

export const LLM_PHASES_PRO = [
  PHASE_1_OPENING,
  PHASE_2_READING,
  PHASE_3_EXTRACTION,
  PHASE_4_PRO_PARALLEL_TRANSLATION,
  PHASE_5_APPRECIATION,
  PHASE_6_FILTERING,
  PHASE_7_DEEPER_WORK,
  PHASE_8_HUNTING,
  PHASE_9_CROSS_REF,
  PHASE_10_EARNING,
  PHASE_11_FINALIZING,
  PHASE_12_ORGANIZING,
  PHASE_13_HANDOFF,
] as const;

export const LLM_PHASES_BASIC = [
  PHASE_1_OPENING,
  PHASE_2_READING,
  PHASE_3_EXTRACTION,
  PHASE_4_BASIC_DEEP_EXTRACTION,
  PHASE_5_APPRECIATION,
  PHASE_6_FILTERING,
  PHASE_7_DEEPER_WORK,
  PHASE_8_HUNTING,
  PHASE_9_CROSS_REF,
  PHASE_10_EARNING,
  PHASE_11_FINALIZING,
  PHASE_12_ORGANIZING,
  PHASE_13_HANDOFF,
] as const;

export const SAVING = 'Scoring difficulty (A1–C2) and saving…';
