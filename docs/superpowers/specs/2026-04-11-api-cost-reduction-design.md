# API Cost Reduction: Local Replacements for fetchArticleContent & detectLanguage

## Context

Anyvoc makes Claude API calls for several functions during content processing. The two most token-expensive functions that can be replaced with established local libraries are:

1. **`fetchArticleContent()`** (~15,000 tokens/call) — extracts article text from HTML via Claude
2. **`detectLanguage()`** (~255 tokens/call) — detects text language via Claude

Goal: Replace these with offline libraries to reduce operating costs without UX degradation.

## Decisions

- **Readability library:** `@mozilla/readability` + `linkedom` (Firefox Reader View algorithm)
- **Language detection:** `franc` (trigram-based, pure JS, offline)
- **Fallback strategy:** Claude fallback for Readability when extraction yields <100 chars
- **Scope:** Only these two functions. `extractVocabulary`, `translateText`, `translateSingleWord` remain on Claude API.

## Design

### 1. Article Extraction (`lib/urlExtractor.ts`)

**Current flow:**
```
fetch(url) → strip noise tags → truncate to 60KB → Claude extracts title + body
```

**New flow:**
```
fetch(url) → linkedom.parseHTML(html) → Readability(document).parse()
  → if result.textContent.length >= 100: return { title, text }
  → else: fallback to existing Claude extraction
```

**Changes to `lib/urlExtractor.ts`:**
- Add `extractWithReadability(html: string)` function
- Modify `fetchArticleContent()` to try Readability first, Claude second
- Keep existing `stripNoiseTags()` and `truncateHTML()` as pre-processing for the Claude fallback path
- Readability returns `{ title, textContent, content (HTML), excerpt }` — we use `title` and `textContent`

**Edge cases:**
- Readability returns null (no article detected) → Claude fallback
- Readability returns article with <100 chars text → Claude fallback
- linkedom parse failure → Claude fallback
- All fallback paths use the existing Claude-based extraction unchanged

### 2. Language Detection (`lib/claude.ts`)

**Current flow:**
```
callClaude(system: "detect language", user: text.slice(0,500)) → ISO 639-1 code
```

**New flow:**
```
franc(text.slice(0, 500)) → ISO 639-3 code → map to ISO 639-1
  → if result is 'und' (undetermined): return fallback default
```

**Changes:**
- Replace `detectLanguage()` body in `lib/claude.ts` with franc call
- Add ISO 639-3 → 639-1 mapping for our 12 supported languages (en, de, fr, es, it, pt, nl, sv, no, da, pl, cs)
- Remove the `async` from function signature (franc is synchronous)
- **No Claude fallback needed** — franc is reliable at 500 chars for European languages

**Mapping table (franc ISO 639-3 → our ISO 639-1):**
```
eng→en, deu→de, fra→fr, spa→es, ita→it, por→pt,
nld→nl, swe→sv, nob/nno→no, dan→da, pol→pl, ces→cs
```

If franc returns a code not in our supported set, return `null` (caller handles this — currently `processSharedText` uses the learningLanguage setting as implicit fallback).

### 3. New Dependencies

```json
{
  "@mozilla/readability": "^0.5.0",
  "linkedom": "^0.16.0",
  "franc": "^6.2.0"
}
```

All three are pure JS, no native modules, no prebuild needed. Compatible with Hermes engine and Expo managed workflow.

**Note:** `franc` v6+ is ESM-only. If Metro has issues, use `franc-min` (smaller model, still accurate for European languages) or pin to a CJS-compatible version.

### 4. Files to Modify

| File | Change |
|------|--------|
| `lib/urlExtractor.ts` | Add Readability extraction with Claude fallback |
| `lib/claude.ts` | Replace `detectLanguage()` body with franc |
| `package.json` | Add 3 new dependencies |

### 5. What Does NOT Change

- `extractVocabulary()` — stays on Claude API
- `translateText()` — stays on Claude API  
- `translateSingleWord()` — stays on Claude API
- `classifyViaClaude()` — stays on Claude API (already optimized, rare)
- Backend proxy — no changes needed
- Database schema — no changes
- UI/UX — no visible changes to the user

## Expected Savings

| Scenario | Before (tokens) | After (tokens) | Savings |
|----------|-----------------|----------------|---------|
| Add link | ~24,755 | ~9,500 (Readability success) or ~24,500 (fallback) | ~60% avg |
| Add text/image | ~9,755 | ~9,500 | ~2.5% |
| Manual word add | ~510 | ~510 | 0% |

Assuming 70% of content is text/image and 30% is links, with 90% Readability success rate:
**Overall cost reduction: ~15-20%**

## Verification

1. `npm test` — tsc + all Jest tests pass
2. Add Jest tests for:
   - `extractWithReadability()` with sample HTML → returns title + text
   - `extractWithReadability()` with empty/minimal HTML → returns null (triggers fallback)
   - `detectLanguage()` with German/French/English text → correct ISO code
   - `detectLanguage()` with unsupported language → returns null
3. Manual test: Add a link (e.g., Wikipedia article) → verify content extracted correctly
4. Manual test: Add text in German → verify language detected as "de"
