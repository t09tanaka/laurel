# 5. Write your first plugin

**Goal:** understand Nectar's extension model — what's wired today, what's
typed but not yet loaded — and add a concrete extension to your site.

---

## How extension works in Nectar today

> **Status note.** The plugin runtime is wired: list modules under
> `plugins = […]` in `nectar.toml` and Nectar will load and invoke them at
> the start of every build. Hook coverage is the full `Plugin` shape
> exported from `nectar/plugin` (`beforeBuild`, `afterContentLoad`,
> `beforeRender`, `afterRender`, `afterEmit`, `routes`, `transformMarkdown`).
> The legacy `NectarPlugin { setup }` shape still works as an alias so
> older modules keep loading without changes. Set
> `plugin_auto_detect = true` to also pick up packages named
> `nectar-plugin-*` (or `@scope/nectar-plugin-*`) from `node_modules/`.

The five extension surfaces, ranked by how much code you touch:

| Surface                 | Code change | Use it for                                       |
| ----------------------- | ----------- | ------------------------------------------------ |
| `[theme.custom]`        | None        | Theme-specific switches (header style, fonts)    |
| `[components.*]`        | None        | Toggle RSS / sitemap / OG images / Content API  |
| `codeinjection_*`       | None        | Per-post `<head>` / `<body>` snippets            |
| Custom helper           | Small fork  | A new `{{my_helper}}` for use in templates       |
| Plugin module           | Plugin file | Markdown transforms, extra routes, custom hooks  |

---

## Path A — Add a custom Handlebars helper

This is the most "plugin-like" thing you can do today. You'll add a
`{{word_count post}}` helper that themes can call. The pattern matches how
all built-in Ghost helpers are registered.

### Step 1 — Clone Nectar locally

The helper registration lives in `src/render/helpers/`. To add one you
fork Nectar, register your helper, and depend on your fork in your blog
project. (When the plugin runtime ships, this same code moves into a
standalone module — see "Future-proofing" below.)

```bash
git clone https://github.com/t09tanaka/nectar
cd nectar
bun install
```

### Step 2 — Write the helper

Create `src/render/helpers/word-count.ts`:

```ts
import type { NectarHelper } from '~/plugin.ts';

interface PostLike {
  html?: string;
  plaintext?: string;
}

export const wordCount: NectarHelper = function (this: unknown, post: unknown) {
  const p = (post ?? this) as PostLike;
  const text = p.plaintext ?? p.html?.replace(/<[^>]+>/g, '') ?? '';
  return text.trim().split(/\s+/).filter(Boolean).length;
};
```

### Step 3 — Register it with the engine

Open `src/render/engine.ts` (or wherever helpers are registered — search for
`registerHelper`). Add:

```ts
import { wordCount } from './helpers/word-count.ts';

// inside the helper registration block
hb.registerHelper('word_count', wordCount);
```

### Step 4 — Use it from a theme

```hbs
{{!-- themes/source/post.hbs --}}
<aside class="post-meta">
  {{word_count}} words · {{reading_time}}
</aside>
```

`{{word_count}}` reads the post from `this` context, just like
`{{reading_time}}`. Pass an explicit post if you need to:
`{{word_count @post}}`.

### Step 5 — Add a test and ship

Mirror the source path under `tests/`:

```ts
// tests/render/helpers/word-count.test.ts
import { describe, expect, test } from 'bun:test';
import { wordCount } from '~/render/helpers/word-count.ts';

describe('word_count helper', () => {
  test('counts words in plaintext', () => {
    expect(wordCount.call(null, { plaintext: 'one two three' })).toBe(3);
  });

  test('strips HTML before counting', () => {
    expect(wordCount.call(null, { html: '<p>one <em>two</em></p>' })).toBe(2);
  });

  test('reads from `this` when no arg given', () => {
    const ctx = { plaintext: 'four words right here' };
    expect(wordCount.call(ctx)).toBe(4);
  });
});
```

```bash
bun test tests/render/helpers/word-count.test.ts
bun run check
```

Open a PR or run your fork against your blog with a path dependency.

---

## Path B — Author a typed plugin module (forward-compat)

Write the module today against the published types; wire it up the moment
the runtime ships.

### The shape

From `nectar/types`:

```ts
export interface BuildContext {
  readonly cwd: string;
  readonly outputDir: string;
  readonly config: NectarConfig;
  readonly content: ContentGraph;
  readonly theme: ThemeBundle;
}

export interface NectarPlugin {
  readonly name: string;
  setup?: (ctx: BuildContext) => void | Promise<void>;
}

export type NectarHelper = (this: unknown, ...args: unknown[]) => unknown;
```

### A worked example: a build-time reading-list emitter

```ts
// plugins/reading-list.ts
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NectarPlugin } from 'nectar/types';

export const readingListPlugin: NectarPlugin = {
  name: 'reading-list',

  async setup(ctx) {
    const list = ctx.content.posts
      .filter((p) => !p.featured)
      .slice(0, 20)
      .map((p) => ({ title: p.title, url: p.url, date: p.published_at }));

    await writeFile(
      join(ctx.outputDir, 'reading-list.json'),
      JSON.stringify(list, null, 2),
    );
  },
};

export default readingListPlugin;
```

`bun add nectar` in your blog project, and the import path `nectar/types`
resolves to the published type definitions. The module type-checks today
and will plug into the runtime when loader support ships — at which point
you'll add to `nectar.toml`:

```toml
# Not yet wired; pre-stage the config when you author plugins today.
plugins = ["./plugins/reading-list.ts"]
```

Track loader status against the published types in
[`src/plugin.ts`](../../src/plugin.ts). The comment at the top of that
file is the source of truth.

---

## Path C — No-code extensions (use these first)

Before writing TypeScript, check whether the thing you want is already a
toggle.

### `[theme.custom]` — change a theme's behaviour by config

```toml
[theme.custom]
header_style = "Magazine"
show_post_metadata = true
enable_drop_caps_on_posts = true
```

These become `@custom.<key>` in templates. The valid keys are theme-specific;
for Source they're in `themes/source/package.json` under `config.custom`.

### `[components.*]` — turn optional features on/off

```toml
[components.rss]
enabled = true
items = 20

[components.sitemap]
enabled = true

[components.opengraph]
enabled = true

[components.content_api]
enabled = true              # emits dist/content/posts/<slug>.json etc.

[components.robots]
enabled = true
disallow = false            # true → `Disallow: /` (use for staging)
```

### `codeinjection_head` / `codeinjection_foot` — per-post snippets

```markdown
---
title: My analytics-tracked post
codeinjection_head: |
  <meta name="robots" content="noindex">
codeinjection_foot: |
  <script defer data-domain="example.com"
          src="https://plausible.io/js/script.js"></script>
---
```

`{{ghost_head}}` and `{{ghost_foot}}` in the theme emit these blocks. Source
already calls both.

---

## Path D — Markdown transform plugin (shortcodes / directives)

The `transformMarkdown` hook on the `Plugin` interface lets a plugin
rewrite the raw Markdown body of every post (or page) before
`renderMarkdown` parses it. This is the right surface for shortcodes,
custom directives, or any block-level rewrite that has to happen
*before* sanitisation — anything you'd do with a `marked`-extension or
remark-style plugin in another SSG.

The hook signature lives in `src/plugin/types.ts`:

```ts
transformMarkdown?: (
  input: string,
  ctx: { kind: 'post' | 'page'; path: string; frontmatter: Readonly<Record<string, unknown>> },
) => string | Promise<string>;
```

Hooks compose in registration order; each transform sees the previous
plugin's output. A throw is logged and the body falls through unchanged
so one bad plugin can't take the whole build down.

### Example — a `{{<callout type="warn">}}…{{</callout>}}` shortcode

```ts
// plugins/callout-shortcode.ts
import type { Plugin } from 'nectar/plugin';

// Match block-form shortcodes like:
//   {{<callout type="warn">}}
//   Body markdown here.
//   {{</callout>}}
const CALLOUT_RE =
  /\{\{<\s*callout(?:\s+type="(warn|info|success|danger)")?\s*>\}\}([\s\S]*?)\{\{<\s*\/callout\s*>\}\}/g;

const calloutPlugin: Plugin = {
  name: 'callout-shortcode',
  transformMarkdown(body) {
    return body.replace(CALLOUT_RE, (_match, type: string | undefined, inner: string) => {
      const variant = type ?? 'info';
      // Emit the Koenig callout-card HTML shape so existing kg-callout-card
      // CSS in the theme (Source, Casper, etc.) styles the result.
      // Blank lines around `inner` keep CommonMark parsing the body as
      // markdown, not as raw HTML.
      return [
        '',
        `<div class="kg-card kg-callout-card kg-callout-card-${variant}">`,
        '<div class="kg-callout-text">',
        '',
        inner.trim(),
        '',
        '</div>',
        '</div>',
        '',
      ].join('\n');
    });
  },
};

export default calloutPlugin;
```

Wire it from `nectar.toml`:

```toml
plugins = ["./plugins/callout-shortcode.ts"]
```

Use it in any post:

```markdown
---
title: My post
---

Intro paragraph.

{{<callout type="warn">}}
Heads up: this is a warning. **Bold text** still works.
{{</callout>}}

Outro.
```

After the next `bunx nectar build`, the rendered HTML contains a
`kg-callout-card kg-callout-card-warn` block your theme styles.

### Picking the right hook

| Goal                                              | Hook                |
| ------------------------------------------------- | ------------------- |
| Rewrite markdown source (shortcodes, directives)  | `transformMarkdown` |
| Add a Handlebars helper to all templates          | `beforeBuild`       |
| Inject computed metadata into the content graph   | `afterContentLoad`  |
| Tweak per-route context just before render        | `beforeRender`      |
| Post-process the final HTML (e.g. minify / strip) | `afterRender`       |
| Emit extra files after the site is written        | `afterEmit`         |
| Add generator-driven routes (custom feeds)        | `routes`            |

`transformMarkdown` is the only hook that runs *during* content load
— before the render engine exists — so it intentionally receives a
slimmer context (`kind`, `path`, `frontmatter`) instead of the full
`BuildContext`. Use `beforeRender` for hooks that need the engine or
the full content graph.

### Testing a markdown transform plugin

Markdown transforms are pure functions of `(input, ctx)`, so tests
don't need a full build:

```ts
import { describe, expect, test } from 'bun:test';
import calloutPlugin from '../plugins/callout-shortcode.ts';

describe('callout shortcode', () => {
  test('rewrites the shortcode into a kg-callout-card block', async () => {
    const out = await calloutPlugin.transformMarkdown?.(
      'Before\n\n{{<callout type="warn">}}\nbody\n{{</callout>}}\n\nAfter',
      { kind: 'post', path: 'fake.md', frontmatter: {} },
    );
    expect(out).toContain('kg-callout-card kg-callout-card-warn');
    expect(out).toContain('body');
    expect(out).not.toContain('{{<callout');
  });
});
```

---

## Verifying any extension

```bash
bunx nectar check          # config / theme / content validation
bunx nectar build --strict # fail the build on warnings
bun test                   # run the test suite (if you forked Nectar)
```

If you added a helper but it shows up as literal text in the output, you
forgot to register it on the engine. If it shows up as an empty string, the
helper threw — re-run with `-VV` to see the trace.

---

## Future-proofing

The plugin runtime is wired and the loader sequence is stable:

1. Read `plugins = […]` (and optionally auto-detect
   `nectar-plugin-*` packages) from `nectar.toml`.
2. Resolve each entry as a TypeScript / JavaScript module exporting a
   `Plugin` (or a `PluginFactory` returning one) via `default` or named
   `plugin` export.
3. Collect `transformMarkdown` hooks first, then invoke
   `beforeBuild` → `afterContentLoad` → `routes` → per-route
   `beforeRender` / `afterRender` → `afterEmit` in plugin registration
   order. Hook errors are warned-and-skipped (the build never crashes
   because of a buggy plugin).

The published types are stable: `Plugin`, `BuildContext`,
`MarkdownTransformContext`, `PluginRoute`, and `NectarHelper` live in
`nectar/plugin`. The legacy `NectarPlugin { setup }` shape stays
resolvable as an alias for `Plugin { beforeBuild }`.
