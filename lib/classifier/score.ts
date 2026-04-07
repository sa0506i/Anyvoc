/**
 * score.ts — turns extracted features into a CEFR difficulty score and label.
 *
 * The score is the linear predictor (η) of an ordinal logistic regression
 * model fitted to ~67 300 CEFR-labelled words across all 12 supported
 * languages (English, German, French, Spanish, Italian, Dutch, Swedish,
 * Portuguese, Danish, Czech, Norwegian, Polish). Sources of the gold
 * dataset:
 *   - KELLY project XLS lists (en, it, sv) — CC BY-NC-SA
 *   - Goethe-Institut PDF wordlists (de, A1/A2/B1) — © Goethe-Institut, fair-
 *     use snippet for offline calibration
 *   - CEFRLex resources: FLELex (fr), ELELex (es), NT2Lex (nl) — academic
 *   - LLM-oracle (Claude Haiku) for pt/da/cs/no/pl, top-2000 frequency words
 *
 * Build pipeline (dev-machine only):
 *   npm run build:gold              # parse all of the above into JSONL
 *   npm run build:gold-llm          # optional: LLM-oracle for pt/da/cs/no/pl
 *   npm run build:export-features   # join with extractFeatures()
 *   npm run calibrate               # fits the model, writes tmp/gold/model.json
 * The numbers below were copied verbatim from tmp/gold/model.json after the
 * last calibration run. Re-run the pipeline and update them in one commit
 * whenever the gold set or feature extractor changes.
 *
 * Model form (cumulative ordinal logit):
 *   η  = w_zipf · zipfNorm + w_aoa · aoaNorm
 *   P(CEFR ≤ k) = sigmoid(θ_k − η)
 * The predicted level is the lowest k whose θ_k exceeds η.
 *
 * Notes on the current fit:
 *   - The feature vector is intentionally just (zipfNorm, aoaNorm). An
 *     earlier revision also carried a concreteness feature, but it was
 *     never populated for any language and the calibration always
 *     dropped it as zero-variance. See lib/classifier/TODO.md "Resolved"
 *     section for the rationale.
 *   - The model's coefficient on zipfNorm collapsed to near-zero
 *     because zipfNorm and aoaNorm are highly collinear in our gold
 *     data (a large share of AoA-fallback rows use aoaNorm = 1-zipfNorm
 *     by design). The fitted weights are still the best linear predictor
 *     we have given the data, and the confusion matrix shows ±1-level
 *     accuracy ≈ 68 %, which is good enough to ship until we add more
 *     languages with native AoA data.
 */

import { CEFR_LEVELS, type CEFRLevel } from '../../constants/levels';
import type { Features } from './features';

// ----------------------------------------------------------------------------
// Learned coefficients — copied from tmp/gold/model.json (npm run calibrate).
// Last fit: ordinal logit on 52 190 train rows across 12 languages, with
// quantile-overridden cut points (see calibrate-model.py for the rationale:
// the raw OrderedModel cuts left A1 and C2 unreachable in practice).
// Eval: exact 35.0 %, ±1 level 75.0 %, MAE 1.013 levels.
//
// Two changes drove the jump from the previous fit:
//   1. English frequency data was upgraded from Leipzig's 300K news tier
//      to the 1M tier (see scripts/build-freq.ts SIZE_OVERRIDES). This
//      roughly halves the rare-word miss rate that previously forced
//      advanced EN vocabulary into the zipf-fallback bucket.
//   2. KELLY-en B2 AND C1 rows are now dropped from the training set
//      (in addition to the long-standing C2 drop). Feature-level analysis
//      showed KELLY-en's B2/C1 zipf medians were only 0.16 apart and the
//      aoaNorm medians only 0.03 apart — below what a linear ordinal
//      model can separate. Keeping them pulled the pooled B2|C1 threshold
//      into a compromise that hurt every other language. EN per-language
//      exact accuracy climbed from ~30 % → 50.2 % after the drop.
//
// W_ZIPF is negative (higher Zipf = more frequent → LOWER η → easier),
// which is the semantically expected direction.
// ----------------------------------------------------------------------------

const W_ZIPF = -1.9267;
const W_AOA = 4.7804;

const THETA_A1_A2 = -0.1559;
const THETA_A2_B1 = 0.6753;
const THETA_B1_B2 = 1.5918;
const THETA_B2_C1 = 2.0130;
const THETA_C1_C2 = 2.6026;

/**
 * Computes the linear predictor η for a word. Higher = more advanced /
 * harder. Range is roughly [−2.3, +4.3] given that zipfNorm and aoaNorm
 * are both in [0,1] and w_zipf < 0 < w_aoa. This used to return a [0,1]
 * difficulty score; the range is now wider (and signed) but the SEMANTICS
 * (higher = harder) are unchanged, so cognates.ts and the rest of the
 * pipeline keep working.
 */
export function scoreDifficulty(f: Features): number {
  return W_ZIPF * f.zipfNorm + W_AOA * f.aoaNorm;
}

/**
 * Pass-through clamp kept for cognates.ts backward compatibility. The
 * old score was bounded to [0,1]; the new η is unbounded, so clamp01 is
 * effectively a no-op. We still flatten NaN/-Infinity to 0 to be safe.
 */
export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x;
}

const THRESHOLDS: Array<{ max: number; level: CEFRLevel }> = [
  { max: THETA_A1_A2, level: 'A1' },
  { max: THETA_A2_B1, level: 'A2' },
  { max: THETA_B1_B2, level: 'B1' },
  { max: THETA_B2_C1, level: 'B2' },
  { max: THETA_C1_C2, level: 'C1' },
];

export function difficultyToCefr(difficulty: number): CEFRLevel {
  for (const t of THRESHOLDS) {
    if (difficulty < t.max) return t.level;
  }
  return 'C2';
}

export function isValidCefr(label: string): label is CEFRLevel {
  return (CEFR_LEVELS as readonly string[]).includes(label);
}
