import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFrontmatterSchemas } from '~/cli/check-frontmatter.ts';
import type { NectarConfig } from '~/config/schema.ts';

function fakeConfig(): NectarConfig {
  return {
    content: {
      posts_dir: 'content/posts',
      pages_dir: 'content/pages',
      authors_dir: 'content/authors',
      tags_dir: 'content/tags',
    },
  } as unknown as NectarConfig;
}

describe('checkFrontmatterSchemas', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test('reports missing required title as an error', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-cfs-')));
    await Bun.write(
      join(dir, 'content/posts/no-title.md'),
      ['---', 'slug: no-title', '---', 'body'].join('\n'),
    );
    const issues = await checkFrontmatterSchemas({ cwd: dir, config: fakeConfig() });
    const titleIssue = issues.find((i) => i.field === 'title');
    expect(titleIssue).toBeDefined();
    expect(titleIssue?.severity).toBe('error');
    expect(titleIssue?.code).toBe('frontmatter/required');
    expect(titleIssue?.line).toBe(1);
  });

  test('reports invalid status enum value', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-cfs-')));
    await Bun.write(
      join(dir, 'content/posts/bad-status.md'),
      ['---', 'title: Bad', 'status: weird', '---', 'body'].join('\n'),
    );
    const issues = await checkFrontmatterSchemas({ cwd: dir, config: fakeConfig() });
    const statusIssue = issues.find((i) => i.field === 'status');
    expect(statusIssue).toBeDefined();
    expect(statusIssue?.severity).toBe('error');
    expect(statusIssue?.code).toBe('frontmatter/enum');
  });

  test('warns on non-kebab slug', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-cfs-')));
    await Bun.write(
      join(dir, 'content/posts/p.md'),
      ['---', 'title: P', 'slug: WithCaps', '---', 'body'].join('\n'),
    );
    const issues = await checkFrontmatterSchemas({ cwd: dir, config: fakeConfig() });
    const slugIssue = issues.find((i) => i.field === 'slug');
    expect(slugIssue).toBeDefined();
    expect(slugIssue?.severity).toBe('warning');
  });

  test('accepts a clean post', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-cfs-')));
    await Bun.write(
      join(dir, 'content/posts/ok.md'),
      [
        '---',
        'title: Good post',
        'slug: good-post',
        'date: "2026-01-01"',
        'status: published',
        '---',
        'body',
      ].join('\n'),
    );
    const issues = await checkFrontmatterSchemas({ cwd: dir, config: fakeConfig() });
    expect(issues).toEqual([]);
  });

  test('returns empty array when content/posts is missing', async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'nectar-cfs-')));
    const issues = await checkFrontmatterSchemas({ cwd: dir, config: fakeConfig() });
    expect(issues).toEqual([]);
  });
});
