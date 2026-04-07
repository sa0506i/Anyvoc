# Classifier TODOs

Every deferred item in `lib/classifier/` carries a grep-able marker:
`// TODO(classifier):`. Run `grep -rn "TODO(classifier)" lib/ scripts/` to
find them all. This file is the high-level index.

## Open items

### 1. Wiktionary-backed NLD for cognate detection
**File:** `lib/classifier/cognates.ts`
**Current state:** `getEnglishGloss()` returns `null` for every input. The
adjustment is then skipped (no bonus/penalty) instead of firing on NLD=0.
**Unblocker:** an on-device source for English glosses of the source word.
A stripped Wiktionary dump committed to `lib/data/gloss_{lang}.json` would
let `getEnglishGloss()` return a string; nothing else in the file needs to
change.
**Impact:** currently disables the -0.08 / +0.04 cognate adjustment. The
classifier is a few percentage points less accurate on cognate-heavy
Germanic/Romance vocabulary.

_(No further open items — see "Resolved" below for completed work.)_

## Resolved

### ✅ Concreteness feature dropped
**Decision:** Removed from runtime entirely (instead of populating it).
**Why:**
  - The feature was permanently fall-back-only across all 12 languages
    (`conc_en.json` was the empty placeholder; non-EN was hardcoded to
    0.5). The calibration pipeline always dropped it as a zero-variance
    feature.
  - Concreteness is a weak CEFR signal once AoA is in the model — the
    two correlate strongly and AoA is the more robust of the two.
  - Maintaining a permanently disabled third feature was code/data debt
    with no benefit.

**What changed:**
  - `lib/classifier/features.ts`: `Features` interface shrunk to
    `{zipfNorm, aoaNorm, zipf, fallbackCount, usedFallback{zipf,aoa}}`.
    Removed `getConc()`, `loadConcEn()`, the concreteness branch.
  - `lib/classifier/fallback.ts`: `computeConfidence()` simplified
    (max fallback count is now 2 instead of 3).
  - `scripts/export-features.ts`: dropped `concNorm`/`fb_conc` columns
    from `features.csv`.
  - `scripts/calibrate-model.py`: dropped the zero-variance filter that
    used to remove `concNorm`.
  - `scripts/build-norms.ts`: dropped the `--conc=` flag and the
    `buildConc()` Brysbaert parser.
  - `lib/data/conc_en.json`: deleted.
  - `ATTRIBUTION.md`: Brysbaert section replaced with a note about the
    LLM-generated AoA estimates for non-English languages.

**Reversal cost:** ~1 hour. The frequency/AoA loading pattern in
`features.ts` is the template; re-adding a third feature means adding
one more `loadXyz()` switch + one more branch in `extractFeatures()`,
extending the CSV header in `export-features.ts`, and putting it back
into the `X_cols` list in `calibrate-model.py`. No architectural
change needed.

### ✅ Threshold recalibration via logistic regression
**Resolved by:** the calibration pipeline at
`scripts/build-gold.ts` → `scripts/build-gold-llm.ts` →
`scripts/export-features.ts` → `scripts/calibrate-model.py`. The pipeline
parses ~84 700 CEFR-labelled words from KELLY (en, it, sv), CEFRLex
(FLELex/ELELex/NT2Lex for fr, es, nl), Goethe-Institut PDFs (de
A1/A2/B1), Aspekte neu B2/C1 (de), Oxford-5000 (en B2/C1), and
LLM-oracle rows for pt/da/cs/no/pl, runs them through `extractFeatures()`,
fits an ordinal logit in `statsmodels.OrderedModel`, and writes
`tmp/gold/model.json` with the learned weights and quantile-derived cut
points. The numbers in `lib/classifier/score.ts` (W_ZIPF, W_AOA, THETA_*)
are copied from that file. Re-run `npm run calibrate` whenever the gold
set or feature extractor changes; copy the new constants into `score.ts`
in one commit.

Why quantile-overridden cuts: the raw OrderedModel cuts pushed θ_0 below
the achievable η range and θ_4 above it, so the model never predicted
A1 or C2. The calibration script overrides the learned cuts with the
empirical η-quantiles that match the marginal CEFR distribution of the
gold set, which guarantees every level remains reachable while keeping
the learned weights' RANKING intact.

### ✅ Skipped test: `philosophy (en) → C1 or C2`
Un-skipped after TODO #2 was resolved. Current model puts `philosophy`
at C1.

### ✅ Non-English AoA via offline LLM estimates
**Resolved by:** `scripts/build-aoa-llm.ts` has been run for all 11
non-English languages. All `lib/data/aoa_{lang}.json` files are
populated (~200 KB each) and committed. `features.ts` consumes them
through the static require switch. Re-run the script per language if
the frequency table or prompt changes.

### ✅ LLM-oracle for pt/da/cs/no/pl
**Resolved by:** `npm run build:gold-llm -- --lang=...` has been run
for all 5 languages with no open CEFR list. The oracle rows are
merged into `tmp/gold/gold-cefr.jsonl` and preserved across
`build-gold` re-runs. Note: validating the model against these rows
is circular (the oracle that trained the model can't judge it), so
`validate-gold-all.ts` skips `no` and the benchmark script excludes
all 5 from the reference-gold comparison.

### ✅ German B2/C1 gold coverage
**Resolved by:** Aspekte neu B2 (~2300 rows) and Aspekte neu C1
(~3000 rows) are now parsed by `build-gold.ts` and feed directly into
the calibration. DE now has native signal across A1–C1. C2 is still
uncovered (no open Goethe-C2 wordlist exists); the cross-lingual
C2 signal from KELLY-it / FLELex / Oxford-5000-adjacent fills in.

### ✅ Oxford-5000 for English B2/C1
**Resolved by:** `build-gold.ts` parses Oxford 5000 American English
and contributes ~1970 EN B2/C1 rows. KELLY-en B2/C1/C2 are explicitly
dropped in `calibrate-model.py` as gold noise (feature-overlap); the
Oxford rows replace them as the primary EN upper-level signal.
