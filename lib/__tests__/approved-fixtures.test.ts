/**
 * Approved Fixtures Tests — "Behavioural Harness"
 *
 * These tests load known-good LLM response fixtures and verify that
 * the parsing logic in lib/claude.ts and lib/urlExtractor.ts handles
 * them correctly. They catch regressions when prompt templates or
 * parsing logic changes.
 *
 * Each fixture represents a real-world LLM response pattern.
 * When a test fails, it means the parsing contract has broken.
 */

import * as fs from 'fs';
import * as path from 'path';

// Mock classifyWord before importing claude.ts
jest.mock('../classifier', () => ({
  classifyWord: jest.fn().mockResolvedValue('B1'),
}));

// Mock callClaude for URL extractor tests
jest.mock('../claude', () => {
  const actual = jest.requireActual('../claude');
  return {
    ...actual,
    callClaude: jest.fn(),
  };
});

import { extractVocabulary, translateSingleWord } from '../claude';
import { fetchArticleContent } from '../urlExtractor';
import { callClaude } from '../claude';

const mockedCallClaude = callClaude as jest.MockedFunction<typeof callClaude>;

const FIXTURES = path.join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

/** Mock global.fetch to return an LLM-style response */
function mockFetchOk(text: string) {
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text }],
    }),
  });
}

function mockFetchHtml(html: string) {
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h === 'content-type' ? 'text/html' : null) },
    text: async () => html,
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  mockedCallClaude.mockReset();
});

// ─────────────────────────────────────────────────────────────
// extractVocabulary fixtures
// ─────────────────────────────────────────────────────────────

describe('Approved Fixtures: extractVocabulary', () => {
  it('parses clean JSON array with multiple word types', async () => {
    const fixture = loadFixture('vocab-clean.json');
    mockFetchOk(fixture);
    const result = await extractVocabulary('test text', 'English', 'German', 'de', 'en');

    expect(result).toHaveLength(4);
    // Pure-INDEF (Rule 47): LLM fixture emits DEF "der Hund, die Hündin";
    // ensureIndefArticle normalises to INDEF on both sides.
    expect(result[0].original).toBe('ein Hund, eine Hündin');
    expect(result[0].translation).toBe('a dog');
    expect(result[0].type).toBe('noun');
    expect(result[0].source_forms).toEqual(['Hunde', 'Hunden']);
    // classifyWord mock returns B1 for all
    expect(result[0].level).toBe('B1');

    // Verify all types are preserved
    expect(result.map((v) => v.type)).toEqual(['noun', 'verb', 'adjective', 'verb']);
  });

  it('strips markdown fences from wrapped response', async () => {
    const fixture = loadFixture('vocab-markdown-wrapped.txt');
    mockFetchOk(fixture);
    const result = await extractVocabulary('test text', 'German', 'French', 'fr');

    expect(result).toHaveLength(2);
    // LLM fixture: "le médecin, la médecin" → pure-INDEF: "un médecin, une médecin"
    expect(result[0].original).toBe('un médecin, une médecin');
    expect(result[1].original).toBe('se souvenir');
    expect(result[1].type).toBe('verb');
  });

  it('repairs truncated JSON (cut mid-object) recovering complete items', async () => {
    const fixture = loadFixture('vocab-truncated-mid-object.txt');
    mockFetchOk(fixture);
    const result = await extractVocabulary('test text', 'English', 'Portuguese', 'pt');

    // Should recover the 2 complete objects before the truncated third
    expect(result.length).toBeGreaterThanOrEqual(2);
    // LLM fixture: "o passaporte" → pure-INDEF: "um passaporte"
    expect(result[0].original).toBe('um passaporte');
    expect(result[1].original).toBe('acordar-se');
  });

  it('repairs truncated JSON (cut mid-string) recovering complete items', async () => {
    const fixture = loadFixture('vocab-truncated-mid-string.txt');
    mockFetchOk(fixture);
    const result = await extractVocabulary('test text', 'English', 'German', 'de');

    // Should recover at least the 2 complete objects
    expect(result.length).toBeGreaterThanOrEqual(2);
    // LLM fixture: "die Straßenbahn" → pure-INDEF: "eine Straßenbahn"
    expect(result[0].original).toBe('eine Straßenbahn');
    expect(result[1].original).toBe('eine Sehenswürdigkeit');
  });

  it('extracts JSON array after conversational preamble', async () => {
    const fixture = loadFixture('vocab-with-preamble.txt');
    mockFetchOk(fixture);
    const result = await extractVocabulary('test text', 'English', 'Spanish', 'es');

    expect(result).toHaveLength(2);
    // LLM fixture: "el libro" → pure-INDEF: "un libro"
    expect(result[0].original).toBe('un libro');
    expect(result[1].original).toBe('escribir');
  });

  it('handles special characters (umlauts, accents, cedillas, hyphens)', async () => {
    const fixture = loadFixture('vocab-special-chars.json');
    mockFetchOk(fixture);
    const result = await extractVocabulary('test text', 'English', 'French', 'fr');

    expect(result).toHaveLength(4);
    // FR enforcer can't recognise German "die" as DEF article, so it
    // falls through unchanged (FR defaultGender=null keeps it bare).
    expect(result[0].original).toBe('die Gemütlichkeit');
    expect(result[1].original).toBe('naïf, naïve');
    // l' is gender-ambiguous in FR — preserved as-is.
    expect(result[2].original).toBe("l'après-midi");
    expect(result[3].original).toBe('açúcar');
  });

  it('returns empty array for empty JSON array response', async () => {
    const fixture = loadFixture('vocab-empty-array.json');
    mockFetchOk(fixture);
    const result = await extractVocabulary('test text', 'English', 'German', 'de');

    expect(result).toEqual([]);
  });

  it('preserves complex source_forms arrays', async () => {
    const fixture = loadFixture('vocab-source-forms-complex.json');
    mockFetchOk(fixture);
    const result = await extractVocabulary('test text', 'English', 'Portuguese', 'pt');

    expect(result).toHaveLength(3);
    expect(result[0].source_forms).toEqual(['rivais', 'rival']);
    expect(result[1].source_forms).toEqual(['vou', 'vai', 'vamos', 'foram', 'ido']);
    expect(result[2].source_forms).toEqual(['Brüder', 'Bruders', 'Brüdern']);
  });
});

// ─────────────────────────────────────────────────────────────
// translateSingleWord fixtures
// ─────────────────────────────────────────────────────────────

describe('Approved Fixtures: translateSingleWord', () => {
  it('parses clean JSON object', async () => {
    const fixture = loadFixture('translate-clean.json');
    mockFetchOk(fixture);
    const result = await translateSingleWord('Arzt', 'German', 'English', 'de', 'en');

    // LLM fixture: "der Arzt, die Ärztin" / "the doctor" → pure-INDEF
    expect(result.original).toBe('ein Arzt, eine Ärztin');
    expect(result.translation).toBe('a doctor');
    expect(result.type).toBe('noun');
    expect(result.level).toBe('B1');
  });

  it('strips markdown fences from JSON object', async () => {
    const fixture = loadFixture('translate-with-markdown.txt');
    mockFetchOk(fixture);
    const result = await translateSingleWord('beau', 'French', 'English', 'fr');

    expect(result.original).toBe('beau, belle');
    expect(result.translation).toBe('beautiful, handsome');
    expect(result.type).toBe('adjective');
  });

  it('extracts JSON object surrounded by explanation text', async () => {
    const fixture = loadFixture('translate-with-explanation.txt');
    mockFetchOk(fixture);
    const result = await translateSingleWord('erinnern', 'German', 'English', 'de');

    expect(result.original).toBe('sich erinnern');
    expect(result.translation).toBe('to remember');
    expect(result.type).toBe('verb');
  });

  it('handles German noun with article + feminine form', async () => {
    const fixture = loadFixture('translate-german-noun.json');
    mockFetchOk(fixture);
    const result = await translateSingleWord('Lehrer', 'German', 'English', 'de');

    // LLM fixture "der Lehrer, die Lehrerin" → pure-INDEF "ein Lehrer, eine Lehrerin"
    expect(result.original).toBe('ein Lehrer, eine Lehrerin');
    expect(result.type).toBe('noun');
  });

  it('handles Portuguese reflexive verb', async () => {
    const fixture = loadFixture('translate-reflexive-verb.json');
    mockFetchOk(fixture);
    const result = await translateSingleWord('acordar-se', 'Portuguese', 'English', 'pt');

    expect(result.original).toBe('acordar-se');
    expect(result.type).toBe('verb');
  });
});

// ─────────────────────────────────────────────────────────────
// URL extraction fixtures (via callClaude mock)
// ─────────────────────────────────────────────────────────────

// HTML that triggers Claude fallback: Readability returns null (text in <noscript>)
// but raw text density > 200 chars so the density check passes.
const THIN_HTML = `<!DOCTYPE html><html><head><title>X</title></head><body><div id="root"></div><noscript>You need JavaScript to run this app. This application requires a modern browser with JavaScript enabled. Please enable JavaScript in your browser settings and try again. For the best experience use Chrome Firefox or Safari. The application provides real-time news updates.</noscript></body></html>`;

describe('Approved Fixtures: URL extraction (Claude fallback)', () => {
  it('parses TITLE + separator + body format', async () => {
    const fixture = loadFixture('url-extract-clean.txt');
    mockFetchHtml(THIN_HTML);
    mockedCallClaude.mockResolvedValue(fixture);
    const result = await fetchArticleContent('https://example.com/article');

    expect(result.title).toBe('Die Zukunft der künstlichen Intelligenz in Europa');
    expect(result.text).toContain('Europäische Union');
    expect(result.text).toContain('Sprachmodelle');
    expect(result.text.length).toBeGreaterThan(50);
  });

  it('uses URL as title when separator is missing', async () => {
    const fixture = loadFixture('url-extract-no-separator.txt');
    mockFetchHtml(THIN_HTML);
    mockedCallClaude.mockResolvedValue(fixture);
    const result = await fetchArticleContent('https://example.com/blog');

    expect(result.title).toBe('https://example.com/blog');
    expect(result.text).toContain('machine learning');
  });

  it('throws on NO_ARTICLE_CONTENT response', async () => {
    const fixture = loadFixture('url-extract-no-article.txt');
    mockFetchHtml(THIN_HTML);
    mockedCallClaude.mockResolvedValue(fixture);

    await expect(fetchArticleContent('https://example.com/login')).rejects.toThrow(
      'No meaningful article content',
    );
  });
});
