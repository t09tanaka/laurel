# Ghost compatibility notes

Living document. Every time a Ghost helper or context field is implemented or
deliberately scoped out, record it here.

For a practical, signature-level reference of every helper and context with
worked examples, see [`THEME_DEV.md`](./THEME_DEV.md). This document tracks
status and edge cases as we discover them.

For the members / portal compatibility surface in particular — what
`@member`, `@site.members_enabled`, `{{#unless access}}`, and the
`data-portal="…"` rewrites mean in a static build, plus migration
recipes for Buttondown / Beehiiv / Substack — see
[`MEMBERS.md`](./MEMBERS.md).

## Helpers

See `DESIGN.md` §4 for the master matrix.

### Notes on partial behaviour

- `{{!< layout}}` is parsed in `src/render/layouts.ts`. We rewrite the inner
  template into `{{#> layout}}<inner>{{/layout}}` semantics by capturing
  everything after the layout directive as the layout's body.
- Hash params on partial includes (`{{> "post-card" lazyLoad=true}}`) pass
  through Handlebars' standard partial param plumbing — no special handling
  required.

## Contexts

### `@site`
| Field            | Source |
|------------------|--------|
| `title`          | `nectar.toml [site].title` |
| `description`    | `nectar.toml [site].description` |
| `url`            | `nectar.toml [site].url` |
| `logo`           | `nectar.toml [site].logo` |
| `icon`           | `nectar.toml [site].icon` |
| `cover_image`    | `nectar.toml [site].cover_image` |
| `lang` / `locale`| `nectar.toml [site].locale` |
| `timezone`       | `nectar.toml [site].timezone` |
| `accent_color`   | `nectar.toml [site].accent_color` |
| `navigation`     | `nectar.toml [[navigation]]` |
| `secondary_navigation` | `nectar.toml [[secondary_navigation]]` |
| `members_enabled` | Always `false`. Nectar has no members backend; this stable default makes Source's sidebar/header/footer/CTA `{{#if @site.members_enabled}}` branches collapse to the public path. |
| `paid_members_enabled` | Always `false`. Same rationale as `members_enabled`; gates the paid-only badge in `post-list.hbs`. |
| `recommendations_enabled` | Always `false`. Gates Source's recommendations widget in `post-list.hbs`. Recommendations are a Ghost server feature with no static equivalent. |

### `@custom`
Built from the theme's `package.json` `config.custom.*` defaults, with
overrides applied from `nectar.toml [theme.custom]`.

### `post` / `page` / `tag` / `author`
The exposed fields are exactly the keys on `Post`/`Page`/`Tag`/`Author` model
types defined in `src/content/model.ts`. Keep that as the source of truth.

## Ghost card support status

This matrix tracks the per-card contract for `nectar import-ghost` and the
Markdown renderer. "Migrates" means a Ghost export can retain enough structure
in `content/posts/*.md` to avoid data loss. "Renders" means a static Nectar
build emits usable reader-facing HTML without a Ghost server.

| Card | Migrates | Renders | Notes |
|------|----------|---------|-------|
| Image | Yes | Yes | Preserves `kg-image-card`, image link, caption, width/height, and width modifier classes where exported. |
| Gallery | Yes | Yes | Preserves the `kg-gallery-container` / row / image shape with intrinsic image dimensions; Nectar does not inject Ghost's legacy gallery bootstrap script. |
| Bookmark | Yes | Yes | Converts to a `{{< bookmark />}}` shortcode and renders the static `kg-bookmark-card` scaffold with best-effort metadata. |
| Embed | Yes | Partial | Converts to `{{< embed />}}`. YouTube, Vimeo, and Spotify render static iframes; Twitter/X, Instagram, TikTok, and CodePen stay fallback links unless a site deliberately loads provider scripts. |
| HTML | Yes | Partial | Imports through the HTML-card sanitizer and renders allowed raw HTML. Script/style loaders and dangerous URL schemes are removed. |
| Markdown | Yes | Yes | Ghost's rendered Markdown-card HTML is converted back through Turndown and then rendered as normal Markdown/HTML. |
| Code | Yes | Yes | Renders fenced code as `<pre><code>` and keeps language hints; Ghost-specific code-card wrapper and caption parity is limited. |
| Callout | Yes | Yes | Renders the static `kg-callout-card` wrapper, color modifier, emoji, and text body. |
| Button | Yes | Yes | Renders a static `kg-button-card` anchor with alignment and button style classes. |
| Toggle | Yes | Yes | Renders as native `<details>` / `<summary>` with `kg-toggle-card` hooks; no Ghost toggle JavaScript is required. |
| File | Yes | Yes | Renders a static download link with `kg-file-card` metadata rows. |
| Audio | Yes | Yes | Renders native `<audio controls>` plus `kg-audio-*` metadata hooks; Ghost's custom player runtime is not hydrated. |
| Video | Yes | Yes | Renders native `<video controls>`, poster, captions/tracks, and sanitized `--aspect-ratio` metadata for theme CSS. |
| Product | Yes | Yes | Renders the static product-card scaffold, image/title/description/rating/CTA fields that survived import. |
| Header | Partial | Partial | Raw `kg-header-card` HTML scaffolds survive sanitisation and Source has matching CSS hooks, but Nectar does not yet emit a first-class header-card shortcode from Lexical nodes. |
| NFT | Partial | Partial | Static link, image, and metadata scaffolds survive; no blockchain wallet, marketplace, or live ownership runtime is provided. |
| Signup | Partial | Partial | The `kg-signup-card` wrapper can survive for portal/member plugins, but raw form fields are stripped by default and Nectar has no members backend. |
| Recommendations | Partial | Partial | Static `kg-recommendations-card` markup can survive sanitisation for plugin/theme hydration; Ghost's server-side recommendations service is not implemented. |
| Email / email CTA | No | No | Members/newsletter-only email cards are stripped so a public static build does not expose email-only content. |
| Paywall | Partial | Partial | The paywall marker is used by the content loader to cut gated content; visible server-side member access behaviour is out of scope. |

### `error`

The root `error` context is only populated for Nectar's static `/404.html`
route when a theme-provided `error-404.hbs` or `error.hbs` template is rendered.
Normal post, page, index, tag, and author routes do not seed `error`.

That means runtime-only Ghost snippets such as Biron's subscribe error display
(`{{{error.message}}}`) are safe in Nectar: with no failed POST happening at
static render time, the path resolves to an empty string and does not throw.
Nectar does not implement a runtime subscribe POST error lifecycle.

### `is_popup`

Ghost sets root `is_popup` while rendering the subscribe iframe popup. Nectar
does not implement that popup rendering context, so every static route exposes
`is_popup: false` on the root template context. Theme guards such as Wave's
`{{#if is_popup}}` therefore remain safe and deterministic, but popup-only
classes like `.popup` are never added by Nectar.

## Migration: Ghost HTML card sanitisation

Ghost's "HTML card" (`<!--kg-card-begin: html-->…<!--kg-card-end: html-->`,
also serialized as `<div class="kg-card kg-html-card">…</div>`) stores
arbitrary author-supplied HTML straight from the editor. Ghost itself does
no scrubbing on export — anything an author pasted, including
`<script>` loaders, `onerror=` handlers, or `javascript:` anchors, lands
verbatim in `posts.html`.

`nectar import-ghost` previously preserved that inner HTML byte-for-byte.
That makes the conversion predictable, but it also means a single
compromised or careless source post becomes stored XSS once the resulting
markdown is rendered by `marked` (which passes raw HTML through). To close
that hole at the boundary where untrusted HTML enters the project, the
import pipeline routes every HTML-card body through
`sanitizeImportedHtmlCard` (`src/ghost/turndown-rules.ts`).

### Policy

| Element / attribute        | Behaviour at import | Rationale |
|----------------------------|---------------------|-----------|
| `<script>` (block or inline `src`) | Dropped | The single highest-impact XSS vector. Vendor widget loaders (analytics, embeds) belong in the theme's `{{ghost_head}}` injection, not per-post HTML. |
| `<style>` block elements   | Dropped | CSS injection can position fake UI overlays or exfiltrate via attribute selectors. Inline `style="…"` attributes are still allowed for per-element styling. |
| Inline event handlers (`onclick`, `onerror`, `onload`, …) | Dropped | These execute author-controlled JavaScript on render. There is no legitimate import-time use case for them. |
| `javascript:` / `data:` schemes on `href`, `src` | Dropped | Same reasoning — they execute arbitrary code when followed. |
| `<iframe>` with `src` over `https` | Allowed (with `src`, `width`, `height`, `allow`, `allowfullscreen`, `frameborder`, `title`, `loading`, `referrerpolicy`, `sandbox`) | HTML cards are the escape hatch for custom embeds (CodePen, Spotify dashboards, internal apps). Restricting to `https` keeps the common case working without admitting `http://` mixed-content or `srcdoc=` XSS. |
| `<iframe>` with `http://` or `javascript:` `src` | Dropped | See above. |
| Layout/structure tags (`div`, `span`, `p`, lists, tables, `figure`, `details`/`summary`, semantic inline tags) | Allowed | Authors use HTML cards to escape Ghost's default Koenig layouts; we keep that intent intact. |
| Media tags (`img`, `picture`, `source`, `video`, `audio`, `track`) | Allowed | Custom hero images and inline media are the second most common HTML-card use. |
| `style` attribute (inline) | Allowed | Required for per-element colour, layout, and spacing tweaks authors commonly inline. |

### Defence in depth

Even with this allowlist, the rendered HTML is sanitised a second time
when `renderMarkdown` runs (`src/content/markdown.ts`,
`sanitizeRenderedHtml`). The import-time pass is the first line of
defence so that what lands in `content/posts/*.md` is already safe to
read, diff, and review by hand; the render-time pass is the backstop for
hand-edited Markdown.

If a project is fully trusted (single-author, internal tooling, no
external contributors) and wants to bypass either layer, the right knob
is `unsafe: true` on `renderMarkdown` — not widening the import-time
allowlist, which would silently apply to every future re-import.

## Embed cards

Ghost exports rich embeds as `.kg-embed-card` figures. During import, Nectar
turns those figures into `{{< embed ... />}}` shortcodes with the source URL
and an inferred provider so the Markdown renderer can rebuild the card without
requiring Source theme CSS beyond the top-level `.kg-embed-card` selector.

Nectar renders static iframe embeds for providers whose public embed URL works
without a per-page script loader:

| Provider | Rendered output | Notes |
|----------|-----------------|-------|
| YouTube | `https://www.youtube-nocookie.com/embed/...` iframe | Uses YouTube's privacy-enhanced host, but loading the iframe still contacts YouTube/Google once the reader's browser requests it. |
| Vimeo | `https://player.vimeo.com/video/...` iframe | No vendor script is injected by Nectar. Vimeo may still process reader IP/user-agent data when the iframe loads. |
| Spotify | `https://open.spotify.com/embed/...` iframe | No vendor script is injected by Nectar. Spotify receives a third-party iframe request when loaded. |

Twitter/X, Instagram, TikTok, and CodePen embeds are intentionally not hydrated
by default. Their official embeds require third-party JavaScript (`widgets.js`,
Instagram `embed.js`, TikTok embed scripts, or CodePen loaders) to transform
blockquote/link markup into the final widget. Injecting those scripts from
post content would create a larger privacy/GDPR surface: reader identifiers,
IP addresses, cookies, consent state, and cross-site tracking behaviour are
controlled by the provider rather than Nectar. For those providers, Nectar
keeps a `.kg-embed-card` fallback link and caption. Site operators who accept
that tradeoff can add the provider's script deliberately in their theme or
plugin and document the consent/cookie implications for their jurisdiction.

## Theme runtime assets

Ghost's official themes sometimes rely on client-side JavaScript that is not
part of the `.hbs` helper surface. Real Ghost serves this through its
`shared-theme-assets` bundle, while Nectar only renders static files and
copies assets that are present in the theme directory.

### Gallery cards

Nectar does not inject the legacy Editorial theme's inline gallery bootstrap
script into post bodies. That script walks `.kg-gallery-image` elements at
runtime and depends on Ghost's Koenig gallery DOM shape.

Instead, Markdown-derived gallery cards must render the Ghost-compatible static
markup up front:

```html
<figure class="kg-card kg-gallery-card">
  <div class="kg-gallery-container">
    <div class="kg-gallery-row">
      <div class="kg-gallery-image">
        <img src="/content/images/example.jpg" alt="" width="1200" height="800" />
      </div>
    </div>
  </div>
</figure>
```

The compatibility contract is the direct descendant shape
`.kg-gallery-image > img[width][height]`. Source imports, Koenig shortcode
rendering, and hand-authored Markdown should preserve intrinsic dimensions on
each gallery image so Ghost themes can size rows without per-post JavaScript.
Themes that still ship a post-body gallery bootstrap should remove it for
Nectar builds and rely on the static markup instead.

### Audio cards

Ghost's Koenig audio card uses `kg-audio-*` markup plus shared runtime
JavaScript for the custom play button, seek slider, and live timestamps. Nectar
does not hydrate that runtime in static output.

For Source, Nectar vendors stable CSS for the card shell, thumbnail, metadata,
and player hooks, and it relies on the static `<audio controls>` fallback that
Nectar's audio card renderer emits:

```html
<div class="kg-card kg-audio-card">
  <img src="/content/images/podcast.jpg" alt="" class="kg-audio-thumbnail" />
  <audio src="/content/audio/episode.mp3" preload="metadata" controls></audio>
  <div class="kg-audio-title">Episode title</div>
  <div class="kg-audio-duration">42:07</div>
</div>
```

Themes that preserve Ghost's fully custom audio player DOM should vendor the
matching Koenig JavaScript or ensure a native `<audio controls>` element remains
available. CSS alone cannot make an inert custom play button or seek slider
control playback.

### Koenig card class hooks

Casper-family themes target Koenig card wrapper classes directly. Nectar keeps
those hooks in `renderMarkdown` output rather than downgrading imported cards to
plain paragraphs or bare media tags.

The current Markdown renderer expands these Ghost-import shortcodes back to
theme-compatible HTML scaffolds:

| Shortcode/input | Rendered wrapper contract |
|-----------------|---------------------------|
| `{{< bookmark />}}` | `<figure class="kg-card kg-bookmark-card">` with `.kg-bookmark-container` children. |
| `{{< gallery >}}` | `<figure class="kg-card kg-gallery-card">` with `.kg-gallery-container`, `.kg-gallery-row`, and `.kg-gallery-image`. |
| `{{< callout >}}` | `<div class="kg-card kg-callout-card ...">` with `.kg-callout-emoji` and `.kg-callout-text`. |
| `{{< button >}}` | `<div class="kg-card kg-button-card ...">` with an `.kg-btn` anchor. |
| `{{< toggle >}}` | `<details class="kg-card kg-toggle-card">` plus native `<summary>` behaviour. |
| `{{< file />}}` | `<div class="kg-card kg-file-card">` with `.kg-file-card-container` and metadata rows. |
| `{{< audio />}}` | `<div class="kg-card kg-audio-card">` with an `<audio controls>` element and metadata rows. |
| `{{< video />}}` | `<figure class="kg-card kg-video-card">` with `.kg-video-container`, `<video>`, optional `<track>`, caption, and sanitized `--aspect-ratio`. |
| `{{< product />}}` | `<div class="kg-card kg-product-card">` with image, title, description, optional rating, and CTA scaffold. |

Raw Ghost-compatible HTML scaffolds for `kg-header-card`, `kg-nft-card`, and
`kg-signup-card` are preserved through sanitisation so theme CSS hooks and
optional hydration code can still target them. Nectar does not currently build
those cards from first-class Markdown shortcodes: header cards remain static
decorative HTML, NFT cards keep their static link/image/metadata scaffold
without blockchain runtime integration, and signup cards keep the
`kg-signup-card` wrapper while raw form fields are stripped unless a portal or
members plugin rehydrates the card.

`tests/fixtures/cards` pins this contract for the major Casper-family wrapper
classes: `kg-bookmark-card`, `kg-gallery-card`, `kg-callout-card`,
`kg-button-card`, `kg-product-card`, `kg-toggle-card`, `kg-file-card`,
`kg-audio-card`, `kg-video-card`, `kg-header-card`, `kg-nft-card`, and
`kg-signup-card`.

The Ease theme is the current compatibility example: its `index.hbs` and
`tag.hbs` templates emit a `<button class="gh-loadmore">` load-more control.
That button is intentionally just markup unless the theme also vendors the
Ghost infinite-scroll JavaScript from `shared-theme-assets` and loads it from
`{{ghost_foot}}`, the theme's own bundled script, or another static asset
included in the site. Without that vendored runtime, Nectar still renders the
button for theme parity, but it is inert in the browser.

When porting a Ghost theme, audit classes and `data-*` hooks that expect
Ghost-admin or shared-theme-assets code. Either vendor the required script as a
theme asset, replace the hook with a Nectar-managed optional component, or
remove the control from the template.

### External script URLs in theme layouts

Nectar leaves theme-authored external `<script>` URLs and integrity metadata
untouched. This includes Wave's `default.hbs`, which hard-codes the jQuery
3.3.1 CDN dependency in its layout. That dependency is a theme limitation,
leave untouched: Nectar should not rewrite the CDN URL, substitute a newer
jQuery version, or regenerate an `integrity` hash on the theme's behalf.

Projects that need different supply-chain policy should fork or patch the
theme so the script is vendored locally or updated deliberately. Nectar's build
pipeline may minify surrounding HTML, but it must preserve explicit `src` and
`integrity` attributes emitted by the theme.

## Things Ghost themes do that we explicitly do *not* handle

- Members context (`@member.*`) — undefined; templates that read it get
  empty values via the proxy default.
- Runtime subscribe / Portal error context (`error.message`) — only Ghost's
  live runtime populates this after failed POSTs. Nectar leaves `error` unset
  on normal static routes, so those snippets render empty.
- The Ghost Content API (`{{#get}}` against remote endpoints) — we resolve
  against the local content graph only.
- Mobiledoc / Lexical card-level customization — content comes pre-rendered
  as HTML by the Markdown pipeline; we don't emit card markup.
- Ghost-only HTML transforms (responsive image srcsets via Ghost's image
  service) — pass-through; users can plug an optional `[components.images]`
  later.
- Ghost's `/search/` endpoint and the `sodo-search` integration — Nectar
  does not replicate the live `/content/search/` API shape. The
  `[components.search]` component instead emits a flat
  `content/search.json` ({ `posts`, `pages`, `tags`, `authors` }) for
  client-side fuzzy search libraries (lunr / Fuse / minisearch), and can
  optionally shell out to Pagefind (`engine = "pagefind"` /
  `"json+pagefind"`) to emit `pagefind/*`. Themes that hard-code the
  `/search/` POST shape need to be re-wired to one of these consumers.
- Ghost's `shared-theme-assets` runtime — not bundled by Nectar. Theme
  controls such as Ease's `<button class="gh-loadmore">` require the theme to
  vendor and load the matching infinite-scroll JavaScript; otherwise they
  remain static markup.
- Ghost Admin's integrations directory (`/ghost/api/integrations`, including
  Zapier, Slack, and similar app listings) — out of scope. Nectar has no Admin
  UI, no Admin API, and no server runtime to own integration installation or
  webhook delivery. External automation should live in build hooks, CI, or the
  deploy provider's integration/webhook settings around `nectar build`.
