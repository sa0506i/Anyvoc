# Slice 7c v3 Go/No-Go — HOLD on v2

**Date:** 2026-04-23
**Scope:** 132 combos per version, seed=42, concurrency=6.
**v2 dump:** `tmp/validation/v2-merged.json` (baseline from Slice 7).
**v3 pre-7c dump:** `tmp/validation/v3-merged.json` (from Slice 7b.4).
**v3c dump:** `tmp/validation/v3-2-merged.json` (this slice).

## Recommendation: **HOLD on v2 as default.**

Slice 7c's scope-fenced mass-noun allowance + anti-regression clause
delivered the intended improvement on Scandi prefix compliance — but
at a disproportionate cost in prompt length / latency, and without
closing the gap to v2 on any Scandi metric. The remaining regression
is a genuine Mistral Small limitation on Norwegian compound-abstract
nouns in legal/technical text, not a fixable prompt issue at this
prompt version.

## What Slice 7c fixed (vs pre-7c v3)

| Metric | v3 pre-7c | v3c | Δ |
|---|---|---|---|
| **Scandi Nouns with Article** | 58.7% | **67.9%** | **+9.2 pp** ✓ |
| Scandi prefix share (en/ett/ei/et) | 46.1% | 55.9% | +9.8 pp ✓ |
| Scandi truly-bare share (violations) | 41.3% | 32.1% | −9.2 pp ✓ |

The anti-regression clause in SCANDINAVIAN_NOUN_RULE_V3 + the TARGET-SIDE
EXCEPTION block in buildTranslationRuleV3 together pulled ~10 pp of
bare-output back to prefix-output. Isolated smoke on sv→de legal
(riksdagen.se) hit 100% prefix compliance — the fix works on typical
Scandi text.

## What Slice 7c did NOT fix / broke

| Metric | v2 | v3 pre-7c | v3c | Verdict |
|---|---|---|---|---|
| Scandi Nouns with Article | 87.1% | 58.7% | 67.9% | Still 19 pp below v2 |
| Scandi Def-Suffix Recognition | 92.1% | 74.0% | **61.2%** | Worse than pre-7c (−13 pp) |
| Translation-Target Match Rate | 87.5% | 77.8% | 76.8% | Essentially unchanged |
| **p95 Latency** | **45.4 s** | 48.6 s | **82.6 s** | **+82% vs v2** — prompt too long |
| Wall Time (full sweep) | 55.7 min | 67.0 min | 103.3 min | +86% vs v2 |

Residual 32% bare Scandi nouns are Norwegian compound abstract nouns
(`språk`, `samfunnsområde`, `likestilling`, `bokmål`, `nynorsk`,
`arkitekturstrategi`, `ambisjon`, `ressursbruk`, `innsatsområder`)
typically in legal-and-strategy text. Mistral Small consistently
outputs these bare regardless of how strongly the prompt demands a
prefix. This is a small-model limitation at this parameter class,
not a prompt design flaw — making the rule more forceful has
diminishing returns and the Slice 7c cost (+70% latency vs pre-7c)
shows we're past the point of useful prompt-tuning leverage.

## Verb-count gain retained

v3's primary win (verb extraction on noun-dense text) survives Slice 7c.
Though not directly measured in this diff (both v3 sweeps include the
type-rebalance), the scope-fencing did not affect the type-rules.

## Decision

- `defaultPromptVersion()` stays `'v2'`.
- v3c is NOT flipped to default.
- Slice-7c's code changes (the anti-regression clause + the TARGET-SIDE
  EXCEPTION block) stay in `prompt/v3.ts` as improvements to the opt-in
  v3 variant. Users who prefer the verb-count gains can still set
  `ANYVOC_PROMPT_VERSION=v3` and get a slightly-better-than-Slice-7b.3
  Scandi experience.
- Further tuning of v3 has diminishing returns against Mistral Small
  priors. A cleaner next step would be: consider a v4 that **drops the
  mass-noun allowance entirely** (keeping the type-rebalance +
  strict-Scandi-mirror wins) to shrink the prompt back to v2-comparable
  length while keeping the verb-count benefit. Open for exploration;
  not Phase-2 work.

## Residual artefacts

- `tmp/validation/v2-merged.json` + `tmp/validation/v3-merged.json` +
  `tmp/validation/v3-2-merged.json` committed as Slice-7c reference
  dumps (or kept locally; tmp/ is gitignored).
- This report + the Slice-7b.4 report together document the v3 arc.

## Rollback + emergency levers (unchanged)

- `ANYVOC_PROMPT_VERSION=v1` on Fly machine → pre-Matrix-Regel.
- `ANYVOC_PROMPT_VERSION=v3` → Slice-7c opt-in variant.
- Unset → Production default v2.
