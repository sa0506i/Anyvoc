# Basic / Pro Mode — Design

**Date:** 2026-04-14
**Status:** Approved for implementation

## Goal

Introduce two app modes: **Basic** (default) and **Pro**, toggleable from Settings.

**Basic mode restrictions (all enforced *before* any API call):**

1. **Content length ≤ 1000 characters** — truncated at the last complete sentence
   boundary, falling back to a word boundary if no sentence end exists within the
   limit. Applied to all four add paths: text, image OCR, URL/link, share intent.
2. **Max 3 content additions per calendar day** (local time).
3. **No full-text translation** — vocabulary extraction still runs; the translation
   API call is skipped.

**Pro mode:** All of the above limits are removed — current behavior unchanged.

The mode affects only the *input side* (adding content). Existing vocabulary,
training, and all other features are identical in both modes.

## Non-Goals

- No payment, license, or account system. Pro is a pure UI toggle — anyone can flip
  it. This is a scaffolding step; monetization is out of scope.
- No retroactive effect on existing content already in the DB. Previously translated
  content keeps its translation even if the user switches to Basic.
- The 3-per-day counter is not persisted across device wipes; it is derived from
  `contents.created_at` and therefore resets if the app is reset.

## Data Model

New entry in the `settings` table (no schema change — it's a key/value store):

| Key       | Value                | Default   |
|-----------|----------------------|-----------|
| `proMode` | `"true"` / `"false"` | `"false"` |

No new tables. The daily-addition count is derived from existing `contents.created_at`
(stored as Unix ms, `INTEGER`).

## Components

### 1. `lib/truncate.ts` (new)

```ts
export const BASIC_MODE_CHAR_LIMIT = 1000;

/**
 * Truncates text to roughly maxChars, preferring a sentence boundary.
 * Fallback order:
 *   1) Last sentence-ending punctuation (. ! ? …) at or before maxChars
 *      (optionally followed by closing quote / bracket).
 *   2) If none: the end of the word that straddles maxChars (i.e. the next
 *      whitespace AFTER maxChars). The full word is kept — the result may
 *      be slightly longer than maxChars by at most one word length.
 *   3) If no whitespace exists after maxChars either (pathological, single
 *      long token): the original text is returned unchanged
 *      (single-word input cannot be meaningfully sentence-truncated).
 * Always trims trailing whitespace from the result.
 */
export function truncateAtSentence(
  text: string,
  maxChars: number = BASIC_MODE_CHAR_LIMIT,
): { text: string; truncated: boolean };

/**
 * Convenience wrapper: bypass truncation in Pro mode.
 */
export function applyBasicLimit(
  text: string,
  proMode: boolean,
): { text: string; truncated: boolean };
```

**Algorithm for `truncateAtSentence`:**

1. If `text.length <= maxChars` → return `{ text, truncated: false }`.
2. Look for the **last** sentence-ending punctuation in `text.slice(0, maxChars)`,
   allowing an optional trailing closing quote/bracket (`"`, `'`, `»`, `)`, `]`).
   If found at index `p`, return `text.slice(0, p + 1).trimEnd()`.
3. Else: find the first whitespace at index `w >= maxChars` in the full `text`.
   If found, return `text.slice(0, w).trimEnd()`.
4. Else (single long token ≥ maxChars with no following whitespace): return the
   original `text` unchanged but still flag `truncated: true` if `text.length >
   maxChars` — *note:* callers should treat this edge case as “effectively not
   truncated” (nothing sensible to cut). Acceptable because realistic inputs are
   prose, not single 1000+ char tokens.

**Tests (`lib/truncate.test.ts`):**

- Empty string → `""`, `truncated: false`.
- Text shorter than limit → unchanged.
- Text exactly at limit → unchanged.
- Text > limit with sentence end in first 1000 chars → cut at sentence end.
- Text > limit with no sentence end but word boundary past 1000 → cut at word end
  (length may be 1001–1050 typical).
- Sentence end followed by closing quote (`He said "Hi." And then...`) → cut after `"`.
- German / European punctuation (`!`, `?`, `…`) respected.
- Pathological single-token input (1200-char single word) → returned unchanged.
- `applyBasicLimit` in Pro mode bypasses truncation (`truncated: false` even when
  length > 1000).

### 2. `lib/database.ts` (new helper)

```ts
/** Counts contents added on the local calendar day of `now`. */
export function countContentsAddedToday(
  db: SQLiteDatabase,
  now: Date = new Date(),
): number;
```

Implementation: compute `todayStart = new Date(now.getFullYear(),
now.getMonth(), now.getDate()).getTime()` and run
`SELECT COUNT(*) as count FROM contents WHERE created_at >= ?`.

Also exposed as a constant:

```ts
export const BASIC_MODE_DAILY_CONTENT_LIMIT = 3;
```

### 3. `hooks/useSettings.ts` (extended)

- Add `proMode: boolean` to `SettingsState` (default `false`).
- In `loadSettings`: `proMode: settings['proMode'] === 'true'`.
- In `resetApp`: reset `proMode: false` and persist `'false'`.
- `updateSetting` for `proMode`: the store converts the string value to boolean
  before `set({ proMode: ... })` (other keys keep their existing string pass-through).

### 4. `components/ConfirmDialog.tsx` (extended)

- Make `cancelLabel` optional. When omitted, render only the confirm button
  (full width). `onCancel` still fires on dismissal (back gesture / outside tap).
- Existing call sites (all passing `cancelLabel`) continue to work unchanged.

### 5. `app/settings.tsx` (new section)

New section **at the top**, before "Languages":

```
Mode
Basic limits content to 1000 characters, 3 additions per day,
and no full-text translation. Pro removes all limits.

[ Pro Mode                                    (● Switch) ]
```

- Native RN `Switch`, `onValueChange` calls
  `updateSetting('proMode', on ? 'true' : 'false')`.
- `trackColor.true = colors.primary`, themed via `useTheme`.
- `testID="pro-mode-switch"`.

### 6. Enforcement at the 4 add paths

**Daily-limit gate is UI-first for in-app paths.** When the user taps the "+ Add"
FAB (opens `showAddMenu`), the menu computes
`overDailyLimit = !proMode && countContentsAddedToday(db) >= 3` on open.

- If `overDailyLimit` is true:
  - Render a hint banner **at the top of the add menu**:
    *"Basic Mode is limited to three content additions per day."*
  - The three menu items (Enter Text / Choose Image / Add Link) remain visible
    but are **disabled** (reduced opacity, non-pressable, no haptic).
  - `testID="daily-limit-hint"` on the banner text.
- If `overDailyLimit` is false: menu renders normally, no banner.

The menu state is evaluated **every time** the menu opens (not cached), so that
after a successful add the count is refreshed on the next open. This makes the
gate essentially declarative — handlers `handleAddText`, `handleAddImage`,
`handleAddLink` never need to check the daily limit themselves, because disabled
menu items cannot invoke them.

**Truncation gate** still runs inside each handler, before the API call:

```
1. const { text, truncated } = applyBasicLimit(raw, proMode);
2. Call processText(text, { proMode }); // → processSharedText gets proMode
3. On success: if truncated, show "content truncated" dialog.
```

**Share intent path** has no menu, so the daily-limit check runs inside
`processSharedText`. The function's return type gains `rejected?: 'daily-limit'`
and `truncated?: boolean`; the content-tab caller renders a dialog on rejection
or truncation.

| Path          | File                                         | Daily-limit check                                | Truncation check                   |
|---------------|----------------------------------------------|--------------------------------------------------|-------------------------------------|
| Text          | `app/(tabs)/content.tsx` `handleAddText`     | Menu banner + disabled items (UI-only)           | Inside handler before `processText` |
| Image OCR     | `app/(tabs)/content.tsx` `handleAddImage`    | Menu banner + disabled items (UI-only)           | After OCR, before `processText`     |
| URL/Link      | `app/(tabs)/content.tsx` `handleAddLink`     | Menu banner + disabled items (UI-only)           | After URL fetch, before `processText` |
| Share intent  | `lib/shareProcessing.ts` `processSharedText` | Gate at function entry → returns `rejected: 'daily-limit'`; caller shows dialog | Inside function before `translateText`/`extractVocabulary` |

### 7. Skip full-text translation in Basic

`lib/shareProcessing.ts` `processSharedText` gains an options parameter
`{ proMode: boolean }` (with a safe default of `true` to avoid silent regressions in
call sites that might not yet pass it — but all real callers will pass the current
setting):

```ts
export function processSharedText(
  db: SQLiteDatabase,
  text: string,
  sourceType: SourceType,
  sourceUrl: string | null,
  opts: { proMode: boolean } = { proMode: true },
): ProcessResult;
```

Inside the function, the `translateText()` call (current line ~63) is wrapped:

```ts
const translatedText = opts.proMode ? await translateText(chunks, ...) : null;
```

When `translatedText` is `null`, the row is inserted with `translated_text = null`,
which is already schema-legal.

### 8. Content detail page — translation tab

`app/content/[id].tsx` already has a translation tab. Update its empty-state:

- If `translated_text` is `null` or empty string:
  - Show a themed placeholder card with text:
    *"Full-text translation is a Pro feature. Enable Pro mode in Settings."*
  - No button/link — user navigates to Settings themselves.
- If `translated_text` is non-empty (e.g. from a previous Pro session): render it
  normally, regardless of current mode.

### 9. Info / warning surfaces

Two different surfaces depending on trigger:

| Trigger                         | Surface                        | Text                                                                                       |
|---------------------------------|--------------------------------|--------------------------------------------------------------------------------------------|
| In-app add while over daily limit | **Banner inside the add menu** | "Basic Mode is limited to three content additions per day."                                |
| Share intent while over daily limit | `ConfirmDialog` (single OK button) on content tab | "Basic Mode is limited to three content additions per day. The shared content was not saved." |
| Content was truncated (any path) | `ConfirmDialog` (single OK button) on content tab | "Content was truncated to 1000 characters (Basic mode). Enable Pro mode to remove this limit." |

Content-tab state: `showTruncatedDialog`, `showShareLimitDialog`. Only one is
visible at a time.

## Architecture / Harness

- **Architecture test**: extend the settings-keys whitelist in
  `lib/__tests__/architecture.test.ts` to include `'proMode'`.
- **Architecture test**: new rule — `translateText` must not be called
  unconditionally from `processSharedText`; the call must be gated by `opts.proMode`.
  Implemented as a file-scan test checking that the line calling `translateText`
  is inside a branch referencing `proMode` (simple regex over
  `lib/shareProcessing.ts`).

## Testing Plan

**Unit (`npm test`):**

- `lib/truncate.test.ts` — 9 cases (listed above).
- `lib/database.test.ts` — new test for `countContentsAddedToday` (empty table → 0,
  three rows today → 3, three rows today + two yesterday → 3).
- `lib/shareProcessing.test.ts` or extension of existing claude/shareProcessing
  mocks — verify:
  - Basic mode does not call `translateText` (spy assertion, mocked `callClaude`).
  - Pro mode calls both `extractVocabulary` and `translateText`.
- Architecture tests updated and passing.

**Manual verification:**

- Basic + text 1500 chars → save succeeds with ≤ ~1050 chars; truncation dialog shown.
- Basic + 4 adds in one day → 4th is rejected with limit dialog before OCR / URL fetch
  / API call.
- Basic: open content detail → translation tab shows Pro-feature placeholder.
- Pro + same inputs → all limits gone; translation tab populated.
- Toggle Basic → Pro → existing truncated content is unchanged; new content uses full
  length and receives translation.
- Reset app → `proMode` falls back to `false`, daily count resets (no contents).

## Open Questions

None. Ready for implementation plan.
