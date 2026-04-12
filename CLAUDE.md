# Anyvoc – Project Memory

## App Overview
Vocabulary trainer (React Native / Expo) that extracts vocabulary from shared content via Mistral API.
All user data stored locally on device. The only backend is a thin Mistral proxy (`https://anyvoc-backend.fly.dev/api/chat`) that holds the API key — no user data or accounts. Expo managed workflow (no committed `android/` or `ios/` folders).

**Local dev caveat:** Running `npx expo run:android` (or `run:ios`) generates a local `android/` (or `ios/`) folder as a build cache. This is gitignored and does NOT change the workflow from Repo/EAS perspective — managed workflow stays intact. BUT: after any change to `app.json` plugins or after `expo install <native-module>`, you MUST run `npx expo prebuild --clean` followed by `npx expo run:android` again, otherwise plugin/native changes won't be picked up by the cached native build. JS-only changes need no rebuild — Metro reload is enough.

## Tech Stack
- **Framework:** React Native 0.81 / Expo ~54, Expo Router ~6, TypeScript
- **Database:** expo-sqlite ~16, synchronous API only (`runSync`, `getFirstSync`, `getAllSync`)
- **State:** Zustand stores (`useSettingsStore`, `useTrainerStore`) + `useTheme` context
- **AI:** Mistral API via backend proxy at `https://anyvoc-backend.fly.dev/api/chat` (called from `lib/claude.ts`) — model `mistral-small-2506` (cost-optimised). The proxy accepts Claude-format requests and transforms them to Mistral format, enabling provider switches without app updates.
- **OCR:** On-device text recognition via `expo-mlkit-ocr` (Google ML Kit, offline, zero API cost)
- **Security:** No API key ships with the app. The Mistral key lives only on the backend proxy; the client sends no `Authorization` header. Do NOT reintroduce a client-side API key (no `expo-secure-store`, no settings field, no env var bundled into the app).
- **Local NLP:** `franc-min` (offline language detection), `@mozilla/readability` + `linkedom` (offline article extraction from HTML)
- **Share:** expo-share-intent; web content extracted via Readability (Claude API fallback for edge cases)

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
backend/
  server.js          # Express proxy: accepts Claude-format requests, transforms
                     # to Mistral API format, returns Claude-format responses.
                     # Deployed on Fly.dev. MISTRAL_API_KEY is a Fly secret.
  Dockerfile         # Container build for Fly.dev deployment
  fly.toml           # Fly.dev app config (region: cdg, auto-stop machines)
  package.json       # Dependencies: express, cors (no SDK — uses plain fetch)
lib/
  claude.ts          # LLM API calls (callClaude exported) + detectLanguage (offline via franc-min)
  ocr.ts             # On-device OCR via @infinitered/react-native-mlkit-text-recognition
  database.ts        # All SQLite access (sync API)
  leitner.ts         # getCardsForReview, selectRound, getStreakDays,
                     # getBestStreak, getAveragePerDay
  shareHandler.ts    # Share intent processing
  urlExtractor.ts    # Web URL content extraction via Readability (Claude fallback)
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
npm test                              # tsc + all Jest tests must pass
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

## LLM API (lib/claude.ts)
- All requests go through the backend proxy at `https://anyvoc-backend.fly.dev/api/chat`. The client never holds the API key.
- The client sends Claude-format requests; the backend proxy transforms them to Mistral API format. This enables provider switches without app updates.
- `callClaude()` is **exported** — use it directly for custom prompts (name kept for compatibility)
- Model: `mistral-small-2506` — cost-optimised small model
- Long texts chunked at 15 000 chars via `chunkText()`
- Always strip markdown fences before parsing: `responseText.match(/\[[\s\S]*\]/)`
- Error handling: catch `ClaudeAPIError` separately (401 = proxy auth error, 429 = rate limit)
- `detectLanguage()` is **offline** (uses `franc-min` trigram detection, synchronous). Returns `string | null` — `null` means undetermined/unsupported. No API call.
- Web/URL content: extracted via `lib/urlExtractor.ts` using `@mozilla/readability` + `linkedom` (offline). Falls back to LLM API only when Readability yields <100 chars (e.g. SPAs, login pages).
- **OCR:** On-device via `expo-mlkit-ocr` (Google ML Kit) — no API call for image text extraction.

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

## Development Workflow (Claude Code)

### Agentic loop — how Claude Code operates on this project
Claude Code reads `CLAUDE.md` on every session start and uses it as the single source of truth for architecture decisions. It can read/write all source files, run shell commands, and read log output. It cannot observe the running app directly — logs are the only runtime signal.

**Two-terminal setup (Windows PowerShell):**
```powershell
# Terminal 1 — keep running throughout dev session
npx expo run:android 2>&1 | Tee-Object -FilePath expo.log

# Terminal 2 — Claude Code session
claude
```
`expo.log` is the bridge: Claude Code reads it after every change to verify Metro compiled cleanly and no runtime errors appeared.

### When to use which start command
| Situation | Command |
|-----------|---------|
| JS-only change (components, hooks, lib/) | `npx expo start` — Metro hot reload, no rebuild |
| First run after clone | `npx expo run:android` — builds native shell |
| After `expo install <native-module>` or `app.json` plugin change | `npx expo prebuild --clean && npx expo run:android` |
| Release / store build | `eas build --profile production --platform android` |
| Quick preview APK (no store) | `eas build --profile preview --platform android` |

### Effective prompts for Claude Code
Claude Code works best when given a goal + a verification step. Examples:

```
"Read expo.log, identify the current error, fix it, then confirm
 the relevant file compiles without TypeScript errors."

"Add a progress-bar component to the trainer session screen.
 Follow the GlassCard + createStyles(colors) pattern from existing components.
 After writing, check expo.log for Metro errors."

"Refactor lib/leitner.ts so selectRound() accepts an optional
 maxCards parameter (default 20). Keep all existing call sites working.
 Run: npx tsc --noEmit and show me the output."
```

Key pattern: **task → constraint → verify**. Claude Code will run `npx tsc --noEmit` or read `expo.log` on its own if instructed; it will not auto-start the dev server.

### Testing

| Command | What runs | Requires emulator |
|---------|-----------|-------------------|
| `npm test` | `tsc --noEmit` + `jest` (all unit/integration tests) | No |
| `npm run test:all` | `tsc --noEmit` + `jest` + `maestro` E2E flows | Yes |
| `npm run test:e2e` | Maestro E2E flows only | Yes |
| `npm run test:e2e:single -- .maestro/01-app-launches.yaml` | Single Maestro flow | Yes |

`npm test` is the fast, always-runnable gate — run it after every change.
`npm run test:all` is the full pipeline including E2E (needs emulator + Metro).

**Test suites (Jest):**
| Suite | File | Tests | Mocking |
|-------|------|-------|---------|
| Leitner logic | `lib/leitner.test.ts` | 34 | Pure functions, no mocks |
| Database layer | `lib/database.test.ts` | 26 | `better-sqlite3` in-memory |
| Claude API | `lib/claude.test.ts` | 27 | `global.fetch` + mocked classifier |
| CEFR classifier | `lib/classifier/classifier.test.ts` | 26 | Mocked Claude fallback |
| Language detection | `lib/detectLanguage.test.ts` | 7 | No mocks (franc-min is deterministic) |
| URL extraction | `lib/urlExtractor.test.ts` | 5 | `global.fetch` + mocked `callClaude` |
| Build scripts | `scripts/build-freq.test.ts` | — | — |

**TypeScript check only:**
```bash
npx tsc --noEmit
npx tsc --noEmit --isolatedModules app/content/\[id\].tsx
```

### Claude Code autonomous debug & test workflow
When the user asks Claude Code to start the emulator and dev server for testing,
run the following sequence. This was validated to fix the "black screen" problem
caused by stale processes and the Expo Dev Client not auto-connecting to Metro.

**Option A — full rebuild (after native changes / first run):**
```powershell
# 1. Clean slate — kill emulator and free Metro port
adb emu kill
npx kill-port 8081

# 2. Start emulator (full path required — not on PATH)
#    Use -no-snapshot-load for a clean boot.
"$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Pixel_9 -no-snapshot-load
#    (run in background, then wait)
adb wait-for-device          # blocks until device is online
adb devices                  # verify "emulator-5554  device"

# 3. Build native shell + start Metro + install APK
cd D:\dev\Claude-React\Anyvoc
npx expo run:android 2>&1 | Tee-Object -FilePath expo.log
#    (run in background, wait ~90s for BUILD SUCCESSFUL + "Bundled …ms")

# 4. Force-connect Dev Client to Metro (emulator localhost = 10.0.2.2)
#    npx expo run:android sends localhost:8081, which the emulator
#    can't resolve. The deep-link with 10.0.2.2 fixes this.
adb shell am start -a android.intent.action.VIEW `
  -d "exp+anyvoc://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081" `
  com.anonymous.Anyvoc

# 5. Verify
adb shell dumpsys activity top | grep "ACTIVITY"
#    → expect: com.anonymous.Anyvoc/.MainActivity  mResumed=true
```

**Option B — JS-only changes (faster, no rebuild):**
Use when the native shell (APK) is already installed and only JS/TS code changed.
```powershell
# 1. Free Metro port if stale
npx kill-port 8081

# 2. Start Metro only (no Gradle build)
cd D:\dev\Claude-React\Anyvoc
npx expo start --android 2>&1 | Tee-Object -FilePath expo.log
#    (run in background, wait ~20s)

# 3. Reverse-forward port so emulator reaches host's Metro
adb reverse tcp:8081 tcp:8081

# 4. Connect Dev Client to Metro
adb shell am force-stop com.anonymous.Anyvoc
adb shell am start -a android.intent.action.VIEW `
  -d "exp+anyvoc://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081" `
  com.anonymous.Anyvoc

# 5. Verify
adb shell dumpsys activity top | grep "ACTIVITY"
#    → expect: com.anonymous.Anyvoc/.MainActivity  mResumed=true
```

**Log-based debugging after startup:**
```bash
# expo.log — Metro bundle results + JS console output
cat expo.log | tail -20
grep -iE "error|warn|WARN" expo.log | tail -20

# adb logcat — native + JS runtime errors
adb logcat -d -t 100 -s "ReactNativeJS:*"          # JS errors only
adb logcat -d -t 200 | grep -iE "anyvoc|FATAL"     # crashes
adb logcat -c                                        # clear before repro
```

### What Claude Code must NOT do in this project
- Start or restart the Expo dev server autonomously **unless the user explicitly asks** (see "autonomous debug & test workflow" above)
- Edit anything under `tmp/` or `lib/data/` — those are pipeline outputs
- Modify `lib/classifier/score.ts` constants by hand (calibration pipeline only)
- Add any form of API key to client code (see Security in Tech Stack)
- Switch the LLM model without updating both `lib/claude.ts` (MODEL constant) and `backend/server.js` (MISTRAL_MODEL constant)
- Use `android/` or `ios/` folder paths — managed workflow, those folders are gitignored build caches

### Reading logs efficiently
`expo.log` is append-only during a session. Relevant patterns to grep for:
```bash
# Metro bundle errors
Select-String -Path expo.log -Pattern "error|Error|WARN|warn" | Select-Object -Last 20

# TypeScript / module resolution errors
Select-String -Path expo.log -Pattern "TS\d{4}|Cannot find module" | Select-Object -Last 10

# Successful reload confirmation
Select-String -Path expo.log -Pattern "Bundling complete|bundle compiled"
```

## E2E Testing (Maestro 2.x)
Maestro is installed at `~/.maestro/bin/maestro` (requires Java 17+, provided by
Android Studio JBR). Flow files live in `.maestro/*.yaml`.

**Prerequisites:** Java must be on PATH for maestro to work:
```bash
export PATH="$HOME/.maestro/bin:/c/Program Files/Android/Android Studio/jbr/bin:$PATH"
```

**Running E2E tests:**
```bash
npm run test:e2e                                          # all flows
npm run test:e2e:single -- .maestro/01-app-launches.yaml  # single flow
npm run test:all                                          # tsc + jest + maestro
```

**Requires:** Emulator running + Metro bundler active + App connected (see
"autonomous debug & test workflow" above). Maestro launches the app itself via
`launchApp` — no manual start needed once Metro is serving.

**Flow files:**
| File | What it tests |
|------|---------------|
| `01-app-launches.yaml` | App starts, all 3 tabs visible |
| `02-tab-navigation.yaml` | Tap each tab, verify screen via testID |
| `03-trainer-session.yaml` | Start training, answer cards, round complete |
| `04-add-text-content.yaml` | Add menu → Enter Text → fill form → save |
| `05-vocabulary-search.yaml` | Search input, sort chips (Date/A–Z/Level) |
| `06-settings.yaml` | Open settings, change level/direction/cards, language picker, close |
| `07-content-detail.yaml` | Add content, open detail, switch Original/Translation/Vocabulary tabs |
| `08-error-states.yaml` | Empty states (trainer/vocab/content), disabled save button |

**Adding testIDs:** New interactive elements must have a `testID` prop for
Maestro to find them. Convention: `kebab-case`, e.g. `testID="start-training-btn"`.
Existing testIDs: `trainer-screen`, `content-screen`, `vocabulary-screen`,
`flashcard`, `correct-btn`, `incorrect-btn`, `start-training-btn`,
`continue-training-btn`, `end-session-btn`, `round-complete-text`,
`content-list`, `menu-enter-text`, `menu-choose-image`, `menu-add-link`,
`title-input`, `text-input`, `save-text-btn`, `vocab-search-input`, `vocab-list`,
`settings-btn`, `settings-close-btn`, `native-language-btn`, `learning-language-btn`,
`reset-app-btn`, `content-tab-original`, `content-tab-translation`, `content-tab-vocabulary`.

## Known Issues / Watch Out
- **Image picker on iOS:** ALWAYS add 500ms delay before `launchImageLibraryAsync`
  to allow modal to fully close — skipping this causes a silent no-op with no error
- **API key:** the app must never hold an Anthropic key. All Claude calls go through the backend proxy. Do not add client-side key storage, env vars, or `Authorization` headers.
- **expo.log on Windows:** `Tee-Object` requires PowerShell (not CMD). If the file stays empty, check that the terminal is PowerShell 5+ and that `npx` resolves correctly (`where.exe npx`).
- **Android emulator + Metro port conflict:** if Metro fails to start on port 8081, kill the stale process with `npx kill-port 8081` before restarting.
