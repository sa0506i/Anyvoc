# Migration: Claude Haiku → Mistral Small 3.2

## Context

Anyvoc uses Claude Haiku 4.5 via a backend proxy for vocabulary extraction, translation, OCR, and CEFR classification fallback. At 1000 daily active users (2 articles + 1 image/day), estimated monthly API cost is ~$2,117. Switching to Mistral Small 3.2 ($0.10/$0.30 per MTok vs Claude's $1.00/$5.00) reduces this to ~$149/month — a 93% cost reduction.

## Decisions

- **Approach:** Proxy-only migration — the client continues sending Claude-format requests; the backend proxy transforms to/from Mistral format. This enables provider switches without app updates.
- **OCR:** Replace Claude Vision with `react-native-mlkit-ocr` (Google ML Kit, on-device, offline). Mistral Small 3.2 has no vision capability.
- **Classifier fallback:** Stays on LLM (now Mistral via proxy), same rate-limit and caching logic.
- **No client format changes:** `callClaude()` signature, interfaces, and response parsing remain unchanged.

## Design

### 1. Backend Proxy (Fly.dev) — Format Transformation Layer

The proxy at `https://anyvoc-backend.fly.dev/api/chat` becomes a provider-agnostic adapter.

**Current backend** (`backend/server.js`, 38 lines): Express server using `@anthropic-ai/sdk`. Receives Claude-format requests, forwards via `anthropic.messages.create()`, returns the SDK response directly.

**New backend:** Replace `@anthropic-ai/sdk` with `@mistralai/mistralai` (or plain `fetch` to Mistral's REST API). Transform request/response formats inline.

**Request transformation (Claude → Mistral):**

```
Client sends (unchanged):
{
  "model": "...",
  "max_tokens": N,
  "system": "system prompt here",
  "messages": [{ "role": "user", "content": "..." }],
  "temperature": T          // optional
}

Proxy sends to api.mistral.ai/v1/chat/completions:
{
  "model": "mistral-small-2503",
  "max_tokens": N,
  "messages": [
    { "role": "system", "content": "system prompt here" },
    { "role": "user", "content": "..." }
  ],
  "temperature": T          // optional, omitted if not provided
}
```

Key mapping:
- `system` field → prepended as `messages[0]` with `role: "system"`
- `model` field → overridden to `"mistral-small-2503"` (client value ignored)
- `max_tokens`, `temperature` → passed through unchanged

**Response transformation (Mistral → Claude):**

```
Mistral returns:
{
  "choices": [{ "message": { "role": "assistant", "content": "response text" } }]
}

Proxy returns to client:
{
  "content": [{ "type": "text", "text": "response text" }]
}
```

Error mapping:
- Mistral HTTP 401 → proxy returns 401 + `{ error: { message: "..." } }`
- Mistral HTTP 429 → proxy returns 429 + `{ error: { message: "..." } }`
- Other errors → proxy returns original status code + error message

**API key:** `ANTHROPIC_API_KEY` env var on Fly.dev → replaced by `MISTRAL_API_KEY`. Client continues sending no authorization header.

**Dependencies:** Remove `@anthropic-ai/sdk`, `anthropic`. Add `@mistralai/mistralai` (or use plain `fetch` for zero dependencies).

### 2. Client Changes

#### `lib/claude.ts` (line 5)
```typescript
// Informational only — proxy overrides this
const MODEL = 'mistral-small-2503';
```

No other changes to `callClaude()`, interfaces, or any caller functions.

#### `lib/ocr.ts` — Replace Cloud Vision with Local OCR

**Current:**
```
recognizeText(base64Image) → callClaude(vision prompt) → text
```

**New:**
```
recognizeText(imageUri) → MlkitOcr.detectFromUri(uri) → text
```

Library: `react-native-mlkit-ocr`
- On-device ML Kit text recognition (50+ languages)
- Expo-compatible via config plugin
- No internet required, zero API cost
- Input: image URI (not base64) — may require adjusting callers in image processing flow

Existing validation functions (`validateOcrText`, `cleanOcrText`) remain unchanged — they operate on the extracted text string regardless of source.

**Native rebuild required:** Adding `react-native-mlkit-ocr` requires:
```
npx expo prebuild --clean && npx expo run:android
```

### 3. What Does NOT Change

- `callClaude()` function signature and all TypeScript interfaces
- `extractVocabulary()` — no code changes
- `translateText()` — no code changes
- `translateSingleWord()` — no code changes
- CEFR classifier (local ordinal-logit) — unchanged
- Classifier fallback path — calls `callClaude()` → proxy → now Mistral
- `fetchArticleContent()` / Readability extraction — unchanged
- Database schema — unchanged
- UI/UX — no visible changes
- `detectLanguage()` — already offline (franc-min)

### 4. Files to Modify

| File | Change | Scope |
|------|--------|-------|
| **Backend proxy** (in-repo, e.g. `backend/`) | Request/response transformation, Mistral API key | Major |
| `lib/claude.ts:5` | Update `MODEL` constant | 1 line |
| `lib/ocr.ts` | Replace `recognizeText()` with ML Kit | Medium |
| `app.json` | Add `react-native-mlkit-ocr` plugin | Config |
| `package.json` | Add `react-native-mlkit-ocr` dependency | Config |
| `lib/claude.test.ts` | No changes needed (mocks `global.fetch`, format unchanged) | None |
| `lib/ocr.test.ts` (if exists) | Update mocks for ML Kit | Minor |
| `CLAUDE.md` | Update model name, OCR references | Docs |

### 5. Cost Comparison

Mistral Small 3.2: $0.10/MTok input, $0.30/MTok output

At 1000 users × (2 articles + 1 image) / day:

| | Claude Haiku 4.5 | Mistral Small 3.2 | Savings |
|---|---|---|---|
| Input (541.5M tok/mo) | $541.50 | $54.15 | -90% |
| Output (315M tok/mo) | $1,575.00 | $94.50 | -94% |
| OCR | ~$50/mo | $0 (local) | -100% |
| **Total/month** | **~$2,117** | **~$149** | **-93%** |
| **Per user/month** | **~$2.12** | **~$0.15** | |

### 6. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Lower extraction quality (Mistral vs Claude) | Medium | Pre-rollout: compare extraction results on same test texts |
| JSON formatting differences | Low | Existing JSON repair fallback in `extractVocabulary` handles truncated responses |
| Local OCR worse for handwriting | Medium | Document as known limitation; printed text is primary use case |
| Mistral rate limits differ | Low | Proxy can add retry logic; classifier fallback already rate-limited |
| ML Kit plugin + Expo compatibility | Low | Well-maintained library with Expo config plugin support |

### 7. Verification

1. **Backend proxy:** Deploy updated proxy, test with curl:
   - Send Claude-format request → verify Mistral-format forwarded
   - Verify response transformed back to Claude-format
   - Test error codes (401, 429, 500)
2. **Client unit tests:** `npm test` — all existing tests must pass unchanged (they mock `global.fetch` and test the Claude-format contract)
3. **OCR integration:** Test `recognizeText()` with sample images on emulator
4. **End-to-end:** Add text content, add link, add image — verify vocabulary extraction, translation, and OCR all work
5. **Quality comparison:** Run 10 test articles through both Claude and Mistral, compare vocabulary extraction results
6. **E2E tests:** `npm run test:all` — all Maestro flows must pass
