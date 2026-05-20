# 4. Deploy to Cloudflare Pages, Vercel, Netlify, GitHub Pages, S3 + CloudFront, nginx, or Docker

**Goal:** `dist/` live on the internet, rebuilt on every Git push.

Nectar emits plain static files. Any static host or web server will serve
them. The configs below are the minimum to get a working CI build on each
major free-tier host, plus AWS-native S3 + CloudFront and self-hosted nginx
quickstarts. Docker is covered as a runtime wrapper around a pre-built
`dist/` directory; Nectar does not currently ship a Dockerfile, compose file,
or Docker-specific package script.

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

## Docker / nginx container

**Recommended for:** hosts that require a container image, or local smoke
tests of the built static output.

For the focused Docker guide, including the current no-Dockerfile/no-compose
status and nginx config caveats, see
[`docs/deploy/docker.md`](../deploy/docker.md).

Nectar does not build inside a container by default. Build first, then mount
`dist/` into an external nginx container:

```bash
bunx nectar build
docker run --rm \
  --name nectar-static \
  -p 8080:80 \
  -v "$PWD/dist:/usr/share/nginx/html:ro" \
  nginx:alpine
```

Open `http://localhost:8080/`. This minimal command uses nginx's stock config,
so it does not apply Nectar-generated redirects, cache headers, or security
headers.

For a closer self-hosted nginx setup, enable the existing nginx emitter:

```toml
[deploy.nginx]
enabled = true
root = "/var/www/nectar"
server_name = "_"
```

Then rebuild and use `dist/.nectar/nginx.conf` with an nginx image compatible
with the generated directives. The generated config includes `brotli_static`;
the stock `nginx:alpine` image may not include that module, so treat the
default-config command above as the portable smoke test.

---

## Cloudflare Pages

**Recommended for:** global CDN edge, generous free tier, zero config.

For the full Cloudflare-specific guide, including `nectar deploy cloudflare`,
see [`docs/deploy/cloudflare-pages.md`](../deploy/cloudflare-pages.md).

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
Cloudflare. Set `[deploy.cloudflare_pages].enabled = true` in `nectar.toml` and
Nectar will write `_headers` plus `_routes.json` on every build. Custom
redirects go in a `redirects.yaml` at the project root; the default
`[components.redirects]` emitter writes them to `dist/_redirects`. Supported
status codes are 301, 302, 307, and 308; the first rule per `from` wins on
overlap.

```toml
[deploy.cloudflare_pages]
enabled = true
```

```yaml
# redirects.yaml
- from: /feed
  to: /rss.xml
  status: 301
- from: /old-post
  to: /new-post
```

For direct deploys outside the Git-connected Pages build, configure the Pages
project name and let Nectar call Wrangler:

```toml
[deploy.cloudflare]
project_name = "my-blog"
```

```bash
bunx nectar deploy cloudflare --build
```

### Cloudflare Pages + R2 for large image libraries

Cloudflare Pages accepts at most 25,000 files per deploy. If
`dist/content/images/` contains thousands of responsive image variants, keep
the static site on Pages and sync only the image subtree to Cloudflare R2.

First check the build size:

```bash
bunx nectar build
find dist -type f | wc -l
```

Then create an R2 bucket, generate an R2 API token, and sync images with the
R2 S3-compatible endpoint:

```bash
export AWS_ACCESS_KEY_ID=<r2-access-key-id>
export AWS_SECRET_ACCESS_KEY=<r2-secret-access-key>
export AWS_DEFAULT_REGION=auto

aws s3 sync dist/content/images/ s3://my-blog-images/content/images/ \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --delete
```

Move `dist/content/images/` out of the Pages upload before `wrangler pages
deploy`, then restore it for the R2 sync step. A Worker mounted on
`/content/images/*` can read the private R2 bucket and keep image URLs
same-origin.

Nectar also has an R2 deploy target:

```toml
[deploy.r2]
bucket = "my-blog-static"
endpoint = "https://<account-id>.r2.cloudflarestorage.com"
delete = true
```

```bash
bunx nectar deploy r2 --build --dry-run
```

That command syncs the whole build output directory (`dist/` by default) to
the bucket root. For the Pages + R2 split, use the scoped `aws s3 sync
dist/content/images/ ...` command above. See
[`docs/deploy/cloudflare-pages-r2-images.md`](../deploy/cloudflare-pages-r2-images.md)
for the full Worker, custom-domain, and CI workflow.

---

## Vercel

**Recommended for:** the simplest end-to-end Git-to-URL flow.

For the full Vercel-specific guide, including generated `vercel.json`,
prebuilt GitHub Actions deploys, and `nectar deploy vercel`, see
[`docs/deploy/vercel.md`](../deploy/vercel.md).

Enable the Vercel emitter in `nectar.toml` so builds include Vercel-formatted
headers and redirects:

```toml
[deploy.vercel]
enabled = true
```

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
required for the default Git-connected build.

Custom redirects go in `redirects.yaml`; with `[deploy.vercel].enabled = true`,
Nectar folds them into `dist/vercel.json` alongside cache and security
headers. Supported status codes are 301, 302, 307, and 308; the first rule per
`from` wins on overlap. Vercel always applies redirects even when a static file
exists at the source path, so `force` is only informational on this target.

```yaml
# redirects.yaml
- from: /feed
  to: /rss.xml
  status: 301
- from: /old-post/
  to: /new-post/
  status: 308
```

For direct deploys outside the Git-connected Vercel build, let Nectar call the
Vercel CLI:

```bash
bunx nectar deploy vercel --build
```

The command runs `nectar build`, checks for `dist/.nectar-manifest.json`, then
executes `vercel deploy dist --prod`. Set `VERCEL_TOKEN` in CI, and use
`bunx nectar deploy vercel --dry-run` to audit the command before uploading.

---

## Netlify

**Recommended for:** form handling, branch previews, plugin ecosystem.

Enable the Netlify emitter in `nectar.toml` so builds include the generated
`_headers` file and Netlify-formatted redirects:

```toml
[deploy.netlify]
enabled = true
```

Then copy
[`examples/deploy/netlify/netlify.toml`](../../examples/deploy/netlify/netlify.toml)
to `netlify.toml` at the repo root:

```toml
[build]
  command = "bunx nectar build"
  publish = "dist"

[build.environment]
  BUN_VERSION = "1.3.0"
```

Then **Netlify dashboard → Add new site → Import from Git → pick repo →
Deploy**. The `netlify.toml` overrides any guesses Netlify makes.

Netlify's Bun support is via the `BUN_VERSION` build environment variable —
without it, the build runs Node and `bunx` will fail. The sample also shows
where optional Netlify build plugin blocks belong; Nectar build-time plugins
stay in `nectar.toml`'s top-level `plugins` array.

Custom redirects go in `redirects.yaml`; Nectar emits them to
`dist/_redirects` when `[deploy.netlify].enabled = true`. Netlify's
`force: true` semantics are supported via the `!` status suffix:

```yaml
# redirects.yaml
- from: /feed
  to: /rss.xml
  status: 301
  force: true
```

For CI-driven deploys, Netlify CLI uploads, and header customization details,
see [`docs/deploy/netlify.md`](../deploy/netlify.md).

---

## GitHub Pages

**Recommended for:** repos already on GitHub, no extra account needed.

GitHub Pages does not run Bun, so the build has to happen in GitHub Actions
and the resulting `dist/` is uploaded as the Pages artifact.

For the focused quickstart, custom-domain notes, and branch-deploy caveats,
see [`docs/deploy/github-pages.md`](../deploy/github-pages.md). The minimal
workflow setup is included here so this tutorial stays self-contained.

Copy [`examples/ci/github-pages.yml`](../../examples/ci/github-pages.yml)
to `.github/workflows/pages.yml` in your repo — it's the workflow below,
ready to use as-is:

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
    name: Build site
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.0
      - run: bun install --frozen-lockfile
      - run: bunx nectar build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    name: Deploy to Pages
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

Nectar also writes `dist/.nojekyll` on every successful build so GitHub Pages
serves underscore-prefixed assets and directories instead of running them
through Jekyll. If `[deploy.github_pages].custom_domain` is set, the build
writes `dist/CNAME` with that hostname for Pages custom-domain binding.

---

## S3 + CloudFront

**Recommended for:** teams already operating in AWS, private S3 origins, and
CloudFront-managed TLS / caching.

For the focused AWS guide, including OIDC setup, the CloudFront Function for
directory-style URLs, and `nectar deploy s3`, see
[`docs/deploy/s3-cloudfront.md`](../deploy/s3-cloudfront.md).

Copy [`examples/ci/s3-cloudfront.yml`](../../examples/ci/s3-cloudfront.yml)
to `.github/workflows/s3-cloudfront.yml`, then set:

| Type | Name |
| --- | --- |
| Secret | `AWS_ROLE_TO_ASSUME` |
| Secret | `CLOUDFRONT_DISTRIBUTION_ID` |
| Variable | `AWS_REGION` |
| Variable | `S3_BUCKET` |

The workflow builds with Bun, verifies `dist/.nectar-manifest.json`, syncs
`dist/` to S3 with cache-control metadata, and invalidates CloudFront. Pair a
private S3 origin with the CloudFront Function at
[`examples/s3-cloudfront/append-index.js`](../../examples/s3-cloudfront/append-index.js)
so `/about/` resolves to Nectar's generated `/about/index.html` object.

For local uploads after a successful build, configure:

```toml
[deploy.s3]
bucket = "my-blog-prod"
region = "us-east-1"
# delete = true
```

Then run:

```bash
bunx nectar deploy s3 --build
```

The CLI wraps `aws s3 sync dist s3://<bucket>` and forwards `--region` when
configured. It does not create CloudFront invalidations or apply the
workflow's split cache-control metadata; keep using the workflow for the full
production S3 + CloudFront path.

---

## nginx

**Recommended for:** self-hosted VPS deployments and Ghost migrations already
running behind nginx.

For the focused nginx guide, including TLS notes and troubleshooting, see
[`docs/deploy/nginx.md`](../deploy/nginx.md).

1. Enable the nginx deploy target and set the filesystem root nginx will serve:

   ```toml
   [deploy.nginx]
   enabled = true
   root = "/var/www/nectar"
   server_name = "example.com"
   ```

2. Build locally and confirm the generated config exists:

   ```bash
   bunx nectar build
   test -f dist/.nectar/nginx.conf
   ```

3. Sync the complete `dist/` directory to the server:

   ```bash
   rsync -avz --delete dist/ user@host:/var/www/nectar/
   ```

4. Include the generated server block from nginx's main config, under the
   top-level `http { ... }` context:

   ```nginx
   include /var/www/nectar/.nectar/nginx.conf;
   ```

5. Test and reload nginx on the server:

   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

The generated file folds `[deploy.headers]` and `redirects.yaml` into a full
`server { ... }` block at `dist/.nectar/nginx.conf`. It sets `Cache-Control`
for Nectar's default asset paths, repeats security headers inside each
`location`, enables `gzip_static` and `brotli_static`, serves
`slug/index.html` URLs with `try_files $uri $uri/ $uri/index.html =404;`, and
turns redirect rules into nginx `return` directives.

---

## Troubleshooting deploys

- **Build runs locally, fails in CI.** Usually a missing Bun. Confirm the
  host installed Bun ≥ 1.3 (Cloudflare/Netlify need `BUN_VERSION` env;
  Vercel auto-detects from `bun.lock`; GitHub Actions needs `setup-bun@v2`).
- **404 on direct page loads in production.** Your host is stripping
  trailing slashes. Add a redirect rule (`netlify.toml`, `vercel.json`,
  `_redirects`) or configure "Always append trailing slash" in the host's
  settings. On nginx, confirm the generated `try_files $uri $uri/
  $uri/index.html =404;` block is the one handling the request.
- **`nginx -t` fails on `brotli_static`.** Your nginx build does not have the
  Brotli module loaded. Install an nginx package with Brotli support, load the
  module, or remove `brotli_static on;` from the deployed include.
- **Assets 404 with `/<repo>/...` prefix on GitHub Pages.** You missed
  `[build] base_path`. Set it to your subdirectory path with leading and
  trailing slash, e.g. `"/my-blog/"`, and rebuild.
- **S3 + CloudFront returns 403 or 404 for nested pages.** CloudFront's
  default root object only covers `/`. Attach the CloudFront Function from
  `examples/s3-cloudfront/append-index.js` so directory-style URLs request
  each page's generated `index.html`.
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

## Security headers

The configs above get the site live, but most hosted platforms still need a
stricter security header baseline. Static hosts default to no CSP, no HSTS,
no Referrer-Policy on most free tiers — fine for a personal site, risky once
you accept contributions to `content/`, enable `build.allow_code_injection`,
or serve a custom domain.

See [`docs/security/hosting.md`](../security/hosting.md) for
copy-pasteable `_headers` / `vercel.json` / `netlify.toml` snippets with
a Nectar-calibrated baseline `Content-Security-Policy`,
`Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`, and
related headers. nginx users should set the same values under
`[deploy.headers].security` so they are emitted into
`dist/.nectar/nginx.conf`. GitHub Pages users will find the workarounds for
the host's hard-coded headers there too.
