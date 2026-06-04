# 1. Start a blog from scratch

**Goal:** a working blog at `http://localhost:4321`, served from a single Git
repository, in about five minutes.

**You will end with:**

```
my-blog/
├── laurel.toml             # site configuration
├── content/
│   ├── posts/welcome.md    # one starter post
│   ├── pages/about.md      # one starter page
│   └── authors/default.md  # author bio
├── themes/source/          # vendored Ghost Source theme
└── dist/                   # generated static site (after build)
```

---

## Step 1 — Scaffold the project

```bash
mkdir my-blog && cd my-blog
bunx laurel init --yes
```

`init --yes` accepts every default: title "My Laurel Site", URL
`http://localhost:4321`, the `source` theme, starter content on, RSS on,
deploy target GitHub Pages. To answer the prompts yourself, drop `--yes`:

```bash
bunx laurel init
```

After init you have a `laurel.toml`, a `.gitignore`, a `README.md`, and a
`content/` tree. `init` does **not** copy a theme — see Step 2.

## Step 2 — Add the Source theme

The theme directory listed in `laurel.toml` is `themes/source/`. Vendor the
Ghost Source theme (Laurel's reference theme) from the Laurel repo:

```bash
mkdir -p themes
git clone --depth 1 https://github.com/TryGhost/Source themes/source
```

> Any standard Ghost `.hbs` theme works. The compatibility surface is documented
> in [`docs/GHOST_COMPATIBILITY.md`](../GHOST_COMPATIBILITY.md). If a theme uses
> a helper Laurel does not yet implement, the build will report exactly which
> one.

## Step 3 — Write your first post

Create `content/posts/hello-world.md`:

```markdown
---
title: Hello, world
date: 2026-05-20
tags: [news]
authors: [default]
excerpt: My first post on Laurel.
---

This is Markdown. **Bold**, _italics_, `code`, and [links](https://bun.sh)
all work. Images dropped into `content/images/` are served verbatim:

![Sunset](/content/images/sunset.jpg)
```

Frontmatter keys you'll use most often: `title`, `date`, `slug`, `tags`,
`authors`, `excerpt`, `feature_image`, `featured`, `status` (`published` |
`draft` | `scheduled`). Drafts are always skipped at build time. Scheduled
posts are skipped until their `date` (a.k.a. `published_at`) is at or before
the moment the build runs — Laurel compares against the build host's current
wall-clock time in UTC, so a future-dated scheduled post stays out of the
HTML, RSS feed, and sitemap, and only ships when you trigger a build at or
after that timestamp. The full list of frontmatter keys is documented inline
in `src/content/loader.ts`.

> **Headings in body content.** Your post or page title (from frontmatter
> `title:`) is already rendered as an `<h1>` by the theme's article header. To
> keep one `<h1>` per page — better for screen reader outlines and Lighthouse
> SEO — Laurel automatically downshifts every heading inside your Markdown body
> by one level when rendering `{{content}}`: a `#` becomes `<h2>`, `##` becomes
> `<h3>`, and so on, capped at `<h6>`. Write your sections at whatever level
> reads naturally in Markdown; the static output will be well-nested.

A faster way to scaffold:

```bash
bunx laurel new post "Hello, world"
```

That writes `content/posts/hello-world.md` with frontmatter pre-filled.
`bunx laurel new page "About"` does the same for a page.

## Step 4 — Build and preview

```bash
bunx laurel build
bunx laurel serve
```

Open `http://localhost:4321`. `serve` does not rebuild — re-run `laurel build`
after editing content or templates and refresh the browser.

> `dist/` is wiped on every build. Don't hand-edit files there; edit the source
> in `content/` and `themes/` and rebuild.

Flags you'll reach for:

```bash
bunx laurel build --output ./public      # emit to public/ instead of dist/
bunx laurel build --base-path /preview/  # build for a subdirectory deploy
bunx laurel build --strict               # warnings become non-zero exits
bunx laurel serve --port 5000 --host 0.0.0.0
```

## Step 5 — Edit `laurel.toml`

Replace the scaffolded values with your own:

```toml
[site]
title = "My Blog"
description = "Short, descriptive, used for OpenGraph and RSS."
url = "https://example.com"
locale = "en"
timezone = "UTC"
accent_color = "#FF5722"
logo = "/content/images/logo.svg"
icon = "/content/images/favicon.png"

[theme]
name = "source"
dir = "themes"

[theme.custom]
# Anything under [theme.custom] becomes @custom.* in templates.
# These keys match what the Source theme reads — change values, not names.
navigation_layout = "Logo on the left"
header_style = "Magazine"

[[navigation]]
label = "Home"
url = "/"

[[navigation]]
label = "About"
url = "/about/"
```

Every key has a default, so a near-empty `laurel.toml` still builds. The
fully-fleshed reference is `example/laurel.toml` in the Laurel repo.

## Step 6 — Commit and you're done

```bash
git init
git add .
git commit -m "Initial Laurel site"
```

To go live, head to [Tutorial 4 — Deploy](./04-deploy.md). To make the theme
your own, [Tutorial 3 — Customise the Source theme](./03-customise-source-theme.md).
