# Matrix-Regel Phase 1 — Slice 7 Smoke Report

**Date:** 2026-04-23
**Scope:** machinery validation, not full statistical A/B.
**Cost:** ~3 Mistral calls total (1 URL × 2 versions + 1 Scandi URL in v2). ≈ $0.001.

## What was run

| # | Command | Purpose |
|---|---|---|
| 1 | `try:pipeline --lang=de --native=en --limit=1 --seed=42 --prompt=v1 --out=tmp/smoke/v1.json` | v1 baseline, 1 German URL |
| 2 | `try:pipeline --lang=de --native=en --limit=1 --seed=42 --prompt=v2 --out=tmp/smoke/v2.json` | v2 under same seed, same URL |
| 3 | `try:pipeline --lang=sv --native=en --limit=1 --seed=42 --prompt=v2 --out=tmp/smoke/sv-v2.json` | v2 Scandi smoke |
| 4 | `sweeps:compare tmp/smoke/v1.json tmp/smoke/v2.json --out=tmp/smoke/diff.md` | KPI diff report |

## Key results

### Semantic change (v2 vs v1)

Same source text (Klexikon "Sonnensystem"), same seed, same combo. v1 vs v2 extracted nouns:

| # | v1 (always DEF) | v2 (source-preserving) |
|---|---|---|
| 1 | `der Planet → the planet` | `ein Planet → a planet` |
| 2 | `die Sonne → the sun` | `die Sonne → the sun` |
| 3 | `das Sonnensystem → the solar system` | `ein Sonnensystem → a solar system` |
| 4 | `der Stern → the star` | `ein Stern → a star` |
| 5 | `die Größe → the size` | `ein Jahr → a year` |

v2 preserves the actual article used in the source (`"ein Planet"` appears in the child's encyclopedia text); v1 normalised every noun to `der/die/das`. Matrix translation mirrors the source category perfectly in this sample — every DE DEF source maps to EN `the X`, every DE INDEF source maps to EN `a X`.

### Scandi v2 (sv→en)

31/31 nouns in a Swedish legal text carry `source_cat`. All tagged `indef` — the text uses indefinite and bare forms exclusively (common in legal prose). Examples:

- `en makt → a power` (INDEF→INDEF)
- `ett värde → a value` (INDEF neuter → INDEF)
- `en frihet → a freedom` (INDEF→INDEF)

No DEF-suffix (`hunden`-shaped) tokens in this particular corpus entry, so Scandi Def-Suffix Recognition KPI stayed 0%. A corpus entry about specific named entities (e.g. news about "the king", "the parliament") would exercise that path.

### Full KPI diff (tmp/smoke/diff.md)

| KPI | v1 | v2 | Verdict |
|---|---|---|---|
| Source-Cat Coverage (v2 only) | 0.0% | **100.0%** | ✓ v2 plumbing works |
| Translation-Target Match Rate (v2 only) | 0.0% | **100.0%** | ✓ matrix obeyed |
| Scandi Def-Suffix Recognition (v2 only) | 0.0% | 0.0% | N/A in this corpus |
| Repetition-Loop Rate | 0.0% | 0.0% | = no regression |
| Within-Combo Duplicate Rate | 0.0% | 0.0% | = |
| Multi-Word-Noun Violations | 0 | 0 | = |
| Verb Infinitive Compliance | 100.0% | 100.0% | = |
| DE Translation Case Errors | 0 | 0 | = |
| Proper-Noun Leak Count | 0 | 0 | = |
| p95 Latency | 8.2s | **12.4s** | ✗ +51% (prompt slightly longer) |
| Cost per 100 Unique Vocab | $0.0014 | $0.0014 | = |

### Verdict on the smoke: machinery ready for full sweep

All three new v2-only KPIs populate correctly. No quality regressions. Latency +51% is expected (v2 prompt has the extra source-preserving instructions) and needs watching in the full sweep but isn't a blocker. Cost is unchanged at this sample size.

## What this smoke does NOT prove

- **Statistical significance across languages and corpus types.** n=1 URL per version. Full go/no-go needs the 120-URL × 12-native sweep from the plan file.
- **Scandi Def-Suffix Recognition.** The single Scandi URL landed on legal text with only indefinite forms; a corpus that mixes definite + indefinite references is needed.
- **Quality on tricky combos** (articleless → articled, articled → Scandi, cross-family).
- **Long-tail behaviour** (repetition loops, proper-noun leaks at scale).

## Recommended next step (handed off to a human operator)

The full sweep isn't cheap and takes 5–10 minutes of wall time per version. Run it on a dev workstation with `ANYVOC_PROMPT_VERSION=v1` and then `=v2`, compare, and flip the production default in `lib/claude.ts defaultPromptVersion()` only if all quality metrics hold (Go/No-Go thresholds in the plan file section "Phase-1-Metriken" and `docs/superpowers/specs/` once the sweep finishes).

```bash
# Baseline full sweep (≈10 min, 120 URL calls)
npm run try:pipeline -- --sweep --limit=1 --seed=42 --top=0 --prompt=v1 \
  --out=tmp/sweep-v1-full.json

# After-change full sweep (≈10 min, 120 URL calls)
npm run try:pipeline -- --sweep --limit=1 --seed=42 --top=0 --prompt=v2 \
  --out=tmp/sweep-v2-full.json

# KPI diff report
npm run sweeps:compare -- tmp/sweep-v1-full.json tmp/sweep-v2-full.json \
  --out=docs/superpowers/specs/2026-04-23-phase1-ab-report.md
```

## Decision status

**Go/No-Go not yet callable** — smoke validates the machinery but not quality at scale.

- **If the full sweep's quality metrics regress** (article-category match < 85%, or any existing quality KPI worse than v1 by more than the target delta) → keep `defaultPromptVersion() === 'v1'`. v1 code path stays intact for rollback.
- **If the full sweep's quality metrics hold** → flip the default to `v2` in `lib/claude.ts` (one-line change), run the Maestro E2E once, ship.

Phase-1 exit (removing v1 builders, cleaning up Rules 34/41/42) happens in a follow-up PR after the production default has been v2 for at least one release cycle with no user reports of regression.
