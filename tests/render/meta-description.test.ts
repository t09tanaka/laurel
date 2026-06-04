import { describe, expect, test } from 'bun:test';
import Handlebars from 'handlebars';
import type { LaurelEngine } from '~/render/engine.ts';
import { registerContentHelpers } from '~/render/helpers/content.ts';

function makeEngine(): LaurelEngine {
  const hb = Handlebars.create();
  const engine = { hb } as unknown as LaurelEngine;
  registerContentHelpers(engine);
  return engine;
}

function render(
  engine: LaurelEngine,
  ctx: Record<string, unknown>,
  data: Record<string, unknown>,
): string {
  const tpl = engine.hb.compile('{{meta_description}}');
  return tpl(ctx, { data });
}

describe('meta_description helper', () => {
  test('post route walks meta_description → custom_excerpt → og_description → excerpt → site.description → plaintext', () => {
    const engine = makeEngine();
    const site = { description: 'Site default' };
    const route = { kind: 'post' };

    expect(
      render(
        engine,
        {
          meta_description: 'Post meta',
          custom_excerpt: 'X',
          og_description: 'X',
          excerpt: 'X',
          plaintext: 'X.',
        },
        { route, site },
      ),
    ).toBe('Post meta');
    expect(
      render(
        engine,
        { custom_excerpt: 'Custom', og_description: 'X', excerpt: 'X', plaintext: 'X.' },
        { route, site },
      ),
    ).toBe('Custom');
    expect(
      render(engine, { og_description: 'OG desc', excerpt: 'X', plaintext: 'X.' }, { route, site }),
    ).toBe('OG desc');
    expect(render(engine, { excerpt: 'Post excerpt', plaintext: 'X.' }, { route, site })).toBe(
      'Post excerpt',
    );
    expect(render(engine, { plaintext: 'Hello world.' }, { route, site })).toBe('Site default');
    expect(render(engine, { plaintext: 'Hello world. More.' }, { route, site: {} })).toBe(
      'Hello world.',
    );
    expect(render(engine, {}, { route, site })).toBe('Site default');
  });

  test('post route falls back to first sentence of plaintext when nothing else is set', () => {
    const engine = makeEngine();
    const route = { kind: 'post' };
    const site = {};

    expect(
      render(engine, { plaintext: 'First sentence here. Second sentence here.' }, { route, site }),
    ).toBe('First sentence here.');
    expect(render(engine, { plaintext: 'Question mark? Then more.' }, { route, site })).toBe(
      'Question mark?',
    );
    expect(render(engine, { plaintext: 'Exclaim! More.' }, { route, site })).toBe('Exclaim!');
    expect(render(engine, { plaintext: '   \n  \t  ' }, { route, site })).toBe('');
    expect(render(engine, { plaintext: 'No terminator here just words' }, { route, site })).toBe(
      'No terminator here just words',
    );
  });

  test('non-public post route does not expose generated excerpt or plaintext fallback', () => {
    const engine = makeEngine();
    const route = { kind: 'post' };
    const site = {};

    expect(
      render(
        engine,
        {
          visibility: 'members',
          custom_excerpt: 'Public teaser',
          excerpt: 'Paid generated excerpt',
          plaintext: 'Paid body text.',
        },
        { route, site },
      ),
    ).toBe('Public teaser');
    expect(
      render(
        engine,
        {
          visibility: 'paid',
          excerpt: 'Paid generated excerpt',
          plaintext: 'Paid body text.',
        },
        { route, site },
      ),
    ).toBe('');
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
