/**
 * Slice 3/7 — source_cat extraction through the pipeline.
 *
 * Under v2 the LLM emits a per-entry "source_cat" field (def|indef|bare)
 * that reports the article category it extracted. The pipeline:
 *   1. Parses source_cat from the LLM response.
 *   2. Surfaces it on the returned ExtractedVocab entries (not persisted
 *      to DB — strictly pipeline metadata).
 *   3. Leaves the LLM's translation untouched; source_cat is recorded so
 *      the sweep in Slice 7 can compute Translation-Target Match Rate
 *      (LLM translation vs matrixTranslationTarget(source_cat, native)).
 *
 * v1 mode treats source_cat as absent regardless of LLM output.
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

const ORIGINAL_ENV = process.env.ANYVOC_PROMPT_VERSION;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.ANYVOC_PROMPT_VERSION;
  else process.env.ANYVOC_PROMPT_VERSION = ORIGINAL_ENV;
  jest.restoreAllMocks();
});

describe('extractVocabulary — source_cat round-trip under v2', () => {
  it('preserves source_cat on returned entries when LLM provides it', async () => {
    process.env.ANYVOC_PROMPT_VERSION = 'v2';
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
    process.env.ANYVOC_PROMPT_VERSION = 'v2';
    const llmResponse = JSON.stringify([
      { original: 'der Hund', translation: 'the dog', level: '', type: 'noun', source_forms: [] },
    ]);
    global.fetch = mockFetchOk(llmResponse);
    const result = await extractVocabulary('x', 'English', 'German', 'de', 'en');
    expect(result).toHaveLength(1);
    expect(result[0].source_cat).toBeUndefined();
  });

  it('v1 mode: source_cat is stripped from output even if LLM sneaks it in', async () => {
    delete process.env.ANYVOC_PROMPT_VERSION; // default = v1
    const llmResponse = JSON.stringify([
      {
        original: 'der Hund',
        translation: 'the dog',
        level: '',
        type: 'noun',
        source_cat: 'def',
        source_forms: [],
      },
    ]);
    global.fetch = mockFetchOk(llmResponse);
    const result = await extractVocabulary('x', 'English', 'German', 'de', 'en');
    expect(result).toHaveLength(1);
    expect(result[0].source_cat).toBeUndefined();
  });
});

describe('translateSingleWord — source_cat round-trip under v2', () => {
  it('returns source_cat when LLM provides it (v2 mode)', async () => {
    process.env.ANYVOC_PROMPT_VERSION = 'v2';
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

  it('strips source_cat in v1 mode even if LLM returns it', async () => {
    delete process.env.ANYVOC_PROMPT_VERSION;
    const llmResponse = JSON.stringify({
      original: 'der Hund',
      translation: 'the dog',
      level: '',
      type: 'noun',
      source_cat: 'def',
    });
    global.fetch = mockFetchOk(llmResponse);
    const result = await translateSingleWord('Hund', 'German', 'English', 'de', 'en');
    expect(result.source_cat).toBeUndefined();
  });
});
