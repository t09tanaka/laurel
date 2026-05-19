import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Handlebars from 'handlebars';
import type { NectarEngine } from '~/render/engine.ts';
import { registerImageDimensionHelpers } from '~/render/helpers/image-dimensions.ts';

function makeAssetsCwd(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'nectar-image-dims-'));
  mkdirSync(join(cwd, 'content/images'), { recursive: true });
  return cwd;
}

function writeSvg(cwd: string, name: string, width: number, height: number): void {
  const file = join(cwd, 'content/images', name);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`,
    'utf8',
  );
}

function makeEngine(opts: { cwd?: string } = {}): NectarEngine {
  const hb = Handlebars.create();
  return {
    hb,
    cwd: opts.cwd,
    config: {
      content: { assets_dir: 'content/images' },
    } as unknown as NectarEngine['config'],
    content: {} as unknown as NectarEngine['content'],
    theme: {} as unknown as NectarEngine['theme'],
    templates: {},
    layouts: {},
    sortedCache: new Map(),
    render() {
      throw new Error('not used');
    },
  };
}

describe('image_dimensions helper', () => {
  test('injects width/height for a feature_image that resolves to a local file', () => {
    const cwd = makeAssetsCwd();
    writeSvg(cwd, 'cover.svg', 1200, 630);
    const engine = makeEngine({ cwd });
    registerImageDimensionHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#image_dimensions}}{{feature_image_width}}x{{feature_image_height}}{{/image_dimensions}}',
    );
    expect(tpl({ feature_image: '/content/images/cover.svg' })).toBe('1200x630');
  });

  test('does not overwrite pre-populated width/height on the context', () => {
    const cwd = makeAssetsCwd();
    writeSvg(cwd, 'cover.svg', 1200, 630);
    const engine = makeEngine({ cwd });
    registerImageDimensionHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#image_dimensions}}{{feature_image_width}}x{{feature_image_height}}{{/image_dimensions}}',
    );
    expect(
      tpl({
        feature_image: '/content/images/cover.svg',
        feature_image_width: 99,
        feature_image_height: 42,
      }),
    ).toBe('99x42');
  });

  test('walks every Ghost image field on the context', () => {
    const cwd = makeAssetsCwd();
    writeSvg(cwd, 'og.svg', 1200, 630);
    writeSvg(cwd, 'twitter.svg', 800, 418);
    writeSvg(cwd, 'profile.svg', 256, 256);
    const engine = makeEngine({ cwd });
    registerImageDimensionHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#image_dimensions}}{{og_image_width}}x{{og_image_height}}|{{twitter_image_width}}x{{twitter_image_height}}|{{profile_image_width}}x{{profile_image_height}}{{/image_dimensions}}',
    );
    expect(
      tpl({
        og_image: '/content/images/og.svg',
        twitter_image: '/content/images/twitter.svg',
        profile_image: '/content/images/profile.svg',
      }),
    ).toBe('1200x630|800x418|256x256');
  });

  test('emits no dimensions for remote URLs', () => {
    const cwd = makeAssetsCwd();
    const engine = makeEngine({ cwd });
    registerImageDimensionHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#image_dimensions}}[{{feature_image_width}}x{{feature_image_height}}]{{/image_dimensions}}',
    );
    expect(tpl({ feature_image: 'https://cdn.example.com/cover.png' })).toBe('[x]');
  });

  test('emits no dimensions for protocol-relative URLs', () => {
    const cwd = makeAssetsCwd();
    const engine = makeEngine({ cwd });
    registerImageDimensionHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#image_dimensions}}[{{feature_image_width}}]{{/image_dimensions}}',
    );
    expect(tpl({ feature_image: '//cdn.example.com/cover.png' })).toBe('[]');
  });

  test('rejects path traversal under /content/images/', () => {
    const cwd = makeAssetsCwd();
    writeSvg(cwd, 'cover.svg', 1200, 630);
    const engine = makeEngine({ cwd });
    registerImageDimensionHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#image_dimensions}}[{{feature_image_width}}]{{/image_dimensions}}',
    );
    expect(tpl({ feature_image: '/content/images/../../etc/passwd' })).toBe('[]');
  });

  test('survives a missing file without throwing', () => {
    const cwd = makeAssetsCwd();
    const engine = makeEngine({ cwd });
    registerImageDimensionHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#image_dimensions}}[{{feature_image_width}}]{{/image_dimensions}}',
    );
    expect(tpl({ feature_image: '/content/images/missing.png' })).toBe('[]');
  });

  test('strips query strings before resolving the file', () => {
    const cwd = makeAssetsCwd();
    writeSvg(cwd, 'cover.svg', 320, 240);
    const engine = makeEngine({ cwd });
    registerImageDimensionHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#image_dimensions}}{{feature_image_width}}x{{feature_image_height}}{{/image_dimensions}}',
    );
    expect(tpl({ feature_image: '/content/images/cover.svg?v=1' })).toBe('320x240');
  });

  test('renders the block even when no image fields are present', () => {
    const cwd = makeAssetsCwd();
    const engine = makeEngine({ cwd });
    registerImageDimensionHelpers(engine);
    const tpl = engine.hb.compile('{{#image_dimensions}}body|{{title}}{{/image_dimensions}}');
    expect(tpl({ title: 'hello' })).toBe('body|hello');
  });

  test('no-ops without engine.cwd (unit-test engine)', () => {
    const engine = makeEngine();
    registerImageDimensionHelpers(engine);
    const tpl = engine.hb.compile(
      '{{#image_dimensions}}[{{feature_image_width}}]{{/image_dimensions}}',
    );
    expect(tpl({ feature_image: '/content/images/cover.svg' })).toBe('[]');
  });
});
