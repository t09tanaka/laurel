import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadThemePackage } from '~/theme/pkg.ts';

async function makeThemeDir(pkg: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nectar-pkg-'));
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg), 'utf8');
  return dir;
}

describe('loadThemePackage schema validation', () => {
  test('returns default package when no package.json exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-pkg-empty-'));
    const pkg = await loadThemePackage(dir);
    expect(pkg.name).toBe('theme');
    expect(pkg.custom).toEqual({});
    expect(pkg.customDefaults).toEqual({});
  });

  test('throws on malformed JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-pkg-bad-'));
    await writeFile(join(dir, 'package.json'), '{ not json', 'utf8');
    await expect(loadThemePackage(dir)).rejects.toThrow(/invalid theme package.json/);
  });

  test('drops a custom setting whose type is not whitelisted', async () => {
    const dir = await makeThemeDir({
      name: 'evil',
      config: {
        custom: {
          good: { type: 'text', default: 'ok' },
          bad: { type: 'eval', default: 'whatever' },
        },
      },
    });
    const pkg = await loadThemePackage(dir);
    expect(Object.keys(pkg.custom)).toEqual(['good']);
    expect(pkg.customDefaults).toEqual({ good: 'ok' });
  });

  test('drops a custom setting whose value is not an object', async () => {
    const dir = await makeThemeDir({
      config: {
        custom: {
          weird: 'just a string',
          legit: { type: 'boolean', default: true },
        },
      },
    });
    const pkg = await loadThemePackage(dir);
    expect(Object.keys(pkg.custom)).toEqual(['legit']);
    expect(pkg.customDefaults).toEqual({ legit: true });
  });

  test('coerces a non-string default on a text setting to empty string', async () => {
    const dir = await makeThemeDir({
      config: {
        custom: {
          heading: { type: 'text', default: { not: 'a string' } },
        },
      },
    });
    const pkg = await loadThemePackage(dir);
    expect(pkg.customDefaults.heading).toBe('');
    expect((pkg.custom.heading as { default?: unknown }).default).toBe('');
  });

  test('keeps a string default on a text setting verbatim (HTML-escape is the next layer of defense)', async () => {
    const dir = await makeThemeDir({
      config: {
        custom: {
          heading: { type: 'text', default: '</script><script>alert(1)</script>' },
        },
      },
    });
    const pkg = await loadThemePackage(dir);
    // We trust Handlebars HTML escaping for text-typed customs in HTML
    // contexts; the schema's job is to enforce the *type*, not the *content*.
    expect(pkg.customDefaults.heading).toBe('</script><script>alert(1)</script>');
  });

  test('coerces a non-string default on an image setting to empty string', async () => {
    const dir = await makeThemeDir({
      config: {
        custom: {
          hero: { type: 'image', default: true },
        },
      },
    });
    const pkg = await loadThemePackage(dir);
    expect(pkg.customDefaults.hero).toBe('');
  });

  test('coerces a non-boolean default on a boolean setting to false', async () => {
    const dir = await makeThemeDir({
      config: {
        custom: {
          show_author: { type: 'boolean', default: 'yes' },
        },
      },
    });
    const pkg = await loadThemePackage(dir);
    expect(pkg.customDefaults.show_author).toBe(false);
  });

  test('falls back to the first option when a select default is not in the options list', async () => {
    const dir = await makeThemeDir({
      config: {
        custom: {
          layout: {
            type: 'select',
            options: ['Logo on the left', 'Logo in the middle'],
            default: 'Comic Sans',
          },
        },
      },
    });
    const pkg = await loadThemePackage(dir);
    expect(pkg.customDefaults.layout).toBe('Logo on the left');
  });

  test('passes through a select default that matches one of the options', async () => {
    const dir = await makeThemeDir({
      config: {
        custom: {
          layout: {
            type: 'select',
            options: ['a', 'b', 'c'],
            default: 'b',
          },
        },
      },
    });
    const pkg = await loadThemePackage(dir);
    expect(pkg.customDefaults.layout).toBe('b');
  });

  test('preserves package.json select option strings for strict match comparisons', async () => {
    const dir = await makeThemeDir({
      config: {
        custom: {
          theme_edition: {
            type: 'select',
            options: ['Minimal', 'Magazine'],
            default: 'Minimal',
          },
          feed_layout: {
            type: 'select',
            options: ['Classic', 'Right thumbnail'],
            default: 'Right thumbnail',
          },
        },
      },
    });

    const pkg = await loadThemePackage(dir);
    expect(pkg.custom.theme_edition?.options).toEqual(['Minimal', 'Magazine']);
    expect(pkg.custom.feed_layout?.options).toEqual(['Classic', 'Right thumbnail']);
    expect(pkg.customDefaults.theme_edition).toBe('Minimal');
    expect(pkg.customDefaults.feed_layout).toBe('Right thumbnail');
  });

  test('preserves Solo header section layout default for strict match comparisons', async () => {
    const dir = await makeThemeDir({
      name: 'solo',
      config: {
        custom: {
          header_section_layout: {
            type: 'select',
            options: ['Typographic profile', 'Side by side'],
            default: 'Typographic profile',
          },
        },
      },
    });

    const pkg = await loadThemePackage(dir);
    expect(pkg.custom.header_section_layout?.options).toEqual([
      'Typographic profile',
      'Side by side',
    ]);
    expect(pkg.customDefaults.header_section_layout).toBe('Typographic profile');
    expect(pkg.custom.header_section_layout?.default).toBe('Typographic profile');
  });

  test('defaults Bulletin feature image width to Wide for post header layout classes', async () => {
    const dir = await makeThemeDir({
      name: 'bulletin',
      config: {
        custom: {
          feature_image_width: {
            type: 'select',
            options: ['Full', 'Wide', 'Small'],
            default: 'Small',
            group: 'post',
          },
        },
      },
    });
    const pkg = await loadThemePackage(dir);
    expect(pkg.customDefaults.feature_image_width).toBe('Wide');
    expect(pkg.custom.feature_image_width?.default).toBe('Wide');
  });

  test('keeps a color default as-is at load time (sanitization happens at render time)', async () => {
    const dir = await makeThemeDir({
      config: {
        custom: {
          site_background_color: { type: 'color', default: '#ffffff' },
        },
      },
    });
    const pkg = await loadThemePackage(dir);
    expect(pkg.customDefaults.site_background_color).toBe('#ffffff');
  });

  test('drops invalid select options (non-string) but keeps valid ones', async () => {
    const dir = await makeThemeDir({
      config: {
        custom: {
          layout: {
            type: 'select',
            options: ['a', 42, null, 'b'],
            default: 'a',
          },
        },
      },
    });
    const pkg = await loadThemePackage(dir);
    expect(pkg.custom.layout?.options).toEqual(['a', 'b']);
  });

  test('falls back to defaults when the root package.json is not a JSON object', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nectar-pkg-arr-'));
    await writeFile(join(dir, 'package.json'), '"a string"', 'utf8');
    const pkg = await loadThemePackage(dir);
    expect(pkg.name).toBe('theme');
    expect(pkg.custom).toEqual({});
  });
});
