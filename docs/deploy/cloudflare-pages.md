# Deploying Nectar to Cloudflare Pages

Cloudflare Pages serves Nectar's `dist/` as a static site on Cloudflare's
edge network. Nectar has two Cloudflare-specific pieces:

- `[deploy.cloudflare_pages]` controls build output for Pages: `_headers`
  and `_routes.json`.
- `[deploy.cloudflare]` controls the optional `nectar deploy cloudflare`
  command: project name and branch passed to `wrangler pages deploy`.

Use the Git-connected Pages flow for normal production deploys. Use
`nectar deploy cloudflare` when CI already built the site and you want an
explicit deploy command.

## Quickstart: Git-connected Pages

1. In `nectar.toml`, enable the Pages output files:

   ```toml
   [deploy.cloudflare_pages]
   enabled = true
   ```

2. Build locally once before wiring CI:

   ```sh
   bunx nectar build
   test -f dist/_headers
   test -f dist/_routes.json
   ```

3. In the Cloudflare dashboard, go to **Workers & Pages -> Create -> Pages
   -> Connect to Git**, then pick the repository.

4. Set the build fields:

   | Field | Value |
   | --- | --- |
   | Framework preset | `None` |
   | Build command | `bunx nectar build` |
   | Build output directory | `dist` |
   | Root directory | blank, unless Nectar lives in a monorepo subdirectory |

5. Add an environment variable:

   | Variable | Value |
   | --- | --- |
   | `BUN_VERSION` | `1.3.0` or newer |

6. Save and deploy.

Cloudflare reads `_headers` and `_redirects` from the publish root. With
`[deploy.cloudflare_pages].enabled = true`, Nectar emits `_headers` with the
same cache defaults as Netlify: immutable caching for `/assets/*` and
`/content/images/*`, and revalidation for HTML. It also emits `_routes.json`
so a pure-static site is not accidentally routed through Pages Functions when
a `functions/` directory exists.

Every Nectar build includes `dist/404.html`. When the Cloudflare Pages build
output directory is `dist`, that file sits at the publish root as `404.html`,
which Pages automatically serves as the custom 404 response body for unmatched
static routes. Do not add a catch-all `_redirects` rewrite for missing paths to
`/404.html`, such as `/* /404.html 404`, unless you are intentionally replacing
Cloudflare Pages' built-in static 404 convention.

## Cloudflare Workers Static Assets

If you deploy the same `dist/` directory with Cloudflare Workers Static Assets
instead of Pages, keep Nectar's multi-page output as static files and let
Cloudflare serve `dist/404.html` for missing routes:

```toml
name = "my-blog"
compatibility_date = "2025-04-01"

[assets]
directory = "./dist"
not_found_handling = "404-page"
```

Use `not_found_handling = "404-page"` for Nectar sites. Nectar emits separate
HTML files for posts, pages, tag indexes, author indexes, and `dist/404.html`;
that setting preserves direct navigation to those files while returning the
generated 404 page for a real miss.

Do not use `not_found_handling = "single-page-application"` for a normal
Nectar deploy. SPA fallback serves `index.html` for navigation requests that do
not match an asset, which can hide missing pages behind the homepage and break
Nectar's direct navigation / 404 semantics.

## Redirects

Add redirects to `redirects.yaml` at the project root:

```yaml
- from: /feed
  to: /rss.xml
  status: 301
- from: /old-post
  to: /new-post/
  status: 301
```

Nectar's `[components.redirects]` emitter is enabled by default and writes
these rules to `dist/_redirects` in the Netlify / Cloudflare Pages format.
Cloudflare Pages treats those rules as forced redirects; the `force` flag is
only meaningful for Netlify.

## CLI deploys with `nectar deploy cloudflare`

For a manual deploy or a CI job that should call Wrangler directly, configure
the deploy target:

```toml
[deploy.cloudflare]
project_name = "my-blog"
# branch = "main" # optional preview / production label
```

Then run:

```sh
bunx nectar deploy cloudflare --build
```

The command runs `nectar build` first, checks that `dist/.nectar-manifest.json`
exists, warns if the output exceeds Cloudflare Pages' 25,000-file deployment
limit, then executes:

```sh
wrangler pages deploy dist --project-name=my-blog
```

In CI, set `CLOUDFLARE_API_TOKEN` or `CF_API_TOKEN`; otherwise Wrangler falls
back to interactive login. You can override config from the CLI:

```sh
bunx nectar deploy cloudflare --project-name my-blog --branch preview --build
```

## Large image-heavy sites

Cloudflare Pages rejects deployments above 25,000 files. If responsive image
variants push `dist/` near that limit, keep HTML, CSS, JS, and JSON on Pages
and move `dist/content/images/` to R2. See
[`cloudflare-pages-r2-images.md`](./cloudflare-pages-r2-images.md).

## Troubleshooting

- **`bunx` is not found in the Pages build:** confirm `BUN_VERSION` is set in
  the Pages environment variables and is at least `1.3.0`.
- **`nectar deploy cloudflare` asks for a project name:** set
  `[deploy.cloudflare].project_name` or pass `--project-name`.
- **Wrangler prompts for login in CI:** set `CLOUDFLARE_API_TOKEN` or
  `CF_API_TOKEN`.
- **Redirects do not work:** confirm `redirects.yaml` is at the project root,
  `[components.redirects].enabled` is not `false`, and `dist/_redirects`
  exists after the build.
- **Security headers need to be stricter:** start with
  [`docs/security/hosting.md`](../security/hosting.md), then adjust
  `[deploy.headers]` in `nectar.toml`.
