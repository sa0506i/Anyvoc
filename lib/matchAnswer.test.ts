import { matchAnswer } from './matchAnswer';

describe('matchAnswer', () => {
  // ── Rule 1: Exact match after normalization ──────────────────────
  it('returns exact for identical strings', () => {
    expect(matchAnswer('der Arzt', 'der Arzt')).toEqual({
      match: 'exact',
      expected: 'der Arzt',
    });
  });

  it('returns exact for case-insensitive match', () => {
    expect(matchAnswer('Der Arzt', 'der Arzt').match).toBe('exact');
  });

  it('returns exact after trimming whitespace', () => {
    expect(matchAnswer('  der Arzt  ', 'der Arzt').match).toBe('exact');
  });

  it('returns exact with collapsed internal whitespace', () => {
    expect(matchAnswer('der  Arzt', 'der Arzt').match).toBe('exact');
  });

  it('returns exact with NFC normalization (composed vs decomposed)', () => {
    // é as single codepoint vs e + combining accent
    expect(matchAnswer('m\u00E9decin', 'me\u0301decin').match).toBe('exact');
  });

  // ── Rule 2: Comma-part match ─────────────────────────────────────
  it('returns tolerant when input matches first comma-part', () => {
    const r = matchAnswer('beau', 'beau, belle');
    expect(r.match).toBe('tolerant');
    expect(r.expected).toBe('beau, belle');
  });

  it('returns tolerant when input matches second comma-part', () => {
    expect(matchAnswer('belle', 'beau, belle').match).toBe('tolerant');
  });

  it('returns tolerant for one gender of a German noun', () => {
    expect(matchAnswer('der Arzt', 'der Arzt, die Ärztin').match).toBe('tolerant');
  });

  // ── Rule 3: Article tolerance ────────────────────────────────────
  it('returns tolerant when input omits German article', () => {
    expect(matchAnswer('Arzt', 'der Arzt').match).toBe('tolerant');
  });

  it('returns tolerant when input omits French article', () => {
    expect(matchAnswer('médecin', 'le médecin').match).toBe('tolerant');
  });

  it("returns tolerant for French elision (l')", () => {
    expect(matchAnswer('école', "l'école").match).toBe('tolerant');
  });

  it('returns tolerant when input omits article on comma-variant', () => {
    // "Arzt" should match "der Arzt, die Ärztin" via article stripping on first part
    expect(matchAnswer('Arzt', 'der Arzt, die Ärztin').match).toBe('tolerant');
  });

  it('returns tolerant for Spanish article', () => {
    expect(matchAnswer('casa', 'la casa').match).toBe('tolerant');
  });

  it('returns tolerant for Dutch article', () => {
    expect(matchAnswer('huis', 'het huis').match).toBe('tolerant');
  });

  // ── Rule 4: Levenshtein tolerance ────────────────────────────────
  it('returns tolerant for Levenshtein ≤1 on word ≥5 chars', () => {
    // "medecin" (missing accent) vs "médecin" — after NFC both are 7 chars
    // Using plain ASCII typo
    expect(matchAnswer('medeci', 'medecin').match).toBe('tolerant');
  });

  it('returns tolerant for single-char typo in long word', () => {
    // "sprechen" → "sprechem" is 1 edit (n→m)
    expect(matchAnswer('sprechem', 'sprechen').match).toBe('tolerant');
  });

  it('rejects Levenshtein on short words (<5 chars)', () => {
    // "bea" vs "beau" — both <5 chars, should not tolerate
    expect(matchAnswer('bea', 'beau').match).toBe('none');
  });

  it('rejects Levenshtein >1', () => {
    // "spchen" vs "sprechen" — 2 edits (missing r and e)
    expect(matchAnswer('spchen', 'sprechen').match).toBe('none');
  });

  // ── Edge cases ───────────────────────────────────────────────────
  it('returns none for empty input', () => {
    expect(matchAnswer('', 'der Arzt').match).toBe('none');
  });

  it('returns none for whitespace-only input', () => {
    expect(matchAnswer('   ', 'der Arzt').match).toBe('none');
  });

  it('returns none for completely wrong answer', () => {
    expect(matchAnswer('banana', 'der Arzt').match).toBe('none');
  });

  it('handles reflexive verbs exactly', () => {
    expect(matchAnswer('se souvenir', 'se souvenir').match).toBe('exact');
  });

  it('handles reflexive verbs with sich', () => {
    expect(matchAnswer('sich erinnern', 'sich erinnern').match).toBe('exact');
  });

  it('always returns the original expected string', () => {
    const r = matchAnswer('wrong', 'der Arzt, die Ärztin');
    expect(r.expected).toBe('der Arzt, die Ärztin');
  });

  // ── Combined rules ──────────────────────────────────────────────
  it('article strip + comma-part combined: "Ärztin" matches "der Arzt, die Ärztin"', () => {
    expect(matchAnswer('Ärztin', 'der Arzt, die Ärztin').match).toBe('tolerant');
  });

  it('article strip + Levenshtein: "medecn" does not match "le médecin" (>1 edit after strip)', () => {
    expect(matchAnswer('medecn', 'le médecin').match).toBe('none');
  });

  it('handles Portuguese article "o"', () => {
    expect(matchAnswer('homólogo', 'o homólogo').match).toBe('tolerant');
  });

  it('handles Italian article "il"', () => {
    expect(matchAnswer('medico', 'il medico').match).toBe('tolerant');
  });

  it('returns exact when full comma-separated form matches', () => {
    expect(matchAnswer('beau, belle', 'beau, belle').match).toBe('exact');
  });

  it('returns exact for German noun with both genders', () => {
    expect(matchAnswer('der Arzt, die Ärztin', 'der Arzt, die Ärztin').match).toBe('exact');
  });
});
