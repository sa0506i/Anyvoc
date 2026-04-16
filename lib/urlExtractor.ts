import { callClaude } from './claude';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const FETCH_TIMEOUT_MS = 10000;
const MIN_CONTENT_LENGTH = 50;
const READABILITY_MIN_LENGTH = 100;

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/** Strip tags that only add noise and tokens (scripts, styles, SVGs, etc.) */
function stripNoiseTags(html: string): string {
  const tags = ['script', 'style', 'noscript', 'iframe', 'svg', 'link', 'meta'];
  let result = html;
  for (const tag of tags) {
    result = result.replace(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi'), '');
    result = result.replace(new RegExp(`<${tag}[^>]*/?>`, 'gi'), '');
  }
  result = result.replace(/<!--[\s\S]*?-->/g, '');
  return result;
}

/** Truncate HTML to stay within Claude's practical input limits. */
function truncateHtml(html: string, maxChars: number = 60000): string {
  if (html.length <= maxChars) return html;
  return html.substring(0, maxChars) + '\n[... truncated ...]';
}

async function fetchHtml(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Please enter a complete URL starting with https:// or http://');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(
        `Could not fetch the URL (HTTP ${response.status}). The website may be blocking automated access or the link may be invalid.`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (
      !contentType.includes('text/html') &&
      !contentType.includes('text/plain') &&
      !contentType.includes('xhtml')
    ) {
      throw new Error('This URL does not point to an HTML page. Only web articles are supported.');
    }

    const html = await response.text();
    return html;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('Could not fetch') ||
        error.message.startsWith('This URL does not') ||
        error.message.startsWith('Please enter'))
    ) {
      throw error;
    }
    throw new Error(
      'Could not fetch the URL. The website may be blocking automated access or the link may be invalid.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Try to extract article content using Mozilla Readability (offline, zero API cost).
 * Returns { title, text } or null if extraction fails or yields insufficient content.
 */
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

/**
 * Fallback: extract article content using Claude API (existing logic).
 */
async function extractWithClaude(
  cleanedHtml: string,
  url: string,
): Promise<{ title: string; text: string }> {
  const systemPrompt = `You are an article extraction assistant. Given raw HTML of a webpage, extract ONLY the main article content as clean plain text.

Rules:
- Extract the article title and the article body text
- Do NOT include: navigation menus, advertisements, cookie banners, sidebars, footer content, author bios, related article links, comments, social media buttons, or any other non-article content
- Preserve paragraph structure with blank lines between paragraphs
- Do NOT include any HTML tags in your output
- If the page does not contain a meaningful article (e.g. it is a login page, error page, or landing page with no article), respond with exactly: NO_ARTICLE_CONTENT

Respond in this exact format:
TITLE: <the article title>
---
<the article body text>`;

  const result = await callClaude([{ role: 'user', content: cleanedHtml }], systemPrompt, 8192);

  if (result.includes('NO_ARTICLE_CONTENT')) {
    throw new Error('No meaningful article content could be extracted from this URL.');
  }

  const separatorIndex = result.indexOf('---');
  let title: string;
  let text: string;

  if (separatorIndex !== -1) {
    const titleLine = result.substring(0, separatorIndex).trim();
    title = titleLine.replace(/^TITLE:\s*/i, '').trim();
    text = result.substring(separatorIndex + 3).trim();
  } else {
    title = url;
    text = result.trim();
  }

  if (!title) title = url;

  if (text.length < MIN_CONTENT_LENGTH) {
    throw new Error('No meaningful article content could be extracted from this URL.');
  }

  return { title, text };
}

/** Block-level tags that need paragraph breaks in textContent extraction. */
const BLOCK_TAGS = [
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BR',
  'BLOCKQUOTE',
  'PRE',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'DT',
  'DD',
];

/** Class-name fragments that indicate non-article content. */
const NOISE_CLASS_PATTERNS = [
  'infobox',
  'sidebar',
  'breadcrumb',
  'byline',
  'metadata',
  'share',
  'social',
  'navbox',
  'catlinks',
  'mw-editsection',
];

/**
 * Take Readability's cleaned article HTML and extract only the main
 * article text, removing tables, figure captions, footnote refs,
 * breadcrumbs, duplicate leads, and trailing metadata.
 */
export function cleanArticleHtml(html: string): string {
  if (!html || !html.trim()) return '';

  const { document } = parseHTML(`<div id="__root">${html}</div>`);

  // Phase 1: DOM element removal
  document.querySelectorAll('table').forEach((el: Element) => el.remove());
  document.querySelectorAll('figure, figcaption').forEach((el: Element) => el.remove());
  document.querySelectorAll('nav, aside').forEach((el: Element) => el.remove());

  // Remove footnote-reference <sup> elements that contain only link numbers
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

  // Insert newlines after block-level elements so textContent preserves paragraph breaks
  const root = document.getElementById('__root');
  if (root) {
    root.querySelectorAll(BLOCK_TAGS.join(',')).forEach((el: Element) => {
      el.append('\n\n');
    });
  }

  // Phase 2: Text post-processing
  let text = (root?.textContent || '').trim();
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
  text = text.replace(
    /\n+(?:\d{1,2}[.\s]+)?(?:January|February|March|April|May|June|July|August|September|October|November|December|Janeiro|Fevereiro|Mar[cç]o|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro|Januar|Februar|M[aä]rz|Mai|Juni|Juli|Oktober|Dezember)[\s.,]+\d{1,4}[\s.,]*\d{0,4}(?:[\s.:]+\d{1,2}(?:[:.]?\d{2})?)?\s*$/i,
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

export async function fetchArticleContent(url: string): Promise<{ title: string; text: string }> {
  const rawHtml = await fetchHtml(url);

  // Try Readability first (offline, free)
  const readabilityResult = extractWithReadability(rawHtml);
  if (readabilityResult) {
    return readabilityResult;
  }

  // Fallback to Claude API
  const cleanedHtml = truncateHtml(stripNoiseTags(rawHtml));
  return extractWithClaude(cleanedHtml, url);
}
