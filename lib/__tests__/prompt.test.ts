/**
 * Prompt-builder behavioural tests — pure-INDEF extraction shape
 * (Rule 47, revised 2026-04-24).
 */
import { buildVocabSystemPrompt } from '../claude';

const LANGS = ['de', 'fr', 'es', 'it', 'pt', 'nl', 'en', 'sv', 'no', 'da', 'pl', 'cs'] as const;

const NAMES: Record<string, string> = {
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  en: 'English',
  sv: 'Swedish',
  no: 'Norwegian',
  da: 'Danish',
  pl: 'Polish',
  cs: 'Czech',
};

describe('buildVocabSystemPrompt — pure-INDEF extraction shape', () => {
  describe('articled learn code (de) — INDEF-only', () => {
    const p = buildVocabSystemPrompt('English', 'German', 'de', 'en');

    it('shows the INDEF form as canonical', () => {
      expect(p).toContain('ein Hund');
    });

    it('mentions "der Hund" only in DEF→INDEF-conversion contexts, not as a target', () => {
      // The noun rule now shows conversion pairs: 'source "der Hund" → "ein Hund"'
      // (2026-04-24 hardening). Every "der Hund" occurrence must be either:
      //   (a) in a "→ ein Hund" arrow context (conversion example), or
      //   (b) after "not "  / "(not" (negative counter-example)
      const badContexts = p
        .split('\n')
        .filter((line) => line.includes('der Hund'))
        .filter((line) => !/"der Hund"\s*(?:\(definite\))?\s*→\s*"ein Hund"/.test(line))
        .filter((line) => !/not\s+"der Hund"/.test(line));
      expect(badContexts).toEqual([]);
    });

    it('does not carry the legacy source_cat field', () => {
      expect(p).not.toMatch(/source_cat/);
    });
  });

  describe('Scandi learn code (sv) — always INDEF prefix', () => {
    const p = buildVocabSystemPrompt('German', 'Swedish', 'sv', 'de');

    it('mentions the INDEFINITE prefix policy', () => {
      expect(p).toMatch(/INDEFINITE prefix/i);
    });

    it('shows the indef-prefix form (en hund) as canonical', () => {
      expect(p).toContain('en hund');
    });

    it('does not carry the legacy SUFFIX-DEFINITE taxonomy keyword (uppercase)', () => {
      // Case-sensitive — the prompt may still use lowercase "suffix-definite"
      // as a grammatical descriptor in a negative counter-example ("as
      // 'hunden' (suffix-definite), …"). The forbidden form is the
      // taxonomy category label the Matrix-Regel used as a bullet.
      expect(p).not.toMatch(/SUFFIX-DEFINITE/);
    });
  });

  describe('articleless learn code (pl) — bare', () => {
    const p = buildVocabSystemPrompt('English', 'Polish', 'pl', 'en');

    it('emits the bare singular nominative as canonical form', () => {
      expect(p).toContain('pies');
    });

    it('forbids borrowing articles from other languages', () => {
      expect(p).toMatch(/NO articles/);
    });
  });

  describe('translation rule — always native INDEF (or bare for pl/cs)', () => {
    it('articled native (de): translates to ein Hund, never der Hund', () => {
      const p = buildVocabSystemPrompt('German', 'French', 'fr', 'de');
      expect(p).toContain('ein Hund');
      // "der Hund" must not appear anywhere in a de-native prompt whose
      // learn lang is French (there is no DE counter-example to emit there).
      expect(p).not.toContain('der Hund');
    });

    it('scandi native (sv): translates to en hund, never hunden', () => {
      const p = buildVocabSystemPrompt('Swedish', 'German', 'de', 'sv');
      expect(p).toContain('en hund');
      expect(p).not.toContain('hunden');
    });

    it('articleless native (pl): translates bare, never with any article', () => {
      const p = buildVocabSystemPrompt('Polish', 'German', 'de', 'pl');
      expect(p).toContain('pies');
    });

    it('english native: translates to "a dog", never "the dog"', () => {
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en');
      expect(p).toContain('a dog');
      // "the dog" must not appear in any en-native prompt where en is native.
      // (The only way "the dog" could appear is if en were the learn lang,
      // and it'd be in a counter-example — but native-only here.)
      expect(p).not.toContain('the dog');
    });
  });

  describe('JSON example — no source_cat field', () => {
    it('JSON example does NOT include a "source_cat" field', () => {
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en');
      expect(p).not.toMatch(/"source_cat"/);
    });
  });

  // 144 (learn × native) combos — forbidden-token sweep. Catches any
  // regression that would reintroduce source_cat / suffix-definite /
  // three-category branching anywhere in the prompt for any pair.
  describe('144-combo forbidden-token sweep', () => {
    for (const learn of LANGS) {
      for (const native of LANGS) {
        if (learn === native) continue;
        it(`${learn}→${native} — no source_cat / SUFFIX-DEFINITE / ALWAYS-DEF wording`, () => {
          const p = buildVocabSystemPrompt(NAMES[native]!, NAMES[learn]!, learn, native);
          expect(p).not.toMatch(/source_cat/);
          // Case-sensitive: uppercase SUFFIX-DEFINITE was the Matrix-Regel
          // taxonomy bullet. Lowercase "suffix-definite" is allowed as a
          // grammatical descriptor in counter-examples.
          expect(p).not.toMatch(/SUFFIX-DEFINITE/);
          expect(p).not.toMatch(/ALWAYS include the DEFINITE article/);
          expect(p).not.toMatch(/ALWAYS prepend the definite article/);
        });
      }
    }
  });
});
