import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitCname } from '~/build/cname.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-cname-'));
}

describe('emitCname', () => {
  test('writes CNAME with the host when custom_domain is set', async () => {
    const outputDir = await makeOutputDir();

    await emitCname({ outputDir, customDomain: 'blog.example.com' });

    const body = await readFile(join(outputDir, 'CNAME'), 'utf8');
    expect(body).toBe('blog.example.com');
  });

  test('does not emit CNAME when custom_domain is undefined', async () => {
    const outputDir = await makeOutputDir();

    await emitCname({ outputDir, customDomain: undefined });

    expect(existsSync(join(outputDir, 'CNAME'))).toBe(false);
  });

  test('does not emit CNAME when custom_domain is an empty string', async () => {
    const outputDir = await makeOutputDir();

    await emitCname({ outputDir, customDomain: '' });

    expect(existsSync(join(outputDir, 'CNAME'))).toBe(false);
  });

  test('does not emit CNAME when custom_domain is whitespace only', async () => {
    const outputDir = await makeOutputDir();

    await emitCname({ outputDir, customDomain: '   \n  ' });

    expect(existsSync(join(outputDir, 'CNAME'))).toBe(false);
  });

  test('trims surrounding whitespace from the host', async () => {
    const outputDir = await makeOutputDir();

    await emitCname({ outputDir, customDomain: '  example.com\n' });

    const body = await readFile(join(outputDir, 'CNAME'), 'utf8');
    expect(body).toBe('example.com');
  });

  test('writes exactly the host with no trailing newline', async () => {
    const outputDir = await makeOutputDir();

    await emitCname({ outputDir, customDomain: 'example.com' });

    const body = await readFile(join(outputDir, 'CNAME'), 'utf8');
    expect(body.endsWith('\n')).toBe(false);
    expect(body.length).toBe('example.com'.length);
  });

  test('creates the output directory when it does not yet exist', async () => {
    const root = await makeOutputDir();
    const outputDir = join(root, 'nested', 'dist');

    await emitCname({ outputDir, customDomain: 'site.example.org' });

    const body = await readFile(join(outputDir, 'CNAME'), 'utf8');
    expect(body).toBe('site.example.org');
  });
});
