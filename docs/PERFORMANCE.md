# Performance guide

Nectar is designed to keep static builds predictable as a site grows. Use this
page to decide whether a build is healthy, how to reproduce the project
benchmark locally, and which host settings keep the generated site fast after
deploy.

## Target metrics

These are engineering targets for a normal content site using the bundled
Source theme, Markdown posts, no remote network calls during build, and a warm
developer machine or CI runner with at least 2 vCPU and 4 GB RAM:

| Metric | Target | Notes |
| --- | --- | --- |
| Full build for 1k posts | <3s | Run with image resizing disabled or with an already-warm image cache when measuring HTML/template throughput. |
| Route render time | <0.5ms/route average | Measure with `--dry-run --profile` or `bun run bench:performance`; this isolates route planning and Handlebars rendering from deploy uploads. |
| No-change incremental build | >=95% routes skipped | After the first build, unchanged routes should be reused from the build manifest. |
| One-post edit incremental build | Re-render the edited post plus indexes/archives only | A single post edit should not force every detail page to be rewritten. |
| Peak RSS for 1k posts | <512 MiB | Higher values usually mean large images are being decoded or an optional indexer is enabled. |

Treat these numbers as guardrails, not a public SLA. Different themes, helper
usage, syntax highlighting, search indexers, and image transforms can move the
numbers materially. When a build misses the target, compare the profiler output
before changing application code.

## Running the benchmark

The benchmark lives outside the regular `bun test` suite so CI does not pay for
1,000 generated posts on every push.

```sh
bun run bench:performance
```

The script prints a compact table with:

- a full build for the generated 1k-post site
- a no-change incremental build
- a one-post-edit incremental build
- average render milliseconds per route
- rendered/skipped route counts
- peak RSS when the profiler is available

For quick smoke runs while editing the benchmark itself:

```sh
NECTAR_BENCH_POSTS=100 bun run bench:performance
```

Use `NECTAR_BENCH_KEEP=1` to keep the temporary site path printed at the end of
the run for inspection.

## Suggested host configuration

Nectar emits static files, so request-time behavior belongs to the host or CDN.
Start with the security baseline in [`docs/security/hosting.md`](./security/hosting.md),
then add these performance headers:

```http
# Fingerprinted theme assets and generated image variants.
Cache-Control: public, max-age=31536000, immutable

# HTML routes, feeds, sitemaps, search JSON, and Content API JSON.
Cache-Control: public, max-age=0, must-revalidate

# Precompressed text assets, when emitted.
Vary: Accept-Encoding

# Brotli/gzip files should keep the original MIME type.
X-Content-Type-Options: nosniff
```

Host-specific notes:

- Cloudflare Pages, Netlify, Vercel, Apache, nginx, and Caddy can receive
  generated header artifacts from Nectar. Prefer those generated files over
  dashboard-only rules so header drift is reviewable.
- For hosts that can turn `Link: rel=preload` response headers into
  `103 Early Hints`, opt in with `[deploy.early_hints].enabled = true`.
  Nectar remains a file-only SSG: it writes per-route `early-hints.json`
  artifacts and, when Cloudflare Pages or Netlify header output is enabled,
  route-specific `Link` entries in `_headers`. Only same-origin preloads that
  match known built theme/card assets are emitted.
- GitHub Pages cannot set arbitrary response headers. Put Cloudflare, another
  CDN, or a reverse proxy in front of it when cache/security headers matter.
- Use long-lived immutable caching only for fingerprinted assets. Do not apply
  immutable caching to HTML routes unless the deploy system changes URLs on
  every release.
- Keep redirects and trailing-slash rewrites at the edge. A static file host
  should not need an origin function for normal page requests.

## Image guidance

Images dominate output size and build time once a site grows past a few hundred
posts.

- Keep source raster images at max 5MB. Nectar's `build.max_image_bytes`
  default is 5 MiB (`5242880`) and rejects larger copied raster images so one
  camera-original JPEG does not slow the whole deploy.
- Prefer WebP or AVIF for generated variants. The default WebP path is a good
  balance; add AVIF only when the extra encoding time is acceptable.
- Resize originals before committing when the image will never display above
  roughly 2400px wide.
- Keep SVGs for logos and simple illustrations. They are copied as scalable
  assets and are not raster-resized.
- For image-heavy sites on Cloudflare Pages, check the file count before
  deploy. If `find dist -type f | wc -l` approaches 20,000, move variants to
  the R2 image-origin pattern documented in
  [`docs/deploy/cloudflare-pages-r2-images.md`](./deploy/cloudflare-pages-r2-images.md).

## Worked example: incremental builds

Incremental builds depend on the manifest emitted into `dist/`. The first build
has no prior route hashes, so every route renders:

```sh
bunx nectar build --profile
# rendered: 1,126, skipped: 0
```

Run the same build again without changing content or theme files. The manifest
hashes match, so Nectar preserves every route and rewrites only the supporting
metadata that must be refreshed:

```sh
bunx nectar build --profile
# rendered: 0, skipped: 1,126
```

Now edit one post:

```sh
printf '\nUpdated benchmark note.\n' >> content/posts/post-0420.md
bunx nectar build --profile
# rendered: 8, skipped: 1,118
```

The edited post route re-renders, and any route that embeds that post
(home/index pagination, tag archives, author archives, feeds, or search data
depending on config) may also update. Unrelated post detail pages should stay
skipped. If a one-post edit renders every route, inspect
`dist/.nectar-build-stats.json` and `dist/.nectar/build-manifest.json` before
changing templates; the usual causes are a changed global config value, a theme
file timestamp/content change, or deleting the previous `dist/` manifest.

## Reading profiler output

Run:

```sh
bunx nectar build --profile
```

Then inspect `dist/.nectar-build-stats.json`:

- `totalDurationMs` shows end-to-end build time.
- `phases[]` shows config/content/route/render/write/asset time.
- `routes[]` includes per-route render time and whether the route was reused.
- `slowestRoutes[]` identifies templates or content that need closer review.
- `helperHotspots[]` shows expensive helper calls when theme logic dominates.

When reporting performance regressions, include the benchmark command, post
count, Bun version, CPU/RAM class, whether image resizing/search was enabled,
and the relevant `slowestRoutes` / `helperHotspots` entries.
