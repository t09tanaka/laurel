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
const RENDER_RECIPE_DOC = join(import.meta.dir, '..', '..', 'docs', 'deployment', 'render.md');
const RENDER_GUIDE_DOC = join(import.meta.dir, '..', '..', 'docs', 'deploy', 'render.md');

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

  test('documents Netlify-style redirect and header artifacts for Render', async () => {
    const recipe = await readFile(RENDER_RECIPE_DOC, 'utf8');
    const guide = await readFile(RENDER_GUIDE_DOC, 'utf8');

    for (const body of [recipe, guide]) {
      expect(body).toContain('Netlify');
      expect(body).toContain('_redirects');
      expect(body).toContain('_headers');
    }

    expect(recipe).toContain('Render Static Sites read Netlify-style');
    expect(guide).toContain('Nectar reuses the Netlify emitter');
  });
});
