import { describe, expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitNojekyll } from '~/build/nojekyll.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'laurel-nojekyll-'));
}

describe('emitNojekyll', () => {
  test('writes a zero-byte .nojekyll at the output root', async () => {
    const outputDir = await makeOutputDir();

    await emitNojekyll({ outputDir });

    const file = join(outputDir, '.nojekyll');
    const body = await readFile(file, 'utf8');
    expect(body).toBe('');
    expect(statSync(file).size).toBe(0);
  });

  test('creates the output directory when it does not yet exist', async () => {
    const root = await makeOutputDir();
    const outputDir = join(root, 'nested', 'dist');

    await emitNojekyll({ outputDir });

    const body = await readFile(join(outputDir, '.nojekyll'), 'utf8');
    expect(body).toBe('');
  });
});
