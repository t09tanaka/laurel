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
| `navigation[]` | `array<object>` | Primary navigation items, exposed to themes via `{{navigation}}`. |
| `secondary_navigation[]` | `array<object>` | Secondary navigation items, exposed to themes via `{{navigation type="secondary"}}`. |
| `components` | `object` | Optional components that emit extra files or inject markup. |

## `site`

Site-wide metadata exposed to themes as `@site` and `@blog`.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `site.title` | `string` | yes | — | Display title of the site, used by themes and feeds. |
| `site.description` | `string` | no | `""` | Short tagline rendered alongside the title in many themes and in feed metadata. |
| `site.url` | `string` | no | `"http://localhost:4321"` | Public absolute URL of the deployed site. Used to build canonical links, sitemap entries, and RSS GUIDs. |
| `site.locale` | `string` | no | `"en"` | BCP 47 language tag for the site. Drives `{{lang}}` and selects the theme's `locales/<tag>.json` translation file. |
| `site.timezone` | `string` | no | `"UTC"` | IANA timezone used when formatting dates in templates via `{{date}}`. |
| `site.cover_image` | `string` | no | — | Optional URL or content-relative path to a site-wide cover image. |
| `site.logo` | `string` | no | — | Optional URL or content-relative path to the site logo. |
| `site.logo_width` | `number` | no | — | Intrinsic width of the logo in pixels. Used by themes to avoid layout shift. |
| `site.logo_height` | `number` | no | — | Intrinsic height of the logo in pixels. Used by themes to avoid layout shift. |
| `site.icon` | `string` | no | — | Optional URL or content-relative path to the favicon / app icon. |
| `site.accent_color` | `string` | no | `"#222222"` | Brand accent color as a CSS color string. Surfaced to themes as `@site.accent_color`. |
| `site.twitter` | `string` | no | — | Optional Twitter / X handle (e.g. `@nectar`). Used to populate `twitter:site` meta tags. |
| `site.facebook` | `string` | no | — | Optional Facebook page slug. Used to populate `og:article:publisher` meta tags. |

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
| `content.visibility_policy` | `"truncate" \| "render-full" \| "skip"` | no | `"truncate"` | How to render posts whose `visibility` is `members` or `paid`. `truncate` cuts the body at `paywall_word_count`, `render-full` keeps the body intact (losing the paywall), and `skip` drops the post entirely. |
| `content.paywall_word_count` | `number` | no | `300` | Number of words kept before the paywall cut when `visibility_policy` is `truncate`. |

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

## `components`

Optional components that emit extra files or inject markup.


## `components.rss`

RSS feed component.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.rss.enabled` | `boolean` | no | `true` | Emit an `rss.xml` feed. |
| `components.rss.items` | `number` | no | `20` | Maximum number of posts included in the feed. |

## `components.sitemap`

Sitemap component.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.sitemap.enabled` | `boolean` | no | `true` | Emit `sitemap.xml`. |

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
| `components.content_api.enabled` | `boolean` | no | `true` | Emit JSON snapshots of posts, pages, tags, and authors under `content-api/` so themes (and external consumers) can fetch a Ghost-style content view. |

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
| `components.subscribe.provider` | `"none" \| "buttondown" \| "mailchimp" \| "custom"` | no | `"none"` | Subscribe form provider. `none` hides the form entirely. |
| `components.subscribe.action` | `string` | no | — | Form action URL. Required when `provider` is `custom`; inferred for known providers when omitted. |
| `components.subscribe.username` | `string` | no | — | Provider username (e.g. Buttondown username, Mailchimp list u/id segment). |
| `components.subscribe.email_field_name` | `string` | no | — | Name of the email input field. Defaults to a provider-appropriate value. |

## `components.images`

Per-format image transcoder. Generates WebP/AVIF variants of responsive widths and rewrites `<img>` into `<picture>` so themes get modern-format fallback automatically.

| Key | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `components.images.enabled` | `boolean` | no | `false` | Emit per-format image variants (WebP/AVIF) alongside the same-format responsive widths and wrap `<img>` in `<picture>` for browser fallback. Requires `sharp`. |
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
