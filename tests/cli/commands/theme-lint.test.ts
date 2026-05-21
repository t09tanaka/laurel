import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReportJson, formatReportTable, lintTheme } from '~/cli/commands/theme-lint.ts';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-theme-lint-'));
}

async function writeFile2(path: string, contents: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, contents, 'utf8');
}

const FULL_DEFAULT = [
  '<html><head>{{ghost_head}}</head>',
  '<body class="{{body_class}}">{{{body}}}{{ghost_foot}}</body></html>',
].join('\n');

const FULL_POST = '{{!< default}}\n<article class="{{post_class}}">{{title}}</article>\n';
const FULL_PAGE = '{{!< default}}\n<article class="{{post_class}}">{{title}}</article>\n';
const FULL_INDEX = '{{!< default}}\n{{#foreach posts}}{{title}}{{/foreach}}\n';

async function writeFullTheme(root: string): Promise<void> {
  await writeFile2(join(root, 'default.hbs'), FULL_DEFAULT);
  await writeFile2(join(root, 'index.hbs'), FULL_INDEX);
  await writeFile2(join(root, 'post.hbs'), FULL_POST);
  await writeFile2(join(root, 'page.hbs'), FULL_PAGE);
  await writeFile2(join(root, 'partials/navigation.hbs'), '<nav></nav>');
  await writeFile2(join(root, 'partials/pagination.hbs'), '<div></div>');
}

describe('lintTheme', () => {
  test('clean theme produces no findings', async () => {
    const dir = await makeTempDir();
    try {
      await writeFullTheme(dir);
      const report = await lintTheme(dir);
      expect(report.errors).toBe(0);
      expect(report.warnings).toBe(0);
      expect(report.findings.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('detects missing required templates', async () => {
    const dir = await makeTempDir();
    try {
      await writeFile2(join(dir, 'default.hbs'), FULL_DEFAULT);
      const report = await lintTheme(dir);
      // missing index.hbs (or home.hbs), post.hbs, page.hbs = 3 errors
      const missing = report.findings.filter((f) => f.code === 'missing-required-template');
      expect(missing.length).toBe(3);
      const messages = missing.map((f) => f.message).join('\n');
      expect(messages).toContain('index.hbs');
      expect(messages).toContain('post.hbs');
      expect(messages).toContain('page.hbs');
      expect(report.errors).toBeGreaterThanOrEqual(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('home.hbs satisfies the index.hbs requirement', async () => {
    const dir = await makeTempDir();
    try {
      await writeFile2(join(dir, 'default.hbs'), FULL_DEFAULT);
      await writeFile2(join(dir, 'home.hbs'), FULL_INDEX);
      await writeFile2(join(dir, 'post.hbs'), FULL_POST);
      await writeFile2(join(dir, 'page.hbs'), FULL_PAGE);
      const report = await lintTheme(dir);
      const missingTemplates = report.findings.filter(
        (f) => f.code === 'missing-required-template',
      );
      expect(missingTemplates.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('detects missing required helpers in default.hbs', async () => {
    const dir = await makeTempDir();
    try {
      await writeFile2(join(dir, 'default.hbs'), '<html><body>{{{body}}}</body></html>');
      await writeFile2(join(dir, 'index.hbs'), FULL_INDEX);
      await writeFile2(join(dir, 'post.hbs'), FULL_POST);
      await writeFile2(join(dir, 'page.hbs'), FULL_PAGE);
      const report = await lintTheme(dir);
      const missingHelpers = report.findings.filter((f) => f.code === 'missing-required-helper');
      const messages = missingHelpers.map((f) => f.message).join('\n');
      expect(messages).toContain('ghost_head');
      expect(messages).toContain('ghost_foot');
      expect(messages).toContain('body_class');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('warns on missing recommended partials', async () => {
    const dir = await makeTempDir();
    try {
      await writeFile2(join(dir, 'default.hbs'), FULL_DEFAULT);
      await writeFile2(join(dir, 'index.hbs'), FULL_INDEX);
      await writeFile2(join(dir, 'post.hbs'), FULL_POST);
      await writeFile2(join(dir, 'page.hbs'), FULL_PAGE);
      // no partials/
      const report = await lintTheme(dir);
      const warnings = report.findings.filter((f) => f.code === 'missing-recommended-partial');
      expect(warnings.length).toBe(2);
      expect(report.warnings).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('flags deprecated helper usage', async () => {
    const dir = await makeTempDir();
    try {
      await writeFullTheme(dir);
      await writeFile2(
        join(dir, 'amp.hbs'),
        '{{!< default}}\n{{amp_components}}\n{{amp_content}}\n',
      );
      const report = await lintTheme(dir);
      const deprecated = report.findings.filter((f) => f.code === 'deprecated-helper');
      expect(deprecated.length).toBeGreaterThanOrEqual(2);
      expect(deprecated.every((f) => f.level === 'warn')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('warns on member-related theme markers that need static Portal wiring', async () => {
    const dir = await makeTempDir();
    try {
      await writeFullTheme(dir);
      await writeFile2(
        join(dir, 'partials/signup.hbs'),
        '<a href="#/portal/signup" data-portal="signup">{{#if @member}}Account{{/if}}</a>',
      );

      const report = await lintTheme(dir);
      const warnings = report.findings.filter((f) => f.code === 'gscan-members-static-runtime');
      expect(warnings.length).toBeGreaterThanOrEqual(2);
      expect(warnings.every((f) => f.level === 'warn')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('post_class can live in a partial instead of post.hbs', async () => {
    const dir = await makeTempDir();
    try {
      await writeFile2(join(dir, 'default.hbs'), FULL_DEFAULT);
      await writeFile2(join(dir, 'index.hbs'), FULL_INDEX);
      // post.hbs delegates wrapper to a partial
      await writeFile2(join(dir, 'post.hbs'), '{{!< default}}\n{{> "article"}}');
      await writeFile2(join(dir, 'page.hbs'), '{{!< default}}\n{{> "article"}}');
      await writeFile2(
        join(dir, 'partials/article.hbs'),
        '<article class="{{post_class}}">{{title}}</article>',
      );
      const report = await lintTheme(dir);
      const missingPostClass = report.findings.filter(
        (f) => f.code === 'missing-required-helper' && f.message.includes('post_class'),
      );
      expect(missingPostClass.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('formatReportTable shows totals', async () => {
    const dir = await makeTempDir();
    try {
      await writeFullTheme(dir);
      const report = await lintTheme(dir);
      const out = formatReportTable(report);
      expect(out).toContain('No issues found');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('formatReportJson emits parsable JSON', async () => {
    const dir = await makeTempDir();
    try {
      await writeFullTheme(dir);
      const report = await lintTheme(dir);
      const out = formatReportJson(report);
      const parsed = JSON.parse(out) as { errors: number; findings: unknown[] };
      expect(parsed.errors).toBe(0);
      expect(Array.isArray(parsed.findings)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('non-existent theme path produces an error finding', async () => {
    const report = await lintTheme('/definitely/does/not/exist/nectar-test');
    expect(report.errors).toBeGreaterThan(0);
    expect(report.findings[0]?.code).toBe('theme-not-found');
  });
});

describe('nectar theme lint CLI', () => {
  test('exits 1 when errors are present and 0 on clean theme', async () => {
    const dir = await makeTempDir();
    try {
      // Empty directory: missing everything.
      await mkdir(dir, { recursive: true });
      const broken = await runCli(['theme', 'lint', dir]);
      expect(broken.exitCode).toBe(1);
      expect(broken.stdout).toContain('ERROR');

      // Now make it clean.
      await writeFullTheme(dir);
      const clean = await runCli(['theme', 'lint', dir]);
      expect(clean.exitCode).toBe(0);
      expect(clean.stdout).toContain('No issues found');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('theme:lint alias dispatches to theme lint', async () => {
    const dir = await makeTempDir();
    try {
      await writeFullTheme(dir);
      const res = await runCli(['theme:lint', dir]);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('No issues found');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--json prints parsable JSON', async () => {
    const dir = await makeTempDir();
    try {
      await writeFullTheme(dir);
      const res = await runCli(['theme', 'lint', dir, '--json']);
      expect(res.exitCode).toBe(0);
      const parsed = JSON.parse(res.stdout) as { errors: number };
      expect(parsed.errors).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}
