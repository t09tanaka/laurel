# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Entries are maintained by hand as part of the local release flow (Laurel is
published to npm with `npm publish`; there is no CI release automation).

## [Unreleased]

_Nothing yet._

## [0.3.2] - 2026-06-24

### Fixed

- Theme feature / card images now serve WebP (and AVIF) at full resolution for
  high-DPR and large viewports. When a theme `image_sizes` width meets or
  exceeds the source width, `{{img_url}}` emits the bare original URL (no
  `/content/images/size/` segment) to avoid upscaling, so the srcset mixes sized
  entries with an original-URL tail. The per-format `<source>` previously dropped
  that tail because no WebP/AVIF twin of the full-resolution original existed,
  capping WebP below the JPEG `<img>` fallback (e.g. WebP stopped at 1000w while
  JPEG kept 2000w). Laurel now materialises a full-resolution
  `/content/images/format/<fmt>/<rel>` twin for such sources and maps the
  original tail onto it, so the WebP/AVIF `<source>` keeps the largest width too.
  The mapping is guarded on a same-source sized sibling with a width descriptor
  to avoid emitting a 404 `<source>` for hand-authored mixed-source srcsets.
  (#691)

## [0.3.1] - 2026-06-24

### Fixed

- `srcset` densification now also fills card / feature image srcsets whose
  source is narrower than the theme's largest `image_sizes` width. For such
  images `{{img_url}}` emits the bare original URL (no `/content/images/size/`
  segment) for any size at or above the source width to avoid upscaling, which
  made the srcset a mix of sized and original entries; the densifier previously
  bailed on the whole `<img>`, leaving common gaps such as `600w → 1000w`
  unfilled even though the intermediate variants were generated on disk. The
  original-URL entries are now preserved as-is while the sized gaps are
  densified. (#690)

## [0.3.0] - 2026-06-24

### Added

- Responsive `srcset` densification: the new optional
  `[components.images].srcset_max_ratio` fills gaps in image `srcset`s so no two
  adjacent width candidates differ by more than the configured ratio. It inserts
  intermediate `/content/images/size/wXXX/` widths (and their per-format
  siblings) into both Laurel-injected body-image srcsets and theme-emitted
  card / feature srcsets, closing the common `600w → 1000w` gap so a browser
  needing ~700px no longer downloads the 1000w file. Inserted widths are skipped
  when they would upscale the source. Default off; requires `resize` + sharp.
  (#687)
- Static critical-CSS inlining: the new optional `[performance.critical_css]`
  inlines a per-route "used CSS" subset of each linked theme stylesheet into
  `<head>` and converts the blocking `<link rel="stylesheet">` to a
  non-blocking `media="print"` swap with a `<noscript>` fallback, removing the
  render-blocking stylesheet request. Extraction is fully static (postcss, no
  headless browser): rules are kept when their selectors reference
  tags / classes / ids / attributes present in the route HTML, with `@font-face`
  / `@keyframes` always kept, relative `url()` absolutized, and a `max_inline_kb`
  guard plus `safelist`. Default off; no new dependency. (#689)
- GA4 analytics now defers `gtag.js` until the first user interaction, keeping
  the script off the critical path. Inline analytics snippets are stamped with
  `csp_nonce` when configured. (#688)

## [0.2.0] - 2026-06-23

### Added

- `[build].precompress` accepts a format enum (`off` / `brotli` / `gzip` /
  `both`) so you can choose which precompressed sibling files (`.br` / `.gz`)
  are emitted for text outputs, and the host-config generators (`_headers`,
  nginx, Apache, etc.) are emitted to match the selected format. (#684)
- List / archive / tag / home routes now emit an LCP
  `<link rel="preload" as="image" fetchpriority="high">` for the first
  high-priority post-card image, aligned to its rendered `srcset` / `sizes` so
  the browser preloads the exact candidate it renders. Extends the existing
  feature-image preload (post / page routes) to feed pages; a no-op when the
  theme does not mark a card image `fetchpriority="high"` or when a preload
  already exists. (#686)
- `laurel build` now logs a reminder that the generated `_headers` and
  `.laurel/cloudfront-response-headers-policy.json` cache rules must be applied
  at the host (object stores such as S3 do not read them) so `/assets/*`,
  `/_images/*`, and `/content/images/*` are served immutable. (#686)

### Changed

- The shared Koenig card stylesheet (`ghost-card-assets.css`) is now injected
  only on pages whose rendered content contains card markup (`kg-*`), so list /
  archive / tag / home feeds no longer pull a render-blocking stylesheet that
  styles nothing. Mirrors the per-page gating the card runtime `<script>`
  already used. (#686)
- Card asset URLs are content-fingerprinted
  (`assets/ghost-card-assets.<hash>.css` / `.js`) instead of carrying a manual
  `?v=N` query, so they bust automatically when the generated CSS / JS changes
  and are robustly immutable-cacheable. Anything hard-coding the old `?v=` URL
  must use the fingerprinted path. (#686)

## [0.1.12] - 2026-06-22

### Added

- Theme feature images now render inside a `<picture>` element with a WebP
  `<source>` alongside the original, and the LCP preload hint is aligned to the
  same candidate so the preloaded image matches what the browser actually
  selects. Cuts feature-image bytes on WebP-capable browsers without changing
  the rendered markup for browsers that lack WebP support. (#682)

## [0.1.11] - 2026-06-19

### Fixed

- Stale-output reconciliation now runs at the `output_dir` scope when
  `emit_at_base_path` is set. Previously cleanup was scoped to the base-path
  subtree, so files left over from a prior build outside that subtree were never
  removed; the cleanup pass now covers the whole `output_dir`. (#680)

## [0.1.10] - 2026-06-19

### Added

- `[build].emit_at_base_path` mirrors the site's URL tree on disk, emitting each
  page under its base-path prefix so a subpath deploy (`https://host/blog/`)
  serves the same structure locally and in production. (#678)

### Fixed

- Subpath deploys locate the build manifest in the nested emit directory instead
  of assuming it sits at the output root. (#678)
- Native infinite-scroll detection is tightened so the pagination enhancement
  shim is skipped when the theme already owns infinite scroll, avoiding a
  double-bound scroll handler. (#679)

## [0.1.9] - 2026-06-19

### Fixed

- `laurel config set <table>.<key>` no longer writes the key into the wrong place
  when the target table is followed by an array-of-tables (`[[navigation]]`,
  `[[secondary_navigation]]`). The TOML section-boundary scan only recognized
  standard `[table]` headers, so a following `[[navigation]]` was not treated as
  a boundary and the table was assumed to run to end-of-file — the new key was
  appended after the array (parsed as `navigation.N.<key>`, rejected as an
  unknown key) and, when updating an existing key, a same-named key inside the
  array could be clobbered instead. Array-of-tables headers now end a section
  correctly, so `config set build.posts_order updated_at` writes into `[build]`
  even with `[[navigation]]` below it. (#677)

## [0.1.8] - 2026-06-19

### Added

- `[build].posts_order` (`published_at` | `updated_at`) and
  `[build].posts_order_direction` (`desc` | `asc`) make the feed sort key
  configurable. `updated_at` orders the home feed, tag / author archives, RSS,
  and sitemap by last-modified date — matching a Ghost site that sorts by
  updated date — while leaving each post's displayed publication date unchanged.
  Defaults (`published_at` / `desc`) preserve the previous ordering. Posts with
  no explicit `updated_at` fall back to their `published_at`. (#671)
- `[components.pagination].mode` (`links` | `infinite` | `load-more`) adds an
  optional infinite-scroll / load-more progressive enhancement to paginated
  feeds. `infinite` appends the next page's post cards as the reader nears the
  end of the feed (via an `IntersectionObserver` sentinel); `load-more` does the
  same behind a button. Both follow the absolute `rel="next"` URL already in the
  document, so they work under sub-path deploys (`/blog/`, `/ja/blog/`) and
  degrade to the classic `/page/N/` links when JS, `fetch`, or
  `IntersectionObserver` are unavailable. `container_selector` (default
  `.post-feed`) and `item_selector` (default `.post-card`) make it
  theme-agnostic. The default `links` mode ships no JS and is byte-identical to
  before. (#672)
- `laurel import-ghost --alt-from-filename` generates alt text from the image
  filename for post-body images that have an empty alt (e.g.
  `my-cat-photo.jpg` → "My Cat Photo"), so Ghost-migrated content stops flooding
  the build with accessibility `missing/empty alt` warnings. Off by default;
  images whose filename has no letters (hashes / bare dates) are left empty
  rather than fabricating noise, an existing alt is never overwritten, and the
  import summary reports how many were backfilled. (#676)

### Changed

- `laurel dev` now bases self-referential absolute URLs (canonical, `rel=next` /
  `rel=prev`, `og:url`, `twitter:url`, JSON-LD, RSS, sitemap) on the local dev
  origin (`http://localhost:<port>`) instead of the production `[site].url`, so
  links and the new infinite-scroll runtime resolve against the dev server
  rather than hitting production. The dev server now binds its port before the
  first build so even `--port 0` (kernel-assigned) gets the correct origin on
  the first served page. Production builds are unaffected. (#675)
- `laurel import-ghost --download-images` no longer silently leaves images as
  broken `/content/images/...` links when `--source-url` is omitted. It now
  infers the source site origin from the export's `url` setting and uses it to
  fetch images (logging which URL it inferred); if the export has no usable
  `url` (e.g. it only carries the `__GHOST_URL__` placeholder), it emits a clear
  warning telling you to pass `--source-url` instead of failing quietly. The
  inferred URL also feeds the in-body link rewriter, and an explicit
  `--source-url` still wins. (#674)

### Fixed

- A Laurel version upgrade now fully invalidates the persistent Markdown render
  cache (`.laurel/cache/markdown`). The build manifest already folds the version
  into route reuse, but the render cache — which holds each post's rendered body
  HTML and lives outside the manifest — keyed only on the source file and render
  options, so a release that changed Markdown rendering could keep serving the
  previous version's body HTML (notably under `laurel dev`) until `laurel clean`.
  The running version is now part of the render cache key. (#673)

## [0.1.7] - 2026-06-18

### Fixed

- The build no longer adds `defer` to an external `<script src>` when a classic
  inline `<script>` follows it in the document. Auto-deferring such a script
  reorders it after the inline runs (an inline script cannot defer), which broke
  the common "load a library externally, use it from the next inline script"
  pattern — e.g. a jQuery-based Ghost theme threw `$ is not defined`. The
  performance default still defers external scripts that have no order-blocking
  inline script after them; data (`application/ld+json`, importmap) and `module`
  inline scripts do not execute synchronously and so never block deferring.
  (#670)

## [0.1.6] - 2026-06-18

### Fixed

- `import-ghost --download-images` now downloads Ghost settings-level images in
  the documented `laurel init` → `import-ghost` flow. In 0.1.5 the download was
  gated on (re)writing `laurel.toml`, so the default `--on-conflict skip` (which
  applies because `laurel init` already created the config) skipped the
  downloads too — favicon / `og:image` / `twitter:image` / JSON-LD then 404'd
  unless `--on-conflict overwrite` was passed. The download now runs regardless
  of the conflict outcome (idempotent — existing files are skipped). (#669)
- When `laurel.toml` already exists, `import-ghost` now **fill-merges** the
  Ghost settings keys the config is missing (e.g. `icon`, `og_image`, `url`)
  instead of skipping the file wholesale, so the downloaded image paths actually
  reach the build. Existing values are never clobbered (fill mode), and a config
  that already has every imported key is left byte-for-byte untouched.
  `--on-conflict overwrite` keeps the prior Ghost-wins behavior. (#669)

## [0.1.5] - 2026-06-18

### Added

- `import-ghost --download-images` now also downloads Ghost **settings-level
  images** — `icon`, `logo`, `cover_image`, `og_image`, `twitter_image` — into
  `content/images/` and rewrites the matching `laurel.toml` keys to local
  paths. A fresh import then builds with a working favicon and
  `og:image`/`twitter:image`/JSON-LD images instead of links to files that were
  never written. Third-party URLs (e.g. `static.ghost.org` defaults) stay
  external, and an image shared with a post `feature_image` is fetched once. Use
  `--no-download-settings-images` to opt out; settings images need `--source-url`
  to resolve site-relative paths, and are skipped with a warning otherwise.
  (#667)

### Fixed

- `laurel dev` / `laurel build` no longer reuse a previous Laurel version's
  incremental cache after an upgrade. The published CLI ships a single bundle
  with no source to fingerprint, so the render cache's global hash never changed
  between releases and stale HTML was served until `laurel clean`. The package
  version is now folded into the cache key so an upgrade invalidates it. (#666)

## [0.1.4] - 2026-06-18

### Fixed

- JSON-LD structured-data image URLs are now rewritten to the fingerprinted
  `/_images/<hash>/…` path like `og:image`/`twitter:image` already were. With
  content-image fingerprinting, `ImageObject.url` (and the publisher logo)
  previously pointed at the bare `/content/images/…` path that is never emitted,
  so structured-data images 404'd for crawlers. (#665)

## [0.1.3] - 2026-06-18

### Fixed

- Responsive-image `srcset` no longer offers variant widths Laurel does not
  generate. `{{img_url … size="…"}}` clamps to the original image when the
  requested size would not shrink the source (no upscaling), so a theme that
  requests, say, `w2000` for a 2000px feature image no longer produces a 404
  candidate that wide / high-DPI viewports would pick. (#664)

## [0.1.2] - 2026-06-18

### Fixed

- `laurel dev` now serves from `/` and emits root-relative links, ignoring
  `build.base_path` (which only applies to production builds). This removes the
  dev/prod link inconsistency where a configured `base_path` broke navigation in
  the dev server. (#663)

### Changed

- Removed the CI release workflow. Laurel is now published to npm via a local
  `npm publish` from a clean checkout. (#662)

## [0.1.1] - 2026-06-18

### Fixed

- The Markdown worker is skipped gracefully when its file is not present in the
  installed package, preventing a Bun crash (exit 133) on content-heavy builds
  run from the published npm package. (#661)

### Security

- Bumped `form-data` and `ws` past their advisory ranges via dependency
  overrides. (#661)

## [0.1.0] - 2026-06-17

### Added

- Initial release. A Ghost-compatible static site generator (Bun + TypeScript)
  that renders Ghost themes (`.hbs`, `{{ghost_head}}`, `{{asset}}`,
  `{{img_url}}`, partials/layouts, and the core Ghost helpers + context shape)
  against Markdown content from a Git repository, emitting a fully static site.
  Includes pagination, tag and author archives, post and static pages, asset
  fingerprinting, locale-driven `{{t}}` translation, sitemap and RSS, optional
  components (search, comments stub, OG images, JSON feeds), and
  `laurel import-ghost` / `laurel import-wordpress` migration tooling.

[Unreleased]: https://github.com/t09tanaka/laurel/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/t09tanaka/laurel/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/t09tanaka/laurel/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/t09tanaka/laurel/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/t09tanaka/laurel/compare/v0.1.12...v0.2.0
[0.1.12]: https://github.com/t09tanaka/laurel/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/t09tanaka/laurel/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/t09tanaka/laurel/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/t09tanaka/laurel/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/t09tanaka/laurel/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/t09tanaka/laurel/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/t09tanaka/laurel/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/t09tanaka/laurel/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/t09tanaka/laurel/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/t09tanaka/laurel/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/t09tanaka/laurel/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/t09tanaka/laurel/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/t09tanaka/laurel/releases/tag/v0.1.0
