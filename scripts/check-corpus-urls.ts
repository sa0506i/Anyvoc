/**
 * check-corpus-urls.ts — validate URLs in tmp/validation/validation_corpus.json.
 *
 * Fires a GET per URL with `redirect: 'follow'`, cancels the body stream as
 * soon as headers are in, and reports status. Fast + bandwidth-friendly:
 * ~30 s wall time for the full 120-URL corpus at default concurrency 8.
 *
 * Usage:
 *   npm run corpus:check
 *   npm run corpus:check -- --lang=de              # one language only
 *   npm run corpus:check -- --only-failed          # suppress ok rows
 *   npm run corpus:check -- --out=tmp/check.json   # JSON summary
 *
 * Options:
 *   --lang=<code>         Restrict to one language block (default: all).
 *   --concurrency=<n>     Parallel requests (default 8).
 *   --timeout=<ms>        Per-URL timeout (default 10000).
 *   --only-failed         Live log only broken/suspicious URLs.
 *   --out=<path>          Write JSON report (full + failed lists).
 *   --help                Show this message.
 *
 * Exit code: 0 if every URL passes, 1 if any failed.
 *
 * Pure Node — runs with plain `tsx scripts/check-corpus-urls.ts`, no shim.
 * Dev-machine only.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CORPUS_PATH = path.join(PROJECT_ROOT, 'tmp', 'validation', 'validation_corpus.json');

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

interface CorpusEntry {
  url: string;
  domain: string;
  title: string;
  text_type: string;
  difficulty_estimate: string;
  notes: string;
}

interface Corpus {
  _meta: { languages: string[]; [k: string]: unknown };
  [lang: string]: CorpusEntry[] | unknown;
}

type Category =
  | 'ok'
  | 'redirect-domain-change'
  | 'client-error'
  | 'server-error'
  | 'network-error'
  | 'timeout';

interface Result {
  lang: string;
  index: number;
  url: string;
  finalUrl?: string;
  domain: string;
  expectedDomain: string;
  status?: number;
  elapsedMs: number;
  category: Category;
  note?: string;
  textType: string;
  difficulty: string;
  attempts: number;
}

/** Retry policy for transient upstream hiccups. Not exposed as a CLI flag
 *  because 3 retries × 3 backoff steps (500 / 1000 / 2000 ms) is a sensible
 *  blanket default for a nightly corpus check — more than covers 5xx/CDN
 *  rate-limits that rarely last more than a couple of seconds, cheap enough
 *  to run unconditionally. */
const MAX_RETRIES = 3;
const BACKOFF_MS = [500, 1000, 2000];
const TRANSIENT_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  'server-error',
  'timeout',
  'network-error',
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CliArgs {
  lang?: string;
  concurrency: number;
  timeoutMs: number;
  onlyFailed: boolean;
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { concurrency: 8, timeoutMs: 10_000, onlyFailed: false };
  for (const raw of argv.slice(2)) {
    if (raw === '--help' || raw === '-h') {
      printHelp();
      process.exit(0);
    }
    if (raw === '--only-failed') {
      args.onlyFailed = true;
      continue;
    }
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (!m) {
      console.error(`Unknown flag: ${raw}`);
      process.exit(2);
    }
    const [, key, value] = m;
    switch (key) {
      case 'lang':
        args.lang = value;
        break;
      case 'concurrency': {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 1) {
          console.error(`Invalid --concurrency value: ${value}`);
          process.exit(2);
        }
        args.concurrency = Math.floor(n);
        break;
      }
      case 'timeout': {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 500) {
          console.error(`Invalid --timeout value: ${value} (min 500 ms)`);
          process.exit(2);
        }
        args.timeoutMs = Math.floor(n);
        break;
      }
      case 'out':
        args.out = value;
        break;
      default:
        console.error(`Unknown flag: --${key}`);
        process.exit(2);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`check-corpus-urls — verify URLs in tmp/validation/validation_corpus.json

Usage:
  npm run corpus:check
  npm run corpus:check -- [options]

Options:
  --lang=<code>         Restrict to one language block (default: all).
  --concurrency=<n>     Parallel requests (default 8).
  --timeout=<ms>        Per-URL timeout, min 500 (default 10000).
  --only-failed         Live-log only broken/suspicious URLs.
  --out=<path>          Write JSON report to <path>.
  --help                Show this message.

Exit code: 0 if every URL passes, 1 otherwise.
`);
}

function loadCorpus(): Corpus {
  if (!fs.existsSync(CORPUS_PATH)) {
    throw new Error(`Corpus not found at ${CORPUS_PATH}`);
  }
  return JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8')) as Corpus;
}

interface Task {
  lang: string;
  index: number;
  entry: CorpusEntry;
}

function collectTasks(corpus: Corpus, langFilter?: string): Task[] {
  const langs = langFilter ? [langFilter] : (corpus._meta.languages as string[]);
  const tasks: Task[] = [];
  for (const lang of langs) {
    const block = corpus[lang];
    if (!Array.isArray(block)) continue;
    (block as CorpusEntry[]).forEach((entry, index) => tasks.push({ lang, index, entry }));
  }
  return tasks;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Single fetch attempt. Returned Result has attempts=1; the caller inflates
 *  that number if it retries. Kept separate so the retry wrapper has a
 *  clean contract: one call = one HTTP round-trip. */
async function checkOnce(task: Task, timeoutMs: number): Promise<Result> {
  const { lang, index, entry } = task;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // The only source of truth for "did a redirect actually cross hosts?" is
  // the URL we fetched vs the URL we ended up on. entry.domain is metadata
  // that can be stale (e.g. parent-domain written there while entry.url
  // already targets a subdomain) — comparing against it produces false
  // positives AND leaves finalUrl unset, because res.url === entry.url when
  // there was no real redirect.
  const requestedHost = hostnameOf(entry.url);

  try {
    const res = await fetch(entry.url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    });
    // Drain/cancel the body — we only care about status + final URL.
    res.body?.cancel().catch(() => void 0);

    const elapsedMs = Date.now() - started;
    const finalHost = hostnameOf(res.url);
    const status = res.status;
    const hostChanged = !!finalHost && !!requestedHost && finalHost !== requestedHost;

    let category: Category;
    let note: string | undefined;
    if (status >= 200 && status < 300) {
      if (hostChanged) {
        category = 'redirect-domain-change';
        note = `redirected ${requestedHost} → ${finalHost}`;
      } else {
        category = 'ok';
        if (finalHost && finalHost !== hostnameOf(`https://${entry.domain}`)) {
          // URL resolved fine on the same host as requested, but the corpus'
          // `domain` metadata disagrees with the URL's host. Surface this as
          // a note so it can be cleaned up later; don't fail the check.
          note = `corpus domain "${entry.domain}" mismatches URL host "${finalHost}"`;
        }
      }
    } else if (status >= 400 && status < 500) {
      category = 'client-error';
    } else {
      category = 'server-error';
    }

    return {
      lang,
      index,
      url: entry.url,
      finalUrl: hostChanged || res.url !== entry.url ? res.url : undefined,
      domain: finalHost || entry.domain,
      expectedDomain: entry.domain,
      status,
      elapsedMs,
      category,
      note,
      textType: entry.text_type,
      difficulty: entry.difficulty_estimate,
      attempts: 1,
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const aborted = (err as { name?: string })?.name === 'AbortError';
    const msg = err instanceof Error ? err.message : String(err);
    return {
      lang,
      index,
      url: entry.url,
      domain: entry.domain,
      expectedDomain: entry.domain,
      elapsedMs,
      category: aborted ? 'timeout' : 'network-error',
      note: aborted ? `timeout after ${timeoutMs} ms` : msg,
      textType: entry.text_type,
      difficulty: entry.difficulty_estimate,
      attempts: 1,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Retry wrapper: retries transient failures (5xx / timeout / network) up to
 *  MAX_RETRIES times with fixed backoff. 4xx and ok-ish outcomes return
 *  immediately. The returned Result carries the final attempt's body but its
 *  `attempts` field reflects total HTTP round-trips performed. */
async function checkOne(task: Task, timeoutMs: number): Promise<Result> {
  let last = await checkOnce(task, timeoutMs);
  let totalAttempts = 1;
  for (let retry = 0; retry < MAX_RETRIES && TRANSIENT_CATEGORIES.has(last.category); retry++) {
    await sleep(BACKOFF_MS[retry] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
    last = await checkOnce(task, timeoutMs);
    totalAttempts++;
  }
  last.attempts = totalAttempts;
  if (totalAttempts > 1) {
    const suffix = `(recovered after ${totalAttempts} attempts)`;
    const prefix = `(final attempt of ${totalAttempts} still failed)`;
    const tag = last.category === 'ok' ? suffix : prefix;
    last.note = last.note ? `${last.note} ${tag}` : tag;
  }
  return last;
}

function symbolFor(c: Category): string {
  switch (c) {
    case 'ok':
      return '✓';
    case 'redirect-domain-change':
      return '↳';
    case 'client-error':
    case 'server-error':
    case 'network-error':
    case 'timeout':
      return '✗';
  }
}

function shouldPrintLive(c: Category, onlyFailed: boolean): boolean {
  if (!onlyFailed) return true;
  return c !== 'ok';
}

function formatResultLine(r: Result): string {
  const status = r.status !== undefined ? String(r.status) : r.category.toUpperCase();
  const tag = `[${r.lang}] #${r.index}`.padEnd(10);
  const cat = r.category.padEnd(24);
  const sym = symbolFor(r.category);
  const extra = r.note ? ` — ${r.note}` : '';
  const finalUrl = r.finalUrl ? `\n         → ${r.finalUrl}` : '';
  return `${sym} ${tag} ${status.padEnd(4)} ${cat}${r.url}${extra}${finalUrl}`;
}

async function runWithPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
  onDone?: (r: R) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      const r = await worker(items[i]);
      results[i] = r;
      onDone?.(r);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const corpus = loadCorpus();
  const tasks = collectTasks(corpus, args.lang);
  if (tasks.length === 0) {
    console.error(`No URLs to check${args.lang ? ` for language "${args.lang}"` : ''}.`);
    process.exit(2);
  }
  console.log(
    `Checking ${tasks.length} URL(s)` +
      (args.lang ? ` for ${args.lang}` : ' across all languages') +
      ` — concurrency=${args.concurrency}, timeout=${args.timeoutMs} ms\n`,
  );

  let doneCount = 0;
  const totalStart = Date.now();
  const results = await runWithPool(
    tasks,
    args.concurrency,
    (t) => checkOne(t, args.timeoutMs),
    (r) => {
      doneCount++;
      if (shouldPrintLive(r.category, args.onlyFailed)) {
        console.log(formatResultLine(r));
      } else if (doneCount % 20 === 0) {
        console.log(`  … ${doneCount}/${tasks.length}`);
      }
    },
  );
  const totalSec = ((Date.now() - totalStart) / 1000).toFixed(1);

  const byCat: Record<Category, Result[]> = {
    ok: [],
    'redirect-domain-change': [],
    'client-error': [],
    'server-error': [],
    'network-error': [],
    timeout: [],
  };
  for (const r of results) byCat[r.category].push(r);

  const failed = [
    ...byCat['client-error'],
    ...byCat['server-error'],
    ...byCat['network-error'],
    ...byCat.timeout,
  ];

  console.log(`\n=== Summary (${totalSec}s wall) ===`);
  console.log(`  ok                       : ${byCat.ok.length}`);
  console.log(`  redirect-domain-change   : ${byCat['redirect-domain-change'].length}`);
  console.log(`  client-error (4xx)       : ${byCat['client-error'].length}`);
  console.log(`  server-error (5xx)       : ${byCat['server-error'].length}`);
  console.log(`  network-error            : ${byCat['network-error'].length}`);
  console.log(`  timeout                  : ${byCat.timeout.length}`);

  if (byCat['redirect-domain-change'].length > 0) {
    console.log(`\nDomain-changing redirects (content reachable but moved):`);
    for (const r of byCat['redirect-domain-change']) {
      const requested = hostnameOf(r.url);
      const landed = hostnameOf(r.finalUrl ?? r.url);
      console.log(`  [${r.lang}] #${r.index}  ${requested} → ${landed}`);
      console.log(`         ${r.url}`);
      if (r.finalUrl) console.log(`         → ${r.finalUrl}`);
    }
  }

  if (failed.length > 0) {
    console.log(`\nBroken URLs (${failed.length}):`);
    for (const r of failed) {
      const status = r.status !== undefined ? String(r.status) : r.category;
      console.log(`  [${r.lang}] #${r.index}  ${status.padEnd(16)} ${r.url}`);
      if (r.note) console.log(`         ${r.note}`);
    }
  }

  if (args.out) {
    const outPath = path.isAbsolute(args.out) ? args.out : path.resolve(process.cwd(), args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          totalSeconds: Number(totalSec),
          totals: {
            total: results.length,
            ok: byCat.ok.length,
            redirectDomainChange: byCat['redirect-domain-change'].length,
            clientError: byCat['client-error'].length,
            serverError: byCat['server-error'].length,
            networkError: byCat['network-error'].length,
            timeout: byCat.timeout.length,
            failed: failed.length,
          },
          failed,
          redirects: byCat['redirect-domain-change'],
          all: results,
        },
        null,
        2,
      ),
    );
    console.log(`\nWrote ${outPath}`);
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
