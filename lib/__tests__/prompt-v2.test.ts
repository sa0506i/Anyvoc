/**
 * Prompt v2 — Source-Preserving Extraction + Matrix Translation
 *
 * Locks the v2 prompt behavior that Slice 2 introduces:
 *  - Articled learn codes: prompt instructs the LLM to preserve the source
 *    article category (DEF / INDEF / bare) instead of forcing DEF.
 *  - Scandi learn codes: prompt instructs to preserve suffix-definite,
 *    indefinite-prefix, or bare (defaults to INDEF-prefix) — not force INDEF.
 *  - Translation block shows both DEF-source→def-target AND
 *    INDEF-source→indef-target examples drawn from the user-approved matrix.
 *  - JSON example carries a "source_cat" field so the LLM emits the chosen
 *    article category per entry (consumed by extractVocabulary in Slice 3).
 *
 * v1 output stays untouched during the A/B phase — those assertions guard
 * the invariant that v1 is still the current baseline code path.
 */
import { buildVocabSystemPrompt } from '../claude';

describe('buildVocabSystemPrompt — v1 vs v2 prompt shape', () => {
  describe('v1 preserves current baseline behavior', () => {
    it('v1 articled learn code (de) still carries the "DEFINITE" enforcement wording', () => {
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en', 'v1');
      expect(p).toMatch(/DEFINITE article/);
    });

    it('v1 Scandi learn code (sv) still carries the "ALWAYS prepend" wording', () => {
      const p = buildVocabSystemPrompt('English', 'Swedish', 'sv', 'en', 'v1');
      expect(p).toMatch(/ALWAYS prepend the INDEFINITE article/);
    });

    it('v1 JSON example does NOT contain source_cat', () => {
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en', 'v1');
      expect(p).not.toMatch(/source_cat/);
    });
  });

  describe('v2 articled learn code (de) — source-preserving extraction', () => {
    const p = buildVocabSystemPrompt('English', 'German', 'de', 'en', 'v2');

    it('mentions the "first occurrence" tiebreaker rule', () => {
      expect(p).toMatch(/first occurrence/i);
    });

    it('drops the v1 "ALWAYS include the DEFINITE article" wording', () => {
      expect(p).not.toMatch(/ALWAYS include the DEFINITE article/);
    });

    it('shows both DEF and INDEF noun examples in the learn language', () => {
      expect(p).toContain('der Hund');
      expect(p).toContain('ein Hund');
    });
  });

  describe('v2 Scandi learn code (sv) — source-category preservation', () => {
    const p = buildVocabSystemPrompt('German', 'Swedish', 'sv', 'de', 'v2');

    it('drops the v1 "ALWAYS prepend the INDEFINITE article" wording', () => {
      expect(p).not.toMatch(/ALWAYS prepend the INDEFINITE article/);
    });

    it('mentions the suffix-definite form (e.g. hunden) as a valid extraction', () => {
      expect(p).toContain('hunden');
    });

    it('mentions the indefinite-prefix form (e.g. en hund) as a valid extraction', () => {
      expect(p).toContain('en hund');
    });

    it('tells the LLM how to handle bare Scandi nouns (recipes/legal/headlines)', () => {
      // Must mention bare/recipe/after-adjective handling AND default to INDEF.
      expect(p).toMatch(/bare/i);
    });
  });

  describe('v2 articleless learn code (pl) — bare extraction unchanged', () => {
    const p = buildVocabSystemPrompt('English', 'Polish', 'pl', 'en', 'v2');

    it('still emits the bare singular nominative as canonical form', () => {
      expect(p).toContain('pies');
    });

    it('still forbids borrowing articles from other languages', () => {
      expect(p).toMatch(/NO articles/);
    });
  });

  describe('v2 translation rule — matrix-accurate for every native category', () => {
    it('articled native (de): shows both DEF-source→der Hund and INDEF-source→ein Hund', () => {
      const p = buildVocabSystemPrompt('German', 'French', 'fr', 'de', 'v2');
      // The native-side examples must contain both DEF and INDEF DE forms.
      expect(p).toContain('der Hund');
      expect(p).toContain('ein Hund');
    });

    it('scandi native (sv): shows DEF-source→hunden and INDEF-source→en hund', () => {
      const p = buildVocabSystemPrompt('Swedish', 'German', 'de', 'sv', 'v2');
      expect(p).toContain('hunden');
      expect(p).toContain('en hund');
    });

    it('articleless native (pl): shows bare pies as target regardless of source', () => {
      const p = buildVocabSystemPrompt('Polish', 'German', 'de', 'pl', 'v2');
      expect(p).toContain('pies');
    });
  });

  describe('v2 JSON example — source_cat field present', () => {
    it('JSON example includes a "source_cat" field', () => {
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en', 'v2');
      expect(p).toMatch(/"source_cat"/);
    });

    it('JSON example enumerates valid source_cat values (def|indef|bare)', () => {
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en', 'v2');
      // Somewhere in the prompt the LLM is told what values source_cat takes.
      expect(p).toMatch(/def.*indef.*bare|indef.*bare.*def|bare.*def.*indef/);
    });
  });

  describe('v2 default comes from ANYVOC_PROMPT_VERSION env var', () => {
    const ORIGINAL = process.env.ANYVOC_PROMPT_VERSION;
    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.ANYVOC_PROMPT_VERSION;
      else process.env.ANYVOC_PROMPT_VERSION = ORIGINAL;
    });

    it('ANYVOC_PROMPT_VERSION=v2 produces v2-shaped prompt without explicit version arg', () => {
      process.env.ANYVOC_PROMPT_VERSION = 'v2';
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en');
      expect(p).toMatch(/"source_cat"/);
    });

    it('ANYVOC_PROMPT_VERSION=v1 produces v1-shaped prompt without explicit version arg', () => {
      process.env.ANYVOC_PROMPT_VERSION = 'v1';
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en');
      expect(p).not.toMatch(/"source_cat"/);
    });

    it('unset ANYVOC_PROMPT_VERSION defaults to v1 during A/B phase', () => {
      delete process.env.ANYVOC_PROMPT_VERSION;
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en');
      // A/B-phase default: v1 until sweep validates v2 (Slice 7).
      expect(p).not.toMatch(/"source_cat"/);
    });
  });
});
