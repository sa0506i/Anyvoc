# Readability Article Extraction Cleanup

**Date:** 2026-04-16
**Status:** Approved
**Scope:** `lib/urlExtractor.ts` only

## Problem

`extractWithReadability()` uses `article.textContent` which includes non-article
content that Readability keeps inside the detected article boundary:

- **Wikipedia:** Infobox tables rendered as flat text, footnote references `[1]` `[2]`
- **News sites:** Breadcrumb navigation glued together (`DRAtualidadeAveiro`),
  duplicated lead paragraphs (teaser == first body paragraph),
  trailing metadata (date/time stamps)

This pollutes the text sent to the LLM for vocabulary extraction, wasting tokens
on non-article content and producing low-quality vocabulary (abbreviations, metadata
fragments, table cell values).

## Solution: HTML-based post-cleanup

Replace `article.textContent` usage with a two-phase approach:

1. Use `article.content` (Readability's cleaned HTML) instead of `textContent`
2. Parse that HTML with linkedom and remove noise elements before extracting text

### New function: `cleanArticleHtml(html: string): string`

**Phase 1 — DOM element removal** (on the parsed `article.content`):

| Selector / pattern | Rationale |
|--------------------|-----------|
| `table` | Infoboxes, metadata tables, data tables (low vocab value) |
| `figure`, `figcaption` | Image captions |
| `sup` containing only anchor links | Footnote references like `[1]` |
| `nav`, `aside` | Residual navigation/sidebar if Readability missed them |
| Elements with classes matching `infobox`, `sidebar`, `breadcrumb`, `byline`, `metadata`, `share`, `social`, `navbox`, `catlinks` | Common CMS patterns for non-article content |

**Phase 2 — Text post-processing** (on the extracted textContent):

1. Normalize whitespace: collapse multiple blank lines to one, trim lines
2. Remove leading breadcrumb fragments: lines at text start that look like
   concatenated navigation labels (short, no spaces, mixed case)
3. Deduplicate lead paragraph: if the first two paragraphs are identical or
   one is a substring of the other, keep only one
4. Strip trailing metadata: remove date/time patterns at the end of the text
   (e.g., `Abril 16, 2026 . 08:45`, `16. April 2026`)

### Changes to `extractWithReadability()`

```
Before:
  article.textContent.trim()

After:
  cleanArticleHtml(article.content)
```

The function signature and return type stay identical. `article.title` usage
is unchanged.

## Files changed

- `lib/urlExtractor.ts` — add `cleanArticleHtml()`, modify `extractWithReadability()`
- `lib/urlExtractor.test.ts` — add unit tests for `cleanArticleHtml()` with
  HTML fixtures covering both problem patterns (infobox table, breadcrumbs,
  duplicate lead, trailing metadata, footnote refs)

## What does NOT change

- `fetchHtml()`, `stripNoiseTags()`, `truncateHtml()` — untouched
- `extractWithClaude()` fallback — untouched
- `fetchArticleContent()` signature — identical
- No new dependencies (linkedom already imported)
- No changes to `shareHandler.ts` or `ShareIntentHandler.tsx`

## Risk

Removing `<table>` elements could drop relevant content in articles about
tabular data (sports results, financial tables). Acceptable trade-off:
table cell content rarely contains learnable vocabulary — it's mostly
numbers, abbreviations, and proper nouns that the vocab post-processor
would filter anyway.

## Verification

1. Unit tests with HTML fixtures for both observed patterns
2. Integration test: re-run extraction on the two reference URLs and
   confirm clean output (manual, via tmp/ test script)
3. `npm test` passes (tsc + jest + architecture tests)
