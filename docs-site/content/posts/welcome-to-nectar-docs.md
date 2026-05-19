---
title: "Welcome to the Nectar docs"
slug: welcome-to-nectar-docs
date: 2026-05-20T00:00:00Z
authors: [nectar]
tags: [announcements]
custom_excerpt: "The docs site is now bootstrapped. Here is what lives where."
featured: true
---

This is the Nectar documentation site. It is built with Nectar itself
(dogfood) against the vendored Ghost **Source** theme.

## Where to start

- [Install](/install/) — grab a binary or the npm package.
- [Config reference](/config-reference/) — every key in `nectar.toml`.
- [Theme development](/theme-development/) — write or customise a Ghost theme
  that Nectar can render.
- [Helper matrix](/helper-matrix/) — which Ghost helpers are implemented.
- [Plugin API](/plugin-api/) — extend the build with optional components.
- [Migrating from Ghost](/migration-from-ghost/) — move a real Ghost blog
  over.
- [FAQ](/faq/) — the questions we keep getting.

The pages above are stubs pointing at the canonical Markdown sources in the
[`docs/`](https://github.com/t09tanaka/nectar/tree/main/docs) tree of the
repository. They will fill in over time as the documentation matures.

## Why dogfood?

If Nectar can render its own documentation against the **Source** theme, the
Ghost compatibility surface is doing its job. The same `nectar build` you
would run on a blog produces this site.
