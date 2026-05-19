---
title: "About Nectar"
slug: about
date: 2026-01-01T00:00:00Z
authors: [casper]
feature_image: "/content/images/about-cover.svg"
feature_image_alt: "An illustrated hexagon next to a stylised 'N'"
meta_title: "About | Nectar Example"
meta_description: "What Nectar is, and why we built it."
show_title_and_feature_image: true
---

# What is Nectar?

**Nectar** is a static site generator that consumes Ghost themes and
Markdown content. There is no CMS, no admin server, and no database. You write
content as Markdown files in Git, drop a Ghost theme into `themes/`, and
`nectar build` produces a static site.

## Why?

- We like Ghost themes. The ecosystem is mature, the helpers are well thought
  out, and the visual style of themes like *Source* is hard to beat.
- We don't like running Ghost. A Node admin server, a SQLite or MySQL database,
  the upgrade path — none of that is a great fit for "I want a blog".
- Markdown + Git is the right substrate for technical writers.

So Nectar bridges the two: Ghost theme on the front, Markdown + Git on the
back, static output in the middle.
