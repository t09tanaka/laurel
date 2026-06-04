# `examples/` — deploy snippets and starter templates

This directory collects **small, copy-pasteable artifacts** that help real users
get a Laurel site off the ground. It is *not* the same as `example/` (singular),
which is the reference blog used by tests and the design docs to prove that the
vendored Ghost Source theme renders end-to-end. Treat `example/` as the
"litmus-test site" and `examples/` as the "starter kit aisle".

## What lives here today

| Folder                     | Purpose                                                                 |
|----------------------------|-------------------------------------------------------------------------|
| `ci/`                      | GitHub Actions workflow templates for shipping a Laurel build to popular static hosts (GitHub Pages, Cloudflare Pages, Netlify, Vercel, Azure Static Web Apps, Firebase Hosting via `ci/firebase.yml`, S3 + CloudFront, Fly.io, Render). See `ci/README.md` for the per-host setup matrix. |
| `fly/fly.toml`             | Fly.io nginx Machine sample at `examples/fly/fly.toml` that serves a pre-built `dist/` directory with the matching `Dockerfile`, using `dist/.laurel/nginx.conf` for generated redirects and headers. `examples/fly/nginx.conf` is the static-only fallback. Pairs with `docs/deploy/fly.md`. |
| `deploy/apache/.htaccess`  | Apache HTTPD `.htaccess` with Cache-Control, ETag, security headers, and pre-compressed-sidecar serving. Pairs with `docs/deploy/apache.md`. |
| `deploy/caddy/Caddyfile`   | Caddy v2 server block with HTTPS, header pinning, and `/404.html` fallback. Pairs with `docs/deploy/caddy.md`. |
| `deploy/cloudflare-pages/wrangler.toml` | Cloudflare Pages Wrangler config with `pages_build_output_dir = "./dist"` for CI flows that run `wrangler pages deploy dist --project-name=...`. Pairs with `docs/deploy/cloudflare-pages.md`. |
| `examples/docker/Dockerfile`, `examples/docker/Dockerfile.multi-stage`, `examples/docker/.dockerignore`, `examples/docker/nginx.conf`, and `examples/docker/docker-compose.yml` | Slim `nginx:1.27-alpine` runtime image for an already-built `dist/`, plus a multi-stage Bun build + nginx serve variant with a trimmed build context and reverse-proxy compose snippet. Both Dockerfiles keep pretty URLs and `404.html` handling. Pairs with `docs/deploy/docker.md`. |
| `deploy/netlify/netlify.toml` | Netlify build config with `bunx laurel build`, `dist` publishing, `BUN_VERSION`, and a commented Netlify build-plugin block. Pairs with `docs/deploy/netlify.md`. |
| `cloudflare-workers/wrangler.toml` | Cloudflare Workers Static Assets config for serving `dist/` through a no-op worker that delegates to the `ASSETS` binding. Pairs with `docs/deploy/cloudflare-pages.md`. |
| `examples/r2/worker.ts`      | Cloudflare Worker sample for serving a full `dist/` tree from a private R2 bucket, including directory `index.html` lookup plus Laurel `_routes-manifest.json` redirects and headers. Pairs with `docs/deploy/cloudflare-pages-r2-images.md`. |
| `render/render.yaml`       | Render Blueprint sample for a Static Site that runs `bun install && bun run build` and publishes `./dist`. Pairs with `docs/deploy/render.md`. |
| `s3-cloudfront/append-index.js` | CloudFront Function (viewer-request) that rewrites `/about/` to `/about/index.html` so a private S3 origin behind CloudFront serves directory-style URLs. |
| `deploy/s3-cloudfront/terraform/` | Terraform starter for a private S3 bucket, CloudFront distribution, Origin Access Control (OAC), and bucket policy. Includes Laurel's `403` / `404` custom error responses. |
| `deploy/s3-cloudfront/cloudfront-redirects.js` | CloudFront Function sample for redirects generated from `redirects.yaml`, with the redirect map intended to be inlined by `scripts/generate-cloudfront-redirects.ts` before publishing. |
| `deploy/s3-cloudfront/cloudfront-custom-errors.tf.example` | Terraform fragment for CloudFront custom error responses that map S3-origin `403` / `404` misses to Laurel's `/404.html` while preserving viewer status `404`. |

These are deliberately tiny: a single file each, with the deploy-platform's
quirks documented in the file header. Copy → paste → fill in the blanks.

## Planned site templates

The deploy snippets above answer *where* to host a Laurel build. They do not
answer *what* the source repo of a real-world blog looks like. Issue
[#920](https://github.com/t09tanaka/laurel/issues/920) tracks adding runnable
**site templates** here, one folder per use case, each with its own
`laurel.toml`, `content/`, and theme reference. The catalog below pins the
intended scope so future PRs can land them incrementally.

Until a template ships, `example/` is the runnable reference — every template
in the list below is a focused subset or extension of it.

| Template folder                       | What it demonstrates                                                                                                | Pairs well with                                       |
|---------------------------------------|---------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| `minimal-blog/`                       | Smallest viable site: one author, a handful of posts, default Source theme, no optional components beyond RSS.       | `ci/github-pages.yml`                                 |
| `photo-blog/`                         | Image-heavy posts, `[content].copy_content_assets = true`, `{{img_url}}` and OG-image generation tuned for galleries. | `s3-cloudfront/append-index.js` (asset-heavy origin)  |
| `multi-author/`                       | Multiple `content/authors/*.md` entries, per-author archives, `{{authors}}` and contributor bylines.                  | `ci/github-pages.yml`                                 |
| `multi-language/`                     | One folder per locale, each its own `laurel.toml` + `content/` tree, demonstrating the **one-build-per-locale** rule from `docs/DESIGN.md` §1. No router fan-out — outputs are stitched at the host. | Any deploy snippet                                    |
| `members-stripe-redirect/`            | `[components.portal]` adapter wired to Stripe Checkout / Customer Portal redirects, paywall truncation via `[content].visibility_policy`. See `docs/MEMBERS.md` for the underlying contract. | Newsletter provider of choice                          |
| `newsletter-rss-only/`                | RSS + JSON feed as the only distribution surface, no on-site search/comments, Buttondown/Beehiiv embed for sign-up. | `ci/github-pages.yml`                                 |

Each template, when added, must:

1. **Be runnable in isolation.** `cd examples/<name> && bun ../../src/cli/index.ts build` produces a working `dist/` against the bundled config.
2. **Vendor or symlink the theme it needs.** Most will reuse `example/themes/source/` via a relative symlink to avoid duplicating the vendored theme. Templates that demonstrate a third-party theme bring their own.
3. **Keep `content/` tiny.** Two or three posts is enough — these are skeletons, not demo blogs.
4. **Document the `laurel.toml` knobs it exercises.** A short `README.md` in the template folder explaining *why* this config exists and which docs section it maps to (e.g. `docs/MEMBERS.md` for the members template).
5. **Stay independent of `example/`.** Tests against `example/` must keep passing without depending on anything under `examples/`.

## Contributing a new template

Open an issue or pick up [#920](https://github.com/t09tanaka/laurel/issues/920)
with the template name in the title (`docs(examples): add minimal-blog
template`). Land one template per PR — bundling templates makes review harder
and makes individual templates harder to revert if the convention shifts later.
