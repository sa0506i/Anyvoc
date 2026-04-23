/**
 * Prompt-output snapshots — refactor-parity contract.
 *
 * Freezes the canonical Matrix-Regel prompt output for a representative
 * matrix of (learn, native) combinations. Any non-whitespace diff
 * against these snapshots signals an unintentional prompt-semantic
 * change. Intentional changes bump the snapshots via `jest -u`.
 *
 * Matrix coverage:
 *   - All 3 article systems as LEARN (articled=de, scandi=sv, articleless=pl)
 *   - All 3 article systems as NATIVE (articled=de, scandi=sv, articleless=pl)
 *   minus diagonals (learn===native) = 6 matrix entries.
 *   + 4 edge-case combos for the cross-system translation paths.
 *   = 10 snapshots total.
 *
 * Pre-2026-04-23-cleanup this file held 22 snapshots (v1, v2, v3 × same
 * matrix). After v1/v3 were removed, only the canonical v2 shape
 * remains.
 */
import { buildVocabSystemPrompt } from '../claude';

const LEARN_REPS = ['de', 'sv', 'pl'] as const;
const NATIVE_REPS = ['de', 'sv', 'pl'] as const;

const NAMES: Record<string, string> = {
  de: 'German',
  sv: 'Swedish',
  pl: 'Polish',
};

describe('Prompt-output parity snapshots — canonical Matrix-Regel shape', () => {
  for (const learn of LEARN_REPS) {
    for (const native of NATIVE_REPS) {
      if (learn === native) continue; // diagonal — skipped by production anyway
      it(`${learn}→${native}`, () => {
        const prompt = buildVocabSystemPrompt(NAMES[native]!, NAMES[learn]!, learn, native);
        expect(prompt).toMatchSnapshot();
      });
    }
  }

  it('articled→articled canonical (de→en)', () => {
    expect(buildVocabSystemPrompt('English', 'German', 'de', 'en')).toMatchSnapshot();
  });

  it('articled→scandi (fr→no, tests romance-adj + scandi-suffix translation)', () => {
    expect(buildVocabSystemPrompt('Norwegian', 'French', 'fr', 'no')).toMatchSnapshot();
  });

  it('scandi→articleless (da→cs, tests scandi-extract + bare-target)', () => {
    expect(buildVocabSystemPrompt('Czech', 'Danish', 'da', 'cs')).toMatchSnapshot();
  });

  it('articleless→articled (cs→it, tests bare-source→indef-target)', () => {
    expect(buildVocabSystemPrompt('Italian', 'Czech', 'cs', 'it')).toMatchSnapshot();
  });
});
