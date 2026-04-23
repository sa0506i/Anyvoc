/**
 * Prompt-builder behavioural tests — locked shape of the canonical
 * Matrix-Regel prompt after the v1/v3 cleanup (2026-04-23).
 */
import { buildVocabSystemPrompt } from '../claude';

describe('buildVocabSystemPrompt — canonical Matrix-Regel prompt shape', () => {
  describe('articled learn code (de) — source-preserving extraction', () => {
    const p = buildVocabSystemPrompt('English', 'German', 'de', 'en');

    it('mentions the "first occurrence" tiebreaker rule', () => {
      expect(p).toMatch(/first occurrence/i);
    });

    it('does not carry the legacy "ALWAYS DEFINITE" v1 wording', () => {
      expect(p).not.toMatch(/ALWAYS include the DEFINITE article/);
    });

    it('shows both DEF and INDEF noun examples in the learn language', () => {
      expect(p).toContain('der Hund');
      expect(p).toContain('ein Hund');
    });
  });

  describe('Scandi learn code (sv) — source-category preservation', () => {
    const p = buildVocabSystemPrompt('German', 'Swedish', 'sv', 'de');

    it('does not carry the legacy "ALWAYS prepend INDEFINITE" wording', () => {
      expect(p).not.toMatch(/ALWAYS prepend the INDEFINITE article/);
    });

    it('mentions the suffix-definite form (hunden) as a valid extraction', () => {
      expect(p).toContain('hunden');
    });

    it('mentions the indefinite-prefix form (en hund) as a valid extraction', () => {
      expect(p).toContain('en hund');
    });

    it('tells the LLM how to handle bare Scandi nouns', () => {
      expect(p).toMatch(/bare/i);
    });
  });

  describe('articleless learn code (pl) — bare extraction', () => {
    const p = buildVocabSystemPrompt('English', 'Polish', 'pl', 'en');

    it('emits the bare singular nominative as canonical form', () => {
      expect(p).toContain('pies');
    });

    it('forbids borrowing articles from other languages', () => {
      expect(p).toMatch(/NO articles/);
    });
  });

  describe('translation rule — matrix-accurate for every native category', () => {
    it('articled native (de): shows both DEF-source→der Hund and INDEF-source→ein Hund', () => {
      const p = buildVocabSystemPrompt('German', 'French', 'fr', 'de');
      expect(p).toContain('der Hund');
      expect(p).toContain('ein Hund');
    });

    it('scandi native (sv): shows DEF-source→hunden and INDEF-source→en hund', () => {
      const p = buildVocabSystemPrompt('Swedish', 'German', 'de', 'sv');
      expect(p).toContain('hunden');
      expect(p).toContain('en hund');
    });

    it('articleless native (pl): shows bare pies as target regardless of source', () => {
      const p = buildVocabSystemPrompt('Polish', 'German', 'de', 'pl');
      expect(p).toContain('pies');
    });
  });

  describe('JSON example — source_cat field present', () => {
    it('JSON example includes a "source_cat" field', () => {
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en');
      expect(p).toMatch(/"source_cat"/);
    });

    it('JSON example enumerates valid source_cat values (def|indef|bare)', () => {
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en');
      expect(p).toMatch(/def.*indef.*bare|indef.*bare.*def|bare.*def.*indef/);
    });
  });
});
