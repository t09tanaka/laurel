import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitHumans } from '~/build/humans.ts';
import { configSchema } from '~/config/schema.ts';

async function makeOutputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-humans-'));
}

async function makeCwd(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nectar-humans-cwd-'));
}

describe('emitHumans', () => {
  test('writes default site metadata', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    const config = configSchema.parse({
      site: {
        title: 'Humans Test',
        description: 'A static site for humans',
        url: 'https://humans.test/',
      },
    });

    await emitHumans({ cwd, config, outputDir });

    const body = readFileSync(join(outputDir, 'humans.txt'), 'utf8');
    expect(body).toBe(
      [
        '/* SITE */',
        'Title: Humans Test',
        'Description: A static site for humans',
        'URL: https://humans.test',
        'Generator: Nectar',
        '',
      ].join('\n'),
    );
  });

  test('omits the description line when site.description is empty', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    const config = configSchema.parse({
      site: { title: 'Humans Test', url: 'https://humans.test' },
    });

    await emitHumans({ cwd, config, outputDir });

    const body = readFileSync(join(outputDir, 'humans.txt'), 'utf8');
    expect(body).toBe(
      [
        '/* SITE */',
        'Title: Humans Test',
        'URL: https://humans.test',
        'Generator: Nectar',
        '',
      ].join('\n'),
    );
  });

  test('copies static/humans.txt verbatim when the override file exists', async () => {
    const outputDir = await makeOutputDir();
    const cwd = await makeCwd();
    await mkdir(join(cwd, 'static'), { recursive: true });
    const override = ['/* TEAM */', 'Builder: Example Team', ''].join('\n');
    await writeFile(join(cwd, 'static', 'humans.txt'), override, 'utf8');
    const config = configSchema.parse({
      site: { title: 'Humans Test', url: 'https://humans.test' },
    });

    await emitHumans({ cwd, config, outputDir });

    const body = readFileSync(join(outputDir, 'humans.txt'), 'utf8');
    expect(body).toBe(override);
  });
});
