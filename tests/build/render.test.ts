import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const RENDER_BLUEPRINT_SAMPLE = join(
  import.meta.dir,
  '..',
  '..',
  'examples',
  'render',
  'render.yaml',
);

describe('render.yaml sample', () => {
  test('exists under examples/render', () => {
    expect(existsSync(RENDER_BLUEPRINT_SAMPLE)).toBe(true);
  });

  test('documents the Render Static Site build command and publish path', async () => {
    const body = await readFile(RENDER_BLUEPRINT_SAMPLE, 'utf8');

    expect(body).toContain('services:');
    expect(body).toContain('type: static');
    expect(body).toContain('buildCommand: bun install && bun run build');
    expect(body).toContain('publishPath: ./dist');
  });
});
