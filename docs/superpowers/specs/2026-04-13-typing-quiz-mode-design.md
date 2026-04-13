# Typing Quiz Mode

## Context

Currently the trainer only offers flashcard-based review: the user sees a question, taps to reveal the answer, then self-evaluates with "Got it" / "Missed". This works well for recognition but doesn't train active recall (producing the word from memory). A typing mode where the user types the answer provides stronger learning reinforcement.

**Goal:** Add an alternative quiz mode where the user types the translation instead of flipping a card. Selectable in Settings. Tolerant matching for partial answers, article variations, and minor typos. Same Leitner progression as flashcard mode.

## New Setting: `quizMode`

- **Key:** `quizMode` in SQLite `settings` table
- **Values:** `"flashcard"` (default) | `"typing"`
- **UI:** New chip block in `app/settings.tsx`, placed between "Quiz Direction" and "Cards Per Round"
- **Label:** "Quiz Mode"
- **Chips:** "Flashcard" | "Typing"
- **Store:** New field `quizMode` in `useSettingsStore` (`hooks/useSettings.ts`)

## Answer Matching Module: `lib/matchAnswer.ts`

Pure local function — no network, no LLM. Must stay offline.

### Interface

```typescript
type MatchResult = {
  match: 'exact' | 'tolerant' | 'none';
  expected: string; // full expected answer for hint display
};

function matchAnswer(userInput: string, expected: string): MatchResult;
```

### Normalization (applied to both sides)

1. `trim()` + collapse multiple whitespace to single space
2. `toLowerCase()`
3. Unicode NFC normalization (so composed/decomposed accents match)

### Matching Rules (first match wins)

| # | Rule | Example | Result |
|---|------|---------|--------|
| 1 | Exact match after normalization | "der arzt" = "der Arzt" | `exact` |
| 2 | Input matches one comma-separated part | "beau" matches "beau, belle" | `tolerant` |
| 3 | Article tolerance: input without article matches expected without article | "Arzt" matches "der Arzt, die Ärztin" | `tolerant` |
| 4 | Levenshtein ≤1 on words ≥5 chars (per comma-part, after article stripping) | "medecin" matches "médecin" | `tolerant` |

### Article stripping

Remove leading articles for comparison: `le, la, l', les, der, die, das, ein, eine, el, los, las, un, una, il, lo, gli, le, o, a, os, as, um, uma, de, het, een, en, ett`.

### What is NOT tolerated

- Levenshtein >1
- Levenshtein on words <5 characters (too many false positives)
- Completely wrong words

### Hint display

- `exact` → "Correct!" (no hint needed)
- `tolerant` → "Correct! Complete form: {expected}"
- `none` → "Wrong — {expected}"

## TypingCard Component: `components/TypingCard.tsx`

### Props

```typescript
interface TypingCardProps {
  question: string;        // displayed question (original or translation)
  expectedAnswer: string;  // expected answer (the other side)
  wordType?: string;       // e.g. "noun", "verb", "adjective"
  level?: string;          // CEFR level e.g. "A2"
  onCorrect: () => void;
  onIncorrect: () => void;
  onDelete?: () => void;
}
```

### UI States (3 phases)

**Phase 1 — Input:**
- GlassCard container (same aesthetic as FlashCard)
- "Question" label + question text (large, centered)
- Word type + level subtitle (smaller, muted)
- Text input field with placeholder "Type your answer…"
- "Check" button (primary, disabled when input empty)
- "Give up" button (subtle/outline style, below Check)
- Delete button top-right (if `onDelete` provided)

**Phase 2 — Feedback:**
- Input becomes read-only
- Feedback box appears below input:
  - **Green** (`exact`/`tolerant`): "Correct!" + if tolerant: "Complete form: {expected}"
  - **Red** (`none`): "Wrong — {expected}"
- "Next →" button replaces Check/Give up

**Phase 3 — Transition:**
- "Next →" calls `onCorrect()` or `onIncorrect()`
- Parent advances to next card, TypingCard resets

### Interaction Details

- Enter key in input = press "Check"
- "Give up" → shows red feedback with solution → counts as `onIncorrect`
- `KeyboardAvoidingView` to keep input visible above keyboard
- Press animation on buttons (same scale effect as FlashCard)

### testIDs

`typing-card`, `typing-input`, `check-btn`, `give-up-btn`, `next-btn`, `feedback-box`

## Trainer Integration

### `app/(tabs)/index.tsx`

- Read `quizMode` from `useSettingsStore`
- When `quizMode === 'typing'`: render `<TypingCard>` instead of `<FlashCard>`
- Props mapping:
  - `question` = front (based on `roundDirection`)
  - `expectedAnswer` = back (the other side)
  - `wordType` = current vocab's `word_type`
  - `level` = current vocab's `level`
  - `onCorrect` / `onIncorrect` = existing `handleMark(true/false)`
  - `onDelete` = existing delete handler
- Everything else unchanged: progress bar, round complete, retry, practice mode

### `hooks/useTrainer.ts`

No changes needed. `markCorrect()` / `markIncorrect()` are called by TypingCard the same way FlashCard calls them. Leitner progression is identical.

### `hooks/useSettings.ts`

- Add `quizMode: string` to state (default: `'flashcard'`)
- Load/persist via existing `loadSettings()` / `updateSetting()` pattern

## Testing

### Unit Tests: `lib/matchAnswer.test.ts`

- Exact match (case-insensitive)
- Comma-part match ("beau" → "beau, belle")
- Article tolerance ("Arzt" → "der Arzt, die Ärztin")
- Levenshtein tolerance ("medecin" → "médecin")
- Levenshtein rejection on short words (<5 chars)
- Empty input → `none`
- Reflexive verbs ("se souvenir" exact)
- Combined: article strip + Levenshtein

### Architecture Tests: `lib/__tests__/architecture.test.ts`

- `matchAnswer.ts` must not import `fetch`, `callClaude`, `axios`, or any network module
- `quizMode` setting must only accept `flashcard` | `typing`

### E2E: `.maestro/09-typing-mode.yaml`

1. Open Settings → select "Typing" chip
2. Close Settings → Start Training
3. Type correct answer → Check → green feedback → Next
4. Type wrong answer → Check → red feedback with expected → Next
5. Give up → red feedback → Next
6. Round complete screen visible

## Verification

1. `npm test` — tsc + Jest (matchAnswer tests + architecture boundary tests pass)
2. Emulator: switch to typing mode in settings, complete a training round
3. Verify Leitner box progression identical in both modes
4. Verify offline: airplane mode, typing mode still works (no API calls)

## Files to Create

| File | Purpose |
|------|---------|
| `lib/matchAnswer.ts` | Answer matching logic |
| `lib/matchAnswer.test.ts` | Unit tests |
| `components/TypingCard.tsx` | Typing quiz UI component |
| `.maestro/09-typing-mode.yaml` | E2E test flow |

## Files to Modify

| File | Change |
|------|--------|
| `hooks/useSettings.ts` | Add `quizMode` field |
| `app/settings.tsx` | Add Quiz Mode chip block |
| `app/(tabs)/index.tsx` | Conditional render TypingCard vs FlashCard |
| `lib/__tests__/architecture.test.ts` | Add matchAnswer boundary + quizMode value tests |
| `CLAUDE.md` | Document new setting, component, testIDs |
