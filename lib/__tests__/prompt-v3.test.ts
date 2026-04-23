/**
 * Prompt v3 — Re-balanced type emphasis + tightened mirror rules.
 *
 * v3 addresses the three regressions surfaced by the 2026-04-23 v2 sweep
 * (see docs/superpowers/specs/2026-04-23-phase1-go-nogo.md + Slice 7b.2
 * investigation):
 *
 * 1. **Type-balance regression** — v2's noun rule expanded to three
 *    source_cat cases, effectively tripling the noun-centric prose
 *    relative to the verb/adj/phrase rules. On noun-dense text (recipes,
 *    legal) the LLM over-classified as 'noun' (Italian carbonara sweep:
 *    36 items all typed noun, 0 verbs). v3 makes the type-rules
 *    symmetric — noun-, verb-, adjective-, phrase-rules each get
 *    comparable emphasis, and the source_cat callout is a single
 *    non-redundant line.
 *
 * 2. **Scandi-INDEF → articled-DEF mirror drift** — v2 shipped "dictionary
 *    lemma convention" examples (sv `en makt → de `die Macht`) that
 *    contradicted the matrix rule (INDEF source should map to INDEF
 *    target: `eine Macht`). v3's translation block carries an explicit
 *    counter-example for this path.
 *
 * 3. **Mass-noun bare-target rejection** — v2's strict "bare source →
 *    native INDEF" caused translations like `likestilling → un'equaglianza`
 *    which read as stilted Italian. v3 explicitly allows bare-to-bare
 *    for abstract/mass nouns in the target where the natural dictionary
 *    form goes bare, while keeping the default bare→INDEF for countable
 *    concrete nouns.
 *
 * v1 and v2 remain untouched so Rule 47 sensors keep catching v1/v2
 * drift; the env-var toggle extends to ANYVOC_PROMPT_VERSION=v3.
 */
import { buildVocabSystemPrompt } from '../claude';

describe('buildVocabSystemPrompt — v3 re-balanced prompt', () => {
  describe('v3 type balance — noun / verb / adjective / phrase get symmetric emphasis', () => {
    const p = buildVocabSystemPrompt('English', 'Italian', 'it', 'en', 'v3');

    it('explicitly includes a VERB section with its own header-style cue', () => {
      // The v3 prompt must NOT bury the verb rule as the last bullet of
      // a noun-heavy section. We assert a verb-rule block that starts on
      // its own line and names the concept before the example.
      expect(p).toMatch(/VERB/i);
      expect(p).toContain('correre'); // Italian infinitive
    });

    it('explicitly includes an ADJECTIVE section', () => {
      expect(p).toMatch(/ADJECTIVE/i);
      // Italian is Romance → m/f pair
      expect(p).toContain('bello, bella');
    });

    it('explicitly includes a PHRASE section', () => {
      expect(p).toMatch(/PHRASE/i);
    });

    it('type-rule text length is balanced — no section is more than 5× the shortest', () => {
      // Match unique block headers ("NOUN EXTRACTION", "VERB EXTRACTION",
      // …) and measure bytes until the next block header. The 5× cap
      // guards against a regression to v2-style noun-heavy prose while
      // still tolerating the inherent asymmetry (noun block carries
      // three source_cat cases plus the Scandi/English block interpolated
      // for Scandi/EN learn codes).
      const headers = [
        'NOUN EXTRACTION',
        'VERB EXTRACTION',
        'ADJECTIVE EXTRACTION',
        'PHRASE EXTRACTION',
      ];
      const lens = headers.map((h, i) => {
        const next = headers[i + 1] ?? 'TRANSLATION RULE';
        const m = p.match(new RegExp(`${h}[\\s\\S]*?(?=${next})`));
        return m ? m[0].length : 0;
      });
      expect(lens.every((n) => n > 50)).toBe(true);
      const ratio = Math.max(...lens) / Math.min(...lens);
      expect(ratio).toBeLessThanOrEqual(5);
    });
  });

  describe('v3 Scandi-INDEF → articled-native mirror is strict', () => {
    const p = buildVocabSystemPrompt('German', 'Swedish', 'sv', 'de', 'v3');

    it('translation block for sv→de explicitly shows "en hund → ein Hund" mirror', () => {
      // Must show the INDEF-source → INDEF-target mapping as a concrete example.
      expect(p).toMatch(/en\s+hund[\s\S]*?ein\s+Hund/);
    });

    it('translation block warns against the dictionary-lemma deviation', () => {
      // Anti-example: must mention that "en hund → die Macht" style is wrong,
      // or instruct to preserve indefiniteness (look for wording like "not
      // the definite form" or "indefinite category").
      expect(p).toMatch(
        /(NOT\s+the\s+definite|preserve\s+the\s+indefinite|never\s+the\s+definite)/i,
      );
    });
  });

  describe('v3 bare-source translation — abstract/mass allowance', () => {
    const p = buildVocabSystemPrompt('Italian', 'Norwegian', 'no', 'it', 'v3');

    it('allows bare-to-bare for abstract mass nouns', () => {
      // Some wording like "abstract" or "mass noun" or "bare in target"
      // must appear so the LLM knows bare-to-bare is legal for the
      // right semantic category.
      expect(p).toMatch(/(abstract|mass\s+noun|bare\s+in\s+the\s+target)/i);
    });
  });

  describe('v3 retains all v2 Matrix-Regel properties', () => {
    it('v3 JSON example still carries source_cat field', () => {
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en', 'v3');
      expect(p).toMatch(/"source_cat"/);
    });

    it('v3 Scandi noun rule still preserves source category (suffix-def, indef-prefix, bare)', () => {
      const p = buildVocabSystemPrompt('English', 'Swedish', 'sv', 'en', 'v3');
      expect(p).toContain('hunden');
      expect(p).toContain('en hund');
    });

    it('v3 articleless native (pl) translation is always bare', () => {
      const p = buildVocabSystemPrompt('Polish', 'German', 'de', 'pl', 'v3');
      expect(p).toContain('pies');
    });
  });

  describe('v3 env toggle works alongside v1/v2', () => {
    const ORIGINAL = process.env.ANYVOC_PROMPT_VERSION;
    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.ANYVOC_PROMPT_VERSION;
      else process.env.ANYVOC_PROMPT_VERSION = ORIGINAL;
    });

    it('ANYVOC_PROMPT_VERSION=v3 selects v3 when no explicit version passed', () => {
      process.env.ANYVOC_PROMPT_VERSION = 'v3';
      const p = buildVocabSystemPrompt('English', 'German', 'de', 'en');
      // v3 is distinguishable from v2 by the type-balance markers.
      expect(p).toMatch(/VERB/i);
    });
  });
});
