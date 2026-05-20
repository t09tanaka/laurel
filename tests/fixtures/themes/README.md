# Real-theme contract test fixtures

Holds vendored Ghost-compatible themes used by `tests/themes/real-themes.test.ts`
to confirm that Nectar's render pipeline does not regress against
production-shaped templates. Every theme under this directory is loaded with
the smoke fixture site at `tests/fixtures/theme-smoke/site/`, built via
`nectar build`, and the emitted HTML is asserted to:

1. contain no leftover Handlebars markers (`{{` / `}}` outside of CDATA),
2. parse without throwing in the engine compile-check pass,
3. emit a working `assets/built/screen.css` URL through the `{{asset}}` helper.

## Current themes

- `casper-mini/` — vendored, hand-trimmed Casper-shaped theme covering the
  contract Nectar must support: `{{#unless @member}}` / `{{@member.paid}}` /
  `{{@member.name}}` header branches, partial hash args
  (`{{> "card" width="wide"}}`), Ghost i18n keys (`{{t "Sign in"}}`,
  positional `{{t "Powered by %" "X"}}`), and a ruby-style
  `{{#get "posts" filter="tag:[{{post.tags}}]+id:-{{post.id}}"}}` related-posts
  block. Its post/page body templates use `gh-content gh-canvas`, matching the
  Casper-family grid wrapper that keeps Koenig cards as direct grid children.
  Locale files for `en`, `de`, and `ja` so the i18n contract test can flip
  `[site].locale` and observe placeholder swap. Not a real Casper release;
  just enough HBS to exercise the contract.
- `alto/` — hand-trimmed Alto-shaped fixture that keeps the PhotoSwipe
  `pswp` partial behind `{{#is "post, page"}}`, locking the comma-separated
  route guard used by Alto's default layout.
- `headline-mini/` — hand-trimmed Headline-shaped fixture that keeps the
  secondary section guard `{{#if tags.[3]}}` under `{{#get "tags"}}`, locking
  Handlebars built-in array-index path support without a custom helper.
- `solo-mini/` — hand-trimmed Solo-shaped fixture that keeps the
  `{{#unless feature_image}}` post fallback reusing `gh-content gh-canvas`,
  locking the gh-prefixed class contract across HTML emit, asset emit, and
  minified theme smoke builds.

## Adding a real release tarball

For the heavier themes (Casper / Headline / Edition / Wave / Solo official
releases), pull the GitHub release tarball into
`tests/fixtures/themes/<name>/` and wire it into
`tests/themes/real-themes.test.ts` by appending a `{ name, dir }` entry to the
`THEMES` array. The CI environment has no network access; treat large real
themes as a local-only opt-in by gitignoring the directory and only running
the smoke when `NECTAR_REAL_THEMES=1` is set. The `casper-mini` fixture stays
checked-in so the contract assertions always run.
