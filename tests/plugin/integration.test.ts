import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '~/build/pipeline.ts';

const createdRoots: string[] = [];

afterAll(async () => {
  await Promise.all(createdRoots.map((p) => rm(p, { recursive: true, force: true })));
});

// Prepend top-level TOML keys (like `plugins = [...]`) before the existing
// sections so they don't accidentally become children of the previously
// opened section header.
async function prependTomlTopLevel(cwd: string, snippet: string): Promise<void> {
  const tomlPath = join(cwd, 'nectar.toml');
  const existing = readFileSync(tomlPath, 'utf8');
  await writeFile(tomlPath, `${snippet}\n${existing}`, 'utf8');
}

async function makeSite(extraConfig = ''): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nectar-plugin-int-'));
  createdRoots.push(dir);
  await mkdir(join(dir, 'content/posts'), { recursive: true });
  await mkdir(join(dir, 'content/pages'), { recursive: true });
  await mkdir(join(dir, 'content/authors'), { recursive: true });

  await writeFile(
    join(dir, 'nectar.toml'),
    [
      '[site]',
      'title = "Plugin Site"',
      'url = "https://plugins.test"',
      '',
      '[theme]',
      'dir = "themes"',
      'name = "source"',
      '',
      '[components.rss]',
      'enabled = false',
      '',
      '[components.sitemap]',
      'enabled = false',
      '',
      extraConfig,
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(dir, 'content/posts/hello.md'),
    `---
title: "Hello Plugin"
date: 2026-01-01T00:00:00Z
---

A callout: :::callout important content :::
`,
    'utf8',
  );

  await writeFile(join(dir, 'content/authors/casper.md'), '---\nname: Casper\n---\n', 'utf8');

  const themeSrc = join(process.cwd(), 'example/themes/source');
  await cp(themeSrc, join(dir, 'themes/source'), { recursive: true });

  return dir;
}

describe('plugin pipeline integration', () => {
  test('invokes every lifecycle hook on a registered plugin', async () => {
    const cwd = await makeSite();
    const order: string[] = [];
    const pluginPath = join(cwd, 'lifecycle-plugin.mjs');
    await writeFile(
      pluginPath,
      `
const order = globalThis.__nectar_plugin_test_order ??= [];
export default {
  name: 'lifecycle',
  beforeBuild() { order.push('beforeBuild'); },
  afterContentLoad() { order.push('afterContentLoad'); },
  beforeRender(_ctx, route) { order.push('beforeRender:' + route.url); },
  afterRender(_ctx, _route, html) { order.push('afterRender'); return html; },
  afterEmit() { order.push('afterEmit'); },
};
`,
      'utf8',
    );
    // Inject the spec via direct config patch.
    await prependTomlTopLevel(cwd, 'plugins = ["./lifecycle-plugin.mjs"]');

    // Seed the shared order slot before the build so we can read it back.
    (globalThis as unknown as { __nectar_plugin_test_order: string[] }).__nectar_plugin_test_order =
      order;

    await build({ cwd });
    expect(order).toContain('beforeBuild');
    expect(order).toContain('afterContentLoad');
    expect(order.some((s) => s.startsWith('beforeRender:'))).toBe(true);
    expect(order).toContain('afterRender');
    expect(order).toContain('afterEmit');
    // beforeBuild must precede afterContentLoad, which precedes any render.
    expect(order.indexOf('beforeBuild')).toBeLessThan(order.indexOf('afterContentLoad'));
    expect(order.indexOf('afterContentLoad')).toBeLessThan(
      order.findIndex((s) => s.startsWith('beforeRender:')),
    );
    expect(order.findIndex((s) => s.startsWith('beforeRender:'))).toBeLessThan(
      order.indexOf('afterRender'),
    );
    expect(order.indexOf('afterRender')).toBeLessThan(order.indexOf('afterEmit'));
  });

  test('registerHelper exposes a custom Handlebars helper to templates', async () => {
    const cwd = await makeSite();
    const pluginPath = join(cwd, 'helper-plugin.mjs');
    await writeFile(
      pluginPath,
      `
export default {
  name: 'helper',
  beforeBuild(ctx) {
    ctx.engine.registerHelper('stripe_button', () => 'STRIPE_BUTTON_OK');
  },
};
`,
      'utf8',
    );
    // Inject a usage of the custom helper into the layout via a tiny custom page.
    await writeFile(
      join(cwd, 'content/pages/custom.md'),
      `---\ntitle: "custom"\n---\nHelper output: {{stripe_button}}\n`,
      'utf8',
    );
    await prependTomlTopLevel(cwd, 'plugins = ["./helper-plugin.mjs"]');
    // Markdown bodies aren't run through Handlebars, but the post layout is.
    // Inject the helper invocation into the default partial instead.
    // Easier: render through the theme by checking that the helper is
    // registered on engine.hb after build (assert via after-build inspection).
    // Approach used here: ship a tiny custom theme partial wired via plugin.
    const stripePartialPath = join(cwd, 'themes/source/partials/stripe-check.hbs');
    await writeFile(stripePartialPath, '<span>HELPER:{{stripe_button}}</span>', 'utf8');
    // Reference the partial from the default layout footer.
    const defaultLayoutPath = join(cwd, 'themes/source/default.hbs');
    const defaultLayout = readFileSync(defaultLayoutPath, 'utf8');
    await writeFile(
      defaultLayoutPath,
      defaultLayout.replace('</body>', '{{> "stripe-check"}}</body>'),
      'utf8',
    );

    await build({ cwd });
    const home = readFileSync(join(cwd, 'dist/index.html'), 'utf8');
    expect(home).toContain('HELPER:STRIPE_BUTTON_OK');
  });

  test('Plugin.routes() injects an extra route into the build', async () => {
    const cwd = await makeSite();
    const pluginPath = join(cwd, 'routes-plugin.mjs');
    await writeFile(
      pluginPath,
      `
export default {
  name: 'extra-routes',
  routes() {
    return [{
      kind: 'custom',
      url: '/changelog/',
      outputPath: 'changelog/index.html',
      template: 'home',
      data: { posts: [] },
      meta: {
        title: 'Changelog',
        description: '',
        canonical: 'https://plugins.test/changelog/',
        image: undefined,
      },
    }];
  },
};
`,
      'utf8',
    );
    await prependTomlTopLevel(cwd, 'plugins = ["./routes-plugin.mjs"]');

    await build({ cwd });
    expect(existsSync(join(cwd, 'dist/changelog/index.html'))).toBe(true);
  });

  test('transformMarkdown rewrites :::callout directives to HTML divs', async () => {
    const cwd = await makeSite();
    const pluginPath = join(cwd, 'callout-plugin.mjs');
    await writeFile(
      pluginPath,
      `
export default {
  name: 'callout',
  transformMarkdown(input) {
    return input.replace(/:::callout ([^:]+?) :::/g, '<div class="callout">$1</div>');
  },
};
`,
      'utf8',
    );
    await prependTomlTopLevel(cwd, 'plugins = ["./callout-plugin.mjs"]');

    await build({ cwd });
    const helloPath = join(cwd, 'dist/hello/index.html');
    expect(existsSync(helloPath)).toBe(true);
    const helloHtml = readFileSync(helloPath, 'utf8');
    expect(helloHtml).toContain('<div class="callout">');
    // The marker directive must be gone from the output.
    expect(helloHtml).not.toContain(':::callout');
  });

  test('a plugin that fails to load surfaces a warning but does not break the build', async () => {
    const cwd = await makeSite();
    await prependTomlTopLevel(cwd, 'plugins = ["./does-not-exist.mjs"]');

    const summary = await build({ cwd });
    expect(summary.routeCount).toBeGreaterThan(0);
    expect(summary.warningCount).toBeGreaterThan(0);
  });

  test('afterRender chain composes html through multiple plugins', async () => {
    const cwd = await makeSite();
    await writeFile(
      join(cwd, 'p-a.mjs'),
      `export default { name: 'a', afterRender(_ctx, _r, html) { return html + '<!--A-->'; } };`,
      'utf8',
    );
    await writeFile(
      join(cwd, 'p-b.mjs'),
      `export default { name: 'b', afterRender(_ctx, _r, html) { return html + '<!--B-->'; } };`,
      'utf8',
    );
    await prependTomlTopLevel(cwd, 'plugins = ["./p-a.mjs", "./p-b.mjs"]');

    await build({ cwd });
    const home = readFileSync(join(cwd, 'dist/index.html'), 'utf8');
    expect(home).toContain('<!--A-->');
    expect(home).toContain('<!--B-->');
    // B runs after A, so the B marker should sit after the A marker.
    expect(home.indexOf('<!--A-->')).toBeLessThan(home.indexOf('<!--B-->'));
  });

  test('inline helpers loaded via [components.helpers].paths register on the engine', async () => {
    const cwd = await makeSite();
    await writeFile(
      join(cwd, 'helpers.mjs'),
      'export function shout(value) { return String(value).toUpperCase(); }\n',
      'utf8',
    );
    const stripePartialPath = join(cwd, 'themes/source/partials/shout-check.hbs');
    await writeFile(stripePartialPath, '<span>SHOUT:{{shout "hello"}}</span>', 'utf8');
    const defaultLayoutPath = join(cwd, 'themes/source/default.hbs');
    const defaultLayout = readFileSync(defaultLayoutPath, 'utf8');
    await writeFile(
      defaultLayoutPath,
      defaultLayout.replace('</body>', '{{> "shout-check"}}</body>'),
      'utf8',
    );
    const tomlPath = join(cwd, 'nectar.toml');
    const existing = readFileSync(tomlPath, 'utf8');
    await writeFile(
      tomlPath,
      `${existing}\n[components.helpers]\npaths = ["./helpers.mjs"]\n`,
      'utf8',
    );

    await build({ cwd });
    const home = readFileSync(join(cwd, 'dist/index.html'), 'utf8');
    expect(home).toContain('SHOUT:HELLO');
  });
});
