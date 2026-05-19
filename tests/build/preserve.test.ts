import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRESERVE_FILE, loadPreservePatterns, preserveUserFiles } from '~/build/preserve.ts';
import { getWarningCount, resetWarningCount } from '~/util/logger.ts';

interface Fixture {
  cwd: string;
  finalOutputDir: string;
  stagingDir: string;
}

async function makeFixture(): Promise<Fixture> {
  const cwd = await mkdtemp(join(tmpdir(), 'nectar-preserve-cwd-'));
  const finalOutputDir = await mkdtemp(join(tmpdir(), 'nectar-preserve-final-'));
  const stagingDir = await mkdtemp(join(tmpdir(), 'nectar-preserve-staging-'));
  return { cwd, finalOutputDir, stagingDir };
}

beforeEach(() => {
  resetWarningCount();
});

afterEach(() => {
  resetWarningCount();
});

describe('loadPreservePatterns', () => {
  test('returns empty array when .nectarignore is missing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-preserve-cwd-'));
    expect(await loadPreservePatterns(cwd)).toEqual([]);
  });

  test('parses lines, trims whitespace, drops comments and blanks', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-preserve-cwd-'));
    await writeFile(
      join(cwd, PRESERVE_FILE),
      ['# comment', '', 'CNAME', '  _headers  ', '.well-known/', '#another comment'].join('\n'),
    );
    expect(await loadPreservePatterns(cwd)).toEqual(['CNAME', '_headers', '.well-known/']);
  });
});

describe('preserveUserFiles', () => {
  test('no-op when .nectarignore is missing', async () => {
    const fx = await makeFixture();
    const result = await preserveUserFiles(fx);
    expect(result).toEqual({ copied: 0, skipped: 0 });
  });

  test('copies a user file from previous build into staging', async () => {
    const fx = await makeFixture();
    await writeFile(join(fx.cwd, PRESERVE_FILE), 'CNAME\n');
    await writeFile(join(fx.finalOutputDir, 'CNAME'), 'blog.example.com');

    const result = await preserveUserFiles(fx);

    expect(result.copied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(await readFile(join(fx.stagingDir, 'CNAME'), 'utf8')).toBe('blog.example.com');
  });

  test('copies a user directory recursively', async () => {
    const fx = await makeFixture();
    await writeFile(join(fx.cwd, PRESERVE_FILE), '.well-known\n');
    await mkdir(join(fx.finalOutputDir, '.well-known'), { recursive: true });
    await writeFile(join(fx.finalOutputDir, '.well-known', 'security.txt'), 'Contact: x');
    await mkdir(join(fx.finalOutputDir, '.well-known', 'acme'), { recursive: true });
    await writeFile(join(fx.finalOutputDir, '.well-known', 'acme', 'token'), 'value');

    const result = await preserveUserFiles(fx);

    expect(result.copied).toBe(1);
    expect(await readFile(join(fx.stagingDir, '.well-known', 'security.txt'), 'utf8')).toBe(
      'Contact: x',
    );
    expect(await readFile(join(fx.stagingDir, '.well-known', 'acme', 'token'), 'utf8')).toBe(
      'value',
    );
  });

  test('skips entries that do not exist in the previous build', async () => {
    const fx = await makeFixture();
    await writeFile(join(fx.cwd, PRESERVE_FILE), 'CNAME\nmissing\n');
    await writeFile(join(fx.finalOutputDir, 'CNAME'), 'blog.example.com');

    const result = await preserveUserFiles(fx);

    expect(result.copied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(existsSync(join(fx.stagingDir, 'missing'))).toBe(false);
  });

  test('keeps fresh build output when it conflicts with a preserved path', async () => {
    const fx = await makeFixture();
    await writeFile(join(fx.cwd, PRESERVE_FILE), '_headers\n');
    await writeFile(join(fx.finalOutputDir, '_headers'), '/* old');
    await writeFile(join(fx.stagingDir, '_headers'), '/* new');

    const result = await preserveUserFiles(fx);

    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(await readFile(join(fx.stagingDir, '_headers'), 'utf8')).toBe('/* new');
    expect(getWarningCount()).toBe(1);
  });

  test('rejects absolute paths', async () => {
    const fx = await makeFixture();
    await writeFile(join(fx.cwd, PRESERVE_FILE), '/etc/passwd\n');

    const result = await preserveUserFiles(fx);

    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(getWarningCount()).toBe(1);
  });

  test('rejects paths that escape the output dir', async () => {
    const fx = await makeFixture();
    await writeFile(join(fx.cwd, PRESERVE_FILE), '../escape\n');

    const result = await preserveUserFiles(fx);

    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(getWarningCount()).toBe(1);
  });
});
