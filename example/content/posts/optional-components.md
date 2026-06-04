---
title: "Optional Components"
slug: optional-components
date: 2026-04-28T12:00:00Z
authors: [honeybee]
tags: [news, getting-started]
feature_image: "/content/images/components-cover.svg"
feature_image_alt: "Modular blocks arranged around the Laurel mark"
custom_excerpt: "Search, RSS, sitemap, comments — opt in by config."
---

The Laurel core is intentionally small: load content, load theme, render,
emit. Everything else is an **optional component**, configured in `laurel.toml`.

```toml
[components.search]
enabled = true
type    = "pagefind"

[components.rss]
enabled = true
items   = 20

[components.sitemap]
enabled = true

[components.comments]
provider = "giscus"
repo     = "myorg/myblog-comments"
```

Each component is a TypeScript module that hooks into the build pipeline
after route emission. It can add files (a `pagefind/` directory), rewrite
HTML (inject a Giscus snippet under `{{comments}}`), or both.

Components ship in the same repo as Laurel but are off by default — if you
don't enable it, no code runs.
