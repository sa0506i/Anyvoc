#!/usr/bin/env python3
"""
calibrate-compare.py

Testing / analysis script. NOT used by the app. Explores how stable the
learned (w_zipf, w_aoa, thetas) are across languages and language families
when reference-grade CEFR data is available.

Three analyses:

  1. Per-language — fit the same ordinal-logit model separately for each
     of the 7 languages that have reference-grade gold data:
       en (KELLY-en), de (Goethe), fr (FLELex), es (ELELex),
       it (KELLY-it), nl (NT2Lex), sv (KELLY-sv).
     Languages with only LLM-oracle data (pt/da/cs/no/pl) are skipped
     because the oracle IS the model you'd be comparing against.

  2. Per-family (reference only) — group the same languages into Germanic
     (en/de/nl/sv) and Romance (fr/es/it) and re-fit. Slavic has no
     reference data in the current gold set, so the "Slavic" row is just
     a note.

  3. Per-family (full, incl. LLM-oracle) — same family grouping but this
     time INCLUDING the oracle-labeled languages:
       Germanic = en/de/nl/sv/no/da
       Romance  = fr/es/it/pt
       Slavic   = pl/cs
     Question this answers: does a family-sharded model beat the pooled
     12-language baseline (currently shipped in score.ts) by enough to
     justify shipping three model files?

A combined baseline ("all 7 reference languages") is also printed so you
can see how much variance each split adds over the pooled fit. Analysis
3 additionally prints a 12-language pooled baseline fit from the same
full data, for apples-to-apples comparison with the deployed model.

Input  : tmp/gold/features.csv  (produced by npm run build:export-features)
Output : stdout only. No file writes, no model.json updates.

Run:
  python scripts/calibrate-compare.py
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

try:
    from statsmodels.miscmodels.ordinal_model import OrderedModel
except ImportError as e:  # pragma: no cover
    print(
        "[compare] statsmodels missing. Install with:\n"
        "  pip install --user statsmodels scipy pandas",
        file=sys.stderr,
    )
    raise SystemExit(1) from e


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FEATURES_CSV = ROOT / "tmp" / "gold" / "features.csv"

CEFR_LABELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
X_COLS = ["zipfNorm", "aoaNorm"]

# Languages with reference-grade CEFR data (KELLY / CEFRLex / Goethe).
REF_LANGUAGES = ["en", "de", "fr", "es", "it", "nl", "sv"]

FAMILIES: dict[str, list[str]] = {
    "Germanic": ["en", "de", "nl", "sv"],
    "Romance": ["fr", "es", "it"],
    # Slavic: no reference data available (pl/cs are LLM-oracle only)
}

# Full family grouping including LLM-oracle languages (analysis 3).
FAMILIES_FULL: dict[str, list[str]] = {
    "Germanic": ["en", "de", "nl", "sv", "no", "da"],
    "Romance": ["fr", "es", "it", "pt"],
    "Slavic": ["pl", "cs"],
}


@dataclass
class FitResult:
    name: str
    languages: list[str]
    n_train: int
    n_test: int
    weights: dict[str, float]
    thresholds: list[float]  # quantile-overridden, length 5
    exact: float
    within_one: float
    mae: float
    ok: bool
    note: str = ""


def _common_filters(df: pd.DataFrame) -> pd.DataFrame:
    """Preprocessing shared by both loaders — same as calibrate-model.py."""
    # Drop all-fallback rows
    df = df[(df["fb_zipf"] == 0) | (df["fb_aoa"] == 0)].copy()
    # Drop KELLY-en C2 noise
    df = df[~((df["source"] == "KELLY-en") & (df["cefr"] == "C2"))].copy()
    # Drop suspicious high-Zipf C1/C2 rows
    suspicious = (
        ((df["cefr"] == "C2") & (df["zipf"] >= 5.5))
        | ((df["cefr"] == "C1") & (df["zipf"] >= 6.0))
    )
    df = df[~suspicious].copy()
    return df


def load_and_filter() -> pd.DataFrame:
    """Reference data only (analyses 1 and 2)."""
    df = pd.read_csv(FEATURES_CSV)
    df = _common_filters(df)
    # Exclude LLM-oracle rows — analyses 1/2 use reference data only.
    df = df[df["source"] != "LLM-oracle"].copy()
    return df.reset_index(drop=True)


def load_and_filter_full() -> pd.DataFrame:
    """All 12 languages, reference + LLM-oracle (analysis 3)."""
    df = pd.read_csv(FEATURES_CSV)
    df = _common_filters(df)
    return df.reset_index(drop=True)


def stratified_split(df: pd.DataFrame, seed: int = 42) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    mask = np.zeros(len(df), dtype=bool)
    for _, idx in df.groupby(["language", "cefr"]).groups.items():
        idx = list(idx)
        rng.shuffle(idx)
        n_train = max(1, int(round(len(idx) * 0.8)))
        for i in idx[:n_train]:
            mask[i] = True
    return df[mask].copy(), df[~mask].copy()


def fit_group(name: str, languages: list[str], df_all: pd.DataFrame) -> FitResult:
    df = df_all[df_all["language"].isin(languages)].reset_index(drop=True)
    if len(df) < 50:
        return FitResult(
            name=name,
            languages=languages,
            n_train=len(df),
            n_test=0,
            weights={c: float("nan") for c in X_COLS},
            thresholds=[float("nan")] * 5,
            exact=float("nan"),
            within_one=float("nan"),
            mae=float("nan"),
            ok=False,
            note=f"too few rows ({len(df)})",
        )

    train, test = stratified_split(df)

    X_train = train[X_COLS].astype(float).reset_index(drop=True)
    # statsmodels OrderedModel bug-workaround: only declare categories
    # that actually appear in the training subset. Passing all 6 CEFR
    # labels when some are missing makes k_levels mismatch the param
    # vector size → "shapes (N,2) and (1,) not aligned" during fit.
    present_labels = [c for c in CEFR_LABELS if c in set(train["cefr"].unique())]
    y_train = pd.Series(
        pd.Categorical(train["cefr"], categories=present_labels, ordered=True),
        name="cefr",
    )

    # Guard against a group that doesn't span enough levels to be useful.
    levels_present = set(train["cefr"].unique())
    if len(levels_present) < 3:
        return FitResult(
            name=name,
            languages=languages,
            n_train=len(train),
            n_test=len(test),
            weights={c: float("nan") for c in X_COLS},
            thresholds=[float("nan")] * 5,
            exact=float("nan"),
            within_one=float("nan"),
            mae=float("nan"),
            ok=False,
            note=f"only {len(levels_present)} CEFR levels present",
        )

    try:
        model = OrderedModel(y_train, X_train, distr="logit", hasconst=False)
        res = model.fit(method="bfgs", disp=False, maxiter=1000)
    except Exception as e:  # noqa: BLE001
        msg = str(e)[:80]
        return FitResult(
            name=name,
            languages=languages,
            n_train=len(train),
            n_test=len(test),
            weights={c: float("nan") for c in X_COLS},
            thresholds=[float("nan")] * 5,
            exact=float("nan"),
            within_one=float("nan"),
            mae=float("nan"),
            ok=False,
            note=f"fit failed: {type(e).__name__}: {msg}",
        )

    n_feat = X_train.shape[1]
    params = res.params.values
    weights = params[:n_feat]
    weight_dict = {c: float(w) for c, w in zip(X_COLS, weights)}

    # Quantile-override cut points (same as calibrate-model.py).
    # The present-levels set may be smaller than 6. We still compute 5
    # thresholds against CEFR_LABELS — any level not present in train gets
    # a zero-weight contribution and the threshold collapses onto the
    # neighbour, which is the correct degenerate behaviour.
    eta_train = X_train.to_numpy(dtype=float) @ weights
    train_levels = np.array(train["cefr"].tolist())
    sorted_eta = np.sort(eta_train)
    cum = 0.0
    thresholds: list[float] = []
    for i in range(len(CEFR_LABELS) - 1):
        lvl = CEFR_LABELS[i]
        cum += float((train_levels == lvl).sum()) / len(train_levels)
        idx = int(round(cum * (len(sorted_eta) - 1)))
        thresholds.append(float(sorted_eta[idx]))

    def predict_level(eta: float) -> str:
        for i, t in enumerate(thresholds):
            if eta < t:
                return CEFR_LABELS[i]
        return CEFR_LABELS[-1]

    if len(test) == 0:
        return FitResult(
            name=name,
            languages=languages,
            n_train=len(train),
            n_test=0,
            weights=weight_dict,
            thresholds=thresholds,
            exact=float("nan"),
            within_one=float("nan"),
            mae=float("nan"),
            ok=True,
            note="no test rows",
        )

    eta_test = test[X_COLS].to_numpy(dtype=float) @ weights
    preds = [predict_level(e) for e in eta_test]
    test = test.assign(predicted=preds)
    ord_map = {c: i for i, c in enumerate(CEFR_LABELS)}
    ord_true = test["cefr"].map(ord_map).to_numpy()
    ord_pred = test["predicted"].map(ord_map).to_numpy()
    exact = float((ord_true == ord_pred).mean())
    within_one = float((np.abs(ord_true - ord_pred) <= 1).mean())
    mae = float(np.abs(ord_true - ord_pred).mean())

    return FitResult(
        name=name,
        languages=languages,
        n_train=len(train),
        n_test=len(test),
        weights=weight_dict,
        thresholds=thresholds,
        exact=exact,
        within_one=within_one,
        mae=mae,
        ok=True,
    )


def fmt_row(r: FitResult) -> str:
    if not r.ok:
        return (
            f"{r.name:<10s}  {','.join(r.languages):<14s}  "
            f"n={r.n_train:>5d}+{r.n_test:<5d}  "
            f"{'—':>8s} {'—':>8s}  "
            f"{'—':>8s} {'—':>8s} {'—':>8s} {'—':>8s} {'—':>8s}  "
            f"{'—':>5s} {'—':>5s} {'—':>5s}  ({r.note})"
        )
    w = r.weights
    t = r.thresholds
    return (
        f"{r.name:<10s}  {','.join(r.languages):<14s}  "
        f"n={r.n_train:>5d}+{r.n_test:<5d}  "
        f"{w['zipfNorm']:>+8.4f} {w['aoaNorm']:>+8.4f}  "
        f"{t[0]:>+8.4f} {t[1]:>+8.4f} {t[2]:>+8.4f} {t[3]:>+8.4f} {t[4]:>+8.4f}  "
        f"{r.exact:>5.3f} {r.within_one:>5.3f} {r.mae:>5.3f}"
    )


HEADER = (
    f"{'group':<10s}  {'langs':<14s}  "
    f"{'n':<12s}  "
    f"{'w_zipf':>8s} {'w_aoa':>8s}  "
    f"{'th A1|A2':>8s} {'th A2|B1':>8s} {'th B1|B2':>8s} {'th B2|C1':>8s} {'th C1|C2':>8s}  "
    f"{'exact':>5s} {'±1':>5s} {'mae':>5s}"
)


def dispersion(rows: Iterable[FitResult], key: str) -> str:
    vals = [r.weights[key] for r in rows if r.ok]
    if not vals:
        return "—"
    mean = float(np.mean(vals))
    std = float(np.std(vals, ddof=0))
    lo, hi = min(vals), max(vals)
    return f"mean {mean:+.4f}  std {std:.4f}  min {lo:+.4f}  max {hi:+.4f}  range {hi-lo:.4f}"


def main() -> int:
    if not FEATURES_CSV.exists():
        print(
            f"[compare] Input not found: {FEATURES_CSV}\n"
            "Run npm run build:export-features first.",
            file=sys.stderr,
        )
        return 1

    df = load_and_filter()
    print(f"[compare] reference-data rows after filtering: {len(df)}")
    present_langs = sorted(df["language"].unique())
    print(f"[compare] languages present: {present_langs}")
    print()

    # ---- Baseline: all reference languages pooled ----
    baseline = fit_group("Baseline", present_langs, df)

    # ---- Per-language fits ----
    per_lang_results: list[FitResult] = []
    for lang in REF_LANGUAGES:
        if lang not in present_langs:
            continue
        per_lang_results.append(fit_group(lang, [lang], df))

    # ---- Per-family fits ----
    per_family_results: list[FitResult] = []
    for family, langs in FAMILIES.items():
        present = [l for l in langs if l in present_langs]
        if not present:
            per_family_results.append(
                FitResult(
                    name=family,
                    languages=langs,
                    n_train=0,
                    n_test=0,
                    weights={c: float("nan") for c in X_COLS},
                    thresholds=[float("nan")] * 5,
                    exact=float("nan"),
                    within_one=float("nan"),
                    mae=float("nan"),
                    ok=False,
                    note="no reference data",
                )
            )
        else:
            per_family_results.append(fit_group(family, present, df))

    # ---- Render ----
    print("=" * 140)
    print("PER-LANGUAGE CALIBRATION (one fit per language, reference data only)")
    print("=" * 140)
    print(HEADER)
    print("-" * len(HEADER))
    for r in per_lang_results:
        print(fmt_row(r))

    print()
    print("Weight dispersion across per-language fits:")
    print(f"  w_zipf  {dispersion(per_lang_results, 'zipfNorm')}")
    print(f"  w_aoa   {dispersion(per_lang_results, 'aoaNorm')}")

    print()
    print("=" * 140)
    print("PER-FAMILY CALIBRATION (reference data only)")
    print("=" * 140)
    print(HEADER)
    print("-" * len(HEADER))
    for r in per_family_results:
        print(fmt_row(r))
    print("Slavic     (pl,cs)         — skipped: no reference-grade gold data, LLM-oracle only")

    print()
    print("Weight dispersion across per-family fits:")
    print(f"  w_zipf  {dispersion(per_family_results, 'zipfNorm')}")
    print(f"  w_aoa   {dispersion(per_family_results, 'aoaNorm')}")

    print()
    print("=" * 140)
    print("BASELINE (all 7 reference languages pooled)")
    print("=" * 140)
    print(HEADER)
    print("-" * len(HEADER))
    print(fmt_row(baseline))

    # ------------------------------------------------------------------
    # Analysis 3: per-family, full (reference + LLM-oracle, all 12 langs)
    # ------------------------------------------------------------------
    df_full = load_and_filter_full()
    present_full = sorted(df_full["language"].unique())
    print()
    print("=" * 140)
    print("PER-FAMILY CALIBRATION (full: reference + LLM-oracle, all 12 languages)")
    print("=" * 140)
    print(f"[compare] full-data rows after filtering: {len(df_full)}")
    print(f"[compare] languages present: {present_full}")
    print()
    print(HEADER)
    print("-" * len(HEADER))

    per_family_full_results: list[FitResult] = []
    for family, langs in FAMILIES_FULL.items():
        present = [l for l in langs if l in present_full]
        if not present:
            per_family_full_results.append(
                FitResult(
                    name=family,
                    languages=langs,
                    n_train=0,
                    n_test=0,
                    weights={c: float("nan") for c in X_COLS},
                    thresholds=[float("nan")] * 5,
                    exact=float("nan"),
                    within_one=float("nan"),
                    mae=float("nan"),
                    ok=False,
                    note="no data",
                )
            )
        else:
            per_family_full_results.append(fit_group(family, present, df_full))
    for r in per_family_full_results:
        print(fmt_row(r))

    print()
    print("Weight dispersion across per-family (full) fits:")
    print(f"  w_zipf  {dispersion(per_family_full_results, 'zipfNorm')}")
    print(f"  w_aoa   {dispersion(per_family_full_results, 'aoaNorm')}")

    # Pooled 12-lang baseline for apples-to-apples comparison with the
    # deployed model in lib/classifier/score.ts.
    baseline_full = fit_group("Baseline12", present_full, df_full)
    print()
    print("=" * 140)
    print("BASELINE (all 12 languages pooled — same filter as deployed model)")
    print("=" * 140)
    print(HEADER)
    print("-" * len(HEADER))
    print(fmt_row(baseline_full))

    # Weighted mean of per-family exact accuracy, so we can compare
    # "sharded family models" vs "single pooled model" on the same n_test.
    ok_full = [r for r in per_family_full_results if r.ok and r.n_test > 0]
    if ok_full:
        total_test = sum(r.n_test for r in ok_full)
        weighted_exact = sum(r.exact * r.n_test for r in ok_full) / total_test
        weighted_within = sum(r.within_one * r.n_test for r in ok_full) / total_test
        weighted_mae = sum(r.mae * r.n_test for r in ok_full) / total_test
        print()
        print(
            f"Per-family (full) WEIGHTED eval over {total_test} test rows:  "
            f"exact {weighted_exact:.3f}  ±1 {weighted_within:.3f}  mae {weighted_mae:.3f}"
        )
        print(
            f"12-lang POOLED baseline on the same split:             "
            f"exact {baseline_full.exact:.3f}  ±1 {baseline_full.within_one:.3f}  mae {baseline_full.mae:.3f}"
        )
        delta = weighted_exact - baseline_full.exact
        verdict = (
            "family-sharded BEATS pooled"
            if delta > 0.01
            else "pooled >= family-sharded (shard not worth the complexity)"
            if delta < -0.005
            else "roughly equivalent (<1 pp) -- prefer pooled for simplicity"
        )
        print(f"delta exact (family - pooled): {delta:+.3f}  ->  {verdict}")
        print()
        print("IMPORTANT caveat on the Slavic row:")
        print("  pl/cs have ONLY LLM-oracle labels. The regression is fitted")
        print("  against the same oracle labels it's then evaluated on, which")
        print("  makes any Slavic exact accuracy a self-agreement number, not")
        print("  a generalisation score. Treat Slavic>=0.7 as an artefact of")
        print("  that circularity, not evidence that the model is stronger on")
        print("  Slavic than on Germanic/Romance.")

    print()
    print("Deployed model in lib/classifier/score.ts (fitted on all 12 languages ")
    print("including LLM-oracle rows for pt/da/cs/no/pl):")
    print(
        "  w_zipf=-2.2742  w_aoa=+4.3261  "
        "th=(-0.4959, +0.3116, +1.2629, +1.7124, +2.1704)"
    )
    print()
    print("Notes:")
    print("  - Signs of w_zipf vary and are partly absorbed by the quantile")
    print("    threshold override (see calibrate-model.py). Focus on relative")
    print("    magnitudes and the eval scores rather than absolute sign.")
    print("  - 'th A1|A2' ... 'th C1|C2' are the ordinal-logit cut points")
    print("    (theta_0 ... theta_4) after the quantile override.")
    print("  - A per-language fit with few rows or few distinct CEFR levels")
    print("    will degenerate; such rows are marked with a note.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
