# 2. Migrate from Ghost in 10 minutes

**Goal:** an existing Ghost blog rendered as a static Nectar site, with all
posts, pages, tags, authors, and images preserved.

This is the speed-run. The exhaustive version with screenshots and edge cases
lives at [`docs/migration/ghost.md`](../migration/ghost.md) — read that if
anything below fails or surprises you.

---

## Step 1 — Export from Ghost (1 min)

Ghost admin → **Settings → Labs → Export your content → Export**. Save the
downloaded JSON, typically named `your-site.ghost.YYYY-MM-DD.json`.

If you want your images too (recommended), grab the `content/` directory off
your Ghost server. For self-hosted Ghost it lives at
`/var/lib/ghost/content/`; for Ghost(Pro) you can download a content archive
from Labs.

You should end up with two things on your laptop:

```
~/Downloads/
├── my-site.ghost.2026-05-20.json
└── ghost-content/         # optional, holds images/ files/ media/
```

## Step 2 — Scaffold a Nectar project (1 min)

```bash
mkdir my-blog && cd my-blog
bunx nectar init --yes
mkdir -p themes
git clone --depth 1 https://github.com/TryGhost/Source themes/source
```

> Already using a custom Ghost theme? Download it from
> **Settings → Design → Change theme → Advanced → Download** and unzip into
> `themes/<your-theme-name>/`. Then set `[theme] name = "<your-theme-name>"`
> in `nectar.toml`.

## Step 3 — Import the JSON (2 min)

```bash
bunx nectar import-ghost ~/Downloads/my-site.ghost.2026-05-20.json \
  --assets ~/Downloads/ghost-content
```

What the importer does:

- Converts every post/page from Ghost's `html` / `mobiledoc` / `lexical` body
  into Markdown via Turndown.
- Writes posts to `content/posts/<slug>.md`, pages to `content/pages/<slug>.md`,
  authors with a real bio to `content/authors/<slug>.md`, tags with metadata to
  `content/tags/<slug>.md`.
- Copies `images/`, `files/`, `media/` from `--assets` into
  `content/<name>/`, additively (existing files are not overwritten).
- Strips Ghost's `__GHOST_URL__` placeholder.

Flags worth knowing:

```bash
--on-conflict skip        # default: keep existing files
--on-conflict overwrite   # replace existing files
--on-conflict rename      # write to <slug>-1.md, <slug>-2.md, …
```

If you exported the whole content folder (not just the JSON), point the
importer at the folder — it auto-detects the JSON and assets:

```bash
bunx nectar import-ghost ~/Downloads/ghost-content
```

## Step 4 — Build and inspect (1 min)

```bash
bunx nectar build
bunx nectar serve
```

Open `http://localhost:4321`. You should see your home feed, individual posts,
tag archives, author pages, RSS at `/rss.xml`, and a sitemap at `/sitemap.xml`.

## Step 5 — Fix the small things (4 min)

Update `nectar.toml` to match your old Ghost setup:

```toml
[site]
title = "My Blog"
description = "…"
url = "https://my-blog.com"
locale = "en"
timezone = "America/Los_Angeles"
accent_color = "#FF5722"
logo = "/content/images/logo.svg"
icon = "/content/images/favicon.png"

[[navigation]]
label = "Home"
url = "/"

[[navigation]]
label = "About"
url = "/about/"
```

Things to double-check, in priority order:

1. **Featured images.** Posts with `feature_image` set in Ghost should render
   them. If they don't, confirm `--assets` pointed at the directory holding
   `images/` and that the image paths look like `/content/images/...`.
2. **Code injection.** Ghost's per-post header/footer injection is preserved
   as `codeinjection_head` and `codeinjection_foot` frontmatter, and rendered
   by `{{ghost_head}}` / `{{ghost_foot}}` in the theme. Site-wide injection
   from Ghost admin is **not** imported — paste it into your theme's
   `default.hbs` instead.
3. **Members / paid posts.** Static sites cannot enforce paywalls. By default
   Nectar truncates `members`/`paid` posts to 300 words. Change in
   `nectar.toml`:
   ```toml
   [content]
   visibility_policy = "skip"           # omit entirely, or
   visibility_policy = "render-full"    # publish in full
   paywall_word_count = 300
   ```
4. **Drafts.** Drafts are dropped from the build silently. Set
   `status: published` in frontmatter to bring one back.
5. **Comments / newsletters / search.** Comments render empty; newsletters are
   skipped; search is not built-in. See
   [`docs/GHOST_COMPATIBILITY.md`](../GHOST_COMPATIBILITY.md) for the full
   "out of scope" list and recommended client-side replacements.

## Step 6 — Commit and deploy

```bash
git init
git add .
git commit -m "Migrate from Ghost"
```

Continue with [Tutorial 4 — Deploy](./04-deploy.md) to push `dist/` live.

---

### When things go wrong

```bash
bunx nectar check       # validates config, theme, content; non-zero on errors
bunx nectar doctor      # runs the full health check (bun, theme, content, network)
bunx nectar build -VV   # crank verbosity to trace
```

`check` is the fast pre-flight; `doctor` is the deep one. If `doctor --json`
reports a problem, the JSON identifies which subsystem failed.
