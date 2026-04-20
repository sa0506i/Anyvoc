import {
  isAbbreviation,
  isLikelyProperNoun,
  isMultiWordNounLeak,
  collapseIdenticalFormPair,
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

  it('keeps attributive adjectives lowercase, only capitalises the noun', () => {
    expect(capitaliseGermanNouns('die öffentliche gewalt', 'noun')).toBe('die öffentliche Gewalt');
    expect(capitaliseGermanNouns('die schlechte laune', 'noun')).toBe('die schlechte Laune');
    expect(capitaliseGermanNouns('die wissenschaftliche autorität', 'noun')).toBe(
      'die wissenschaftliche Autorität',
    );
  });

  it('does not re-capitalise an already-correct attribute-noun phrase', () => {
    expect(capitaliseGermanNouns('die öffentliche Gewalt', 'noun')).toBe('die öffentliche Gewalt');
  });
});

describe('isMultiWordNounLeak', () => {
  it.each([
    ['le Real Madrid', 'noun', true],
    ['la British Broadcasting Corporation', 'noun', true],
    ['die öffentliche Gewalt', 'noun', true],
    ['den offentliga makten', 'noun', true],
    ['los medios de comunicación', 'noun', true],
    ['der Truppendurchzug', 'noun', false], // single-word compound
    ['der Hund', 'noun', false],
    ['o passaporte', 'noun', false],
    ['der Arzt, die Ärztin', 'noun', false], // m/f split by comma
    ['de koning, de koningin', 'noun', false], // same, NL
    ['New York City', 'noun', true], // 3 tokens no article
  ])('%s (type=%s) → leak=%s', (s, t, expected) => {
    expect(isMultiWordNounLeak(s, t)).toBe(expected);
  });

  it('also catches multi-word proper-noun leaks typed "other" (sports clubs etc.)', () => {
    // The 2026-04-20 sweep's remaining 9 leaks were all in fr→{es,sv,da}
    // and labelled 'other' rather than 'noun' — multi-word club names.
    expect(isMultiWordNounLeak('le Real Madrid', 'other')).toBe(true);
    expect(isMultiWordNounLeak('le Bayern Munich', 'other')).toBe(true);
    expect(isMultiWordNounLeak('le FC Barcelone', 'other')).toBe(true);
  });

  it('does not flag single-word "other" entries', () => {
    // Single-word 'other' is a legitimate catch-all (interjections, particles)
    // and must stay untouched.
    expect(isMultiWordNounLeak('selbst', 'other')).toBe(false);
    expect(isMultiWordNounLeak('quoi', 'other')).toBe(false);
  });

  it('never flags phrase or verb types (phrases are multi-word by design)', () => {
    expect(isMultiWordNounLeak('de repente', 'phrase')).toBe(false);
    expect(isMultiWordNounLeak('sich erinnern', 'verb')).toBe(false);
  });
});

describe('collapseIdenticalFormPair', () => {
  it.each([
    ['grande, grande', 'grande'],
    ['igual, igual', 'igual'],
    ['fagfællebedømte, fagfællebedømte', 'fagfællebedømte'],
    ['social, social', 'social'],
    ['revisionato dai pari, revisionato dai pari', 'revisionato dai pari'],
  ])('collapses identical pair %s → %s', (input, expected) => {
    expect(collapseIdenticalFormPair(input)).toBe(expected);
  });

  it.each([
    ['haut, haute', 'haut, haute'], // legit FR m/f
    ['clair, claire', 'clair, claire'], // legit FR m/f
    ['bonito, bonita', 'bonito, bonita'], // legit ES/IT m/f
    ['der Arzt, die Ärztin', 'der Arzt, die Ärztin'], // legit DE m/f
    ['bueno, buena', 'bueno, buena'], // legit ES m/f
    ['le médecin, la médecin', 'le médecin, la médecin'], // legit FR m/f same base, different articles
    ["l'ami, l'amie", "l'ami, l'amie"], // legit FR elision m/f
  ])('keeps legitimate differing pair %s', (input) => {
    expect(collapseIdenticalFormPair(input)).toBe(input);
  });

  it('collapses case-identical pairs (case-insensitive comparison)', () => {
    // The LLM occasionally emits "Grande, grande" or "der Hund, der Hund"
    // with varying case; we collapse by case-insensitive match.
    expect(collapseIdenticalFormPair('der Hund, der Hund')).toBe('der Hund');
    expect(collapseIdenticalFormPair('Grande, grande')).toBe('Grande');
  });

  it('returns single-form inputs unchanged (no comma)', () => {
    expect(collapseIdenticalFormPair('grande')).toBe('grande');
    expect(collapseIdenticalFormPair('der Hund')).toBe('der Hund');
  });

  it('returns inputs with 3+ comma parts unchanged (not an m/f pair)', () => {
    expect(collapseIdenticalFormPair('a, b, c')).toBe('a, b, c');
  });

  it('handles undefined / empty input', () => {
    expect(collapseIdenticalFormPair(undefined)).toBe('');
    expect(collapseIdenticalFormPair('')).toBe('');
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

  it('drops multi-word noun leaks (attribute-adj + noun or multi-word proper nouns)', () => {
    const items = [
      make({ original: 'le Real Madrid', translation: 'Real Madrid', type: 'noun' }),
      make({ original: 'la British Broadcasting Corporation', translation: 'BBC', type: 'noun' }),
      make({ original: 'die öffentliche Gewalt', translation: 'public authority', type: 'noun' }),
      make({ original: 'der Hund', translation: 'the dog', type: 'noun' }), // legit
    ];
    const out = postProcessExtractedVocab(items, 'fr', 'en');
    expect(out.map((i) => i.original)).toEqual(['der Hund']);
  });

  it('deduplicates within a single batch on (original, type)', () => {
    const items = [
      make({ original: 'der Hund', type: 'noun' }),
      make({ original: 'der Hund', type: 'noun' }), // exact dup
      make({ original: 'Der Hund', type: 'noun' }), // case-insensitive dup
      make({ original: 'der Hund', type: 'verb' }), // different type — kept
    ];
    const out = postProcessExtractedVocab(items, 'de', 'en');
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.type)).toEqual(['noun', 'verb']);
  });

  it('collapses repetition-loops to a single entry', () => {
    const loop = Array.from({ length: 40 }, () =>
      make({ original: 'être', translation: 'sein', type: 'verb' }),
    );
    const out = postProcessExtractedVocab(loop, 'fr', 'de');
    expect(out).toHaveLength(1);
    expect(out[0].original).toBe('être');
  });

  it('collapses same-form m/f pairs in both original and translation', () => {
    const items = [
      make({ original: 'grande, grande', translation: 'grande, grande', type: 'adjective' }),
      make({ original: 'haut, haute', translation: 'alto, alta', type: 'adjective' }),
    ];
    const out = postProcessExtractedVocab(items, 'fr', 'en');
    expect(out).toHaveLength(2);
    // Spurious pair collapsed.
    expect(out[0].original).toBe('grande');
    expect(out[0].translation).toBe('grande');
    // Legitimate pair untouched.
    expect(out[1].original).toBe('haut, haute');
    expect(out[1].translation).toBe('alto, alta');
  });

  it('drops "other"-typed multi-word proper-noun leaks', () => {
    const items = [
      make({ original: 'le Real Madrid', translation: 'Real Madrid', type: 'other' }),
      make({ original: 'le Bayern Munich', translation: 'Bayern Munich', type: 'other' }),
      make({ original: 'selbst', translation: 'self', type: 'other' }), // single-word 'other' kept
    ];
    const out = postProcessExtractedVocab(items, 'fr', 'en');
    expect(out.map((i) => i.original)).toEqual(['selbst']);
  });
});
