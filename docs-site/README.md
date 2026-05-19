# `docs-site/` — Nectar documentation site

This directory bootstraps the **public documentation site** for Nectar
(target host: `docs.nectar.dev`). It is the dogfood case: Nectar builds
its own docs, against the vendored Ghost **Source** theme that lives in
`example/themes/source/`.

## What lives here

```
docs-site/
├── nectar.toml          # Site config. Points theme.dir at ../example/themes
└── content/
    ├── posts/           # Announcements + feed entries
    ├── pages/           # Install, config-ref, theme-dev, helper matrix,
    │                    # plugin API, migration playbook, FAQ
    └── authors/         # Author records used by the Source theme
```

The pages in `content/pages/` are intentionally lean. They are entry points
that link to the **canonical Markdown sources** under
[`docs/`](../docs/) (e.g. `docs/THEME_DEV.md`,
`docs/GHOST_COMPATIBILITY.md`, `docs/migration-from-ghost/`). Filling these
pages out — or replacing the in-repo `docs/` tree with this site — is a
follow-up.

## Build

From the repo root:

```bash
bun run build:docs-site
```

Or from this directory:

```bash
cd docs-site
bun ../src/cli/index.ts build
```

The output lands in `docs-site/dist/` (gitignored).

## Why dogfood?

If Nectar can render its own documentation against the **Source** theme,
the Ghost compatibility surface is doing its job. Any regression in helper
coverage, asset fingerprinting, navigation, or pagination immediately
shows up here.

## Why not Starlight / VitePress?

The task that bootstrapped this site (`project-backlog #67`) explicitly
offered Starlight or VitePress as an alternative. Dogfooding Nectar was
chosen so that the docs site doubles as an integration test. If
contributors decide otherwise later, swap this directory for a Starlight or
VitePress project — the `docs/` Markdown sources are reusable either way.

## Deploy

The output is plain static files. Host wherever you host static files:
Cloudflare Pages, Vercel, Netlify, GitHub Pages, S3 + CloudFront. The
`nectar build` step is the entire build pipeline.

### GitHub Pages (default)

`.github/workflows/docs-site.yml` publishes `docs-site/dist` to GitHub Pages
on every push to `main`. The workflow:

1. Calls `actions/configure-pages` to derive the repo-scoped `base_path`
   (e.g. `/nectar/`) and to enable Pages if it has not been set up yet.
2. Runs `bun ../src/cli/index.ts build --base-path <base_path>` from
   `docs-site/`, so internal links and asset URLs work under the
   `https://<owner>.github.io/<repo>/` prefix without editing
   `nectar.toml`.
3. Uploads `docs-site/dist` as a Pages artifact and deploys it via
   `actions/deploy-pages`.

Trigger a republish manually from the **Actions → Docs Site → Run workflow**
button when you want to redeploy without a code change.

Once the project is ready to live at `docs.nectar.dev`, configure the custom
domain in **Settings → Pages** and update `[site].url` in
`docs-site/nectar.toml`.

### Known limitation: navigation under a sub-path

`base_path` rewrites fingerprinted asset URLs (CSS, JS, fonts) and the post /
page route URLs, but the `{{navigation}}` helper currently emits
`[[navigation]].url` verbatim. While the docs site is hosted at
`https://<owner>.github.io/nectar/`, the top-of-page nav links such as
`/install/` resolve to `https://<owner>.github.io/install/` (404) instead of
`https://<owner>.github.io/nectar/install/`. Internal links rendered inside
post / page bodies, sitemap entries, and the RSS feed still point at the
canonical `[site].url`, so the published site is usable for browsing once a
custom domain is configured. Tracking this gap as a follow-up: extend the
navigation helper to apply `build.base_path` to relative URLs.
