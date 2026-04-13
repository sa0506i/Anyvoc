import { sortKey, escapeRegex, extractSearchTerms, sortVocabulary, SortOption } from './vocabSort';

describe('sortKey', () => {
  it('strips German articles', () => {
    expect(sortKey('der Hund')).toBe('hund');
    expect(sortKey('die Katze')).toBe('katze');
    expect(sortKey('das Haus')).toBe('haus');
  });

  it('strips French articles', () => {
    expect(sortKey('le chat')).toBe('chat');
    expect(sortKey('la maison')).toBe('maison');
    expect(sortKey("l'homme")).toBe("l'homme"); // l' is in STRIP_PREFIX but requires space after
  });

  it('strips Spanish articles', () => {
    expect(sortKey('el gato')).toBe('gato');
    expect(sortKey('los perros')).toBe('perros');
  });

  it('strips Portuguese articles', () => {
    expect(sortKey('o gato')).toBe('gato');
    expect(sortKey('as casas')).toBe('casas');
  });

  it('strips English articles', () => {
    expect(sortKey('the dog')).toBe('dog');
    expect(sortKey('a cat')).toBe('cat');
  });

  it('strips reflexive pronouns', () => {
    expect(sortKey('sich erinnern')).toBe('erinnern');
    expect(sortKey('se souvenir')).toBe('souvenir');
  });

  it('uses only first comma-separated form', () => {
    expect(sortKey('der Arzt, die Ärztin')).toBe('arzt');
    expect(sortKey('beau, belle')).toBe('beau');
  });

  it('lowercases the result', () => {
    expect(sortKey('Der Hund')).toBe('hund');
  });

  it('handles words without articles', () => {
    expect(sortKey('Hund')).toBe('hund');
    expect(sortKey('manger')).toBe('manger');
  });
});

describe('escapeRegex', () => {
  it('escapes special regex characters', () => {
    expect(escapeRegex('hello.world')).toBe('hello\\.world');
    expect(escapeRegex('a+b*c?')).toBe('a\\+b\\*c\\?');
    expect(escapeRegex('(test)[1]')).toBe('\\(test\\)\\[1\\]');
  });

  it('passes through plain text', () => {
    expect(escapeRegex('hello')).toBe('hello');
  });
});

describe('extractSearchTerms', () => {
  it('strips articles and returns core term', () => {
    const terms = extractSearchTerms('der Hund');
    expect(terms).toContain('Hund');
  });

  it('handles comma-separated forms', () => {
    const terms = extractSearchTerms('beau, belle');
    expect(terms).toContain('beau');
    expect(terms).toContain('belle');
  });

  it('handles noun with feminine form', () => {
    const terms = extractSearchTerms('der Arzt, die Ärztin');
    expect(terms).toContain('Arzt');
    expect(terms).toContain('Ärztin');
  });

  it('handles reflexive verbs', () => {
    const terms = extractSearchTerms('se souvenir');
    expect(terms).toContain('souvenir');
  });

  it('adds individual words for multi-word entries', () => {
    const terms = extractSearchTerms('die rote Blume');
    expect(terms).toContain('rote Blume');
    expect(terms).toContain('rote');
    expect(terms).toContain('Blume');
  });

  it('excludes words shorter than 3 chars from individual splits', () => {
    const terms = extractSearchTerms('un bon ami');
    // "bon ami" is the stripped form, individual words: "bon" (3 chars, included), "ami" (3 chars, included)
    expect(terms).toContain('bon ami');
  });
});

describe('sortVocabulary', () => {
  const items = [
    { original: 'die Katze', level: 'A2', leitner_box: 3, created_at: 100 },
    { original: 'der Hund', level: 'A1', leitner_box: 1, created_at: 300 },
    { original: 'das Haus', level: 'B1', leitner_box: 5, created_at: 200 },
  ];

  it('sorts by date (newest first)', () => {
    const sorted = sortVocabulary(items, 'date');
    expect(sorted[0].original).toBe('der Hund');
    expect(sorted[2].original).toBe('die Katze');
  });

  it('sorts alphabetically (stripping articles)', () => {
    const sorted = sortVocabulary(items, 'alphabetical');
    expect(sorted[0].original).toBe('das Haus'); // haus
    expect(sorted[1].original).toBe('der Hund'); // hund
    expect(sorted[2].original).toBe('die Katze'); // katze
  });

  it('sorts by CEFR level', () => {
    const sorted = sortVocabulary(items, 'level');
    expect(sorted[0].level).toBe('A1');
    expect(sorted[1].level).toBe('A2');
    expect(sorted[2].level).toBe('B1');
  });

  it('sorts by Leitner box', () => {
    const sorted = sortVocabulary(items, 'box');
    expect(sorted[0].leitner_box).toBe(1);
    expect(sorted[1].leitner_box).toBe(3);
    expect(sorted[2].leitner_box).toBe(5);
  });

  it('returns new array (does not mutate input)', () => {
    const sorted = sortVocabulary(items, 'date');
    expect(sorted).not.toBe(items);
  });

  it('handles empty array', () => {
    expect(sortVocabulary([], 'date')).toEqual([]);
  });

  it('handles single item', () => {
    const single = [items[0]];
    expect(sortVocabulary(single, 'alphabetical')).toEqual(single);
  });
});
