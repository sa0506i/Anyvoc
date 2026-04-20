/**
 * Covers the shared JSON-array parser the two-phase extraction spike
 * relies on. Same repair expectations as the inline parser in
 * lib/claude.ts extractVocabulary, but extracted as a pure helper.
 */

import { parseJsonArrayWithRepair } from './parseJsonArray';

describe('parseJsonArrayWithRepair', () => {
  it('parses a clean JSON array', () => {
    const raw = '[{"original":"der Hund","type":"noun"},{"original":"laufen","type":"verb"}]';
    const out = parseJsonArrayWithRepair(raw, 'test');
    expect(out).not.toBeNull();
    expect(out).toHaveLength(2);
    expect(out![0].original).toBe('der Hund');
  });

  it('recovers from a truncated array by returning the last complete object', () => {
    const raw =
      '[{"original":"der Hund","type":"noun"},{"original":"laufen","type":"verb"},{"origi';
    const out = parseJsonArrayWithRepair(raw, 'test');
    expect(out).not.toBeNull();
    expect(out).toHaveLength(2);
    expect(out![1].original).toBe('laufen');
  });

  it('returns null when there is no JSON array at all', () => {
    const out = parseJsonArrayWithRepair('I cannot help with that.', 'test');
    expect(out).toBeNull();
  });

  it('handles escaped quotes inside strings during repair', () => {
    const raw =
      '[{"original":"avec \\"guillemets\\"","type":"phrase"},{"original":"x","type":"noun"}]';
    const out = parseJsonArrayWithRepair(raw, 'test');
    expect(out).not.toBeNull();
    expect(out![0].original).toBe('avec "guillemets"');
  });

  it('tolerates prose before the array', () => {
    const raw = 'Here is the JSON:\n[{"original":"der Hund","type":"noun"}]';
    const out = parseJsonArrayWithRepair(raw, 'test');
    expect(out).not.toBeNull();
    expect(out).toHaveLength(1);
  });
});
