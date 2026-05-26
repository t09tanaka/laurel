---
title: "Ghost Theme Compatibility"
slug: ghost-theme-compatibility
date: 2026-05-05T08:00:00Z
authors: [casper]
tags: [news]
feature_image: "/content/images/compat-cover.svg"
feature_image_alt: "A browser window showing Ghost theme components connected to Nectar"
custom_excerpt: "Which Ghost helpers Nectar implements, and which it deliberately doesn't."
---

Nectar implements the Ghost theme helper surface needed to render real-world
themes against static Markdown content. The full coverage matrix lives in
`docs/GHOST_COMPATIBILITY.md` — here are the highlights.

## Implemented

`asset`, `img_url`, `ghost_head`, `ghost_foot`, `date`, `t`, `url`, `concat`,
`encode`, `link`, `link_class`, `navigation`, `pagination`, `reading_time`,
`excerpt`, `content`, `authors`, `tags`, `social_url`, `lang`, `foreach`,
`is`, `match`, `has`, and a `get` resolver against the local content graph.

## Deliberately scoped out

Members, subscriptions, paywall, comments. `{{comments}}` outputs an empty
container; the optional components system is where you'd wire Giscus / Disqus
in.

## Currently best-effort

`{{img_url size=...}}` doesn't transcode images yet — the size parameter is
recognised, but the same source URL is returned. We'll add real resizing as
an optional `[components.images]` component.
