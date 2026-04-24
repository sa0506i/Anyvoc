import { isLikelyGarbageToken, isLikelyGarbageLine, dropGarbageLines } from './ocrCleaning';

describe('isLikelyGarbageToken', () => {
  // ─── Real garbage from a Portuguese newspaper screenshot ──────────
  it('rejects "1RABUsoupoA" (digit-letter mix + suspicious casing)', () => {
    expect(isLikelyGarbageToken('1RABUsoupoA')).toBe(true);
  });

  it('rejects "tsaLNA" (suspicious casing + corpus miss)', () => {
    expect(isLikelyGarbageToken('tsaLNA')).toBe(true);
  });

  it('rejects "PORTUCUTSA" (suspicious all-caps + corpus miss)', () => {
    expect(isLikelyGarbageToken('PORTUCUTSA')).toBe(true);
  });

  it('rejects "kdjfhgkj" (corpus miss + 5+ consonant run)', () => {
    expect(isLikelyGarbageToken('kdjfhgkj')).toBe(true);
  });

  // ─── Real words must pass ─────────────────────────────────────────
  it('accepts "EXCLUSIVO" (Portuguese, in pt corpus)', () => {
    // Even though all-caps and length ≥ 5, corpus hit saves it.
    expect(isLikelyGarbageToken('EXCLUSIVO')).toBe(false);
  });

  it('accepts "LEGISLAÇÃO" (Portuguese with diacritics, in pt corpus)', () => {
    expect(isLikelyGarbageToken('LEGISLAÇÃO')).toBe(false);
  });

  it('accepts "LABORAL" (Portuguese, in pt corpus)', () => {
    expect(isLikelyGarbageToken('LABORAL')).toBe(false);
  });

  it('accepts "Berlin" (Capitalised, in de corpus)', () => {
    expect(isLikelyGarbageToken('Berlin')).toBe(false);
  });

  it('accepts "berlin" (lowercase, in de corpus)', () => {
    expect(isLikelyGarbageToken('berlin')).toBe(false);
  });

  // ─── Clean digit-letter affixes (units, brands) ───────────────────
  it('accepts "5km" (digit-prefix unit)', () => {
    // length 3 → MIN_TOKEN_LENGTH guard returns false even before
    // the digit-letter check. Asserts the guard, not the check.
    expect(isLikelyGarbageToken('5km')).toBe(false);
  });

  it('accepts "100kg" (digit-prefix unit, length ≥ 4)', () => {
    expect(isLikelyGarbageToken('100kg')).toBe(false);
  });

  it('accepts "iPhone15" (letter-prefix + digit suffix)', () => {
    expect(isLikelyGarbageToken('iPhone15')).toBe(false);
  });

  it('accepts "COVID-19" (hyphen-separated digit suffix)', () => {
    expect(isLikelyGarbageToken('COVID-19')).toBe(false);
  });

  it('accepts "2024" (pure digits — letter check rules it out)', () => {
    expect(isLikelyGarbageToken('2024')).toBe(false);
  });

  // ─── Length / script guards ──────────────────────────────────────
  it('skips short tokens (< 4 chars) regardless of shape', () => {
    expect(isLikelyGarbageToken('IBM')).toBe(false);
    expect(isLikelyGarbageToken('EU')).toBe(false);
    expect(isLikelyGarbageToken('B2B')).toBe(false);
    expect(isLikelyGarbageToken('a')).toBe(false);
  });

  it('skips tokens with no Latin letters (CJK, Cyrillic, pure punct)', () => {
    expect(isLikelyGarbageToken('日本語')).toBe(false);
    expect(isLikelyGarbageToken('Кириллица')).toBe(false);
    expect(isLikelyGarbageToken('?!?!?')).toBe(false);
  });

  // ─── CamelCase brands stay clean as long as in corpus ────────────
  it('accepts standard CamelCase shape (lower+Upper+lower)', () => {
    // Pattern matches the regex even if the specific brand isn't in
    // the bundled corpora — the casing shape itself isn't suspicious.
    // We can't assume "iPhone" is in the corpus, so we assert against
    // the casing classification instead via "MyWord" which is also a
    // CamelCase shape but absent from any news corpus.
    expect(isLikelyGarbageToken('MyWord')).toBe(false);
  });
});

describe('isLikelyGarbageLine', () => {
  // ─── Lines from the user's screenshot ─────────────────────────────
  it('drops "1RABUsoupoA" line', () => {
    expect(isLikelyGarbageLine('1RABUsoupoA')).toBe(true);
  });

  it('drops "tsaLNA SOA" line (one garbage, one too-short, no known)', () => {
    expect(isLikelyGarbageLine('tsaLNA SOA')).toBe(true);
  });

  it('drops "PORTUCUTSA" line', () => {
    expect(isLikelyGarbageLine('PORTUCUTSA')).toBe(true);
  });

  // ─── Real newspaper lines stay ────────────────────────────────────
  it('keeps "LEGISLAÇÃO LABORAL" (both pt-corpus hits)', () => {
    expect(isLikelyGarbageLine('LEGISLAÇÃO LABORAL')).toBe(false);
  });

  it('keeps "Governo e UGT deixam acordo para a reforma laboral"', () => {
    expect(isLikelyGarbageLine('Governo e UGT deixam acordo para a reforma laboral')).toBe(false);
  });

  it('keeps "Berlin ist die Hauptstadt" (multiple de-corpus hits)', () => {
    expect(isLikelyGarbageLine('Berlin ist die Hauptstadt')).toBe(false);
  });

  it('keeps "PORTUGAL EXCLUSIVO" (both pt-corpus hits)', () => {
    expect(isLikelyGarbageLine('PORTUGAL EXCLUSIVO')).toBe(false);
  });

  // ─── Conservative: even one corpus hit saves the line ────────────
  it('keeps a line where one token is recognised, even if siblings are gibberish', () => {
    // "Berlin" rescues the line even though "kdjfhgkj" is garbage on its own.
    expect(isLikelyGarbageLine('Berlin kdjfhgkj')).toBe(false);
  });

  // ─── Empty / whitespace ───────────────────────────────────────────
  it('returns false for empty line', () => {
    expect(isLikelyGarbageLine('')).toBe(false);
  });

  it('returns false for whitespace-only line', () => {
    expect(isLikelyGarbageLine('   ')).toBe(false);
  });
});

describe('dropGarbageLines', () => {
  it('strips trailing logo fragments from a Portuguese article', () => {
    const input = [
      'EXCLUSIVO',
      'LEGISLAÇÃO LABORAL',
      'Governo e UGT deixam acordo para a reforma laboral num beco sem saída',
      'A UGT rejeitou por unanimidade a última versão',
      '24 de Abril de 2026',
      'PORTUGUESA',
      '1RABUsoupoA',
      'tsaLNA SOA',
      'PORTUCUTSA',
    ].join('\n');

    const out = dropGarbageLines(input);

    // Real content kept
    expect(out).toContain('Governo e UGT deixam acordo');
    expect(out).toContain('LEGISLAÇÃO LABORAL');
    expect(out).toContain('A UGT rejeitou');

    // Garbage gone
    expect(out).not.toContain('1RABUsoupoA');
    expect(out).not.toContain('tsaLNA');
    expect(out).not.toContain('PORTUCUTSA');
  });

  it('no-ops on inputs with fewer than 3 non-blank lines', () => {
    // Single-line garbage stays — the safeguard prevents nuking a
    // one-line sign that happens to be a brand name.
    expect(dropGarbageLines('PORTUCUTSA')).toBe('PORTUCUTSA');
    expect(dropGarbageLines('1RABUsoupoA\ntsaLNA SOA')).toBe('1RABUsoupoA\ntsaLNA SOA');
  });

  it('returns empty input unchanged', () => {
    expect(dropGarbageLines('')).toBe('');
  });

  it('preserves blank lines between paragraphs', () => {
    const input = [
      'Paragraph one with words.',
      '',
      'Paragraph two with more words.',
      '',
      'PORTUCUTSA',
    ].join('\n');
    const out = dropGarbageLines(input);
    expect(out).toContain('Paragraph one');
    expect(out).toContain('Paragraph two');
    expect(out).not.toContain('PORTUCUTSA');
    // Blank line between paragraphs survives
    expect(out).toMatch(/Paragraph one with words\.\n\nParagraph two/);
  });
});
