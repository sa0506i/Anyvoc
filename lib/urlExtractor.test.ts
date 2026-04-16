/**
 * Tests for Readability-based article extraction in urlExtractor.ts.
 *
 * We mock `fetch` and `callClaude` to isolate the extraction logic.
 */

jest.mock('./claude', () => ({
  callClaude: jest.fn(),
}));

import { fetchArticleContent, cleanArticleHtml } from './urlExtractor';
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

  it('deduplicates lead paragraph when teaser repeats first body paragraph (prefix)', () => {
    const html = `
      <div>
        <p>The regiment is hosting the parachute course until day 23.</p>
        <p>The regiment is hosting the parachute course until day 23. Additional details follow in this extended version of the lead.</p>
        <p>Second body paragraph with different content.</p>
      </div>`;
    const text = cleanArticleHtml(html);
    const matches = text.match(/The regiment is hosting/g);
    expect(matches).toHaveLength(1);
    expect(text).toContain('Second body paragraph');
  });

  it('deduplicates lead paragraph when teaser has >80% word overlap with body', () => {
    const html = `
      <div>
        <p>O Regimento de Infantaria está a acolher até dia 23 o Curso de Paraquedista</p>
        <p>O Regimento de Infantaria está a acolher até dia 23 o Curso de Paraquedista 01/2026. Mais detalhes sobre o curso seguem aqui.</p>
        <p>Second body paragraph with different content.</p>
      </div>`;
    const text = cleanArticleHtml(html);
    const matches = text.match(/O Regimento de Infantaria/g);
    expect(matches).toHaveLength(1);
    expect(text).toContain('Second body paragraph');
  });

  it('strips leading breadcrumb fragments (short lines without punctuation)', () => {
    const html = `
      <div>
        <div>DR</div>
        <div>Atualidade</div>
        <div>Aveiro</div>
        <p>O Regimento de Infantaria está a acolher o curso.</p>
      </div>`;
    const text = cleanArticleHtml(html);
    expect(text).not.toMatch(/^DR/);
    expect(text).not.toContain('Atualidade');
    expect(text).not.toContain('Aveiro');
    expect(text).toContain('O Regimento de Infantaria');
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

  it('preserves paragraph breaks for block-level elements without <p> wrappers', () => {
    const html = `
      <div>
        <div>First block of content.</div>
        <div>Second block of content.</div>
        <li>A list item.</li>
      </div>`;
    const text = cleanArticleHtml(html);
    expect(text).toContain('First block of content.');
    expect(text).toContain('Second block of content.');
    expect(text).toContain('A list item.');
    // Each block should be on its own paragraph (separated by blank line)
    expect(text).toMatch(/First block of content\.\n\nSecond block of content\./);
  });

  it('returns empty string for empty or whitespace-only input', () => {
    expect(cleanArticleHtml('')).toBe('');
    expect(cleanArticleHtml('   ')).toBe('');
    expect(cleanArticleHtml('<div>   </div>')).toBe('');
  });
});
