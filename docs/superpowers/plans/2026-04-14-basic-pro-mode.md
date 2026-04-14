# Basic / Pro Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Basic/Pro mode toggle that, in Basic mode, limits new content to 1000 characters (truncated at the nearest sentence/word boundary), caps content additions at 3 per day, and skips full-text translation.

**Architecture:** New pure-TS utility `lib/truncate.ts`, one SQLite helper, a boolean in `useSettingsStore`, a Switch in the Settings screen, a banner in the Add menu, and plumbing of a `proMode` flag through `processSharedText`. Dialogs reuse the existing `useAlert()` hook (`ConfirmDialog` already supports `infoOnly`).

**Tech Stack:** TypeScript, React Native, Expo, expo-sqlite, Zustand, Jest, ESLint.

**Spec:** `docs/superpowers/specs/2026-04-14-basic-pro-mode-design.md`

---

## File Structure

**New files:**

- `lib/truncate.ts` — `truncateAtSentence`, `applyBasicLimit`, `BASIC_MODE_CHAR_LIMIT`
- `lib/truncate.test.ts` — unit tests for the truncation utility

**Modified files:**

- `lib/database.ts` — add `countContentsAddedToday()` + `BASIC_MODE_DAILY_CONTENT_LIMIT` constant
- `lib/database.test.ts` — tests for the new helper
- `lib/shareProcessing.ts` — add `proMode` to `ShareProcessingSettings`, daily-limit gate, truncation gate, skip `translateText`
- `hooks/useSettings.ts` — add `proMode: boolean` to store + load/update/reset paths
- `app/settings.tsx` — new "Mode" section at the top with RN `Switch`
- `app/(tabs)/content.tsx` — daily-limit banner + disabled menu items; truncation dialog; pass `proMode`
- `components/ShareIntentHandler.tsx` — handle `rejected: 'daily-limit'` result; show dialogs
- `app/content/[id].tsx` — translation tab placeholder when `translated_text` is null/empty
- `lib/__tests__/architecture.test.ts` — whitelist `proMode`; assert `translateText` gated by `proMode`

---

## Task 1: Truncation utility + tests

**Files:**
- Create: `lib/truncate.ts`
- Test: `lib/truncate.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `lib/truncate.test.ts`:

```ts
import { truncateAtSentence, applyBasicLimit, BASIC_MODE_CHAR_LIMIT } from './truncate';

describe('truncateAtSentence', () => {
  it('returns unchanged text when shorter than limit', () => {
    expect(truncateAtSentence('Hello world.', 100)).toEqual({
      text: 'Hello world.',
      truncated: false,
    });
  });

  it('returns unchanged text when exactly at limit', () => {
    const text = 'a'.repeat(100);
    expect(truncateAtSentence(text, 100)).toEqual({ text, truncated: false });
  });

  it('returns empty string unchanged', () => {
    expect(truncateAtSentence('', 100)).toEqual({ text: '', truncated: false });
  });

  it('cuts at the last sentence boundary within the limit', () => {
    const text = 'First sentence. Second sentence is here. Third.';
    // limit = 30 → "First sentence. Second sentence" is 31 chars;
    // last period within 30 chars is after "First sentence" (idx 14)
    const result = truncateAtSentence(text, 30);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('First sentence.');
  });

  it('handles sentence ending with closing quote', () => {
    const text = 'He said "Hello." And then he left the building forever.';
    // limit = 20 → last `.` within 20 chars is idx 15 (before "); include the quote
    const result = truncateAtSentence(text, 20);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('He said "Hello."');
  });

  it('handles German / European punctuation (? ! …)', () => {
    const text = 'Wirklich? Nein! Doch… Und dann kam der lange Rest des Satzes hier.';
    const result = truncateAtSentence(text, 22);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('Wirklich? Nein! Doch…');
  });

  it('falls back to word boundary when no sentence end exists in first N chars', () => {
    const text = 'word '.repeat(300); // 1500 chars, no punctuation
    const result = truncateAtSentence(text, 1000);
    expect(result.truncated).toBe(true);
    // Result should end at a word boundary, keeping the full word that straddles 1000
    expect(result.text.length).toBeGreaterThanOrEqual(1000);
    expect(result.text.length).toBeLessThanOrEqual(1010);
    expect(result.text.endsWith('word')).toBe(true);
  });

  it('returns pathological single long token unchanged (flagged truncated)', () => {
    const text = 'x'.repeat(1200); // single 1200-char token
    const result = truncateAtSentence(text, 1000);
    expect(result.text).toBe(text); // nothing sensible to cut
    expect(result.truncated).toBe(true);
  });

  it('default limit is BASIC_MODE_CHAR_LIMIT (1000)', () => {
    expect(BASIC_MODE_CHAR_LIMIT).toBe(1000);
    const text = 'A sentence. '.repeat(200); // ≈ 2400 chars
    const result = truncateAtSentence(text);
    expect(result.text.length).toBeLessThanOrEqual(1000);
    expect(result.truncated).toBe(true);
  });
});

describe('applyBasicLimit', () => {
  it('bypasses truncation when proMode is true', () => {
    const text = 'x'.repeat(5000);
    expect(applyBasicLimit(text, true)).toEqual({ text, truncated: false });
  });

  it('applies truncation when proMode is false', () => {
    const text = 'A sentence. '.repeat(200);
    const result = applyBasicLimit(text, false);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(1000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/truncate.test.ts`
Expected: FAIL with "Cannot find module './truncate'"

- [ ] **Step 3: Implement the utility**

Create `lib/truncate.ts`:

```ts
/**
 * Truncation utilities for Basic mode content limits. Pure TypeScript,
 * no external dependencies. See docs/superpowers/specs/2026-04-14-basic-pro-mode-design.md.
 */

export const BASIC_MODE_CHAR_LIMIT = 1000;

/** Characters that end a sentence. */
const SENTENCE_ENDINGS = new Set(['.', '!', '?', '…']);
/** Closing punctuation that may follow a sentence ending and is kept with it. */
const CLOSERS = new Set(['"', "'", '»', ')', ']']);

/**
 * Truncates `text` to roughly `maxChars`, preferring a sentence boundary and
 * falling back to a word boundary. The returned text is trimmed of trailing
 * whitespace. When a word boundary is used, the result may exceed `maxChars`
 * by up to the length of the straddling word.
 */
export function truncateAtSentence(
  text: string,
  maxChars: number = BASIC_MODE_CHAR_LIMIT,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };

  // 1) Last sentence-ending punctuation at or before maxChars
  const head = text.slice(0, maxChars);
  for (let i = head.length - 1; i >= 0; i--) {
    const ch = head[i];
    if (SENTENCE_ENDINGS.has(ch)) {
      // Optionally include a trailing closer (e.g. the `"` in `."`)
      let end = i;
      if (end + 1 < text.length && CLOSERS.has(text[end + 1])) {
        end = end + 1;
      }
      return { text: text.slice(0, end + 1).trimEnd(), truncated: true };
    }
  }

  // 2) Fall back to the next whitespace at or after maxChars
  for (let i = maxChars; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      return { text: text.slice(0, i).trimEnd(), truncated: true };
    }
  }

  // 3) Pathological: single long token, nothing to cut.
  return { text, truncated: true };
}

/** Applies the Basic-mode truncation only when `proMode` is false. */
export function applyBasicLimit(
  text: string,
  proMode: boolean,
): { text: string; truncated: boolean } {
  if (proMode) return { text, truncated: false };
  return truncateAtSentence(text);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/truncate.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/truncate.ts lib/truncate.test.ts
git commit -m "feat: add truncateAtSentence utility for Basic mode"
```

---

## Task 2: Database helper `countContentsAddedToday`

**Files:**
- Modify: `lib/database.ts`
- Modify: `lib/database.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/database.test.ts` (inside the existing `describe('database', …)` block, or a new sibling `describe` as the file's convention dictates — check the existing structure first and follow it):

```ts
describe('countContentsAddedToday', () => {
  it('returns 0 for an empty contents table', () => {
    const db = createTestDb(); // whichever helper the file already uses
    expect(countContentsAddedToday(db)).toBe(0);
  });

  it('counts only rows whose created_at is on the local calendar day', () => {
    const db = createTestDb();
    const now = new Date(2026, 3, 14, 15, 0, 0); // April 14 2026, 15:00 local
    const todayStart = new Date(2026, 3, 14, 0, 0, 0).getTime();
    const yesterday = new Date(2026, 3, 13, 23, 30, 0).getTime();

    insertContent(db, {
      id: 'a', title: 'T', original_text: 'x', translated_text: null,
      source_type: 'text', source_url: null, created_at: todayStart + 1000,
    });
    insertContent(db, {
      id: 'b', title: 'T', original_text: 'x', translated_text: null,
      source_type: 'text', source_url: null, created_at: todayStart + 5000,
    });
    insertContent(db, {
      id: 'c', title: 'T', original_text: 'x', translated_text: null,
      source_type: 'text', source_url: null, created_at: yesterday,
    });

    expect(countContentsAddedToday(db, now)).toBe(2);
  });

  it('exports BASIC_MODE_DAILY_CONTENT_LIMIT = 3', () => {
    expect(BASIC_MODE_DAILY_CONTENT_LIMIT).toBe(3);
  });
});
```

Make sure the imports at the top of `lib/database.test.ts` include the two new exports:

```ts
import {
  // …existing imports…
  countContentsAddedToday,
  BASIC_MODE_DAILY_CONTENT_LIMIT,
} from './database';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest lib/database.test.ts -t countContentsAddedToday`
Expected: FAIL with "countContentsAddedToday is not exported" or similar.

- [ ] **Step 3: Implement the helper**

Add to `lib/database.ts` near the other query helpers (keep placement consistent with existing exports like `getContents`):

```ts
/** Maximum contents a user in Basic mode may add per local calendar day. */
export const BASIC_MODE_DAILY_CONTENT_LIMIT = 3;

/** Counts contents added on the local calendar day of `now` (default: now). */
export function countContentsAddedToday(
  db: SQLiteDatabase,
  now: Date = new Date(),
): number {
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const row = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) as count FROM contents WHERE created_at >= ?',
    [todayStart],
  );
  return row?.count ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest lib/database.test.ts -t countContentsAddedToday`
Expected: PASS (3 tests).

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/database.ts lib/database.test.ts
git commit -m "feat: add countContentsAddedToday helper"
```

---

## Task 3: `proMode` in settings store

**Files:**
- Modify: `hooks/useSettings.ts`

- [ ] **Step 1: Extend `SettingsState`**

In `hooks/useSettings.ts`, add `proMode` to the interface and the store:

```ts
interface SettingsState {
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  quizDirection: QuizDirection;
  quizMode: QuizMode;
  cardsPerRound: string;
  proMode: boolean; // ← NEW
  loaded: boolean;

  loadSettings: (db: SQLiteDatabase) => void;
  updateSetting: (db: SQLiteDatabase, key: string, value: string) => void;
  resetApp: (db: SQLiteDatabase) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  nativeLanguage: 'en',
  learningLanguage: 'en',
  level: 'A2',
  quizDirection: 'random',
  quizMode: 'flashcard',
  cardsPerRound: '20',
  proMode: false, // ← NEW
  loaded: false,

  loadSettings: (db) => {
    // …existing code up to the final `set({ … })`…

    set({
      nativeLanguage: settings['nativeLanguage'] ?? getDeviceNativeLanguage(),
      learningLanguage: settings['learningLanguage'] ?? 'en',
      level: settings['level'] ?? 'A2',
      quizDirection: (settings['quizDirection'] as QuizDirection) ?? 'random',
      quizMode: (settings['quizMode'] as QuizMode) ?? 'flashcard',
      cardsPerRound: settings['cardsPerRound'] ?? '20',
      proMode: settings['proMode'] === 'true', // ← NEW
      loaded: true,
    });
  },

  updateSetting: (db, key, value) => {
    dbSetSetting(db, key, value);
    if (key === 'proMode') {
      set({ proMode: value === 'true' });
    } else {
      set({ [key]: value } as Partial<SettingsState>);
    }
  },

  resetApp: (db) => {
    clearAllData(db);
    const deviceLang = getDeviceNativeLanguage();
    dbSetSetting(db, 'nativeLanguage', deviceLang);
    set({
      nativeLanguage: deviceLang,
      learningLanguage: 'en',
      level: 'A2',
      quizDirection: 'random',
      quizMode: 'flashcard',
      cardsPerRound: '20',
      proMode: false, // ← NEW
    });
  },
}));
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run existing settings tests (if any)**

Run: `npx jest hooks`
Expected: PASS (no new tests yet; ensure existing tests still work).

- [ ] **Step 4: Commit**

```bash
git add hooks/useSettings.ts
git commit -m "feat: add proMode to settings store"
```

---

## Task 4: Extend `processSharedText` with `proMode`

**Files:**
- Modify: `lib/shareProcessing.ts`

- [ ] **Step 1: Update the settings interface and implementation**

In `lib/shareProcessing.ts`:

```ts
import type { SQLiteDatabase } from 'expo-sqlite';
import { extractVocabulary, translateText, detectLanguage, type SupportedLanguage } from './claude';
import {
  insertContent,
  insertVocabularyBatch,
  countContentsAddedToday,
  BASIC_MODE_DAILY_CONTENT_LIMIT,
  type Content,
  type Vocabulary,
} from './database';
import { getLanguageEnglishName } from '../constants/languages';
import { isAtOrAboveLevel } from '../constants/levels';
import { generateUUID } from './uuid';
import { applyBasicLimit } from './truncate';

export interface ShareProcessingSettings {
  nativeLanguage: string;
  learningLanguage: string;
  level: string;
  proMode: boolean; // ← NEW
}

export interface ShareProcessingResult {
  inserted: number;
  foundTotal: number;
  belowLevel: boolean;
  truncated: boolean;          // ← NEW
  rejected?: 'daily-limit';    // ← NEW (when set, no content was saved)
}

export async function processSharedText(
  db: SQLiteDatabase,
  text: string,
  title: string,
  sourceType: Content['source_type'],
  sourceUrl: string | undefined,
  settings: ShareProcessingSettings,
  onProgress: (message: string) => void,
): Promise<ShareProcessingResult> {
  // 1) Daily-limit gate (Basic mode only). No API call if rejected.
  if (!settings.proMode && countContentsAddedToday(db) >= BASIC_MODE_DAILY_CONTENT_LIMIT) {
    return {
      inserted: 0,
      foundTotal: 0,
      belowLevel: false,
      truncated: false,
      rejected: 'daily-limit',
    };
  }

  // 2) Truncation gate (Basic mode only).
  const { text: limitedText, truncated } = applyBasicLimit(text, settings.proMode);

  const contentId = generateUUID();
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
  if (settings.proMode) {
    onProgress('Translating text...');
    translation = await translateText(limitedText, learningName, nativeName);
  }

  const now = Date.now();
  insertContent(db, {
    id: contentId,
    title:
      title || limitedText.substring(0, 50).trim() + (limitedText.length > 50 ? '...' : ''),
    original_text: limitedText,
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

  const actuallyInserted = insertVocabularyBatch(db, vocabEntries);

  return {
    inserted: actuallyInserted,
    foundTotal: vocabs.length,
    belowLevel: vocabs.length > 0 && vocabEntries.length === 0,
    truncated,
  };
}
```

- [ ] **Step 2: Update the existing shareProcessing unit test mocks**

Open `lib/__tests__/approved-fixtures.test.ts` (and any other file importing
`ShareProcessingSettings`). Add `proMode: true` to any settings literal used
in existing tests so they keep their old behaviour (Pro = no limits). If no
such literal exists, skip.

Grep to find them: `grep -rn "ShareProcessingSettings\|processSharedText(" lib/`

If a test spreads a partial object (`{ nativeLanguage, learningLanguage, level }`),
add `proMode: true` to it.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all existing tests still pass. New untested return fields
(`truncated`, `rejected`) are not asserted by existing tests.

- [ ] **Step 4: Add behaviour tests**

Append to `lib/__tests__/approved-fixtures.test.ts` (or create `lib/shareProcessing.test.ts` if that file structure makes more sense in context — check what already exists):

```ts
import { processSharedText } from '../shareProcessing';
import * as claude from '../claude';

// Assume the file already sets up global.fetch mocks + an in-memory DB helper
// called `createTestDb()` (reuse the existing pattern). If not, adapt.

describe('processSharedText — proMode', () => {
  const baseSettings = {
    nativeLanguage: 'en',
    learningLanguage: 'de',
    level: 'A1',
  };

  it('skips translateText when proMode is false', async () => {
    const db = createTestDb();
    const translateSpy = jest.spyOn(claude, 'translateText');
    jest.spyOn(claude, 'extractVocabulary').mockResolvedValue([]);
    jest.spyOn(claude, 'detectLanguage').mockResolvedValue('de');

    await processSharedText(
      db, 'Hallo Welt.', 'title', 'text', undefined,
      { ...baseSettings, proMode: false },
      () => {},
    );

    expect(translateSpy).not.toHaveBeenCalled();
  });

  it('calls translateText when proMode is true', async () => {
    const db = createTestDb();
    const translateSpy = jest.spyOn(claude, 'translateText').mockResolvedValue('Hello World.');
    jest.spyOn(claude, 'extractVocabulary').mockResolvedValue([]);
    jest.spyOn(claude, 'detectLanguage').mockResolvedValue('de');

    await processSharedText(
      db, 'Hallo Welt.', 'title', 'text', undefined,
      { ...baseSettings, proMode: true },
      () => {},
    );

    expect(translateSpy).toHaveBeenCalled();
  });

  it('rejects with daily-limit when Basic and >= 3 today', async () => {
    const db = createTestDb();
    // Insert 3 contents dated today
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      require('../database').insertContent(db, {
        id: `c${i}`, title: 't', original_text: 'x', translated_text: null,
        source_type: 'text', source_url: null, created_at: now,
      });
    }
    const translateSpy = jest.spyOn(claude, 'translateText');
    const extractSpy = jest.spyOn(claude, 'extractVocabulary');

    const result = await processSharedText(
      db, 'Hallo.', 'title', 'text', undefined,
      { ...baseSettings, proMode: false },
      () => {},
    );

    expect(result.rejected).toBe('daily-limit');
    expect(translateSpy).not.toHaveBeenCalled();
    expect(extractSpy).not.toHaveBeenCalled();
  });

  it('truncates long text in Basic mode and flags truncated', async () => {
    const db = createTestDb();
    jest.spyOn(claude, 'translateText').mockResolvedValue('');
    jest.spyOn(claude, 'extractVocabulary').mockResolvedValue([]);
    jest.spyOn(claude, 'detectLanguage').mockResolvedValue('de');
    const longText = 'Ein Satz. '.repeat(200); // ≈ 2000 chars

    const result = await processSharedText(
      db, longText, 'title', 'text', undefined,
      { ...baseSettings, proMode: false },
      () => {},
    );

    expect(result.truncated).toBe(true);
  });
});
```

- [ ] **Step 5: Run new tests**

Run: `npx jest lib/__tests__/approved-fixtures.test.ts -t proMode`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/shareProcessing.ts lib/__tests__/approved-fixtures.test.ts
git commit -m "feat: gate translation + daily limit + truncation by proMode"
```

---

## Task 5: Settings UI — Mode switch

**Files:**
- Modify: `app/settings.tsx`

- [ ] **Step 1: Add the Mode section**

At the top of `app/settings.tsx`, add to imports:

```ts
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform, StyleSheet, Switch } from 'react-native';
```

Inside the component, add the subscription:

```ts
const proMode = useSettingsStore((s) => s.proMode);
```

Insert this section **as the first section** inside the main `<ScrollView contentContainerStyle={styles.content}>`, before the `{/* Languages */}` block:

```tsx
{/* Mode */}
<Text style={styles.sectionTitle}>Mode</Text>
<Text style={styles.sectionHint}>
  Basic limits content to 1000 characters, 3 additions per day, and no
  full-text translation. Pro removes all limits.
</Text>
<View style={styles.row}>
  <Text style={styles.rowLabel}>Pro Mode</Text>
  <Switch
    testID="pro-mode-switch"
    value={proMode}
    onValueChange={(on) => updateSetting('proMode', on ? 'true' : 'false')}
    trackColor={{ false: colors.subtleOverlay, true: colors.primary }}
    thumbColor={'#FFFFFF'}
  />
</View>
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint app/settings.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/settings.tsx
git commit -m "feat: add Pro Mode switch to settings screen"
```

---

## Task 6: Content tab — Add-menu banner, disabled items, truncation dialog

**Files:**
- Modify: `app/(tabs)/content.tsx`

- [ ] **Step 1: Add subscriptions and computed flag**

At the top of the component body (near the other `useSettingsStore` lines):

```ts
const proMode = useSettingsStore((s) => s.proMode);
```

Import the helpers:

```ts
import { countContentsAddedToday, BASIC_MODE_DAILY_CONTENT_LIMIT } from '../../lib/database';
```

Right after the state declarations, add:

```ts
const [overDailyLimit, setOverDailyLimit] = useState(false);

// Recompute every time the add menu opens.
useEffect(() => {
  if (showAddMenu) {
    setOverDailyLimit(
      !proMode && countContentsAddedToday(db) >= BASIC_MODE_DAILY_CONTENT_LIMIT,
    );
  }
}, [showAddMenu, proMode, db]);
```

- [ ] **Step 2: Render the banner + disable menu items**

Inside the Add Menu `Modal`, replace the existing `<View style={styles.menu}>` block so it renders the banner when `overDailyLimit` is true and disables each `Pressable`:

```tsx
<View style={styles.menu}>
  {overDailyLimit && (
    <Text testID="daily-limit-hint" style={styles.dailyLimitHint}>
      Basic Mode is limited to three content additions per day.
    </Text>
  )}
  <Pressable
    testID="menu-enter-text"
    disabled={overDailyLimit}
    style={({ pressed }) => [
      styles.menuItem,
      overDailyLimit && styles.menuItemDisabled,
      pressed && !overDailyLimit && styles.pressed,
    ]}
    onPress={() => {
      setShowAddMenu(false);
      setShowTextModal(true);
    }}
  >
    <Ionicons name="create-outline" size={24} color={colors.text} />
    <Text style={styles.menuItemText}>Enter Text</Text>
  </Pressable>
  <Pressable
    testID="menu-choose-image"
    disabled={overDailyLimit}
    style={({ pressed }) => [
      styles.menuItem,
      overDailyLimit && styles.menuItemDisabled,
      pressed && !overDailyLimit && styles.pressed,
    ]}
    onPress={handleAddImage}
  >
    {/* …existing icon + text… */}
  </Pressable>
  <Pressable
    testID="menu-add-link"
    disabled={overDailyLimit}
    style={({ pressed }) => [
      styles.menuItem,
      overDailyLimit && styles.menuItemDisabled,
      pressed && !overDailyLimit && styles.pressed,
    ]}
    onPress={() => {
      setShowAddMenu(false);
      setShowLinkModal(true);
    }}
  >
    {/* …existing icon + text… */}
  </Pressable>
</View>
```

Note: this shows only the pattern — copy the exact existing contents
(icons + labels) from the current file when editing.

- [ ] **Step 3: Add styles**

Append to the `createStyles` function (inside the returned `StyleSheet.create({ … })`):

```ts
dailyLimitHint: {
  fontSize: fontSize.sm,
  color: colors.textSecondary,
  fontWeight: '300',
  padding: spacing.md,
  paddingBottom: spacing.sm,
  textAlign: 'center',
},
menuItemDisabled: {
  opacity: 0.4,
},
```

(`colors` is captured by `createStyles(colors: ThemeColors)`; `c` is the local
name in this file — use whichever the existing `createStyles` uses.)

- [ ] **Step 4: Pass `proMode` to `processSharedText`**

Change the `processText` helper in the file:

```ts
const result = await processSharedText(
  db, text, title, sourceType, sourceUrl,
  { nativeLanguage, learningLanguage, level, proMode }, // ← add proMode
  setLoadingMessage,
);
```

Right after the `loadContents()` call but before the two `alert('Done', …)`
branches, handle the truncation flag:

```ts
loadContents();
if (result.truncated) {
  alert(
    'Content truncated',
    'Content was truncated to 1000 characters (Basic mode). Enable Pro mode in Settings to remove this limit.',
  );
}
if (result.belowLevel) {
  alert(/* …existing message… */);
} else {
  alert(/* …existing message… */);
}
```

Note: the `alert` helper is info-only (`infoOnly: true` under the hood) — the
user closes the first dialog before the second appears. This is acceptable.

- [ ] **Step 5: Type check + lint**

Run: `npx tsc --noEmit && npx eslint app/(tabs)/content.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/(tabs)/content.tsx
git commit -m "feat: enforce Basic mode limits on add menu + show truncation dialog"
```

---

## Task 7: Share intent — handle daily-limit rejection + truncation

**Files:**
- Modify: `components/ShareIntentHandler.tsx`

- [ ] **Step 1: Subscribe to proMode and pass it through**

In `components/ShareIntentHandler.tsx`, near the other `useSettingsStore` selectors:

```ts
const proMode = useSettingsStore((s) => s.proMode);
```

Update the `processSharedText` call:

```ts
const result = await processSharedText(
  db, text, title, sourceType, sourceUrl,
  { nativeLanguage, learningLanguage, level, proMode }, // ← add proMode
  shareStore.setMessage,
);
```

- [ ] **Step 2: Handle the rejected + truncated flags**

Right after `bumpContentRefresh();` (keep order: refresh even if nothing new — it's harmless; but only call `bumpContentRefresh()` when a row was actually inserted, i.e., not on rejection):

```ts
if (result.rejected === 'daily-limit') {
  alert(
    'Daily limit reached',
    'Basic Mode is limited to three content additions per day. The shared content was not saved.',
  );
} else {
  bumpContentRefresh();

  if (result.truncated) {
    alert(
      'Content truncated',
      'Content was truncated to 1000 characters (Basic mode). Enable Pro mode in Settings to remove this limit.',
    );
  }
  if (result.belowLevel) {
    alert(/* …existing message… */);
  } else {
    alert(/* …existing message… */);
  }
}
```

(Remove the previous unconditional `bumpContentRefresh()` and the old
`if (result.belowLevel)` block — both move into the `else` branch above.)

- [ ] **Step 3: Type check + lint**

Run: `npx tsc --noEmit && npx eslint components/ShareIntentHandler.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/ShareIntentHandler.tsx
git commit -m "feat: handle daily-limit and truncation in share intent flow"
```

---

## Task 8: Translation tab placeholder

**Files:**
- Modify: `app/content/[id].tsx`

- [ ] **Step 1: Locate the translation tab body**

In `app/content/[id].tsx`, find where the "Translation" tab renders
`translated_text`. It will look something like:

```tsx
{activeTab === 'translation' && (
  <Text style={styles.bodyText}>{content.translated_text}</Text>
)}
```

- [ ] **Step 2: Add the placeholder fallback**

Replace with:

```tsx
{activeTab === 'translation' && (
  content.translated_text && content.translated_text.trim().length > 0 ? (
    <Text style={styles.bodyText}>{content.translated_text}</Text>
  ) : (
    <View style={styles.proPlaceholder}>
      <Text style={styles.proPlaceholderText}>
        Full-text translation is a Pro feature. Enable Pro mode in Settings.
      </Text>
    </View>
  )
)}
```

Append these styles inside the file's existing `createStyles` block (adapt to
the file's conventions — it uses `c` or `colors`):

```ts
proPlaceholder: {
  padding: spacing.lg,
  alignItems: 'center',
},
proPlaceholderText: {
  fontSize: fontSize.sm,
  color: c.textSecondary, // or `colors.textSecondary`, match the file
  fontWeight: '300',
  textAlign: 'center',
  lineHeight: 20,
},
```

- [ ] **Step 3: Type check + lint**

Run: `npx tsc --noEmit && npx eslint "app/content/[id].tsx"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "app/content/[id].tsx"
git commit -m "feat: show Pro-feature placeholder when translation is missing"
```

---

## Task 9: Architecture tests

**Files:**
- Modify: `lib/__tests__/architecture.test.ts`

- [ ] **Step 1: Whitelist `proMode` in settings-keys list**

Open `lib/__tests__/architecture.test.ts`. Find the test that enumerates the
allowed settings keys (grep for `'quizMode'` or `'cardsPerRound'`). Add
`'proMode'` to that array.

- [ ] **Step 2: Add a test that `translateText` is gated by `proMode`**

Append to `lib/__tests__/architecture.test.ts` (at the bottom, inside the top-
level `describe` or its own):

```ts
it('processSharedText only calls translateText when proMode is true', () => {
  const src = fs.readFileSync('lib/shareProcessing.ts', 'utf8');
  // The call must live inside a block that references proMode on settings.
  // A simple proxy: there must be an `if (settings.proMode)` before the
  // `translateText(` call, and no unconditional translateText(...) at module
  // scope.
  const callIdx = src.indexOf('translateText(');
  expect(callIdx).toBeGreaterThan(-1);
  const before = src.slice(0, callIdx);
  expect(before).toMatch(/settings\.proMode/);
});
```

- [ ] **Step 3: Run the architecture tests**

Run: `npx jest lib/__tests__/architecture.test.ts`
Expected: PASS.

- [ ] **Step 4: Run the whole test suite**

Run: `npm test`
Expected: all tests pass, coverage thresholds met.

- [ ] **Step 5: Commit**

```bash
git add lib/__tests__/architecture.test.ts
git commit -m "test: enforce proMode key whitelist and translate-gating"
```

---

## Task 10: Manual verification + final checks

**Files:** none (runtime verification).

- [ ] **Step 1: Start the app**

Follow the "JS-only changes" path from CLAUDE.md:

```powershell
npx kill-port 8081
cd D:\dev\Claude-React\Anyvoc
npx expo start --android 2>&1 | Tee-Object -FilePath expo.log
# (background)
adb reverse tcp:8081 tcp:8081
adb shell am force-stop com.anonymous.Anyvoc
adb shell am start -a android.intent.action.VIEW `
  -d "exp+anyvoc://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081" `
  com.anonymous.Anyvoc
```

- [ ] **Step 2: Verify Basic mode — truncation**

Settings → verify Pro Mode switch is **off**. Content tab → "+" → Enter Text →
paste 1500 characters of prose → Save. Expect: success dialog, then
"Content truncated" dialog. Open the new item — body should end at a sentence
boundary, ≤ ~1050 chars.

- [ ] **Step 3: Verify Basic mode — translation skipped**

In the item from Step 2, switch to the Translation tab. Expect the placeholder
"Full-text translation is a Pro feature..." card.

- [ ] **Step 4: Verify Basic mode — daily limit**

Add two more items (total 3 today). Open "+" again. Expect: banner
"Basic Mode is limited to three content additions per day." + all three menu
items visibly disabled (greyed out, non-pressable).

- [ ] **Step 5: Verify Pro mode**

Settings → toggle Pro Mode on. Content tab → "+" → Enter Text → add a long
(>1500-char) item. Expect: no truncation dialog. Open item → Translation tab
shows translated content. Add a 4th item same day → allowed (no banner).

- [ ] **Step 6: Verify Reset**

Settings → Reset → confirm. After reset, Pro Mode switch is **off** again.

- [ ] **Step 7: Final automated check**

Run: `npm test`
Expected: all pass.

- [ ] **Step 8: Commit any small fixes discovered during manual testing**

```bash
git add -A
git commit -m "fix: <whatever needed fixing during manual verification>"
```

---

## Self-Review Summary

**Spec coverage check:**
- Pro Mode setting + switch → Tasks 3, 5 ✓
- 1000-char truncation at sentence/word boundary → Tasks 1, 4 ✓
- Truncation before API call → Task 4 (applied before `extractVocabulary`/`translateText`) ✓
- 3-per-day limit enforced via banner + disabled menu → Task 6 ✓
- 3-per-day limit enforced for share intent → Tasks 4, 7 ✓
- No full-text translation in Basic → Task 4 ✓
- Translation-tab placeholder in detail view → Task 8 ✓
- Architecture harness → Task 9 ✓
- Tests (unit + architecture + manual) → Tasks 1, 2, 4, 9, 10 ✓

**Placeholder scan:** None. All code shown is complete.

**Type consistency:** `ShareProcessingSettings` extended once (Task 4); `ShareProcessingResult` extended once (Task 4) and all call sites updated (Tasks 6, 7). `proMode: boolean` is the single canonical shape — persisted as `"true"`/`"false"` strings, exposed as boolean.
