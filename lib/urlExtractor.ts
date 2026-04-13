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
    if (
      !article ||
      !article.textContent ||
      article.textContent.trim().length < READABILITY_MIN_LENGTH
    ) {
      return null;
    }
    return {
      title: article.title || '',
      text: article.textContent.trim(),
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
