#!/usr/bin/env python3
"""
calibrate-model.py

Fits an ordinal logistic regression on the gold-CEFR feature dataset
produced by:

    npm run build:gold              # KELLY + CEFRLex parsers
    npm run build:gold-llm -- --lang=pt
    npm run build:gold-llm -- --lang=da
    npm run build:gold-llm -- --lang=cs
    npm run build:export-features   # join with extractFeatures()

Reads:   tmp/gold/features.csv
Writes:  tmp/gold/model.json   (the learned weights + cut points)

The model is the conventional cumulative-logit form:

    P(CEFR <= k) = sigmoid(theta_k - eta)
    eta = w_zipf * zipfNorm + w_aoa * aoaNorm

theta_0..theta_4 are the learned cut points between consecutive CEFR
levels (A1|A2, A2|B1, B1|B2, B2|C1, C1|C2). At runtime score.ts will
compute eta the same way and pick the level via the same cut points.

(An earlier revision also included a concreteness feature; it was
permanently fall-back-only across all 12 languages and statsmodels
always dropped it as zero-variance, so it has been removed from both
the runtime and this script.)

Run: npm run calibrate
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from statsmodels.miscmodels.ordinal_model import OrderedModel
except ImportError as e:  # pragma: no cover
    print(
        "[calibrate] statsmodels missing. Install with:\n"
        "  pip install --user statsmodels scipy pandas",
        file=sys.stderr,
    )
    raise SystemExit(1) from e


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
GOLD = ROOT / "tmp" / "gold"
FEATURES_CSV = GOLD / "features.csv"
OUT_JSON = GOLD / "model.json"

CEFR_LABELS = ["A1", "A2", "B1", "B2", "C1", "C2"]


def main() -> int:
    if not FEATURES_CSV.exists():
        print(
            f"[calibrate] Input not found: {FEATURES_CSV}\n"
            "Run npm run build:export-features first.",
            file=sys.stderr,
        )
        return 1

    df = pd.read_csv(FEATURES_CSV)
    print(f"[calibrate] loaded {len(df)} rows from {FEATURES_CSV}")

    # Drop rows where every feature is a fallback (no signal at all).
    informative = df[(df["fb_zipf"] == 0) | (df["fb_aoa"] == 0)].copy()
    print(f"[calibrate] {len(informative)} rows after dropping all-fallback samples")

    # ------------------------------------------------------------------
    # Gold-data noise filter.
    #
    # KELLY's C2 bucket is the catch-all for everything beyond the C1
    # curriculum — it ends up containing thousands of common-but-formal
    # technical / register-marked words that are NOT actually rare. For
    # example KELLY-en has 2399 C2 entries vs 1107 B2 entries. Including
    # them creates a strong U-shape (mean zipfNorm rises again at C1/C2)
    # which corrupts the ordinal fit and causes the model to collapse all
    # predictions into the A2..B1 middle. We drop them outright.
    #
    # KELLY-en B2 and C1 are ALSO dropped: feature-level analysis
    # (scripts/validate-gold-all.ts, Variant C) showed that KELLY-en's
    # B2/C1 zipf medians are only 0.16 apart, and the aoaNorm medians
    # only 0.03 apart — well below what a linear ordinal model can
    # separate. Keeping these rows pulls the pooled model's B2|C1
    # threshold into a compromise that hurts every other language.
    # The A1/A2/B1 portion of KELLY-en is clean and stays in the fit.
    #
    # KELLY-it has only 137 C2 rows, so we keep them — too few to skew
    # the fit. We keep all KELLY-it levels for now (Italian does not
    # show the same feature-overlap pathology).
    before = len(informative)
    drop_mask = (informative["source"] == "KELLY-en") & (
        informative["cefr"].isin(["B2", "C1", "C2"])
    )
    informative = informative[~drop_mask].copy()
    print(
        f"[calibrate] dropped {before - len(informative)} KELLY-en B2/C1/C2 rows "
        f"(gold noise — B2/C1 feature overlap, C2 catch-all)"
    )

    # Also drop any row whose features are obviously inconsistent with its
    # label: a "C2" word that occurs >= Zipf 5.5 in the news corpus is
    # almost certainly mislabelled (Zipf 5.5 = top ~5000 words). Same for
    # C1 above Zipf 6.0.
    suspicious = (
        ((informative["cefr"] == "C2") & (informative["zipf"] >= 5.5))
        | ((informative["cefr"] == "C1") & (informative["zipf"] >= 6.0))
    )
    print(f"[calibrate] dropping {int(suspicious.sum())} suspicious high-frequency C1/C2 rows")
    informative = informative[~suspicious].copy()

    # Print per-language and per-CEFR distribution.
    print("\nPer-language sample size:")
    print(informative.groupby("language").size().to_string())
    print("\nPer-CEFR sample size:")
    print(informative.groupby("cefr").size().to_string())

    # Stratified 80/20 split by (language, cefr) so each language and level
    # is represented in both train and test.
    rng = np.random.default_rng(42)
    train_mask = np.zeros(len(informative), dtype=bool)
    informative = informative.reset_index(drop=True)
    for _, idx in informative.groupby(["language", "cefr"]).groups.items():
        idx = list(idx)
        rng.shuffle(idx)
        n_train = max(1, int(round(len(idx) * 0.8)))
        for i in idx[:n_train]:
            train_mask[i] = True

    train = informative[train_mask].copy()
    test = informative[~train_mask].copy()
    print(f"\nTrain: {len(train)}  Test: {len(test)}")

    X_cols = ["zipfNorm", "aoaNorm"]
    X_train = train[X_cols].astype(float).reset_index(drop=True)
    y_train = pd.Series(
        pd.Categorical(train["cefr"], categories=CEFR_LABELS, ordered=True),
        name="cefr",
    )

    print("\n[calibrate] fitting OrderedModel (logit) ...")
    model = OrderedModel(y_train, X_train, distr="logit", hasconst=False)
    res = model.fit(method="bfgs", disp=False, maxiter=1000)
    print(res.summary())

    # Extract weights and cut points from the parameter vector.
    # statsmodels OrderedModel returns:
    #   params[0..n_features-1]   = feature weights
    #   params[n_features..]      = K-1 transformed cut points (first is raw,
    #                               rest are log-deltas, by construction).
    n_feat = X_train.shape[1]
    params = res.params.values
    weights = params[:n_feat]
    raw_thresh_params = params[n_feat:]
    # Reconstruct cut points: theta_0 = raw, theta_k = theta_{k-1} + exp(delta_k)
    thresholds: list[float] = [float(raw_thresh_params[0])]
    for d in raw_thresh_params[1:]:
        thresholds.append(thresholds[-1] + float(math.exp(d)))

    print("\nLearned weights:")
    for col, w in zip(X_cols, weights):
        print(f"  {col:9s}  {w: .4f}")
    print("Learned cut points (theta_0..theta_4):")
    for i, t in enumerate(thresholds):
        print(f"  {CEFR_LABELS[i]}|{CEFR_LABELS[i+1]}  {t: .4f}")

    # ------------------------------------------------------------------
    # Empirical quantile cut-points.
    #
    # The OrderedModel cut points minimise the cumulative-logit loss but
    # frequently push θ_0 below the achievable η range and θ_4 above it,
    # which in practice means the model NEVER predicts A1 or C2 even when
    # those labels exist in the gold set. We override the learned cuts
    # with quantile-based cuts derived from the empirical η distribution
    # of the training set, weighted by the marginal CEFR distribution.
    # This guarantees that every level remains reachable while preserving
    # the learned weights' RANKING (which is what the regression actually
    # got right).
    #
    # Concretely: sort all training η values, compute the cumulative
    # frequency of each CEFR level in the gold set, and use those
    # cumulative frequencies as the cut quantiles.
    # ------------------------------------------------------------------
    eta_train = X_train.to_numpy(dtype=float) @ weights
    train_levels = np.array(train["cefr"].tolist())
    cum = 0.0
    quantile_thresholds: list[float] = []
    sorted_eta = np.sort(eta_train)
    for i in range(len(CEFR_LABELS) - 1):
        lvl = CEFR_LABELS[i]
        cum += float((train_levels == lvl).sum()) / len(train_levels)
        # quantile -> sorted index
        idx = int(round(cum * (len(sorted_eta) - 1)))
        quantile_thresholds.append(float(sorted_eta[idx]))
    print("\nEmpirical quantile cut points (override):")
    for i, t in enumerate(quantile_thresholds):
        print(f"  {CEFR_LABELS[i]}|{CEFR_LABELS[i+1]}  {t: .4f}")
    thresholds = quantile_thresholds

    # ------------------------------------------------------------------
    # Evaluation on the held-out test set.
    # ------------------------------------------------------------------
    def predict_level(eta: float) -> str:
        for i, t in enumerate(thresholds):
            if eta < t:
                return CEFR_LABELS[i]
        return CEFR_LABELS[-1]

    eta_test = test[X_cols].to_numpy(dtype=float) @ weights
    test = test.assign(predicted=[predict_level(e) for e in eta_test])
    test = test.assign(
        ord_true=test["cefr"].map({c: i for i, c in enumerate(CEFR_LABELS)}),
        ord_pred=test["predicted"].map({c: i for i, c in enumerate(CEFR_LABELS)}),
    )

    exact_acc = (test["cefr"] == test["predicted"]).mean()
    within_one = (abs(test["ord_true"] - test["ord_pred"]) <= 1).mean()
    mae = abs(test["ord_true"] - test["ord_pred"]).mean()
    print(f"\nTest accuracy (exact match): {exact_acc:.3f}")
    print(f"Test accuracy (±1 level):   {within_one:.3f}")
    print(f"Test MAE (CEFR levels):     {mae:.3f}")

    print("\nConfusion matrix (rows=true, cols=pred):")
    cm = pd.crosstab(test["cefr"], test["predicted"], rownames=["true"], colnames=["pred"])
    cm = cm.reindex(index=CEFR_LABELS, columns=CEFR_LABELS, fill_value=0)
    print(cm.to_string())

    print("\nPer-language exact accuracy:")
    per_lang_acc = test.groupby("language").apply(
        lambda g: (g["cefr"] == g["predicted"]).mean()
    )
    print(per_lang_acc.to_string())

    # ------------------------------------------------------------------
    # Persist model.
    # ------------------------------------------------------------------
    out = {
        "model": "ordinal_logit",
        "features": X_cols,
        "weights": {c: float(w) for c, w in zip(X_cols, weights)},
        "thresholds": {
            "A1|A2": thresholds[0],
            "A2|B1": thresholds[1],
            "B1|B2": thresholds[2],
            "B2|C1": thresholds[3],
            "C1|C2": thresholds[4],
        },
        "evaluation": {
            "n_train": int(len(train)),
            "n_test": int(len(test)),
            "exact_accuracy": float(exact_acc),
            "within_one_accuracy": float(within_one),
            "mae_levels": float(mae),
        },
    }
    OUT_JSON.write_text(json.dumps(out, indent=2))
    print(f"\n[calibrate] wrote {OUT_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
