# 4. Deploy to Cloudflare Pages, Vercel, Netlify, Firebase Hosting, Render, DigitalOcean App Platform, GitHub Pages, S3 + CloudFront, Bunny.net, nginx, Docker, or Fly.io

**Goal:** `dist/` live on the internet, rebuilt on every Git push.

Nectar emits plain static files. Any static host or web server will serve
them. The configs below are the minimum to get a working CI build on each
major free-tier host, plus Render Static Sites, DigitalOcean App Platform,
Firebase Hosting, AWS-native S3 + CloudFront, Bunny.net Storage + CDN, and
self-hosted nginx quickstarts. Docker is covered as both a runtime wrapper
around a pre-built `dist/` directory and a multi-stage Bun build + nginx serve
image; Nectar ships
[`examples/docker/Dockerfile`](../../examples/docker/Dockerfile),
[`examples/docker/Dockerfile.multi-stage`](../../examples/docker/Dockerfile.multi-stage),
and [`examples/docker/nginx.conf`](../../examples/docker/nginx.conf). Fly.io is
covered as a container runtime around that pre-built output, using Nectar's
generated `dist/.nectar/nginx.conf` for redirects and headers.

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

For the focused Docker guide, including the sample
[`examples/docker/Dockerfile`](../../examples/docker/Dockerfile),
[`examples/docker/Dockerfile.multi-stage`](../../examples/docker/Dockerfile.multi-stage),
[`examples/docker/nginx.conf`](../../examples/docker/nginx.conf), and nginx
config caveats, see
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
headers. For a reusable image, copy `examples/docker/Dockerfile` and
`examples/docker/nginx.conf` into your project root after building `dist/`,
then run `docker build`.

If your host expects the Docker build itself to install dependencies and build
the site, copy
[`examples/docker/Dockerfile.multi-stage`](../../examples/docker/Dockerfile.multi-stage)
instead. It runs `bun install`, `bunx nectar build`, then copies the generated
`dist/` into the same nginx runtime image.

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

## Fly.io

**Recommended for:** teams that want Fly's container rollout model, regions,
and TLS while serving a static Nectar build.

For the focused Fly guide, including the generated nginx config flow, see
[`docs/deploy/fly.md`](../deploy/fly.md).

Enable the nginx deploy target with the document root used inside the Fly
container:

```toml
[deploy.nginx]
enabled = true
root = "/usr/share/nginx/html"
server_name = "_"
```

Copy the sample runtime files to the project root:

```bash
cp examples/fly/fly.toml fly.toml
cp examples/fly/Dockerfile Dockerfile
```

The sample `Dockerfile` serves the already-built `dist/` directory with nginx
and copies `dist/.nectar/nginx.conf` into `/etc/nginx/conf.d/default.conf`.
That generated config translates `redirects.yaml` and `[deploy.headers]` into
nginx rules for Fly. The checked-in `examples/fly/nginx.conf` remains available
only as a static fallback if you intentionally do not enable `[deploy.nginx]`.

Create the Fly app once:

```bash
flyctl launch --no-deploy
```

Then edit `app` and `primary_region` in `fly.toml`. The sample points Fly's
HTTP service at nginx port 80:

```toml
app = "my-nectar-site"
primary_region = "sjc"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 80
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
```

Copy [`examples/ci/fly.yml`](../../examples/ci/fly.yml) to
`.github/workflows/fly.yml`, add repository secret `FLY_API_TOKEN`, and push
to `main`. The workflow builds `dist/` with Bun, then runs
`flyctl deploy --remote-only`.

The sample removes `brotli_static` from the generated config during Docker
build because stock `nginx:alpine` does not ship the Brotli static module. Use
a Brotli-enabled nginx image and remove that `sed` line if your Fly runtime
should serve `.br` sidecars directly.

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

Nectar also emits `dist/404.html` on every build. Because the Cloudflare Pages
build output directory is `dist`, that file is deployed at the publish root as
`404.html`; Pages automatically uses it as the custom 404 page for unmatched
static routes. You do not need a catch-all `_redirects` rewrite to route missing
paths to `/404.html`.

```toml
[deploy.cloudflare_pages]
enabled = true
```

If you deploy `dist/` through Cloudflare Workers Static Assets rather than
Pages, configure the asset bundle to use Nectar's generated 404 page:

```toml
[assets]
directory = "./dist"
not_found_handling = "404-page"
```

Nectar is a multi-page static site, so direct navigation should resolve the
matching HTML file and real misses should use `dist/404.html`. Avoid
`not_found_handling = "single-page-application"` for normal Nectar deploys
because it can serve the homepage for missing navigation requests and weaken
the intended 404 behavior.

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

Advanced users who want GitHub Actions to call Wrangler directly can copy
[`examples/ci/cloudflare-pages.yml`](../../examples/ci/cloudflare-pages.yml)
to `.github/workflows/cloudflare-pages.yml`. It builds `dist/`, then runs
`wrangler pages deploy dist --project-name=...` through
`cloudflare/wrangler-action`. If Wrangler should also manage Pages Functions,
bindings, or compatibility settings, copy
[`examples/deploy/cloudflare-pages/wrangler.toml`](../../examples/deploy/cloudflare-pages/wrangler.toml)
to the project root and keep its `name` aligned with the workflow's
`CLOUDFLARE_PROJECT_NAME`.

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

Nectar is not a Next.js project; it builds static files into `dist/` directly.
Do not add Next.js `output: 'export'`, `next.config.js`, or Vercel adapter
settings for this deploy path. Use Vercel's `Other` preset with the `dist`
output directory instead.

Every Nectar build includes `dist/404.html`. On Vercel, that root-level file
is served as the custom not-found page for unmatched static routes, with a 404
status, so the standard setup above does not need a catch-all rewrite for
`404.html`.

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

## Firebase Hosting

**Recommended for:** teams already using Firebase projects and custom domains.

For the full Firebase-specific guide, including a minimal `firebase.json`,
redirect notes, and header caveats, see
[`docs/deploy/firebase-hosting.md`](../deploy/firebase-hosting.md).

Nectar does not currently have a Firebase emitter or `nectar deploy firebase`
command. Build the static site first, then let the Firebase CLI upload
`dist/`:

```bash
bunx nectar build
firebase deploy --only hosting
```

Use `dist` as the Hosting public directory and do not configure the site as a
single-page app:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"]
  }
}
```

Firebase ignores Netlify / Cloudflare-style `dist/_redirects` files. Put
redirects and custom response headers in `firebase.json` until Nectar grows a
Firebase-specific emitter.

Leave `trailingSlash` unset for Nectar. Firebase's default behavior already
serves Nectar's generated directory indexes, such as `dist/about/index.html`,
at trailing-slash URLs like `/about/`. Use `cleanUrls` only if you also copy
standalone `.html` files into `dist/` and want Firebase to expose them without
the extension; it is not required for Nectar's route pages.

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

For deploy previews and branch deploys, Netlify sets `DEPLOY_PRIME_URL`.
Nectar uses that value automatically as `site.url` for the build, falling back
to `DEPLOY_URL` and then `URL` if needed. Canonical links, `og:url`, RSS,
robots, and sitemap output therefore point at the preview hostname. Explicit
overrides still win: `--base-url` takes precedence over `NECTAR_BUILD_BASE_URL`,
then `NECTAR_SITE_URL`, then the Netlify deploy URL, then the configured
`[site] url`.

Nectar emits `dist/404.html` on every build. If your theme provides
`error-404.hbs`, that template becomes the file; otherwise Nectar writes a
default branded noindex page. Netlify automatically uses a publish-root
`404.html` as the custom response body for unmatched paths, so do not add a
catch-all `/* /404.html 404` redirect unless you are intentionally replacing
Netlify's built-in static 404 behavior.

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

## DigitalOcean App Platform

**Recommended for:** teams already using DigitalOcean and wanting a managed
Git-connected static site.

For the focused App Platform guide, including the current no-App-Spec-emitter
status, see
[`docs/deploy/digitalocean-app-platform.md`](../deploy/digitalocean-app-platform.md).

In DigitalOcean, create an App Platform app from your Git repository and
configure the resource as a static site:

| Field | Value |
| --- | --- |
| Source directory | `/` unless Nectar lives in a monorepo subdirectory |
| Build command | `bunx nectar build` |
| Output directory | `dist` |

DigitalOcean can scan for common static output directories, including `dist`,
but setting it explicitly makes the deploy contract clear. App Platform
detects Bun from `bun.lock` / `bun.lockb`; set a build-time `BUN_VERSION`
environment variable if you want to pin the builder. Nectar does not currently
emit `.do/app.yaml`, DigitalOcean headers, or DigitalOcean redirects; keep any
App Spec sample minimal and configure App Platform-owned behavior in
DigitalOcean or an external edge layer.

```yaml
name: my-nectar-site
static_sites:
  - name: web
    github:
      repo: your-org/your-repo
      branch: main
      deploy_on_push: true
    source_dir: /
    build_command: bunx nectar build
    output_dir: dist
    envs:
      - key: BUN_VERSION
        value: "1.3.0"
        scope: BUILD_TIME
```

---

## Render Static Sites

**Recommended for:** simple Git-connected static hosting on Render, especially
when the site lives next to other Render services.

For the focused Render guide, including the optional deploy-hook workflow and
current header / redirect limitations, see
[`docs/deploy/render.md`](../deploy/render.md).

1. Render dashboard -> **New -> Static Site**.
2. Connect the Git repo that contains the Nectar project.
3. In the service settings:

   | Field             | Value                                                  |
   | ----------------- | ------------------------------------------------------ |
   | Build command     | `bun install --frozen-lockfile && bunx nectar build`   |
   | Publish directory | `dist`                                                 |
   | Root directory    | *(blank, unless monorepo)*                             |

4. Environment variables -> add **`BUN_VERSION` = `1.3.0`**.
5. Save and deploy.

If you prefer Render Blueprints, copy
[`examples/render/render.yaml`](../../examples/render/render.yaml) to
`render.yaml` at the repository root. The sample defines a Static Site service
that runs `bun install && bun run build` and publishes `./dist`.

Render serves the generated `dist/` directory directly. Nectar does not
currently emit a Render-specific `render.yaml`, nor does it translate
`[deploy.headers]` or `redirects.yaml` into Render-native dashboard rules.
Configure custom headers and redirects in Render for now. The optional
[`examples/ci/render.yml`](../../examples/ci/render.yml) workflow can build
`dist/` in GitHub Actions before calling a Render deploy hook, but Render still
performs the final checkout, build, and publish.

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

The generated not-found page stays at `dist/404.html` for both user /
organization sites and project sites. For a project site,
`base_path = "/<repo>/"` changes URLs in the HTML, but it does not nest the
artifact under `dist/<repo>/`; GitHub Pages serves the root `404.html` at
`https://<user>.github.io/<repo>/404.html`.

---

## S3 + CloudFront

**Recommended for:** teams already operating in AWS, private S3 origins, and
CloudFront-managed TLS / caching.

For the focused AWS guide, including OIDC setup, the CloudFront Function for
directory-style URLs, CloudFront custom error responses for `404.html`, and
`nectar deploy s3`, see
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

If your site has `redirects.yaml`, S3 + CloudFront will not read the generated
`dist/_redirects` file. Generate a CloudFront Function from that YAML instead:

```bash
bun scripts/generate-cloudfront-redirects.ts \
  --out cloudfront-redirects.generated.js
```

The output follows
[`examples/deploy/s3-cloudfront/cloudfront-redirects.js`](../../examples/deploy/s3-cloudfront/cloudfront-redirects.js)
and inlines an exact-URI redirect map for 301, 302, 307, and 308 responses.
Publish the generated function on the viewer-request event before the request
reaches the S3 origin.

Also configure CloudFront custom error responses for both `403` and `404`
origin errors. Point them at `/404.html` and keep the viewer response code as
`404`. Private S3 origins can report a missing key as `403` or `404` depending
on bucket permissions; mapping both errors gives visitors Nectar's generated
not-found page without turning real misses into successful `200` responses.

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

## Bunny.net

**Recommended for:** Bunny CDN users who want to host the complete static
`dist/` output in Bunny Storage and deliver it through a Pull Zone.

For the focused Bunny.net guide, including the current no-emitter/no
`nectar deploy bunny` status, see [`docs/deploy/bunny.md`](../deploy/bunny.md).

The minimal flow is:

1. Build locally:

   ```bash
   bunx nectar build
   test -f dist/.nectar-manifest.json
   ```

2. In Bunny, create a Storage Zone, then create or connect a Pull Zone with
   **Origin Type = Storage Zone**.
3. Upload the contents of `dist/` to the root of the Storage Zone using the
   dashboard, Bunny's HTTP Storage API, FTP, or a storage-sync tool that
   matches your CI policy.
4. Serve and verify the site through the Pull Zone hostname, not the Storage
   API endpoint:

   ```bash
   curl -sI https://my-blog.b-cdn.net/ | sort
   curl -sI https://my-blog.b-cdn.net/about/ | sort
   curl -sI https://my-blog.b-cdn.net/404.html | sort
   ```

Bunny does not consume Nectar's `_headers`, `_redirects`, `vercel.json`, or
`dist/.nectar/nginx.conf` files. Configure cache headers, security headers,
redirects, custom hostnames, SSL, stale-file cleanup, and CDN purges in Bunny
or your deploy pipeline. If you need redirect fallbacks without Bunny Edge
Rules, `[components.redirects].emit_html = true` can emit browser-level
fallback pages, but those responses are still `200`.

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
uses `dist/404.html` as the nginx 404 response body before turning redirect
rules into nginx `return` directives.

---

## Troubleshooting deploys

- **Build runs locally, fails in CI.** Usually a missing Bun. Confirm the
  host installed Bun ≥ 1.3 (Cloudflare/Netlify need `BUN_VERSION` env;
  Render needs `BUN_VERSION`; Vercel auto-detects from `bun.lock`; GitHub
  Actions needs `setup-bun@v2`).
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
- **GitHub Pages ignores your project-site 404 page.** Keep the generated file
  at `dist/404.html`. Do not move it to `dist/<repo>/404.html`; the repo name
  belongs in `[build].base_path`, not in the artifact layout.
- **S3 + CloudFront returns 403 or 404 for nested pages or missing URLs.**
  CloudFront's default root object only covers `/`. Attach the CloudFront
  Function from `examples/s3-cloudfront/append-index.js` so directory-style
  URLs request each page's generated `index.html`, and configure custom error
  responses for `403` and `404` so true misses serve `/404.html` with viewer
  status `404`.
- **S3 + CloudFront ignores redirects.yaml.** Generate the CloudFront Function
  sample from `examples/deploy/s3-cloudfront/cloudfront-redirects.js` with
  `scripts/generate-cloudfront-redirects.ts`, then publish the generated
  function on the viewer-request event.
- **Render deploys but redirects or headers do not apply.** Render Static
  Sites do not consume Nectar's generated `_redirects` / `_headers` as a
  platform contract. Configure those rules in the Render dashboard until
  Nectar has a Render-specific emitter.
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
