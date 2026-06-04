import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../src/cli/index.ts', import.meta.url));

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], cwd: string): Promise<RunResult> {
  const proc = Bun.spawn(['bun', CLI_ENTRY, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function wxrPayload(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>Test</title>
    <link>https://example.com</link>
    <description>Test</description>
    <item>
      <title>Hello</title>
      <link>https://example.com/hello</link>
      <pubDate>Mon, 15 Jan 2026 09:30:00 +0000</pubDate>
      <dc:creator><![CDATA[admin]]></dc:creator>
      <guid isPermaLink="false">https://example.com/?p=1</guid>
      <description></description>
      <content:encoded><![CDATA[<p>Hello</p>]]></content:encoded>
      <excerpt:encoded><![CDATA[]]></excerpt:encoded>
      <wp:post_id>1</wp:post_id>
      <wp:post_date>2026-01-15 09:30:00</wp:post_date>
      <wp:status>publish</wp:status>
      <wp:post_name>hello</wp:post_name>
      <wp:post_type>post</wp:post_type>
    </item>
  </channel>
</rss>`;
}

describe('cli import-wordpress', () => {
  let dir: string;
  let exportFile: string;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'laurel-import-wp-cli-')));
    exportFile = join(dir, 'export.xml');
    await writeFile(exportFile, wxrPayload());
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('appears in the top-level help', async () => {
    const { stdout, exitCode } = await runCli(['--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('import-wordpress');
  });

  test('help advertises --on-conflict and --dry-run', async () => {
    const { stdout, exitCode } = await runCli(['import-wordpress', '--help'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--on-conflict');
    expect(stdout).toContain('skip|overwrite|rename');
    expect(stdout).toContain('--dry-run');
  });

  test('errors when no file is given', async () => {
    const { stderr, exitCode } = await runCli(['import-wordpress'], dir);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Missing required argument: <file>');
  });

  test('imports a published post into content/posts/<slug>.md', async () => {
    const { exitCode } = await runCli(['import-wordpress', exportFile], dir);
    expect(exitCode).toBe(0);
    const md = await readFile(join(dir, 'content/posts/hello.md'), 'utf8');
    expect(md).toContain('slug: "hello"');
    expect(md).toContain('Hello');
  });

  test('rejects an unknown --on-conflict value with exit 2', async () => {
    const { stderr, exitCode } = await runCli(
      ['import-wordpress', exportFile, '--on-conflict', 'bogus'],
      dir,
    );
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Invalid --on-conflict value: bogus');
  });

  test('--dry-run prints a summary table without writing', async () => {
    const { stdout, exitCode } = await runCli(['import-wordpress', exportFile, '--dry-run'], dir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Dry run: no files written.');
    expect(stdout).toContain('Posts to import');
    expect(stdout).toContain('Type-filtered');
    expect(stdout).toContain('Status-filtered');
    await expect(readFile(join(dir, 'content/posts/hello.md'), 'utf8')).rejects.toThrow();
  });
});
