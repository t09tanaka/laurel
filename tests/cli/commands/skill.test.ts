import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

describe('cli skill', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'nectar-skill-cmd-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  test('list prints every bundled skill name', async () => {
    const { stdout, exitCode } = await runCli(['skill', 'list'], cwd);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('frontmatter-authoring');
    expect(stdout).toContain('build-troubleshoot');
  });

  test('list --json emits {count, skills:[...]}', async () => {
    const { stdout, exitCode } = await runCli(['skill', 'list', '--json'], cwd);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { count: number; skills: Array<{ slug: string }> };
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.skills.map((s) => s.slug)).toContain('frontmatter-authoring');
  });

  test('install with CLAUDE.md present installs Claude format only', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), '# placeholder\n');
    const { exitCode } = await runCli(['skill', 'install'], cwd);
    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, '.claude/skills/frontmatter-authoring/SKILL.md'))).toBe(true);
    expect(existsSync(join(cwd, '.codex/skills/frontmatter-authoring/SKILL.md'))).toBe(false);
  });

  test('install with AGENTS.md present installs Codex format only', async () => {
    await writeFile(join(cwd, 'AGENTS.md'), '# placeholder\n');
    const { exitCode } = await runCli(['skill', 'install'], cwd);
    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, '.codex/skills/frontmatter-authoring/SKILL.md'))).toBe(true);
    expect(existsSync(join(cwd, '.claude/skills/frontmatter-authoring/SKILL.md'))).toBe(false);
  });

  test('install with both marker files installs both formats', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), '');
    await writeFile(join(cwd, 'AGENTS.md'), '');
    const { exitCode } = await runCli(['skill', 'install'], cwd);
    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, '.claude/skills/frontmatter-authoring/SKILL.md'))).toBe(true);
    expect(existsSync(join(cwd, '.codex/skills/frontmatter-authoring/SKILL.md'))).toBe(true);
  });

  test('install without marker files errors out with actionable guidance', async () => {
    const { stderr, exitCode } = await runCli(['skill', 'install'], cwd);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('CLAUDE.md');
    expect(stderr).toContain('AGENTS.md');
    expect(stderr).toContain('--format');
  });

  test('install --format codex bypasses the marker-file check', async () => {
    const { exitCode } = await runCli(['skill', 'install', '--format', 'codex'], cwd);
    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, '.codex/skills/frontmatter-authoring/SKILL.md'))).toBe(true);
  });

  test('install --format all writes both formats', async () => {
    const { exitCode } = await runCli(['skill', 'install', '--format', 'all'], cwd);
    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, '.claude/skills/frontmatter-authoring/SKILL.md'))).toBe(true);
    expect(existsSync(join(cwd, '.codex/skills/frontmatter-authoring/SKILL.md'))).toBe(true);
  });

  test('install <slug> installs just that skill', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), '');
    const { exitCode } = await runCli(['skill', 'install', 'build-troubleshoot'], cwd);
    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, '.claude/skills/build-troubleshoot/SKILL.md'))).toBe(true);
    expect(existsSync(join(cwd, '.claude/skills/frontmatter-authoring/SKILL.md'))).toBe(false);
  });

  test('install rejects unknown slugs', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), '');
    const { stderr, exitCode } = await runCli(['skill', 'install', 'no-such-skill'], cwd);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('no-such-skill');
  });

  test('remove deletes the installed skill', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), '');
    await runCli(['skill', 'install', 'frontmatter-authoring'], cwd);
    expect(existsSync(join(cwd, '.claude/skills/frontmatter-authoring'))).toBe(true);
    const { exitCode } = await runCli(['skill', 'remove', 'frontmatter-authoring'], cwd);
    expect(exitCode).toBe(0);
    expect(existsSync(join(cwd, '.claude/skills/frontmatter-authoring'))).toBe(false);
  });
});
