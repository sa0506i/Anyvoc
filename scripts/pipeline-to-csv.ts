/**
 * pipeline-to-csv.ts — convert a try-pipeline JSON dump into CSV.
 *
 * Usage:
 *   npm run pipeline:csv -- <input.json> [--format=vocab|summary] [--out=<path>]
 *
 * Formats:
 *   vocab    (default)  One row per extracted vocabulary entry, with URL /
 *                       lang / native / corpus metadata flattened alongside
 *                       each word. Results that failed (ok=false) contribute
 *                       no rows.
 *   summary             One row per result (URL × native combo) with the
 *                       level + type histograms flattened into dynamic
 *                       columns computed from what appears in the dump.
 *
 * Without --out the CSV goes to stdout. Output is UTF-8 with CRLF line
 * endings and RFC-4180 quoting (wrap in quotes when a field contains
 * , " \r \n, double embedded quotes).
 *
 * Pure Node — no lib/ imports, so it runs under plain tsx without the
 * pipeline tsconfig shim.
 *
 * Dev-machine only.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---- Dump shape (structural only — duplicates the try-pipeline types
//      intentionally so this tool does not pull in lib/claude.ts via an
//      import type, which would drag in the expo-constants chain). ----

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
  input: string;
  format: 'vocab' | 'summary';
  out?: string;
}

function printHelp(): void {
  console.log(`pipeline-to-csv — convert try-pipeline JSON dump to CSV

Usage:
  npm run pipeline:csv -- <input.json> [--format=vocab|summary] [--out=<path>]

Options:
  --format=vocab        One row per vocabulary entry (default).
  --format=summary      One row per URL × native result, with level + type
                        histograms flattened into columns.
  --out=<path>          Write CSV to <path>. If omitted, print to stdout.
  --help                Show this message.

Examples:
  npm run pipeline:csv -- tmp/pipeline-de.json --out=tmp/pipeline-de.csv
  npm run pipeline:csv -- tmp/pipeline-sweep.json --format=summary --out=tmp/sweep-summary.csv
  npm run pipeline:csv -- tmp/pipeline-smoke.json > smoke.csv
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { input: '', format: 'vocab' };
  for (const raw of argv.slice(2)) {
    if (raw === '--help' || raw === '-h') {
      printHelp();
      process.exit(0);
    }
    if (raw.startsWith('--format=')) {
      const v = raw.slice(9);
      if (v !== 'vocab' && v !== 'summary') {
        console.error(`Unknown --format value "${v}". Use vocab or summary.`);
        process.exit(2);
      }
      args.format = v;
      continue;
    }
    if (raw.startsWith('--out=')) {
      args.out = raw.slice(6);
      continue;
    }
    if (raw.startsWith('--')) {
      console.error(`Unknown flag: ${raw}`);
      process.exit(2);
    }
    if (args.input) {
      console.error(`Only one input file supported. Got "${args.input}" and "${raw}".`);
      process.exit(2);
    }
    args.input = raw;
  }
  if (!args.input) {
    printHelp();
    process.exit(2);
  }
  return args;
}

// ---- CSV helpers ----

function quoteCsv(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function formatRow(cells: unknown[]): string {
  return cells.map(quoteCsv).join(',');
}

function write(rows: string[], outPath: string | undefined): void {
  const body = rows.join('\r\n') + '\r\n';
  if (outPath) {
    const full = path.isAbsolute(outPath) ? outPath : path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
    // stderr keeps stdout clean for piping the CSV
    console.error(`Wrote ${rows.length - 1} data row(s) to ${full}`);
  } else {
    process.stdout.write(body);
  }
}

// ---- Format builders ----

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function sortedLevels(keys: Set<string>): string[] {
  const known = CEFR_ORDER.filter((k) => keys.has(k));
  const extra = [...keys].filter((k) => !CEFR_ORDER.includes(k)).sort();
  return [...known, ...extra];
}

function collectDynamicColumns(results: PipelineResult[]): { levels: string[]; types: string[] } {
  const levels = new Set<string>();
  const types = new Set<string>();
  for (const r of results) {
    if (r.levelDistribution) for (const k of Object.keys(r.levelDistribution)) levels.add(k);
    if (r.typeDistribution) for (const k of Object.keys(r.typeDistribution)) types.add(k);
    if (r.vocab) {
      for (const v of r.vocab) {
        if (v.level) levels.add(v.level);
        if (v.type) types.add(v.type);
      }
    }
  }
  return { levels: sortedLevels(levels), types: [...types].sort() };
}

function buildVocabRows(dump: PipelineDump): string[] {
  const header = [
    'url',
    'lang',
    'native',
    'corpus_index',
    'text_type',
    'difficulty_estimate',
    'domain',
    'title',
    'original',
    'translation',
    'level',
    'type',
    'source_forms',
  ];
  const rows: string[] = [formatRow(header)];
  for (const r of dump.results) {
    if (!r.ok || !r.vocab || r.vocab.length === 0) continue;
    for (const v of r.vocab) {
      rows.push(
        formatRow([
          r.url,
          r.lang,
          r.native,
          r.corpusIndex ?? '',
          r.corpus?.text_type ?? '',
          r.corpus?.difficulty_estimate ?? '',
          r.corpus?.domain ?? '',
          r.title ?? '',
          v.original,
          v.translation,
          v.level,
          v.type,
          (v.source_forms ?? []).join('|'),
        ]),
      );
    }
  }
  return rows;
}

function buildSummaryRows(dump: PipelineDump): string[] {
  const { levels, types } = collectDynamicColumns(dump.results);
  const header = [
    'url',
    'lang',
    'native',
    'corpus_index',
    'text_type',
    'difficulty_estimate',
    'domain',
    'ok',
    'error',
    'title',
    'text_length',
    'processed_text_length',
    'truncated',
    'elapsed_ms',
    'vocab_count',
    ...levels.map((l) => `level_${l}`),
    ...types.map((t) => `type_${t}`),
  ];
  const rows: string[] = [formatRow(header)];
  for (const r of dump.results) {
    const levelCells = levels.map((l) => r.levelDistribution?.[l] ?? 0);
    const typeCells = types.map((t) => r.typeDistribution?.[t] ?? 0);
    rows.push(
      formatRow([
        r.url,
        r.lang,
        r.native,
        r.corpusIndex ?? '',
        r.corpus?.text_type ?? '',
        r.corpus?.difficulty_estimate ?? '',
        r.corpus?.domain ?? '',
        r.ok,
        r.error ?? '',
        r.title ?? '',
        r.textLength ?? '',
        r.processedTextLength ?? '',
        r.truncated === undefined ? '' : r.truncated,
        r.elapsedMs,
        r.vocabCount ?? 0,
        ...levelCells,
        ...typeCells,
      ]),
    );
  }
  return rows;
}

// ---- Entry ----

function main(): void {
  const args = parseArgs(process.argv);
  const inputPath = path.isAbsolute(args.input)
    ? args.input
    : path.resolve(process.cwd(), args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }
  let dump: PipelineDump;
  try {
    dump = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as PipelineDump;
  } catch (err) {
    console.error(`Failed to parse ${inputPath}: ${(err as Error).message}`);
    process.exit(1);
  }
  if (!Array.isArray(dump.results)) {
    console.error(`Input JSON has no "results" array — does not look like a pipeline dump.`);
    process.exit(1);
  }

  const rows = args.format === 'vocab' ? buildVocabRows(dump) : buildSummaryRows(dump);
  write(rows, args.out);
}

main();
