# Anyvoc – Project Memory

## App Overview
Vocabulary trainer (React Native / Expo) that extracts vocabulary from shared content via Claude API.
All data stored locally on device. No backend. Native Android build exists (`android/`).

## Tech Stack
- **Framework:** React Native 0.81 / Expo ~54, Expo Router ~6, TypeScript
- **Database:** expo-sqlite ~16, synchronous API only (`runSync`, `getFirstSync`, `getAllSync`)
- **State:** Zustand stores (`useSettingsStore`, `useTrainerStore`) + `useTheme` context
- **AI:** Claude API via `lib/claude.ts` — model `claude-haiku-4-5-20251001` (cost-optimised)
- **Security:** API key in `expo-secure-store` ONLY — never AsyncStorage, never logged, never extractable
- **Share:** expo-share-intent; web content parsed via Claude API (not Cheerio/regex)

## Project Structure
```
app/(tabs)/
  index.tsx          # Tab 2: Trainer (stats, flashcard session, streak)
  content.tsx        # Tab 1: Content list + add (text / image / link)
  vocabulary.tsx     # Tab 3: Full vocabulary list
app/content/[id].tsx # Content detail (3 tabs: original / translation / vocab)
app/settings.tsx     # Settings modal (gear icon top right)
components/
  FlashCard.tsx      # Flip card for trainer
  GlassCard.tsx      # Reusable glass-style card container
  HighlightedText.tsx# Text with yellow-highlighted vocab
  LearningMaturity.tsx # Leitner box distribution visual
  ReviewCalendar.tsx # Recent review days display
  SwipeToDelete.tsx  # Swipe gesture for list deletion
  VocabCard.tsx      # Single vocab row
lib/
  claude.ts          # All Claude API calls (callClaude is exported)
  database.ts        # All SQLite access (sync API)
  leitner.ts         # getCardsForReview, selectRound, getStreakDays,
                     # getBestStreak, getAveragePerDay
  shareHandler.ts    # Share intent processing
  urlExtractor.ts    # Web URL content extraction via Claude API
  uuid.ts            # generateUUID()
constants/
  languages.ts       # getLanguageName(code) + supported language list
  levels.ts          # CEFR levels A1–C2
  theme.ts           # ThemeColors, spacing, fontSize, borderRadius,
                     # glassStyle, marineShadow
hooks/
  useSettings.ts     # useSettingsStore (Zustand): nativeLanguage,
                     # learningLanguage, level, quizDirection,
                     # apiKeySet, getApiKey()
  useTheme.ts        # useTheme() → { colors }
  useTrainer.ts      # useTrainerStore (Zustand): full session state
  useVocabulary.ts   # Vocabulary CRUD helpers
```

## Database Schema
```sql
settings     (key PK, value)
contents     (id PK, title, original_text, translated_text, source_type,
              source_url, created_at)
vocabulary   (id PK, content_id FK→contents ON DELETE CASCADE,
              original, translation, level, word_type, source_forms TEXT/JSON,
              leitner_box DEFAULT 1, last_reviewed, correct_count,
              incorrect_count, created_at)
review_days  (day PK)  -- 'YYYY-MM-DD', written by recordReviewDay()
                       -- on every updateVocabularyReview() call
```
- `source_forms`: JSON array of inflected forms e.g. `'["rivais"]'`
- Migration pattern: `try { db.runSync('ALTER TABLE...') } catch { /* ignore */ }`
- `clearAllData()` deletes all 4 tables including `review_days`
- `insertVocabulary()` silently skips duplicates via `vocabularyExists()`

## Claude API (lib/claude.ts)
- `callClaude()` is **exported** — use it directly for custom prompts
- Model: `claude-haiku-4-5-20251001` — do NOT switch to Sonnet/Opus (cost)
- Long texts chunked at 15 000 chars via `chunkText()`
- Always strip markdown fences before parsing: `responseText.match(/\[[\s\S]*\]/)`
- Error handling: catch `ClaudeAPIError` separately (401 = bad key, 429 = rate limit)
- Web/URL content: extracted via `lib/urlExtractor.ts` using Claude API — NOT Cheerio or regex

## Vocabulary Formatting Rules (system prompt)
- **Nouns:** direct article + singular; feminine form after comma if exists
  `"le médecin, la médecin"` / `"der Arzt, die Ärztin"`
  Proper nouns (Eigennamen) are ignored.
  Lowercase in all languages except German (even if capitalised in source text).
  Hyphens from line breaks are removed (e.g. "Wort-\ntrennung" → "Worttrennung").
- **Verbs:** infinitive; reflexive with pronoun: `"se souvenir"`, `"sich erinnern"`, `"acordar-se"`
- **Adjectives:** m + f if different: `"beau, belle"` / `"petit, petite"`
- `translateSingleWord()` now also returns `original` (formatted base form), not just translation

## Leitner System
- 5 boxes; new vocab → Box 1; correct → box+1 (max 5); incorrect → Box 1
- Intervals: Box 1=daily, 2=every 2d, 3=every 4d, 4=every 8d, 5=every 16d
- Session: 20 cards via `selectRound()`; missed cards retried once at end
- `updateVocabularyReview()` always calls `recordReviewDay()` — never call separately

## Styling Conventions
- `createStyles(colors: ThemeColors)` pattern — always memoize with `useMemo`
- Use ONLY `colors`, `spacing`, `fontSize`, `borderRadius`, `glassStyle`, `marineShadow`
  from `constants/theme.ts` — never hardcode color values
- Glass cards: use `GlassCard` component or spread `glassStyle` from theme

## Settings Keys (SQLite settings table)
- `nativeLanguage`, `learningLanguage` → language codes
- `level` → CEFR minimum level string e.g. `"B1"` (extract this level and above only)
- `quizDirection` → `"original"` | `"translation"` | `"random"`
- API key: `expo-secure-store` only, never in settings table

## Known Issues / Watch Out
- **Image picker on iOS:** ALWAYS add 500ms delay before `launchImageLibraryAsync`
  to allow modal to fully close — skipping this causes a silent no-op with no error
- **API key:** must never appear in logs, error messages, or state — always retrieve
  via `getApiKey()` immediately before use, never store in component state
