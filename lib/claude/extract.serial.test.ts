/**
 * Regression tests for the 'serial' kill-switch path in extract.ts.
 *
 * Guards that flipping EXTRACTION_MODE to 'serial' restores the
 * pre-2026-04-24 behaviour:
 *   - A 5000-char text stays as exactly 1 LLM call (not 2).
 *   - Longer texts iterate chunks sequentially (second call does not
 *     begin until the first resolves).
 *   - Output is merged and deduped identically to the parallel path.
 *
 * Mocks EXTRACTION_MODE at the module level; the production default
 * ('parallel') is asserted separately in extractionMode.test.ts.
 */

jest.mock('../classifier', () => ({
  classifyWord: jest.fn().mockResolvedValue('B1'),
}));

jest.mock('./extractionMode', () => ({
  EXTRACTION_MODE: 'serial',
}));

import { extractVocabulary } from './extract';

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('extractVocabulary — serial kill-switch path', () => {
  it('fires exactly 1 LLM call for a 5000-char text (no 2500-char split)', async () => {
    const json = JSON.stringify([
      { original: 'w', translation: 'w-t', level: '', type: 'other', source_forms: [] },
    ]);
    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: json }] }),
    }));

    // 4002 chars — would split into 2 chunks at PARALLEL_EXTRACT_CHUNK_CHARS
    // = 2500, but stays as 1 chunk at SERIAL_EXTRACT_CHUNK_CHARS = 5000.
    const text = 'A'.repeat(2000) + '. ' + 'B'.repeat(2000) + '.';
    await extractVocabulary(text, 'English', 'German', 'de', 'en');

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('iterates multi-chunk texts sequentially (second call waits for first)', async () => {
    // Build a text that splits at 5000-char threshold into 2 chunks.
    const text = 'A'.repeat(4500) + '. ' + 'B'.repeat(4500) + '.';
    const json = JSON.stringify([
      { original: 'w', translation: 'w-t', level: '', type: 'other', source_forms: [] },
    ]);

    // Track in-flight concurrency. If serial, max should be 1.
    let inFlight = 0;
    let maxInFlight = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Give the other chunk a chance to race if Promise.all were used.
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text: json }] }),
      };
    });

    await extractVocabulary(text, 'English', 'German', 'de', 'en');

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
    expect(maxInFlight).toBe(1);
  });

  it('still merges + dedupes multi-chunk results in serial mode', async () => {
    // Two chunks each returning the same word → dedup collapses to 1.
    const text = 'A'.repeat(4500) + '. ' + 'B'.repeat(4500) + '.';
    const dup = {
      original: 'ein Hund',
      translation: 'a dog',
      level: '',
      type: 'noun',
      source_forms: [],
    };
    const json = JSON.stringify([dup]);
    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: json }] }),
    }));

    const result = await extractVocabulary(text, 'English', 'German', 'de', 'en');
    expect(result.filter((v) => v.original === 'ein Hund').length).toBe(1);
  });
});
