import {
  isAbbreviation,
  isLikelyProperNoun,
  capitaliseGermanNouns,
  postProcessExtractedVocab,
} from './vocabFilters';

describe('isAbbreviation', () => {
  it.each([
    ['GNR', true],
    ['DLRG', true],
    ['IRS', true],
    ['EU', true],
    ['B2B', true],
    ['USA', true],
  ])('drops all-caps acronym %s', (s, expected) => {
    expect(isAbbreviation(s)).toBe(expected);
  });

  it.each([
    ['Hund', false],
    ['der Hund', false],
    ['o gato', false],
    ['iPhone', false],
    ['A', false], // single letter, too short
    ['', false],
    ['e-mail', false],
  ])('keeps non-abbreviation %s', (s, expected) => {
    expect(isAbbreviation(s)).toBe(expected);
  });

  it('looks at the first comma-separated form', () => {
    expect(isAbbreviation('GNR, GNRs')).toBe(true);
  });
});

describe('isLikelyProperNoun', () => {
  it('drops capitalised single-word entries in non-German languages', () => {
    expect(isLikelyProperNoun('Maria', 'pt')).toBe(true);
    expect(isLikelyProperNoun('Berlin', 'en')).toBe(true);
    expect(isLikelyProperNoun('Lisboa', 'pt')).toBe(true);
    expect(isLikelyProperNoun('Portugal', 'fr')).toBe(true);
  });

  it('keeps lowercase words in non-German languages', () => {
    expect(isLikelyProperNoun('o gato', 'pt')).toBe(false);
    expect(isLikelyProperNoun('le chat', 'fr')).toBe(false);
    expect(isLikelyProperNoun('the dog', 'en')).toBe(false);
  });

  it('never flags German words (every common noun is capitalised)', () => {
    expect(isLikelyProperNoun('der Hund', 'de')).toBe(false);
    expect(isLikelyProperNoun('Berlin', 'de')).toBe(false);
  });

  it('keeps multi-word phrases (after article strip) — usually fixed expressions', () => {
    expect(isLikelyProperNoun('New York City', 'en')).toBe(false);
  });

  it('keeps article-prefixed entries (LLM treated them as common nouns)', () => {
    // "die Gemütlichkeit" appears in legitimate fixtures — the LLM added an
    // article so it considered the word a common noun. Keep it even in a
    // non-German learning-language stream.
    expect(isLikelyProperNoun('die Gemütlichkeit', 'fr')).toBe(false);
    expect(isLikelyProperNoun('o Brasil', 'pt')).toBe(false);
  });
});

describe('capitaliseGermanNouns', () => {
  it('capitalises a noun with article', () => {
    expect(capitaliseGermanNouns('der hund', 'noun')).toBe('der Hund');
  });

  it('handles umlauts (Unicode-aware)', () => {
    expect(capitaliseGermanNouns('die ärztin', 'noun')).toBe('die Ärztin');
    expect(capitaliseGermanNouns('das öl', 'noun')).toBe('das Öl');
  });

  it('handles multi-form (m/f) translations', () => {
    expect(capitaliseGermanNouns('der arzt, die ärztin', 'noun')).toBe('der Arzt, die Ärztin');
  });

  it('is a no-op when type is not noun', () => {
    expect(capitaliseGermanNouns('laufen', 'verb')).toBe('laufen');
    expect(capitaliseGermanNouns('schön', 'adjective')).toBe('schön');
  });

  it('is a no-op for already-capitalised input', () => {
    expect(capitaliseGermanNouns('der Hund', 'noun')).toBe('der Hund');
  });

  it('handles bare nouns (no article)', () => {
    expect(capitaliseGermanNouns('hund', 'noun')).toBe('Hund');
  });
});

describe('postProcessExtractedVocab', () => {
  const make = (overrides: Partial<{ original: string; translation: string; type: string }>) => ({
    original: 'der Hund',
    translation: 'the dog',
    type: 'noun',
    ...overrides,
  });

  it('drops abbreviations', () => {
    const items = [make({ original: 'GNR', translation: 'GNR', type: 'other' }), make({})];
    const out = postProcessExtractedVocab(items, 'de', 'en');
    expect(out).toHaveLength(1);
    expect(out[0].original).toBe('der Hund');
  });

  it('drops bare capitalised single-word entries in non-German languages', () => {
    const items = [
      make({ original: 'Lisboa', translation: 'Lisbon', type: 'noun' }),
      make({ original: 'o gato', translation: 'the cat', type: 'noun' }),
    ];
    const out = postProcessExtractedVocab(items, 'pt', 'en');
    expect(out.map((i) => i.original)).toEqual(['o gato']);
  });

  it('keeps article-prefixed entries even when the noun is capitalised', () => {
    const items = [make({ original: 'die Gemütlichkeit', translation: 'coziness', type: 'noun' })];
    const out = postProcessExtractedVocab(items, 'fr', 'en');
    expect(out).toHaveLength(1);
  });

  it('does not drop capitalised German nouns', () => {
    const items = [make({ original: 'der Hund', translation: 'the dog', type: 'noun' })];
    const out = postProcessExtractedVocab(items, 'de', 'en');
    expect(out).toHaveLength(1);
  });

  it('capitalises German translations when nativeLangCode === de', () => {
    const items = [make({ original: 'the dog', translation: 'der hund', type: 'noun' })];
    const out = postProcessExtractedVocab(items, 'en', 'de');
    expect(out[0].translation).toBe('der Hund');
  });

  it('does not touch translations when nativeLangCode is not de', () => {
    const items = [make({ original: 'der Hund', translation: 'the dog', type: 'noun' })];
    const out = postProcessExtractedVocab(items, 'de', 'en');
    expect(out[0].translation).toBe('the dog');
  });

  it('does not mutate input array', () => {
    const items = [make({})];
    const snapshot = JSON.stringify(items);
    postProcessExtractedVocab(items, 'de', 'en');
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});
