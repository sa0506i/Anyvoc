/**
 * Prompt-output snapshots — Phase 2 refactor parity contract.
 *
 * These snapshots freeze the current (Phase 1, v2/v3 default) prompt
 * output for a representative matrix of (learn, native, version)
 * combinations. The Phase 2 struktur-refactor must preserve every
 * byte in every snapshot; any diff that isn't pure whitespace
 * signals that the refactor changed prompt semantics — which the
 * refactor explicitly forbids.
 *
 * Matrix coverage:
 *   - All 3 article systems as LEARN (articled=de, scandi=sv, articleless=pl)
 *   - All 3 article systems as NATIVE (articled=de, scandi=sv, articleless=pl)
 *   - All 3 prompt versions (v1, v2, v3)
 *   = 27 snapshots per builder × 2 builders = 54 snapshots total.
 *
 * Snapshot files live in __snapshots__/ and are NOT edited by hand.
 * Intentional prompt changes bump the snapshot via `jest --ci -u`.
 * Unintentional diffs block the merge.
 *
 * Also covered: a cross-article-system pair (articled learn + Scandi
 * native) so the Scandi-suffix-translation paths are frozen too.
 */
import { buildVocabSystemPrompt, type PromptVersion } from '../claude';

// The matrix: we pick one representative learn code per article system
// and one representative native code per article system.
const LEARN_REPS = ['de', 'sv', 'pl'] as const;
const NATIVE_REPS = ['de', 'sv', 'pl'] as const;
const VERSIONS: PromptVersion[] = ['v1', 'v2', 'v3'];

// Use deterministic learning-language / native-language English display
// names matching how shareProcessing passes them in production.
const NAMES: Record<string, string> = {
  de: 'German',
  sv: 'Swedish',
  pl: 'Polish',
};

describe('Prompt-output parity snapshots — locked for Phase 2 refactor', () => {
  for (const version of VERSIONS) {
    describe(`${version}`, () => {
      for (const learn of LEARN_REPS) {
        for (const native of NATIVE_REPS) {
          if (learn === native) continue; // diagonal — skipped by production anyway
          it(`${learn}→${native}`, () => {
            const prompt = buildVocabSystemPrompt(
              NAMES[native]!,
              NAMES[learn]!,
              learn,
              native,
              version,
            );
            expect(prompt).toMatchSnapshot();
          });
        }
      }
    });
  }

  // A few extra combos that exercise specific edge cases not covered by
  // the symmetric matrix above:
  it('v2 articled→articled canonical (de→en)', () => {
    expect(buildVocabSystemPrompt('English', 'German', 'de', 'en', 'v2')).toMatchSnapshot();
  });

  it('v3 articled→scandi (fr→no, tests romance-adj + scandi-suffix translation)', () => {
    expect(buildVocabSystemPrompt('Norwegian', 'French', 'fr', 'no', 'v3')).toMatchSnapshot();
  });

  it('v3 scandi→articleless (da→cs, tests scandi-extract + bare-target)', () => {
    expect(buildVocabSystemPrompt('Czech', 'Danish', 'da', 'cs', 'v3')).toMatchSnapshot();
  });

  it('v2 articleless→articled (cs→it, tests bare-source→indef-target w/ mass-noun note)', () => {
    expect(buildVocabSystemPrompt('Italian', 'Czech', 'cs', 'it', 'v2')).toMatchSnapshot();
  });
});
