jest.mock('@infinitered/react-native-mlkit-text-recognition', () => ({
  recognizeText: jest.fn(),
}));

import { validateOcrText, cleanOcrText } from './ocr';

describe('validateOcrText', () => {
  it('accepts valid multi-sentence text', () => {
    const text = 'Der Hund spielt im Garten. Die Katze schläft auf dem Sofa.';
    expect(validateOcrText(text)).toEqual({ valid: true });
  });

  it('rejects text shorter than 20 chars', () => {
    const result = validateOcrText('Too short');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too little text/);
  });

  it('rejects text with fewer than 3 words', () => {
    // 20+ chars but only 2 real words
    const result = validateOcrText('Abcdefghijk Lmnopqrst');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too few words/);
  });

  it('rejects text where all words are very short (< 5 chars)', () => {
    // Enough words, enough length, but no word >= 5 chars
    const result = validateOcrText('ab cd ef gh ij kl mn op qr');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/labels or short fragments/);
  });

  it('rejects text that is mostly numbers/symbols', () => {
    const result = validateOcrText('12345 67890 #$%^& 12345 67890 abcde');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/numbers or symbols/);
  });

  it('rejects fragmented text with low average word length', () => {
    // Many very short "words" (avg < 2.5, count > 5)
    const result = validateOcrText('a bb c dd e ff gg hh ii jj kk ll mm nn oo pp');
    expect(result.valid).toBe(false);
    // Could be "too few words" or "fragmented" depending on parsing
  });

  it('accepts text with Unicode letters', () => {
    const text = 'Příliš žluťoučký kůň úpěl ďábelské ódy. Tohle je dostatečně dlouhý text.';
    expect(validateOcrText(text)).toEqual({ valid: true });
  });

  it('handles whitespace-only input', () => {
    const result = validateOcrText('   \n\t  ');
    expect(result.valid).toBe(false);
  });
});

describe('cleanOcrText', () => {
  it('removes single-character lines', () => {
    const result = cleanOcrText('Hello world\nX\nGoodbye');
    expect(result).toBe('Hello world\nGoodbye');
  });

  it('removes lines that are only numbers/punctuation/symbols', () => {
    const result = cleanOcrText('Hello world\n---\n12345\nGoodbye');
    expect(result).toBe('Hello world\nGoodbye');
  });

  it('collapses multiple blank lines to double newline', () => {
    const result = cleanOcrText('Hello\n\n\n\n\nWorld');
    expect(result).toBe('Hello\n\nWorld');
  });

  it('collapses multiple spaces', () => {
    const result = cleanOcrText('Hello    world   test');
    expect(result).toBe('Hello world test');
  });

  it('trims lines and overall output', () => {
    const result = cleanOcrText('  Hello world  \n  Goodbye  ');
    expect(result).toBe('Hello world\nGoodbye');
  });

  it('preserves blank lines between paragraphs', () => {
    const result = cleanOcrText('Paragraph one.\n\nParagraph two.');
    expect(result).toBe('Paragraph one.\n\nParagraph two.');
  });

  it('handles empty input', () => {
    expect(cleanOcrText('')).toBe('');
  });
});
