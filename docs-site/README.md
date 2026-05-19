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
