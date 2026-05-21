import { describe, expect, test } from 'bun:test';
import { checkThemeTemplates } from '~/cli/check-templates.ts';
import type { ContentGraph } from '~/content/model.ts';
import type { ThemeBundle } from '~/theme/types.ts';

function emptyContent(): ContentGraph {
  return {
    posts: [],
    pages: [],
    tags: [],
    authors: [],
    site: {} as ContentGraph['site'],
    indices: { posts: new Map(), pages: new Map() },
  } as unknown as ContentGraph & {
    indices: { posts: Map<string, unknown>; pages: Map<string, unknown> };
  };
}

function theme(templates: Record<string, string>): ThemeBundle {
  return {
    name: 't',
    rootDir: '/',
    templates,
    partials: {},
    pkg: { name: 't', version: '0.0.0' } as ThemeBundle['pkg'],
    locales: {},
    assets: {} as ThemeBundle['assets'],
  };
}

describe('checkThemeTemplates', () => {
  test('flags missing required index as error', () => {
    const issues = checkThemeTemplates(theme({ default: '' }), emptyContent());
    const idx = issues.find((i) => i.template === 'index');
    expect(idx?.severity).toBe('error');
    expect(idx?.reason).toBe('missing-required');
  });

  test('flags missing required default as error', () => {
    const issues = checkThemeTemplates(theme({ index: '' }), emptyContent());
    const def = issues.find((i) => i.template === 'default');
    expect(def?.severity).toBe('error');
    expect(def?.reason).toBe('missing-required');
  });

  test('does not warn about post.hbs when there are no posts', () => {
    const issues = checkThemeTemplates(theme({ index: '', default: '' }), emptyContent());
    expect(issues.find((i) => i.template === 'post')).toBeUndefined();
  });

  test('warns about missing optional templates when matching content exists', () => {
    const content = emptyContent();
    content.posts = [{ slug: 'p' } as ContentGraph['posts'][number]];
    content.tags = [{ slug: 't' } as ContentGraph['tags'][number]];
    const issues = checkThemeTemplates(theme({ index: '', default: '' }), content);
    const post = issues.find((i) => i.template === 'post');
    const tag = issues.find((i) => i.template === 'tag');
    expect(post?.severity).toBe('warning');
    expect(tag?.severity).toBe('warning');
  });

  test('no issues when all expected templates are present', () => {
    const content = emptyContent();
    content.posts = [{ slug: 'p' } as ContentGraph['posts'][number]];
    const issues = checkThemeTemplates(
      theme({ index: '', default: '', post: '', page: '' }),
      content,
    );
    expect(issues).toEqual([]);
  });
});
