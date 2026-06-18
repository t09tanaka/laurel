import { describe, expect, test } from 'bun:test';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RenderedMarkdown } from '~/content/markdown.ts';
import { renderMarkdownWithCache } from '~/content/render-cache.ts';

const RESULT: RenderedMarkdown = {
  html: '<p>hi</p>',
  plaintext: 'hi',
  word_count: 1,
  reading_time: 1,
};

async function harness() {
  const cwd = await mkdtemp(join(tmpdir(), 'laurel-rc-'));
  const sourcePath = join(cwd, 'post.md');
  await writeFile(sourcePath, 'body', 'utf8');
  const sourceStat = await stat(sourcePath);
  let renders = 0;
  const call = (generatorVersion: string) =>
    renderMarkdownWithCache({
      cwd,
      sourcePath,
      sourceStat,
      body: 'body',
      options: {},
      generatorVersion,
      render: async () => {
        renders += 1;
        return RESULT;
      },
    });
  return { call, renders: () => renders };
}

describe('renderMarkdownWithCache version keying', () => {
  test('reuses the cache for the same generator version', async () => {
    const { call, renders } = await harness();
    await call('1.0.0');
    await call('1.0.0');
    expect(renders()).toBe(1);
  });

  test('invalidates the cache when the generator version changes', async () => {
    const { call, renders } = await harness();
    await call('1.0.0');
    expect(renders()).toBe(1);
    // A new Laurel version must not serve the previous version's cached HTML.
    await call('2.0.0');
    expect(renders()).toBe(2);
    // Going back to the first version still has its own entry cached.
    await call('1.0.0');
    expect(renders()).toBe(2);
  });
});
