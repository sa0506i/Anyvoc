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

### 2. Non-English AoA via offline LLM estimates (in progress)
**File:** `scripts/build-aoa-llm.ts`
**Current state:** The build script exists and generates per-language
`lib/data/aoa_{lang}.json` via a direct Anthropic Messages API call
(Haiku, temperature 0). `features.ts` loads all 12 languages through a
static require switch and degrades gracefully to `1 - zipfNorm` when a
word is missing from the AoA map. Empty placeholders are committed so
Metro can resolve the requires before any language is actually rated.

**Remaining work:**
  - Run `ANTHROPIC_API_KEY=... npm run build:aoa-llm -- --lang=de` and
    commit the resulting `aoa_de.json`. Repeat for the other 10 non-EN
    languages (`fr es it pt nl sv no da pl cs`).
  - Optional: cross-validate the EN estimates against Kuperman norms
    (target r ≈ 0.80) to sanity-check the prompt/model combo before
    committing all 11 languages.

**Impact:** non-EN languages currently match the pre-change behaviour
(Zipf-based fallback) because the committed placeholders are empty.
Once the LLM-generated data lands, classification will have a real AoA
signal for all 12 supported languages.

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

### ✅ Threshold recalibration via logistic regression
**Resolved by:** the calibration pipeline at
`scripts/build-gold.ts` → `scripts/build-gold-llm.ts` →
`scripts/export-features.ts` → `scripts/calibrate-model.py`. The pipeline
parses ~64 700 CEFR-labelled words from KELLY (en, it, sv), CEFRLex
(FLELex/ELELex/NT2Lex for fr, es, nl) and Goethe-Institut PDFs (de
A1/A2/B1), runs them through `extractFeatures()`, fits an ordinal logit
in `statsmodels.OrderedModel`, and writes `tmp/gold/model.json` with the
learned weights and quantile-derived cut points. The numbers in
`lib/classifier/score.ts` (W_ZIPF, W_AOA, THETA_*) are copied from that
file. Re-run `npm run calibrate` whenever the gold set or feature
extractor changes; copy the new constants into `score.ts` in one commit.

Why quantile-overridden cuts: the raw OrderedModel cuts pushed θ_0 below
the achievable η range and θ_4 above it, so the model never predicted
A1 or C2. The calibration script overrides the learned cuts with the
empirical η-quantiles that match the marginal CEFR distribution of the
gold set, which guarantees every level remains reachable while keeping
the learned weights' RANKING intact.

### ✅ Skipped test: `philosophy (en) → C1 or C2`
Un-skipped after TODO #2 was resolved. Current model puts `philosophy`
at C1.

## Open follow-ups for the gold pipeline

- LLM-oracle (`npm run build:gold-llm -- --lang=...`) for the 5
  languages with no open CEFR list: `pt da cs no pl`. Norwegian's KELLY
  file is unusable (no CEFR column). Adding these will rebalance the
  per-language coverage from 7 to all 12 supported languages and should
  improve the cut points further when re-fitted.
- The German Goethe data only covers A1/A2/B1, so the model has no
  native German signal at B2/C1/C2. Either add a Goethe C-level source
  if one becomes available, or rely on the cross-lingual signal from
  the other 6 languages plus the LLM-oracle additions.
