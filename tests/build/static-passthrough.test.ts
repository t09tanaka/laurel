import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyStaticDir, resolveStaticPassthroughDirs } from '~/build/static-passthrough.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'laurel-static-out-'));
}

async function makeCwd(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'laurel-static-cwd-'));
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

  test('fails when static passthrough would replace a generated deploy artifact', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await writeFile(join(outputDir, '_headers'), 'generated headers\n', 'utf8');
    await mkdir(join(cwd, 'static'), { recursive: true });
    await writeFile(join(cwd, 'static', '_headers'), 'hand-written headers\n', 'utf8');

    await expect(
      copyStaticDir({
        cwd,
        staticDir: 'static',
        outputDir,
        generatedConflict: { paths: ['_headers'] },
      }),
    ).rejects.toThrow(/static\/_headers.*generated deploy artifact/);
    expect(readFileSync(join(outputDir, '_headers'), 'utf8')).toBe('generated headers\n');
  });

  test('allows --force-style static passthrough over generated deploy artifacts', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await writeFile(join(outputDir, '_redirects'), 'generated redirects\n', 'utf8');
    await mkdir(join(cwd, 'static'), { recursive: true });
    await writeFile(join(cwd, 'static', '_redirects'), 'hand-written redirects\n', 'utf8');

    const copied = await copyStaticDir({
      cwd,
      staticDir: 'static',
      outputDir,
      generatedConflict: { paths: ['_redirects'], force: true },
    });

    expect(copied).toBe(1);
    expect(readFileSync(join(outputDir, '_redirects'), 'utf8')).toBe('hand-written redirects\n');
  });

  test('merges hand-written deploy artifacts before generated ones when configured', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await writeFile(join(outputDir, '_headers'), 'generated headers\n', 'utf8');
    await mkdir(join(cwd, 'static'), { recursive: true });
    await writeFile(join(cwd, 'static', '_headers'), 'hand-written headers\n', 'utf8');

    const copied = await copyStaticDir({
      cwd,
      staticDir: 'static',
      outputDir,
      generatedConflict: { paths: ['_headers'], merge: true },
    });

    expect(copied).toBe(1);
    expect(readFileSync(join(outputDir, '_headers'), 'utf8')).toBe(
      'hand-written headers\n\ngenerated headers\n',
    );
  });

  test('merges hand-written vercel.json with generated headers and redirects', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await writeFile(
      join(outputDir, 'vercel.json'),
      JSON.stringify(
        {
          cleanUrls: true,
          trailingSlash: true,
          headers: [{ source: '/generated', headers: [{ key: 'X-Generated', value: '1' }] }],
          redirects: [{ source: '/old', destination: '/new', statusCode: 301 }],
        },
        null,
        2,
      ),
    );
    await mkdir(join(cwd, 'static'), { recursive: true });
    await writeFile(
      join(cwd, 'static', 'vercel.json'),
      JSON.stringify(
        {
          trailingSlash: false,
          headers: [{ source: '/manual', headers: [{ key: 'X-Manual', value: '1' }] }],
          redirects: [{ source: '/manual-old', destination: '/manual-new', statusCode: 302 }],
        },
        null,
        2,
      ),
    );

    const copied = await copyStaticDir({
      cwd,
      staticDir: 'static',
      outputDir,
      generatedConflict: { paths: ['vercel.json'], merge: true },
    });

    const parsed = JSON.parse(readFileSync(join(outputDir, 'vercel.json'), 'utf8')) as {
      cleanUrls?: boolean;
      trailingSlash?: boolean;
      headers?: Array<{ source: string }>;
      redirects?: Array<{ source: string }>;
    };
    expect(copied).toBe(1);
    expect(parsed.cleanUrls).toBe(true);
    expect(parsed.trailingSlash).toBe(false);
    expect(parsed.headers?.map((rule) => rule.source)).toEqual(['/manual', '/generated']);
    expect(parsed.redirects?.map((rule) => rule.source)).toEqual(['/manual-old', '/old']);
  });

  test('copies nested .well-known directories dropped into the static directory', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await mkdir(join(cwd, 'static', '.well-known', 'acme-challenge'), { recursive: true });
    await writeFile(
      join(cwd, 'static', '.well-known', 'acme-challenge', 'token'),
      'acme-token',
      'utf8',
    );
    await writeFile(join(cwd, 'static', '.well-known', 'mta-sts.txt'), 'mta-sts', 'utf8');
    await writeFile(join(cwd, 'static', '.well-known', 'security.txt'), 'security', 'utf8');

    const copied = await copyStaticDir({ cwd, staticDir: 'static', outputDir });

    expect(copied).toBe(3);
    expect(readFileSync(join(outputDir, '.well-known', 'acme-challenge', 'token'), 'utf8')).toBe(
      'acme-token',
    );
    expect(readFileSync(join(outputDir, '.well-known', 'mta-sts.txt'), 'utf8')).toBe('mta-sts');
    expect(readFileSync(join(outputDir, '.well-known', 'security.txt'), 'utf8')).toBe('security');
  });

  test('uses public as the default passthrough convention when static is absent', async () => {
    const cwd = await makeCwd();
    await mkdir(join(cwd, 'public'), { recursive: true });

    expect(resolveStaticPassthroughDirs({ cwd, staticDir: 'static' })).toEqual(['public']);
  });

  test('skips symlinked files so they cannot escape the static directory', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    const secret = await mkdtemp(join(tmpdir(), 'laurel-static-secret-'));
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
