import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyStaticDir } from '~/build/static-passthrough.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-static-out-'));
}

async function makeCwd(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-static-cwd-'));
}

describe('copyStaticDir', () => {
  test('returns 0 when the static directory does not exist', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();

    const copied = await copyStaticDir({ cwd, staticDir: 'static', outputDir });

    expect(copied).toBe(0);
  });

  test('returns 0 when staticDir is an empty string', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await mkdir(join(cwd, 'static'), { recursive: true });
    await writeFile(join(cwd, 'static', 'humans.txt'), 'team');

    const copied = await copyStaticDir({ cwd, staticDir: '', outputDir });

    expect(copied).toBe(0);
    expect(existsSync(join(outputDir, 'humans.txt'))).toBe(false);
  });

  test('copies top-level files verbatim into the output root', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await mkdir(join(cwd, 'static'), { recursive: true });
    const body = 'humans.txt body\n';
    await writeFile(join(cwd, 'static', 'humans.txt'), body, 'utf8');
    await writeFile(join(cwd, 'static', 'favicon.ico'), Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const copied = await copyStaticDir({ cwd, staticDir: 'static', outputDir });

    expect(copied).toBe(2);
    expect(readFileSync(join(outputDir, 'humans.txt'), 'utf8')).toBe(body);
    const ico = readFileSync(join(outputDir, 'favicon.ico'));
    expect(Array.from(ico)).toEqual([0x00, 0x01, 0x02, 0x03]);
  });

  test('preserves nested directory structure', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await mkdir(join(cwd, 'static', 'deep', 'nested'), { recursive: true });
    await writeFile(join(cwd, 'static', 'deep', 'a.txt'), 'a');
    await writeFile(join(cwd, 'static', 'deep', 'nested', 'b.txt'), 'b');

    const copied = await copyStaticDir({ cwd, staticDir: 'static', outputDir });

    expect(copied).toBe(2);
    expect(readFileSync(join(outputDir, 'deep', 'a.txt'), 'utf8')).toBe('a');
    expect(readFileSync(join(outputDir, 'deep', 'nested', 'b.txt'), 'utf8')).toBe('b');
  });

  test('honors a non-default staticDir', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await mkdir(join(cwd, 'public'), { recursive: true });
    await writeFile(join(cwd, 'public', 'verify.txt'), 'ok');

    const copied = await copyStaticDir({ cwd, staticDir: 'public', outputDir });

    expect(copied).toBe(1);
    expect(readFileSync(join(outputDir, 'verify.txt'), 'utf8')).toBe('ok');
  });

  test('overwrites pre-existing files in the output (passthrough wins)', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await writeFile(join(outputDir, 'robots.txt'), 'generated body\n', 'utf8');
    await mkdir(join(cwd, 'static'), { recursive: true });
    await writeFile(join(cwd, 'static', 'robots.txt'), 'user override\n', 'utf8');

    const copied = await copyStaticDir({ cwd, staticDir: 'static', outputDir });

    expect(copied).toBe(1);
    expect(readFileSync(join(outputDir, 'robots.txt'), 'utf8')).toBe('user override\n');
  });

  test('copies dotfiles dropped into the static directory', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await mkdir(join(cwd, 'static'), { recursive: true });
    await writeFile(join(cwd, 'static', '.well-known'), 'verify-me', 'utf8');

    const copied = await copyStaticDir({ cwd, staticDir: 'static', outputDir });

    expect(copied).toBe(1);
    expect(readFileSync(join(outputDir, '.well-known'), 'utf8')).toBe('verify-me');
  });

  test('skips symlinked files so they cannot escape the static directory', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    const secret = await mkdtemp(join(tmpdir(), 'nectar-static-secret-'));
    await writeFile(join(secret, 'leak.txt'), 'shhh', 'utf8');
    await mkdir(join(cwd, 'static'), { recursive: true });
    await writeFile(join(cwd, 'static', 'safe.txt'), 'safe', 'utf8');
    await symlink(join(secret, 'leak.txt'), join(cwd, 'static', 'evil.txt'));

    const copied = await copyStaticDir({ cwd, staticDir: 'static', outputDir });

    expect(copied).toBe(1);
    expect(readFileSync(join(outputDir, 'safe.txt'), 'utf8')).toBe('safe');
    expect(existsSync(join(outputDir, 'evil.txt'))).toBe(false);
  });
});
