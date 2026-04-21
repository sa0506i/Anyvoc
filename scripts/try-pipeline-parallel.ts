/**
 * try-pipeline-parallel.ts — run try-pipeline once per native language
 * with a bounded worker pool.
 *
 * Schedules N child processes (one per native code in SUPPORTED_LANGUAGES),
 * each running `tsx scripts/try-pipeline.ts` with `--natives=<native>`
 * and `--out=tmp/validation/validation-<native>.json` injected. At most
 * `--concurrency` children run at the same time; as one finishes the
 * next native in the queue starts. Every other CLI flag is forwarded
 * verbatim.
 *
 * Why bounded: running all 12 natives at once saturates the Mistral
 * backend proxy rate limit. The first smoke test (2026-04-22) with
 * concurrency=12 produced only 2/12 successful runs, the other 10
 * hit HTTP 429 "API rate limit reached". Concurrency=4 is the empirical
 * sweet spot for Mistral Small via the Fly.dev proxy — ~3× speed-up
 * vs. sequential with ~0 rate-limit casualties.
 *
 * Output layout:
 *   tmp/validation/validation-<native>.json (one per native code)
 *
 * Usage:
 *   npm run try:pipeline:parallel -- --sweep --limit=1 --seed=42 --top=0
 *   npm run try:pipeline:parallel -- --sweep --limit=1 --seed=42 --top=0 --concurrency=6
 *
 * Flags:
 *   --concurrency=<n>    max children running in parallel (default 4)
 *   (everything else)    forwarded to the child try-pipeline
 *
 * Caveats:
 *   - `--natives`, `--native`, and `--out` passed on the CLI are IGNORED
 *     (we inject them ourselves per child) — the script prints a warning.
 *   - Diagonal skip (native == learning) still applies inside each child,
 *     so the `en` process skips EN-learning URLs, etc.
 *   - Set concurrency too high and you get HTTP 429; the child marks
 *     those combos failed and continues with the rest. See `failed`
 *     in each output file's totals.
 *
 * Dev-machine only. Never wired into eas-build.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Must mirror lib/classifier/index.ts SUPPORTED_LANGUAGES. Hardcoded
// here so we don't need to import expo-constants-chained modules.
const NATIVES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'no', 'da', 'pl', 'cs'] as const;
type NativeCode = (typeof NATIVES)[number];

// ANSI colours for per-native log prefixes so parallel output is skimmable.
const COLOURS = [31, 32, 33, 34, 35, 36, 91, 92, 93, 94, 95, 96];

function colourise(i: number, text: string): string {
  if (!process.stdout.isTTY) return text;
  return `\x1b[${COLOURS[i % COLOURS.length]}m${text}\x1b[0m`;
}

const DEFAULT_CONCURRENCY = 4;

interface ParsedArgs {
  forwarded: string[];
  concurrency: number;
}

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  const forwarded: string[] = [];
  let concurrency = DEFAULT_CONCURRENCY;
  for (const raw of argv) {
    const m = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) {
      forwarded.push(raw);
      continue;
    }
    const key = m[1]!;
    const value = m[2];
    if (key === 'natives' || key === 'out' || key === 'native') {
      console.warn(
        `[try-pipeline-parallel] ignoring --${key}=${value ?? ''} — injected automatically per native.`,
      );
      continue;
    }
    if (key === 'concurrency') {
      const n = Number(value ?? DEFAULT_CONCURRENCY);
      if (!Number.isFinite(n) || n < 1 || n > NATIVES.length) {
        console.error(`--concurrency must be an integer in [1, ${NATIVES.length}]. Got: ${value}`);
        process.exit(2);
      }
      concurrency = Math.floor(n);
      continue;
    }
    forwarded.push(raw);
  }
  return { forwarded, concurrency };
}

interface ChildState {
  native: NativeCode;
  proc: ChildProcessWithoutNullStreams;
  prefix: string;
  startedAt: number;
  exitCode: number | null;
  outPath: string;
}

function spawnChild(native: NativeCode, forwardArgs: string[], idx: number): ChildState {
  const outDir = path.join(PROJECT_ROOT, 'tmp', 'validation');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `validation-${native}.json`);
  const childArgs = [
    '--tsconfig',
    path.join(PROJECT_ROOT, 'scripts', 'tsconfig.pipeline.json'),
    path.join(PROJECT_ROOT, 'scripts', 'try-pipeline.ts'),
    ...forwardArgs,
    `--natives=${native}`,
    `--out=${outPath}`,
  ];
  const prefix = colourise(idx, `[${native}]`);
  const startedAt = Date.now();
  // Use npx tsx so the same toolchain resolves as the synchronous
  // `npm run try:pipeline` path. shell:true lets npx on Windows find
  // tsx via cmd.exe without us resolving it manually.
  const proc = spawn('npx', ['tsx', ...childArgs], {
    cwd: PROJECT_ROOT,
    env: process.env,
    shell: true,
  });
  const state: ChildState = { native, proc, prefix, startedAt, exitCode: null, outPath };
  // Line-buffer each stream so we don't interleave lines from different
  // children mid-message.
  attachLineLogger(proc.stdout, prefix);
  attachLineLogger(proc.stderr, prefix, true);
  proc.on('exit', (code) => {
    state.exitCode = code ?? 0;
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    const status = code === 0 ? 'ok' : `FAILED (exit ${code})`;
    console.log(`${prefix} finished: ${status} in ${secs}s → ${outPath}`);
  });
  return state;
}

function attachLineLogger(stream: NodeJS.ReadableStream, prefix: string, isStderr = false): void {
  let buffer = '';
  stream.setEncoding('utf-8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        (isStderr ? console.error : console.log)(`${prefix} ${line}`);
      }
    }
  });
  stream.on('end', () => {
    if (buffer.length > 0) {
      (isStderr ? console.error : console.log)(`${prefix} ${buffer}`);
    }
  });
}

/**
 * Bounded worker pool. Keeps at most `concurrency` children running;
 * starts the next queued native as soon as a slot frees.
 */
async function runPool(
  queue: NativeCode[],
  concurrency: number,
  forwardArgs: string[],
): Promise<ChildState[]> {
  const completed: ChildState[] = [];
  let nextIdx = 0;
  // nativeToColourIdx fixes a colour per native so lines from the same
  // child keep the same prefix colour across its lifetime.
  const nativeToColourIdx = new Map<NativeCode, number>();
  queue.forEach((n, i) => nativeToColourIdx.set(n, i));
  return new Promise((resolve) => {
    const launchNext = (): void => {
      if (nextIdx >= queue.length) {
        // No more to launch; resolve when all in-flight finish.
        if (completed.length === queue.length) resolve(completed);
        return;
      }
      const native = queue[nextIdx++]!;
      const colourIdx = nativeToColourIdx.get(native)!;
      const state = spawnChild(native, forwardArgs, colourIdx);
      state.proc.on('exit', () => {
        completed.push(state);
        if (completed.length === queue.length) {
          resolve(completed);
        } else {
          launchNext();
        }
      });
    };
    // Kick off up to `concurrency` children.
    for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
      launchNext();
    }
  });
}

async function main(): Promise<void> {
  const { forwarded: forwardArgs, concurrency } = parseArgs();
  if (forwardArgs.length === 0) {
    console.log(
      'usage: try-pipeline-parallel -- <try-pipeline-flags except --natives/--out> [--concurrency=N]',
    );
    console.log('example: try-pipeline-parallel -- --sweep --limit=1 --seed=42 --top=0');
    console.log(
      'example: try-pipeline-parallel -- --sweep --limit=1 --seed=42 --top=0 --concurrency=6',
    );
    process.exit(2);
  }
  console.log(
    `Spawning ${NATIVES.length} try-pipeline children, up to ${concurrency} in parallel:`,
  );
  console.log(`  forwarded flags: ${forwardArgs.join(' ')}`);
  console.log(`  natives:         ${NATIVES.join(', ')}`);
  console.log('');

  const overallStart = Date.now();
  const completed = await runPool([...NATIVES], concurrency, forwardArgs);

  // Re-sort into the canonical NATIVES order for a readable summary.
  const byNative = new Map(completed.map((c) => [c.native, c]));
  const wallSec = ((Date.now() - overallStart) / 1000).toFixed(1);
  const okCount = completed.filter((c) => c.exitCode === 0).length;
  console.log('');
  console.log(`All children exited. Wall time: ${wallSec}s. ${okCount}/${NATIVES.length} ok.`);
  for (const native of NATIVES) {
    const c = byNative.get(native);
    if (!c) continue;
    const size = fs.existsSync(c.outPath) ? fs.statSync(c.outPath).size : 0;
    console.log(
      `  ${c.native}: exit=${c.exitCode ?? '?'} size=${size} path=${path.relative(PROJECT_ROOT, c.outPath)}`,
    );
  }

  const failed = completed.filter((c) => c.exitCode !== 0).length;
  if (failed > 0) {
    console.error(`${failed} child(ren) had a non-zero exit. Check per-file 'failed' totals.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('try-pipeline-parallel crashed:', err);
  process.exit(1);
});
