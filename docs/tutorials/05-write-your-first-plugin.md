# 5. Write your first plugin

**Goal:** understand Nectar's extension model — what's wired today, what's
typed but not yet loaded — and add a concrete extension to your site.

---

## How extension works in Nectar today

> **Status note.** Nectar publishes the `NectarPlugin` / `BuildContext` /
> `NectarHelper` types ahead of the runtime that loads them. The types are
> stable and you can write plugin-shaped code against them now, but **the
> build does not yet auto-discover `plugins` in `nectar.toml`**. Until that
> ships, the working extension points are: custom Handlebars helpers (via a
> small fork), config-driven optional components, `[theme.custom]` keys, and
> per-post code injection. This tutorial covers all four, plus the typed
> plugin shape so what you write today keeps working tomorrow.

The four extension surfaces, ranked by how much code you touch:

| Surface                 | Code change | Use it for                                       |
| ----------------------- | ----------- | ------------------------------------------------ |
| `[theme.custom]`        | None        | Theme-specific switches (header style, fonts)    |
| `[components.*]`        | None        | Toggle RSS / sitemap / OG images / Content API  |
| `codeinjection_*`       | None        | Per-post `<head>` / `<body>` snippets            |
| Custom helper           | Small fork  | A new `{{my_helper}}` for use in templates       |

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

The plugin runtime is the next big extensibility milestone. When it lands,
the auto-loader will:

1. Read `plugins = […]` from `nectar.toml`.
2. Resolve each entry as a TypeScript module exporting a `NectarPlugin`.
3. Call `setup(ctx)` between content load and template rendering.

The `BuildContext` snapshot you receive will match what the type already
describes. Code written against `nectar/types` today should require no
changes when the loader ships — only the `nectar.toml` entry.
