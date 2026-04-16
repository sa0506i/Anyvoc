# Readability Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean Readability's HTML output to remove infobox tables, footnote refs, breadcrumbs, duplicate leads, and trailing metadata before extracting text.

**Architecture:** Add a `cleanArticleHtml()` function to `lib/urlExtractor.ts` that takes Readability's `article.content` HTML, strips noise elements via DOM manipulation (linkedom), then applies text-level post-processing. `extractWithReadability()` calls this instead of using `article.textContent` directly.

**Tech Stack:** linkedom (already imported), `@mozilla/readability` (already imported), no new deps.

---

### Task 1: Write tests for `cleanArticleHtml`

**Files:**
- Modify: `lib/urlExtractor.test.ts`
- Modify: `lib/urlExtractor.ts` (export only — for testability)

- [ ] **Step 1: Export `cleanArticleHtml` from urlExtractor.ts (stub)**

Add at the bottom of `lib/urlExtractor.ts`, before `fetchArticleContent`:

```typescript
/**
 * Take Readability's cleaned article HTML and extract only the main
 * article text, removing tables, figure captions, footnote refs,
 * breadcrumbs, duplicate leads, and trailing metadata.
 */
export function cleanArticleHtml(html: string): string {
  // Stub — will be implemented in Task 2
  return html;
}
```

- [ ] **Step 2: Write failing tests in `urlExtractor.test.ts`**

Add a new `describe('cleanArticleHtml')` block at the end of the file. Import `cleanArticleHtml` from `./urlExtractor`.

```typescript
import { fetchArticleContent, cleanArticleHtml } from './urlExtractor';
```

Then add these test cases:

```typescript
describe('cleanArticleHtml', () => {
  it('removes <table> elements (infoboxes)', () => {
    const html = `
      <div>
        <p>Article introduction paragraph with enough text to be meaningful.</p>
        <table class="infobox"><tr><td>Partei</td><td>TISZA</td></tr></table>
        <p>Article body continues here with more content.</p>
      </div>`;
    const text = cleanArticleHtml(html);
    expect(text).toContain('Article introduction');
    expect(text).toContain('Article body continues');
    expect(text).not.toContain('Partei');
    expect(text).not.toContain('TISZA');
  });

  it('removes <figure> and <figcaption> elements', () => {
    const html = `
      <div>
        <p>Main article text here.</p>
        <figure>
          <img src="photo.jpg" alt="A photo" />
          <figcaption>Photo: Reuters / Some Photographer 2026</figcaption>
        </figure>
        <p>More article text follows.</p>
      </div>`;
    const text = cleanArticleHtml(html);
    expect(text).toContain('Main article text');
    expect(text).toContain('More article text');
    expect(text).not.toContain('Reuters');
    expect(text).not.toContain('figcaption');
  });

  it('removes footnote reference <sup> elements', () => {
    const html = `
      <div>
        <p>The party was founded in 2021<sup><a href="#cite1">[1]</a></sup> in Eger<sup><a href="#cite2">[2]</a></sup>.</p>
      </div>`;
    const text = cleanArticleHtml(html);
    expect(text).toContain('The party was founded in 2021');
    expect(text).toContain('in Eger');
    expect(text).not.toContain('[1]');
    expect(text).not.toContain('[2]');
  });

  it('removes elements with noise class names', () => {
    const html = `
      <div>
        <div class="breadcrumb">Home > News > Politics</div>
        <p>Actual article content here.</p>
        <div class="navbox">Related articles links</div>
        <div class="catlinks">Categories: Politics</div>
      </div>`;
    const text = cleanArticleHtml(html);
    expect(text).toContain('Actual article content');
    expect(text).not.toContain('Home > News');
    expect(text).not.toContain('Related articles');
    expect(text).not.toContain('Categories:');
  });

  it('removes <nav> and <aside> elements', () => {
    const html = `
      <div>
        <nav>Menu items</nav>
        <p>Real article text.</p>
        <aside>Sidebar content</aside>
      </div>`;
    const text = cleanArticleHtml(html);
    expect(text).toContain('Real article text');
    expect(text).not.toContain('Menu items');
    expect(text).not.toContain('Sidebar content');
  });

  it('deduplicates lead paragraph when teaser repeats first body paragraph', () => {
    const html = `
      <div>
        <p>The regiment is hosting the parachute course until day 23.</p>
        <p>The regiment is hosting the parachute course until day 23. Additional details follow in this extended version of the lead.</p>
        <p>Second body paragraph with different content.</p>
      </div>`;
    const text = cleanArticleHtml(html);
    // The short duplicate should be removed, keeping only the longer version
    const matches = text.match(/The regiment is hosting/g);
    expect(matches).toHaveLength(1);
    expect(text).toContain('Second body paragraph');
  });

  it('strips trailing date/time metadata', () => {
    const html = `
      <div>
        <p>Article content here.</p>
        <p>Abril 16, 2026 . 08:45</p>
      </div>`;
    const text = cleanArticleHtml(html);
    expect(text).toContain('Article content');
    expect(text).not.toMatch(/Abril 16, 2026/);
  });

  it('normalizes excessive whitespace', () => {
    const html = `
      <div>
        <p>First paragraph.</p>



        <p>Second paragraph.</p>
      </div>`;
    const text = cleanArticleHtml(html);
    // Should have at most one blank line between paragraphs
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).toContain('First paragraph.');
    expect(text).toContain('Second paragraph.');
  });

  it('returns empty string for empty or whitespace-only input', () => {
    expect(cleanArticleHtml('')).toBe('');
    expect(cleanArticleHtml('   ')).toBe('');
    expect(cleanArticleHtml('<div>   </div>')).toBe('');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest lib/urlExtractor.test.ts --verbose 2>&1 | tail -30`
Expected: Multiple failures (stub returns raw HTML, not cleaned text)

- [ ] **Step 4: Commit**

```bash
git add lib/urlExtractor.ts lib/urlExtractor.test.ts
git commit -m "test: add failing tests for cleanArticleHtml"
```

---

### Task 2: Implement `cleanArticleHtml`

**Files:**
- Modify: `lib/urlExtractor.ts`

- [ ] **Step 1: Implement DOM cleanup phase**

Replace the `cleanArticleHtml` stub in `lib/urlExtractor.ts` with the full implementation:

```typescript
/** Class-name fragments that indicate non-article content. */
const NOISE_CLASS_PATTERNS = [
  'infobox', 'sidebar', 'breadcrumb', 'byline', 'metadata',
  'share', 'social', 'navbox', 'catlinks', 'mw-editsection',
];

/**
 * Take Readability's cleaned article HTML and extract only the main
 * article text, removing tables, figure captions, footnote refs,
 * breadcrumbs, duplicate leads, and trailing metadata.
 */
export function cleanArticleHtml(html: string): string {
  if (!html || !html.trim()) return '';

  const { document } = parseHTML(`<body>${html}</body>`);

  // Phase 1: DOM element removal
  // Remove tables (infoboxes, data tables)
  document.querySelectorAll('table').forEach((el: Element) => el.remove());

  // Remove figures and captions
  document.querySelectorAll('figure, figcaption').forEach((el: Element) => el.remove());

  // Remove nav and aside
  document.querySelectorAll('nav, aside').forEach((el: Element) => el.remove());

  // Remove footnote-reference <sup> elements that contain only links
  document.querySelectorAll('sup').forEach((el: Element) => {
    const text = el.textContent || '';
    if (/^\s*\[?\d+\]?\s*$/.test(text)) {
      el.remove();
    }
  });

  // Remove elements whose class matches noise patterns
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const cls = (el.getAttribute('class') || '').toLowerCase();
    if (cls && NOISE_CLASS_PATTERNS.some((p) => cls.includes(p))) {
      el.remove();
    }
  }

  // Phase 2: Text post-processing
  let text = (document.body?.textContent || '').trim();
  if (!text) return '';

  // Normalize whitespace: collapse 3+ newlines to 2 (one blank line)
  text = text.replace(/\n{3,}/g, '\n\n');

  // Collapse runs of spaces/tabs (but not newlines) into single space
  text = text.replace(/[^\S\n]+/g, ' ');

  // Trim each line
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  // Remove trailing date/time metadata patterns
  // Matches: "Abril 16, 2026 . 08:45", "16. April 2026", "April 16, 2026 08:45",
  // "2026-04-16 08:45", etc.
  text = text.replace(
    /\n+(?:\d{1,2}[.\s]+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Janeiro|Fevereiro|Mar[cç]o|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro|Januar|Februar|M[aä]rz|Mai|Juni|Juli|Oktober|Dezember)[\s.,]+\d{1,4}[\s.,]*\d{0,4}[\s.:]*\d{0,2}\s*$/i,
    '',
  );
  text = text.replace(/\n+\d{4}-\d{2}-\d{2}[\s.:]*\d{0,2}[:.]?\d{0,2}\s*$/, '');

  // Deduplicate lead: if first paragraph is a substring of the second, drop it
  const paragraphs = text.split(/\n\n+/);
  if (
    paragraphs.length >= 2 &&
    paragraphs[1].startsWith(paragraphs[0]) &&
    paragraphs[0].length > 20
  ) {
    paragraphs.shift();
    text = paragraphs.join('\n\n');
  }

  // Final trim and whitespace normalization
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx jest lib/urlExtractor.test.ts --verbose 2>&1 | tail -40`
Expected: All `cleanArticleHtml` tests pass

- [ ] **Step 3: Commit**

```bash
git add lib/urlExtractor.ts
git commit -m "feat: implement cleanArticleHtml DOM-based post-cleanup"
```

---

### Task 3: Wire `cleanArticleHtml` into `extractWithReadability`

**Files:**
- Modify: `lib/urlExtractor.ts`

- [ ] **Step 1: Modify `extractWithReadability` to use `cleanArticleHtml`**

Change the `extractWithReadability` function. Replace lines 83-102:

```typescript
function extractWithReadability(html: string): { title: string; text: string } | null {
  try {
    const { document } = parseHTML(html);
    const reader = new Readability(document, { charThreshold: 50 });
    const article = reader.parse();
    if (!article || !article.content) {
      return null;
    }
    const text = cleanArticleHtml(article.content);
    if (text.length < READABILITY_MIN_LENGTH) {
      return null;
    }
    return {
      title: article.title || '',
      text,
    };
  } catch {
    return null;
  }
}
```

Key changes:
- Check `article.content` instead of `article.textContent`
- Call `cleanArticleHtml(article.content)` instead of `article.textContent.trim()`
- Length check on cleaned text, not raw textContent

- [ ] **Step 2: Run the full test suite**

Run: `npx jest lib/urlExtractor.test.ts --verbose 2>&1 | tail -40`
Expected: ALL tests pass (both old `fetchArticleContent` tests and new `cleanArticleHtml` tests)

- [ ] **Step 3: Run tsc**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: No errors

- [ ] **Step 4: Run full test suite**

Run: `npm test 2>&1 | tail -30`
Expected: All tests pass, no regressions

- [ ] **Step 5: Commit**

```bash
git add lib/urlExtractor.ts
git commit -m "feat: wire cleanArticleHtml into extractWithReadability

Readability now uses article.content (HTML) instead of article.textContent.
The HTML is cleaned via DOM manipulation before text extraction, removing
infobox tables, footnote refs, figcaptions, and other non-article content."
```

---

### Task 4: Manual verification with reference URLs

**Files:**
- Modify: `tmp/test-extract.mjs` (gitignored, for manual testing)

- [ ] **Step 1: Update test script to use the new path**

Replace `tmp/test-extract.mjs` with a script that imports and uses the built module to verify the two reference URLs produce clean output. Since `lib/urlExtractor.ts` is a TS module used by Metro, we replicate the logic directly:

```javascript
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const NOISE_CLASS_PATTERNS = [
  'infobox', 'sidebar', 'breadcrumb', 'byline', 'metadata',
  'share', 'social', 'navbox', 'catlinks', 'mw-editsection',
];

function cleanArticleHtml(html) {
  if (!html || !html.trim()) return '';
  const { document } = parseHTML(`<body>${html}</body>`);
  document.querySelectorAll('table').forEach((el) => el.remove());
  document.querySelectorAll('figure, figcaption').forEach((el) => el.remove());
  document.querySelectorAll('nav, aside').forEach((el) => el.remove());
  document.querySelectorAll('sup').forEach((el) => {
    const text = el.textContent || '';
    if (/^\s*\[?\d+\]?\s*$/.test(text)) el.remove();
  });
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const cls = (el.getAttribute('class') || '').toLowerCase();
    if (cls && NOISE_CLASS_PATTERNS.some((p) => cls.includes(p))) el.remove();
  }
  let text = (document.body?.textContent || '').trim();
  if (!text) return '';
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[^\S\n]+/g, ' ');
  text = text.split('\n').map((l) => l.trim()).join('\n');
  text = text.replace(
    /\n+(?:\d{1,2}[.\s]+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Janeiro|Fevereiro|Mar[cç]o|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro|Januar|Februar|M[aä]rz|Mai|Juni|Juli|Oktober|Dezember)[\s.,]+\d{1,4}[\s.,]*\d{0,4}[\s.:]*\d{0,2}\s*$/i,
    '',
  );
  text = text.replace(/\n+\d{4}-\d{2}-\d{2}[\s.:]*\d{0,2}[:.]?\d{0,2}\s*$/, '');
  const paragraphs = text.split(/\n\n+/);
  if (paragraphs.length >= 2 && paragraphs[1].startsWith(paragraphs[0]) && paragraphs[0].length > 20) {
    paragraphs.shift();
    text = paragraphs.join('\n\n');
  }
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

const URLS = [
  'https://de.wikipedia.org/wiki/Tisztelet_%C3%A9s_Szabads%C3%A1g_P%C3%A1rt',
  'https://www.diarioaveiro.pt/2026/04/16/sao-jacinto-recebe-curso-de-paraquedista/',
];

for (const url of URLS) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`URL: ${url}`);
  console.log('='.repeat(70));
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  const html = await res.text();
  const { document } = parseHTML(html);
  const article = new Readability(document, { charThreshold: 50 }).parse();
  if (!article || !article.content) { console.log('Readability returned null'); continue; }
  console.log(`\nTITLE: ${article.title}`);
  const cleaned = cleanArticleHtml(article.content);
  console.log(`CLEANED LENGTH: ${cleaned.length} chars`);
  console.log(`\n--- FIRST 2000 CHARS ---\n`);
  console.log(cleaned.substring(0, 2000));
}
```

- [ ] **Step 2: Run the verification script**

Run: `node tmp/test-extract.mjs`

Expected for Wikipedia:
- No infobox table content (no "Partei­vorsitzender", no "138 / 199")
- No `[1]`, `[2]` footnote refs
- Clean article text starting with the party description

Expected for Diario de Aveiro:
- No `DRAtualidadeAveiro` breadcrumb
- No duplicated lead paragraph
- No trailing `Abril 16, 2026 . 08:45`

- [ ] **Step 3: Verify, iterate if needed**

If output still contains noise, adjust selectors or regex in `cleanArticleHtml` and re-run tests + verification. No commit for tmp/ (gitignored).
