# KPI Diff — Sweep Comparison

- Baseline: 2026-04-23T11:00:55.868Z  ·  seed=42  ·  132 combos
- After:    2026-04-23T10:48:56.896Z  ·  seed=42  ·  132 combos

| KPI | Baseline | After | Δ | Target |
|---|---|---|---|---|
| Repetition-Loop Rate (≥10× same entry) | 0.0% | **0.0%** | = 0.0pp | 0% |
| Repetition Presence (≥3× same entry) | 0.0% | **0.0%** | = 0.0pp | <5% |
| Within-Combo Duplicate Rate | 0.0% | **0.0%** | = 0.0pp | <1% |
| Cross-Native Median Jaccard | 0.600 | **0.504** | ✗ -0.096 (-16.0%) | ≥0.75 |
| Core-Vocab Stability (in-all-natives) | 22.3% | **16.1%** | ✗ -6.2pp (-27.8%) | ≥40% |
| Multi-Word-Noun Violations | 0 | **0** | = 0 | <30 |
| Scandinavian Nouns with Article | 99.5% | **87.1%** | ✗ -12.4pp (-12.4%) | ≥90% |
| Verb Infinitive Compliance | 100.0% | **99.9%** | = -0.1pp (-0.1%) | ≥99.5% |
| DE Translation Case Errors | 2 | **1** | ✓ -1 (-50.0%) | <5 |
| p95 Latency per Combo | 39.291 ms | **45.363 ms** | ✗ +6.072 (+15.5%) | ≤22000 |
| Total Wall Time | 46.6 min | **55.7 min** | ✗ +543 (+19.4%) | ≤1920 |
| Cost per 100 Unique Vocabs | $0.0073 | **$0.0059** | ✓ -0.0014 (-19.0%) | ≤$0.004 |
| Proper-Noun Leak Count | 0 | **0** | = 0 | <5 |
| Source-Cat Coverage (v2 only) | 0.0% | **100.0%** | = +100.0pp | ≥95% in v2 |
| Translation-Target Match Rate (v2 only) | 0.0% | **87.5%** | = +87.5pp | ≥92% in v2 |
| Scandi Def-Suffix Recognition (v2 only) | 0.0% | **92.1%** | = +92.1pp | ≥85% in v2 |
