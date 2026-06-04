---
name: laurel-setting
description: Use when configuring a Laurel project via laurel.toml — site metadata, theme selection, build options, and toggling optional components (RSS, sitemap, Open Graph, OG images, content API, pagination). Covers the `laurel config` command (print/validate/get/set/path) and the config section layout. For content frontmatter fields, defer to laurel-frontmatter-authoring; for hosting/deploy config, laurel-deploy.
version: 1
applies_to:
  - claude
  - codex
triggers:
  - configure laurel.toml
  - laurel config
  - enable RSS
  - enable sitemap
  - turn on OG images
  - set the site url
  - change the locale
  - laurel config set
  - validate config
  - optional components
---

# Configuring a Laurel project

A Laurel project is configured by `laurel.toml` at the project root. There is no
admin UI; `laurel build` reads this file plus the Markdown under `content/`. Use
the `laurel config` command to inspect and edit it safely rather than guessing
TOML by hand.

## Inspect and edit config

```sh
laurel config print                 # resolved config (after defaults + env + layers) as TOML
laurel config print --format json   # same, as JSON
laurel config validate              # load config only; exit 0/1 — run this before a build
laurel config path                  # show the detected laurel.toml and .laurelrc paths
laurel config get site.url          # print one value at a dotted path
laurel config set site.title "My Site"   # write a string/number/bool value
```

`laurel config print` shows the *effective* config (defaults filled in, env
overrides applied), which is the source of truth for what the build sees —
prefer it over reading raw `laurel.toml`, which omits defaults. `config set`
writes the value back into `laurel.toml`; `config validate` is the fast
config-only gate (no full build) for CI or a pre-commit check.

## Core sections

```toml
[site]
title = "My Site"
url = "https://example.com"          # absolute; used for canonical links, sitemap, RSS GUIDs
locale = "en"                        # one build = one locale
timezone = "UTC"                     # IANA tz for date handling

[theme]
name = "source"                      # active theme directory name under [theme].dir
dir = "themes"

[build]
output_dir = "dist"
include_future_posts = false         # set true to include scheduled/future-dated posts in a preview
minify_html = false
```

For theme selection details see the `laurel-theming` skill; for deploy targets
(`[deploy.*]`) see `laurel-deploy`.

## Optional components (toggle in `[components.*]`)

Features beyond the core static pages are opt-in components. Each has an
`enabled` flag:

```toml
[components.rss]
enabled = true                       # emit rss.xml

[components.sitemap]
enabled = true                       # emit sitemap.xml

[components.opengraph]
enabled = true                       # Open Graph / Twitter meta in <head>

[components.og_images]
enabled = false                      # generate per-page Open Graph images

[components.content_api]
enabled = false                      # emit a static JSON content API

[components.pagination]
enabled = true                       # paginate index / archive pages
```

Toggle one from the CLI without hand-editing TOML:

```sh
laurel config set components.rss.enabled false
laurel config set components.og_images.enabled true
```

After enabling a component, run `laurel build` and confirm the artifact appears
(`dist/rss.xml`, `dist/sitemap.xml`, generated OG images, etc.).

## A safe config-change loop

```sh
laurel config set <key> <value>   # or hand-edit laurel.toml
laurel config validate            # catches schema errors without a full build
laurel build                      # ground truth — the artifact reflects the change
```

## Common mistakes this workflow avoids

- Hand-editing `laurel.toml` and producing invalid TOML or an unknown key →
  use `laurel config set` and `laurel config validate`.
- Reading raw `laurel.toml` and missing a default → `laurel config print` shows
  the effective, resolved config the build actually uses.
- Expecting an RSS/sitemap/OG file that never appears → the matching
  `[components.<name>].enabled` flag is off; flip it and rebuild.
- Setting `site.url` with a trailing slash or a non-absolute URL → it must be a
  parseable absolute URL; `laurel config validate` flags a bad value.
