#!/usr/bin/env bun
// Coverage-gate (#665).
//
// `bun test --coverage` emits an lcov.info file plus a text table to stderr,
// but as of Bun 1.3.14 the `[test.coverageThreshold]` directive in bunfig.toml
// is not enforced via the exit code. This script reads the generated
// `coverage/lcov.info`, computes the aggregate line- and function-hit ratios
// across all source files (excluding `tests/` so the gate measures product
// code only), and exits non-zero when either falls below the configured
// floors.
//
// Usage:
//   bun scripts/coverage-gate.ts [--lcov path] [--lines 0.85] [--functions 0.85]
//
// Defaults match `bunfig.toml [test.coverageThreshold]`. CI invokes this
// after `bun test --coverage` so a regression in line coverage fails the run
// loudly instead of silently drifting downward.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Gate {
  lcovPath: string;
  minLines: number;
  minFunctions: number;
}

function parseArgs(argv: string[]): Gate {
  const gate: Gate = {
    lcovPath: resolve(process.cwd(), 'coverage/lcov.info'),
    minLines: 0.85,
    minFunctions: 0.85,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lcov' && argv[i + 1]) {
      gate.lcovPath = resolve(argv[++i]);
    } else if (a === '--lines' && argv[i + 1]) {
      gate.minLines = Number(argv[++i]);
    } else if (a === '--functions' && argv[i + 1]) {
      gate.minFunctions = Number(argv[++i]);
    } else if (a === '-h' || a === '--help') {
      process.stdout.write(
        'Usage: bun scripts/coverage-gate.ts [--lcov path] [--lines 0.85] [--functions 0.85]\n',
      );
      process.exit(0);
    } else {
      process.stderr.write(`unknown flag: ${a}\n`);
      process.exit(2);
    }
  }
  return gate;
}

interface Totals {
  linesFound: number;
  linesHit: number;
  fnFound: number;
  fnHit: number;
}

function parseLcov(text: string): Totals {
  // lcov.info is a flat list of records separated by `end_of_record`. We sum
  // LF/LH and FNF/FNH across every SF (source-file) record. Test files live
  // in tests/ — they are already excluded by `coverageSkipTestFiles = true`
  // in bunfig.toml, but we filter defensively here in case the flag is ever
  // disabled.
  const totals: Totals = { linesFound: 0, linesHit: 0, fnFound: 0, fnHit: 0 };
  const records = text.split('end_of_record');
  for (const rec of records) {
    if (!rec.trim()) continue;
    const sfMatch = rec.match(/^SF:(.+)$/m);
    if (!sfMatch) continue;
    const path = sfMatch[1] ?? '';
    if (path.startsWith('tests/') || path.includes('/tests/')) continue;
    const lf = Number(rec.match(/^LF:(\d+)$/m)?.[1] ?? 0);
    const lh = Number(rec.match(/^LH:(\d+)$/m)?.[1] ?? 0);
    const fnf = Number(rec.match(/^FNF:(\d+)$/m)?.[1] ?? 0);
    const fnh = Number(rec.match(/^FNH:(\d+)$/m)?.[1] ?? 0);
    totals.linesFound += lf;
    totals.linesHit += lh;
    totals.fnFound += fnf;
    totals.fnHit += fnh;
  }
  return totals;
}

function pct(hit: number, found: number): number {
  if (found === 0) return 1;
  return hit / found;
}

async function main(): Promise<number> {
  const gate = parseArgs(process.argv.slice(2));
  const lcovText = await readFile(gate.lcovPath, 'utf8').catch((err) => {
    process.stderr.write(`coverage-gate: cannot read ${gate.lcovPath}: ${String(err)}\n`);
    process.exit(2);
  });
  const totals = parseLcov(lcovText);
  const linesRatio = pct(totals.linesHit, totals.linesFound);
  const functionsRatio = pct(totals.fnHit, totals.fnFound);

  const fmt = (n: number): string => `${(n * 100).toFixed(2)}%`;
  process.stdout.write(
    [
      'coverage-gate (#665):',
      `  lines:     ${totals.linesHit} / ${totals.linesFound}  (${fmt(linesRatio)})  threshold ${fmt(gate.minLines)}`,
      `  functions: ${totals.fnHit} / ${totals.fnFound}  (${fmt(functionsRatio)})  threshold ${fmt(gate.minFunctions)}`,
      '',
    ].join('\n'),
  );

  const lineBreach = linesRatio < gate.minLines;
  const fnBreach = functionsRatio < gate.minFunctions;
  if (lineBreach || fnBreach) {
    if (lineBreach) {
      process.stderr.write(
        `coverage-gate: lines coverage ${fmt(linesRatio)} is below threshold ${fmt(gate.minLines)}.\n`,
      );
    }
    if (fnBreach) {
      process.stderr.write(
        `coverage-gate: functions coverage ${fmt(functionsRatio)} is below threshold ${fmt(gate.minFunctions)}.\n`,
      );
    }
    return 1;
  }
  return 0;
}

const code = await main();
process.exit(code);
