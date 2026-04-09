# Anyvoc – Project Memory

## App Overview
Vocabulary trainer (React Native / Expo) that extracts vocabulary from shared content via Claude API.
All user data stored locally on device. The only backend is a thin Anthropic proxy (`https://anyvoc-backend.fly.dev/api/chat`) that holds the API key — no user data or accounts. Expo managed workflow (no committed `android/` or `ios/` folders).

**Local dev caveat:** Running `npx expo run:android` (or `run:ios`) generates a local `android/` (or `ios/`) folder as a build cache. This is gitignored and does NOT change the workflow from Repo/EAS perspective — managed workflow stays intact. BUT: after any change to `app.json` plugins or after `expo install <native-module>`, you MUST run `npx expo prebuild --clean` followed by `npx expo run:android` again, otherwise plugin/native changes won't be picked up by the cached native build. JS-only changes need no rebuild — Metro reload is enough.

## Tech Stack
- **Framework:** React Native 0.81 / Expo ~54, Expo Router ~6, TypeScript
- **Database:** expo-sqlite ~16, synchronous API only (`runSync`, `getFirstSync`, `getAllSync`)
- **State:** Zustand stores (`useSettingsStore`, `useTrainerStore`) + `useTheme` context
- **AI:** Claude API via backend proxy at `https://anyvoc-backend.fly.dev/api/chat` (called from `lib/claude.ts`) — model `claude-haiku-4-5-20251001` (cost-optimised)
- **Security:** No API key ships with the app. The Anthropic key lives only on the backend proxy; the client sends no `Authorization` header. Do NOT reintroduce a client-side API key (no `expo-secure-store`, no settings field, no env var bundled into the app).
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
  classifier/        # Local CEFR classifier (see section below)
    features.ts      # Zipf + AoA lookup, normalisation, fallback
    score.ts         # Ordinal-logit weights + cut points (deployed model)
    cognates.ts      # Cognate adjustment (NLD placeholder, TODO)
    cache.ts         # Map + expo-sqlite fallback_cache (30d TTL)
    fallback.ts      # Confidence + Claude fallback + rate limit
    index.ts         # classifyWord, classifyWordWithConfidence
  data/              # Bundled static assets for the classifier
    freq_{lang}.json # Leipzig frequency tables, 12 languages
    aoa_{lang}.json  # AoA data (en: Kuperman, 11 others: LLM-generated)
constants/
  languages.ts       # getLanguageName(code) + supported language list
  levels.ts          # CEFR levels A1–C2
  theme.ts           # ThemeColors, spacing, fontSize, borderRadius,
                     # glassStyle, marineShadow
hooks/
  useSettings.ts     # useSettingsStore (Zustand): nativeLanguage,
                     # learningLanguage, level, quizDirection, cardsPerRound
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

## CEFR Classifier (lib/classifier/)
CEFR levels (A1–C2) are assigned **locally and deterministically**, not by the LLM.
The level field returned by `extractVocabulary` / `translateSingleWord` in the
LLM response is **overwritten** by `classifyWord(word, languageCode)`.

**Model:** Ordinal-logit over two features, calibrated on ~84 700 gold rows
across all 12 languages. Formula:
```
η       = W_ZIPF * zipfNorm + W_AOA * aoaNorm
level   = first k where η < THETA[k], else C2
```
Constants live in `lib/classifier/score.ts` (copied verbatim from
`tmp/gold/model.json`). **Don't edit them by hand** — they come from the
calibration pipeline.

**Features:** `zipfNorm` (from Leipzig frequency, higher = more frequent) and
`aoaNorm` (age-of-acquisition, higher = later). Both normalised to [0, 1].
When both features fall back, `aoaNorm` is set to 0.4 (B2|C1 neutral default)
instead of 1 (the old C2 trap).

**Fallback path:** `computeConfidence()` in `fallback.ts` only calls Claude
Haiku when *both* features missed (`fallbackCount == 2`). Rate-limited to
10 calls / 60 s. Results are cached in-memory + `expo-sqlite` (`fallback_cache`
table, 30-day TTL). Normal words never touch the network.

**Supported languages:** en, de, fr, es, it, pt, nl, sv, no, da, pl, cs —
must stay in sync with `constants/languages.ts`.

**Hard rule:** nothing under `lib/` may import `axios`, `tar`, `node:fs`,
`node:path`, `node:https`, `better-sqlite3`, or any Node-only API. Those
live exclusively in `scripts/` and are devDependencies only. Frequency/AoA
JSONs are loaded via explicit `switch (lang) { case 'en': return require(...) }`
(never template strings — Metro's static resolver needs literal paths).

### Calibration pipeline (dev-machine only, NEVER in EAS build hooks)
```bash
npm run build:freq          # Leipzig corpora → lib/data/freq_*.json
npm run build:aoa-llm -- --lang=de   # per-lang LLM-generated AoA
npm run build:gold          # parses KELLY/CEFRLex/Goethe/Aspekte/Oxford
npm run build:gold-llm -- --lang=pt  # LLM-oracle for pt/da/cs/no/pl
npx tsx scripts/export-features.ts   # joins with extractFeatures()
python scripts/calibrate-model.py    # fits ordinal logit → model.json
# Then manually copy W_ZIPF/W_AOA/THETA_* into BOTH:
#   - lib/classifier/score.ts   (runtime)
#   - scripts/validate-gold-all.ts  (eval script — keep in sync!)
npx tsx scripts/validate-gold-all.ts  # per-lang sanity check
npm run test:classifier               # 26 Jest tests must pass
```
`tmp/` is gitignored (raw gold sources aren't redistributable under
CC BY-NC-SA). Generated `lib/data/*.json` are committed (compatible with
`eas.json` `requireCommit: true`).

### Empirical performance
On independent reference-gold (7 languages): **29.2 % exact / 68.4 % ±1 / MAE 1.18** —
statistically on par with Claude Haiku 4.5 on the same words, but
deterministic, offline, zero-cost, sub-millisecond. The remaining accuracy
gap is a **data limit**, not a model limit (gold sources have inherent noise).
See `BENCHMARK-REPORT.md` context in conversation history for details.

## Claude API (lib/claude.ts)
- All requests go through the backend proxy at `https://anyvoc-backend.fly.dev/api/chat`. The client never holds the Anthropic key.
- `callClaude()` is **exported** — use it directly for custom prompts
- Model: `claude-haiku-4-5-20251001` — do NOT switch to Sonnet/Opus (cost)
- Long texts chunked at 15 000 chars via `chunkText()`
- Always strip markdown fences before parsing: `responseText.match(/\[[\s\S]*\]/)`
- Error handling: catch `ClaudeAPIError` separately (401 = proxy auth error, 429 = rate limit)
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
- `quizDirection` → `"native-to-learning"` | `"learning-to-native"` | `"random"`
- `cardsPerRound` → number of cards per trainer session (default `"20"`)
- No API key is stored anywhere on device — the backend proxy holds it.

## Known Issues / Watch Out
- **Image picker on iOS:** ALWAYS add 500ms delay before `launchImageLibraryAsync`
  to allow modal to fully close — skipping this causes a silent no-op with no error
- **API key:** the app must never hold an Anthropic key. All Claude calls go through the backend proxy. Do not add client-side key storage, env vars, or `Authorization` headers.
