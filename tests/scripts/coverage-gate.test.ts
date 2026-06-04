import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function lcovRecord({
  source,
  linesFound,
  linesHit,
  functionsFound = 1,
  functionsHit = 1,
}: {
  source: string;
  linesFound: number;
  linesHit: number;
  functionsFound?: number;
  functionsHit?: number;
}): string {
  return [
    `SF:${source}`,
    `FNF:${functionsFound}`,
    `FNH:${functionsHit}`,
    `LF:${linesFound}`,
    `LH:${linesHit}`,
    'end_of_record',
    '',
  ].join('\n');
}

async function runCoverageGate(
  lcov: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'laurel-coverage-gate-'));
  try {
    const lcovPath = join(dir, 'lcov.info');
    await writeFile(lcovPath, lcov, 'utf8');
    const proc = Bun.spawn([process.execPath, 'scripts/coverage-gate.ts', '--lcov', lcovPath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('coverage-gate', () => {
  test('fails when included product source line coverage is below the floor', async () => {
    const result = await runCoverageGate(
      lcovRecord({ source: 'src/build/example.ts', linesFound: 10, linesHit: 4 }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('lines coverage 40.00% is below threshold 85.00%');
  });

  test('ignores tests and CLI command wrappers that run under child-process integration tests', async () => {
    const result = await runCoverageGate(
      [
        lcovRecord({ source: 'src/build/example.ts', linesFound: 10, linesHit: 9 }),
        lcovRecord({ source: 'src/cli/commands/deploy.ts', linesFound: 100, linesHit: 0 }),
        lcovRecord({ source: 'tests/build/example.test.ts', linesFound: 100, linesHit: 0 }),
      ].join(''),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('lines:     9 / 10  (90.00%)');
  });
});
