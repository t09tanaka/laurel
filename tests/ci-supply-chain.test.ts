import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Guards CI supply-chain integrity: every `bun install` step in any workflow
// must pass `--frozen-lockfile` so Bun refuses to mutate bun.lock and verifies
// each dependency against its integrity hash. Without this, a tampered or
// drifted lockfile could silently introduce unreviewed code into release
// artifacts. See backlog task #482.

const WORKFLOWS_DIR = join(import.meta.dir, '..', '.github', 'workflows');

const listWorkflows = (): { name: string; content: string }[] =>
  readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((name) => ({
      name,
      content: readFileSync(join(WORKFLOWS_DIR, name), 'utf8'),
    }));

describe('ci supply-chain', () => {
  test('at least one workflow file exists', () => {
    expect(listWorkflows().length).toBeGreaterThan(0);
  });

  test('CI verifies Bun runtime tsconfig path alias resolution before install', () => {
    const ci = listWorkflows().find(({ name }) => name === 'ci.yml');
    expect(ci).toBeDefined();

    const content = ci?.content ?? '';
    const aliasCheck = content.indexOf('bun run verify:bun-path-alias');
    const install = content.indexOf('bun install --frozen-lockfile');

    expect(aliasCheck).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(-1);
    expect(aliasCheck).toBeLessThan(install);
  });

  test('every `bun install` invocation in workflows uses --frozen-lockfile', () => {
    const offenders: string[] = [];
    for (const { name, content } of listWorkflows()) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/\bbun\s+install\b/.test(line)) continue;
        if (/--frozen-lockfile\b/.test(line)) continue;
        offenders.push(`${name}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(
      offenders,
      `bun install must always pass --frozen-lockfile in CI:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
