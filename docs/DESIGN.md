# Nectar — Detailed Design

## 1. Goal & non-goals

**Goal.** A static site generator that takes a Ghost theme (the `.hbs`
templates), a directory of Markdown content, and a small TOML config, and
emits a fully static site that looks and behaves like the same content
published from Ghost — without running Ghost.

**Non-goals.**
- Hosting Ghost itself, Casper-only support, or running a Node admin server.
- 100% Ghost helper coverage. We aim for *real-world theme* coverage; the
  Source theme is the litmus test.
- Database, members, paywall, email — these are out of scope unless the user
  opts into an optional component.
- Multi-locale routing. A build produces exactly one locale, determined by
  `[site].locale`. There is no `/en/foo/` + `/ja/foo/` split, no per-locale
  content subdirectory convention, and no language switcher routing. Sites
  that need multiple locales should run one Nectar build per locale (each
  with its own `nectar.toml` and `content/` tree) and stitch the outputs
  together at the hosting layer. The single-locale-per-build constraint
  keeps the content graph, routing, sitemap, RSS, and pagination logic
  unambiguous; bolting multi-locale routing on top would force every
  context (`@site`, post URLs, canonical, hreflang, feeds) to grow a
  locale axis that themes are not built to consume.

## 2. High-level pipeline

```mermaid
flowchart TD
    Config["nectar.toml"]
    Markdown["content/**/*.md"]
    Themes["themes/&lt;name&gt;/<br/>(*.hbs, locales, assets, package.json)"]

    Config --> ConfigLoader["Config loader"]
    ConfigLoader --> ContentLoader["Content loader<br/>(frontmatter + markdown → HTML)"]
    Markdown --> ContentLoader
    ContentLoader --> ContentGraph["Content graph<br/>(posts, pages, tags, authors, navigation)"]
    ContentGraph --> RoutePlanner["Route planner"]
    RoutePlanner --> Routes["Routes<br/>/, /:slug/, /tag/:slug/,<br/>/author/:slug/, /page/:n/"]
    ConfigLoader --> ThemeLoader["Theme loader<br/>(.hbs, locales, assets, config)"]
    Themes --> ThemeLoader
    ThemeLoader --> Renderer["Renderer<br/>(Handlebars + Ghost helpers + context build)"]
    ContentGraph --> Renderer
    RoutePlanner --> Renderer
    Renderer --> Emitter["Emitter<br/>(HTML + assets + sitemap/rss)"]
    Emitter --> Dist["dist/"]
```

<details>
<summary>ASCII fallback (for terminals or markdown viewers without Mermaid)</summary>

```
nectar.toml ──┐
              ▼
  ┌──────────────────┐
  │  Config loader   │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐    ┌────────────────────┐
  │ Content loader   │◄───┤ content/**/*.md    │
  │  (frontmatter +  │    └────────────────────┘
  │   markdown→html) │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐    ┌────────────────────┐
  │ Content graph    │◄───┤ posts / pages /    │
  │ (posts, pages,   │    │  tags / authors    │
  │  tags, authors,  │    └────────────────────┘
  │  navigation)     │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐    ┌────────────────────┐
  │ Route planner    │───►│ /, /:slug/,        │
  │                  │    │ /tag/:slug/,       │
  │                  │    │ /author/:slug/,    │
  │                  │    │ /page/:n/, etc.    │
  └────────┬─────────┘    └────────────────────┘
           │
           ▼
  ┌──────────────────┐    ┌────────────────────┐
  │ Theme loader     │◄───┤ themes/<name>/     │
  │  (.hbs, locales, │    │   *.hbs, locales,  │
  │   assets, conf)  │    │   assets/, pkg     │
  └────────┬─────────┘    └────────────────────┘
           │
           ▼
  ┌──────────────────┐
  │ Renderer         │
  │ (Handlebars +    │
  │  Ghost helpers + │
  │  context build)  │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐    ┌────────────────────┐
  │ Emitter          │───►│ dist/              │
  │  (HTML + assets  │    └────────────────────┘
  │   + sitemap/rss) │
  └──────────────────┘
```

</details>

## 3. Modules

### 3.1 `src/config`

Loads `nectar.toml`. Schema (validated via Zod):

```toml
[site]
title          = "My Blog"
description    = "..."
url            = "https://example.com"
locale         = "en"
timezone       = "UTC"
cover_image    = "/content/images/cover.jpg"
logo           = "/content/images/logo.svg"
icon           = "/content/images/icon.png"
accent_color   = "#222222"

[theme]
name           = "source"     # directory inside themes/

[content]
posts_dir      = "content/posts"
pages_dir      = "content/pages"
authors_dir    = "content/authors"
assets_dir     = "content/images"

[build]
output_dir     = "dist"
base_path      = "/"
posts_per_page = 12           # default; theme can override via package.json

[[navigation]]
label = "Home"
url   = "/"

[[secondary_navigation]]
# same shape, optional
```

### 3.2 `src/content`

- `loader.ts` — glob `content/posts/**/*.md`, parse YAML frontmatter, hand the
  body to `markdown.ts`. Content directories (posts, pages, authors, tags,
  `content/images/`) and theme `assets/` must contain only regular files —
  symbolic links are skipped with a warning to prevent the build from reading
  or shipping data from outside the project tree.
- `markdown.ts` — `marked` + `gray-matter`. Renders to HTML; also extracts a
  plaintext excerpt and an estimated `reading_time`.
- `model.ts` — TypeScript types for `Post`, `Page`, `Author`, `Tag`,
  `NavigationItem`, `SiteData`. These mirror the public shape Ghost exposes
  to themes (so helpers can read them without translation).
- `graph.ts` — assembles posts → tags → authors back-references, computes
  `prev`/`next` for posts, default `primary_tag`, `primary_author`.

Frontmatter convention (post):

```yaml
---
title: "Hello world"
slug: hello-world           # optional, derived from filename if omitted
date: 2026-01-15T09:00:00Z
updated_at: 2026-01-16T12:00:00Z
authors: [casper]           # references content/authors/casper.md
tags: [news, intro]         # tag slugs; auto-create the tag if missing
featured: false
feature_image: /content/images/hello.jpg
feature_image_alt: "Alt"
feature_image_caption: "Caption"
excerpt: "Optional override"
visibility: public          # public | members | paid — we only emit `public`
status: published           # draft hides from build
canonical_url: ""           # optional
og_title: ""                # optional Ghost SEO overrides
og_description: ""
og_image: ""
twitter_title: ""
twitter_description: ""
twitter_image: ""
meta_title: ""
meta_description: ""
custom_excerpt: ""
codeinjection_head: ""
codeinjection_foot: ""
---
```

Page frontmatter is the same shape minus the time-series fields (it still
accepts `date` for completeness).

Author frontmatter:

```yaml
---
slug: casper
name: "Casper"
bio: "Friendly ghost"
profile_image: /content/images/casper.jpg
cover_image: /content/images/casper-cover.jpg
website: https://example.com
location: "Internet"
twitter: "@ghost"
facebook: ghost
---
# Optional long bio body in Markdown
```

Tag frontmatter (under `content/tags/<slug>.md`, optional):

```yaml
---
slug: news
name: News
description: "Site news"
feature_image: /content/images/news.jpg
accent_color: "#005f73"
og_title: News from Nectar
og_description: Product and release updates
og_image: /content/images/news-share.jpg
twitter_title: News from Nectar
twitter_description: Product and release updates
twitter_image: /content/images/news-twitter.jpg
codeinjection_head: |
  <meta name="tag-scope" content="news">
codeinjection_foot: |
  <!-- tag archive footer snippet -->
---
```

If a tag is referenced by a post but has no `.md` file, the loader auto-creates
a minimal `Tag` with `name = slug` capitalised.

### 3.3 `src/theme`

- `loader.ts` — discover `.hbs` templates and partials, recursively. Mount
  partials by their relative path (`partials/icons/avatar.hbs` →
  `icons/avatar`).
- `assets.ts` — fingerprint every file in the theme's `assets/` directory by
  content hash. Build a `{ logical → fingerprinted }` map consumed by the
  `{{asset}}` helper. Emit the renamed files into `dist/assets/`.
- `config.ts` — parse `package.json`'s `config` block. Drive defaults for
  `posts_per_page`, `image_sizes`, `card_assets`, and **especially**
  `custom.*` (custom theme settings). Each custom setting becomes a key on
  `@custom`. A user can override the default via `nectar.toml`'s
  `[theme.custom]` table.
- `locales.ts` — load `locales/*.json`, expose to the `{{t}}` helper. The
  active locale comes from `[site].locale`.

### 3.4 `src/render`

The renderer wires Handlebars to Nectar's context. We use `handlebars`
(reference engine) directly because Ghost uses it, so behavior matches.

- `engine.ts` — creates a Handlebars instance per build, registers partials,
  registers helpers.
- `layouts.ts` — Ghost's `{{!< default}}` is implemented by string-rewriting
  the template at registration time: a `{{!< name}}` prefix is replaced with
  `{{#> name}}…{{/>}}` semantics. We do this by reading the layout, then
  rendering it with `{{{body}}}` filled by the inner template's output.
- `context.ts` — per-route context builder. Given a route + content graph,
  produces the data Handlebars sees: `@site`, `@blog`, `@custom`, `@page`
  (when on a page), pagination, `posts` (when in a list), `post`/`page`/
  `tag`/`author`/etc.
- `helpers/` — one file per helper. Each registers itself via a default
  export `register(hb, ctx)`.

### 3.5 `src/ghost`

Ghost-flavoured helpers and the `{{#get}}` query stub.

`{{#get}}` is normally a Ghost Content API call. In Nectar it's served by an
in-memory **resource resolver** that understands a tiny subset of the API
filter DSL:

- `filter="id:-<id>"`, `filter="tag:<slug>"`, `filter="tags:[a,b]"`,
  `filter="author:<slug>"`, `filter="featured:true"`
- `limit=N`, `order="published_at desc"`, `include="authors,tags"`

If a theme uses a filter expression we don't support, we warn and return an
empty array rather than crash.

### 3.6 `src/build`

- `routes.ts` — derive every URL we need to emit:
  - `/` from `index.hbs` (or `home.hbs` if exists)
  - `/page/N/` for paginated home
  - `/<post-slug>/` for each post
  - `/<page-slug>/` for each page
  - `/tag/<tag-slug>/` and `/tag/<tag-slug>/page/N/`
  - `/author/<author-slug>/` and pagination
- `paginate.ts` — slice posts into pages of `posts_per_page`.
- `emit.ts` — write each rendered HTML to disk, copy theme + content assets,
  fingerprint where appropriate.
- `feeds.ts` — emit `sitemap.xml` and `rss.xml` (optional but on by default).

### 3.7 `src/cli`

`src/cli/index.ts` is the Bun entry. Commands:

- `nectar build`              — full static build
- `nectar new post "Title"`   — scaffold a Markdown post
- `nectar new page "About"`   — scaffold a page
- `nectar serve`              — Bun.serve over `dist/` with watch + rebuild
- `nectar import-ghost <file>` — convert a Ghost JSON export → Markdown
- `nectar check`              — lint config + theme + content
- `nectar version`

Argument parsing: `bun`'s built-in `parseArgs` (Node-compat) is enough. No
external CLI lib needed.

### 3.8 `src/ghost/import.ts` — Ghost migration

Inputs: Ghost admin export JSON (`db: [{ data: { posts: [...], tags: [...],
posts_tags: [...], users: [...], posts_authors: [...] }}]`).

Outputs:
- `content/posts/<slug>.md` — frontmatter + body (Ghost stores body as either
  HTML, Mobiledoc, or Lexical; we convert HTML → Markdown via `turndown` and
  Lexical → HTML → Markdown via Ghost's `@tryghost/kg-lexical-html-renderer`
  if available, otherwise warn).
- `content/pages/<slug>.md`
- `content/authors/<slug>.md`
- `content/tags/<slug>.md` (only those with descriptions/images; trivial
  tags are inferred at build time)
- Asset references rewritten to local paths; the user is responsible for
  copying `content/images/` over.

## 4. Ghost helper coverage matrix

For each helper we track: **status** (✅ implemented / 🟡 partial / ⛔ stub /
❌ unsupported), **notes**.

| Helper            | Status | Notes |
|-------------------|--------|-------|
| `asset`           | ✅     | Fingerprinted via theme asset map |
| `img_url`         | 🟡     | Honors `size=` against `image_sizes` config, no on-the-fly resizing |
| `ghost_head`      | 🟡     | Outputs OG/Twitter/canonical/JSON-LD; no member scripts |
| `ghost_foot`      | 🟡     | Outputs `codeinjection_foot`; no member portal |
| `body_class`      | ✅     | Context-aware |
| `post_class`      | ✅     | |
| `meta_title`      | ✅     | Falls back to site title |
| `meta_description`| ✅     | |
| `date`            | ✅     | `moment`-style formats via `dayjs` |
| `t`               | ✅     | From theme `locales/*.json`, with `%` interpolation |
| `url`             | ✅     | Optional `absolute=true` |
| `concat`          | ✅     | |
| `link`            | ✅     | |
| `link_class`      | ✅     | |
| `navigation`      | ✅     | Renders `partials/navigation.hbs` if present, else minimal HTML |
| `pagination`      | ✅     | Renders `partials/pagination.hbs` if present, else minimal HTML |
| `reading_time`    | ✅     | Computed at load |
| `excerpt`         | ✅     | `words=`, `characters=` |
| `content`         | ✅     | Outputs SafeString HTML |
| `authors`         | ✅     | Inline rendering = comma list; block = iterate |
| `tags`            | ✅     | Same |
| `social_url`      | ✅     | Knows twitter/facebook/linkedin/bluesky/mastodon/threads/tiktok/youtube/instagram |
| `lang`            | ✅     | |
| `foreach`         | ✅     | Includes `@first`, `@last`, `@index`, `@number`, `@key`, `visibility` filter |
| `is`              | ✅     | `"post, page"`, `"home"`, `"index"`, `"tag"`, `"author"`, `"paged"` |
| `match`           | ✅     | `(value)` and `(value op other)` with `op in {=, !=, >, <, >=, <=, ~, ~^, ~$}` |
| `has`             | 🟡     | `tag:`, `author:`, `visibility:`, `slug:` only |
| `get`             | 🟡     | Local resolver, subset of Ghost filter DSL |
| `post`/`page`/    | ✅     | Context blocks |
| `tag`/`author`    | ✅     | |
| `comments`        | 🟡     | Emits provider snippet via `[components.comments]` (giscus, disqus, utterances, webmention.io) or empty placeholder when `provider = "off"` |
| `subscribe_form`  | ⛔     | Outputs a no-op form pointing at optional handler |
| `members`-helpers | ❌     | Not implemented |
| `cancel_link`     | ❌     | |
| `price`           | ❌     | |
| `input_email`     | ⛔     | Renders a plain input |
| `input_password`  | ⛔     | |
| `t`               | ✅     | |
| `encode`          | ✅     | |

## 5. Optional components

Each is a TypeScript module that hooks into the build pipeline by adding
routes, helpers, or post-build transformers. Configured via `nectar.toml`.

```toml
[components.search]
enabled = true
type    = "pagefind"     # "lunr" | "pagefind" | "off"

[components.rss]
enabled = true
items   = 20

[components.sitemap]
enabled = true

[components.opengraph]
enabled = true

[components.comments]
provider = "giscus"      # "off" | "giscus" | "disqus" | "utterances" | "webmention.io"
repo     = "owner/repo"  # giscus, utterances
# repo_id, category, category_id, mapping, theme, lang … for giscus
# issue_term, label, theme … for utterances
# shortname, identifier … for disqus
# username … for webmention.io
```

Optional ≠ baked-in. The build pipeline calls `applyComponents()` after route
emission; each component either adds files to `dist/` or rewrites HTML.

## 6. Testing strategy

- **Unit** (`tests/<module>.test.ts`) — small, hermetic. Frontmatter parser,
  asset fingerprinter, helper behavior. Driven by `bun test`.
- **Golden** (`tests/golden/`) — feed a tiny theme + tiny content directory
  in, snapshot the generated HTML. Diff against committed snapshots.
- **Source-theme smoke** (`tests/source-smoke.test.ts`) — build `example/`
  end-to-end and assert: every route emits HTML, no `{{` left in any output
  (i.e. no missing helper), every linked asset exists on disk, HTML parses.

CI:
- `bun run check`  (Biome lint + format)
- `bun run typecheck` (`tsc --noEmit`)
- `bun test`

## 7. Build sequence (MVP)

1. Project skeleton, `bun init`, `tsconfig`, `biome`, `bun test` smoke.
2. Markdown loader with YAML frontmatter, types, model tests.
3. Content graph + tag/author auto-resolution.
4. Theme loader: discover `.hbs`, register partials, parse `package.json`
   `config`.
5. Render engine: Handlebars + layout-inheritance rewriting.
6. Helpers: register the matrix above, lots of small files + tests.
7. Route planner + emitter.
8. Asset pipeline + `{{asset}}` fingerprinting.
9. Optional components: sitemap, rss.
10. `example/` scaffold (sample content + nectar.toml) and a green
    end-to-end build against Source.
11. Ghost import tool (last; it's orthogonal to the render path).

## 8. Open questions

- Do we want a `nectar dev` server with HMR? Probably yes eventually, but
  not in scope for the bootstrap milestone — `bun --watch` over `nectar
  build` is fine for now.
- Image transforms (`{{img_url … size="m"}}`): do we transcode at build, or
  just pass through? **Decision:** pass through for v0; document the limitation.
  Add `sharp` as an optional component later.
- Theme custom settings type validation: do we trust theme `package.json` and
  warn, or hard-fail when `nectar.toml` overrides an undeclared key? **Warn.**
- Drafts: filtered out at build by `status: draft`. No preview server yet.
