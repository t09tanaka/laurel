---
title: "Config reference"
slug: config-reference
date: 2026-05-20T00:00:00Z
authors: [nectar]
meta_title: "Config reference | Nectar Docs"
meta_description: "Every key in nectar.toml, what it does, and the defaults."
---

# Config reference

Nectar is configured by a single `nectar.toml` file at the project root.
The schema is exhaustive — every key, default, and constraint is generated
from `src/config/schema.ts` and published to
[`docs/config.md`](https://github.com/t09tanaka/nectar/blob/main/docs/config.md).

The generated reference is the source of truth. Run

```bash
bun run docs:config
```

to regenerate it after changing the schema.

## Quick orientation

- `[site]` — site-level metadata exposed to themes as `@site` / `@blog`.
- `[theme]` — theme directory + theme name + per-theme custom settings
  (`[theme.custom]`).
- `[content]` — where Nectar reads posts, pages, authors, tags, and assets
  from.
- `[build]` — output directory, base path, pagination size, etc.
- `[[navigation]]` and `[[secondary_navigation]]` — themes consume these via
  the `{{navigation}}` helper.
- `[components.*]` — opt-in components (RSS, sitemap, OpenGraph, OG images,
  search, etc.).

## Minimal example

```toml
[site]
title = "My blog"
url = "https://example.com"
locale = "en"

[theme]
name = "source"
dir = "themes"

[content]
posts_dir = "content/posts"
pages_dir = "content/pages"

[build]
output_dir = "dist"
```

See
[`example/nectar.toml`](https://github.com/t09tanaka/nectar/blob/main/example/nectar.toml)
and this site's own `docs-site/nectar.toml` for working configurations.
