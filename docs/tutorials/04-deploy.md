# 4. Deploy to Cloudflare Pages, Vercel, Netlify, or GitHub Pages

**Goal:** `dist/` live on the internet, rebuilt on every Git push.

Nectar emits plain static files. Any static host will serve them. The
configs below are the minimum to get a working CI build on each major
free-tier host.

**Universal pre-flight:**

```bash
bunx nectar build        # confirm a green build locally first
ls dist/                 # sanity-check the output
```

Then commit the entire project (excluding `dist/` and `node_modules/`) to a
Git repo on GitHub, GitLab, or wherever your chosen host integrates with.
`init` already wrote a sensible `.gitignore`.

If you deploy to a path other than `/` (e.g. `https://example.com/blog/`),
set `[build] base_path = "/blog/"` in `nectar.toml` and update `[site] url`
accordingly.

---

## Cloudflare Pages

**Recommended for:** global CDN edge, generous free tier, zero config.

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pick your repo. In the build configuration screen:

   | Field                    | Value                       |
   | ------------------------ | --------------------------- |
   | Framework preset         | *None*                      |
   | Build command            | `bunx nectar build`         |
   | Build output directory   | `dist`                      |
   | Root directory           | *(blank, unless monorepo)*  |

3. Environment variables → add **`BUN_VERSION` = `1.3.0`** (or your preferred
   ≥1.3 version). Cloudflare's build image will install Bun automatically when
   it sees this variable.
4. Save and deploy. First build takes ~1 minute; subsequent builds are cached.

The `_redirects` and `_headers` files at the root of `dist/` are picked up by
Cloudflare. To force a 404 page:

```
# dist/_redirects (write this from a custom build step if you need it)
/*  /404.html  404
```

---

## Vercel

**Recommended for:** the simplest end-to-end Git-to-URL flow.

1. **Import Project** → select your repo.
2. **Framework Preset → Other**.
3. Build & Output settings:

   | Field             | Value                |
   | ----------------- | -------------------- |
   | Build command     | `bunx nectar build`  |
   | Output directory  | `dist`               |
   | Install command   | *(leave blank — Vercel auto-detects Bun via `bun.lock`)* |

4. **Deploy**.

Vercel reads `bun.lock` and uses Bun automatically. No environment variable
required as of 2026-05.

For non-trivial routing or rewrites add `vercel.json` at the repo root:

```json
{
  "cleanUrls": true,
  "trailingSlash": true,
  "redirects": [
    { "source": "/feed", "destination": "/rss.xml", "permanent": true }
  ]
}
```

Trailing slashes matter — Nectar emits `<slug>/index.html`, so URLs end in
`/`. The setting above keeps Vercel from stripping them.

---

## Netlify

**Recommended for:** form handling, branch previews, plugin ecosystem.

Add `netlify.toml` at the repo root:

```toml
[build]
  command = "bunx nectar build"
  publish = "dist"

[build.environment]
  BUN_VERSION = "1.3.0"

[[redirects]]
  from = "/feed"
  to = "/rss.xml"
  status = 301
  force = true
```

Then **Netlify dashboard → Add new site → Import from Git → pick repo →
Deploy**. The `netlify.toml` overrides any guesses Netlify makes.

Netlify's Bun support is via the `BUN_VERSION` build environment variable —
without it, the build runs Node and `bunx` will fail.

---

## GitHub Pages

**Recommended for:** repos already on GitHub, no extra account needed.

GitHub Pages does not run Bun, so the build has to happen in GitHub Actions
and the resulting `dist/` is uploaded as the Pages artifact.

Create `.github/workflows/pages.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3'
      - run: bun install
      - run: bunx nectar build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then in the repo settings: **Pages → Build and deployment → Source = GitHub
Actions**. Push to `main` and the action publishes the site.

If your site lives at `https://<user>.github.io/<repo>/` (project pages, not
a custom domain or user site), update `nectar.toml`:

```toml
[site]
url = "https://<user>.github.io/<repo>/"

[build]
base_path = "/<repo>/"
```

`base_path` makes `{{asset}}`, `{{url}}`, and navigation links emit correct
URLs for the subdirectory.

---

## Troubleshooting deploys

- **Build runs locally, fails in CI.** Usually a missing Bun. Confirm the
  host installed Bun ≥ 1.3 (Cloudflare/Netlify need `BUN_VERSION` env;
  Vercel auto-detects from `bun.lock`; GitHub Actions needs `setup-bun@v2`).
- **404 on direct page loads in production.** Your host is stripping
  trailing slashes. Add a redirect rule (`netlify.toml`, `vercel.json`,
  `_redirects`) or configure "Always append trailing slash" in the host's
  settings.
- **Assets 404 with `/<repo>/...` prefix on GitHub Pages.** You missed
  `[build] base_path`. Set it to your subdirectory path with leading and
  trailing slash, e.g. `"/my-blog/"`, and rebuild.
- **Site builds but RSS / sitemap missing.** Check `nectar.toml` — those are
  optional components; they default to enabled but can be turned off:
  ```toml
  [components.rss]
  enabled = true
  ```

For preview deploys against a subpath, build with `--base-path`:

```bash
bunx nectar build --base-path /preview/feature-x/
```
