import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMissingAssetReferences } from '~/build/asset-references.ts';
import type { NectarConfig } from '~/config/schema.ts';
import type { ContentGraph, Post } from '~/content/model.ts';

describe('findMissingAssetReferences', () => {
  test('does not warn for generated output images that are absent from source assets', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-asset-refs-'));
    const outputDir = join(cwd, 'dist');
    await mkdir(join(outputDir, 'content/images'), { recursive: true });
    await writeFile(join(outputDir, 'content/images/cover.og.png'), 'png');

    const missing = findMissingAssetReferences({
      cwd,
      outputDir,
      config: makeConfig(),
      content: makeContent({
        og_image: '/content/images/cover.og.png',
      }),
    });

    expect(missing).toEqual([]);
  });

  test('still reports local content images missing from both source and generated output', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nectar-asset-refs-'));
    const outputDir = join(cwd, 'dist');

    const missing = findMissingAssetReferences({
      cwd,
      outputDir,
      config: makeConfig(),
      content: makeContent({
        og_image: '/content/images/missing.og.png',
      }),
    });

    expect(missing).toHaveLength(1);
    expect(missing[0]?.owner).toBe("Post 'post' og_image");
    expect(missing[0]?.url).toBe('/content/images/missing.og.png');
    expect(missing[0]?.file).toBe(join(cwd, 'content/images/missing.og.png'));
  });
});

function makeConfig(): NectarConfig {
  return {
    content: {
      assets_dir: 'content/images',
    },
  } as unknown as NectarConfig;
}

function makeContent(post: Partial<Post>): ContentGraph {
  return {
    posts: [
      {
        slug: 'post',
        feature_image: undefined,
        og_image: undefined,
        twitter_image: undefined,
        ...post,
      },
    ],
    pages: [],
    authors: [],
    tags: [],
    site: {},
  } as unknown as ContentGraph;
}
