---
title: "Migrating from Ghost"
slug: migrating-from-ghost
date: 2026-05-15T11:30:00Z
authors: [honeybee]
tags: [migration, getting-started]
feature_image: "/content/images/migration-cover.svg"
feature_image_alt: "A bee flying between two flowers"
custom_excerpt: "How `nectar import-ghost` turns a Ghost JSON export into Markdown."
---

Run `nectar import-ghost ghost-export.json` from your project root. The
importer reads your Ghost admin export, converts each post's HTML body to
Markdown via [turndown](https://github.com/mixmark-io/turndown), and writes:

- `content/posts/*.md` (and `content/pages/*.md` for static pages)
- `content/tags/*.md` for tags with descriptions or images
- `content/authors/*.md`

## What about images?

Image URLs are kept as-is. If your Ghost site served them from
`/content/images/`, copy the `content/images/` directory from your Ghost
backup into your Nectar project, and the URLs will continue to resolve.

## Frontmatter mapping

| Ghost field        | Nectar frontmatter   |
|--------------------|----------------------|
| `published_at`     | `date`               |
| `feature_image`    | `feature_image`      |
| `tags`             | `tags: [slug, ...]`  |
| `authors`          | `authors: [slug, ...]` |
| `visibility`       | `visibility`         |

Anything Ghost-specific that doesn't map cleanly (Mobiledoc/Lexical-only
posts) is logged so you can revisit it after the import.
