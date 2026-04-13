/**
 * Jest tests for lib/claude.ts
 *
 * All network calls are mocked via global.fetch — no real API calls are made.
 * classifyWord is mocked to avoid importing the full classifier tree.
 */

// Mock classifyWord before importing claude.ts
jest.mock('./classifier', () => ({
  classifyWord: jest.fn().mockResolvedValue('B1'),
}));

import {
  callClaude,
  ClaudeAPIError,
  chunkText,
  detectLanguage,
  extractVocabulary,
  translateText,
  translateSingleWord,
} from './claude';

// Helper to create a successful fetch Response
function mockFetchOk(text: string) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text }],
    }),
  });
}

// Helper to create a failed fetch Response
function mockFetchError(status: number, body = '') {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => body,
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
});

// ---------- callClaude ----------

describe('callClaude', () => {
  it('returns text from a successful response', async () => {
    global.fetch = mockFetchOk('hello world');
    const result = await callClaude(
      [{ role: 'user', content: 'hi' }],
      'system',
    );
    expect(result).toBe('hello world');
  });

  it('sends correct request body', async () => {
    global.fetch = mockFetchOk('ok');
    await callClaude(
      [{ role: 'user', content: 'test' }],
      'sys prompt',
      1024,
      { temperature: 0.5 },
    );

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe('mistral-small-2506');
    expect(body.max_tokens).toBe(1024);
    expect(body.system).toBe('sys prompt');
    expect(body.messages).toEqual([{ role: 'user', content: 'test' }]);
    expect(body.temperature).toBe(0.5);
  });

  it('omits temperature when not provided', async () => {
    global.fetch = mockFetchOk('ok');
    await callClaude([{ role: 'user', content: 'x' }], 'sys');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.temperature).toBeUndefined();
  });

  it('throws ClaudeAPIError on 401', async () => {
    global.fetch = mockFetchError(401);
    await expect(
      callClaude([{ role: 'user', content: 'x' }], 'sys'),
    ).rejects.toThrow(ClaudeAPIError);
    await expect(
      callClaude([{ role: 'user', content: 'x' }], 'sys'),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws ClaudeAPIError on 429', async () => {
    global.fetch = mockFetchError(429);
    await expect(
      callClaude([{ role: 'user', content: 'x' }], 'sys'),
    ).rejects.toThrow(ClaudeAPIError);
    await expect(
      callClaude([{ role: 'user', content: 'x' }], 'sys'),
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it('throws ClaudeAPIError on 500 with body', async () => {
    global.fetch = mockFetchError(500, 'internal error');
    await expect(
      callClaude([{ role: 'user', content: 'x' }], 'sys'),
    ).rejects.toThrow(/API error \(500\): internal error/);
  });

  it('throws ClaudeAPIError when response has error field', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [],
        error: { message: 'overloaded' },
      }),
    });
    await expect(
      callClaude([{ role: 'user', content: 'x' }], 'sys'),
    ).rejects.toThrow('overloaded');
  });

  it('returns empty string when no text block found', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'image', text: 'nope' }],
      }),
    });
    const result = await callClaude([{ role: 'user', content: 'x' }], 'sys');
    expect(result).toBe('');
  });

  it('wraps network errors in ClaudeAPIError', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('DNS lookup failed'));
    await expect(
      callClaude([{ role: 'user', content: 'x' }], 'sys'),
    ).rejects.toThrow(/Network error: DNS lookup failed/);
  });

  it('wraps abort errors in ClaudeAPIError', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortErr);
    await expect(
      callClaude([{ role: 'user', content: 'x' }], 'sys'),
    ).rejects.toThrow(/timed out/);
  });
});

// ---------- chunkText ----------

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    expect(chunkText('hello')).toEqual(['hello']);
  });

  it('returns single chunk at exact limit', () => {
    const text = 'a'.repeat(5000);
    expect(chunkText(text)).toEqual([text]);
  });

  it('splits text longer than limit', () => {
    const text = 'a'.repeat(6000);
    const chunks = chunkText(text, 5000);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length + chunks[1].length).toBe(6000);
  });

  it('splits at sentence boundary when possible', () => {
    // Build a text where a sentence ends near the split point
    const sentence1 = 'A'.repeat(4600) + '. ';
    const sentence2 = 'B'.repeat(3000);
    const text = sentence1 + sentence2;
    const chunks = chunkText(text, 5000);
    expect(chunks.length).toBe(2);
    // First chunk should end after the period
    expect(chunks[0]).toMatch(/\.$/);
  });

  it('handles custom maxChars', () => {
    const text = 'a'.repeat(300);
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBe(3);
  });

  it('splits at sentence boundary with non-Latin uppercase (Czech/Polish)', () => {
    // Č and Ź are outside À-ÿ range but are uppercase Unicode letters
    // sentence1 ends with ". " near the 5000 limit, sentence2 starts with Č
    const sentence1 = 'A'.repeat(4800) + '. ';
    const sentence2 = 'Človĕk je krásný a moudrý. ' + 'B'.repeat(300);
    const text = sentence1 + sentence2;
    const chunks = chunkText(text, 5000);
    expect(chunks.length).toBe(2);
    // First chunk should end at the sentence boundary (period)
    expect(chunks[0]).toMatch(/\.$/);
  });
});

// ---------- detectLanguage ----------

describe('detectLanguage', () => {
  it('returns ISO 639-1 code for supported languages', () => {
    const result = detectLanguage('Dies ist ein ausreichend langer deutscher Text für die Spracherkennung mit der franc Bibliothek.');
    expect(result).toBe('de');
  });

  it('returns null for undetermined text', () => {
    const result = detectLanguage('123 456');
    expect(result).toBeNull();
  });
});

// ---------- extractVocabulary ----------

describe('extractVocabulary', () => {
  it('parses valid JSON array response', async () => {
    const vocabJson = JSON.stringify([
      {
        original: 'der Hund',
        translation: 'the dog',
        level: '',
        type: 'noun',
        source_forms: ['Hunde'],
      },
    ]);
    global.fetch = mockFetchOk(vocabJson);
    const result = await extractVocabulary('Der Hund ist groß.', 'English', 'German', 'de');
    expect(result).toHaveLength(1);
    expect(result[0].original).toBe('der Hund');
    expect(result[0].translation).toBe('the dog');
    // classifyWord mock returns B1
    expect(result[0].level).toBe('B1');
  });

  it('handles markdown-wrapped JSON', async () => {
    const vocabJson = '```json\n' + JSON.stringify([
      { original: 'le chat', translation: 'die Katze', level: '', type: 'noun', source_forms: [] },
    ]) + '\n```';
    global.fetch = mockFetchOk(vocabJson);
    const result = await extractVocabulary('Le chat dort.', 'German', 'French', 'fr');
    expect(result).toHaveLength(1);
    expect(result[0].original).toBe('le chat');
  });

  it('repairs truncated JSON (missing closing bracket)', async () => {
    // Simulate a response cut off mid-way through a second object
    const truncated = '[{"original":"word1","translation":"tr1","level":"","type":"noun","source_forms":[]},{"original":"word2","translation":"tr2","level":"","type":"noun","source_for';
    global.fetch = mockFetchOk(truncated);
    const result = await extractVocabulary('text', 'English', 'German', 'de');
    // Should recover at least the first complete object
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].original).toBe('word1');
  });

  it('returns empty array when response has no JSON', async () => {
    global.fetch = mockFetchOk('Sorry, I cannot extract vocabulary from this text.');
    const result = await extractVocabulary('xyz', 'English', 'German', 'de');
    expect(result).toEqual([]);
  });

  it('falls back to B1 when classifyWord throws', async () => {
    const { classifyWord } = require('./classifier');
    classifyWord.mockRejectedValueOnce(new Error('classifier broken'));

    const vocabJson = JSON.stringify([
      { original: 'test', translation: 'test', level: '', type: 'noun', source_forms: [] },
    ]);
    global.fetch = mockFetchOk(vocabJson);
    const result = await extractVocabulary('test', 'English', 'German', 'de');
    expect(result[0].level).toBe('B1');
  });
});

// ---------- translateText ----------

describe('translateText', () => {
  it('returns translation', async () => {
    global.fetch = mockFetchOk('The dog is big.');
    const result = await translateText('Der Hund ist groß.', 'German', 'English');
    expect(result).toBe('The dog is big.');
  });

  it('joins multiple chunk translations', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: `chunk${callCount}` }],
        }),
      };
    });
    // Create text that needs 2 chunks
    const text = 'A'.repeat(3000) + '. ' + 'B'.repeat(3000);
    const result = await translateText(text, 'German', 'English');
    expect(result).toContain('chunk1');
    expect(result).toContain('chunk2');
  });
});

// ---------- translateSingleWord ----------

describe('translateSingleWord', () => {
  it('parses valid JSON response', async () => {
    const json = JSON.stringify({
      original: 'der Hund',
      translation: 'the dog',
      level: '',
      type: 'noun',
    });
    global.fetch = mockFetchOk(json);
    const result = await translateSingleWord('Hund', 'German', 'English', 'de');
    expect(result.original).toBe('der Hund');
    expect(result.translation).toBe('the dog');
    expect(result.type).toBe('noun');
    expect(result.level).toBe('B1'); // from mocked classifyWord
  });

  it('returns fallback on invalid JSON', async () => {
    global.fetch = mockFetchOk('I cannot translate this.');
    const result = await translateSingleWord('xyz', 'German', 'English', 'de');
    expect(result.original).toBe('xyz');
    expect(result.type).toBe('other');
    expect(result.level).toBe('B1');
  });

  it('uses temperature 0', async () => {
    global.fetch = mockFetchOk('{}');
    await translateSingleWord('test', 'German', 'English', 'de');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.temperature).toBe(0);
  });
});
