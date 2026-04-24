/**
 * Unit tests for ensureIndefArticle — Rule 47 post-processing safety net.
 *
 * Covers: already-INDEF pass-through, DEF → INDEF conversion, bare → INDEF
 * via source-scan, bare → INDEF via ending heuristic, bare → bare when no
 * signal available (DE, FR), Scandi prefix handling, pl/cs no-op, m/f
 * pair splitting, EN a/an phonetics.
 */
import { ensureIndefArticle } from './articleEnforcer';

const PT_MEDICAL = `Há uma semana que sinto dormência na face esquerda. É puramente sensorial, não muscular. Por vezes é mais forte, outras mais fraca. A sensação estende-se da orelha ao olho e ao nariz. Também tenho tido problemas de visão ocasionais e tonturas ligeiras. Não há história conhecida de distúrbios neurológicos na minha família próxima.`;

describe('ensureIndefArticle', () => {
  describe('Portuguese (pt)', () => {
    it('passes through already-INDEF form', () => {
      expect(ensureIndefArticle('um cão', [], '', 'pt')).toBe('um cão');
      expect(ensureIndefArticle('uma casa', [], '', 'pt')).toBe('uma casa');
    });

    it('converts DEF → INDEF for masc+fem', () => {
      expect(ensureIndefArticle('o cão', [], '', 'pt')).toBe('um cão');
      expect(ensureIndefArticle('a face', [], '', 'pt')).toBe('uma face');
      expect(ensureIndefArticle('os cães', [], '', 'pt')).toBe('um cães');
      expect(ensureIndefArticle('as faces', [], '', 'pt')).toBe('uma faces');
    });

    it('uses source-scan to find gender from contractions', () => {
      // Source has "na face" → fem
      expect(ensureIndefArticle('face', ['face'], PT_MEDICAL, 'pt')).toBe('uma face');
      // Source has "ao olho" → masc
      expect(ensureIndefArticle('olho', ['olho'], PT_MEDICAL, 'pt')).toBe('um olho');
      // Source has "da orelha" → fem
      expect(ensureIndefArticle('orelha', ['orelha'], PT_MEDICAL, 'pt')).toBe('uma orelha');
      // Source has "A sensação" (visible DEF article) → fem
      expect(ensureIndefArticle('sensação', ['sensação'], PT_MEDICAL, 'pt')).toBe('uma sensação');
    });

    it('uses ending heuristic when source has no article hint', () => {
      // -ção/-são/-dade/-tude/-ice etc. → fem
      expect(ensureIndefArticle('sensação', [], '', 'pt')).toBe('uma sensação');
      expect(ensureIndefArticle('liberdade', [], '', 'pt')).toBe('uma liberdade');
      expect(ensureIndefArticle('virtude', [], '', 'pt')).toBe('uma virtude');
      // -ma (Greek-origin) → masc despite -a
      expect(ensureIndefArticle('problema', [], '', 'pt')).toBe('um problema');
      expect(ensureIndefArticle('sistema', [], '', 'pt')).toBe('um sistema');
      expect(ensureIndefArticle('tema', [], '', 'pt')).toBe('um tema');
      // -a → fem (default)
      expect(ensureIndefArticle('casa', [], '', 'pt')).toBe('uma casa');
      // consonant/vowel default → masc
      expect(ensureIndefArticle('livro', [], '', 'pt')).toBe('um livro');
      expect(ensureIndefArticle('cão', [], '', 'pt')).toBe('um cão');
    });

    it('uses source_forms variants when scanning', () => {
      // LLM returns singular lemma, source has plural. Source-scan should find it.
      expect(ensureIndefArticle('problema', ['problemas'], 'os problemas persistentes', 'pt')).toBe(
        'um problema',
      );
    });

    it('handles m/f comma-separated pairs independently', () => {
      expect(ensureIndefArticle('o médico, a médica', [], '', 'pt')).toBe('um médico, uma médica');
    });

    it('finds gender via prepositional contractions (na/da/ao/pelo)', () => {
      expect(ensureIndefArticle('cidade', ['cidade'], 'pela cidade', 'pt')).toBe('uma cidade');
      expect(ensureIndefArticle('trabalho', ['trabalho'], 'pelo trabalho', 'pt')).toBe(
        'um trabalho',
      );
      expect(ensureIndefArticle('escola', ['escola'], 'na escola', 'pt')).toBe('uma escola');
    });
  });

  describe('Spanish (es)', () => {
    it('passes through INDEF and converts DEF → INDEF', () => {
      expect(ensureIndefArticle('un perro', [], '', 'es')).toBe('un perro');
      expect(ensureIndefArticle('el perro', [], '', 'es')).toBe('un perro');
      expect(ensureIndefArticle('la casa', [], '', 'es')).toBe('una casa');
    });

    it('ending heuristic: -ción/-dad fem, -ma masc', () => {
      expect(ensureIndefArticle('libertad', [], '', 'es')).toBe('una libertad');
      expect(ensureIndefArticle('nación', [], '', 'es')).toBe('una nación');
      expect(ensureIndefArticle('problema', [], '', 'es')).toBe('un problema');
      expect(ensureIndefArticle('día', [], '', 'es')).toBe('un día'); // known masc exception
    });

    it('source-scan via al/del contractions', () => {
      expect(ensureIndefArticle('parque', ['parque'], 'al parque', 'es')).toBe('un parque');
      expect(ensureIndefArticle('niño', ['niño'], 'del niño', 'es')).toBe('un niño');
    });
  });

  describe('Italian (it)', () => {
    it('passes through INDEF and converts DEF → INDEF', () => {
      expect(ensureIndefArticle('un cane', [], '', 'it')).toBe('un cane');
      expect(ensureIndefArticle('il cane', [], '', 'it')).toBe('un cane');
      expect(ensureIndefArticle('la casa', [], '', 'it')).toBe('una casa');
    });

    it('applies un/uno/una by phonology', () => {
      // uno before s+consonant, z, gn, ps
      expect(ensureIndefArticle('studio', [], '', 'it')).toBe('uno studio');
      expect(ensureIndefArticle('zio', [], '', 'it')).toBe('uno zio');
      // un before vowel / normal consonant
      expect(ensureIndefArticle('amico', [], '', 'it')).toBe('un amico');
      expect(ensureIndefArticle('cane', [], '', 'it')).toBe('un cane');
    });

    it("uses un' apostrophe form for fem before vowel", () => {
      expect(ensureIndefArticle('amica', [], '', 'it')).toBe("un'amica");
      expect(ensureIndefArticle('casa', [], '', 'it')).toBe('una casa');
    });

    it("preserves elision l' inputs unchanged (gender ambiguous)", () => {
      // l'amica (fem) and l'amico (masc) are both valid — we can't
      // safely pick the gender from the apostrophe article alone, so
      // the original stays.
      expect(ensureIndefArticle("l'amica", [], '', 'it')).toBe("l'amica");
      expect(ensureIndefArticle("l'amico", [], '', 'it')).toBe("l'amico");
    });
  });

  describe('French (fr)', () => {
    it('passes through INDEF and converts DEF → INDEF', () => {
      expect(ensureIndefArticle('un chien', [], '', 'fr')).toBe('un chien');
      expect(ensureIndefArticle('le chien', [], '', 'fr')).toBe('un chien');
      expect(ensureIndefArticle('la maison', [], '', 'fr')).toBe('une maison');
    });

    it('leaves bare when ending heuristic is inconclusive and no source hint', () => {
      // FR endings are conservative; ambiguous -e nouns stay bare
      expect(ensureIndefArticle('livre', [], '', 'fr')).toBe('livre');
    });

    it('applies confident ending heuristic', () => {
      expect(ensureIndefArticle('nation', [], '', 'fr')).toBe('une nation');
      expect(ensureIndefArticle('liberté', [], '', 'fr')).toBe('une liberté');
      expect(ensureIndefArticle('fromage', [], '', 'fr')).toBe('un fromage');
      expect(ensureIndefArticle('tableau', [], '', 'fr')).toBe('un tableau');
    });

    it('source-scan via du/au', () => {
      expect(ensureIndefArticle('pain', ['pain'], 'du pain', 'fr')).toBe('un pain');
    });
  });

  describe('German (de) — conservative', () => {
    it('passes through already-INDEF', () => {
      expect(ensureIndefArticle('ein Hund', [], '', 'de')).toBe('ein Hund');
      expect(ensureIndefArticle('eine Katze', [], '', 'de')).toBe('eine Katze');
    });

    it('converts DEF → INDEF using article-inferred gender', () => {
      expect(ensureIndefArticle('der Hund', [], '', 'de')).toBe('ein Hund');
      expect(ensureIndefArticle('die Katze', [], '', 'de')).toBe('eine Katze');
      expect(ensureIndefArticle('das Kind', [], '', 'de')).toBe('ein Kind');
    });

    it('leaves bare when source has no article (no ending guess)', () => {
      expect(ensureIndefArticle('Hund', [], '', 'de')).toBe('Hund');
    });

    it('source-scan: recovers gender from Der/Die/Das in context', () => {
      expect(ensureIndefArticle('Hund', ['Hund'], 'Der Hund bellt.', 'de')).toBe('ein Hund');
      expect(ensureIndefArticle('Katze', ['Katze'], 'Die Katze schläft.', 'de')).toBe('eine Katze');
      expect(ensureIndefArticle('Kind', ['Kind'], 'Das Kind spielt.', 'de')).toBe('ein Kind');
    });

    it('source-scan: recovers from accusative/dative (den/dem)', () => {
      expect(ensureIndefArticle('Hund', ['Hund'], 'Er sieht den Hund.', 'de')).toBe('ein Hund');
      expect(ensureIndefArticle('Hund', ['Hund'], 'mit dem Hund', 'de')).toBe('ein Hund');
    });
  });

  describe('Dutch (nl) — trivial (een is ungendered)', () => {
    it('always prepends een', () => {
      expect(ensureIndefArticle('hond', [], '', 'nl')).toBe('een hond');
      expect(ensureIndefArticle('kind', [], '', 'nl')).toBe('een kind');
    });

    it('converts DEF de/het → een', () => {
      expect(ensureIndefArticle('de hond', [], '', 'nl')).toBe('een hond');
      expect(ensureIndefArticle('het kind', [], '', 'nl')).toBe('een kind');
    });

    it('passes through already-een', () => {
      expect(ensureIndefArticle('een huis', [], '', 'nl')).toBe('een huis');
    });
  });

  describe('English (en) — a/an phonetics', () => {
    it('passes through already-INDEF', () => {
      expect(ensureIndefArticle('a dog', [], '', 'en')).toBe('a dog');
      expect(ensureIndefArticle('an apple', [], '', 'en')).toBe('an apple');
    });

    it('converts "the X" → "a X" / "an X"', () => {
      expect(ensureIndefArticle('the dog', [], '', 'en')).toBe('a dog');
      expect(ensureIndefArticle('the apple', [], '', 'en')).toBe('an apple');
    });

    it('adds "an" before vowel-sound, "a" before consonant-sound', () => {
      expect(ensureIndefArticle('apple', [], '', 'en')).toBe('an apple');
      expect(ensureIndefArticle('ancestor', [], '', 'en')).toBe('an ancestor');
      expect(ensureIndefArticle('octopus', [], '', 'en')).toBe('an octopus');
      expect(ensureIndefArticle('hour', [], '', 'en')).toBe('an hour'); // silent h
      expect(ensureIndefArticle('dog', [], '', 'en')).toBe('a dog');
      expect(ensureIndefArticle('house', [], '', 'en')).toBe('a house');
    });

    it('handles u-vowel-sound special cases (university, one)', () => {
      expect(ensureIndefArticle('university', [], '', 'en')).toBe('a university');
      expect(ensureIndefArticle('uniform', [], '', 'en')).toBe('a uniform');
    });
  });

  describe('Scandinavian (sv/no/da)', () => {
    it('passes through already-INDEF prefix', () => {
      expect(ensureIndefArticle('en hund', [], '', 'sv')).toBe('en hund');
      expect(ensureIndefArticle('ett språk', [], '', 'sv')).toBe('ett språk');
      expect(ensureIndefArticle('ei bok', [], '', 'no')).toBe('ei bok');
    });

    it('bare → default common gender (en) when no source hint', () => {
      expect(ensureIndefArticle('hund', [], '', 'sv')).toBe('en hund');
      expect(ensureIndefArticle('bil', [], '', 'no')).toBe('en bil');
      expect(ensureIndefArticle('bog', [], '', 'da')).toBe('en bog');
    });

    it('source-scan: recovers neuter from "ett/et" context', () => {
      expect(ensureIndefArticle('barn', ['barn'], 'ett barn', 'sv')).toBe('ett barn');
      expect(ensureIndefArticle('barn', ['barn'], 'et barn', 'da')).toBe('ett barn');
    });

    it('source-scan: recovers common gender from "en/ei" context', () => {
      expect(ensureIndefArticle('hund', ['hund'], 'en hund', 'sv')).toBe('en hund');
      expect(ensureIndefArticle('bok', ['bok'], 'ei bok', 'no')).toBe('en bok');
    });
  });

  describe('Polish (pl) / Czech (cs) — no-op', () => {
    it('returns input unchanged (no articles)', () => {
      expect(ensureIndefArticle('pies', [], '', 'pl')).toBe('pies');
      expect(ensureIndefArticle('tekst', [], '', 'pl')).toBe('tekst');
      expect(ensureIndefArticle('pes', [], '', 'cs')).toBe('pes');
      expect(ensureIndefArticle('vedení', [], '', 'cs')).toBe('vedení');
    });
  });

  describe('Unknown language — no-op', () => {
    it('returns input unchanged', () => {
      expect(ensureIndefArticle('anything', [], '', 'xx')).toBe('anything');
      expect(ensureIndefArticle('whatever', [], '', '')).toBe('whatever');
    });
  });

  describe('Edge cases', () => {
    it('empty input returns unchanged', () => {
      expect(ensureIndefArticle('', [], '', 'pt')).toBe('');
      expect(ensureIndefArticle('   ', [], '', 'pt')).toBe('   ');
    });

    it('does not misfire on a noun that contains an article-like prefix', () => {
      // "asa" (PT wing) starts with "a" but isn't "a asa"
      expect(ensureIndefArticle('asa', [], '', 'pt')).toBe('uma asa');
    });

    it('source scan respects word boundaries (no partial matches)', () => {
      // "faceta" should not match "face" in source
      expect(ensureIndefArticle('face', ['face'], 'uma faceta interessante', 'pt')).not.toBe(
        'a face',
      );
    });
  });

  describe('The failing PT medical-narrative text (regression)', () => {
    const CASES: Array<[string, string[], string]> = [
      ['dormência', ['dormência'], 'uma dormência'],
      ['face', ['face'], 'uma face'],
      ['sensação', ['sensação'], 'uma sensação'],
      ['orelha', ['orelha'], 'uma orelha'],
      ['olho', ['olho'], 'um olho'],
      ['nariz', ['nariz'], 'um nariz'],
      ['problema', ['problemas'], 'um problema'],
      ['visão', ['visão'], 'uma visão'],
      ['tontura', ['tonturas'], 'uma tontura'],
      ['história', ['história'], 'uma história'],
      ['distúrbio', ['distúrbios'], 'um distúrbio'],
      ['família', ['família'], 'uma família'],
    ];

    it.each(CASES)('%s → %s', (bare, forms, expected) => {
      expect(ensureIndefArticle(bare, forms, PT_MEDICAL, 'pt')).toBe(expected);
    });
  });
});
