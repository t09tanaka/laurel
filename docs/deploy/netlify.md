# Deploying Nectar to Netlify

Netlify can either build a Nectar site from Git or receive a pre-built
`dist/` directory from the Netlify CLI. This guide covers both paths, plus the
generated `_headers` / `_redirects` files Nectar writes when
`[deploy.netlify]` is enabled.

Use Netlify's Git integration when you want Netlify to own checkout, build, and
publish from a connected repository. Use the Netlify CLI path when GitHub
Actions (or another CI system) should build with Bun and upload `dist/` to a
Netlify site that is not connected to Git.

## Quickstart: Netlify builds from Git

1. Add the Netlify deploy target to `nectar.toml`:

   ```toml
   [deploy.netlify]
   enabled = true
   ```

   This makes `nectar build` write Netlify-compatible `_headers` at the
   publish root. If `redirects.yaml` exists, Nectar also writes `_redirects`
   using Netlify's `301!` force syntax for rules with `force: true`.

2. Add `netlify.toml` at the repo root:

   ```toml
   [build]
     command = "bunx nectar build"
     publish = "dist"

   [build.environment]
     BUN_VERSION = "1.3.0"
   ```

   Netlify installs Bun when `BUN_VERSION` is set. Without it, the build image
   runs Node and `bunx nectar build` will fail.

3. In Netlify, choose **Add new site -> Import from Git**, pick the repo, and
   deploy. The checked-in `netlify.toml` should fill the build command and
   publish directory automatically.

4. After the first deploy, verify the generated files made it into the
   published artifact:

   ```sh
   curl -sI https://your-site.netlify.app/ | sort
   curl -sI https://your-site.netlify.app/assets/built/screen.css | sort
   ```

   The HTML response should include the baseline security headers, and
   fingerprinted assets should receive long-lived immutable cache headers.

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

## Preview deploys

For PR previews that need canonical URLs to point at the preview hostname,
build with `--base-url`:

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
