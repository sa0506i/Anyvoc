/**
 * compare-sweeps.ts — compute & compare KPIs from one or two try-pipeline sweep dumps.
 *
 * Usage:
 *   npm run sweeps:compare -- <baseline.json>                       # single-sweep KPI report
 *   npm run sweeps:compare -- <baseline.json> <after.json>          # A/B side-by-side with deltas
 *   npm run sweeps:compare -- <base> <after> --out=tmp/diff.md      # write markdown to file
 *
 * Baseline values as of 2026-04-20 (pipeline-sweep.json, seed=42, max-chars=2000):
 *   - Repetition-Loop Rate:         9.1%
 *   - Within-Combo Duplicate Rate:  14.5%
 *   - Cross-Native Median Jaccard:  0.50
 *   - Core-Vocab Stability:         18%
 *   - Multi-Word-Noun Violations:   420
 *   - Scandinavian Nouns w/ Article: ~10%
 *   - Verb Infinitive Compliance:   ~96%
 *   - DE Translation Case Errors:   ~60
 *   - p95 Latency:                  30.3s
 *   - Wall Time:                    38.4 min
 *   - Cost per 100 Unique Vocabs:   ~$0.007
 *   - Proper Noun Leak Count:       ~25
 *
 * Pure Node. No lib/ imports. Runs with plain tsx, no shim needed.
 * Dev-machine only.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---- Dump shape (duplicated from try-pipeline to avoid expo-constants chain) ----

interface VocabItem {
  original: string;
  translation: string;
  level: string;
  type: string;
  source_forms?: string[];
}

interface PipelineResult {
  url: string;
  lang: string;
  native: string;
  corpusIndex?: number;
  corpus?: { difficulty_estimate?: string; text_type?: string; domain?: string };
  ok: boolean;
  error?: string;
  title?: string;
  textLength?: number;
  processedTextLength?: number;
  truncated?: boolean;
  elapsedMs: number;
  vocabCount?: number;
  levelDistribution?: Record<string, number>;
  typeDistribution?: Record<string, number>;
  vocab?: VocabItem[];
}

interface PipelineDump {
  ranAt?: string;
  seed?: number;
  maxChars?: number;
  sweep?: boolean;
  natives?: string[];
  totals?: Record<string, unknown>;
  results: PipelineResult[];
}

// ---- CLI ----

interface CliArgs {
  baseline: string;
  after?: string;
  out?: string;
}

function printHelp(): void {
  console.log(`compare-sweeps — KPI report for try-pipeline sweep dumps.

Usage:
  npm run sweeps:compare -- <baseline.json> [<after.json>] [--out=<path>]

Examples:
  npm run sweeps:compare -- tmp/validation/pipeline-sweep.json
  npm run sweeps:compare -- tmp/baseline.json tmp/after-fixes.json --out=tmp/kpi-diff.md

Exits 0. Writes Markdown to stdout if --out is omitted.`);
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let out: string | undefined;
  for (const raw of argv.slice(2)) {
    if (raw === '--help' || raw === '-h') {
      printHelp();
      process.exit(0);
    }
    if (raw.startsWith('--out=')) {
      out = raw.slice(6);
      continue;
    }
    if (raw.startsWith('--')) {
      console.error(`Unknown flag: ${raw}`);
      process.exit(2);
    }
    positional.push(raw);
  }
  if (positional.length === 0) {
    printHelp();
    process.exit(2);
  }
  if (positional.length > 2) {
    console.error('Expected one or two JSON paths.');
    process.exit(2);
  }
  return { baseline: positional[0], after: positional[1], out };
}

function loadDump(p: string): PipelineDump {
  const full = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  if (!fs.existsSync(full)) {
    console.error(`File not found: ${full}`);
    process.exit(1);
  }
  const dump = JSON.parse(fs.readFileSync(full, 'utf8')) as PipelineDump;
  if (!Array.isArray(dump.results)) {
    console.error(`${full} has no "results" array.`);
    process.exit(1);
  }
  return dump;
}

// ---- KPI helpers ----

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/** Articles recognised in each learning language's noun base form. Only
 *  non-Scandinavian langs are checked for "nouns must have article"; the
 *  Scandi set drives KPI #6 (nouns WITH article should be low pre-fix). */
const ARTICLES: Record<string, string[]> = {
  de: ['der ', 'die ', 'das '],
  fr: ['le ', 'la ', "l'", 'les ', 'un ', 'une '],
  es: ['el ', 'la ', 'los ', 'las '],
  it: ['il ', 'la ', 'lo ', "l'", 'i ', 'le ', 'gli '],
  pt: ['o ', 'a ', 'os ', 'as '],
  nl: ['de ', 'het '],
  sv: ['en ', 'ett ', 'den ', 'det '],
  no: ['en ', 'ei ', 'et ', 'den ', 'det '],
  da: ['en ', 'et ', 'den ', 'det '],
};
const SCANDI = new Set(['sv', 'no', 'da']);

function hasArticle(lang: string, original: string): boolean {
  const arts = ARTICLES[lang];
  if (!arts) return false;
  const low = normalize(original);
  return arts.some((a) => low.startsWith(a));
}

/** Language-specific infinitive endings (rough but robust enough). */
function isInfinitive(lang: string, original: string): boolean {
  const low = normalize(original);
  switch (lang) {
    case 'de':
      return /^(sich )?\S+(e?(n|rn|ln))$/.test(low);
    case 'fr':
      return low.startsWith('se ') || low.startsWith("s'") || /(er|ir|re|oir|oire)$/.test(low);
    case 'es':
      return /(ar|er|ir|arse|erse|irse)$/.test(low);
    case 'it':
      return /(are|ere|ire|arsi|ersi|irsi)$/.test(low);
    case 'pt':
      return /(ar|er|ir|or|ar-se|er-se|ir-se)$/.test(low);
    case 'nl':
      return /en$/.test(low);
    case 'en':
      return low.startsWith('to ');
    case 'sv':
    case 'no':
    case 'da':
    case 'pl':
    case 'cs':
      // Morphology too varied without proper lemma analysis; accept anything.
      return true;
    default:
      return true;
  }
}

/** True if a multi-word noun entry looks suspiciously like an attribute-noun
 *  concatenation (article + 2+ content tokens). */
function isMultiWordNoun(original: string): boolean {
  return /^\S+\s\S+\s\S+/.test(original.trim());
}

/** Looks like a proper-noun leak: article followed by ≥2 capitalised content
 *  tokens (e.g. "le Real Madrid") or an all-caps token (e.g. "HBO Max"). */
function looksLikeProperNoun(lang: string, original: string): boolean {
  const trimmed = original.trim();
  // Strip the article prefix before inspecting the rest.
  const rest = trimmed.replace(
    /^(der|die|das|le|la|les|l'|el|los|las|il|lo|gli|i|o|a|os|as|de|het|en|ett|den|det|ei|et) /i,
    '',
  );
  const toks = rest.split(/\s+/).filter(Boolean);
  // DE has all nouns capitalised, so the 2-caps heuristic would misfire;
  // only flag DE when there's a *pure uppercase* block (BBC, HBO, NASA).
  if (lang === 'de') {
    return toks.length >= 2 && toks.every((t) => /^[A-ZÄÖÜ]{2,}$/.test(t));
  }
  if (toks.length < 2) {
    // Single token — flag only if fully uppercase ≥3 chars (BBC, HBO)
    return toks.length === 1 && /^[A-Z]{3,}$/.test(toks[0]);
  }
  // ≥2 tokens where each starts uppercase → strong proper-noun signal.
  return toks.every((t) => /^[A-ZÁÀÂÄÉÈÊËÍÎÏÓÔÖÚÛÜÇÑ]/.test(t));
}

/** DE translation case-error heuristic: native==='de', translation starts
 *  with an article and has ≥2 capitalised words after (e.g. "die Öffentliche
 *  Gewalt" should be "die öffentliche Gewalt"). */
function isDeTranslationCaseError(translation: string): boolean {
  const m = translation.trim().match(/^(der|die|das)\s+(\S+)\s+(\S+)(?:\s|$)/i);
  if (!m) return false;
  const [, , a, b] = m;
  // Both tokens capitalised — the first should be the adjective (lowercase)
  // unless the whole thing is a titled compound (rare for attribute-noun pairs).
  return /^[A-ZÄÖÜ]/.test(a) && /^[A-ZÄÖÜ]/.test(b);
}

// ---- KPI computations ----

interface Kpi {
  key: string;
  label: string;
  value: number;
  unit: string;
  /** If true, HIGHER is better (deltas coloured accordingly). */
  higherIsBetter: boolean;
  /** Human-readable baseline target for reference. */
  target?: string;
}

function kpis(dump: PipelineDump): Kpi[] {
  const results = dump.results.filter((r) => r.ok && r.vocab);
  const allVocab = results.flatMap((r) => r.vocab ?? []);

  // #1 Repetition-Loop Rate: combos where max(count(original,type)) ≥ 10
  let loopCombos = 0;
  let loopThreshold3Combos = 0;
  for (const r of results) {
    const cnt = new Map<string, number>();
    for (const v of r.vocab ?? []) {
      const k = normalize(v.original) + '|' + v.type;
      cnt.set(k, (cnt.get(k) ?? 0) + 1);
    }
    let max = 0;
    for (const n of cnt.values()) if (n > max) max = n;
    if (max >= 10) loopCombos++;
    if (max >= 3) loopThreshold3Combos++;
  }

  // #2 Within-Combo Duplicate Rate (mean across combos)
  let totalDupeRatio = 0;
  for (const r of results) {
    const seen = new Set<string>();
    let total = 0;
    for (const v of r.vocab ?? []) {
      seen.add(normalize(v.original) + '|' + v.type);
      total++;
    }
    totalDupeRatio += total > 0 ? 1 - seen.size / total : 0;
  }
  const dupeRate = results.length > 0 ? totalDupeRatio / results.length : 0;

  // #3 Cross-Native Median Jaccard + #4 Core-Vocab Stability
  const byLang: Record<string, PipelineResult[]> = {};
  for (const r of results) (byLang[r.lang] ||= []).push(r);
  const jaccardMedians: number[] = [];
  const coreStabilities: number[] = [];
  for (const [, cells] of Object.entries(byLang)) {
    const sets = cells.map((c) => new Set((c.vocab ?? []).map((v) => normalize(v.original))));
    // Pairwise Jaccard
    const jaccards: number[] = [];
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const a = sets[i];
        const b = sets[j];
        let inter = 0;
        for (const x of a) if (b.has(x)) inter++;
        const u = a.size + b.size - inter;
        jaccards.push(u > 0 ? inter / u : 0);
      }
    }
    if (jaccards.length > 0) {
      jaccards.sort((x, y) => x - y);
      jaccardMedians.push(jaccards[Math.floor(jaccards.length / 2)]);
    }
    // Core-vocab stability: words present in ALL cells / union size
    const union = new Set<string>();
    const freq = new Map<string, number>();
    for (const s of sets)
      for (const w of s) {
        union.add(w);
        freq.set(w, (freq.get(w) ?? 0) + 1);
      }
    let inAll = 0;
    for (const n of freq.values()) if (n === sets.length) inAll++;
    if (union.size > 0) coreStabilities.push(inAll / union.size);
  }
  const meanJaccard =
    jaccardMedians.length > 0
      ? jaccardMedians.reduce((a, b) => a + b, 0) / jaccardMedians.length
      : 0;
  const meanCore =
    coreStabilities.length > 0
      ? coreStabilities.reduce((a, b) => a + b, 0) / coreStabilities.length
      : 0;

  // #5 Multi-Word-Noun Violations
  let multiWordNouns = 0;
  for (const r of results) {
    for (const v of r.vocab ?? []) {
      if (v.type === 'noun' && isMultiWordNoun(v.original)) multiWordNouns++;
    }
  }

  // #6 Scandinavian Nouns WITH Article (% of Scandi-lang nouns)
  let scandiNouns = 0;
  let scandiWithArticle = 0;
  for (const r of results) {
    if (!SCANDI.has(r.lang)) continue;
    for (const v of r.vocab ?? []) {
      if (v.type !== 'noun') continue;
      scandiNouns++;
      if (hasArticle(r.lang, v.original)) scandiWithArticle++;
    }
  }
  const scandiArticlePct = scandiNouns > 0 ? scandiWithArticle / scandiNouns : 0;

  // #7 Verb Infinitive Compliance (% verbs that match infinitive pattern)
  let totalVerbs = 0;
  let infinitiveVerbs = 0;
  for (const r of results) {
    for (const v of r.vocab ?? []) {
      if (v.type !== 'verb') continue;
      totalVerbs++;
      if (isInfinitive(r.lang, v.original)) infinitiveVerbs++;
    }
  }
  const infPct = totalVerbs > 0 ? infinitiveVerbs / totalVerbs : 0;

  // #8 DE Translation Case Errors
  let deCaseErrors = 0;
  for (const r of results) {
    if (r.native !== 'de') continue;
    for (const v of r.vocab ?? []) {
      if (isDeTranslationCaseError(v.translation)) deCaseErrors++;
    }
  }

  // #9 p95 Latency
  const lats = results.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const p95 = lats.length > 0 ? lats[Math.floor(lats.length * 0.95)] : 0;

  // #10 Wall time from totals (fallback: sum of elapsedMs)
  const wallSec =
    (dump.totals as { wallSec?: number } | undefined)?.wallSec ??
    lats.reduce((a, b) => a + b, 0) / 1000;

  // #11 Cost proxy per 100 Unique Vocabs
  // Input: processedTextLength ≈ 0.3 tokens/char. Output: ≈ 3 tokens/vocab-entry.
  // Mistral small: $0.10/M input, $0.30/M output.
  const totalInputChars = results.reduce((a, r) => a + (r.processedTextLength ?? 0), 0);
  const totalOutputItems = allVocab.length;
  const inputTokens = totalInputChars * 0.3;
  const outputTokens = totalOutputItems * 40; // rough: ~40 tokens per JSON entry
  const inputCost = (inputTokens / 1_000_000) * 0.1;
  const outputCost = (outputTokens / 1_000_000) * 0.3;
  const totalCost = inputCost + outputCost;
  const uniqueVocab = new Set(allVocab.map((v) => normalize(v.original) + '|' + v.type)).size;
  const costPer100 = uniqueVocab > 0 ? (totalCost / uniqueVocab) * 100 : 0;

  // #12 Proper Noun Leak Count
  let properNounLeaks = 0;
  for (const r of results) {
    for (const v of r.vocab ?? []) {
      if (looksLikeProperNoun(r.lang, v.original)) properNounLeaks++;
    }
  }

  return [
    {
      key: 'loopRate',
      label: 'Repetition-Loop Rate (≥10× same entry)',
      value: loopCombos / results.length,
      unit: '%',
      higherIsBetter: false,
      target: '0%',
    },
    {
      key: 'loopRate3',
      label: 'Repetition Presence (≥3× same entry)',
      value: loopThreshold3Combos / results.length,
      unit: '%',
      higherIsBetter: false,
      target: '<5%',
    },
    {
      key: 'dupeRate',
      label: 'Within-Combo Duplicate Rate',
      value: dupeRate,
      unit: '%',
      higherIsBetter: false,
      target: '<1%',
    },
    {
      key: 'jaccard',
      label: 'Cross-Native Median Jaccard',
      value: meanJaccard,
      unit: '',
      higherIsBetter: true,
      target: '≥0.75',
    },
    {
      key: 'coreStability',
      label: 'Core-Vocab Stability (in-all-natives)',
      value: meanCore,
      unit: '%',
      higherIsBetter: true,
      target: '≥40%',
    },
    {
      key: 'multiWordNouns',
      label: 'Multi-Word-Noun Violations',
      value: multiWordNouns,
      unit: 'entries',
      higherIsBetter: false,
      target: '<30',
    },
    {
      key: 'scandiArticle',
      label: 'Scandinavian Nouns with Article',
      value: scandiArticlePct,
      unit: '%',
      higherIsBetter: true,
      target: '≥90%',
    },
    {
      key: 'infinitive',
      label: 'Verb Infinitive Compliance',
      value: infPct,
      unit: '%',
      higherIsBetter: true,
      target: '≥99.5%',
    },
    {
      key: 'deCase',
      label: 'DE Translation Case Errors',
      value: deCaseErrors,
      unit: 'entries',
      higherIsBetter: false,
      target: '<5',
    },
    {
      key: 'p95',
      label: 'p95 Latency per Combo',
      value: p95,
      unit: 'ms',
      higherIsBetter: false,
      target: '≤22000',
    },
    {
      key: 'wall',
      label: 'Total Wall Time',
      value: wallSec,
      unit: 's',
      higherIsBetter: false,
      target: '≤1920',
    },
    {
      key: 'cost',
      label: 'Cost per 100 Unique Vocabs',
      value: costPer100,
      unit: '$',
      higherIsBetter: false,
      target: '≤$0.004',
    },
    {
      key: 'properNoun',
      label: 'Proper-Noun Leak Count',
      value: properNounLeaks,
      unit: 'entries',
      higherIsBetter: false,
      target: '<5',
    },
  ];
}

// ---- Formatting ----

function formatValue(k: Kpi): string {
  if (k.unit === '%') return (k.value * 100).toFixed(1) + '%';
  if (k.unit === 'ms') return Math.round(k.value).toLocaleString() + ' ms';
  if (k.unit === 's') {
    const min = k.value / 60;
    return min >= 1 ? min.toFixed(1) + ' min' : Math.round(k.value) + ' s';
  }
  if (k.unit === '$') return '$' + k.value.toFixed(4);
  if (k.unit === '') return k.value.toFixed(3);
  if (k.unit === 'entries') return Math.round(k.value).toString();
  return String(k.value);
}

function formatDelta(base: Kpi, after: Kpi): string {
  const absDelta = after.value - base.value;
  const pctDelta = base.value !== 0 ? (absDelta / Math.abs(base.value)) * 100 : 0;
  const improved =
    (after.higherIsBetter && absDelta > 0) || (!after.higherIsBetter && absDelta < 0);
  const arrow = Math.abs(pctDelta) < 1 ? '=' : improved ? '✓' : '✗';
  const absStr =
    base.unit === '%'
      ? (absDelta * 100).toFixed(1) + 'pp'
      : base.unit === '$'
        ? absDelta.toFixed(4)
        : Math.abs(absDelta) < 1 && base.unit === ''
          ? absDelta.toFixed(3)
          : Math.round(absDelta).toLocaleString();
  const pctStr = base.value !== 0 ? ` (${pctDelta > 0 ? '+' : ''}${pctDelta.toFixed(1)}%)` : '';
  return `${arrow} ${absDelta > 0 ? '+' : ''}${absStr}${pctStr}`;
}

function renderSingle(dump: PipelineDump, label: string): string {
  const rows = kpis(dump);
  const lines: string[] = [];
  lines.push(`# KPI Report — ${label}`);
  lines.push('');
  lines.push(`- Run: ${dump.ranAt ?? 'unknown'}`);
  lines.push(
    `- Seed: ${dump.seed ?? '—'}  ·  max-chars: ${dump.maxChars ?? '—'}  ·  combos: ${dump.results.length}`,
  );
  lines.push('');
  lines.push('| KPI | Value | Target |');
  lines.push('|---|---|---|');
  for (const k of rows) {
    lines.push(`| ${k.label} | **${formatValue(k)}** | ${k.target ?? ''} |`);
  }
  return lines.join('\n') + '\n';
}

function renderCompare(base: PipelineDump, after: PipelineDump): string {
  const a = kpis(base);
  const b = kpis(after);
  const lines: string[] = [];
  lines.push('# KPI Diff — Sweep Comparison');
  lines.push('');
  lines.push(
    `- Baseline: ${base.ranAt ?? '?'}  ·  seed=${base.seed ?? '?'}  ·  ${base.results.length} combos`,
  );
  lines.push(
    `- After:    ${after.ranAt ?? '?'}  ·  seed=${after.seed ?? '?'}  ·  ${after.results.length} combos`,
  );
  if (base.seed !== after.seed) {
    lines.push('');
    lines.push(
      `> ⚠ Seeds differ — URL selection may differ. Jaccard/core metrics are less comparable.`,
    );
  }
  if (base.maxChars !== after.maxChars) {
    lines.push('');
    lines.push(
      `> ⚠ max-chars differs (${base.maxChars} vs ${after.maxChars}) — extraction depth differs.`,
    );
  }
  lines.push('');
  lines.push('| KPI | Baseline | After | Δ | Target |');
  lines.push('|---|---|---|---|---|');
  for (let i = 0; i < a.length; i++) {
    lines.push(
      `| ${a[i].label} | ${formatValue(a[i])} | **${formatValue(b[i])}** | ${formatDelta(a[i], b[i])} | ${a[i].target ?? ''} |`,
    );
  }
  return lines.join('\n') + '\n';
}

// ---- Entry ----

function main(): void {
  const args = parseArgs(process.argv);
  const base = loadDump(args.baseline);
  const body = args.after
    ? renderCompare(base, loadDump(args.after))
    : renderSingle(base, path.basename(args.baseline));

  if (args.out) {
    const full = path.isAbsolute(args.out) ? args.out : path.resolve(process.cwd(), args.out);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
    console.error(`Wrote ${full}`);
  } else {
    process.stdout.write(body);
  }
}

main();
