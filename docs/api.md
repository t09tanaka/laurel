# Nectar Content API

Nectar emits a static, Ghost-shaped Content API at build time. This document
describes what is and is not supported, and how it diverges from Ghost's
hosted Content API.

For a minimal browser app that consumes the SDK shadow tree with
`@tryghost/content-api`, see [`EXAMPLE_SPA.md`](./EXAMPLE_SPA.md).

## Layout

Each `nectar build` writes two parallel JSON trees into the output:

1. **Flat dump** at `/content/*` — for browser-only consumers that
   `fetch('/content/posts.json')` without an SDK.
2. **SDK shadow tree** at `/ghost/api/content/*` — for clients written
   against the `@tryghost/content-api` JavaScript SDK.

Both trees ship the same payloads, projected through the same serializers, so
a site can serve either entry point (or both) from a single build.

### Resources

| Path (flat / SDK)                                       | Content                                |
| ------------------------------------------------------- | -------------------------------------- |
| `content/posts.json`                                    | All published posts                    |
| `content/posts/<id>.json`                               | Single post by id                      |
| `content/posts/slug/<slug>.json`                        | Single post by slug                    |
| `content/posts/page/<n>.json`                           | Paginated post shards                  |
| `content/posts/tag/<slug>.json`                         | Posts pre-filtered by tag              |
| `content/posts/featured.json`                           | Featured posts                         |
| `content/pages.json`                                    | All published pages                    |
| `content/pages/<id>.json`                               | Single page by id                      |
| `content/pages/slug/<slug>.json`                        | Single page by slug                    |
| `content/tags.json`                                     | All public tags                        |
| `content/authors.json`                                  | All authors (`count.posts` included)   |
| `content/tiers.json`                                    | Empty members-tier stub                |
| `content/newsletters.json`                              | Empty newsletter stub                  |
| `content/settings.json`                                 | Site settings singleton                |
| `.well-known/ghost.json`                                | Nectar/Ghost-compatible discovery      |

The same paths exist under `ghost/api/content/...` for SDK consumers.

Each resource also lands at `<path>/index.json` so static hosts that resolve
`/content/posts/` to a directory index (Netlify) and ones that resolve it to
the bare `.json` (Cloudflare Pages, S3) both work from a single build.

## Pagination

`meta.pagination.next` and `meta.pagination.prev` are emitted as **numbers**
(not URLs). To walk pages, the consumer fetches
`content/posts/page/<meta.pagination.next>.json`.

Page size is controlled by `[components.content_api].posts_per_page` (default
`15`, matching Ghost's default `limit`). Setting a higher value reduces the
shard count; setting it lower spreads payload across more requests.

## Per-resource Cache-Control

The emitted `_headers` file (Netlify) and `_headers.cf` (Cloudflare Pages)
apply CORS headers and per-resource cache TTLs:

| Pattern              | `Cache-Control`              | Why                           |
| -------------------- | ---------------------------- | ----------------------------- |
| `/content/posts/*`   | `public, max-age=300` (5min) | Posts churn most often        |
| `/content/tags/*`    | `public, max-age=3600` (1h)  | Tags are stable in practice   |
| `/content/authors/*` | `public, max-age=3600` (1h)  | Authors are stable in practice|
| `/content/*`         | `public, max-age=300` (5min) | Safe default for the rest     |

Every rule also sets:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`
- `Access-Control-Max-Age: 86400`

Self-hosted deployments that do not consume `_headers` should copy the same
rules from the nginx, Apache, or Caddy snippets:

- [`docs/deploy/cors-nginx.md`](./deploy/cors-nginx.md)
- [`docs/deploy/cors-apache.md`](./deploy/cors-apache.md)
- [`docs/deploy/cors-caddy.md`](./deploy/cors-caddy.md)

Apache operators may also enable `[components.content_api].emit_htaccess = true`
to write `dist/content/.htaccess` with these Content API headers.

These values are hardcoded. To override, write your own rules into
`[deploy.headers].cache_rules` — the platform emitter appends those into the
same file.

## `absolute_urls=true`

Ghost's hosted Content API accepts a `?absolute_urls=true` query parameter
that rewrites relative URLs in HTML body fields to absolute URLs. Nectar
mirrors this as a **build-time switch**:

```toml
[components.content_api]
absolute_urls = true
```

When enabled, `posts[].html`, `pages[].html`, and the per-tag/paginated/by-id
shadow shards rewrite relative `src`, `href`, `poster`, and `action`
attributes to absolute URLs rooted at `[site].url` + `[build].base_path`.
URLs that are already absolute (`http://`, `https://`, `//`, `data:`,
`mailto:`, `tel:`, fragment-only `#...`) are left untouched.

Default is `false`. The query parameter form `?absolute_urls=true` is not
implemented — the rewrite happens at build time, not at request time.

## `post.html` body markup

`posts[].html` and `pages[].html` are generated from Nectar's Markdown renderer.
They are suitable for public reader-facing HTML, but they are not a byte-for-byte
copy of Ghost's internal Koenig serializer.

Nectar preserves the stable class hooks for supported Koenig cards when content
was imported from Ghost or authored with Nectar's card shortcodes. For example,
image, bookmark, gallery, callout, button, toggle, file, audio, video, product,
header, signup, recommendations, and NFT cards may expose `kg-card` and
card-specific classes so Ghost-theme CSS can still match them.

Nectar does not preserve Ghost editor control comments in API output. Markers
such as `<!--kg-card-begin: markdown-->`, `<!--kg-card-end: markdown-->`,
`<!--kg-card-begin: html-->`, and `<!--kg-card-begin: paywall-->` are consumed
by import, sanitisation, or paywall handling. Likewise, members/email-only card
content and Ghost's server-side member paywall split DOM are not serialized into
public `post.html`.

Consumers should treat `html` as sanitized display HTML and key off documented
reader-facing classes rather than exact Ghost serializer bytes. See
[`GHOST_COMPATIBILITY.md` §Content API `post.html` serialization](./GHOST_COMPATIBILITY.md#content-api-posthtml-serialization)
for the compatibility contract and current card matrix.

## `?key=` and other SDK init params

The Ghost Content API SDK requires a `key` parameter at init time and
encodes it as `?key=...` on every request:

```js
const api = new GhostContentAPI({
  url: 'https://example.com',
  key: '0123456789abcdef0123456789',
  version: 'v5.0',
});
```

Nectar's static dump **accepts and ignores** the `?key=` query parameter.
Any value (including a real Ghost key, a placeholder, or a 26-char hex
string) works. The dump is fully public; there is no API key validation
because there is no server.

This means the SDK init form is compatible as-is. Operators rotating keys
in their themes do not need to coordinate with Nectar.

Nectar does not emit a key registry such as
`.well-known/ghost-content-keys.json`. The static dump is public and accepts
any key value.

## Query parameters

Nectar's Content API is generated at build time, so request-time query
parameters do not change the payload. Static hosts strip or ignore query
strings before resolving the JSON file.

The deliberate divergences are:

- `?fields=title,slug` is ignored. Full records are always emitted; project
  fields in the client if you need a smaller object.
- `?formats=html,plaintext,mobiledoc,lexical` is ignored. Nectar emits `html`
  and `plaintext` for posts/pages and does not emit `mobiledoc` or `lexical`.
- `?include=authors,tags` is ignored. Posts/pages always include `tags`,
  `authors`, `primary_tag`, and `primary_author`.
- `?include=count.posts` is ignored. Tags and authors always include
  `count.posts`.
- `?order=` is ignored. Canonical output order is posts by
  `published_at desc`, tags by `name asc`, and authors by `name asc`.
- `?v=v5.0` and older `?v=` values are ignored. Nectar emits one v5-shaped
  representation. A future incompatible schema would use a versioned path,
  not query-time branching.

## NQL filtering (`?filter=...`)

Ghost's Content API accepts arbitrary [NQL](https://ghost.org/docs/content-api/#filtering)
filter expressions:

```
?filter=tag:news+featured:true,visibility:public
```

**Arbitrary NQL is not supported by Nectar.** There is no expression
evaluator on a static host. Instead, Nectar pre-bakes the most common
filter — `tag:<slug>` — into shards at `content/posts/tag/<slug>.json`.
Consumers that need a different cut should fetch `content/posts.json` and
filter client-side.

If you need server-side filtering, run a real Ghost backend or proxy
through a server-side worker (e.g. a Cloudflare Worker that reads the same
JSON and applies NQL on the fly).

## Static empty resources

Ghost's Content API exposes members/newsletter resources that depend on live
Ghost services. Nectar emits empty stubs so SDK consumers can call them
without a 404:

- `content/tiers.json` / `ghost/api/content/tiers.json`
- `content/newsletters.json` / `ghost/api/content/newsletters.json`

Both return an empty array with `meta.pagination`. Nectar does not implement
members billing, newsletter delivery, offers, or email analytics.

Posts also include static compatibility fields for SDK/type consumers:
`email_only: false`, `email: null`, and
`send_email_when_published: false`.

## Other emitted files

The Content API is not the only machine-readable output Nectar can emit.
Depending on component config, builds may also include:

- `sitemap.xml`
- `rss.xml`
- `robots.txt`
- `humans.txt`
- search indexes under `content/search.json`, `pagefind/`, or provider
  records

These are static build artifacts, not Ghost Content API endpoints.

## Explicit non-support

Nectar does not emit:

- AMP routes such as `/post-slug/amp/`
- `<link rel="amphtml">` in `{{ghost_head}}`, because there is no generated
  AMP target for crawlers to fetch
- Ghost Image API resize URLs like `/content/images/size/w600/...`
- `GET /oembed/?url=...`
- Ghost Admin API webhooks or integration endpoints
- A published `@nectar/content-api-types` package

Use pre-generated images, theme/plugin code, or host/CI deploy hooks for
those concerns.

## Admin API

**Nectar does not implement the Ghost Admin API.** Nectar is read-only; the
content source of truth is the Markdown files in `content/`. Authoring
flows that would normally call the Admin API (`POST /admin/posts/`, etc.)
should instead:

1. Edit / add Markdown files in the Git repository.
2. Run `nectar build` to regenerate the static output.
3. Deploy the new build.

For a CMS-like editing experience, use a Git-backed editor (Decap CMS,
TinaCMS, Sveltia CMS) that commits Markdown files directly. Nectar will
pick up the new content on the next build.

## Members-only content

Posts whose `visibility` is `members`, `paid`, `tiers`, or `filter` have
their body fields (`html`, `plaintext`, `excerpt`) stripped in the public
JSON dump. The metadata (`title`, `feature_image`, `tags`, `authors`,
`published_at`, etc.) remains so a client navigation can still surface
restricted entries with a "members-only" badge. To gate the body itself
behind a real paywall, you need a server.

The full body is still rendered (subject to `[content].visibility_policy`)
into the static HTML pages; the strip only applies to the JSON dump.

## `access` field

Every post and page in the public JSON dump carries `access: 'public'`.
This marks the **payload itself** as the public, anonymous-reader view
(not the underlying post-level gating). It signals to downstream tools
that the body in this response is what an unauthenticated reader sees.

Ghost's `post.access` field is normally a boolean tied to the current
viewer's permission; in Nectar there is no signed-in viewer, so the
payload is always the public view and `access` is always `'public'`.

## Stability

See [api-stability.md](./api-stability.md) for the versioning contract.
