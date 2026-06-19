import { z } from 'zod';

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const navigationItemSchema = z
  .object({
    label: z.string().describe('Anchor text shown in theme navigation.'),
    url: z
      .string()
      .describe(
        'Destination of the link. May be an absolute URL or a path relative to the site root.',
      ),
    icon: z
      .string()
      .optional()
      .describe('Optional icon identifier surfaced to themes as navigation item metadata.'),
    external: z
      .boolean()
      .optional()
      .describe(
        'Marks the navigation item as external. The fallback renderer adds rel="external" and theme partials can branch on the flag.',
      ),
    target: z
      .enum(['_blank', '_self', '_parent', '_top'])
      .optional()
      .describe(
        'Optional link target metadata for themes that render navigation anchors directly.',
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
// matter when a live Portal backend processes payments. Laurel keeps the
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

const buildMetadataSchema = z
  .object({
    provider: z
      .enum(['cloudflare_pages', 'netlify', 'vercel'])
      .optional()
      .describe(
        'Deploy provider that populated this build metadata. Cloudflare Pages builds set this to `cloudflare_pages`; Netlify preview builds set this to `netlify`; Vercel builds set this to `vercel`.',
      ),
    environment: z
      .enum(['production', 'preview', 'development'])
      .optional()
      .describe(
        'Deploy environment for the current build. Netlify deploy-preview / branch-deploy builds set this to `preview`; Vercel copies `VERCEL_ENV`; Cloudflare Pages infers `production` for `main` / `master` (or `CF_PAGES_PRODUCTION_BRANCH`) and `preview` for other branches.',
      ),
    branch: z
      .string()
      .optional()
      .describe(
        'Source branch for the current deploy. Explicit `LAUREL_BRANCH` / `LAUREL_GIT_BRANCH` values win, followed by provider env such as `CF_PAGES_BRANCH` and `VERCEL_GIT_COMMIT_REF`, then generic CI branch env such as `BRANCH`, `HEAD`, `GITHUB_REF_NAME`, and `CI_COMMIT_REF_NAME`.',
      ),
    build_id: z
      .string()
      .optional()
      .describe(
        'Deploy/build identifier for the current build. Explicit `LAUREL_BUILD_ID` wins, followed by generic `BUILD_ID` and provider IDs such as `VERCEL_DEPLOYMENT_ID` or `DEPLOY_ID`.',
      ),
    commit_sha: z
      .string()
      .optional()
      .describe(
        'Source commit SHA for the current deploy. Explicit `LAUREL_COMMIT_SHA` / `LAUREL_GIT_COMMIT_SHA` values win, followed by provider env such as `CF_PAGES_COMMIT_SHA` and `VERCEL_GIT_COMMIT_SHA`, then generic CI commit env such as `COMMIT_SHA`, `COMMIT_REF`, `GITHUB_SHA`, and `CI_COMMIT_SHA`.',
      ),
  })
  .strict();

const contentKindSchema = z
  .object({
    dir: z
      .string()
      .min(1)
      .describe('Directory where `laurel new <kind> <title>` writes Markdown files.'),
    title_field: z
      .string()
      .min(1)
      .default('name')
      .describe('Frontmatter field that receives the scaffold title. Defaults to `name`.'),
  })
  .strict();

const referrerPolicySchema = z.enum([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

const siteSocialFields = {
  linkedin: z.string().optional().describe('Optional LinkedIn profile slug or URL.'),
  bluesky: z.string().optional().describe('Optional Bluesky handle or URL.'),
  mastodon: z.string().optional().describe('Optional Mastodon user@host handle or URL.'),
  threads: z.string().optional().describe('Optional Threads handle or URL.'),
  tiktok: z.string().optional().describe('Optional TikTok handle or URL.'),
  youtube: z.string().optional().describe('Optional YouTube channel handle or URL.'),
  instagram: z.string().optional().describe('Optional Instagram handle or URL.'),
  github: z.string().optional().describe('Optional GitHub user/org/repo slug or URL.'),
} satisfies z.ZodRawShape;

const sitePortalSchema = z
  .object({
    portal_button: z
      .boolean()
      .default(false)
      .describe(
        'Ghost Portal floating-button visibility surfaced as `@site.portal_button`. Static Laurel defaults it off; set true only when a Portal-compatible runtime is wired separately.',
      ),
    portal_button_icon: z
      .string()
      .default('')
      .describe(
        'Ghost Portal floating-button icon identifier surfaced as `@site.portal_button_icon`.',
      ),
    portal_button_signup_text: z
      .string()
      .default('')
      .describe(
        'Ghost Portal floating-button signup label surfaced as `@site.portal_button_signup_text`.',
      ),
    portal_button_style: z
      .string()
      .default('')
      .describe(
        'Ghost Portal floating-button style identifier surfaced as `@site.portal_button_style`.',
      ),
    portal_name: z
      .union([z.boolean(), z.string()])
      .default(false)
      .describe(
        "Ghost Portal display-name toggle or label surfaced as `@site.portal_name`. Defaults false to match Laurel's static-only Portal stance.",
      ),
    portal_plans: z
      .array(z.string())
      .default([])
      .describe('Ghost Portal plan handles surfaced as `@site.portal_plans`.'),
    portal_signup_checkbox_required: z
      .boolean()
      .default(false)
      .describe(
        'Ghost Portal signup terms checkbox requirement surfaced as `@site.portal_signup_checkbox_required`.',
      ),
    portal_signup_terms_html: z
      .string()
      .default('')
      .describe(
        'Ghost Portal signup terms HTML surfaced as `@site.portal_signup_terms_html`. The value is theme-facing compatibility data; themes are responsible for escaping when rendering raw HTML.',
      ),
    signup_url: z
      .string()
      .default('')
      .describe('Ghost Portal signup URL surfaced as `@site.signup_url`.'),
  })
  .strict()
  .default({})
  .describe(
    'Ghost Portal settings mirrored into the flat `@site.portal_*` / `@site.signup_url` theme context.',
  );

const imageCdnAdapterSchema = z.enum(['cloudflare', 'netlify', 'vercel', 'cloudinary', 'imgproxy']);

const imageCdnFormatSchema = z.enum(['auto', 'avif', 'webp', 'jpg', 'jpeg', 'png']);

const imageCdnSchema = z
  .object({
    enabled: z
      .boolean()
      .default(false)
      .describe(
        'Rewrite emitted HTML image URLs through the configured image CDN adapter. Disabled by default so existing static image paths keep working until a deployment target is explicitly configured.',
      ),
    adapter: imageCdnAdapterSchema
      .default('cloudflare')
      .describe(
        'Image CDN URL shape to emit. `cloudflare` uses `/cdn-cgi/image/...`, `netlify` uses `/.netlify/images?...`, `vercel` uses `/_vercel/image?...`, `cloudinary` uses `/image/fetch/...`, and `imgproxy` uses `/insecure/.../plain/...` unless `signature` overrides that segment.',
      ),
    base_url: z
      .string()
      .url('image_cdn.base_url must be an absolute URL')
      .optional()
      .describe(
        'Optional absolute CDN endpoint. For Cloudflare, Netlify, and Vercel this prefixes the path-style adapter endpoint; omit it to emit same-origin paths. Required for `cloudinary` (for example `https://res.cloudinary.com/<cloud>`) and `imgproxy` (for example `https://imgproxy.example.com`).',
      ),
    quality: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(85)
      .describe('Image quality passed to adapters that support a quality parameter.'),
    format: imageCdnFormatSchema
      .default('auto')
      .describe(
        'Preferred output format passed to adapters. `auto` lets the CDN negotiate a modern format when the adapter supports it.',
      ),
    default_width: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Fallback width for single image URLs that do not carry a `width` attribute or `srcset` descriptor. Vercel URLs require a width, so Vercel rewrites only width-bearing URLs unless this is set.',
      ),
    path_prefixes: z
      .array(z.string().min(1))
      .default(['/content/images/'])
      .describe(
        'Root-relative image URL prefixes eligible for CDN rewriting. Defaults to Laurel content images only. Prefix matching also accepts the same paths under `build.base_path`.',
      ),
    signature: z
      .string()
      .min(1)
      .default('insecure')
      .describe(
        'imgproxy signature segment. Defaults to `insecure` for unsigned development deployments; set this to your signed segment when imgproxy signature validation is enabled.',
      ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.enabled) return;
    if ((value.adapter === 'cloudinary' || value.adapter === 'imgproxy') && !value.base_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['base_url'],
        message: `image_cdn.base_url is required when image_cdn.adapter is "${value.adapter}"`,
      });
    }
  });

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
          .url('site.url must be an absolute URL (e.g. `https://example.com`)')
          .refine(isHttpUrl, 'site.url must use http or https')
          .default('http://localhost:4321')
          .transform((value) => value.replace(/\/+$/, ''))
          .describe(
            'Public absolute URL of the deployed site. Used to build canonical links, sitemap entries, and RSS GUIDs. Validated as a parseable absolute URL at config-load time so canonical links and sitemap entries cannot be poisoned with arbitrary attribute payloads. Trailing slashes are stripped on load so the same value works whether the user wrote `https://example.com` or `https://example.com/` — URL joins in the pipeline assume no trailing slash, and a doubled `https://example.com//` would otherwise produce `https://example.com//foo/` links (#854). Netlify `deploy-preview` and `branch-deploy` builds automatically use `DEPLOY_PRIME_URL` here, falling back to `DEPLOY_URL` and `URL`; Vercel builds use `VERCEL_URL`; Cloudflare Pages builds use `CF_PAGES_URL`. Explicit overrides still win in this order: `--base-url`, `LAUREL_BUILD_BASE_URL`, `LAUREL_SITE_URL`, provider deploy URL, configured `site.url`.',
          ),
        locale: z
          .string()
          .regex(
            /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/,
            'site.locale must be a BCP 47 language tag (e.g. `en`, `en-US`, `zh-Hant-TW`)',
          )
          .default('en')
          .describe(
            'BCP 47 language tag for the site. Drives `{{lang}}` and selects the theme\'s `locales/<tag>.json` translation file. Validated against a BCP 47-shaped regex (e.g. `en`, `en-US`, `zh-Hant-TW`) so the value is safe to interpolate into `<html lang="…">` without HTML escaping.',
          ),
        cdn_url: z
          .string()
          .url('site.cdn_url must be an absolute URL (e.g. `https://cdn.example.com`)')
          .refine(isHttpUrl, 'site.cdn_url must use http or https')
          .optional()
          .transform((value) => value?.replace(/\/+$/, ''))
          .describe(
            'Optional absolute CDN origin used by `{{img_url ... absolute=true}}` for `/content/images/` paths. Canonical links, sitemap entries, and page URLs still use `site.url`.',
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
          .regex(
            /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
            'site.accent_color must be a CSS hex color (e.g. `#222`, `#222222`, `#22222288`)',
          )
          .default('#222222')
          .describe(
            'Brand accent color as a CSS hex color string (`#RGB`, `#RRGGBB`, or `#RRGGBBAA`). Surfaced to themes as `@site.accent_color` and dropped into theme CSS without escaping, so the schema rejects anything that is not a literal hex triplet to prevent CSS injection.',
          ),
        referrer_policy: referrerPolicySchema
          .default('strict-origin-when-cross-origin')
          .describe(
            'Referrer policy emitted by `{{ghost_head}}` as `<meta name="referrer">`. Defaults to `strict-origin-when-cross-origin` so cross-site requests keep only the origin while same-site navigation retains full referrers.',
          ),
        private: z
          .boolean()
          .default(false)
          .describe(
            'Whether the publication should be treated as Ghost password-protected for theme compatibility. Static Laurel does not enforce HTTP authentication; this only surfaces `@site.private` and drives `{{#is "private"}}` so themes can render their private-site branch when an external host handles access control.',
          ),
        twitter: z
          .string()
          .optional()
          .describe(
            'Optional Twitter / X handle (e.g. `@laurel`). Used to populate `twitter:site` meta tags.',
          ),
        facebook: z
          .string()
          .optional()
          .describe(
            'Optional Facebook page slug. Used to populate `og:article:publisher` meta tags.',
          ),
        ...siteSocialFields,
        meta_title: z
          .string()
          .optional()
          .describe(
            'Site-wide SEO title used by `{{ghost_head}}` as the last fallback when no post/page/tag/author title is in scope. Themes that read `@site.meta_title` see this value unchanged. Leave unset to fall back to `site.title`.',
          ),
        meta_description: z
          .string()
          .optional()
          .describe(
            'Site-wide SEO description used by `{{ghost_head}}` as the last fallback when no post/page/tag/author description is in scope. Themes that read `@site.meta_description` see this value unchanged. Leave unset to fall back to `site.description`.',
          ),
        og_image: z
          .string()
          .optional()
          .describe(
            'Site-wide Open Graph image URL or content-relative path used by `{{ghost_head}}` when no `og_image` / `twitter_image` / `feature_image` is in scope. Surfaced to themes as `@site.og_image`.',
          ),
        og_title: z
          .string()
          .optional()
          .describe(
            'Site-wide Open Graph title used as the last `og:title` fallback. Surfaced to themes as `@site.og_title`.',
          ),
        og_description: z
          .string()
          .optional()
          .describe(
            'Site-wide Open Graph description used as the last `og:description` fallback. Surfaced to themes as `@site.og_description`.',
          ),
        twitter_image: z
          .string()
          .optional()
          .describe(
            'Site-wide Twitter card image used by `{{ghost_head}}` as a fallback when no per-post `twitter_image` is set. Surfaced to themes as `@site.twitter_image`.',
          ),
        twitter_title: z
          .string()
          .optional()
          .describe(
            'Site-wide Twitter card title used as the last `twitter:title` fallback. Surfaced to themes as `@site.twitter_title`.',
          ),
        twitter_description: z
          .string()
          .optional()
          .describe(
            'Site-wide Twitter card description used as the last `twitter:description` fallback. Surfaced to themes as `@site.twitter_description`.',
          ),
        codeinjection_head: z
          .string()
          .optional()
          .describe(
            'Raw HTML spliced into every page\'s `{{ghost_head}}` (just before `</head>`). Mirrors Ghost\'s site-wide "Code injection" head field. Only honored when `build.allow_code_injection` is true; otherwise dropped at config load time. Use for analytics snippets, custom meta tags, or third-party widgets that must load globally.',
          ),
        codeinjection_foot: z
          .string()
          .optional()
          .describe(
            'Raw HTML spliced into every page\'s `{{ghost_foot}}` (just before `</body>`). Mirrors Ghost\'s site-wide "Code injection" foot field. Only honored when `build.allow_code_injection` is true; otherwise dropped at config load time.',
          ),
        members_enabled: z
          .boolean()
          .optional()
          .describe(
            'Override for `@site.members_enabled`. Defaults to whatever `[components.portal].provider != "none"` implies; set explicitly to force the Source theme\'s sign-in / subscribe UI on or off regardless of the Portal provider.',
          ),
        paid_members_enabled: z
          .boolean()
          .optional()
          .describe(
            'Override for `@site.paid_members_enabled`. Defaults to `members_enabled && components.portal.paid`; set explicitly to force the paid CTA state.',
          ),
        members_invite_only: z
          .boolean()
          .optional()
          .describe(
            "Override for `@site.members_invite_only`. Defaults to `members_enabled && components.portal.invite_only`; set explicitly to flip the Source theme's sign-in-only behavior.",
          ),
        comments_enabled: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Surface a `@site.comments_enabled` flag so themes can branch on whether to render the (out-of-scope) comments block. Laurel's `{{comments}}` helper still emits nothing — this flag only controls theme UI guards.",
          ),
        comments_access: z
          .enum(['all', 'members', 'paid'])
          .default('all')
          .describe(
            'Ghost comments access mode surfaced as `@site.comments_access` so themes can branch on public, members-only, or paid-only comment UI. Static Laurel still does not render a comments backend; this is a theme-compatibility field.',
          ),
        portal: sitePortalSchema,
        // Issue #491: Source / Casper-style themes occasionally probe
        // `{{@site.stripe_publishable_key}}` to decide whether to render a
        // Stripe-backed checkout widget. Laurel settles no payments (members
        // are out-of-scope; see CLAUDE.md), but exposing an explicit empty
        // default avoids surprises:
        // - themes that read the key see Handlebars-empty (and skip the
        //   widget) rather than an "undefined" string,
        // - operators wiring their own client-only checkout can opt in by
        //   setting the field, and Laurel will surface it verbatim through
        //   `@site` without touching the value (it ships in the HTML, so the
        //   operator is on the hook for keeping it publishable-only).
        // No corresponding `stripe_secret_key` field on purpose: a secret has
        // no business in a static-site config that gets rendered into HTML.
        stripe_publishable_key: z
          .string()
          .optional()
          .describe(
            'Optional Stripe publishable key surfaced as `@site.stripe_publishable_key`. Static-only: Laurel settles no payments — exposing this is a theme-compatibility stub for embedders wiring their own client-only checkout widget. Never put a secret key here; this value is rendered into HTML.',
          ),
      })
      .strict()
      .default({ title: 'Laurel Site' })
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
        components_dir: z
          .string()
          .default('content/components')
          .describe(
            'Directory of reusable HTML/CSS component Markdown files, relative to the project root. Each file defines a {slug}-keyed snippet that posts and pages can embed.',
          ),
        kinds: z
          .record(contentKindSchema)
          .default({})
          .describe(
            'Additional Markdown content kinds accepted by `laurel new <kind> <title>`. Each entry declares the destination directory and optional title frontmatter field.',
          ),
        assets_dir: z
          .string()
          .default('content/images')
          .describe(
            'Directory of content-bundled image and binary assets, relative to the project root.',
          ),
        static_dir: z
          .string()
          .default('static')
          .describe(
            'Directory of arbitrary passthrough files, relative to the project root. The entire tree is copied verbatim into the output root after every other build step, so files dropped here win over both theme assets and generated platform files (`_headers`, `_redirects`, `robots.txt`, …). Use it for ad-hoc files that need to live at the publish root without going through Markdown — `.well-known/acme-challenge/*`, `.well-known/mta-sts.txt`, `.well-known/security.txt`, `favicon.ico`, `humans.txt`, deploy-platform metadata, verification files, vendored third-party widgets. The default convention reads `static/`; if that directory is absent and top-level `public/` exists, Laurel copies `public/` instead. Set to an empty string to disable the passthrough.',
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
            'Number of words emitted as a free preview before the paywall cut when `visibility_policy` is `truncate` and the post body has no paywall marker (`<!-- members -->`, `<!-- members-only -->`, or `<!--kg-card-begin: paywall-->`). Defaults to `0` so members/paid posts never leak body content to anonymous readers without an explicit marker; raise it to opt into a fixed-word preview.',
          ),
        max_markdown_bytes: z
          .number()
          .int()
          .nonnegative()
          .default(5 * 1024 * 1024)
          .describe(
            'Refuse to load a single Markdown source file larger than this many bytes. `marked.parse` is CPU-bound and quadratic on some pathological inputs (deeply nested blockquotes / lists), so a 500 MB or even a much smaller adversarial post can OOM or hang the build runner. The cap is enforced via `stat()` before the file is read into memory, so an outsized post fails fast with a useful error pointing at the offending path. `0` disables the check entirely. Default is 5 MiB.',
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
        emit_at_base_path: z
          .boolean()
          .optional()
          .describe(
            'Mirror the public URL tree on disk: when set, emit the built site into `output_dir/<base_path>/` (e.g. `dist/blog/`) so syncing the parent `output_dir` to a host yields keys matching the `base_path` URLs. Defaults to true when `base_path` is a subpath (`!= "/"`) and false otherwise; set explicitly to override. No effect when `base_path` is `/`.',
          ),
        posts_per_page: z
          .number()
          .int()
          .positive()
          .default(12)
          .describe('Posts per paginated index / archive page.'),
        trailing_slash: z
          .enum(['always', 'never', 'preserve'])
          .default('always')
          .describe(
            "Controls clean HTML route shape. `always` keeps Ghost-style `/slug/` URLs and writes `slug/index.html`; `never` emits slashless `/slug` canonicals and writes `slug.html`; `preserve` follows each route's authored URL shape.",
          ),
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
        include_future_posts: z
          .boolean()
          .default(false)
          .describe(
            "Include posts whose `published_at` is in the future, and posts with `status: scheduled` regardless of date. Default is to exclude them so embargoed announcements scheduled for a future date cannot leak via the next build before their wall-clock release time. Set to `true` for preview deploys where the operator explicitly wants scheduled / future-dated content visible. Ghost's own behavior is to gate on `published_at` until the timestamp has passed, so leaving this off matches Ghost.",
          ),
        posts_order: z
          .enum(['published_at', 'updated_at'])
          .default('published_at')
          .describe(
            "Field the home feed, tag / author archives, RSS, and sitemap order posts by. `published_at` (default) sorts by the original publication date and matches Ghost's default feed. `updated_at` sorts by the last-modified date so recently edited posts rise to the top, matching a Ghost site configured to order by updated date. This only changes ordering; each post's displayed publication date (`date`) is unaffected. Posts with no explicit `updated_at` fall back to their `published_at`, so this is safe to flip on partially-dated content.",
          ),
        posts_order_direction: z
          .enum(['desc', 'asc'])
          .default('desc')
          .describe(
            'Direction the feed is ordered in. `desc` (default) puts the newest post first; `asc` puts the oldest first. Applies to whichever field `posts_order` selects.',
          ),
        emit_email_only_stub: z
          .boolean()
          .default(false)
          .describe(
            "Emit a placeholder `/email-only/<slug>/` route for posts with `email_only: true` in frontmatter. Default is `false` so email-only posts produce no web artifact at all, matching Ghost's web-side behavior where the same flag suppresses the post from every public surface. Set to `true` to render a minimal canonical stub so newsletter recipients clicking through from a delivered email land on something rather than a 404. The stub is intentionally excluded from index pages, tag/author archives, RSS, and sitemap regardless of this flag; only the direct `/email-only/<slug>/` URL is emitted.",
          ),
        minify_html: z
          .boolean()
          .default(false)
          .describe(
            'Run rendered HTML through `html-minifier-terser` before writing it to disk. Collapses whitespace, whitespace-only blocks, and comments to trim payload size for production deploys. Disabled by default because the minifier adds a small build-time cost and most local dev iterations do not need it. Requires the optional `html-minifier-terser` dependency; when missing, the build logs a warning once and emits unminified HTML instead of failing.',
          ),
        precompress: z
          .boolean()
          .default(false)
          .describe(
            'Pre-compress text outputs (`.html`, `.css`, `.js`, `.json`, `.svg`, `.xml`, `.txt`, `.map`) with Brotli (quality 11) and Gzip (level 9), emitting `<file>.br` and `<file>.gz` siblings. Static hosts that support `brotli_static` / `gzip_static` (Cloudflare Pages, Netlify, nginx) serve the precompressed copy directly when `Accept-Encoding` matches, skipping per-request compression. Off by default because Brotli q=11 adds noticeable build time on large sites; flip on for production builds where transfer size matters more than rebuild latency. Files below 256 bytes are skipped (envelope overhead beats savings) and already-encoded outputs (`.br` / `.gz`) are excluded from a rerun.',
          ),
        csp_nonce: z
          .string()
          .regex(
            /^[A-Za-z0-9+/\-_]+={0,2}$/,
            'csp_nonce must be a base64 or base64url value (alphanumeric plus `+/-_`, optional `=` padding)',
          )
          .optional()
          .describe(
            "CSP nonce stamped onto every inline `<script>` and `<style>` tag Laurel emits (JSON-LD blocks in `{{ghost_head}}`, the accessibility skip-link style, Disqus bootstrap, default 404 / recommendations page styles). Pair with a `Content-Security-Policy` header that lists `'nonce-<value>' 'strict-dynamic'` for `script-src` / `style-src` so a strict policy doesn't block these tags. Leave unset to skip nonce emission. Because this is a static build the same nonce is baked into every page, so rotate it per deploy and serve a matching CSP header — a static, never-rotated nonce defeats the purpose. Validated as a base64 / base64url value (`[A-Za-z0-9+/\\-_]+={0,2}`) to keep the attribute safe to inject without HTML escaping.",
          ),
        metadata: buildMetadataSchema
          .default({})
          .describe(
            'Build/deploy metadata surfaced to templates as `@site.build` when non-empty. Provider env populates `provider` / `environment`; branch, `build_id`, and `commit_sha` are read from explicit Laurel aliases (`LAUREL_BRANCH`, `LAUREL_BUILD_ID`, `LAUREL_COMMIT_SHA`), provider env (`CF_PAGES_BRANCH`, `CF_PAGES_COMMIT_SHA`, `VERCEL_GIT_COMMIT_REF`, `VERCEL_GIT_COMMIT_SHA`), and generic CI env (`BUILD_ID`, `COMMIT_SHA`, `COMMIT_REF`, `GITHUB_SHA`, `CI_COMMIT_SHA`). Explicit `LAUREL_BUILD_METADATA_*` env overrides still win last. When `environment` is anything other than `production`, Laurel injects `noindex` robots metadata and headers so preview deploys are not indexed.',
          ),
      })
      .strict()
      .default({})
      .describe('Build pipeline options that shape the emitted site.'),
    hooks: z
      .object({
        post_build: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Shell command to run after a successful non-dry-run build has been fully written to `build.output_dir` (for example `./scripts/notify-discord.sh`). The command runs from the project root with `LAUREL_OUTPUT_DIR` set to the final output directory, so it is suitable for deployment notifications or a newsletter-send command that should fire only after fresh content has built.',
          ),
      })
      .strict()
      .default({})
      .describe(
        'Project-local lifecycle commands for integrating Laurel builds with external systems such as notifications, deploy tooling, or newsletter delivery.',
      ),
    image_cdn: imageCdnSchema
      .default({})
      .describe(
        'Optional HTML post-process that rewrites local content image URLs through a deployment image CDN. It only touches relative or same-site URLs under `path_prefixes` and leaves third-party, protocol-relative, data/blob, and fragment URLs unchanged.',
      ),
    performance: z
      .object({
        preload_lcp_image: z
          .boolean()
          .default(true)
          .describe(
            'Inject `<link rel="preload" as="image" fetchpriority="high" href="…">` into `{{ghost_head}}` for the current route\'s `feature_image`, then align it with the final rendered `<img fetchpriority="high">` candidate when the theme emits a resized `src`, `srcset`, or `sizes`. This starts the LCP image from the HTML preload scan without preloading a stale full-size source. Only fires on post / page routes that actually have a `feature_image`; disable when a custom theme already emits its own LCP preload to avoid double-fetching.',
          ),
        preconnect_image_origins: z
          .boolean()
          .default(true)
          .describe(
            'Emit `<link rel="preconnect" crossorigin href="<origin>">` into `{{ghost_head}}` for up to three unique third-party origins referenced by `feature_image` / cover-image URLs on the current route. Skips the site\'s own origin and `data:` / blob URLs. Caps at three to avoid bloating the document head with low-value hints when content references many external CDNs; bumping that cap is intentionally not a knob so naive configs cannot regress page weight.',
          ),
        max_preconnect_origins: z
          .number()
          .int()
          .min(0)
          .max(8)
          .default(3)
          .describe(
            'Maximum number of `<link rel="preconnect">` hints emitted by `preconnect_image_origins`. Default 3 follows the same heuristic Lighthouse uses (`Preconnect to required origins`): a small handful is the sweet spot before browser connection pressure outweighs the benefit. Set to `0` to disable preconnect emission entirely without flipping `preconnect_image_origins`.',
          ),
        dedupe_script_preload: z
          .boolean()
          .default(true)
          .describe(
            'Remove `<link rel="preload" as="script" href="X">` when an equivalent `<script src="X">` already appears in the document, so the browser issues exactly one request for the asset. The Source theme ships both a preload and a `<script>` for `built/source.js`; preloading a deferred script does not start execution any earlier and only doubles the request line in DevTools. Disable when a custom theme relies on the preload landing first (e.g. inline-modulepreload speculative compile).',
          ),
        preload_stylesheet: z
          .boolean()
          .default(false)
          .describe(
            'Emit a sibling `<link rel="preload" as="style" href="X">` for every `<link rel="stylesheet" href="X">` that does not already have one. Helps themes that did not opt into the manual preload pattern (which the Source theme already ships) by letting the browser start the CSS fetch from the preload scan rather than from CSS parsing. Default off because most themes either already include the preload or do not benefit (single tiny stylesheet); flip on for themes with deep critical-CSS where the head is large. This is a resource hint, not automatic critical-CSS extraction or CSS purging; keep those theme-specific transforms in the theme build step.',
          ),
      })
      .strict()
      .default({})
      .describe(
        'Resource-hint and HTML post-process knobs that shape network-time performance without touching theme markup. All toggles operate on already-rendered HTML so they compose with arbitrary `.hbs` templates. The defaults bias toward the LCP / Lighthouse-friendly behaviour modern Ghost themes already expect.',
      ),
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
        'External sites surfaced through Ghost\'s `{{recommendations}}` helper. When non-empty, the site exposes `@site.recommendations_enabled = true` so themes like Source render the sidebar block, and Laurel auto-emits a `/recommendations/` page listing all entries inside a `<section id="all-recommendations">` block. The Source theme\'s "See all" button (`data-portal="recommendations"`) is rewritten to deep-link into that section.',
      ),
    tiers: z
      .array(tierItemSchema)
      .default([])
      .describe(
        'Declarative membership tiers exposed to themes via `{{#get "tiers"}}` and `{{tiers}}`. Each entry becomes a Ghost-shaped tier object (with `id`, `slug`, `type`, `active`, `visibility`, `monthly_price`, `yearly_price`, `currency`, `welcome_page_url`, `benefits`) so pricing tables in Ghost themes render against a static config without a live Portal backend. Tiers without a `monthly_price` are typed as `free`; any positive price flips the entry to `paid`. When empty, `{{#get "tiers"}}` resolves to an empty list and the block silently no-ops.',
      ),
    plugins: z
      .array(z.string())
      .default([])
      .describe(
        'Ordered list of plugin specs to load. Each entry is either a file path relative to the project root (e.g. `./plugins/my-plugin.ts`) or a bare module specifier resolvable by Bun/Node (e.g. `laurel-plugin-foo`). The module must export a `Plugin` object (or a factory returning one) as its `default` / `plugin` named export. Hooks fire in registration order; a plugin that fails to load logs a warning and is skipped so a broken plugin never bricks the build.',
      ),
    plugin_auto_detect: z
      .boolean()
      .default(false)
      .describe(
        'Auto-discover plugins in `node_modules/` whose package name starts with `laurel-plugin-` (or `@scope/laurel-plugin-*`). Off by default because a one-time install of an unrelated package should not flip a site into running new build-time code without an explicit config edit. Set to `true` to opt into auto-loading.',
      ),
    deploy: z
      .object({
        merge: z
          .boolean()
          .default(false)
          .describe(
            'Merge hand-written deploy artifacts from the static passthrough directory with generated `_headers`, `_redirects`, and `vercel.json` instead of failing on conflicts. Text artifacts keep the hand-written rules first so first-match hosts preserve explicit user intent; `vercel.json` keeps hand-written scalar keys and prepends hand-written `headers` / `redirects` arrays. Leave disabled to fail loudly when static files would replace generated deploy metadata; `laurel build --force` remains the explicit overwrite escape hatch.',
          ),
        github_pages: z
          .object({
            redirects: z
              .boolean()
              .default(false)
              .describe(
                'Emit GitHub Pages-compatible static HTML redirect stubs from `redirects.yaml` and Ghost-style `content/data/redirects.*`. GitHub Pages has no server-side redirects backend, so each supported source path is materialized as `<from>/index.html` (or the exact file path for file-like sources such as `/old.html`) with a meta refresh and canonical link to the destination. Root and `404.html` sources are skipped so Pages home and not-found behavior stay intact. Leave disabled when another host will consume `_redirects`, `vercel.json`, or server config instead.',
              ),
            custom_domain: z
              .string()
              .optional()
              .describe(
                'Apex or subdomain host to bind to a GitHub Pages site (e.g. `blog.example.com`). When set, the build emits a `CNAME` file at the output root so GitHub Pages picks up the custom domain. Leave unset for `*.github.io` deployments.',
              ),
            branch: z
              .string()
              .default('gh-pages')
              .describe(
                'Branch `laurel deploy github-pages` pushes the built site to. Defaults to `gh-pages` (the historical convention). Override when the repo serves Pages from a different branch.',
              ),
            remote: z
              .string()
              .default('origin')
              .describe(
                'Git remote name `laurel deploy github-pages` pushes to. Defaults to `origin`. Override for forks or mirrored workflows that publish from a non-default remote.',
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
                'Emit Cloudflare Pages `_headers` and (when a `redirects.yaml` exists at the project root) `_redirects` at the output root. The `_headers` defaults pin fingerprinted asset URLs (`/assets/*`, `/_images/*`, `/content/images/*`) to a year of immutable caching and force HTML responses to revalidate every request, plus a minimal set of security headers (`X-Content-Type-Options`, `Referrer-Policy`). The `_redirects` emitter loads rules from `redirects.yaml` (`[{from, to, status}]` with status one of 301/302/307/308, default 301), drops later rules whose `from` repeats an earlier one (Cloudflare uses first-match), and prepends them before any existing `_redirects` entries. Leave disabled when deploying somewhere other than Cloudflare Pages.',
              ),
          })
          .strict()
          .default({})
          .describe('Cloudflare Pages-specific deploy hints.'),
        cloudflare_workers: z
          .object({
            enabled: z
              .boolean()
              .default(false)
              .describe(
                'Emit a Worker-readable `_routes-manifest.json` at the output root for Cloudflare Workers Static Assets. The manifest folds `deploy.headers` and canonical redirect rules from `redirects.yaml` / Ghost-style `content/data/redirects.*` into JSON so a reference Worker can apply headers and redirects before delegating to `ASSETS`. Leave disabled when deploying somewhere other than Cloudflare Workers Static Assets.',
              ),
          })
          .strict()
          .default({})
          .describe('Cloudflare Workers Static Assets-specific deploy hints.'),
        netlify: z
          .object({
            enabled: z
              .boolean()
              .default(false)
              .describe(
                'Emit Netlify `_headers` and (when a `redirects.yaml` exists at the project root) `_redirects` at the output root. `_headers` defaults pin fingerprinted asset URLs (`/assets/*`, `/_images/*`, `/content/images/*`) to a year of immutable caching and force HTML responses to revalidate every request, plus a minimal set of security headers (`X-Content-Type-Options`, `Referrer-Policy`). The `_redirects` emitter loads rules from `redirects.yaml` (`[{from, to, status, force}]` with status one of 301/302/307/308, default 301), maps `force: true` to a Netlify `!` suffix on the status (e.g. `301!`) so the rule fires even when a static file exists at `from`, drops later rules whose `from` repeats an earlier one (Netlify uses first-match), and prepends them before any existing `_redirects` entries. Leave disabled when deploying somewhere other than Netlify.',
              ),
            site_id: z
              .string()
              .optional()
              .describe(
                'Optional Netlify site id forwarded to `netlify deploy --site=<id>` when `laurel deploy netlify` runs. When unset, the Netlify CLI uses the linked site in the local `.netlify/state.json`.',
              ),
            prod: z
              .boolean()
              .default(true)
              .describe(
                'Pass `--prod` to `netlify deploy` when running `laurel deploy netlify`. Default `true` so the command publishes to production; set `false` for draft preview URLs.',
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
            project: z
              .string()
              .optional()
              .describe(
                'Optional Vercel project slug forwarded as `--scope=<project>` when running `laurel deploy vercel`. Leave unset to let the Vercel CLI infer the project from the linked `.vercel/project.json`.',
              ),
            prod: z
              .boolean()
              .default(true)
              .describe(
                'Pass `--prod` to `vercel deploy` when running `laurel deploy vercel`. Default `true` so the command ships to the production alias; set `false` for preview-only deploys.',
              ),
          })
          .strict()
          .default({})
          .describe('Vercel-specific deploy hints.'),
        firebase: z
          .object({
            enabled: z
              .boolean()
              .default(false)
              .describe(
                'Emit a Firebase Hosting `firebase.json` at the output root folding `deploy.headers`, canonical redirect rules from `redirects.yaml` / Ghost-style redirects, `cleanUrls: true`, and the build trailing-slash policy into the native `hosting` config shape. The generated config sets `hosting.public` to `.` so the built output directory is self-contained for Firebase CLI deploys. `hosting.rewrites` is emitted as an empty array because Laurel is a static multi-page site and should not add a catch-all SPA rewrite by default. Leave disabled when deploying somewhere other than Firebase Hosting.',
              ),
          })
          .strict()
          .default({})
          .describe('Firebase Hosting-specific deploy hints.'),
        apache: z
          .object({
            enabled: z
              .boolean()
              .default(false)
              .describe(
                "Emit an Apache HTTPD `.htaccess` file at the output root folding both `deploy.headers` and `redirects.yaml` into per-directory directives. The file enables `DirectoryIndex index.html`, resolves Laurel's `slug/index.html` output for clean URLs, wires `ErrorDocument 404 /404.html`, sets practical `AddType` / pre-compressed sidecar hints, maps `deploy.headers.cache_rules` to first-match `mod_rewrite` environment markers consumed by `mod_headers`, attaches configured security headers globally, and translates each redirect into a `RewriteRule ... [R=<status>,L]`. Leave disabled when deploying somewhere other than Apache with `.htaccess` support.",
              ),
          })
          .strict()
          .default({})
          .describe('Apache HTTPD-specific deploy hints.'),
        nginx: z
          .object({
            enabled: z
              .boolean()
              .default(false)
              .describe(
                "Emit a self-hosted nginx server block at `<output>/.laurel/nginx.conf` folding both `deploy.headers` and `redirects.yaml` into a single config snippet. The block sets `gzip_static on; brotli_static on;` for pre-compressed assets, emits one `location` per `deploy.headers.cache_rules` entry with the matching `Cache-Control` header, attaches every configured security header to each `location` (nginx `add_header` does not merge with parent blocks, so they are repeated rather than inherited), serves SPA-style routes with `try_files $uri $uri/ $uri/index.html =404;` (the `$uri/` middle term is the trailing-slash variant so a request to `/about` falls through `/about/` — which triggers the `index` directive's canonical-slug redirect — before resolving `/about/index.html`), wires `error_page 404 /404.html;` to an internal exact-match location so Laurel's generated `dist/404.html` becomes the nginx 404 response body, and translates each `redirects.yaml` entry into a `location { return <status> <to>; }` rule. Output lives under `.laurel/` (not the publish root) so the file is never served over HTTP. Leave disabled when deploying somewhere other than self-hosted nginx.",
              ),
            root: z
              .string()
              .default('/var/www/laurel')
              .describe(
                'Filesystem path nginx should serve from, emitted as the `root` directive in the generated server block. Defaults to `/var/www/laurel` — adjust to match wherever you rsync `dist/` on the host.',
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
        caddy: z
          .object({
            enabled: z
              .boolean()
              .default(false)
              .describe(
                "Emit a self-hosted Caddyfile at `<output>/.laurel/Caddyfile` folding both `deploy.headers` and `redirects.yaml` into a single site block. The file sets `root`, enables `encode zstd gzip`, serves pre-compressed `.br` / `.gz` sidecars with `file_server`, resolves Laurel's `slug/index.html` output with `try_files {path} {path}/index.html =404`, emits one path matcher per `deploy.headers.cache_rules` entry with the matching `Cache-Control` header, attaches configured security headers globally, translates each `redirects.yaml` entry into a named matcher plus `redir`, and serves `/404.html` from `handle_errors`. Output lives under `.laurel/` (not the publish root) so the file is never served over HTTP. Leave disabled when deploying somewhere other than self-hosted Caddy.",
              ),
            root: z
              .string()
              .default('/var/www/laurel')
              .describe(
                'Filesystem path Caddy should serve from, emitted as the `root *` directive in the generated Caddyfile. Defaults to `/var/www/laurel` — adjust to match wherever you rsync `dist/` on the host.',
              ),
            site_address: z
              .string()
              .default(':80')
              .describe(
                'Caddy site address for the generated site block. Use a hostname such as `example.com` when Caddy should provision HTTPS automatically, or leave the default `:80` for a plain HTTP listener behind another TLS terminator.',
              ),
          })
          .strict()
          .default({})
          .describe('Self-hosted Caddy-specific deploy hints.'),
        cloudflare: z
          .object({
            project_name: z
              .string()
              .optional()
              .describe(
                'Cloudflare Pages project name used by `laurel deploy cloudflare`. Forwarded to `wrangler pages deploy --project-name=<name>`. Required when targeting cloudflare; can also be supplied via `--project-name` on the CLI.',
              ),
            branch: z
              .string()
              .optional()
              .describe(
                'Optional branch name forwarded to `wrangler pages deploy --branch=<name>`. Use to distinguish preview vs production environments in the Cloudflare dashboard.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Cloudflare Pages deploy target consumed by `laurel deploy cloudflare`. Wraps `wrangler pages deploy dist`.',
          ),
        s3: z
          .object({
            bucket: z
              .string()
              .optional()
              .describe(
                'S3 bucket name for `laurel deploy s3`. Used for the base `aws s3 sync dist s3://<bucket>` upload and for metadata-correct `.br` / `.gz` sidecar uploads.',
              ),
            region: z
              .string()
              .optional()
              .describe(
                'Optional AWS region forwarded as `--region <region>` to S3 sync and sidecar upload commands.',
              ),
            delete: z
              .boolean()
              .default(false)
              .describe(
                'Pass `--delete` to `aws s3 sync` so the remote bucket mirrors the local `dist/` exactly, removing stale objects. Default `false` to avoid surprise deletions; opt in when stale files at the bucket root are a problem.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'AWS S3 deploy target consumed by `laurel deploy s3`. Syncs `dist` to S3 and uploads pre-compressed `.br` / `.gz` sidecars with `Content-Encoding` metadata so CloudFront can serve origin-compressed assets correctly.',
          ),
        r2: z
          .object({
            bucket: z
              .string()
              .optional()
              .describe(
                'Cloudflare R2 bucket name for `laurel deploy r2`. Forwarded to `aws s3 sync dist s3://<bucket>` with the R2 S3-compatible endpoint.',
              ),
            endpoint: z
              .string()
              .optional()
              .describe(
                'R2 S3-compatible endpoint URL (e.g. `https://<account>.r2.cloudflarestorage.com`). Forwarded as `--endpoint-url <url>` to `aws s3 sync`. Required so the AWS CLI targets R2 instead of S3.',
              ),
            delete: z
              .boolean()
              .default(false)
              .describe(
                'Pass `--delete` to `aws s3 sync` so the R2 bucket mirrors `dist/` exactly. Default `false`; opt in when stale files at the bucket root are a problem.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Cloudflare R2 deploy target consumed by `laurel deploy r2`. Wraps `aws s3 sync` with the R2 endpoint.',
          ),
        rsync: z
          .object({
            destination: z
              .string()
              .optional()
              .describe(
                'rsync destination string for `laurel deploy rsync`, e.g. `user@host:/var/www/site/`. Forwarded verbatim as the last argument of `rsync -avz dist/ <destination>`.',
              ),
            flags: z
              .array(z.string())
              .default(['-avz', '--delete'])
              .describe(
                'Flags passed to `rsync` before the source and destination. Defaults to `-avz --delete` to mirror the local `dist/` over SSH. Override to drop `--delete`, add `--exclude=…` rules, or pin a specific SSH command via `-e`.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'rsync deploy target consumed by `laurel deploy rsync`. Wraps `rsync <flags> dist/ <destination>`.',
          ),
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
                    'Value of the `Content-Security-Policy` header. Off by default because a strict CSP can break themes that inline scripts; configure once you have audited theme markup. When set, Laurel scans rendered HTML and appends build-time `sha256-...` hash sources for inline `<script>` bodies to `script-src` so strict deploy artifacts can allow the exact scripts the build produced without `unsafe-inline`.',
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
                  pattern: '/_images/*',
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
            'Cross-cutting HTTP response headers (security + cache rules) translated by each platform emitter (`deploy.cloudflare_pages`, `deploy.cloudflare_workers`, `deploy.netlify`, `deploy.vercel`, `deploy.firebase`, `deploy.apache`, `deploy.nginx`) into its native format. Builds also emit `dist/.laurel/cloudfront-response-headers-policy.json` from `deploy.headers.security` for S3 + CloudFront response headers policies; URL-specific cache rules still belong in S3 object metadata or CloudFront cache behaviors.',
          ),
        early_hints: z
          .object({
            enabled: z
              .boolean()
              .default(false)
              .describe(
                'Emit per-route Early Hints artifacts from rendered `<link rel="preload">` tags. Disabled by default because static hosts differ in 103 Early Hints support and unsupported hosts will simply serve the JSON artifacts as ordinary files.',
              ),
            artifacts: z
              .boolean()
              .default(true)
              .describe(
                'Write an `early-hints.json` artifact beside each HTML route that has conservative same-origin preload hints. Index routes write `<route>/early-hints.json`; flat HTML routes write `<name>.early-hints.json`.',
              ),
            headers: z
              .boolean()
              .default(true)
              .describe(
                'When Netlify or Cloudflare Pages header output is enabled, add route-specific `Link: <...>; rel=preload` entries to the generated `_headers` file so hosts that translate Link preload headers into 103 Early Hints can advertise critical CSS/JS/font/image assets.',
              ),
            max_links: z
              .number()
              .int()
              .positive()
              .default(8)
              .describe(
                'Maximum preload Link entries emitted per route. Laurel only includes same-origin preloads that match known built theme/card assets, then stops at this cap to keep `_headers` and JSON artifacts small.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Optional 103 Early Hints support for static deployments. Laurel does not run an HTTP server; this emits deploy artifacts that compatible hosts can consume.',
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
            items: z
              .number()
              .default(20)
              .describe('Maximum number of posts per RSS page; overflow paginates into rss-N.xml.'),
            ttl: z
              .number()
              .int()
              .positive()
              .default(60)
              .describe(
                'RSS channel time-to-live in minutes, emitted as `<ttl>`. Defaults to `60` so feed readers can safely cache generated feeds for one hour.',
              ),
            full_content: z
              .boolean()
              .default(false)
              .describe(
                'Include the full post HTML body in `<content:encoded>`. Default `false` emits only `<description>` with the feed excerpt; flipping to `true` mirrors Ghost behavior but inflates feed size dramatically on large blogs (see backlog #517).',
              ),
            per_tag: z
              .boolean()
              .default(true)
              .describe(
                'Emit a per-tag RSS feed at `tag/<slug>/rss/index.xml` for every public tag (matching Ghost\'s `/tag/<slug>/rss/` route). The channel metadata mirrors the site-wide feed; only the item list is filtered to posts tagged with that tag. Internal tags (visibility != "public") are skipped. Set to `false` if the extra URLs are noise for your audience — note that the file count grows linearly with the number of public tags.',
              ),
            per_author: z
              .boolean()
              .default(true)
              .describe(
                "Emit a per-author RSS feed at `author/<slug>/rss/index.xml` for every author with at least one published public post (matching Ghost's `/author/<slug>/rss/` route). The channel metadata mirrors the site-wide feed; only the item list is filtered to posts authored by that author. Set to `false` to suppress.",
              ),
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
        pagination: z
          .object({
            prefix: z
              .string()
              .regex(
                /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
                'pagination.prefix must be a single URL segment of letters, digits, `-`, or `_` (no slashes, no dots, no spaces).',
              )
              .default('page')
              .describe(
                'URL segment used for paginated archive tails. Defaults to `page`, mirroring Ghost (`/page/2/`, `/tag/foo/page/2/`, `/author/bar/page/2/`). Override to localize the slug (e.g. `seite` for German, `pagina` for Italian) or to match a legacy URL scheme — every paginated route at `/<prefix>/N/` is rebuilt against the new value, including the rel="prev"/"next" hints emitted by `{{ghost_head}}`. Restricted to a single URL segment of `[A-Za-z0-9_-]` so the value can be dropped into the path safely without escaping.',
              ),
            mode: z
              .enum(['links', 'infinite', 'load-more'])
              .default('links')
              .describe(
                'How paginated feeds advance to the next page. `links` (default) emits only the classic `/page/N/` pagination links — no client JS. `infinite` adds a progressive-enhancement runtime that fetches the next page (following the `rel="next"` link already in the document) and appends its post cards when the reader reaches the end of the feed, via an `IntersectionObserver` sentinel. `load-more` does the same but behind a "Load more" button instead of auto-loading. Both modes are pure enhancement layered on top of the static pagination links: with JS disabled (or `fetch` / `IntersectionObserver` unavailable) the `/page/N/` links still work, and sub-path deploys (`/blog/`) resolve correctly because the runtime follows the absolute `rel="next"` URL rather than guessing the `/page/N/` scheme. If the active theme already ships its own infinite-scroll script (Ghost\'s Casper and Source both do — a self-contained script that follows `rel="next"` and appends cards), Laurel detects it and skips injecting this runtime, since running both would fetch and append every next page twice. In that case the theme\'s native infinite scroll is used regardless of `infinite` vs `load-more`; a build-time notice reports the skip.',
              ),
            container_selector: z
              .string()
              .default('.post-feed')
              .describe(
                'CSS selector for the element holding the post cards, used by the `infinite` / `load-more` runtime to know where to append newly fetched cards. Defaults to `.post-feed`, the Ghost theme convention (Casper). Override for themes that wrap posts differently (e.g. `.gh-postfeed`). Ignored when `mode = "links"`.',
              ),
            item_selector: z
              .string()
              .default('.post-card')
              .describe(
                'CSS selector for an individual post card inside `container_selector`. The `infinite` / `load-more` runtime copies elements matching this selector out of the fetched next page and appends them to the live feed. Defaults to `.post-card` (Casper); use `.gh-card` for the Source theme. Ignored when `mode = "links"`.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Pagination knobs for archive routes: the URL prefix plus an optional infinite-scroll / load-more progressive enhancement. Per-page count lives at `[build].posts_per_page`.',
          ),
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
              .default(false)
              .describe(
                'Emit Ghost-style Content API JSON snapshots in two layouts. (1) Per-resource shadows under `ghost/api/content/{posts,pages,authors,tags}.json` and `{resource}/slug/{slug}.json` for clients written against the Ghost Content API SDK. (2) Flat dumps directly under `content/posts.json` and `content/settings.json` (plus CORS `_headers` and `_headers.cf` twin files for Netlify and Cloudflare Pages) so a browser-only consumer can fetch `/content/posts.json` cross-origin without any SDK. Members fields in `settings.json` are hardcoded false / empty because Laurel is static-only. Off by default because most sites do not consume their own JSON shadows: a stock build would otherwise emit the full SDK shadow tree, the flat dump, an `_headers`/`_headers.cf` CORS pair, a `_redirects` block for trailing-slash routing, and `.well-known/ghost.json` — easily half of the output file count for a small site. Opt in when you are wiring a Ghost Content API SDK client, a browser-only fetcher, or a Netlify/Cloudflare deploy that needs the CORS rules.',
              ),
            absolute_urls: z
              .boolean()
              .default(false)
              .describe(
                'Rewrite relative URLs in serialized `html` fields to absolute URLs using `[site].url` + `[build].base_path`. Mirrors the Ghost Content API `?absolute_urls=true` query parameter as a build-time switch. Affects `posts`, `pages`, per-tag, paginated, and per-slug/per-id shards across both the flat `/content/*` dump and the `/ghost/api/content/*` SDK shadow tree. Has no effect on absolute URLs already present in the body.',
              ),
            posts_per_page: z
              .number()
              .int()
              .positive()
              .default(15)
              .describe(
                "Page size for the paginated posts shards (`content/posts/page/<n>.json` and `ghost/api/content/posts/page/<n>.json`). Matches Ghost's default Content API `limit=15`. Use `meta.pagination.next` / `meta.pagination.prev` (numbers, not URLs) to walk pages from the consumer.",
              ),
            emit_htaccess: z
              .boolean()
              .default(false)
              .describe(
                'Emit `dist/content/.htaccess` with the same Content API CORS and per-resource Cache-Control headers as the generated `_headers` / `_headers.cf` files. Use this only on Apache hosts with `AllowOverride FileInfo`; leave it off for hosts that may serve dotfiles or do not read `.htaccess`.',
              ),
            emit_key_registry: z
              .boolean()
              .default(false)
              .describe(
                'Emit `dist/.well-known/ghost-content-keys.json`, a static compatibility registry declaring that Laurel accepts any Ghost Content API key. This does not validate or publish secret keys; it only helps integrations that probe key policy before fetching static JSON.',
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
                "Emit a client-side search index. When `engine` is `json`, `json+pagefind`, or `json+lunr`, writes a flat `content/search.json` ({ posts, pages, tags, authors }) suitable for fuzzy-search libraries (lunr / Fuse / minisearch) and wires Ghost-style `[data-ghost-search]` buttons to a static modal. When `engine` is `pagefind` or `json+pagefind`, additionally shells out to the `pagefind` CLI over the staged output to emit `pagefind/*` and routes the same buttons to Pagefind UI. When `engine` is `lunr` or `json+lunr`, builds a pre-serialized Lunr index at `search-index.json` and ships a tiny vanilla-JS widget (`search/widget.js` + `search/lunr.min.js`) so themes can wire a client-only search box without the Pagefind WASM overhead; plain `lunr` also routes Ghost-style buttons to a Lunr-backed modal. Laurel does NOT replicate Ghost's `/search/` endpoint shape; the JSON field set is divergent.",
              ),
            engine: z
              .enum([
                'json',
                'pagefind',
                'json+pagefind',
                'lunr',
                'json+lunr',
                'sodo-search',
                'json+sodo-search',
              ])
              .default('json')
              .describe(
                "Search backend. `json` emits the flat index and Laurel's static `[data-ghost-search]` modal (cheap, zero deps, works for small/medium sites). `pagefind` skips the JSON and runs the `pagefind` CLI for a chunked index that scales to large archives. `json+pagefind` emits both so the consumer can pick at runtime, while Ghost-style buttons use Pagefind UI. `lunr` pre-builds a Lunr index (`search-index.json`) and ships a tiny vanilla-JS widget plus a Lunr-backed Ghost search modal — meant for sites under a few hundred posts where Pagefind's WASM overhead is overkill. `json+lunr` emits both the raw fuzzy-search index and the pre-built Lunr index plus widget; Ghost-style buttons use the JSON modal. `sodo-search` injects a configured Ghost `@tryghost/sodo-search` client script into `{{ghost_head}}`; Laurel does not vendor that script, so pin or self-host `sodo_search_src` if you opt in. Combine with `json+sodo-search` if you want both the raw index file and the external Sodo UI script.",
              ),
            sodo_search_src: z
              .string()
              .default('https://unpkg.com/@tryghost/sodo-search@latest/umd/sodo-search.min.js')
              .describe(
                'URL of the Sodo Search client script injected when `engine` is `sodo-search` or `json+sodo-search`. Defaults to the unpkg-hosted `@tryghost/sodo-search` bundle; override to self-host the file or pin a specific version. The URL is emitted verbatim into a `<script src="…">` attribute, so it must be a value the operator trusts.',
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
            emit_algolia_records: z
              .boolean()
              .default(false)
              .describe(
                'Emit `dist/.laurel/algolia-records.json` — a flat array of posts/pages/tags/authors with `objectID`, `url`, `title`, `content`, `type`, `tags`, `authors`. Push to your Algolia index with the `algoliasearch` CLI / SDK; Laurel does not push for you. Independent of `engine`: combine with any engine to get Algolia-pushable records alongside the on-site widget. A starter DocSearch-compatible stylesheet ships at `search/algolia-docsearch.css`.',
              ),
            emit_meilisearch_records: z
              .boolean()
              .default(false)
              .describe(
                'Emit `dist/.laurel/meilisearch-records.json` — the same flat document set used for Algolia but with Meilisearch-safe IDs (colon-free, `[a-zA-Z0-9-_]` only) under the `id` primary key. Push with the `meilisearch-js` SDK or HTTP API; Laurel does not push for you. Independent of `engine`.',
              ),
          })
          .strict()
          .default({})
          .describe(
            "Client-side search component. Emits a flat `content/search.json`, runs Pagefind, and/or emits a Lunr index. NOT a drop-in replacement for Ghost's `/search/` endpoint; the JSON shape is divergent. Laurel wires Ghost-style `[data-ghost-search]` buttons to a static modal for JSON/Lunr search and to Pagefind UI for Pagefind search.",
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
        humans: z
          .object({
            enabled: z
              .boolean()
              .default(true)
              .describe(
                'Emit a `humans.txt` file with site metadata. Drop `static/humans.txt` into the project to override the generated body.',
              ),
          })
          .strict()
          .default({})
          .describe('humans.txt component.'),
        subscribe: z
          .object({
            provider: z
              .enum([
                'none',
                'buttondown',
                'beehiiv',
                'convertkit',
                'mailerlite',
                'mailchimp',
                'emailoctopus',
                'listmonk',
                'customformaction',
                'custom',
              ])
              .default('none')
              .describe(
                "Subscribe form provider. `none` neutralises any `data-members-form` and may strip wrapping selectors. `buttondown` / `beehiiv` / `convertkit` / `mailerlite` / `mailchimp` / `emailoctopus` / `listmonk` rewrite the form action to the provider's public embed / subscription endpoint and add a hidden `website` honeypot input. `customformaction` and `custom` let the operator supply a raw `action` and optional `field_map`; custom endpoints should reject submissions where `website` is non-empty.",
              ),
            action: z
              .string()
              .optional()
              .describe(
                'Form action URL. Required when `provider` is `custom`, `customformaction`, `mailerlite`, `mailchimp`, or `listmonk`; optional for `emailoctopus` when `list_id` is set; inferred for other known providers when omitted.',
              ),
            method: z
              .enum(['get', 'post'])
              .default('post')
              .describe(
                'HTML form method used when rewriting `data-members-form` markup. Defaults to `post`; set to `get` only for custom endpoints that require query-string submission.',
              ),
            username: z
              .string()
              .optional()
              .describe(
                'Provider username (e.g. Buttondown username, Mailchimp list u/id segment).',
              ),
            publication_id: z
              .string()
              .optional()
              .describe(
                'Beehiiv publication id (UUID). The form action is rewritten to `https://api.beehiiv.com/v2/publications/<publication_id>/subscriptions`. Falls back to `username` when omitted for back-compat with operators who only have a slug.',
              ),
            form_id: z
              .string()
              .optional()
              .describe(
                'ConvertKit / Kit form id. The form action is rewritten to `https://app.kit.com/forms/<form_id>/subscriptions`. Falls back to `publication_id` or `username` for compatibility with older config snippets.',
              ),
            list_id: z
              .string()
              .optional()
              .describe(
                'listmonk public list UUID submitted as `l` to the public subscription endpoint, or EmailOctopus list id used to build the embedded form action. Use `list_ids` for multi-list listmonk forms.',
              ),
            list_ids: z
              .array(z.string())
              .optional()
              .describe(
                'listmonk public list UUIDs submitted as repeated `l` hidden fields to the public subscription endpoint.',
              ),
            email_field_name: z
              .string()
              .optional()
              .describe('Name of the email input field. Defaults to a provider-appropriate value.'),
            name_field_name: z
              .string()
              .optional()
              .describe(
                'Name of the optional name input field for inputs marked `data-members-name`. Defaults to a provider-appropriate value.',
              ),
            field_map: z
              .record(z.string())
              .optional()
              .describe(
                '`custom` and provider override escape hatch. Map of logical field name -> form field name. Today only `email` and `name` are consulted (overriding `email_field_name` / `name_field_name` when set); the spam honeypot keeps the fixed `website` name for provider compatibility.',
              ),
            strip_selectors: z
              .array(z.string())
              .optional()
              .describe(
                '`provider = "none"` only. CSS selectors of wrapping elements to remove from the rendered HTML (e.g. `.gh-footer-signup`, `.gh-cta`). Supports `.class`, `#id`, and `tag` selectors. Use to delete CTA blocks that would otherwise advertise a signup flow that does nothing.',
              ),
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
            resize: z
              .boolean()
              .default(true)
              .describe(
                'Generate same-format resized variants (`/content/images/size/wXXX[hYYY]/<path>`) for theme `image_sizes` and the default responsive widths. Requires `sharp`; when sharp is not installed the pass is skipped with a warning and `<img>` srcset URLs may 404 (browsers fall back to the original `src`). Set to `false` to opt out of the resize pipeline entirely (e.g. when source images are already pre-resized or the project does not want a sharp dependency).',
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
            lqip: z
              .boolean()
              .default(true)
              .describe(
                'Inline tiny JPEG placeholders as `<img style="background:url(data:...)">` for local raster images so pages can blur up while the full image loads. Requires `sharp`; when sharp is unavailable the pass is skipped.',
              ),
            lqip_width: z
              .number()
              .int()
              .min(4)
              .max(64)
              .default(16)
              .describe('Width in pixels used for generated LQIP placeholder JPEGs.'),
            lqip_quality: z
              .number()
              .int()
              .min(1)
              .max(100)
              .default(40)
              .describe('JPEG quality used for generated LQIP placeholder data URIs.'),
            strip_metadata: z
              .boolean()
              .default(true)
              .describe(
                'Strip EXIF and other embedded image metadata from copied content images and generated resize/transcode variants. Enabled by default to avoid publishing private camera/GPS metadata; set false only when preserving metadata is intentional.',
              ),
            cache_dir: z
              .string()
              .default('.laurel/cache/images')
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
        redirects: z
          .object({
            enabled: z
              .boolean()
              .default(true)
              .describe(
                'Load `redirects.yaml` (project root) and Ghost-style `content/data/redirects.{yaml,yml,json}` and emit a `_redirects` file at the publish root in the Netlify / Cloudflare Pages format (`<from>  <to>  <status>`). Independent of `[deploy.cloudflare_pages]` and `[deploy.netlify]`: those toggles still gate their own emitters which add platform-specific shape (e.g. Netlify `force` suffix), but this component runs unconditionally so a Ghost migration retains its redirect history regardless of which host the build targets. Set to `false` to suppress the component-level emit entirely.',
              ),
            emit_html: z
              .boolean()
              .default(false)
              .describe(
                'In addition to `_redirects`, write a static HTML `meta http-equiv="refresh"` page at `<from>/index.html` for every rule. Use this when deploying to a host that does NOT honor `_redirects` (S3 static-website without routing rules, plain Apache without mod_rewrite). For GitHub Pages, prefer `[deploy.github_pages].redirects` because it preserves Pages base-path, root, and 404 conventions. HTTP status codes are NOT preserved by HTML refresh — every redirect becomes a 200 + client-side jump — so prefer the `_redirects` file whenever the host supports it.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Component-level redirects emitter. Loads Ghost-compatible `content/data/redirects.{yaml,yml,json}` (Ghost migration drop-in: flat `[{from,to,permanent}]` or status-keyed `{301: [...], 302: [...]}`) and the canonical project-root `redirects.yaml`, then emits a single `_redirects` file in Netlify / Cloudflare Pages format. Independent of deploy-target toggles so migrated redirect history survives regardless of host.',
          ),
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
                'mailchimp',
                'emailoctopus',
              ])
              .default('none')
              .describe(
                'Members / Portal backend. `none` keeps `@site.members_enabled` off so Source theme hides every sign-in / subscribe button. `ghost` wires the `#/portal/*` href hashes that Ghost\'s own Portal script intercepts (no rewrite). `custom` keeps the same UI surface but lets the embedder swap in their own client-side handler — if any `*_url` field is set the corresponding `data-portal` button is rewritten to that link, otherwise the original href is left alone. The remaining providers (`buttondown`, `beehiiv`, `substack`, `convertkit`, `bentonow`, `mailerlite`, `mailchimp`, `emailoctopus`) are external newsletter / membership services: Laurel rewrites the dead `data-portal="signup"` / `"signin"` / `"account"` / `"upgrade"` buttons emitted by Ghost themes to point at the provider\'s hosted pages, inferring URLs from `publication` for providers with conventional URL shapes and falling back to the explicit `*_url` overrides otherwise.',
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
            member_count: z
              .number()
              .int()
              .nonnegative()
              .optional()
              .describe(
                'Manual static override for `{{member_count}}` / `@site.member_count`. Static builds cannot know live member totals, so the helper renders an empty string unless this value is set.',
              ),
            publication: z
              .string()
              .optional()
              .describe(
                'Provider-specific publication identifier used to infer default URLs. Buttondown / Beehiiv / Substack treat it as the publication slug (e.g. `my-newsletter`); ConvertKit treats it as a form id; Bento, MailerLite, Mailchimp, and EmailOctopus have no canonical Portal URL shape, so their builds require explicit `*_url` overrides instead. Ignored for `provider = "none"` / `"ghost"` / `"custom"`.',
              ),
            signup_url: z
              .string()
              .optional()
              .describe(
                'Override for the URL injected into `data-portal="signup"` / `data-portal="subscribe"` triggers (Ghost\'s Subscribe button). When unset and the active provider can infer one from `publication`, the inferred URL is used; otherwise the static runtime logs a warning on click.',
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
                'Override for the URL injected into `data-portal="upgrade"` triggers (Ghost\'s paid-tier Upgrade CTA). Typically a checkout / pricing page; without it the static runtime logs a documented stub warning.',
              ),
            inject_script: z
              .boolean()
              .default(false)
              .describe(
                'When true, inject Ghost\'s Portal client script into every page via `{{ghost_head}}`. The script attaches `data-portal` click handlers (signup / signin / account / upgrade) and renders the modal UI without any further wiring. Defaults to `false` so plain static blogs ship no extra JS; flip on to wire up Ghost Portal against a real backend (Ghost server, ghost-static-portal, or any self-hosted fork). Independent of `provider`: combining `inject_script = true` with `provider = "ghost"` is the canonical Ghost-compat setup, but the flag also works alongside `provider = "custom"` when the operator wires their own handler script through `script_src`.',
              ),
            inline_submit: z
              .boolean()
              .default(false)
              .describe(
                'When true, inject a tiny inline `{{ghost_foot}}` runtime that intercepts `data-members-form` submissions with `fetch`, toggles Ghost-compatible `loading` / `success` / `error` form classes, and reveals `data-members-success` / `data-members-error` messages. Defaults to `false` so provider-hosted forms keep native browser submission unless the operator explicitly opts into client-side success/error UX.',
              ),
            script_src: z
              .string()
              .default('https://unpkg.com/@tryghost/portal@latest/umd/portal.min.js')
              .describe(
                'URL of the Portal client script injected when `inject_script = true`. Defaults to the canonical unpkg-hosted `@tryghost/portal` bundle; override to self-host the file (`/assets/portal.min.js`) or pin a specific version (`https://unpkg.com/@tryghost/portal@2.x/...`). The URL is emitted verbatim as the `<script src="…">` attribute and dropped into the rendered HTML, so it must be a value the operator trusts.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Ghost Members / Portal compatibility. Static-only, but the flags it exposes on `@site` (`members_enabled`, `paid_members_enabled`, `members_invite_only`) are what Source-style themes branch on for sign-in UI, sidebar CTAs, and footer links. When `@site.members_enabled` is true, Laurel also emits `assets/laurel-portal.js` and injects it through `{{ghost_foot}}` so `[data-portal]` buttons warn or navigate instead of becoming silent no-ops. When `provider` names an external newsletter service (buttondown / beehiiv / substack / convertkit / bentonow / mailerlite / mailchimp / emailoctopus) or `custom` with explicit URLs, Laurel additionally rewrites the dead `data-portal="signup"` / `"signin"` / `"account"` / `"upgrade"` buttons shipped by Ghost themes so they deep-link to the configured backend.',
          ),
        helpers: z
          .object({
            paths: z
              .array(z.string())
              .default([])
              .describe(
                'Optional list of JavaScript / TypeScript files (relative to the project root) that export Handlebars helpers. Each module is dynamic-imported at build start; named exports become helpers registered under the export name, and a `default` export shaped `{ name: string, fn: Function }` (or `Record<string, Function>`) is registered accordingly. Thin sugar over writing a plugin that calls `engine.registerHelper`; for anything more involved than a couple of pure-function helpers, prefer a real plugin.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Lightweight extension point for registering Handlebars helpers from a config-listed file without writing a full plugin. The build dynamic-imports each `paths[]` entry and registers its exports as helpers on the render engine.',
          ),
        tags: z
          .object({
            min_posts_per_tag: z
              .number()
              .int()
              .nonnegative()
              .default(1)
              .describe(
                'Minimum number of associated posts a tag must have for its archive route (`/tag/<slug>/`) to be generated. Defaults to `1` so tags with zero posts are silently skipped — Ghost JSON exports commonly include hundreds of internal `hash-` tags or legacy tags with no associated content, and pre-rendering archive pages for each one blows up planning time and emits thousands of near-empty HTML files on large imports (see backlog #152). Set to `0` to render every tag regardless of post count (back-compat with sites that want empty archives discoverable), or raise to e.g. `2` to suppress one-off tags that add long-tail noise without useful crawl signal.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Tag archive emission knobs. Currently only `min_posts_per_tag`; reserved for future per-archive controls.',
          ),
        authors: z
          .object({
            min_posts_per_author: z
              .number()
              .int()
              .nonnegative()
              .default(1)
              .describe(
                'Minimum number of associated posts an author must have for their archive route (`/author/<slug>/`) to be generated. Defaults to `1` so authors with no published posts are silently skipped — sites with imported staff profiles or guest-author placeholders should not ship a dead author archive. Set to `0` to render every author regardless of post count, or raise to e.g. `2` to suppress single-post contributors from the author archive surface.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Author archive emission knobs. Mirrors `[components.tags]` for the per-author archive route.',
          ),
        analytics: z
          .object({
            provider: z
              .enum(['none', 'plausible', 'umami', 'fathom', 'simpleanalytics', 'googleanalytics'])
              .default('none')
              .describe(
                'Analytics backend whose tracking snippet is injected into every page via `{{ghost_head}}`. `none` skips injection. For `plausible` / `umami` / `fathom` / `simpleanalytics`, `site` is the domain / website ID / site ID used by the provider. For `googleanalytics`, `site` is the GA4 measurement id (e.g. `G-XXXXXXXX`). DNT and IP anonymisation are handled by the provider itself; consult their docs to opt in.',
              ),
            site: z
              .string()
              .optional()
              .describe(
                'Provider-specific identifier embedded in the analytics snippet. Plausible: domain (e.g. `example.com`). Umami: data-website-id (UUID). Fathom: data-site (e.g. `ABCDEFGH`). Google Analytics: measurement id (e.g. `G-XXXXXXXX`). Simple Analytics does not require a site id; the field is ignored. Required when `provider` is anything other than `none` / `simpleanalytics`.',
              ),
          })
          .strict()
          .default({})
          .describe(
            "Drop-in analytics snippet. When `provider` is set, the corresponding script tag (and any `<noscript>` fallback) is appended to every page's `{{ghost_head}}` output. Privacy concerns (Do-Not-Track honouring, IP anonymisation, cookie banners) are the provider's responsibility — Laurel only emits the documented embed snippet verbatim.",
          ),
        preview: z
          .object({
            member: z
              .object({
                paid: z
                  .boolean()
                  .default(false)
                  .describe(
                    'When true the preview member is treated as paid. Drives `{{@member.paid}}` and the `{{#unless @member}}` branch in Source / Casper headers, footers, and locked-card CTAs.',
                  ),
                name: z
                  .string()
                  .optional()
                  .describe(
                    'Optional display name surfaced as `{{@member.name}}` (Source theme falls back to "Account" in the menu otherwise).',
                  ),
                email: z
                  .string()
                  .optional()
                  .describe('Optional email surfaced as `{{@member.email}}` (rare in themes).'),
                default_payment_card_last4: z
                  .string()
                  .optional()
                  .describe(
                    'Optional card suffix surfaced as `{{@member.default_payment_card_last4}}` for account templates such as Krabi that preview billing details.',
                  ),
                subscriptions: z
                  .array(
                    z
                      .object({
                        cancel_at_period_end: z
                          .boolean()
                          .optional()
                          .describe(
                            'Optional Ghost subscription cancellation flag surfaced as `{{cancel_at_period_end}}` inside `{{#foreach @member.subscriptions}}`.',
                          ),
                        current_period_end: z
                          .string()
                          .optional()
                          .describe(
                            'Optional billing period end surfaced as `{{current_period_end}}` inside `{{#foreach @member.subscriptions}}`.',
                          ),
                        plan: z
                          .object({
                            currency_symbol: z
                              .string()
                              .optional()
                              .describe(
                                'Optional plan currency symbol surfaced as `{{plan.currency_symbol}}` for account templates.',
                              ),
                            interval: z
                              .string()
                              .optional()
                              .describe(
                                'Optional plan interval surfaced as `{{plan.interval}}` for account templates.',
                              ),
                          })
                          .strict()
                          .optional()
                          .describe(
                            'Optional Ghost plan preview object. Missing plan fields remain safely empty in templates.',
                          ),
                      })
                      .strict(),
                  )
                  .optional()
                  .describe(
                    'Optional Ghost-style subscription preview rows surfaced as `{{@member.subscriptions}}`. This exists only for build-time account-page previews; static output still has no authenticated viewer unless preview.member is configured.',
                  ),
              })
              .strict()
              .optional()
              .describe(
                'Inject a synthetic `@member` object into every render so themes that branch on `{{#if @member}}` / `{{@member.paid}}` (Casper sign-in dropdown, Source paid-only blocks, Edition CTA) can be visually previewed against the static build. Unset (the default) preserves the canonical static-build behaviour where `@member` is `undefined` and only the unauthenticated branch ever renders. Static builds have no logged-in viewer; this knob exists strictly for visual previewing of authenticated states and never gates content delivery.',
              ),
          })
          .strict()
          .default({})
          .describe(
            'Build-time preview overrides that inject otherwise server-only context into renders. Currently only `preview.member` for previewing the `@member.*` branches Casper-family themes use. Has no effect on which files are emitted; only on what each rendered page looks like.',
          ),
      })
      .strict()
      .default({})
      .describe('Optional components that emit extra files or inject markup.'),
  })
  .strict();

export type LaurelConfig = z.infer<typeof configSchema>;
export type ContentKindConfig = z.infer<typeof contentKindSchema>;
// Input shape from `laurel.toml`. Strict, only `label` + `url`.
type NavigationItemConfig = z.infer<typeof navigationItemSchema>;

// Runtime shape exposed to themes via `@site.navigation`. The render layer
// enriches each item with `slug` (derived from `label` so themes can emit
// `class="nav-{{slug}}"`) and `current` (whether the item's `url` matches the
// route being rendered, with trailing-slash normalisation). Both are optional
// from a type standpoint so unit tests and direct config consumers can keep
// passing the bare `{label, url}` shape.
export interface NavigationItem extends NavigationItemConfig {
  slug?: string;
  current?: boolean;
}
export type RecommendationItem = z.infer<typeof recommendationItemSchema>;
export type TierItem = z.infer<typeof tierItemSchema>;
