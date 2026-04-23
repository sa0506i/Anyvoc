/**
 * Matrix-Rule Test — Translation Target Ground Truth
 *
 * The user-specified translation-target matrix (see the two 12×12 matrices
 * approved on 2026-04-23 + the comment "Fuer BARE (pl,cs), wird immer auf
 * indef uebersetzt") defines the canonical mapping from source article
 * category → native translation target. This test is the single source of
 * truth for that rule — changing the rule means changing this table.
 *
 * Matrix semantics:
 *   sourceCat = 'def'   → native's definite form
 *     (articled natives: nounLemma; scandi natives: nounDef suffix form;
 *      articleless natives: nounBare — they have no articles at all)
 *   sourceCat = 'indef' → native's indefinite form
 *     (articled natives: nounIndef; scandi natives: nounLemma (INDEF-prefix);
 *      articleless natives: nounBare)
 *   sourceCat = 'bare'  → mirrored to native's indefinite form
 *     (per user comment "Fuer BARE (pl,cs), wird immer auf indef uebersetzt")
 *
 * See docs (plan file) for the full matrices.
 */
import { matrixTranslationTarget } from '../claude';

describe('matrixTranslationTarget — user-specified translation-target matrix', () => {
  const LANGS = ['de', 'fr', 'es', 'it', 'pt', 'nl', 'en', 'sv', 'no', 'da', 'pl', 'cs'] as const;

  /**
   * Expected DEF and INDEF translation targets per native-language column.
   * Values come directly from the two user-approved matrices (2026-04-23).
   */
  const EXPECTED: Record<(typeof LANGS)[number], { def: string; indef: string }> = {
    de: { def: 'der Hund', indef: 'ein Hund' },
    fr: { def: 'le chien', indef: 'un chien' },
    es: { def: 'el perro', indef: 'un perro' },
    it: { def: 'il cane', indef: 'un cane' },
    pt: { def: 'o cão', indef: 'um cão' },
    nl: { def: 'de hond', indef: 'een hond' },
    en: { def: 'the dog', indef: 'a dog' },
    sv: { def: 'hunden', indef: 'en hund' },
    no: { def: 'hunden', indef: 'en hund' },
    da: { def: 'hunden', indef: 'en hund' },
    // Articleless natives — matrices show bare in both DEF and INDEF columns
    pl: { def: 'pies', indef: 'pies' },
    cs: { def: 'pes', indef: 'pes' },
  };

  describe('DEF source category → native definite form', () => {
    for (const native of LANGS) {
      it(`sourceCat='def', native='${native}' → '${EXPECTED[native].def}'`, () => {
        expect(matrixTranslationTarget('def', native)).toBe(EXPECTED[native].def);
      });
    }
  });

  describe('INDEF source category → native indefinite form', () => {
    for (const native of LANGS) {
      it(`sourceCat='indef', native='${native}' → '${EXPECTED[native].indef}'`, () => {
        expect(matrixTranslationTarget('indef', native)).toBe(EXPECTED[native].indef);
      });
    }
  });

  describe('BARE source category → mirrors to INDEF (per user comment)', () => {
    for (const native of LANGS) {
      // BARE is treated exactly like INDEF in the translation target.
      const expected = EXPECTED[native].indef;
      it(`sourceCat='bare', native='${native}' → '${expected}'`, () => {
        expect(matrixTranslationTarget('bare', native)).toBe(expected);
      });
    }
  });
});
