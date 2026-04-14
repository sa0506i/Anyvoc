import { truncateAtSentence, applyBasicLimit, BASIC_MODE_CHAR_LIMIT } from './truncate';

describe('truncateAtSentence', () => {
  it('returns unchanged text when shorter than limit', () => {
    expect(truncateAtSentence('Hello world.', 100)).toEqual({
      text: 'Hello world.',
      truncated: false,
    });
  });

  it('returns unchanged text when exactly at limit', () => {
    const text = 'a'.repeat(100);
    expect(truncateAtSentence(text, 100)).toEqual({ text, truncated: false });
  });

  it('returns empty string unchanged', () => {
    expect(truncateAtSentence('', 100)).toEqual({ text: '', truncated: false });
  });

  it('cuts at the last sentence boundary within the limit', () => {
    const text = 'First sentence. Second sentence is here. Third.';
    const result = truncateAtSentence(text, 30);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('First sentence.');
  });

  it('handles sentence ending with closing quote', () => {
    const text = 'He said "Hello." And then he left the building forever.';
    const result = truncateAtSentence(text, 20);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('He said "Hello."');
  });

  it('handles German / European punctuation (? ! …)', () => {
    const text = 'Wirklich? Nein! Doch… Und dann kam der lange Rest des Satzes hier.';
    const result = truncateAtSentence(text, 22);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('Wirklich? Nein! Doch…');
  });

  it('falls back to word boundary when no sentence end exists in first N chars', () => {
    const text = 'word '.repeat(300); // 1500 chars, no punctuation
    const result = truncateAtSentence(text, 1000);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeGreaterThanOrEqual(1000);
    expect(result.text.length).toBeLessThanOrEqual(1010);
    expect(result.text.endsWith('word')).toBe(true);
  });

  it('returns pathological single long token unchanged (flagged truncated)', () => {
    const text = 'x'.repeat(1200);
    const result = truncateAtSentence(text, 1000);
    expect(result.text).toBe(text);
    expect(result.truncated).toBe(true);
  });

  it('default limit is BASIC_MODE_CHAR_LIMIT (1000)', () => {
    expect(BASIC_MODE_CHAR_LIMIT).toBe(1000);
    const text = 'A sentence. '.repeat(200);
    const result = truncateAtSentence(text);
    expect(result.text.length).toBeLessThanOrEqual(1000);
    expect(result.truncated).toBe(true);
  });
});

describe('applyBasicLimit', () => {
  it('bypasses truncation when proMode is true', () => {
    const text = 'x'.repeat(5000);
    expect(applyBasicLimit(text, true)).toEqual({ text, truncated: false });
  });

  it('applies truncation when proMode is false', () => {
    const text = 'A sentence. '.repeat(200);
    const result = applyBasicLimit(text, false);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(1000);
  });
});
