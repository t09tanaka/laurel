# 1. Start a blog from scratch

**Goal:** a working blog at `http://localhost:4321`, served from a single Git
repository, in about five minutes.

**You will end with:**

```
my-blog/
├── nectar.toml             # site configuration
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
bunx nectar init --yes
```

`init --yes` accepts every default: title "My Nectar Site", URL
`http://localhost:4321`, the `source` theme, starter content on, RSS on,
deploy target GitHub Pages. To answer the prompts yourself, drop `--yes`:

```bash
bunx nectar init
```

After init you have a `nectar.toml`, a `.gitignore`, a `README.md`, and a
`content/` tree. `init` does **not** copy a theme — see Step 2.

## Step 2 — Add the Source theme

The theme directory listed in `nectar.toml` is `themes/source/`. Vendor the
Ghost Source theme (Nectar's reference theme) from the Nectar repo:

```bash
mkdir -p themes
git clone --depth 1 https://github.com/TryGhost/Source themes/source
```

> Any standard Ghost `.hbs` theme works. The compatibility surface is documented
> in [`docs/GHOST_COMPATIBILITY.md`](../GHOST_COMPATIBILITY.md). If a theme uses
> a helper Nectar does not yet implement, the build will report exactly which
> one.

## Step 3 — Write your first post

Create `content/posts/hello-world.md`:

```markdown
---
title: Hello, world
date: 2026-05-20
tags: [news]
authors: [default]
excerpt: My first post on Nectar.
---

This is Markdown. **Bold**, _italics_, `code`, and [links](https://bun.sh)
all work. Images dropped into `content/images/` are served verbatim:

![Sunset](/content/images/sunset.jpg)
```

Frontmatter keys you'll use most often: `title`, `date`, `slug`, `tags`,
`authors`, `excerpt`, `feature_image`, `featured`, `status` (`published` |
`draft` | `scheduled`). Drafts are skipped at build time. The full list is
documented inline in `src/content/loader.ts`.

> **Headings in body content.** Your post or page title (from frontmatter
> `title:`) is already rendered as an `<h1>` by the theme's article header. To
> keep one `<h1>` per page — better for screen reader outlines and Lighthouse
> SEO — Nectar automatically downshifts every heading inside your Markdown body
> by one level when rendering `{{content}}`: a `#` becomes `<h2>`, `##` becomes
> `<h3>`, and so on, capped at `<h6>`. Write your sections at whatever level
> reads naturally in Markdown; the static output will be well-nested.

A faster way to scaffold:

```bash
bunx nectar new post "Hello, world"
```

That writes `content/posts/hello-world.md` with frontmatter pre-filled.
`bunx nectar new page "About"` does the same for a page.

## Step 4 — Build and preview

```bash
bunx nectar build
bunx nectar serve
```

Open `http://localhost:4321`. `serve` does not rebuild — re-run `nectar build`
after editing content or templates and refresh the browser.

> `dist/` is wiped on every build. Don't hand-edit files there; edit the source
> in `content/` and `themes/` and rebuild.

Flags you'll reach for:

```bash
bunx nectar build --output ./public      # emit to public/ instead of dist/
bunx nectar build --base-path /preview/  # build for a subdirectory deploy
bunx nectar build --strict               # warnings become non-zero exits
bunx nectar serve --port 5000 --host 0.0.0.0
```

## Step 5 — Edit `nectar.toml`

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

Every key has a default, so a near-empty `nectar.toml` still builds. The
fully-fleshed reference is `example/nectar.toml` in the Nectar repo.

## Step 6 — Commit and you're done

```bash
git init
git add .
git commit -m "Initial Nectar site"
```

To go live, head to [Tutorial 4 — Deploy](./04-deploy.md). To make the theme
your own, [Tutorial 3 — Customise the Source theme](./03-customise-source-theme.md).
