import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerContentHelpers } from '~/render/helpers/content.ts';

function makeEngine(): NectarEngine {
  const hb = Handlebars.create();
  const engine = { hb } as unknown as NectarEngine;
  registerContentHelpers(engine);
  return engine;
}

function render(
  engine: NectarEngine,
  ctx: Record<string, unknown>,
  data: Record<string, unknown>,
): string {
  const tpl = engine.hb.compile('{{meta_description}}');
  return tpl(ctx, { data });
}

describe('meta_description helper', () => {
  test('post route uses meta_description, then excerpt, then site.description', () => {
    const engine = makeEngine();
    const site = { description: 'Site default' };
    const route = { kind: 'post' };

    expect(render(engine, { meta_description: 'Post meta', excerpt: 'X' }, { route, site })).toBe(
      'Post meta',
    );
    expect(render(engine, { excerpt: 'Post excerpt' }, { route, site })).toBe('Post excerpt');
    expect(render(engine, {}, { route, site })).toBe('Site default');
  });

  test('tag route falls back to tag.description, not site.description', () => {
    const engine = makeEngine();
    const site = { description: 'Site default' };
    const route = { kind: 'tag' };

    expect(
      render(
        engine,
        { tag: { meta_description: 'Tag meta', description: 'Tag desc' } },
        { route, site },
      ),
    ).toBe('Tag meta');
    expect(render(engine, { tag: { description: 'Tag desc' } }, { route, site })).toBe('Tag desc');
    expect(render(engine, { tag: {} }, { route, site })).toBe('Site default');
  });

  test('author route falls back to author.bio, not site.description', () => {
    const engine = makeEngine();
    const site = { description: 'Site default' };
    const route = { kind: 'author' };

    expect(
      render(
        engine,
        { author: { meta_description: 'Author meta', bio: 'Author bio' } },
        { route, site },
      ),
    ).toBe('Author meta');
    expect(render(engine, { author: { bio: 'Author bio' } }, { route, site })).toBe('Author bio');
    expect(render(engine, { author: {} }, { route, site })).toBe('Site default');
  });

  test('returns empty string when site description is missing', () => {
    const engine = makeEngine();
    expect(render(engine, {}, { route: { kind: 'tag' }, site: {} })).toBe('');
    expect(render(engine, {}, { route: { kind: 'author' }, site: {} })).toBe('');
    expect(render(engine, {}, { route: { kind: 'post' }, site: {} })).toBe('');
  });
});
