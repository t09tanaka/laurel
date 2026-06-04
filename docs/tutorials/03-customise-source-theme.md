# 3. Customise the Source theme

**Goal:** make the Source theme look like *your* blog — branding, navigation,
typography, layout — without breaking the build.

This tutorial covers the day-one customisations that 90% of users want. For
the full helper reference, partial system, and asset pipeline details, read
[`docs/THEME_DEV.md`](../THEME_DEV.md) afterwards.

You should already have a Laurel site that builds and serves locally. If not,
do [Tutorial 1 — Start a blog from scratch](./01-start-a-blog.md) first.

---

## The customisation surfaces, in order of effort

| Surface                            | What it does                                       |
| ---------------------------------- | -------------------------------------------------- |
| `[site]` / `[[navigation]]`        | Title, logo, accent colour, nav links              |
| `[theme.custom]`                   | Theme-specific switches (Source reads ~20 keys)    |
| `content/images/`                  | Logo, favicon, OG fallback                         |
| Theme partials (`themes/source/partials/`) | Header/footer markup, post cards, icons    |
| Theme `.hbs` layouts               | Whole-page structure (`default.hbs`, `post.hbs`)   |
| Theme `assets/css/`                | Styles                                             |
| `codeinjection_head` / per-post    | Per-post script/style overrides                    |

Reach for them in that order — most tweaks are a config change, not a code change.

---

## Step 1 — Set the brand basics in `laurel.toml`

```toml
[site]
title = "Daily Compiler"
description = "Notes on language design, build tools, and runtime quirks."
url = "https://daily-compiler.dev"
locale = "en"
timezone = "UTC"
accent_color = "#005f73"        # used by Source for links and accents
logo = "/content/images/logo.svg"
icon = "/content/images/favicon.png"
cover_image = "/content/images/cover.jpg"
twitter = "@dailycompiler"
facebook = "dailycompiler"

[[navigation]]
label = "Home"
url = "/"

[[navigation]]
label = "Archive"
url = "/tag/archive/"

[[navigation]]
label = "About"
url = "/about/"

[[secondary_navigation]]
label = "RSS"
url = "/rss.xml"
```

Drop your logo, favicon, and cover image into `content/images/`. Anything
under `content/images/` is copied to `dist/content/images/` and addressable as
`/content/images/<file>`.

## Step 2 — Use `[theme.custom]` for theme switches

Ghost themes read theme-specific options from `@custom.*` in templates. Source
has about 20 of them. Set them under `[theme.custom]`:

```toml
[theme.custom]
navigation_layout = "Logo on the left"   # or "Logo in the middle", "Stacked"
header_style = "Magazine"                # or "Landing", "Highlight", "Off"
header_text = "Reading and writing for the love of the craft."
title_font = "Modern sans-serif"         # or "Elegant serif"
body_font = "Modern sans-serif"          # or "Elegant serif"
font_display = "swap"                    # or "optional"
post_feed_style = "List"                 # or "Grid"
show_featured_posts = true
show_images_in_feed = true
show_author = true
show_publish_date = true
show_post_metadata = true
show_related_articles = true
enable_drop_caps_on_posts = true
background_image = true
```

The exact set is in Source's `package.json` `config.custom` block — that file
is the source of truth for valid values. Mistyped keys are silently ignored
(they just don't reach the template).

`font_display = "swap"` is the Source default because it keeps text readable
while web fonts load. Set `font_display = "optional"` only when avoiding late
font swaps and preserving brand typography is more important than guaranteeing
the custom font appears on slow or interrupted connections.

## Step 3 — Edit a partial to change a snippet

Partials are the easiest entry into actual template editing. To change the
footer:

```hbs
{{!-- themes/source/partials/footer.hbs --}}
<footer class="site-footer">
  <div class="inner">
    &copy; {{date format="YYYY"}} {{@site.title}}.
    Built with <a href="https://bun.sh">Bun</a> + Laurel.
  </div>
</footer>
```

Edit, save, re-run `bunx laurel build`, refresh. Partials are loaded from
`themes/<name>/partials/**` and addressable by their relative path without
the extension, e.g. `{{> "footer"}}` or `{{> "components/header"}}`.

## Step 4 — Change a layout

For structural changes (extra `<head>` tags, a sidebar, a different post
header), edit the layout `.hbs` files directly. The map for Source:

| File              | Renders                                  |
| ----------------- | ---------------------------------------- |
| `default.hbs`     | The wrapper for every page (`<html>` shell) |
| `index.hbs`       | Home feed (paginated post list)          |
| `home.hbs`        | Alias for index when `is:"home"`         |
| `post.hbs`        | Individual post page                     |
| `page.hbs`        | Individual static page                   |
| `tag.hbs`         | `/tag/<slug>/`                           |
| `author.hbs`      | `/author/<slug>/`                        |
| `error.hbs`       | 404 (when present)                       |

Inheritance uses `{{!< default}}` at the top of a layout file. The route table
and full inheritance rules are in
[`docs/THEME_DEV.md`](../THEME_DEV.md).

## Step 5 — Edit the CSS

Source's CSS lives at `themes/source/assets/css/`. After editing, rebuild —
`{{asset}}` recomputes the fingerprint so the browser pulls the new file:

```hbs
<link rel="stylesheet" href="{{asset "built/screen.css"}}">
```

If Source ships pre-built CSS (`assets/built/screen.css`) and you'd rather
work in the source files, run Source's own build step (`cd themes/source &&
yarn build`) — that pipeline is independent of Laurel.

For one-off overrides, drop a `<style>` block into `default.hbs` inside the
`{{ghost_head}}` region, or use post-level code injection (Step 7).

## Step 6 — Add a custom font, image, or favicon

```hbs
{{!-- themes/source/default.hbs, inside <head> --}}
<link rel="preload" href="{{asset "fonts/atkinson-regular.woff2"}}"
      as="font" type="font/woff2" crossorigin>
<link rel="icon" type="image/png" href="{{asset "images/favicon.png"}}">
```

Drop the files into `themes/source/assets/fonts/` and `assets/images/`. They
will be copied verbatim to `dist/assets/...` (non-CSS/JS files are not
fingerprinted, so URLs stay stable).

## Step 7 — Per-post overrides via code injection

Frontmatter on individual posts can inject `<head>` or `<body>` end content:

```markdown
---
title: A post with extra structured data
codeinjection_head: |
  <script type="application/ld+json">
    {"@context": "https://schema.org", "@type": "VideoObject", ... }
  </script>
codeinjection_foot: |
  <script defer src="https://plausible.io/js/script.js"
          data-domain="example.com"></script>
---
```

`{{ghost_head}}` and `{{ghost_foot}}` in `default.hbs` emit these blocks
(Source already wires them).

## Step 8 — Forking vs editing in place

You have two reasonable paths:

1. **Edit in place.** `themes/source/` is just files. Commit your changes
   alongside the rest of the project. Simple, but you lose the upstream
   update path.
2. **Fork upstream Source.** Clone your fork into `themes/source/` and rebase
   onto upstream `Source` periodically. Pick this if you expect to track
   upstream improvements.

Either way, the path inside your project is the same: `themes/<name>/`.

## Step 9 — Verify before you commit

```bash
bunx laurel check       # fast: config + theme + content validation
bunx laurel build
bunx laurel serve
```

Click through home, a post, a tag page, and an author page. Watch the
terminal for warnings — they don't fail the build by default. Re-run with
`--strict` if you want CI to refuse to ship on a warning:

```bash
bunx laurel build --strict
```

---

### Going deeper

When this tutorial runs out, [`docs/THEME_DEV.md`](../THEME_DEV.md) is the
reference: the full route table, layout inheritance rules, every supported
Ghost helper with its signature, the asset pipeline (which files get
fingerprinted, how `base_path` flows through), locale handling for `{{t}}`,
and the partial loader's resolution rules.
