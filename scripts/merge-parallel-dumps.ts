/**
 * merge-parallel-dumps.ts — concatenate the 12 per-native dumps that
 * `try-pipeline-parallel` writes into a single aggregate dump that
 * `compare-sweeps` can consume.
 *
 * Usage:
 *   npx tsx scripts/merge-parallel-dumps.ts <inputDir> <outPath>
 *
 * Example:
 *   npx tsx scripts/merge-parallel-dumps.ts tmp/validation/v1 tmp/validation/v1-merged.json
 *
 * Reads every `validation-*.json` in the input directory, concatenates
 * their `results[]` arrays, re-computes totals, preserves `promptVersion`
 * + `seed` + `maxChars` + `mode` metadata from the first file (they must
 * be identical across all 12 since the parallel runner forwards the same
 * flags to every child).
 *
 * Pure Node. No lib/ imports. Dev-machine only.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface PipelineResult {
  url: string;
  lang: string;
  native: string;
  ok: boolean;
  elapsedMs: number;
  vocabCount?: number;
  [k: string]: unknown;
}

interface PipelineDump {
  ranAt?: string;
  seed?: number;
  maxChars?: number;
  promptVersion?: 'v1' | 'v2';
  mode?: string;
  sweep?: boolean;
  natives?: string[];
  totals?: { combos: number; ok: number; failed: number; vocab: number; wallSec: number };
  results: PipelineResult[];
}

function main(): void {
  const [inputDir, outPath] = process.argv.slice(2);
  if (!inputDir || !outPath) {
    console.error('Usage: tsx scripts/merge-parallel-dumps.ts <inputDir> <outPath>');
    process.exit(2);
  }
  if (!fs.existsSync(inputDir)) {
    console.error(`Input directory not found: ${inputDir}`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(inputDir)
    .filter((n) => /^validation-[a-z]{2}\.json$/.test(n))
    .sort();
  if (files.length === 0) {
    console.error(`No validation-*.json files in ${inputDir}`);
    process.exit(1);
  }
  console.log(`Merging ${files.length} files from ${inputDir}`);

  const allResults: PipelineResult[] = [];
  let meta: Pick<PipelineDump, 'seed' | 'maxChars' | 'promptVersion' | 'mode' | 'sweep'> = {};
  const natives = new Set<string>();
  let totalWall = 0;
  let ranAtEarliest: string | undefined;

  for (const f of files) {
    const full = path.join(inputDir, f);
    const dump = JSON.parse(fs.readFileSync(full, 'utf8')) as PipelineDump;
    allResults.push(...(dump.results ?? []));
    // First file wins for flags metadata; assert subsequent files agree.
    if (!meta.promptVersion && dump.promptVersion) {
      meta = {
        seed: dump.seed,
        maxChars: dump.maxChars,
        promptVersion: dump.promptVersion,
        mode: dump.mode,
        sweep: dump.sweep,
      };
    } else {
      if (dump.promptVersion && dump.promptVersion !== meta.promptVersion) {
        console.warn(
          `[warn] ${f}: promptVersion=${dump.promptVersion} disagrees with first file (${meta.promptVersion})`,
        );
      }
      if (dump.seed !== undefined && dump.seed !== meta.seed) {
        console.warn(`[warn] ${f}: seed=${dump.seed} disagrees with first file (${meta.seed})`);
      }
    }
    // Track natives actually present in the data (from result.native values).
    for (const r of dump.results ?? []) natives.add(r.native);
    totalWall += dump.totals?.wallSec ?? 0;
    if (dump.ranAt && (!ranAtEarliest || dump.ranAt < ranAtEarliest)) ranAtEarliest = dump.ranAt;
  }

  const ok = allResults.filter((r) => r.ok).length;
  const failed = allResults.length - ok;
  const vocab = allResults.reduce(
    (a, r) => a + (typeof r.vocabCount === 'number' ? r.vocabCount : 0),
    0,
  );

  const merged: PipelineDump = {
    ranAt: ranAtEarliest,
    seed: meta.seed,
    maxChars: meta.maxChars,
    promptVersion: meta.promptVersion,
    mode: meta.mode,
    sweep: meta.sweep,
    natives: [...natives].sort(),
    totals: {
      combos: allResults.length,
      ok,
      failed,
      vocab,
      // wallSec from parallel runs is the MAX wall-time across children, not
      // the sum, since they ran concurrently. We keep the sum here for
      // transparency but compare-sweeps only uses it for the "Total Wall Time"
      // KPI (which is cosmetic given this merger loses the concurrency signal).
      wallSec: totalWall,
    },
    results: allResults,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(
    `Wrote ${outPath} — ${allResults.length} combos (${ok} ok, ${failed} failed, ${vocab} vocab)`,
  );
  console.log(`  promptVersion: ${meta.promptVersion ?? '?'}  seed: ${meta.seed ?? '?'}`);
}

main();
