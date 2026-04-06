/**
 * Classifier unit tests. Run with `npm test`.
 *
 * The Claude API path is mocked at the module boundary so no network calls
 * happen and we can assert on request parameters.
 */

import { CEFR_LEVELS } from '../../constants/levels';

// Mock the Claude API module so the fallback path is fully observable.
jest.mock('../claude', () => ({
  callClaude: jest.fn(),
}));

import { callClaude } from '../claude';
import {
  classifyWord,
  classifyWordWithConfidence,
} from './index';
import { clearCache, __resetDbForTests } from './cache';
import { __resetRateLimitForTests } from './fallback';

const mockedCallClaude = callClaude as jest.MockedFunction<typeof callClaude>;

beforeEach(() => {
  mockedCallClaude.mockReset();
  clearCache();
  __resetDbForTests();
  __resetRateLimitForTests();
});

const isCefr = (s: string) =>
  (CEFR_LEVELS as readonly string[]).includes(s);

describe('classifyWord — local classification', () => {
  it('cat (en) → A1', async () => {
    expect(await classifyWord('cat', 'en')).toBe('A1');
  });

  it('Hund (de) → A1', async () => {
    expect(await classifyWord('Hund', 'de')).toBe('A1');
  });

  it('der Hund (de) — article-stripped → A1', async () => {
    expect(await classifyWord('der Hund', 'de')).toBe('A1');
  });

  it('chat (fr) → A1', async () => {
    expect(await classifyWord('chat', 'fr')).toBe('A1');
  });

  it('chien (fr) → A1', async () => {
    expect(await classifyWord('chien', 'fr')).toBe('A1');
  });

  // Regression: PT feminine singular 'a' was missing from ARTICLE_PREFIXES,
  // causing "a posse" to fall through to fb=2 → Claude fallback and produce
  // non-deterministic results between auto-extraction and manual add.
  it('a posse (pt) — article "a" is stripped → deterministic local label', async () => {
    const lvl = await classifyWord('a posse', 'pt');
    // "posse" has zipf ≈ 4.9 in freq_pt.json; must NOT be C2 (would indicate
    // the stem lookup still misses), and must NOT trigger the Claude fallback.
    expect(['A1', 'A2', 'B1', 'B2']).toContain(lvl);
    expect(mockedCallClaude).not.toHaveBeenCalled();
  });

  it('Episteme (de) → C2 (rare, fallback path returns local C2)', async () => {
    // No mock set → callClaude returns undefined → fallback bails to local label.
    mockedCallClaude.mockResolvedValue('');
    expect(await classifyWord('Episteme', 'de')).toBe('C2');
  });

  // Spec assertion: `philosophy → C1 or C2`. Unblocked once both
  //   - real Kuperman AoA data (TODO #3)
  //   - ordinal-logit threshold calibration (TODO #2, npm run calibrate)
  // were in place. Current model puts it at C1.
  it('philosophy (en) → C1 or C2', async () => {
    const out = await classifyWord('philosophy', 'en');
    expect(['C1', 'C2']).toContain(out);
  });

  it('always returns a valid CEFR label', async () => {
    for (const word of ['the', 'cat', 'xqzpv', 'der', 'chat', 'phénoménologie']) {
      const lang = word === 'chat' || word === 'phénoménologie' ? 'fr' : word === 'der' ? 'de' : 'en';
      const lvl = await classifyWord(word, lang);
      expect(isCefr(lvl)).toBe(true);
    }
  });

  it('throws on unsupported language code', async () => {
    await expect(classifyWord('hello', 'xx')).rejects.toThrow(/Unsupported language/);
  });
});

describe('classifyWord — Claude API fallback', () => {
  it('triggers API call when fallbackCount >= 2 and zipf === 0', async () => {
    mockedCallClaude.mockResolvedValueOnce('B2');
    const out = await classifyWord('xqzpvword', 'en');
    expect(out).toBe('B2');
    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
  });

  it('uses temperature: 0 in the API request', async () => {
    mockedCallClaude.mockResolvedValueOnce('A2');
    await classifyWord('xqzpvword', 'en');
    const call = mockedCallClaude.mock.calls[0];
    // Signature: (messages, systemPrompt, maxTokens, options)
    expect(call[3]).toEqual(expect.objectContaining({ temperature: 0 }));
    expect(call[2]).toBe(10);
  });

  it('does NOT call the API a second time for a cached word', async () => {
    mockedCallClaude.mockResolvedValueOnce('B1');
    const first = await classifyWord('xqzpvword', 'en');
    const second = await classifyWord('xqzpvword', 'en');
    expect(first).toBe('B1');
    expect(second).toBe('B1');
    expect(mockedCallClaude).toHaveBeenCalledTimes(1);
  });

  it('returns local label when API response is invalid', async () => {
    mockedCallClaude.mockResolvedValueOnce('not a level');
    const local = await classifyWord('xqzpvword', 'en');
    expect(isCefr(local)).toBe(true);
  });

  it('returns local label when API throws', async () => {
    mockedCallClaude.mockRejectedValueOnce(new Error('network fail'));
    const local = await classifyWord('xqzpvword', 'en');
    expect(isCefr(local)).toBe(true);
  });

  it('skips API call when rate limit is hit', async () => {
    mockedCallClaude.mockResolvedValue('B1');
    // 10 unique fallback-eligible words consume the budget.
    for (let i = 0; i < 10; i++) {
      await classifyWord(`zzfallback${i}`, 'en');
    }
    expect(mockedCallClaude).toHaveBeenCalledTimes(10);

    // The 11th must NOT call the API again.
    const out = await classifyWord('zzfallback11', 'en');
    expect(mockedCallClaude).toHaveBeenCalledTimes(10);
    expect(isCefr(out)).toBe(true);
  });
});

describe('classifyWordWithConfidence', () => {
  it('returns all four fields for a high-confidence word', async () => {
    const r = await classifyWordWithConfidence('the', 'en');
    expect(r).toMatchObject({
      level: expect.any(String),
      confidence: expect.stringMatching(/^(high|medium|low)$/),
      difficulty: expect.any(Number),
      usedApiCallback: expect.any(Boolean),
    });
    expect(isCefr(r.level)).toBe(true);
  });

  it('reports usedApiCallback=true when the API actually fired', async () => {
    mockedCallClaude.mockResolvedValueOnce('C1');
    const r = await classifyWordWithConfidence('xqzpvword', 'en');
    expect(r.usedApiCallback).toBe(true);
    expect(r.level).toBe('C1');
    expect(r.confidence).toBe('low');
  });

  it('reports usedApiCallback=false on cache hit', async () => {
    mockedCallClaude.mockResolvedValueOnce('B1');
    await classifyWordWithConfidence('xqzpvword', 'en'); // populates cache
    const r = await classifyWordWithConfidence('xqzpvword', 'en');
    expect(r.usedApiCallback).toBe(false);
    expect(r.level).toBe('B1');
  });
});
