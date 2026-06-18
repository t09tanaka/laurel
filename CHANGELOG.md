# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Entries are maintained by hand as part of the local release flow (Laurel is
published to npm with `npm publish`; there is no CI release automation).

## [Unreleased]

_Nothing yet._

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

[Unreleased]: https://github.com/t09tanaka/laurel/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/t09tanaka/laurel/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/t09tanaka/laurel/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/t09tanaka/laurel/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/t09tanaka/laurel/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/t09tanaka/laurel/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/t09tanaka/laurel/releases/tag/v0.1.0
