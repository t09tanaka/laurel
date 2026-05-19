import { z } from 'zod';

const navigationItemSchema = z
  .object({
    label: z.string().describe('Anchor text shown in theme navigation.'),
    url: z
      .string()
      .describe(
        'Destination of the link. May be an absolute URL or a path relative to the site root.',
      ),
  })
  .strict();

const recommendationItemSchema = z
  .object({
    title: z.string().describe('Display title of the recommended site.'),
    url: z.string().describe('Absolute URL of the recommended site.'),
    description: z
      .string()
      .optional()
      .describe('Short blurb shown beneath the title in the recommendations list.'),
    favicon: z
      .string()
      .optional()
      .describe('Optional URL or content-relative path to the site icon shown in the list.'),
    featured_image: z
      .string()
      .optional()
      .describe('Optional cover image URL displayed on the full `/recommendations/` page.'),
    reason: z
      .string()
      .optional()
      .describe('Optional editorial reason shown alongside the title on the full page.'),
  })
  .strict();

// Declarative pricing tiers surfaced via `{{#get "tiers"}}` so Ghost themes
// with pricing pages can render against a static config. Ghost ships richer
// tier objects (Stripe price ids, trial days, currency_symbol) that only
// matter when a live Portal backend processes payments. Nectar keeps the
// surface minimal — name, blurb, prices, signup link, benefits — and lets
// themes format prices via the existing `{{currency}}` helper.
const tierItemSchema = z
  .object({
    name: z.string().describe('Display name of the tier (e.g. "Free", "Premium"). Required.'),
    description: z
      .string()
      .default('')
      .describe('Short blurb shown alongside the tier name in pricing tables.'),
    monthly_price: z
      .number()
      .nonnegative()
      .optional()
      .describe(
        'Monthly price in whole units of `currency` (e.g. `9` for $9/mo). Omit on free tiers.',
      ),
    yearly_price: z
      .number()
      .nonnegative()
      .optional()
      .describe(
        'Yearly price in whole units of `currency`. Omit on free tiers or to hide the yearly option.',
      ),
    currency: z
      .string()
      .default('USD')
      .describe('ISO 4217 currency code for `monthly_price` / `yearly_price`. Defaults to `USD`.'),
    welcome_page_url: z
      .string()
      .optional()
      .describe(
        'Destination URL for Subscribe buttons targeting this tier (e.g. an external checkout / signup page).',
      ),
    benefits: z
      .array(z.string())
      .default([])
      .describe('Bullet-point benefits surfaced on pricing tables, in display order.'),
  })
  .strict();

export const configSchema = z
  .object({
    site: z
      .object({
        title: z.string().describe('Display title of the site, used by themes and feeds.'),
        description: z
          .string()
          .default('')
          .describe(
            'Short tagline rendered alongside the title in many themes and in feed metadata.',
          ),
        url: z
          .string()
          .default('http://localhost:4321')
          .describe(
            'Public absolute URL of the deployed site. Used to build canonical links, sitemap entries, and RSS GUIDs.',
          ),
        locale: z
          .string()
          .default('en')
          .describe(
            "BCP 47 language tag for the site. Drives `{{lang}}` and selects the theme's `locales/<tag>.json` translation file.",
          ),
        timezone: z
          .string()
          .default('UTC')
          .describe('IANA timezone used when formatting dates in templates via `{{date}}`.'),
        cover_image: z
          .string()
          .optional()
          .describe('Optional URL or content-relative path to a site-wide cover image.'),
        logo: z
          .string()
          .optional()
          .describe('Optional URL or content-relative path to the site logo.'),
        logo_width: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Intrinsic width of the logo in pixels. Used by themes to avoid layout shift.'),
        logo_height: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Intrinsic height of the logo in pixels. Used by themes to avoid layout shift.',
          ),
        icon: z
          .string()
          .optional()
          .describe('Optional URL or content-relative path to the favicon / app icon.'),
        accent_color: z
          .string()
          .default('#222222')
          .describe(
            'Brand accent color as a CSS color string. Surfaced to themes as `@site.accent_color`.',
          ),
        twitter: z
          .string()
          .optional()
          .describe(
            'Optional Twitter / X handle (e.g. `@nectar`). Used to populate `twitter:site` meta tags.',
          ),
        facebook: z
          .string()
          .optional()
          .describe(
            'Optional Facebook page slug. Used to populate `og:article:publisher` meta tags.',
          ),
      })
      .strict()
      .default({ title: 'Nectar Site' })
      .describe('Site-wide metadata exposed to themes as `@site` and `@blog`.'),
    theme: z
      .object({
        name: z
          .string()
          .default('source')
          .describe('Theme directory name inside `theme.dir`. Resolved as `<dir>/<name>/`.'),
        dir: z
          .string()
          .default('themes')
          .describe('Directory containing theme folders, relative to the project root.'),
        custom: z
          .record(z.unknown())
          .default({})
          .describe(
            "Free-form key/value map surfaced to templates as `@custom`. Mirrors Ghost's `package.json` `config.custom` settings.",
          ),
      })
      .strict()
      .default({})
      .describe('Theme selection and `@custom` settings.'),
    content: z
      .object({
        posts_dir: z
          .string()
          .default('content/posts')
          .describe('Directory of Markdown post sources, relative to the project root.'),
        pages_dir: z
          .string()
          .default('content/pages')
          .describe('Directory of Markdown page sources, relative to the project root.'),
        authors_dir: z
          .string()
          .default('content/authors')
          .describe('Directory of author profile Markdown files, relative to the project root.'),
        tags_dir: z
          .string()
          .default('content/tags')
          .describe('Directory of tag profile Markdown files, relative to the project root.'),
        assets_dir: z
          .string()
          .default('content/images')
          .describe(
            'Directory of content-bundled image and binary assets, relative to the project root.',
          ),
        visibility_policy: z
          .enum(['truncate', 'render-full', 'skip'])
          .default('truncate')
          .describe(
            'How to render posts whose `visibility` is `members` or `paid`. `truncate` cuts the body at `paywall_word_count`, `render-full` keeps the body intact (losing the paywall), and `skip` drops the post entirely.',
          ),
        paywall_word_count: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .describe(
            'Number of words emitted as a free preview before the paywall cut when `visibility_policy` is `truncate` and the post body has no `<!-- members -->` marker. Defaults to `0` so members/paid posts never leak body content to anonymous readers without an explicit marker; raise it to opt into a fixed-word preview.',
          ),
      })
      .strict()
      .default({})
      .describe('Where Markdown content lives and how members-only posts are handled.'),
    build: z
      .object({
        output_dir: z
          .string()
          .default('dist')
          .describe('Directory to emit the built site into, relative to the project root.'),
        base_path: z
          .string()
          .default('/')
          .describe(
            'URL prefix the site is served from (e.g. `/` for a root deployment, `/blog/` for a subpath). All generated links and asset URLs respect this prefix.',
          ),
        posts_per_page: z
          .number()
          .int()
          .positive()
          .default(12)
          .describe('Posts per paginated index / archive page.'),
        copy_content_assets: z
          .boolean()
          .default(true)
          .describe(
            'When true, copy `content.assets_dir` into the output as `content/images/` so post-relative image URLs resolve.',
          ),
        max_image_bytes: z
          .number()
          .int()
          .nonnegative()
          .default(5 * 1024 * 1024)
          .describe(
            'Refuse to emit raster images larger than this many bytes during content-asset copy, so a stray 40 MB DSLR JPEG cannot tank LCP. `0` disables the check entirely. Default is 5 MiB.',
          ),
        allow_code_injection: z
          .boolean()
          .default(false)
          .describe(
            "Allow per-post `codeinjection_head` / `codeinjection_foot` frontmatter to inject raw HTML via `{{ghost_head}}` / `{{ghost_foot}}`. Disabled by default because a single PR adding `codeinjection_foot: '<script src=//evil.tld/x.js></script>'` would ship site-wide JS once merged. Set to `true` only if you trust every contributor with write access to `content/` to add arbitrary HTML or JS.",
          ),
        minify_html: z
          .boolean()
          .default(false)
          .describe(
            'Run rendered HTML through `html-minifier-terser` before writing it to disk. Collapses whitespace and strips comments to trim payload size for production deploys. Disabled by default because the minifier adds a small build-time cost and most local dev iterations do not need it. Requires the optional `html-minifier-terser` dependency; when missing, the build logs a warning once and emits unminified HTML instead of failing.',
          ),
      })
      .strict()
      .default({})
      .describe('Build pipeline options that shape the emitted site.'),
    navigation: z
      .array(navigationItemSchema)
      .default([])
      .describe('Primary navigation items, exposed to themes via `{{navigation}}`.'),
    secondary_navigation: z
      .array(navigationItemSchema)
      .default([])
      .describe(
        'Secondary navigation items, exposed to themes via `{{navigation type="secondary"}}`.',
      ),
    recommendations: z
      .array(recommendationItemSchema)
      .default([])
      .describe(
        'External sites surfaced through Ghost\'s `{{recommendations}}` helper. When non-empty, the site exposes `@site.recommendations_enabled = true` so themes like Source render the sidebar block, and Nectar auto-emits a `/recommendations/` page listing all entries inside a `<section id="all-recommendations">` block. The Source theme\'s "See all" button (`data-portal="recommendations"`) is rewritten to deep-link into that section.',
      ),
    tiers: z
      .array(tierItemSchema)
      .default([])
      .describe(
        'Declarative membership tiers exposed to themes via `{{#get "tiers"}}` and `{{tiers}}`. Each entry becomes a Ghost-shaped tier object (with `id`, `slug`, `type`, `active`, `visibility`, `monthly_price`, `yearly_price`, `currency`, `welcome_page_url`, `benefits`) so pricing tables in Ghost themes render against a static config without a live Portal backend. Tiers without a `monthly_price` are typed as `free`; any positive price flips the entry to `paid`. When empty, `{{#get "tiers"}}` resolves to an empty list and the block silently no-ops.',
      ),
    deploy: z
      .object({
        github_pages: z
          .object({
            custom_domain: z
              .string()
              .optional()
              .describe(
                'Apex or subdomain host to bind to a GitHub Pages site (e.g. `blog.example.com`). When set, the build emits a `CNAME` file at the output root so GitHub Pages picks up the custom domain. Leave unset for `*.github.io` deployments.',
              ),
          })
          .strict()
          .default({})
          .describe('GitHub Pages-specific deploy hints.'),
        cloudflare_pages: z
          .object({
            enabled: z
              .boolean()
              .default(false)
              .describe(
                'Emit Cloudflare Pages `_headers` and (when a `redirects.yaml` exists at the project root) `_redirects` at the output root. The `_headers` defaults pin fingerprinted asset URLs (`/assets/*`, `/content/images/*`) to a year of immutable caching and force HTML responses to revalidate every request, plus a minimal set of security headers (`X-Content-Type-Options`, `Referrer-Policy`). The `_redirects` emitter loads rules from `redirects.yaml` (`[{from, to, status}]` with status one of 301/302/307/308, default 301), drops later rules whose `from` repeats an earlier one (Cloudflare uses first-match), and prepends them before any existing `_redirects` entries. Leave disabled when deploying somewhere other than Cloudflare Pages.',
              ),
          })
          .strict()
          .default({})
          .describe('Cloudflare Pages-specific deploy hints.'),
        netlify: z
          .object({
            enabled: z
              .boolean()
              .default(false)
              .describe(
                'Emit Netlify `_headers` and (when a `redirects.yaml` exists at the project root) `_redirects` at the output root. `_headers` defaults pin fingerprinted asset URLs (`/assets/*`, `/content/images/*`) to a year of immutable caching and force HTML responses to revalidate every request, plus a minimal set of security headers (`X-Content-Type-Options`, `Referrer-Policy`). The `_redirects` emitter loads rules from `redirects.yaml` (`[{from, to, status, force}]` with status one of 301/302/307/308, default 301), maps `force: true` to a Netlify `!` suffix on the status (e.g. `301!`) so the rule fires even when a static file exists at `from`, drops later rules whose `from` repeats an earlier one (Netlify uses first-match), and prepends them before any existing `_redirects` entries. Leave disabled when deploying somewhere other than Netlify.',
              ),
          })
          .strict()
          .default({})
          .describe('Netlify-specific deploy hints.'),
        vercel: z
          .object({
            enabled: z
              .boolean()
              .default(false)
              .describe(
                "Emit a single `vercel.json` at the output root folding both `deploy.headers` and `redirects.yaml` into Vercel's native config shape. `headers` mirrors the cross-cutting cache + security rules (with glob `*` translated to path-to-regexp `(.*)` so the same patterns match the same paths on every deploy target). `redirects` mirrors `redirects.yaml` ([{from, to, status, force}] with status one of 301/302/307/308) using `statusCode` for the HTTP status. Vercel always honors redirects regardless of static-file collisions (the same semantics as Cloudflare Pages), so the `force` flag is informational on this target. Leave disabled when deploying somewhere other than Vercel.",
              ),
          })
          .strict()
          .default({})
          .describe('Vercel-specific deploy hints.'),
        nginx: z
          .object({
            enabled: z
              .boolean()
              .default(false)
              .describe(
                "Emit a self-hosted nginx server block at `<output>/.nectar/nginx.conf` folding both `deploy.headers` and `redirects.yaml` into a single config snippet. The block sets `gzip_static on; brotli_static on;` for pre-compressed assets, emits one `location` per `deploy.headers.cache_rules` entry with the matching `Cache-Control` header, attaches every configured security header to each `location` (nginx `add_header` does not merge with parent blocks, so they are repeated rather than inherited), serves SPA-style routes with `try_files $uri $uri/ $uri/index.html =404;` (the `$uri/` middle term is the trailing-slash variant so a request to `/about` falls through `/about/` — which triggers the `index` directive's canonical-slug redirect — before resolving `/about/index.html`), and translates each `redirects.yaml` entry into a `location { return <status> <to>; }` rule. Output lives under `.nectar/` (not the publish root) so the file is never served over HTTP. Leave disabled when deploying somewhere other than self-hosted nginx.",
              ),
            root: z
              .string()
              .default('/var/www/nectar')
              .describe(
                'Filesystem path nginx should serve from, emitted as the `root` directive in the generated server block. Defaults to `/var/www/nectar` — adjust to match wherever you rsync `dist/` on the host.',
              ),
            server_name: z
              .string()
              .default('_')
              .describe(
                "Value of the `server_name` directive in the generated server block. Defaults to `_` (nginx's catch-all hostname) so the snippet drops onto a fresh VPS without editing. Override with the actual hostname when serving multiple sites from one nginx instance.",
              ),
          })
          .strict()
          .default({})
          .describe('Self-hosted nginx-specific deploy hints.'),
        headers: z
          .object({
            security: z
              .object({
                content_type_options: z
                  .string()
                  .nullable()
                  .default('nosniff')
                  .describe(
                    'Value of the `X-Content-Type-Options` header applied to the catch-all route. `null` omits the header.',
                  ),
                frame_options: z
                  .string()
                  .nullable()
                  .default(null)
                  .describe(
                    'Value of the legacy `X-Frame-Options` header (e.g. `DENY`, `SAMEORIGIN`). Off by default because modern sites prefer `frame-ancestors` in CSP; set when older browsers still matter.',
                  ),
                referrer_policy: z
                  .string()
                  .nullable()
                  .default('strict-origin-when-cross-origin')
                  .describe(
                    'Value of the `Referrer-Policy` header applied to the catch-all route. `null` omits the header.',
                  ),
                strict_transport_security: z
                  .string()
                  .nullable()
                  .default(null)
                  .describe(
                    'Value of the `Strict-Transport-Security` header. Off by default; set to e.g. `max-age=63072000; includeSubDomains` once you are confident the site only serves over HTTPS.',
                  ),
                content_security_policy: z
                  .string()
                  .nullable()
                  .default(null)
                  .describe(
                    'Value of the `Content-Security-Policy` header. Off by default because a strict CSP can break themes that inline scripts; configure once you have audited theme markup.',
                  ),
                permissions_policy: z
                  .string()
                  .nullable()
                  .default(null)
                  .describe(
                    'Value of the `Permissions-Policy` header (e.g. `camera=(), microphone=(), geolocation=()`). Off by default; opt in to deny features the site does not need.',
                  ),
                cross_origin_opener_policy: z
                  .string()
                  .nullable()
                  .default(null)
                  .describe(
                    'Value of the `Cross-Origin-Opener-Policy` header. Off by default; set to `same-origin` to isolate the browsing context group for stronger XS-Leak protection.',
                  ),
                cross_origin_embedder_policy: z
                  .string()
                  .nullable()
                  .default(null)
                  .describe(
                    'Value of the `Cross-Origin-Embedder-Policy` header. Off by default; pair with `cross_origin_opener_policy` to enable cross-origin isolation. Can break themes that load third-party assets without CORP, so opt in deliberately.',
                  ),
                custom: z
                  .record(z.string())
                  .default({})
                  .describe(
                    'Free-form map of additional header name → value pairs applied to the catch-all route. Useful for headers without a first-class field (e.g. `X-Robots-Tag`, vendor-specific cache hints).',
                  ),
              })
              .strict()
              .default({})
              .describe(
                'Security-related response headers attached to the catch-all (`/*`) route. Each platform emitter translates these into its native `_headers` syntax. Set any field to `null` (or omit) to skip the header entirely.',
              ),
            cache_rules: z
              .array(
                z
                  .object({
                    pattern: z
                      .string()
                      .describe(
                        'URL pattern matched by the deploy platform. Cloudflare Pages and Netlify both honor glob-style patterns like `/assets/*` and the catch-all `/*`. Patterns are emitted in array order and most platforms use first-match, so put specific rules before catch-alls.',
                      ),
                    cache_control: z
                      .string()
                      .describe(
                        'Value of the `Cache-Control` header applied to requests matching `pattern`.',
                      ),
                  })
                  .strict(),
              )
              .default([
                {
                  pattern: '/assets/*',
                  cache_control: 'public, max-age=31536000, immutable',
                },
                {
                  pattern: '/content/images/*',
                  cache_control: 'public, max-age=31536000, immutable',
                },
                {
                  pattern: '/*',
                  cache_control: 'public, max-age=0, must-revalidate',
                },
              ])
              .describe(
                'Ordered list of `Cache-Control` rules emitted into the deploy platform `_headers` file. Defaults pin fingerprinted assets to a year of immutable caching and force HTML to revalidate every request. The catch-all `/*` rule is always emitted last regardless of position so security headers attach to it without shadowing more specific patterns.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Cross-cutting HTTP response headers (security + cache rules) translated by each platform emitter (`deploy.cloudflare_pages`, `deploy.netlify`) into their native `_headers` format.',
          ),
      })
      .strict()
      .default({})
      .describe('Deploy-target-specific hints that influence files emitted alongside the site.'),
    components: z
      .object({
        rss: z
          .object({
            enabled: z.boolean().default(true).describe('Emit an `rss.xml` feed.'),
            items: z.number().default(20).describe('Maximum number of posts included in the feed.'),
          })
          .strict()
          .default({})
          .describe('RSS feed component.'),
        sitemap: z
          .object({
            enabled: z.boolean().default(true).describe('Emit `sitemap.xml`.'),
          })
          .strict()
          .default({})
          .describe('Sitemap component.'),
        opengraph: z
          .object({
            enabled: z
              .boolean()
              .default(true)
              .describe('Emit Open Graph and Twitter Card meta tags via `{{ghost_head}}`.'),
            rasterize_svg: z
              .boolean()
              .default(true)
              .describe(
                'Convert SVG cover images to PNG for OG sharing so Facebook and X render them.',
              ),
            rasterize_width: z
              .number()
              .int()
              .positive()
              .default(1200)
              .describe('Pixel width used when rasterizing SVG cover images for OG.'),
          })
          .strict()
          .default({})
          .describe('Open Graph and Twitter Card metadata component.'),
        og_images: z
          .object({
            enabled: z
              .boolean()
              .default(false)
              .describe('Render per-post Open Graph images from a template.'),
            template: z
              .string()
              .optional()
              .describe('Path to the OG image template, relative to the project root.'),
            width: z
              .number()
              .int()
              .positive()
              .default(1200)
              .describe('Generated OG image width in pixels.'),
            height: z
              .number()
              .int()
              .positive()
              .default(630)
              .describe('Generated OG image height in pixels.'),
          })
          .strict()
          .default({})
          .describe('Auto-generated Open Graph image component.'),
        content_api: z
          .object({
            enabled: z
              .boolean()
              .default(true)
              .describe(
                'Emit JSON snapshots of posts, pages, tags, and authors under `content-api/` so themes (and external consumers) can fetch a Ghost-style content view.',
              ),
          })
          .strict()
          .default({})
          .describe('JSON content API component.'),
        search: z
          .object({
            enabled: z
              .boolean()
              .default(true)
              .describe(
                "Emit a client-side search index. When `engine` is `json` or `json+pagefind`, writes a flat `content/search.json` ({ posts, pages, tags, authors }) suitable for fuzzy-search libraries (lunr / Fuse / minisearch). When `engine` is `pagefind` or `json+pagefind`, additionally shells out to the `pagefind` CLI over the staged output to emit `pagefind/*`. Nectar does NOT replicate Ghost's `/search/` endpoint shape; the JSON field set is divergent.",
              ),
            engine: z
              .enum(['json', 'pagefind', 'json+pagefind'])
              .default('json')
              .describe(
                'Search backend. `json` emits only the flat index (cheap, zero deps, works for small/medium sites). `pagefind` skips the JSON and runs the `pagefind` CLI for a chunked index that scales to large archives. `json+pagefind` emits both so the consumer can pick at runtime.',
              ),
            excerpt_words: z
              .number()
              .int()
              .nonnegative()
              .default(30)
              .describe(
                'Maximum number of words from `custom_excerpt` (or auto-excerpt) included in each entry. Keeps `search.json` small so a multi-hundred-post site still ships in a single fetch. `0` omits excerpts entirely.',
              ),
            include_pages: z
              .boolean()
              .default(true)
              .describe(
                'Include static pages in `search.json`. Set to `false` to index posts only.',
              ),
            include_tags: z
              .boolean()
              .default(true)
              .describe(
                'Include public tags in `search.json` so a search UI can surface tag pages alongside posts.',
              ),
            include_authors: z
              .boolean()
              .default(true)
              .describe(
                'Include authors in `search.json` so a search UI can surface author pages.',
              ),
            pagefind_bin: z
              .string()
              .optional()
              .describe(
                'Optional path or command for the `pagefind` CLI. Defaults to `pagefind` resolved via `PATH`. Only consulted when `engine` includes `pagefind`.',
              ),
          })
          .strict()
          .default({})
          .describe(
            "Client-side search component. Emits a flat `content/search.json` and/or runs Pagefind. NOT a drop-in replacement for Ghost's `/search/` endpoint; the JSON shape is divergent and consumers must wire a client-side search library (lunr / Fuse / minisearch) themselves.",
          ),
        robots: z
          .object({
            enabled: z.boolean().default(true).describe('Emit a `robots.txt` file.'),
            disallow: z
              .boolean()
              .default(false)
              .describe(
                'When true, emit a `Disallow: /` robots.txt to block all crawling. Useful for staging.',
              ),
          })
          .strict()
          .default({})
          .describe('robots.txt component.'),
        subscribe: z
          .object({
            provider: z
              .enum(['none', 'buttondown', 'mailchimp', 'custom'])
              .default('none')
              .describe('Subscribe form provider. `none` hides the form entirely.'),
            action: z
              .string()
              .optional()
              .describe(
                'Form action URL. Required when `provider` is `custom`; inferred for known providers when omitted.',
              ),
            username: z
              .string()
              .optional()
              .describe(
                'Provider username (e.g. Buttondown username, Mailchimp list u/id segment).',
              ),
            email_field_name: z
              .string()
              .optional()
              .describe('Name of the email input field. Defaults to a provider-appropriate value.'),
          })
          .strict()
          .default({})
          .describe('Newsletter subscribe form component.'),
        images: z
          .object({
            enabled: z
              .boolean()
              .default(true)
              .describe(
                'Emit per-format image variants (WebP/AVIF) for jpg/png sources alongside the same-format responsive widths and wrap `<img>` in `<picture>` for browser fallback. Requires `sharp`; when sharp is not installed the `<picture>` wrap is skipped so themes keep working with the original `<img>`.',
              ),
            formats: z
              .array(z.enum(['webp', 'avif']))
              .default(['webp'])
              .describe(
                'Image formats to transcode the responsive variants into. Order matters: the first entry is preferred by browsers that understand it.',
              ),
            webp_quality: z
              .number()
              .int()
              .min(1)
              .max(100)
              .default(80)
              .describe('Quality factor passed to sharp when encoding WebP variants.'),
            avif_quality: z
              .number()
              .int()
              .min(1)
              .max(100)
              .default(50)
              .describe(
                'Quality factor passed to sharp when encoding AVIF variants. AVIF is much slower than WebP, so default is conservative.',
              ),
            cache_dir: z
              .string()
              .default('.nectar-cache/images')
              .describe(
                'Directory (relative to the project root) where transcoded variants are cached by content hash so unchanged sources skip re-encoding on the next build.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Per-format image transcoder. Generates WebP/AVIF variants of responsive widths and rewrites `<img>` into `<picture>` so themes get modern-format fallback automatically.',
          ),
        comments: z
          .object({
            provider: z
              .enum(['off', 'giscus', 'disqus', 'utterances', 'webmention.io'])
              .default('off')
              .describe(
                'Comments provider. `off` disables comments and renders `{{comments}}` as empty.',
              ),
            repo: z
              .string()
              .optional()
              .describe(
                'Giscus / Utterances: `owner/name` GitHub repository hosting the discussion.',
              ),
            repo_id: z
              .string()
              .optional()
              .describe('Giscus: opaque repository ID from giscus.app.'),
            category: z.string().optional().describe('Giscus: discussion category name.'),
            category_id: z
              .string()
              .optional()
              .describe('Giscus: opaque discussion category ID from giscus.app.'),
            mapping: z
              .string()
              .optional()
              .describe(
                'Giscus: page-to-discussion mapping strategy (`pathname`, `url`, `title`, etc.).',
              ),
            strict: z
              .boolean()
              .optional()
              .describe('Giscus: use strict mapping (exact match only).'),
            reactions_enabled: z
              .boolean()
              .optional()
              .describe('Giscus: enable reactions on discussions.'),
            emit_metadata: z
              .boolean()
              .optional()
              .describe('Giscus: emit discussion metadata to the parent page.'),
            input_position: z
              .enum(['top', 'bottom'])
              .optional()
              .describe('Giscus: place the comment composer above or below the thread.'),
            theme: z
              .string()
              .optional()
              .describe('Giscus: theme name or URL applied to the embedded widget.'),
            lang: z
              .string()
              .optional()
              .describe('Giscus / Disqus: BCP 47 language tag for the comments UI.'),
            loading: z
              .enum(['lazy', 'eager'])
              .optional()
              .describe('Giscus: iframe loading strategy.'),
            issue_term: z
              .string()
              .optional()
              .describe(
                'Utterances: how to map pages to issues (e.g. `pathname`, `url`, `title`).',
              ),
            label: z
              .string()
              .optional()
              .describe('Utterances: GitHub issue label applied to comment threads.'),
            shortname: z.string().optional().describe('Disqus: site shortname.'),
            identifier: z
              .string()
              .optional()
              .describe('Disqus: per-page identifier override. Defaults to the post slug.'),
            username: z
              .string()
              .optional()
              .describe('webmention.io: account username receiving webmentions.'),
          })
          .strict()
          .default({})
          .describe('Comments component. Field set used depends on `provider`.'),
        portal: z
          .object({
            provider: z
              .enum([
                'none',
                'ghost',
                'custom',
                'buttondown',
                'beehiiv',
                'substack',
                'convertkit',
                'bentonow',
                'mailerlite',
              ])
              .default('none')
              .describe(
                'Members / Portal backend. `none` keeps `@site.members_enabled` off so Source theme hides every sign-in / subscribe button. `ghost` wires the `#/portal/*` href hashes that Ghost\'s own Portal script intercepts (no rewrite). `custom` keeps the same UI surface but lets the embedder swap in their own client-side handler — if any `*_url` field is set the corresponding `data-portal` button is rewritten to that link, otherwise the original href is left alone. The remaining providers (`buttondown`, `beehiiv`, `substack`, `convertkit`, `bentonow`, `mailerlite`) are external newsletter / membership services: Nectar rewrites the dead `data-portal="signup"` / `"signin"` / `"account"` / `"upgrade"` buttons emitted by Ghost themes to point at the provider\'s hosted pages, inferring URLs from `publication` for providers with conventional URL shapes and falling back to the explicit `*_url` overrides otherwise.',
              ),
            paid: z
              .boolean()
              .default(false)
              .describe(
                'Whether paid tiers are available. Drives `@site.paid_members_enabled`, which Source\'s sidebar uses to decide between Subscribe and Upgrade CTAs. Only meaningful when `provider != "none"`.',
              ),
            invite_only: z
              .boolean()
              .default(false)
              .describe(
                'When true, hide the public Subscribe button and only expose Sign in (Ghost\'s invite-only mode). Drives `@site.members_invite_only`. Only meaningful when `provider != "none"`.',
              ),
            publication: z
              .string()
              .optional()
              .describe(
                'Provider-specific publication identifier used to infer default URLs. Buttondown / Beehiiv / Substack treat it as the publication slug (e.g. `my-newsletter`); ConvertKit treats it as a form id; Bento and MailerLite have no canonical URL shape, so their builds require explicit `*_url` overrides instead. Ignored for `provider = "none"` / `"ghost"` / `"custom"`.',
              ),
            signup_url: z
              .string()
              .optional()
              .describe(
                'Override for the URL injected into `data-portal="signup"` triggers (Ghost\'s Subscribe button). When unset and the active provider can infer one from `publication`, the inferred URL is used; otherwise the button is left untouched.',
              ),
            signin_url: z
              .string()
              .optional()
              .describe(
                'Override for the URL injected into `data-portal="signin"` triggers (Ghost\'s Sign in link).',
              ),
            account_url: z
              .string()
              .optional()
              .describe(
                'Override for the URL injected into `data-portal="account"` triggers (Ghost\'s Account link, shown to already-signed-in members).',
              ),
            upgrade_url: z
              .string()
              .optional()
              .describe(
                'Override for the URL injected into `data-portal="upgrade"` triggers (Ghost\'s paid-tier Upgrade CTA). Typically a checkout / pricing page.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Ghost Members / Portal compatibility. Static-only, but the flags it exposes on `@site` (`members_enabled`, `paid_members_enabled`, `members_invite_only`) are what Source-style themes branch on for sign-in UI, sidebar CTAs, and footer links. When `provider` names an external newsletter service (buttondown / beehiiv / substack / convertkit / bentonow / mailerlite) or `custom` with explicit URLs, Nectar additionally rewrites the dead `data-portal="signup"` / `"signin"` / `"account"` / `"upgrade"` buttons shipped by Ghost themes so they deep-link to the configured backend.',
          ),
      })
      .strict()
      .default({})
      .describe('Optional components that emit extra files or inject markup.'),
  })
  .strict();

export type NectarConfig = z.infer<typeof configSchema>;
export type NavigationItem = z.infer<typeof navigationItemSchema>;
export type RecommendationItem = z.infer<typeof recommendationItemSchema>;
export type TierItem = z.infer<typeof tierItemSchema>;
