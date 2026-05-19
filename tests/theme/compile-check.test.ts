import { describe, expect, test } from 'bun:test';
import { compileThemeTemplates } from '~/theme/compile-check.ts';
import type { ThemeBundle } from '~/theme/types.ts';

function makeTheme(overrides: Partial<ThemeBundle>): ThemeBundle {
  return {
    name: 'fixture',
    rootDir: '/tmp/themes/fixture',
    templates: {},
    partials: {},
    pkg: {
      name: 'fixture',
      version: '0.0.0',
      posts_per_page: 5,
      image_sizes: {},
      card_assets: false,
      custom: {},
      customDefaults: {},
    },
    locales: {},
    assets: new Map(),
    ...overrides,
  };
}

describe('compileThemeTemplates', () => {
  test('returns no issues for well-formed templates and partials', () => {
    const theme = makeTheme({
      templates: {
        index: '{{!< default}}<h1>{{title}}</h1>{{#foreach posts}}<p>{{title}}</p>{{/foreach}}',
        'layouts/default': '<!doctype html><body>{{{body}}}</body>',
      },
      partials: {
        header: '<header>{{@site.title}}</header>',
        'card/post': '<article>{{title}}</article>',
      },
    });

    expect(compileThemeTemplates(theme)).toEqual([]);
  });

  test('reports the file path and parse error for a malformed template', () => {
    const theme = makeTheme({
      templates: {
        index: '{{#if foo}}<p>unclosed',
      },
    });

    const issues = compileThemeTemplates(theme);
    expect(issues).toHaveLength(1);
    const issue = issues[0];
    if (!issue) throw new Error('expected issue');
    expect(issue.kind).toBe('template');
    expect(issue.name).toBe('index');
    expect(issue.file).toBe('/tmp/themes/fixture/index.hbs');
    expect(issue.message).toMatch(/Parse error/);
  });

  test('reports nested partial paths under partials/', () => {
    const theme = makeTheme({
      partials: {
        'card/post': '{{#each posts}}{{title}}',
      },
    });

    const issues = compileThemeTemplates(theme);
    expect(issues).toHaveLength(1);
    const issue = issues[0];
    if (!issue) throw new Error('expected issue');
    expect(issue.kind).toBe('partial');
    expect(issue.name).toBe('card/post');
    expect(issue.file).toBe('/tmp/themes/fixture/partials/card/post.hbs');
  });

  test('collects multiple issues across templates and partials', () => {
    const theme = makeTheme({
      templates: {
        index: '{{#if a}}',
        post: '<h1>{{title}}</h1>',
      },
      partials: {
        header: '{{#each',
      },
    });

    const issues = compileThemeTemplates(theme);
    expect(issues).toHaveLength(2);
    const kinds = issues.map((i) => `${i.kind}:${i.name}`).sort();
    expect(kinds).toEqual(['partial:header', 'template:index']);
  });
});
