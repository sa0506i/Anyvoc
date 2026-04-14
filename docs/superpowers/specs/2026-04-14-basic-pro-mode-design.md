# Basic / Pro Mode — Design

**Date:** 2026-04-14
**Status:** Approved for implementation

## Goal

Introduce two app modes: **Basic** (default) and **Pro**, toggleable from Settings.

- **Basic:** New content is capped at **1000 characters** across all four add paths
  (text input, image OCR, URL/link, share intent). Content that exceeds the limit is
  truncated at the last complete sentence boundary, and the user is informed via a
  dialog.
- **Pro:** No limit — current behavior unchanged.

The mode affects only the *input side* (adding content). Existing vocabulary,
training, and all other features are identical in both modes.

## Non-Goals

- No payment, license, or account system. Pro is a pure UI toggle — anyone can flip
  it. This is a scaffolding step; monetization is out of scope.
- No per-item exception: the limit applies uniformly to all four add paths.
- No retroactive effect on existing content already in the DB.

## Data Model

New entry in the `settings` table (no schema change — it's a key/value store):

| Key       | Value                | Default  |
|-----------|----------------------|----------|
| `proMode` | `"true"` / `"false"` | `"false"` |

## Components

### 1. `lib/truncate.ts` (new)

```ts
export const BASIC_MODE_CHAR_LIMIT = 1000;

/**
 * Truncates text at the last sentence-ending punctuation at or before maxChars.
 * If no sentence boundary exists, falls back to a hard cut at maxChars.
 * Returns the unchanged text and truncated=false if already within the limit.
 */
export function truncateAtSentence(
  text: string,
  maxChars: number = BASIC_MODE_CHAR_LIMIT,
): { text: string; truncated: boolean };
```

**Algorithm:**

1. If `text.length <= maxChars` → return `{ text, truncated: false }`.
2. Slice `text.slice(0, maxChars)`.
3. Search backwards for the last sentence-ending punctuation: `.`, `!`, `?`, `…`,
   optionally followed by a closing quote (`"`, `'`, `»`, `)`, `]`) and/or
   whitespace.
4. If found at position `p` (inclusive), return
   `{ text: text.slice(0, p + 1).trimEnd(), truncated: true }`.
5. Otherwise (no sentence boundary in the first `maxChars`): hard cut at `maxChars`,
   trim trailing whitespace, return `{ text: <cut>, truncated: true }`.

**Tests (`lib/truncate.test.ts`):**

- Empty string → returns `""`, `truncated: false`
- Text shorter than limit → unchanged, `truncated: false`
- Text exactly at limit → unchanged, `truncated: false`
- Text > limit with sentence end before limit → cut at sentence end
- Text > limit with no sentence end in first 1000 chars → hard cut at 1000
- Sentence end with closing quote `He said "Hi." ...` → cut after quote
- German punctuation (`!`, `?`) works

### 2. `hooks/useSettings.ts` (extended)

- Add `proMode: boolean` to `SettingsState` (default `false`).
- In `loadSettings`: `proMode: settings['proMode'] === 'true'`.
- In `resetApp`: reset `proMode: false` and persist `'false'`.
- `updateSetting(db, 'proMode', 'true' | 'false')` uses the existing update path;
  the store converts the string to boolean before `set({ proMode: ... })`.

**Note:** Because `updateSetting` is generic (key/value string), the boolean
conversion happens inside the store: a dedicated `set` branch for `proMode`
converts `'true'` → `true`, anything else → `false`.

### 3. `components/ConfirmDialog.tsx` (extended)

- Make `cancelLabel` optional (`?: string`). When omitted:
  - Render only the confirm button (full width).
  - `onCancel` is still called when dismissed via back gesture / outside tap.
- No other behavioral change. Existing call sites (all passing `cancelLabel`)
  continue to work unchanged.

### 4. `app/settings.tsx` (new section)

New section inserted **at the top**, before "Languages":

```
Mode
Basic limits content to 1000 characters per item. Pro has no limit.

[ Pro Mode                                    (● Switch) ]
```

- Native RN `Switch` component, `onValueChange` calls
  `updateSetting('proMode', on ? 'true' : 'false')`.
- `trackColor.true = colors.primary`, themed via `useTheme`.
- `testID="pro-mode-switch"`.

### 5. Enforcement at 4 entry points

A shared helper is used at each seam:

```ts
// in lib/truncate.ts
export function applyBasicLimit(
  text: string,
  proMode: boolean,
): { text: string; truncated: boolean } {
  if (proMode) return { text, truncated: false };
  return truncateAtSentence(text);
}
```

| Path          | File                                       | Integration                                                                                                |
|---------------|--------------------------------------------|------------------------------------------------------------------------------------------------------------|
| Text          | `app/(tabs)/content.tsx` `handleAddText`   | Before `processText(textInput)`. If `truncated` → show dialog after save completes.                        |
| Image OCR     | `app/(tabs)/content.tsx` `handleAddImage`  | After `extractTextFromImageLocal`, before `processText`. Dialog same flow.                                 |
| URL/Link      | `app/(tabs)/content.tsx` `handleAddLink`   | After `extractFromUrl` returns, before `processText`. Dialog same flow.                                    |
| Share intent  | `lib/shareProcessing.ts` `processSharedText` | Truncate at top. Return value gains a `truncated: boolean` field; the content-tab caller renders dialog. |

For the three in-app paths, the sequence is:

1. Obtain raw text.
2. `const { text, truncated } = applyBasicLimit(raw, proMode);`
3. Run existing `processText(text)` pipeline.
4. On success: if `truncated`, set dialog state to visible.

For the share intent path, the return type of `processSharedText` is extended
with `truncated?: boolean`. The content tab's share-result effect checks the
flag and shows the same dialog.

### 6. Info dialog text

```
Title:   Content truncated
Message: Content was truncated at 1000 characters (Basic mode).
         Enable Pro mode in Settings to remove this limit.
Confirm: OK
```

Rendered via `ConfirmDialog` with no `cancelLabel`. Single state variable
`showTruncatedDialog` on the content tab.

## Architecture / Harness

- **Architecture test**: extend the settings-keys whitelist in
  `lib/__tests__/architecture.test.ts` to include `'proMode'` so future refactors
  don't drop it.
- **No new lint rule needed**: truncation is explicit at four known seams, not a
  cross-cutting concern.

## Testing Plan

**Unit (`npm test`):**

- `lib/truncate.test.ts` — 7 cases for `truncateAtSentence` + 2 for `applyBasicLimit`
  (proMode=true bypass, proMode=false delegates).
- Architecture test updated and passing.

**E2E (optional — deferred, not blocking):**

- `09-pro-mode.yaml`: Settings → toggle Pro → add 1500-char text → expect no dialog.
  Toggle back to Basic → add 1500-char text → expect truncation dialog with `OK`.

**Manual verification:**

- Basic + text 1500 chars → dialog shown, only ~≤1000 chars saved, sentence boundary
  intact.
- Basic + OCR of long image → same.
- Basic + URL that yields 5000 chars → same.
- Basic + share of long article → dialog shown after processing lands in content tab.
- Pro + same inputs → no dialog, full length saved.
- Reset app → `proMode` falls back to `false`.

## Open Questions

None. Ready for implementation plan.
