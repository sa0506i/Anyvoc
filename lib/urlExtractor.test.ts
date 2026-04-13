/**
 * Tests for Readability-based article extraction in urlExtractor.ts.
 *
 * We mock `fetch` and `callClaude` to isolate the extraction logic.
 */

jest.mock('./claude', () => ({
  callClaude: jest.fn(),
}));

import { fetchArticleContent } from './urlExtractor';
import { callClaude } from './claude';

const mockedCallClaude = callClaude as jest.MockedFunction<typeof callClaude>;

// Sample well-structured article HTML
const ARTICLE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Test Article</title></head>
<body>
  <nav>Navigation links here</nav>
  <article>
    <h1>The Great Article Title</h1>
    <p>This is the first paragraph of a well-structured article that contains enough text to pass the minimum content length threshold. It discusses important topics in detail.</p>
    <p>This is the second paragraph with even more content to ensure Readability considers this a valid article. The content needs to be substantial enough for extraction.</p>
    <p>A third paragraph adds more depth to the article content. Readability algorithms work best with multiple paragraphs of meaningful text that simulate real web articles.</p>
  </article>
  <footer>Footer content</footer>
</body>
</html>`;

// HTML with no article content (e.g. login page)
const NO_ARTICLE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Login</title></head>
<body>
  <form><input type="text" /><input type="password" /><button>Login</button></form>
</body>
</html>`;

function mockFetchHtml(html: string, contentType = 'text/html') {
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h === 'content-type' ? contentType : null) },
    text: async () => html,
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  mockedCallClaude.mockReset();
});

describe('fetchArticleContent', () => {
  it('extracts article via Readability without calling Claude', async () => {
    mockFetchHtml(ARTICLE_HTML);
    const result = await fetchArticleContent('https://example.com/article');
    expect(result.title).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(100);
    expect(mockedCallClaude).not.toHaveBeenCalled();
  });

  it('falls back to Claude when Readability returns insufficient content', async () => {
    mockFetchHtml(NO_ARTICLE_HTML);
    mockedCallClaude.mockResolvedValue(
      'TITLE: Fallback Title\n---\nThis is the fallback article content extracted by Claude from the HTML page with sufficient length to pass validation checks.',
    );
    const result = await fetchArticleContent('https://example.com/login');
    expect(mockedCallClaude).toHaveBeenCalled();
    expect(result.title).toBe('Fallback Title');
    expect(result.text).toContain('fallback article content');
  });

  it('throws when both Readability and Claude fail', async () => {
    mockFetchHtml(NO_ARTICLE_HTML);
    mockedCallClaude.mockResolvedValue('NO_ARTICLE_CONTENT');
    await expect(fetchArticleContent('https://example.com/login')).rejects.toThrow(
      'No meaningful article content',
    );
  });

  it('rejects non-HTTP URLs', async () => {
    await expect(fetchArticleContent('ftp://example.com')).rejects.toThrow('complete URL');
  });

  it('rejects non-HTML content types', async () => {
    mockFetchHtml('binary data', 'application/pdf');
    await expect(fetchArticleContent('https://example.com/file.pdf')).rejects.toThrow('HTML page');
  });
});
