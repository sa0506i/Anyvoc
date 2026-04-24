/**
 * Regression tests for the parallel-chunk extraction path in extract.ts.
 *
 * Guards that:
 *   - A text > PARALLEL_EXTRACT_CHUNK_CHARS (2500) is split into 2 chunks.
 *   - Both chunks' LLM responses are fetched and merged into one result.
 *   - Promise.all fires both fetches before either resolves (parallel, not
 *     sequential) — the core latency win behind the refactor.
 *   - postProcessExtractedVocab dedupes cross-chunk (original, type) collisions.
 *   - The repetition-loop console.warn fires per-chunk only — two chunks each
 *     emitting one copy of the same word do NOT trip the diagnostic.
 *
 * See plan: "Parallele Vokabelextraktion für lange Pro-Mode-Texte".
 */

jest.mock('../classifier', () => ({
  classifyWord: jest.fn().mockResolvedValue('B1'),
}));

import { extractVocabulary } from './extract';

// Helper: build a deferred that resolves to a mocked Claude JSON response.
function deferredFetchResponse(text: string) {
  let resolve: (v: { ok: true; status: 200; json: () => Promise<unknown> }) => void = () => {};
  const promise = new Promise<{ ok: true; status: 200; json: () => Promise<unknown> }>((r) => {
    resolve = r;
  });
  return {
    promise,
    settle: () =>
      resolve({
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: 'text', text }] }),
      }),
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
});

// Build text long enough that chunkText(PARALLEL_EXTRACT_CHUNK_CHARS=2500)
// produces exactly 2 chunks. Two 2000-char "sentences" joined by ". " sum
// to 4002 chars; the chunker splits at the sentence boundary after the
// first period, giving two ~2000-char halves.
function buildTwoChunkText(): string {
  const first = 'A'.repeat(2000) + '. ';
  const second = 'B'.repeat(2000) + '.';
  return first + second;
}

describe('extractVocabulary — parallel chunk extraction', () => {
  it('splits text over 2500 chars into 2 LLM calls and merges results', async () => {
    const json1 = JSON.stringify([
      { original: 'alpha', translation: 'alpha-t', level: '', type: 'other', source_forms: [] },
    ]);
    const json2 = JSON.stringify([
      { original: 'beta', translation: 'beta-t', level: '', type: 'other', source_forms: [] },
    ]);
    let call = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      call++;
      // Snapshot call number NOW so the closure below returns the
      // correct response even when parallel chunks race (the mock
      // function body runs synchronously at fetch-time; json() runs
      // later).
      const n = call;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: n === 1 ? json1 : json2 }],
        }),
      };
    });

    const result = await extractVocabulary(buildTwoChunkText(), 'English', 'German', 'de', 'en');

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(2);
    const originals = result.map((v) => v.original).sort();
    expect(originals).toEqual(['alpha', 'beta']);
  });

  it('fires both chunk requests concurrently (parallel, not sequential)', async () => {
    const def1 = deferredFetchResponse(
      JSON.stringify([
        { original: 'a', translation: 'a-t', level: '', type: 'other', source_forms: [] },
      ]),
    );
    const def2 = deferredFetchResponse(
      JSON.stringify([
        { original: 'b', translation: 'b-t', level: '', type: 'other', source_forms: [] },
      ]),
    );

    let calls = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      calls++;
      return calls === 1 ? def1.promise : def2.promise;
    });

    const extractPromise = extractVocabulary(buildTwoChunkText(), 'English', 'German', 'de', 'en');

    // Yield a couple of microtask ticks so callClaude in each parseChunk
    // has a chance to invoke fetch. In a serial implementation only the
    // first fetch would be in-flight at this point.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toBe(2); // both in-flight before either resolves → parallel

    def1.settle();
    def2.settle();
    await extractPromise;
  });

  it('dedupes a word that appears in both chunks to a single entry', async () => {
    const shared = {
      original: 'ein Hund',
      translation: 'a dog',
      level: '',
      type: 'noun',
      source_forms: [],
    };
    const json = JSON.stringify([shared]);
    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: json }] }),
    }));

    const result = await extractVocabulary(buildTwoChunkText(), 'English', 'German', 'de', 'en');

    // Both chunks returned the same item; postProcessExtractedVocab dedup
    // (Rule 33) collapses to one.
    const hundCount = result.filter((v) => v.original === 'ein Hund').length;
    expect(hundCount).toBe(1);
  });

  it('does NOT fire the repetition-loop warner across chunks (per-chunk scope)', async () => {
    // Each chunk returns exactly one copy of the same word. In a single-
    // chunk path this would be 1 entry (no run ≥3). Parallel implementation
    // must not see "3 consecutive identical" across chunks as a run.
    const dup = {
      original: 'alpha',
      translation: 'alpha-t',
      level: '',
      type: 'other',
      source_forms: [],
    };
    const json = JSON.stringify([dup]);
    global.fetch = jest.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: json }] }),
    }));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await extractVocabulary(buildTwoChunkText(), 'English', 'German', 'de', 'en');

    const repetitionWarns = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('repetition loop detected'),
    );
    expect(repetitionWarns).toHaveLength(0);
  });

  it('still fires repetition-loop warner when one chunk emits ≥3 consecutive duplicates', async () => {
    // Regression guard: the per-chunk scoped warner must still trip inside
    // a single chunk that carries a real loop.
    const dup = { original: 'x', translation: 'x', level: '', type: 'other', source_forms: [] };
    const loopJson = JSON.stringify([dup, dup, dup, dup]);
    const otherJson = JSON.stringify([
      { original: 'y', translation: 'y', level: '', type: 'other', source_forms: [] },
    ]);
    let call = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      call++;
      const n = call;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: n === 1 ? loopJson : otherJson }],
        }),
      };
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await extractVocabulary(buildTwoChunkText(), 'English', 'German', 'de', 'en');

    const repetitionWarns = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('repetition loop detected'),
    );
    expect(repetitionWarns.length).toBeGreaterThanOrEqual(1);
  });
});
