jest.mock('@infinitered/react-native-mlkit-text-recognition', () => ({
  recognizeText: jest.fn(),
}));

import { recognizeText as mlkitRecognizeText } from '@infinitered/react-native-mlkit-text-recognition';
import { validateOcrText, cleanOcrText, joinLineWraps, extractTextFromImageLocal } from './ocr';

const mockedRecognize = mlkitRecognizeText as jest.MockedFunction<typeof mlkitRecognizeText>;

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

describe('joinLineWraps', () => {
  it('joins single newlines into spaces', () => {
    const input = 'Governo e UGT deixam acordo para a\nreforma laboral num beco sem saída';
    expect(joinLineWraps(input)).toBe(
      'Governo e UGT deixam acordo para a reforma laboral num beco sem saída',
    );
  });

  it('preserves paragraph breaks (\\n\\n)', () => {
    const input = 'Paragraph one wraps\nlike this.\n\nParagraph two also wraps\nlike this.';
    expect(joinLineWraps(input)).toBe(
      'Paragraph one wraps like this.\n\nParagraph two also wraps like this.',
    );
  });

  it('normalises Windows line endings (\\r\\n) before joining', () => {
    const input = 'first line\r\nsecond line';
    expect(joinLineWraps(input)).toBe('first line second line');
  });

  it('collapses double-spaces created by trailing whitespace before the newline', () => {
    const input = 'first line  \nsecond line';
    expect(joinLineWraps(input)).toBe('first line second line');
  });

  it('does nothing to already-flat text', () => {
    const input = 'A single sentence with no newlines.';
    expect(joinLineWraps(input)).toBe('A single sentence with no newlines.');
  });

  it('handles empty input', () => {
    expect(joinLineWraps('')).toBe('');
  });

  it('trims leading and trailing whitespace from the result', () => {
    expect(joinLineWraps('  hello\nworld  ')).toBe('hello world');
  });
});

describe('extractTextFromImageLocal — integration', () => {
  beforeEach(() => {
    mockedRecognize.mockReset();
  });

  it('strips OCR garbage lines (logo / icon fragments) from the result', async () => {
    // Simulates the user's Portuguese-newspaper screenshot: real article
    // text followed by trailing logo fragments that ML Kit hallucinates
    // off stylised letters. The post-OCR filter (lib/ocrCleaning.ts)
    // should drop the trailing fragments before returning.
    mockedRecognize.mockResolvedValue({
      blocks: [],
      text: [
        'EXCLUSIVO',
        'LEGISLAÇÃO LABORAL',
        'Governo e UGT deixam acordo para a reforma laboral num beco sem saída.',
        'A UGT rejeitou por unanimidade a última versão do pacote laboral.',
        '24 de Abril de 2026',
        '1RABUsoupoA',
        'tsaLNA SOA',
        'PORTUCUTSA',
      ].join('\n'),
    });

    const out = await extractTextFromImageLocal('file:///fake.jpg');

    // Real article body kept
    expect(out).toContain('Governo e UGT deixam acordo');
    expect(out).toContain('A UGT rejeitou');
    expect(out).toContain('LEGISLAÇÃO LABORAL');

    // Garbage gone
    expect(out).not.toContain('1RABUsoupoA');
    expect(out).not.toContain('tsaLNA');
    expect(out).not.toContain('PORTUCUTSA');
  });

  it('joins ML Kit per-visual-row line wraps into continuous prose', async () => {
    // Real ML Kit output splits on EVERY visual row of the source page,
    // even mid-sentence. Without joining, the LLM sees fragmented
    // clauses. With joining (joinLineWraps), the survivors flow as one
    // sentence. ≥ 3 lines so dropGarbageLines actually evaluates.
    mockedRecognize.mockResolvedValue({
      blocks: [],
      text: [
        'Governo e UGT deixam acordo para a',
        'reforma laboral num beco sem saída',
        'A UGT rejeitou por unanimidade a última versão',
      ].join('\n'),
    });

    const out = await extractTextFromImageLocal('file:///fake.jpg');

    // Sentence reassembled as one continuous string
    expect(out).toContain('Governo e UGT deixam acordo para a reforma laboral');
    // No stray newlines mid-sentence
    expect(out).not.toContain('para a\nreforma');
  });

  it('does not strip valid all-caps headlines (corpus-known)', async () => {
    mockedRecognize.mockResolvedValue({
      blocks: [],
      text: [
        'PORTUGAL EXCLUSIVO',
        'O presidente declarou hoje que a reforma laboral seguirá adiante.',
        'A oposição respondeu com críticas duras à proposta governamental.',
      ].join('\n'),
    });

    const out = await extractTextFromImageLocal('file:///fake.jpg');

    expect(out).toContain('PORTUGAL EXCLUSIVO');
    expect(out).toContain('O presidente');
    expect(out).toContain('A oposição');
  });
});
