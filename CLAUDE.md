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
  ConfirmDialog.tsx  # Themed confirmation modal (replaces Alert.alert on Android)
  FlashCard.tsx      # Flip card for trainer (flashcard mode)
  TypingCard.tsx     # Type-answer card for trainer (typing mode)
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
  matchAnswer.ts     # Local answer matching for typing quiz (offline, no LLM)
  shareHandler.ts    # Share intent processing
  urlExtractor.ts    # Web URL content extraction via Readability + cleanArticleHtml (Claude fallback)
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
Haiku when _both_ features missed (`fallbackCount == 2`). Rate-limited to
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
- Web/URL content: extracted via `lib/urlExtractor.ts` using `@mozilla/readability` + `linkedom` (offline). Readability's HTML output (`article.content`) is post-processed by `cleanArticleHtml()` which removes infobox tables, figure captions, SVG icon labels, footnote refs, breadcrumbs, duplicate leads, trailing metadata, and repeated phrases via DOM manipulation + text heuristics. Falls back to LLM API only when Readability yields <100 chars of cleaned text AND the raw HTML has >200 chars of visible text (text density check). JS-rendered pages (Reddit, BuzzFeed) with <200 chars of raw text are rejected immediately without an API call.
- **OCR:** On-device via `expo-mlkit-ocr` (Google ML Kit) — no API call for image text extraction.

## Vocabulary post-processing (lib/vocabFilters.ts)

After the LLM extracts vocabulary, every entry passes through
`postProcessExtractedVocab(items, learningLangCode, nativeLangCode)` in
`lib/vocabFilters.ts` before classification + insertion. The module is
pure (no I/O, no DB, no expo-\*, no fetch) so unit tests stay fast and
the batch-classification scripts can reuse it.

Three responsibilities:

1. **`isAbbreviation(original)`** — drops all-uppercase tokens of 2+
   characters (`GNR`, `DLRG`, `IRS`, `EU`, `B2B`). Acronyms slip past
   the LLM with surprising frequency; this is a safety net.
2. **`isLikelyProperNoun(original, learningLangCode)`** — drops
   single-word entries whose base form (after stripping articles via
   `STRIP_PREFIX`) starts with an uppercase letter, in non-German
   learning languages. German is excluded because every common noun is
   capitalised; for German we rely on the LLM prompt's "ignore proper
   nouns" rule.
3. **`capitaliseGermanNouns(translation, type)`** — when the user's
   native language is German and the entry is a noun, capitalises the
   noun part of the translation while preserving the article
   (`"der hund" → "der Hund"`, `"die ärztin" → "die Ärztin"`,
   multi-form supported).

The single integration point `postProcessExtractedVocab` is called from
both `extractVocabulary()` and `translateSingleWord()` in `lib/claude.ts`.

The view layer additionally hides vocabulary below the user's CEFR
minimum via `isAtOrAboveLevel()` from `constants/levels.ts`. Storage is
untouched — lowering the level immediately brings hidden rows back.
Applied in `app/(tabs)/vocabulary.tsx`, `app/(tabs)/index.tsx`, and
`app/content/[id].tsx`.

Architecture rule 20 (level filter), rule 21 (post-processor wired in
both LLM paths), and rule 22 (vocabFilters stays pure) enforce these
invariants computationally.

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

## Settings navigation

`app/settings.tsx` and any future multi-level settings screen renders **exactly
one** Back affordance: the header Back button. Sub-menus (language picker, and
any future sub-screen) must not render their own `← Back` control. The header's
`onPress` handler is state-aware — it pops sub-menu state first (e.g.
`setShowLanguagePicker(null)`) and only falls through to `router.back()` when
already on the root of the Settings screen.

**Why:** two stacked Back controls are ambiguous and noisy. The user's mental
model is "Back goes up one level", which works uniformly across nesting depth
when there is a single entry point. New sub-screens get this behavior for free
by adding their state branch to the same handler.

**How to apply:** when adding a new sub-screen inside Settings, (a) gate it on a
piece of state, (b) extend the `handleBack` handler to clear that state first,
and (c) do not add any inline `← Back` button to the sub-screen body.
Architecture test **Rule 30** enforces both the single-label invariant and the
state-aware handler structure.

## Settings Keys (SQLite settings table)

- `nativeLanguage`, `learningLanguage` → language codes
- `level` → CEFR minimum level string e.g. `"B1"` (extract this level and above only)
- `quizDirection` → `"native-to-learning"` | `"learning-to-native"` | `"random"`
- `quizMode` → `"flashcard"` | `"typing"` (default: `"flashcard"`)
- `cardsPerRound` → number of cards per trainer session (default `"20"`)
- `onboarding_seen` → `"true"` once the user has passed the welcome screen (either via Sign in or Continue as guest). Absent on fresh installs; silently set to `"true"` by the grandfathering migration for installs with pre-existing contents/vocabulary.
- `auth_user_id` → Supabase user UUID written after successful sign-in. Offline reference for later Pro-entitlement checks.
- No API key is stored anywhere on device — the backend proxy holds it.

## Authentication (Supabase)

Anyvoc uses Supabase Auth (EU/Frankfurt region) for optional sign-in. The app follows a **hybrid gate**: fresh installs see a welcome screen with _Sign in_ + _Continue as guest_; existing installs are silently grandfathered past it (see `lib/database.ts` `hasExistingData`). Pro features will trigger the login flow later — the auth layer here is identity-only, no cloud sync of vocabulary.

### Providers

- **Email OTP** (6-digit) — default, no passwords. Supabase template `Confirm signup` and `Magic Link` must include `{{ .Token }}` so the code appears in the email; the dashboard ships only links by default.
- **Google** via `@react-native-google-signin/google-signin` — **Android-only. Permanent architectural decision, not a "not yet".** See ADR below.
- **Apple** via `expo-apple-authentication` — iOS-only (button is hidden on Android per App-Store-Review requirement). Flow: identityToken → `signInWithIdToken({ provider: 'apple' })`.

### Key files

- `lib/auth.ts` — Supabase client with SecureStore adapter; wrappers for every auth op.
- `lib/authStore.ts` — Zustand store; `restoreSession()` on boot + `onAuthStateChange` subscription.
- `lib/googleSignIn.ts` / `lib/appleSignIn.ts` — thin provider wrappers.
- `app/auth/{welcome,login,verify}.tsx` — UI screens.
- `app/_layout.tsx` — gate logic (redirect to `/auth/welcome` when `!onboarding_seen && !isAuthed`).
- `supabase/functions/delete-account/index.ts` — Deno Edge Function, `auth.admin.deleteUser(user.id)`. Deploy via Supabase Dashboard UI; **must run with "Verify JWT" OFF** at the gateway (we validate inside the function).

### Hard rules

1. **`SUPABASE_ANON_KEY`** is public and lives in `app.json.extra`. It is not a secret — access control is enforced by Supabase RLS, not by hiding the key. Rule 3 of `lib/__tests__/architecture.test.ts` allowlists `lib/auth.ts` for `expo-secure-store`.
2. **`SUPABASE_SERVICE_ROLE_KEY` never appears in client code**, in any form. It lives only as a Supabase secret inside the `delete-account` Edge Function. Architecture test **Rule 11** enforces this in `lib/`, `app/`, `components/`, `hooks/`, `constants/`.
3. **Session tokens** (access + refresh) are persisted via `expo-secure-store`, never `@react-native-async-storage/async-storage` (which is unencrypted on Android). Architecture test **Rule 12** enforces this in `lib/auth.ts`.
4. **All UI strings in English** across `app/auth/*.tsx` and all future features — project-wide convention. Architecture test **Rule 13** catches German umlauts/keywords in string literals.
5. **Reset App signs the user out** (in `app/settings.tsx` `confirmReset`). `resetApp()` itself stays auth-agnostic; the settings handler composes `signOut` + `clearAuth` + `resetApp` so a reset user lands back on the welcome screen after reload.
6. **Supabase project config requires**: Email template contains `{{ .Token }}`; Email OTP length = 6; `Confirm email` OFF; Custom SMTP (Resend or similar) configured — the built-in SMTP caps at 4 emails/h which breaks dev loops quickly.
7. **No imports from `supabase/functions/` in client code** — Edge Function code is Deno, not React Native, and bundling it would crash at load. Architecture test **Rule 14** enforces this.
8. **Native provider SDKs only in their wrapper files** — `@react-native-google-signin/google-signin` lives only in `lib/googleSignIn.ts`, `expo-apple-authentication` only in `lib/appleSignIn.ts`. Screens/components consume the wrappers' exported helpers. Keeps provider swaps single-file and test mocks centralised. Architecture test **Rule 15** enforces this.
9. **`react-native.config.js` disables iOS autolinking for `@react-native-google-signin/google-signin`** — the native iOS SDK conflicts with MLKit's transitive Google utilities (GTMSessionFetcher / GoogleUtilities version mismatch). Losing this config would reintroduce the pod conflict on the next EAS iOS build. Architecture test **Rule 16** enforces both the file's presence and the `ios: null` key. **Note:** this rule alone is necessary but NOT sufficient — Expo module autolinking (Rule 18) runs in parallel and must also agree.
10. **`.easignore` lists `/ios`** — forces EAS to prebuild the iOS folder from scratch every build, guaranteeing `app.json` plugin changes reach the iOS Podfile. Without this, expo-doctor flags the project as mixed-CNG and plugin sync becomes unreliable. Architecture test **Rule 17** enforces this.
11. **`package.json` has `expo.autolinking.ios.exclude` containing `@react-native-google-signin/google-signin`** — the package ships an Expo module adapter (`ExpoAdapterGoogleSignIn.podspec`) that Expo autolinking bundles independently of RN autolinking. This is the second half of the iOS exclusion (first half: react-native.config.js, Rule 16). Without both, pod resolution fails on iOS. Architecture test **Rule 18** enforces this.
12. **`lib/googleSignIn.ios.ts` is a google-signin-free stub** that Metro substitutes for `lib/googleSignIn.android.ts` on iOS via platform-suffix module resolution. It mirrors the Android implementation's public surface but has zero imports from `@react-native-google-signin/google-signin`. Necessary because the library calls `TurboModuleRegistry.getEnforcing('RNGoogleSignin')` at module load — runtime Platform guards inside the wrapper are too late. Architecture test **Rule 19** enforces the file's existence and the absence of the forbidden import. **This is not a temporary state — see the "Google Sign-In is Android-only" ADR below.**
13. **Post-sign-in navigation goes through `lib/authNavigation.ts`'s `navigateAfterSignIn(router, ctx)` helper.** Both `app/auth/login.tsx` (Apple + Google) and `app/auth/verify.tsx` (email OTP) must use it instead of calling `router.replace('/(tabs)')` directly. Two flows are supported:

    **Settings flow** — user tapped "Sign in" inside the Settings modal. `app/settings.tsx` pushes `/auth/login` with `params: { from: 'settings' }`; `login.tsx` forwards the `from` param when pushing `/auth/verify`. On success the helper receives `ctx.from === 'settings'` and calls `router.dismiss(ctx.authDepth)` — one native op that pops just the auth screens off the top of the stack. The Settings modal remains mounted beneath, so the user resumes exactly where they left off (e.g. to toggle Pro Mode). `authDepth` is 1 for `login.tsx` (pop login) and 2 for `verify.tsx` (pop verify + login).

    **Welcome / fresh-install flow** — user arrived via `/auth/welcome`. `ctx.from` is undefined, so the helper lands on the main tabs. On iOS it calls `router.dismissAll()` before `router.replace('/(tabs)')` — a plain `replace` alone only swaps the top screen, so any lingering modal in the stack would show on top of the new tabs (the ghost-modal bug). On Android it skips `dismissAll()` and uses `replace` only: `dismissAll()` + `replace()` in the same tick from the settings-flow stack crashes Fabric with `java.lang.IllegalStateException: addViewAt: failed to insert view` / `child already has a parent` — two stack mutations confuse the view recycler. The single `dismiss(n)` in the Settings flow is one op and is safe on both platforms.

    Architecture test **Rule 31** enforces: (a) both auth screens import the helper and never call `router.replace('/(tabs)')` directly, (b) `app/settings.tsx` passes `from: 'settings'` when pushing `/auth/login`, (c) `authNavigation.ts` still guards its `dismissAll` with `Platform.OS === 'ios'`, and (d) `dismissAll` still precedes `replace` inside the helper.

### ADR: Google Sign-In is Android-only — permanent

**Status:** accepted · **Date:** 2026-04 · **Supersedes:** the "exit paths" language in prior revisions of this section.

**Context.** `@react-native-google-signin/google-signin` v16 pulls GoogleSignIn iOS SDK 9.x, which transitively requires `GTMSessionFetcher ~> 3.x` and `GoogleUtilities ~> 8.0`. Our on-device OCR (`@infinitered/react-native-mlkit-text-recognition`, via MLKitCommon 10.x) anchors on `GTMSessionFetcher ~> 1.1` and `GoogleUtilities ~> 7.0`. No shared version range exists across any google-signin release that still ships an Expo config plugin. The two pods cannot coexist on iOS.

Two workarounds were evaluated and **both rejected**:

1. **Swap the MLKit OCR package.** Would restore Google Sign-In on iOS but risks OCR quality regressions, re-tests the share-intent flow, and couples two unrelated subsystems to the whims of the Google-pods lifecycle. The OCR pipeline is a silent background feature; Google-on-iOS is a speed-of-onboarding feature whose value we already largely get from Apple Sign-In on that platform.
2. **`expo-auth-session` for iOS Google flow.** Browser-redirect OAuth. Works in principle, but yields a markedly worse UX than the native Apple sheet iOS users are used to. It also introduces a third auth code path and a second token-flow shape, doubling the surface area of auth-related tests and docs.

**Decision.** Google Sign-In stays Android-only, **forever unless explicitly re-scoped by a new ADR**. iOS users get Email OTP and Apple Sign-In, both of which are first-class native experiences. Apple covers the "I don't want to type an email" job-to-be-done on iOS that Google covers on Android.

**Consequences.**

- `lib/googleSignIn.ios.ts` stays a stub. Never import `@react-native-google-signin/google-signin` into it. Rule 19 enforces this.
- `react-native.config.js` keeps iOS autolinking disabled for the package (Rule 16).
- `package.json` keeps the package in `expo.autolinking.ios.exclude` (Rule 18).
- The Google button in `login.tsx` stays gated to `Platform.OS === 'android'`.
- When the OCR package or Google SDK lifecycle changes meaningfully (e.g. MLKitCommon ships a release on modern `GoogleUtilities`), re-evaluate; until then, no code moves. Track the "would-help" changes through the Steering-Loop: if you find yourself wanting to touch any of the above four artifacts, write a new ADR first.
- Do **not** add "TODO: re-enable Google on iOS" comments to the codebase. This decision is not pending; it is made.

**Why this matters architecturally.** Runtime crashes from missing native modules (TurboModuleRegistry.getEnforcing throwing at import time) are the single highest-severity class of bug the hybrid-native stack produces. The cleanest way to make them impossible is to keep the offending code entirely out of the platform's bundle — which is what the `.ios.ts` stub does. Reversing that decision silently is how this class of bug returns; the ADR makes reversal explicit.

### When adding a new auth provider or auth operation

Follow the steering-loop (see "Harness" below):

1. Document the new provider/flow in this section.
2. Add a computational sensor if the change introduces a new token or credential path (e.g. extend Rule 11/12/13 or add a Rule 14).
3. Run `npm test` locally to confirm the sensor would catch a violation.

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

| Situation                                                        | Command                                             |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| JS-only change (components, hooks, lib/)                         | `npx expo start` — Metro hot reload, no rebuild     |
| First run after clone                                            | `npx expo run:android` — builds native shell        |
| After `expo install <native-module>` or `app.json` plugin change | `npx expo prebuild --clean && npx expo run:android` |
| Release / store build                                            | `eas build --profile production --platform android` |
| Quick preview APK (no store)                                     | `eas build --profile preview --platform android`    |

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

| Command                                                    | What runs                                                                                  | Requires emulator |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------- |
| `npm test`                                                 | `tsc --noEmit` + `jest --coverage` (all unit/integration/arch tests + coverage thresholds) | No                |
| `npm run test:all`                                         | `tsc --noEmit` + `jest` + `maestro` E2E flows                                              | Yes               |
| `npm run test:e2e`                                         | Maestro E2E flows only                                                                     | Yes               |
| `npm run test:e2e:single -- .maestro/01-app-launches.yaml` | Single Maestro flow                                                                        | Yes               |
| `npm run check:drift`                                      | Dead code (knip) + security audit + coverage                                               | No                |

`npm test` is the fast, always-runnable gate — run it after every change.
`npm run test:all` is the full pipeline including E2E (needs emulator + Metro).
`npm run check:drift` is the periodic drift sensor — run before releases or weekly.

**Test suites (Jest):**
| Suite | File | Tests | Mocking |
|-------|------|-------|---------|
| Leitner logic | `lib/leitner.test.ts` | 34 | Pure functions, no mocks |
| Database layer | `lib/database.test.ts` | 26 | `better-sqlite3` in-memory |
| Claude API | `lib/claude.test.ts` | 27 | `global.fetch` + mocked classifier |
| CEFR classifier | `lib/classifier/classifier.test.ts` | 26 | Mocked Claude fallback |
| Language detection | `lib/detectLanguage.test.ts` | 7 | No mocks (franc-min is deterministic) |
| URL extraction | `lib/urlExtractor.test.ts` | 25 | `global.fetch` + mocked `callClaude` |
| Architecture boundaries | `lib/__tests__/architecture.test.ts` | 100+ | Pure file scanning, no mocks |
| Approved LLM fixtures | `lib/__tests__/approved-fixtures.test.ts` | 16 | `global.fetch` + mocked `callClaude` |
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

### Harness: keeping architecture rules enforced

This project uses a layered "harness" (feedforward guides + feedback sensors) to
keep Claude Code aligned with architecture decisions. **When introducing a new
pattern or architectural rule, always close the steering loop:**

**Steering-loop checklist — run through this when any of these happen:**

- A new module boundary or import restriction is introduced
- A new UI pattern or data-access pattern is established
- A dependency is added or removed
- An existing rule in this file is changed

| Step                       | Action                                                                                                                                         | Where       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1. Document                | Add/update the rule in this `CLAUDE.md` file                                                                                                   | `CLAUDE.md` |
| 2. Enforce computationally | Add an ESLint rule (`eslint.config.mjs`) or architecture test (`lib/__tests__/architecture.test.ts`) that catches violations deterministically | Source      |
| 3. Optimise error messages | Write the lint/test error message as a self-correction instruction: what's wrong, how to fix it, which CLAUDE.md section to read               | Source      |
| 4. Verify                  | Run `npm test` to confirm the new sensor passes on current code and would fail on a violation                                                  | Terminal    |

**Examples of the pattern:**

- CLAUDE.md says "no Node imports in lib/" → `no-restricted-imports` ESLint rule + architecture test both enforce it with messages like _"Move this to scripts/. See CLAUDE.md Hard rule section."_
- CLAUDE.md says "no API keys in client code" → architecture test scans for `Authorization`, `ANTHROPIC_API_KEY`, `expo-secure-store` patterns
- CLAUDE.md says "use theme colors, not hex" → architecture test catches new hardcoded hex values (with `#FFFFFF` baselined)

**If a review or test catches something the harness missed:**
Ask "could a computational sensor have caught this?" If yes, add one now — don't just fix the instance. The goal is that the same class of mistake never reaches human review again.

**Available harness tools:**
| Tool | File | Type |
|------|------|------|
| ESLint (banned imports, unused vars) | `eslint.config.mjs` | Computational feedforward + feedback |
| Architecture boundary tests (100+ tests) | `lib/__tests__/architecture.test.ts` | Computational feedback |
| Approved LLM response fixtures (16 tests) | `lib/__tests__/approved-fixtures.test.ts` | Behavioural feedback |
| Claude Code PostEdit hook (tsc) | `.claude/settings.local.json` | Computational feedback |
| Husky pre-commit (lint-staged + tsc) | `.husky/pre-commit` | Computational feedback |
| Dead code detection | `npm run check:dead-code` (knip) | Drift sensor |
| Security audit | `npm run check:security` (npm audit) | Drift sensor |
| Coverage thresholds | `jest.config.js` coverageThreshold | Drift sensor |

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
`reset-app-btn`, `content-tab-original`, `content-tab-translation`, `content-tab-vocabulary`,
`typing-card`, `typing-input`, `check-btn`, `give-up-btn`, `next-btn`, `feedback-box`,
`quiz-mode-flashcard`, `quiz-mode-typing`.

## Known Issues / Watch Out

- **Image picker on iOS:** ALWAYS add 500ms delay before `launchImageLibraryAsync`
  to allow modal to fully close — skipping this causes a silent no-op with no error
- **API key:** the app must never hold an Anthropic key. All Claude calls go through the backend proxy. Do not add client-side key storage, env vars, or `Authorization` headers.
- **expo.log on Windows:** `Tee-Object` requires PowerShell (not CMD). If the file stays empty, check that the terminal is PowerShell 5+ and that `npx` resolves correctly (`where.exe npx`).
- **Android emulator + Metro port conflict:** if Metro fails to start on port 8081, kill the stale process with `npx kill-port 8081` before restarting.
- **Android Alert.alert():** Native alerts are unstyled on Android (harsh black/white). Use the `useAlert()` hook from `components/ConfirmDialog` instead — **everywhere** in app/ and components/. Architecture test (Rule 8) bans `Alert` imports and `Alert.alert()` calls in all client files.
- **Language settings:** Native and learning language must never be the same. The learning language picker filters out the current native language. If native is changed to match learning, they swap automatically. Architecture test enforces the swap logic exists in `app/settings.tsx`.
- **Error messages must be English:** User-facing error messages must use `getLanguageEnglishName()` (returns "German"), not `getLanguageName()` (returns "Deutsch"). Architecture test (Rule 9) enforces this in `shareProcessing.ts`.
- **No console.error in app/ screens:** `console.error` triggers Expo LogBox red toast in dev mode. Use `console.warn` for expected/handled errors shown to the user via dialog. Architecture test (Rule 10) bans `console.error` in all app/ files.
