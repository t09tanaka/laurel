import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentChoiceFromFormats, agentChoiceToFormats } from '../../../src/cli/commands/init.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd: string, stdinInput?: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdin: stdinInput !== undefined ? 'pipe' : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (stdinInput !== undefined) {
    const stdin = proc.stdin;
    if (stdin === undefined) throw new Error('Expected piped stdin to be available');
    stdin.write(stdinInput);
    stdin.end();
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

function expectLfOnly(bytes: Uint8Array): void {
  expect(bytes.includes(13)).toBe(false);
}

describe('cli init', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-init-')));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('--yes scaffolds nectar.toml, .gitignore, README, and starter content', async () => {
    const { exitCode } = await runCli(['init', '--yes'], dir);
    expect(exitCode).toBe(0);

    const toml = await readFile(join(dir, 'nectar.toml'), 'utf8');
    expect(toml).toContain('[site]');
    // Title is derived from the target directory (here: `nectar-init-XXXXXX`
    // from mkdtemp) → title-cased. No hardcoded "My Nectar Site" default.
    expect(toml).toMatch(/title = "[A-Z][^"]+"/);
    expect(toml).toContain('url = "http://localhost:4321"');
    expect(toml).toContain('[theme]');
    expect(toml).toContain('name = "source"');
    expect(toml).toContain('[components.rss]');
    expect(toml).toMatch(/enabled = true/);

    const gitignore = await readFile(join(dir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('dist/');
    expect(gitignore).toContain('.nectar/');

    const readme = await readFile(join(dir, 'README.md'), 'utf8');
    expect(readme).toMatch(/^# [A-Z]/m);
    expect(readme).toContain('nectar build');
    expect(readme).toContain('nectar dashboard');

    // Every content/ subdirectory is seeded with a .gitkeep so git tracks
    // the layout even when the operator skipped starter content.
    for (const sub of ['posts', 'pages', 'authors', 'tags', 'images']) {
      expect(await fileExists(join(dir, `content/${sub}/.gitkeep`))).toBe(true);
    }

    const welcome = await readFile(join(dir, 'content/posts/welcome.md'), 'utf8');
    expect(welcome).toMatch(/title: "Welcome to [A-Z]/);
    expect(welcome).toContain('slug: welcome');

    const about = await readFile(join(dir, 'content/pages/about.md'), 'utf8');
    expect(about).toContain('slug: about');

    const author = await readFile(join(dir, 'content/authors/default.md'), 'utf8');
    expect(author).toContain('slug: default');
  });

  test('--yes writes generated text files with LF-only line endings', async () => {
    const { exitCode } = await runCli(['init', '--yes'], dir);
    expect(exitCode).toBe(0);

    for (const path of [
      'nectar.toml',
      '.gitignore',
      'README.md',
      'content/posts/welcome.md',
      'content/pages/about.md',
      'content/authors/default.md',
    ]) {
      expectLfOnly(await readFile(join(dir, path)));
    }
  });

  test('refuses to overwrite existing files without --force', async () => {
    await writeFile(join(dir, 'nectar.toml'), 'pre-existing config');

    const { stderr, exitCode } = await runCli(['init', '--yes'], dir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Refusing to overwrite');
    expect(stderr).toContain('nectar.toml');
    expect(stderr).toContain('--force');

    const toml = await readFile(join(dir, 'nectar.toml'), 'utf8');
    expect(toml).toBe('pre-existing config');
  });

  test('--force overwrites existing files', async () => {
    await writeFile(join(dir, 'nectar.toml'), 'pre-existing config');

    const { exitCode } = await runCli(['init', '--yes', '--force'], dir);
    expect(exitCode).toBe(0);

    const toml = await readFile(join(dir, 'nectar.toml'), 'utf8');
    expect(toml).not.toBe('pre-existing config');
    expect(toml).toContain('[site]');
  });

  test('--dir scaffolds into a sibling directory', async () => {
    const sub = join(dir, 'newsite');
    const { exitCode } = await runCli(['init', '--yes', '--dir', sub], dir);
    expect(exitCode).toBe(0);
    expect(await fileExists(join(sub, 'nectar.toml'))).toBe(true);
    expect(await fileExists(join(sub, 'README.md'))).toBe(true);
    expect(await fileExists(join(dir, 'nectar.toml'))).toBe(false);
  });

  test('interactive mode reads answers from stdin', async () => {
    const stdin = [
      'My Blog', // title
      'https://example.com', // url
      '2', // theme: casper (second in KNOWN_THEMES)
      'n', // starter content: no
      'n', // rss: no
      '',
    ].join('\n');

    const { exitCode } = await runCli(['init'], dir, stdin);
    expect(exitCode).toBe(0);

    const toml = await readFile(join(dir, 'nectar.toml'), 'utf8');
    expect(toml).toContain('title = "My Blog"');
    expect(toml).toContain('url = "https://example.com"');
    expect(toml).toContain('name = "casper"');
    expect(toml).toContain('enabled = false');

    expect(await fileExists(join(dir, 'content/posts/welcome.md'))).toBe(false);
    expect(await fileExists(join(dir, 'content/pages/about.md'))).toBe(false);
  });

  test('interactive mode tolerates leading control bytes in the choice prompt', async () => {
    // Reproduces the `Invalid choice: �2` regression: terminals occasionally
    // leak ANSI escape bytes (or a stray U+FFFD from non-UTF-8 paste) into
    // the line buffer alongside the digit the user actually typed. The
    // sanitiser must strip those and still pick the right option.
    const stdin = [
      '', // title (accept default)
      '', // url (accept default)
      '\x1b 2', // theme: casper, prefixed by a stray escape byte and space
      '',
      '',
    ].join('\n');
    const { exitCode, stderr } = await runCli(['init'], dir, stdin);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain('Invalid choice');
    const toml = await readFile(join(dir, 'nectar.toml'), 'utf8');
    expect(toml).toContain('name = "casper"');
  });

  test('interactive mode accepts defaults via empty input', async () => {
    const stdin = '\n\n\n\n\n';
    const { exitCode } = await runCli(['init'], dir, stdin);
    expect(exitCode).toBe(0);

    const toml = await readFile(join(dir, 'nectar.toml'), 'utf8');
    // Empty title input → derive from target directory name (title-cased).
    expect(toml).toMatch(/title = "[A-Z][^"]+"/);
    expect(toml).toContain('name = "source"');
  });

  test('skips README and .gitignore if already present', async () => {
    await writeFile(join(dir, 'README.md'), '# pre-existing\n');
    await writeFile(join(dir, '.gitignore'), 'custom\n');

    const { exitCode, stdout } = await runCli(['init', '--yes'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Skipped existing README.md');
    expect(stdout).toContain('Skipped existing .gitignore');

    const readme = await readFile(join(dir, 'README.md'), 'utf8');
    expect(readme).toBe('# pre-existing\n');
    const gitignore = await readFile(join(dir, '.gitignore'), 'utf8');
    expect(gitignore).toBe('custom\n');
    expect(await fileExists(join(dir, 'nectar.toml'))).toBe(true);
  });

  test('--agent claude creates CLAUDE.md and installs Claude skills only', async () => {
    const { exitCode } = await runCli(['init', '--yes', '--agent', 'claude'], dir);
    expect(exitCode).toBe(0);
    expect(await fileExists(join(dir, 'CLAUDE.md'))).toBe(true);
    expect(await fileExists(join(dir, 'AGENTS.md'))).toBe(false);
    expect(await fileExists(join(dir, '.claude/skills/frontmatter-authoring/SKILL.md'))).toBe(true);
    expect(await fileExists(join(dir, '.claude/skills/writing/SKILL.md'))).toBe(true);
    expect(await fileExists(join(dir, '.agents/skills/frontmatter-authoring/SKILL.md'))).toBe(
      false,
    );
  });

  test('--agent codex creates AGENTS.md referencing the installed skills', async () => {
    const { exitCode } = await runCli(['init', '--yes', '--agent', 'codex'], dir);
    expect(exitCode).toBe(0);
    expect(await fileExists(join(dir, 'AGENTS.md'))).toBe(true);
    expect(await fileExists(join(dir, 'CLAUDE.md'))).toBe(false);
    const agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('.agents/skills/writing/SKILL.md');
    expect(agents).toContain('.agents/skills/frontmatter-authoring/SKILL.md');
    expect(await fileExists(join(dir, '.agents/skills/writing/SKILL.md'))).toBe(true);
    expect(await fileExists(join(dir, '.claude/skills/writing/SKILL.md'))).toBe(false);
  });

  test('--agent both wires up Claude Code and Codex', async () => {
    const { exitCode } = await runCli(['init', '--yes', '--agent', 'both'], dir);
    expect(exitCode).toBe(0);
    expect(await fileExists(join(dir, 'CLAUDE.md'))).toBe(true);
    expect(await fileExists(join(dir, 'AGENTS.md'))).toBe(true);
    expect(await fileExists(join(dir, '.claude/skills/writing/SKILL.md'))).toBe(true);
    expect(await fileExists(join(dir, '.agents/skills/writing/SKILL.md'))).toBe(true);
  });

  test('default (no --agent) creates no marker file or skills', async () => {
    const { exitCode } = await runCli(['init', '--yes'], dir);
    expect(exitCode).toBe(0);
    expect(await fileExists(join(dir, 'CLAUDE.md'))).toBe(false);
    expect(await fileExists(join(dir, 'AGENTS.md'))).toBe(false);
    expect(await fileExists(join(dir, '.claude/skills/frontmatter-authoring/SKILL.md'))).toBe(
      false,
    );
  });

  test('--agent rejects an invalid value', async () => {
    const { stderr, exitCode } = await runCli(['init', '--yes', '--agent', 'bogus'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --agent value');
  });

  test('--agent claude keeps an existing CLAUDE.md but still installs skills', async () => {
    await writeFile(join(dir, 'CLAUDE.md'), '# my own notes\n');
    const { exitCode } = await runCli(['init', '--yes', '--agent', 'claude'], dir);
    expect(exitCode).toBe(0);
    // The operator's marker file is never clobbered (policy: skip)...
    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# my own notes\n');
    // ...but the bundled skills are still (re)installed.
    expect(await fileExists(join(dir, '.claude/skills/writing/SKILL.md'))).toBe(true);
  });

  test('interactive stdin can opt into the codex agent', async () => {
    const stdin = [
      'My Blog', // title
      'https://example.com', // url
      '1', // theme: source
      'n', // starter content
      'n', // rss
      'codex', // AI assistant skills
      '',
    ].join('\n');
    const { exitCode } = await runCli(['init'], dir, stdin);
    expect(exitCode).toBe(0);
    expect(await fileExists(join(dir, 'AGENTS.md'))).toBe(true);
    expect(await fileExists(join(dir, '.agents/skills/writing/SKILL.md'))).toBe(true);
  });

  test('--help prints subcommand help', async () => {
    const { stdout, exitCode } = await runCli(['init', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Scaffold a new Nectar project');
    expect(stdout).toContain('--yes');
    expect(stdout).toContain('--force');
    expect(stdout).toContain('--dir <path>');
    expect(stdout).toContain('--agent');
  });

  test('appears in top-level usage', async () => {
    const { stdout } = await runCli(['--help'], dir);
    expect(stdout).toContain('init');
    expect(stdout).toContain('Scaffold a new Nectar project');
  });
});

describe('init agent multiselect mapping', () => {
  test('agentChoiceFromFormats collapses the selection to a single AgentChoice', () => {
    expect(agentChoiceFromFormats([])).toBe('none');
    expect(agentChoiceFromFormats(['claude'])).toBe('claude');
    expect(agentChoiceFromFormats(['codex'])).toBe('codex');
    expect(agentChoiceFromFormats(['claude', 'codex'])).toBe('both');
    // order-independent
    expect(agentChoiceFromFormats(['codex', 'claude'])).toBe('both');
  });

  test('agentChoiceToFormats expands an AgentChoice into multiselect initial values', () => {
    expect(agentChoiceToFormats('none')).toEqual([]);
    expect(agentChoiceToFormats('claude')).toEqual(['claude']);
    expect(agentChoiceToFormats('codex')).toEqual(['codex']);
    expect(agentChoiceToFormats('both')).toEqual(['claude', 'codex']);
  });

  test('the two helpers round-trip every AgentChoice', () => {
    for (const choice of ['none', 'claude', 'codex', 'both'] as const) {
      expect(agentChoiceFromFormats(agentChoiceToFormats(choice))).toBe(choice);
    }
  });
});
