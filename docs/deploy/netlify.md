# Deploying Nectar to Netlify

Netlify can either build a Nectar site from Git or receive a pre-built
`dist/` directory from the Netlify CLI. This guide covers both paths, plus the
generated `_headers` / `_redirects` files Nectar writes when
`[deploy.netlify]` is enabled.

Use Netlify's Git integration when you want Netlify to own checkout, build, and
publish from a connected repository. Use the Netlify CLI path when GitHub
Actions (or another CI system) should build with Bun and upload `dist/` to a
Netlify site that is not connected to Git.

Nectar builds always include `dist/404.html`: themes can provide it with an
`error-404.hbs` template, and otherwise Nectar writes a default noindex page.
Netlify automatically serves a publish-root `404.html` as the custom 404 page
for unmatched paths, so no `_redirects` rule or `netlify.toml` fallback is
required for normal static-site 404s.

## Quickstart: Netlify builds from Git

1. Add the Netlify deploy target to `nectar.toml`:

   ```toml
   [deploy.netlify]
   enabled = true
   ```

   This makes `nectar build` write Netlify-compatible `_headers` at the
   publish root. If `redirects.yaml` exists, Nectar also writes `_redirects`
   using Netlify's `301!` force syntax for rules with `force: true`.

2. Copy
   [`examples/deploy/netlify/netlify.toml`](../../examples/deploy/netlify/netlify.toml)
   to `netlify.toml` at the repo root:

   ```toml
   [build]
     command = "bunx nectar build"
     publish = "dist"

   [build.environment]
     BUN_VERSION = "1.3.0"
   ```

   Netlify installs Bun when `BUN_VERSION` is set. Without it, the build image
   runs Node and `bunx nectar build` will fail. The sample also includes a
   commented `[[plugins]]` block for Netlify build plugins; keep Nectar
   build-time plugins in `nectar.toml`'s top-level `plugins` array.

3. In Netlify, choose **Add new site -> Import from Git**, pick the repo, and
   deploy. The checked-in `netlify.toml` should fill the build command and
   publish directory automatically.

4. After the first deploy, verify the generated files made it into the
   published artifact:

   ```sh
   curl -sI https://your-site.netlify.app/ | sort
   curl -sI https://your-site.netlify.app/missing-page | sort
   curl -sI https://your-site.netlify.app/assets/built/screen.css | sort
   ```

   The HTML response should include the baseline security headers, and
   fingerprinted assets should receive long-lived immutable cache headers. The
   missing path should return `404` while using Nectar's generated
   `404.html` body.

## Quickstart: GitHub Actions uploads `dist/`

Use this path when GitHub Actions is the deploy driver and Netlify is only the
hosting target. Do not also enable Netlify's Git integration for the same site,
or one commit can produce both a Netlify-built deploy and a CLI-uploaded
deploy.

1. Create a Netlify site without connecting a repository.
2. Add repository secrets:

   | Secret | Value |
   | --- | --- |
   | `NETLIFY_AUTH_TOKEN` | Personal access token from Netlify user settings |
   | `NETLIFY_SITE_ID` | API ID from the Netlify site settings |

3. Copy
   [`examples/ci/netlify-cli.yml`](../../examples/ci/netlify-cli.yml)
   to `.github/workflows/netlify.yml`.
4. Push to `main`. The workflow builds with Bun, uploads `dist/` with
   `bunx netlify-cli deploy --dir=dist --site="$NETLIFY_SITE_ID" --prod`, and
   creates preview deploys for pull requests without `--prod`.

The same flow can be run locally after a build:

```sh
bunx nectar build
NETLIFY_AUTH_TOKEN=<token> nectar deploy netlify --site-id <api-site-id>
```

`nectar deploy netlify` shells out to `netlify deploy --dir dist --prod`.
Set `[deploy.netlify].site_id` to avoid passing `--site-id` each time. The
command warns when `NETLIFY_AUTH_TOKEN` is missing because the Netlify CLI will
fall back to interactive login.

## Redirects

Put custom redirects in `redirects.yaml` at the project root:

```yaml
- from: /feed
  to: /rss.xml
  status: 301
  force: true
- from: /old-post/
  to: /new-post/
  status: 308
```

With `[deploy.netlify].enabled = true`, Nectar prepends those rules to
`dist/_redirects`:

```txt
# Custom redirects (from redirects.yaml)
/feed  /rss.xml  301!
/old-post/  /new-post/  308
```

`force: true` maps to Netlify's `!` suffix so the redirect fires even when a
static file exists at the source path. If two rules share the same `from`, the
first rule wins, matching Netlify's first-match behavior. Supported status
codes are `301`, `302`, `307`, and `308`; omitted status defaults to `301`.

Do not add a catch-all redirect such as `/* /404.html 404` for a normal Nectar
site. Netlify's `404.html` convention already handles missing paths after
static files and redirects are considered. A catch-all redirect can also shadow
legitimate paths if it is ordered incorrectly or marked as forced.

## Custom 404 page

Netlify's static hosting convention is publish-root `404.html`. Nectar matches
that convention by writing `dist/404.html` on every build:

- If the active theme has `error-404.hbs`, the rendered theme error route is
  written to `404.html`.
- If the theme does not provide that template, Nectar writes a small branded
  fallback page with `<meta name="robots" content="noindex">`.

Because Netlify consumes the file by name, keep `publish = "dist"` in
`netlify.toml` and avoid moving the error page into a subdirectory. To verify a
deploy, request any missing URL and confirm the response status is `404`, then
inspect `https://your-site.netlify.app/404.html` directly if you need to review
the rendered page.

When `[components.content_api].enabled = true`, Nectar also writes
`dist/content/404.json` with a Ghost-shaped `errors` envelope. This keeps
browser SDK consumers from receiving HTML when a post slug JSON file is
missing. Netlify can route missing Content API JSON requests to that file while
preserving a `404` status:

```txt
/content/*  /content/404.json  404
```

Place that rule after any real Content API redirects and do not mark it forced;
Netlify's file shadowing should let existing `dist/content/**/*.json` files win.
Verify with both an existing slug JSON URL and a missing one before enabling it
on production.

## Headers and caching

When `[deploy.netlify].enabled = true`, every build writes `dist/_headers`.
The defaults mirror Cloudflare Pages:

| Path | Cache-Control |
| --- | --- |
| `/assets/*` | `public, max-age=31536000, immutable` |
| `/content/images/*` | `public, max-age=31536000, immutable` |
| `/*` | `public, max-age=0, must-revalidate` |

The catch-all route also receives the baseline security headers from
`[deploy.headers].security`, including `X-Content-Type-Options` and
`Referrer-Policy` by default. Customize cache or security policy in
`nectar.toml` under `[deploy.headers]`; do not duplicate those rules in
`netlify.toml` unless you intentionally want Netlify-owned config to take over.

## Netlify Image CDN

Netlify can resize local Ghost-style uploads without pre-generating every image
variant. Enable Nectar's image CDN post-process when `/content/images/...`
contains many migrated images and you want emitted `<img>` tags to point at
Netlify's `/.netlify/images` endpoint:

```toml
[image_cdn]
enabled = true
adapter = "netlify"
quality = 75
path_prefixes = ["/content/images/"]
```

With that config, a theme or Markdown image such as:

```html
<img src="/content/images/2026/05/hero.jpg" width="1200" alt="">
```

is emitted as a same-origin Netlify Image CDN URL:

```html
<img src="/.netlify/images?url=%2Fcontent%2Fimages%2F2026%2F05%2Fhero.jpg&amp;w=1200&amp;q=75" width="1200" alt="">
```

Widths come from the rendered `width` attribute or `srcset` descriptor. Set
`image_cdn.default_width` if your theme emits single image URLs without a width
and you still want those URLs to include `w=`.

## Preview deploys

On Netlify Git builds, Nectar automatically uses `DEPLOY_PRIME_URL` as
`site.url` during `deploy-preview` and `branch-deploy` builds. If
`DEPLOY_PRIME_URL` is not present, it falls back to `DEPLOY_URL`, then `URL`.
That retargets canonical links, `og:url`, RSS, robots, and sitemap URLs to the
published preview hostname without editing `nectar.toml`.

The precedence is:

```text
--base-url > NECTAR_BUILD_BASE_URL > NECTAR_SITE_URL > Netlify deploy URL > site.url
```

Use `--base-url` when you need to force a different host:

```sh
bunx nectar build --base-url https://deploy-preview-42--your-site.netlify.app
```

If the preview is served from a subpath, pair that with `--base-path` or set
`[build] base_path = "/preview/"` in `nectar.toml`.

## Troubleshooting

- **`bunx: command not found` in Netlify builds:** add `BUN_VERSION = "1.3.0"`
  under `[build.environment]` in `netlify.toml`.
- **No `_headers` in the deploy:** confirm `[deploy.netlify].enabled = true`
  and that no file in the static passthrough directory overwrote `_headers`.
- **Redirect exists but does not override a real file:** set `force: true` in
  `redirects.yaml` and rebuild; the emitted status should end in `!`.
- **`nectar deploy netlify` opens an interactive login:** set
  `NETLIFY_AUTH_TOKEN` in the environment and pass `--site-id` or set
  `[deploy.netlify].site_id`.
