---
title: "Plugin API"
slug: plugin-api
date: 2026-05-20T00:00:00Z
authors: [laurel]
meta_title: "Plugin API | Laurel Docs"
meta_description: "Extend the Laurel build with optional components and plugins."
---

# Plugin API

Optional features — search, comments, RSS, sitemaps, OG image rasterisation,
JSON feeds — plug into the Laurel build through the `[components.*]` section
of `laurel.toml`.

A component is **opt-in** by design. Nothing is bundled into the output
unless its `enabled = true` flag flips on in config.

```toml
[components.rss]
enabled = true
items = 20

[components.sitemap]
enabled = true

[components.opengraph]
enabled = true
```

Tutorial 5 in the repo —
[Write your first plugin](https://github.com/t09tanaka/laurel/blob/main/docs/tutorials/05-write-your-first-plugin.md)
— walks through the hook surface end-to-end.

## Built-in components

- `rss` — emits `rss.xml` with the N most recent posts.
- `sitemap` — emits `sitemap.xml` for crawlers.
- `opengraph` — injects OpenGraph + Twitter Card meta tags via
  `{{ghost_head}}`.
- `search` — generates a JSON index consumable by a client-side widget.
- `og_images` — rasterises per-post Open Graph images.

The exact list is generated from the config schema; see
[`docs/config.md`](https://github.com/t09tanaka/laurel/blob/main/docs/config.md)
for the live reference.
