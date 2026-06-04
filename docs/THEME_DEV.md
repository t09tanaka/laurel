# Theme Developer Guide

This guide is for people writing or porting a theme to run under Laurel. Laurel
consumes Ghost-style `.hbs` Handlebars themes, so most of this material reads as
"how the Ghost surface behaves *in Laurel*" — call out where Laurel's behaviour
differs from upstream Ghost.

If you're looking for the high-level architecture or the goals of the project,
read [`DESIGN.md`](./DESIGN.md) first. If you're looking for the per-helper
status matrix and edge cases as we discover them, see
[`GHOST_COMPATIBILITY.md`](./GHOST_COMPATIBILITY.md). If you want the
machine-checked helper inventory + content-shape index in one place,
see [`theme-reference.md`](./theme-reference.md). This document is the
practical handbook with worked examples and prose explanations.

The reference theme is `example/themes/source/` (a vendored copy of the official
Ghost Source theme). Whenever you wonder "should I be able to do X in a Laurel
theme?", the answer is "yes if Source does it, otherwise check the compat
matrix."

## 1. Theme layout

A theme is a directory under `<site>/themes/<name>/` referenced by
`[theme] name = "<name>"` in `laurel.toml`. The minimum useful shape is:

```
themes/<name>/
├── package.json              # config block: posts_per_page, image_sizes, content_kinds, custom
├── default.hbs               # top-level layout; other templates extend it
├── index.hbs                 # / (also paginated home)
├── post.hbs                  # /<post-slug>/
├── page.hbs                  # /<page-slug>/
├── tag.hbs                   # /tag/<tag-slug>/  (optional; falls back to index)
├── author.hbs                # /author/<author-slug>/  (optional)
├── error.hbs                 # 404 / generic error page (optional)
├── partials/
│   ├── post-card.hbs
│   ├── navigation.hbs
│   └── icons/avatar.hbs      # nested partials work
├── locales/
│   ├── en.json
│   └── fr.json
└── assets/
    ├── built/screen.css
    ├── built/screen.js
    ├── fonts/...
    └── images/...
```

### Templates Laurel recognises as top-level layouts

`index`, `home`, `post`, `page`, `tag`, `author`, `default`, `error`,
`error-404`, `amp`, `private`. Any other top-level `.hbs` is loaded but only
reachable if a top-level template renders it explicitly.

### Routes Laurel emits

| Route                                  | `route.kind`     | Template choice                       |
|----------------------------------------|------------------|---------------------------------------|
| `/`                                    | `home`           | `home.hbs` if present, else `index.hbs` |
| `/page/<n>/`                           | `index`          | same as `/`                           |
| `/<post-slug>/`                        | `post`           | `post.hbs`                            |
| `/<page-slug>/`                        | `page`           | `page.hbs`                            |
| `/tag/<tag-slug>/` + pagination        | `tag`            | `tag.hbs`, falls back to `index.hbs`  |
| `/author/<author-slug>/` + pagination  | `author`         | `author.hbs`, falls back to `index.hbs` |

The `error.hbs` / `error-404.hbs` templates are accepted by the theme loader.
When a theme ships one of them, Laurel emits `/404.html` with a static
`error` context (`statusCode: 404`, `message: "Page not found"`). Otherwise
Laurel emits its built-in `404.html`.

Laurel does not seed a root `error` object on normal static routes. Some Ghost
themes, including Biron, reference `{{{error.message}}}` inside runtime
subscribe / Portal UI states that Ghost populates after a failed POST. In
Laurel those runtime errors are out of scope, so the expression resolves to an
empty string during static rendering and does not fail the build.

## 2. Layout inheritance

Ghost themes inherit a layout with the `{{!< layout-name}}` directive on the
first line of a child template:

```hbs
{{!< default}}

<main class="gh-main">
  {{#post}}
    <h1>{{title}}</h1>
    {{content}}
  {{/post}}
</main>
```

Inside `default.hbs`, `{{{body}}}` is replaced with the child template's
rendered output:

```hbs
<!DOCTYPE html>
<html lang="{{lang}}">
  <head>
    {{ghost_head}}
  </head>
  <body class="{{body_class}}">
    {{> "navigation"}}
    {{{body}}}
    {{ghost_foot}}
  </body>
</html>
```

The split is implemented in `src/render/layouts.ts`. The directive must start at
column 0 (or after whitespace) of the file. Comments using `{{!--` work
elsewhere in the file as in standard Handlebars; only `{{!<` is the layout
directive.

**Gotcha:** Laurel does not support nested layout inheritance (a layout
extending another layout). One level is enough for every Ghost theme we've
encountered, including Source.

## 3. Partials

Partials live in `themes/<name>/partials/**/*.hbs`. Their name in `{{> "name"}}`
is the path under `partials/` without the `.hbs` extension:

| File                                          | Partial name        |
|-----------------------------------------------|---------------------|
| `partials/post-card.hbs`                      | `post-card`         |
| `partials/icons/avatar.hbs`                   | `icons/avatar`      |
| `partials/components/header.hbs`              | `components/header` |

Usage:

```hbs
{{> "post-card"}}
{{> "icons/avatar"}}
{{> "post-card" lazyLoad=true class="featured"}}     {{!-- hash params --}}
{{#> "card-shell"}}<p>inner block</p>{{/card-shell}} {{!-- block partial --}}
```

Hash parameters and block partials use Handlebars' built-in plumbing — Laurel
adds no special handling. Inside a partial, hash params are available as
top-level variables (`{{lazyLoad}}`, `{{class}}`).

**Quoting:** Ghost themes typically quote partial names (`{{> "name"}}`).
Unquoted (`{{> name}}`) works for names without slashes; quoted form is required
for any partial name containing `/` or `-`.

**Path scope:** Partial names are always rooted at the active theme's
`partials/` directory. Parent-directory segments such as `../` are not
supported, so a file at `partials/components/header.hbs` must be included as
`{{> "components/header"}}`, not `{{> "../components/header"}}`.

## 4. Asset pipeline

Static files under `themes/<name>/assets/` are discovered, optionally
fingerprinted, and copied to `dist/assets/` at build time.

### `{{asset "path"}}`

```hbs
<link rel="stylesheet" href="{{asset "built/screen.css"}}">
<script src="{{asset "built/main.js"}}"></script>
<img src="{{asset "images/logo.svg"}}" alt="">
```

Renders an absolute URL (prefixed with `[build] base_path`). For files where
fingerprinting is enabled, the URL embeds a content hash:

```
/assets/built/screen.b3c0f1d29a.css
/assets/built/main.6e2a7c1180.js
/assets/images/logo.svg          ← not fingerprinted
```

### Which files get fingerprinted

Currently only `.css`, `.js`, and `.mjs` files. Everything else (fonts, images,
JSON, etc.) is copied with its original name. Fingerprinting uses the first 10
hex characters of a SHA-1 over the file contents, so cache busting tracks
content changes deterministically.

### Resolution rules

`{{asset "built/screen.css"}}` and `{{asset "/built/screen.css"}}` both resolve.
Internally Laurel tries the path as-is first, then with an `assets/` prefix
added. Leading slashes are stripped. The result is always joined with the
configured `base_path` (`/` by default).

### Asset symlinks

Symlinks under `assets/` (or under any content directory) are skipped with a
warning. This is intentional: Laurel refuses to ship files from outside the
project tree. If you genuinely need to share files between themes, copy or
hard-link them.

### Manually wired URLs

If your theme references an asset that doesn't exist in the asset map, the
helper still emits a path (`<basePath>/assets/<your-path>`). It just isn't
fingerprinted. `laurel build` also prints a warning for literal
`{{asset "..."}}` references that are missing on disk. This commonly means the
theme's own build step has not run yet; run the theme's gulp/npm asset pipeline
first so files such as `assets/built/screen.css` exist before building Laurel.

### Installing third-party theme dependencies

Many Ghost themes ship a `package.json`, `gulpfile.js`, `yarn.lock`, or other
frontend build files so they can compile SCSS / JS into `assets/built/`. Treat
those files as untrusted code until you have reviewed and pinned the theme.
Package-manager lifecycle hooks (`preinstall`, `install`, `postinstall`,
`prepare`) can run as soon as you install dependencies, before you ever run the
theme's gulp task.

Use this workflow for a theme you did not author:

1. Inspect the theme diff first: `package.json`, lockfiles, `gulpfile.js`, and
   scripts under `bin/`, `scripts/`, or `tasks/` are build-time code.
2. Install dependencies with lifecycle scripts disabled:

   ```bash
   cd themes/<name>
   npm install --ignore-scripts
   # or: yarn install --ignore-scripts
   # or: bun install --ignore-scripts
   ```

3. Run only the specific build command you reviewed, for example `npm run build`
   or `npx gulp build`.
4. Commit / pin the resulting theme source and lockfile so CI rebuilds the same
   dependency graph.

The vendored `example/themes/source/` tree follows the same rule: its theme
build files are present for compatibility with upstream Ghost tooling, but
Laurel does not require you to run arbitrary package-manager scripts just to
render an already-built theme.

### Favicons and touch icons

Laurel emits browser favicon `<link>` tags from `{{ghost_head}}` and copies
the source files into the dist root with stable (un-fingerprinted) URLs so
bookmarks and the legacy `/favicon.ico` fallback keep working.

Two sources are recognised, in this order of priority:

1. **Theme `assets/` directory** — if any of the well-known filenames below
   exists under your theme's `assets/`, Laurel copies it to the dist root and
   emits a matching `<link>` tag:

   | Filename                          | Emitted link                                                                |
   | --------------------------------- | --------------------------------------------------------------------------- |
   | `favicon.ico`                     | `<link rel="icon" type="image/x-icon" href="/favicon.ico">`                 |
   | `favicon.svg`                     | `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`                |
   | `favicon.png`                     | `<link rel="icon" type="image/png" href="/favicon.png">`                    |
   | `favicon-16x16.png`               | `<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">` |
   | `favicon-32x32.png`               | `… sizes="32x32" …`                                                         |
   | `favicon-96x96.png`               | `… sizes="96x96" …`                                                         |
   | `favicon-192x192.png`             | `… sizes="192x192" …`                                                       |
   | `apple-touch-icon.png`            | `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">` |
   | `apple-touch-icon-precomposed.png`| `<link rel="apple-touch-icon-precomposed" href="…">`                        |
   | `apple-touch-icon-{152,167,180}x{…}.png` | sized `apple-touch-icon` variants                                    |
   | `safari-pinned-tab.svg`           | `<link rel="mask-icon" color="<site.accent_color>" href="…">`               |
   | `site.webmanifest` / `manifest.webmanifest` | `<link rel="manifest" href="…">`                                  |

2. **`site.icon` in `laurel.toml`** — if the theme didn't ship a primary
   `favicon.*`, the configured icon is copied to `dist/favicon.<ext>` and an
   `<link rel="icon">` is emitted for it. PNG / JPG icons also produce an
   `apple-touch-icon` link (SVG sources are skipped for Apple devices because
   they cannot render SVG home-screen icons). Remote URLs (`https://…`) are
   referenced as-is without copying.

The output paths are intentionally not fingerprinted so the favicon URLs are
stable across builds. The links emitted from `{{ghost_head}}` honour
`build.base_path` (a `/blog/` deploy gets `/blog/favicon.svg`).

## 5. Helpers — signatures and behaviour

This section is the working reference. Each entry lists the call shape, the
`hash` (named) parameters it understands, what it returns, and where the
implementation lives. Block helpers note their `{{#name}}…{{else}}…{{/name}}`
contract.

### 5.1 Asset helpers (`src/render/helpers/assets.ts`)

#### `{{asset path}}` — inline

| Param   | Type   | Notes |
|---------|--------|-------|
| `path`  | string | Logical path. Leading `/` allowed. `assets/` prefix optional. |

Returns a `SafeString` containing the resolved (possibly fingerprinted) URL.

#### `{{asset_attrs path [hasMinFile=true]}}` — inline

| Param         | Type    | Notes |
|---------------|---------|-------|
| `path`        | string  | Logical path. Leading `/` allowed. `assets/` prefix optional. |
| `hasMinFile=` | boolean | Prefer `*.min.*` when a matching theme asset exists. |

Returns `integrity="..." crossorigin="anonymous"` for known fingerprinted
CSS/JS theme assets. Returns an empty `SafeString` for unknown assets and
non-fingerprinted assets, so templates can opt in safely:

```hbs
<link rel="stylesheet" href="{{asset "built/screen.css"}}" {{asset_attrs "built/screen.css"}}>
<script src="{{asset "built/source.js"}}" defer {{asset_attrs "built/source.js"}}></script>
```

#### `{{img_url image [size="..." absolute=true]}}` — inline

| Param        | Type     | Notes |
|--------------|----------|-------|
| `image`      | string or object | A URL string, or an object with `feature_image` / `profile_image` / `url`. |
| `size=`      | string   | Key in `package.json > config.image_sizes`. |
| `absolute=`  | boolean  | If `true`, absolutise against `[site].url`. |

Returns the image URL with a `/content/images/.../size/wXXX[hYYY]/...` segment
inserted when `size=` matches a configured size. Laurel does not actually
resize images — the segment exists so `srcset` URLs are distinct.

Example:

```hbs
<img src="{{img_url feature_image size="m"}}"
     srcset="{{img_url feature_image size="m"}} 600w,
             {{img_url feature_image size="l"}} 960w"
     alt="{{feature_image_alt}}">
```

### 5.2 Content helpers (`src/render/helpers/content.ts`)

#### `{{content [words=N]}}` — inline; SafeString

Returns the post's rendered HTML. With `words=N`, returns a plaintext
approximation of the first N words (HTML tags stripped).

#### `{{excerpt [words=N] [characters=N]}}` — inline; plaintext

Returns `custom_excerpt`, falling back to the loader-generated `excerpt`, then
the post `plaintext`. `words=` and `characters=` truncate. No HTML.

#### `{{reading_time [minute="1 min read"] [minutes="% min read"]}}` — inline

Uses the loader-computed `reading_time` (in minutes). Returns `minute` for
`<=1`, otherwise `minutes` with `%` substituted.

#### `{{authors}}` / `{{#authors}}…{{/authors}}` — both inline and block

- Inline: comma-joined `name` list.
- Block: iterates over `post.authors`, exposing each author as the current context.

#### `{{tags [separator=", "] [autolink=true]}}` / `{{#tags}}…{{/tags}}`

- Inline: a separator-joined list of tag links (or names if `autolink=false`).
- Block: iterates over `post.tags`.

#### `{{meta_title [page="%"]}}` — inline

For `post` / `page` routes: returns `meta_title` || `title` || `site.title`.
For list routes (home/tag/author): site title, with `page` suffix appended on
paginated pages 2+ (`%` is the page number).

#### `{{meta_description}}` — inline

Returns `meta_description` || `excerpt` || `site.description`.

#### `{{post_class}}` — inline

Returns a space-joined class list: always `post`, plus `tag-<slug>` for each
tag, plus `featured` if `post.featured` is true.

#### `{{body_class}}` — inline

Returns the post/page's `body_class` if set, otherwise
`laurel-route-<route-kind>` where `<route-kind>` is one of `home`, `post`,
`page`, `tag`, `author`.

#### Stubs (members-adjacent)

- `{{comments}}` → `<div data-laurel-comments></div>`. Wire your own comment
  system (Giscus, Disqus, Utterances) by listening on this hook.
- `{{recommendations}}` → empty `<ul class="recommendations">`.
- `{{access}}` → block: renders `{{else}}` (visitor is always
  "unauthenticated" in a static build); inline: returns `false`.
- `{{subscribe_form}}` → a static `<form data-members-form="subscribe">`
  hook. It is inert unless `[components.subscribe]` rewrites it to a
  provider endpoint or your own client-side members runtime intercepts submit.
- `{{input_email [placeholder="..."]}}` → a plain email input with
  `data-members-email` so existing themes don't break.

Dawn-style hand-written forms that already contain `data-members-form` and
`data-members-email` are emitted as static markup. Laurel only applies the
existing subscribe-form transform to those attributes: `provider = "none"`
keeps the hooks but disables submission, while configured providers patch the
form action / email field name. Laurel does not invent a Ghost Members runtime,
so `data-members-success` / `data-members-error` states remain presentation
hooks until your JavaScript toggles them.

### 5.3 Date helper (`src/render/helpers/date.ts`)

#### `{{date [value] [format="DD MMM YYYY"] [timeago=true]}}` — inline

| Param      | Type     | Notes |
|------------|----------|-------|
| `value`    | string / Date / number / object | Optional. If omitted, falls back to `published_at`, `updated_at`, `created_at`, or `now`. |
| `format=`  | string   | `dayjs`-compatible format (Ghost themes use `moment` syntax — they overlap). |
| `timeago=` | boolean  | Returns "3 days ago" via `dayjs/relativeTime`. |

Formatting happens in the timezone from `[site].timezone` (defaults to `UTC`).

```hbs
<time datetime="{{date format="YYYY-MM-DD"}}">
  {{date format="MMMM D, YYYY"}}
</time>
```

### 5.4 Flow helpers (`src/render/helpers/flow.ts`)

Ghost-flavoured aliases for boolean operations themes occasionally use. Each
works as block or inline.

- `{{#or a b c}}…{{else}}…{{/or}}` / `{{or a b c}}` → first truthy value (block: branch on whether anything was truthy).
- `{{#and a b c}}…{{else}}…{{/and}}` / `{{and a b c}}` → last value if all truthy.
- `{{#not a}}…{{else}}…{{/not}}` → negation.
- `{{#eq a b}}…{{else}}…{{/eq}}` / `{{eq a b}}` → strict equality.

For richer comparisons use `{{#match}}` (§5.5).

Standard Handlebars `{{#if}}`, `{{#unless}}`, `{{#each}}`, `{{#with}}` are
available too (provided by Handlebars itself).

### 5.5 Block helpers (`src/render/helpers/blocks.ts`)

#### `{{#foreach collection [limit=N] [from=N] [to=N] [visibility="..."]}}…{{else}}…{{/foreach}}`

Iterates with Ghost's `@first`, `@last`, `@index` (0-based), `@number`
(1-based), `@even`, `@odd` data variables. `from`/`to` are **1-based,
inclusive** slice bounds.

```hbs
{{#foreach posts limit=3}}
  {{#if @first}}<div class="featured">{{else}}<div>{{/if}}
    <a href="{{url}}">{{title}}</a>
  </div>
{{/foreach}}
```

`visibility="public"` filters out non-public items. `visibility="all"` (the
default if unset) iterates everything.

If the (post-filter, post-slice) iteration is empty, the `{{else}}` block
renders.

#### `{{#is "name [, name…]"}}…{{else}}…{{/is}}`

Branch on route kind. Targets: `home`, `index` (alias of `home`), `post`,
`page`, `tag`, `author`, `paged` (current pagination > 1). Multiple targets in
a single string are comma-separated. Multiple positional args also accumulate.

```hbs
{{#is "home, tag"}}<h1 class="big">{{@site.title}}</h1>{{/is}}
{{#is "post"}}<article class="post">…</article>{{/is}}
```

#### `{{#has tag="..." author="..." visibility="..." slug="..." number=N}}…{{else}}…{{/has}}`

Branch on the current context. Multiple values per key are comma-separated; the
helper short-circuits on the first match.

| Hash key      | Matches                                                       |
|---------------|---------------------------------------------------------------|
| `tag=`        | `this.tags[].slug` or `name`                                 |
| `author=`     | `this.authors[].slug` or `name`                              |
| `visibility=` | `this.visibility` (default `public`)                          |
| `slug=`       | `this.slug`                                                   |
| `number=`     | Current `route.data.pagination.page` (1-based)                |
| (anything else) | Direct equality on `this[<key>]`                           |

#### `{{#match left [op right]}}…{{else}}…{{/match}}` / `{{match …}}` — block or inline

- `(value)` → truthy check.
- `(value other)` → strict equality.
- `(value op other)` with `op ∈ { = != > < >= <= ~ ~^ ~$ }`. `~` is substring;
  `~^` and `~$` are starts-with / ends-with.
- Ordering comparators (`> < >= <=`) auto-detect numeric vs. string operands:
  if both sides parse as finite numbers (including numeric strings like
  `"10"`), they compare numerically; otherwise they fall back to lexicographic
  string comparison. So `{{#match "foo" ">" "bar"}}` works, and
  `{{#match posts.length ">=" 4}}` keeps its numeric behavior.

#### Context blocks: `{{#post}}`, `{{#page}}`, `{{#tag}}`, `{{#author}}`

Each scopes `this` to the corresponding route data. If the route has no such
data (e.g. `{{#post}}` on the home page), the `{{else}}` branch renders.

```hbs
{{#post}}
  <h1>{{title}}</h1>
  {{content}}
{{else}}
  {{!-- not on a single-post route --}}
{{/post}}
```

#### `{{#get "resource" [filter="…"] [limit=N] [order="…"] [include="…"]}}…{{else}}…{{/get}}`

Local resolver against the content graph. `resource ∈ {posts, pages, tags,
authors}`.

| Hash key  | Notes |
|-----------|-------|
| `filter=` | A subset of Ghost's filter DSL (see below). |
| `limit=`  | Number; default `15`. |
| `order=`  | `"field [asc|desc][, field …]"`. Default `"published_at desc"`. |
| `include=`| Accepted for compatibility; the graph already eager-loads relations. |

Filter clauses are joined with `+` (AND). Each clause is `key:value`,
`key:-value` (negation), or `key:[a,b,…]` (any-of). Interpolation `{{post.id}}`
inside `value` is resolved against the calling context — useful for
"posts in same tag" patterns:

```hbs
{{#get "posts" filter="tag:{{primary_tag.slug}}+id:-{{id}}" limit=3 as |related|}}
  {{#foreach related}}<a href="{{url}}">{{title}}</a>{{/foreach}}
{{/get}}
```

Supported fields: `id`, `slug`, `featured` (`true`/`false`), `tag` / `tags`,
`author` / `authors`, `visibility`. Unknown fields do an equality check against
the raw frontmatter value. Filters that fall outside what's recognised return
the unfiltered set — be conservative and check `tests/render/get-helper.test.ts`
if you hit edge cases.

### 5.6 Ghost head/foot (`src/render/helpers/ghost-head.ts`)

#### `{{ghost_head}}` — inline; SafeString

Emits inside `<head>`:

- `<meta name="generator" content="Laurel">`
- `<link rel="canonical" href="…">` (built from `route.url` and `[site].url`)
- `<meta name="description">`
- OpenGraph: `og:site_name`, `og:type` (`article` on post routes, otherwise
  `website`), `og:title`, `og:description`, `og:url`, `og:image`
- Twitter card: `summary_large_image`, with `twitter:title`,
  `twitter:description`, `twitter:image`
- `<link rel="alternate" type="application/rss+xml">` for RSS autodiscovery,
  unless `[components.rss] enabled = false`
- `<link rel="alternate" hreflang="…">` for routes that have locale
  alternates in the route plan
- A JSON-LD `<script type="application/ld+json">` (Article on post routes,
  WebSite otherwise)
- The current context's `codeinjection_head` string, verbatim

Laurel does not emit `<link rel="amphtml">` unless a future AMP route emitter
also produces the target route. Emitting an AMP link without `/amp/` HTML would
create a crawler-visible 404, so current builds intentionally keep AMP out of
`{{ghost_head}}`.

Source values, in priority order:
- Title: `meta_title` → `og_title` → `title` → `site.title`
- Description: `meta_description` → `og_description` → `excerpt` →
  `site.description`
- Image: `og_image` → `twitter_image` → `feature_image`

#### `{{ghost_foot}}` — inline; SafeString

Emits the context's `codeinjection_foot` verbatim. No member portal, no
analytics scripts.

`codeinjection_head` (in `{{ghost_head}}`) and `codeinjection_foot` are the
only two render helpers that ship author-controlled HTML without escaping.
Both are gated behind `build.allow_code_injection`; the loader strips the
fields when the flag is off. When the flag is on, treat `codeinjection_*`
PRs as code review and consider an operator-side CSP (edge-injected nonces
or precomputed hashes) for defence in depth — see
[`docs/security/threat-model.md` § Render-side raw-HTML exits](security/threat-model.md#render-side-raw-html-exits--ghost_head--ghost_foot).

### 5.7 i18n (`src/render/helpers/i18n.ts`)

#### `{{t "key" [name=value …]}}` — inline

Look up `key` in `themes/<name>/locales/<site.locale>.json`, falling back to
`en.json`, then to the literal `key`. A present empty string is returned as an
intentional translation, not treated as missing; this matches Ghost, even though
it can be surprising for labels such as `"Featured": ""`.

Interpolation:
- `{name}` placeholders are replaced by `name=` hash values.
- `%` is replaced by the first positional value, with count-like hash values as
  a compatibility fallback — Ghost's positional placeholder.
- Interpolated hash and positional values are treated as text. HTML tags in
  those values are stripped before substitution so `{{{t}}}` cannot emit
  content-derived markup.

```hbs
<button>{{t "Read more"}}</button>
<p>{{t "Page %" page=pagination.page}}</p>
<p>{{t "Hello {name}" name=author.name}}</p>
```

Missing locale files are tolerated — every theme should ship at least `en.json`
even if it's empty.

**Escaping.** `{{t}}` returns a plain string, not a `SafeString`. Double-stash
output is HTML-escaped by Handlebars. Triple-stash output is emitted raw, so
locale values may intentionally contain trusted theme markup such as
`<strong>%</strong>`. Interpolated hash and positional values are not a markup
channel: Laurel strips tags from those values before substitution, including
when the helper is rendered with triple-stash. Locale files remain part of the
theme trust boundary; see
[`docs/security/threat-model.md` § Locale files](security/threat-model.md#locale-files-themesnamelocalesjson-and-t).

#### `{{lang}}` — inline

Returns `[site].locale`. Use on `<html lang="…">`.

### 5.8 Navigation & links (`src/render/helpers/navigation.ts`)

#### `{{navigation [type="primary"]}}` — inline; SafeString

Renders a `<ul class="nav">` from `[[navigation]]` (or `[[secondary_navigation]]`
if `type="secondary"`). Items matching the current `route.url` get
`aria-current="page"` on both the `<li>` and inner `<a>`.

The output is intentionally minimal. If you want different markup, either
iterate over `@site.navigation` directly with `{{#foreach}}` or define a
`partials/navigation.hbs` and invoke it as `{{> "navigation"}}` — the partial
wins because it's a different call site, not because the helper looks for it.

#### `{{pagination}}` — inline; SafeString

Renders prev/next links and a "Page N of M" indicator. Returns `""` when there
is only one page. As with `{{navigation}}`, this is intentionally minimal —
ship a `partials/pagination.hbs` and call it directly if you want a richer UI.

#### `{{#link href="…" [class="…"] [target="…"]}}…{{/link}}`

Inline link helper. Builds an `<a>` with escaped attributes. The block body
becomes the link text; if omitted, the href itself is used.

#### `{{link_class for="/path" [activeClass="nav-current"]}}` — inline

Returns the activeClass string when the current route equals `for=` (trailing
slashes are normalised), otherwise an empty string. Designed for
`class="… {{link_class for="/blog/"}}"` patterns.

### 5.9 String helpers (`src/render/helpers/strings.ts`)

- `{{concat a b c [separator="…"]}}` — string concatenation with optional separator.
- `{{encode value}}` — `encodeURIComponent`.
- `{{upper value}}` / `{{lower value}}` — case conversion.
- `{{plural count empty="…" singular="…" plural="…"}}` — choose template by
  count and substitute `%`.

### 5.10 URL helpers (`src/render/helpers/urls.ts`)

#### `{{url [absolute=true]}}` — inline

Returns `this.url`. With `absolute=true`, resolved against `[site].url`.

#### `{{social_url type="twitter|facebook|linkedin|bluesky|mastodon|threads|tiktok|youtube|instagram"}}` — inline

Reads `this[type]` (the handle from frontmatter) and builds the canonical
profile URL. Returns `""` if the type isn't recognised or the handle is unset.

Mastodon understands `@user@host.tld` and routes to `https://host.tld/@user`;
bare `@user` defaults to `mastodon.social`.

## 6. Context shapes

The contexts available inside templates are documented in
[`GHOST_COMPATIBILITY.md` §Contexts](./GHOST_COMPATIBILITY.md#contexts). In
brief:

- `@site` (aliases `@blog`, `@setting`) — site-wide values from `laurel.toml [site]`.
- `@custom` — theme custom-settings, built from `package.json > config.custom`
  defaults, overridden by `laurel.toml [theme.custom]`.
- `@page` — `route.data` for the current page (rarely accessed directly).
- `this` (the implicit context) — the route's primary record:
  - Post route: a `Post` (frontmatter + `html`, `plaintext`, `excerpt`,
    `reading_time`, `primary_tag`, `primary_author`, `tags`, `authors`,
    `url`, `prev`, `next`).
  - Page route: a `Page`.
  - Tag/author/home routes: an object containing `posts` (paginated subset),
    `pagination`, and (for tag/author) the `tag` / `author` record.

Field names on `Post` / `Page` / `Tag` / `Author` are exactly those in
`src/content/model.ts` — keep that file open when authoring a template.

### `@site` fields

| Field                  | Source                                |
|------------------------|---------------------------------------|
| `title`                | `laurel.toml [site].title`            |
| `description`          | `[site].description`                  |
| `url`                  | `[site].url`                          |
| `logo`                 | `[site].logo`                         |
| `icon`                 | `[site].icon`                         |
| `cover_image`          | `[site].cover_image`                  |
| `lang` / `locale`      | `[site].locale`                       |
| `timezone`             | `[site].timezone`                     |
| `accent_color`         | `[site].accent_color`                 |
| `navigation`           | `[[navigation]]` array                |
| `secondary_navigation` | `[[secondary_navigation]]` array      |
| `portal_button` / `portal_button_icon` / `portal_button_signup_text` / `portal_button_style` | `[site.portal]` |
| `portal_name` / `portal_plans` / `portal_signup_checkbox_required` / `portal_signup_terms_html` / `signup_url` | `[site.portal]` |
| `build`                | Deploy metadata, when present         |

`@site.build` is omitted for ordinary local builds. When metadata env vars are
present, themes can read `@site.build.branch`, `@site.build.build_id`, and
`@site.build.commit_sha`. Precedence is explicit `LAUREL_BUILD_METADATA_*`
vars, short Laurel aliases such as `LAUREL_BUILD_ID` / `LAUREL_COMMIT_SHA`,
provider vars such as `CF_PAGES_COMMIT_SHA` / `VERCEL_GIT_COMMIT_SHA`, then
generic CI vars such as `BUILD_ID`, `COMMIT_SHA`, `COMMIT_REF`, and
`GITHUB_SHA`.

### `@custom`

Built from the theme's `package.json` `config.custom.*` block. Each declared
setting becomes a key on `@custom`, taking the `default` value when set,
falling back to `false` for `boolean`, the first option for `select`, and an
empty string otherwise. Users override via:

```toml
[theme.custom]
navigation_layout = "Logo on the left"
show_featured_posts = true
```

For UI-less distribution, Laurel can generate a TOML snippet from the theme
package custom schema. The snippet is the supported minimum form-generation
surface: theme authors can show it in docs or tooling, and users can paste the
`[theme.custom]` block into `laurel.toml` without guessing defaults.

A custom setting referenced by the theme but not declared in `package.json` is
still readable (it just resolves to `undefined`); a user-side override of an
undeclared key currently warns rather than hard-fails.

## 7. Theme `package.json` reference

```jsonc
{
  "name": "my-theme",
  "version": "1.0.0",
  "config": {
    "posts_per_page": 12,
    "image_sizes": {
      "xs": { "width": 160 },
      "s":  { "width": 320 },
      "m":  { "width": 600 },
      "l":  { "width": 960 },
      "xl": { "width": 1200 }
    },
    "card_assets": true,
    "content_kinds": {
      "event": {
        "dir": "content/events",
        "title_field": "title"
      }
    },
    "custom": {
      "navigation_layout": {
        "type": "select",
        "options": ["Logo in the middle", "Logo on the left", "Stacked"],
        "default": "Logo in the middle"
      },
      "site_background_color": {
        "type": "color",
        "default": "#ffffff"
      },
      "show_featured_posts": {
        "type": "boolean",
        "default": false,
        "group": "homepage"
      },
      "font_display": {
        "type": "select",
        "options": ["swap", "optional"],
        "default": "swap"
      }
    }
  }
}
```

- **`posts_per_page`** — default pagination size. Overridden by
  `[build] posts_per_page` in `laurel.toml`.
- **`image_sizes`** — drives `{{img_url size="key"}}`. Width / height in pixels.
- **`card_assets`** — when `true`, Laurel emits local shared Ghost card assets
  at `/assets/ghost-card-assets.css` and `/assets/ghost-card-assets.js`.
  The stylesheet is injected through `{{ghost_head}}`; the JavaScript runtime is
  injected through `{{ghost_foot}}` only on pages whose rendered body contains a
  runtime-bearing Koenig card such as audio, embed, signup, toggle, or video.
  Use `{ "exclude": ["bookmark", "gallery"] }` to omit per-card CSS/runtime
  sections that your theme owns.
  `false` disables the shared assets. Laurel does not fetch Ghost's upstream
  vendor bundle or a CDN at build time; the bundled files are a static
  compatibility layer for common Koenig card class names.
- **`content_kinds`** — additional Markdown kinds that `laurel new <kind>
  <title>` may scaffold for this theme. Each key is the CLI kind name; `dir`
  is the destination directory, and `title_field` defaults to `name` when
  omitted. Project config `[content.kinds.<kind>]` can override the same kind.
- **`custom`** — settings exposed on `@custom`. Supported `type` values mirror
  Ghost: `text`, `boolean`, `select` (with `options`), `color`, `image`. Types
  beyond `select` and `boolean` currently round-trip as strings — the user is
  responsible for the value's shape.
  For font-loading controls, prefer a `select` such as Source's
  `font_display = "swap" | "optional"`: `swap` avoids invisible text while fonts
  load, while `optional` can reduce late layout/typography changes at the cost
  of the custom font never appearing on slow connections.

## 7.4 Theme asset performance

Laurel keeps theme-authored CSS and JavaScript under the theme's control.
Rendered HTML is post-processed to add safe resource metadata where it is
unambiguous: stylesheet links get `type="text/css"` when missing, classic
external scripts get `defer` when they have no loading attribute, and `.mjs`
scripts get `type="module"`.

Use `[build].minify_html = true` to collapse whitespace and comments in emitted
HTML. Use `[performance].preload_stylesheet = true` when a theme does not
already preload its render-blocking stylesheet. Laurel does not automatically
purge CSS, inline critical CSS, or bundle/minify arbitrary theme JavaScript:
those steps require route-aware theme analysis and can easily remove selectors
or change script execution order. Put those optimizations in the theme build
step, then reference the built files through `{{asset}}`.

## 8. Locales

```
themes/<name>/locales/
├── en.json
├── fr.json
└── ja.json
```

Each file is a flat `{ "key": value }` map. Keys are the English source strings
by convention (as Ghost does). Values may be strings, numbers, or booleans;
`{{t}}` stringifies numbers and booleans at render time. String translations may
use `%` or `{name}` placeholders (see `{{t}}` §5.7).

The active locale is `[site].locale`. Laurel falls back through:

1. `<locale>.json` (exact match)
2. `en.json`
3. The literal key

Fallback is based on key presence, not truthiness: `"Featured": ""` in the
active locale renders an empty string instead of falling through to `en.json`
or the literal key. Omit the key when you want fallback text.

So you can ship a theme with only `en.json` and still call `{{t}}` everywhere —
the keys themselves act as the default text.

## 9. Worked example: porting a card from Source

Here's an excerpt of `partials/post-card.hbs` from the Source theme, showing
helpers in concert:

```hbs
<article class="gh-card {{post_class}}">
  {{#if feature_image}}
    <a class="gh-card-image" href="{{url}}">
      <img
        srcset="{{img_url feature_image size="s"}} 320w,
                {{img_url feature_image size="m"}} 600w,
                {{img_url feature_image size="l"}} 960w"
        src="{{img_url feature_image size="m"}}"
        alt="{{#if feature_image_alt}}{{feature_image_alt}}{{else}}{{title}}{{/if}}"
        loading="lazy"
      >
    </a>
  {{/if}}
  <div class="gh-card-meta">
    {{#if primary_tag}}
      <a class="gh-card-tag" href="{{primary_tag.url}}">{{primary_tag.name}}</a>
    {{/if}}
    <h2 class="gh-card-title"><a href="{{url}}">{{title}}</a></h2>
    {{#if excerpt}}
      <p class="gh-card-excerpt">{{excerpt words=24}}</p>
    {{/if}}
    <footer class="gh-card-footer">
      <time datetime="{{date format="YYYY-MM-DD"}}">{{date format="D MMM YYYY"}}</time>
      <span class="bull">•</span>
      <span class="gh-card-readtime">{{reading_time minute="1 min read" minutes="% min read"}}</span>
    </footer>
  </div>
</article>
```

Each helper used here (`post_class`, `img_url`, `excerpt`, `date`,
`reading_time`) is `✅ implemented` in the matrix and behaves identically to
Ghost for the inputs Source feeds them.

## 10. Out of scope (do not rely on)

The following Ghost features are intentionally absent or stubbed. If your
theme uses them, you'll either get an empty render or a no-op:

- **Members surface** — `@member.*` context resolves to `undefined`. `{{access}}`
  always treats the visitor as unauthenticated. `{{subscribe_form}}`,
  `{{input_email}}`, `{{input_password}}` render harmless markup; wire your own
  membership component if needed.
- **Newsletter / email-only posts** — posts marked `email-only` are filtered
  out at load time.
- **Server-side search** — no built-in. The recommended approach is to plug in
  Pagefind or Lunr as an optional component (see `[components.search]` in
  `laurel.toml`).
- **Comments** — `{{comments}}` emits `<div data-laurel-comments></div>` so a
  client-side embed (Giscus / Disqus / Utterances) can hook onto it.
- **Ghost Admin / edit URLs** — not rendered.
- **`{{#get}}` against remote Ghost endpoints** — resolved against the local
  content graph only (see §5.5).
- **Runtime form error context** — Ghost may populate `error.message` after a
  failed subscribe / Portal POST. Laurel's static renderer normally leaves
  `error` unset outside `/404.html`, so `{{{error.message}}}` renders empty.
- **Live drafts / preview** — `status: draft` posts are dropped at build time.

## 11. Accessibility requirements

Laurel emits no styling of its own — `body_class`, `post_class`, and the helpers
under §5 hand the theme a set of hooks, but the visual contract (colors,
spacing, focus rings, hit targets) is entirely the theme's responsibility. The
following are **hard requirements** for any theme shipped against Laurel. A
theme that fails them is not considered conformant, even if it renders without
errors.

### 11.1 Keyboard focus must be visible

Every interactive element rendered by the theme — `<a>`, `<button>`,
`<input>`, `<select>`, `<textarea>`, `[tabindex]` other than `-1`, and any
custom `[role]` that takes focus — **must** show a clearly visible focus
indicator when reached via the keyboard.

The minimum bar:

- Ship a `:focus-visible` rule for interactive elements. Do **not** rely on the
  user-agent default outline; many resets (Normalize, Tailwind preflight, Ghost
  Source's own `screen.css`) strip it. If you reset, you must re-apply.
- Never write `outline: none` (or `outline: 0`) without an accompanying
  `:focus-visible` style that restores a visible indicator on the same
  selector.
- The indicator must meet **WCAG 2.1 AA 1.4.11 Non-text Contrast** — at least
  **3:1** contrast against the adjacent background — and **WCAG 2.2 AA 2.4.11
  Focus Not Obscured** — the focused element is not fully hidden behind
  sticky headers, modals, or cookie banners. (Source: [WCAG 2.1 SC
  1.4.11](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html),
  [WCAG 2.2 SC 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).)
- Prefer `:focus-visible` over `:focus` so that mouse clicks on buttons don't
  leave a sticky ring. If you support browsers without `:focus-visible`
  (Safari < 15.4), pair it with a `:focus:not(:focus-visible)` reset rather
  than dropping `:focus-visible` entirely.

A minimal, theme-agnostic snippet that satisfies the requirement:

```css
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--laurel-focus-ring, #1f6feb);
  outline-offset: 2px;
  border-radius: 2px;
}

:where(a, button, input, select, textarea, [tabindex]):focus:not(:focus-visible) {
  outline: none;
}
```

Pick a `--laurel-focus-ring` color that has ≥ 3:1 contrast against **every**
surface the element can sit on (page background, card background, hero
overlays). Check both light and dark modes if your theme supports them. The
[WebAIM contrast checker](https://webaim.org/resources/contrastchecker/) is
the easiest sanity check.

### 11.2 Skip link

Every theme should ship a "Skip to main content" link as the first focusable
element in `<body>`, targeting the page's primary `<main>` (or
`role="main"`) landmark. The link may be visually hidden until focused, but
**must** become visible on focus. This satisfies **WCAG 2.4.1 Bypass
Blocks**. ([SC 2.4.1](https://www.w3.org/WAI/WCAG21/Understanding/bypass-blocks.html).)

### 11.3 Landmarks and headings

- Wrap the page's primary content in `<main>` so the skip link has a target
  and screen readers expose the landmark.
- Use exactly one `<h1>` per route. On post / page routes that is the post
  title; on the home / tag / author routes pick something meaningful (site
  title, tag name, author name).
- Don't skip heading levels (`<h2>` → `<h4>` with no `<h3>` between).

### 11.4 Verifying

Before declaring a theme "done", run through this checklist on a built site
(`bun ../src/cli/index.ts build`):

1. Open `dist/index.html` in a real browser. Press `Tab` repeatedly from the
   address bar onwards. Every focused element must be visibly outlined.
2. Repeat on `dist/<post-slug>/index.html` and `dist/tag/<tag-slug>/index.html`.
3. Inspect each `:focus-visible` style with DevTools and confirm the rendered
   outline has ≥ 3:1 contrast against the surface behind it. Sticky headers
   count — focus on a link near the top of the page after scrolling and check
   the indicator isn't fully covered.
4. Confirm the first `Tab` press surfaces the skip link and that activating it
   moves focus into `<main>`.
5. Run an automated audit (axe DevTools, Lighthouse → Accessibility, or
   `pa11y dist/index.html`) and triage any focus-related violations.

Laurel does not currently fail the build when a theme is missing
`:focus-visible` styles (the CSS is opaque to the renderer), so these checks
are a manual gate. CI-friendly automation is tracked separately.

## 12. Working on a theme locally

```bash
# from the site root (e.g. example/)
cd example
bun ../src/cli/index.ts build         # full build into dist/
bun ../src/cli/index.ts serve         # rebuild + serve on file change
bun ../src/cli/index.ts theme serve   # fast theme-only server with fixture content
```

Common iteration loop:

1. Edit a template under `themes/<name>/`.
2. `bun ../src/cli/index.ts build` (or leave `theme serve` / `serve` running).
3. Inspect output under `dist/`. Look for `{{` left in the HTML — that's a
   missing or misnamed helper.
4. Check the build log for warnings about symlinked assets, unrecognised
   filter clauses in `{{#get}}`, or malformed locale files.

`theme serve` is the quickest loop when you are only editing theme files. It
builds a tiny generated fixture site against the active theme, serves it with
live reload, and watches only `themes/<name>/` so large real content trees do
not slow down each rebuild.

`bun test` in the repo root exercises the helper unit suite; `tests/source-smoke.test.ts`
builds the bundled Source theme end-to-end and is the closest thing to "does
my theme render at all" in CI.

## 13. Where to look in the code

- Template / partial discovery: `src/theme/loader.ts`
- Layout inheritance: `src/render/layouts.ts`
- Helper registration entry point: `src/render/helpers/index.ts`
- Per-helper implementations: `src/render/helpers/*.ts`
- Per-route context builder: `src/render/context.ts`
- Asset fingerprinting: `src/theme/assets.ts`
- Theme `package.json` parsing: `src/theme/pkg.ts`

When in doubt about a helper's edge case, the test under
`tests/render/<helper>.test.ts` is authoritative — those are written against
observed Ghost behaviour.

## 14. Authoring a new helper

Most theme work is done in `.hbs` templates with the existing helper set. When
you need a helper that Ghost ships but Laurel doesn't yet, the surface is
small enough to add one in-tree:

1. Pick the right file in `src/render/helpers/`. Group by concern: string
   helpers in `strings.ts`, URL helpers in `urls.ts`, content helpers in
   `content.ts`, and so on. If your helper doesn't fit any of them, create a
   new `src/render/helpers/<name>.ts` exporting a `registerXyzHelpers(engine)`
   function and call it from `src/render/helpers/index.ts`.
2. Register on the engine through the wrapper, not the bare Handlebars
   instance:
   ```ts
   export function registerFoo(engine: LaurelEngine): void {
     engine.registerHelper('foo', function fooHelper(value: unknown) {
       // Implementation. Use SafeString when emitting HTML; return a plain
       // string otherwise so Handlebars escapes it.
     });
   }
   ```
   The wrapper threads the active `RouteContext`, `SiteData`, and i18n
   `locale` through `options.data.root` so the helper can read them via
   `engine.getRoot(options)` without touching globals.
3. Mirror Ghost's contract. If you're replicating a helper Ghost ships, read
   the Ghost source for the exact hash-arg names and falsy-value semantics.
   `foreach`, `is`, `get`, `has`, `match` already do this — match the same
   shape for any new block helper.
4. Surface errors loudly. A helper that silently swallows a missing arg or a
   bad type masks template bugs. Throw `LaurelError` with `code: 'render'`
   and a `hint:` describing the fix. The build pipeline turns it into a
   pointed message at the failing route URL.
5. Test against observed behaviour. Add `tests/render/helpers/<name>.test.ts`
   with at least: (a) happy path, (b) missing/falsy input, (c) edge cases
   discovered in real themes. Use the `makeEngine()` helper from
   `tests/render/helpers/_setup.ts` to spin up a minimal engine without
   loading the full Source theme.
6. Document it. Add a `#### {{...}}` subsection under §5 of this guide and
   note any Laurel-side divergences (e.g. helpers that hit Ghost APIs and
   return a stub here).

When porting a helper from Ghost's source, look at
[`/render/helpers/*.ts`](../src/render/helpers/) for the closest match — the
existing helpers have all the boilerplate needed to read context, parse hash
args, and emit `SafeString`.

## 15. Golden snapshot tests

`tests/render/golden.test.ts` re-renders the example site against the
vendored Source theme and diffs each captured route against a committed
snapshot under `tests/fixtures/golden/`. The snapshots cover representative
routes (index, posts, tag/author archives, pages, 404, sitemap, RSS,
robots.txt) so any helper or template change that affects emitted HTML
shows up in `bun test` even when no per-helper unit test would have caught it.

### Running

```bash
# Normal mode: build the example and diff each route. Fails on any drift.
bun test tests/render/golden.test.ts

# Accept the new output as the snapshot. Use this only after deliberately
# changing template structure, helper output, or sitemap/RSS contents.
UPDATE_GOLDEN=1 bun test tests/render/golden.test.ts

# Review the diff before committing.
git diff tests/fixtures/golden/
```

### What the snapshot ignores

`normalize()` strips two moving parts so unrelated edits don't churn the
golden output:

- Fingerprinted asset hashes (`/assets/built/screen.<hash>.css` → `.<HASH>.css`).
  Regenerated on every theme rebuild, but the URL shape itself is preserved.
- Year stamps in the default 404 footer (`© 2026` → `© <YEAR>`). Advances
  yearly without any code change.

Anything else — every attribute, every helper output, every route URL — is
locked. A failing snapshot is a real diff. Read it before accepting.

### When to add a new route to the snapshot set

The current set covers the canonical surface (one post per content kind, one
tag, one author, one page, error page, all feed/sitemap variants). Add a new
entry to `GOLDEN_FILES` when you ship a feature that emits a new route
shape — e.g. a per-tag RSS, a `routes.yaml` custom route, or a paginated
listing whose layout differs from the home. Don't bloat the set with every
post in `example/`; the snapshot's job is shape coverage, not corpus
coverage. Unit tests cover the per-post variations.

### When the diff is intentional

If you intentionally change template structure (e.g. a new helper output, a
sitemap field rename, a sitemap exclusion rule like #781), regenerate the
snapshots and review the diff in code review. Reviewers should be able to
look at the diff and immediately see whether the new output matches the
spec. If the diff is opaque, the snapshot is too low-level — narrow it.
