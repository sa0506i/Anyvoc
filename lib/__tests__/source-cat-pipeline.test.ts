/**
 * source_cat round-trip tests — the LLM emits a per-entry "source_cat"
 * field (def|indef|bare) that reports the article category it
 * extracted. Pipeline preserves it on returned entries for sweep
 * metrics; not persisted to DB.
 */

// Mock classifyWord before importing claude.ts (same pattern as claude.test.ts).
jest.mock('../classifier', () => ({
  classifyWord: jest.fn().mockResolvedValue('B1'),
}));

import { extractVocabulary, translateSingleWord } from '../claude';

function mockFetchOk(text: string) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }] }),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('extractVocabulary — source_cat round-trip', () => {
  it('preserves source_cat on returned entries when LLM provides it', async () => {
    const llmResponse = JSON.stringify([
      {
        original: 'der Hund',
        translation: 'the dog',
        level: '',
        type: 'noun',
        source_cat: 'def',
        source_forms: ['Hund'],
      },
      {
        original: 'ein Kind',
        translation: 'a child',
        level: '',
        type: 'noun',
        source_cat: 'indef',
        source_forms: ['Kinder'],
      },
    ]);
    global.fetch = mockFetchOk(llmResponse);
    const result = await extractVocabulary(
      'Der Hund bellt. Ein Kind spielt.',
      'English',
      'German',
      'de',
      'en',
    );
    expect(result).toHaveLength(2);
    expect(result[0].source_cat).toBe('def');
    expect(result[1].source_cat).toBe('indef');
  });

  it('accepts entries without source_cat (LLM omission tolerated)', async () => {
    const llmResponse = JSON.stringify([
      { original: 'der Hund', translation: 'the dog', level: '', type: 'noun', source_forms: [] },
    ]);
    global.fetch = mockFetchOk(llmResponse);
    const result = await extractVocabulary('x', 'English', 'German', 'de', 'en');
    expect(result).toHaveLength(1);
    expect(result[0].source_cat).toBeUndefined();
  });
});

describe('translateSingleWord — source_cat round-trip', () => {
  it('returns source_cat when LLM provides it', async () => {
    const llmResponse = JSON.stringify({
      original: 'der Hund',
      translation: 'the dog',
      level: '',
      type: 'noun',
      source_cat: 'def',
    });
    global.fetch = mockFetchOk(llmResponse);
    const result = await translateSingleWord('Hund', 'German', 'English', 'de', 'en');
    expect(result.source_cat).toBe('def');
  });
});
