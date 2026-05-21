# Ghost compatibility notes

Living document. Every time a Ghost helper or context field is implemented or
deliberately scoped out, record it here.

For a practical, signature-level reference of every helper and context with
worked examples, see [`THEME_DEV.md`](./THEME_DEV.md). This document tracks
status and edge cases as we discover them.

For the supported Ghost Admin export -> Nectar Markdown import path, see
[`MIGRATION.md`](./MIGRATION.md). It lists what `nectar import-ghost` imports
automatically and what needs manual work after conversion.

For the members / portal compatibility surface in particular — what
`@member`, `@site.members_enabled`, `{{#unless access}}`, and the
`data-portal="…"` rewrites mean in a static build, plus migration
recipes for Buttondown / Beehiiv / Substack and the member analytics
dashboard gap — see
[`MEMBERS.md`](./MEMBERS.md).

For contributor work that adds a new Ghost / Koenig card, follow
[`docs/contrib/ADDING_A_CARD.md`](./contrib/ADDING_A_CARD.md). It lists the
import rule, Markdown shortcode, renderer, shared CSS, fixture, and regression
test surfaces that must move together.

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
| `member_count` | Empty by default. Set `[components.portal].member_count` to surface a manually maintained static total for `{{member_count}}` / `@site.member_count`; Nectar never infers live member totals. |
| `portal_button`, `portal_button_icon`, `portal_button_signup_text`, `portal_button_style`, `portal_name`, `portal_plans`, `portal_signup_checkbox_required`, `portal_signup_terms_html`, `signup_url` | From `nectar.toml [site.portal]`. These mirror Ghost Portal settings for themes that probe `@site.portal_*` fields, but Nectar still does not authenticate members by itself. |
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
| Gallery | Yes | Yes | Preserves the `kg-gallery-container` / row / image shape, intrinsic image dimensions, and width modifier classes; Nectar does not inject Ghost's legacy gallery bootstrap script. |
| Bookmark | Yes | Yes | Converts to a `{{< bookmark />}}` shortcode and renders the static `kg-bookmark-card` scaffold with best-effort metadata. |
| Embed | Yes | Partial | Converts to `{{< embed />}}` and preserves width modifier classes. YouTube, Vimeo, and Spotify render static iframes; other known providers keep the source URL and render a bookmark-style fallback link unless a site deliberately loads provider scripts. |
| HTML | Yes | Partial | Imports through the HTML-card sanitizer and renders allowed raw HTML. Script/style loaders and dangerous URL schemes are removed. |
| Markdown | Yes | Yes | Ghost's rendered Markdown-card HTML is converted back through Turndown and then rendered as normal Markdown/HTML. |
| Code | Yes | Yes | Renders fenced code as `<pre><code>` and keeps language hints; Ghost code-card wrappers use `.kg-code-card`, `pre`, `figcaption`, and the `.kg-code-card-with-line-numbers pre` gutter contract when that metadata survives import. |
| Callout | Yes | Yes | Renders the static `kg-callout-card` wrapper, color modifier, emoji, and text body. |
| Button | Yes | Yes | Renders a static `kg-button-card` anchor with alignment and button style classes. |
| Toggle | Yes | Yes | Renders as native `<details>` / `<summary>` with `kg-toggle-card` hooks; no Ghost toggle JavaScript is required. |
| File | Yes | Yes | Renders a static download link with `kg-file-card-contents`, metadata rows, and icon hooks. |
| Audio | Yes | Yes | Renders native `<audio controls>` plus `kg-audio-*` metadata hooks; Ghost's custom player runtime is not hydrated. |
| Video | Yes | Yes | Renders native `<video controls>`, poster, captions/tracks, width modifier classes, and sanitized `--aspect-ratio` metadata for theme CSS. |
| Product | Yes | Yes | Renders the static product-card scaffold, image/title/description/rating/CTA fields that survived import. |
| Header | Yes | Yes | Ghost v1 `kg-header-card` HTML converts to a `{% header %}` shortcode and renders the static header-card scaffold with style, background, title, subtitle, and CTA fields. |
| NFT | Partial | Partial | Static link, image, and metadata scaffolds survive; no blockchain wallet, marketplace, or live ownership runtime is provided. |
| Signup | Partial | Partial | The `kg-signup-card` wrapper, layout classes, disclaimer, and form hooks can survive for portal/member plugins; Nectar ships static card CSS but no Ghost members backend. |
| Recommendations | Partial | Partial | Static `kg-recommendations-card` markup can survive sanitisation for plugin/theme hydration; Ghost's server-side recommendations service is not implemented. |
| Email / email CTA | No | No | Members/newsletter-only email cards are dropped during import and stripped during rendering so a public static build does not expose email-only content. |
| Paywall | Partial | Partial | The paywall marker is used by the content loader to cut gated content; visible server-side member access behaviour is out of scope. |

## Content API `post.html` serialization

Nectar's Content API exposes `post.html` and `page.html` from the same
Markdown renderer that feeds `{{content}}`. It is Ghost-shaped, but it is not
a byte-for-byte Ghost serializer.

The current contract is:

- Imported or shortcode-authored Koenig cards that Nectar understands render
  with their public `kg-card` class hooks (`kg-image-card`, `kg-bookmark-card`,
  `kg-gallery-card`, `kg-callout-card`, and the other rows in the matrix
  above).
- Plain Markdown stays plain Markdown HTML. A normal paragraph, heading, list,
  quote, or fenced code block is not wrapped in a Ghost card container just
  because Ghost's editor may have stored it as a Markdown or code card.
- Ghost editor fence comments such as `<!--kg-card-begin: markdown-->`,
  `<!--kg-card-end: markdown-->`, `<!--kg-card-begin: html-->`, and
  `<!--kg-card-begin: paywall-->` are import/render control markers. They are
  consumed or stripped and are not preserved in API `post.html`.
- Members-only `email` / `email-cta` cards are dropped during import and
  stripped again during Markdown rendering. Their bodies are excluded before
  `post.html`, `plaintext`, generated excerpts, `feed_html`, and `feed_excerpt`
  are derived, because Nectar has no authenticated newsletter-only renderer.
  Paywall markers are converted into Nectar's static public/preview behaviour
  (`feed_html` plus configured visibility policy). Nectar does not emit Ghost's
  full member paywall split markup or server-side member access wrappers in
  `post.html`.
- Raw Ghost-compatible card scaffolds that survive sanitisation, such as
  `kg-signup-card`, `kg-recommendations-card`, or `kg-nft-card`, may pass
  through for theme/plugin hydration, but Nectar does not guarantee every
  Ghost-internal wrapper, comment, or runtime hook.

The practical impact is that consumers should target stable reader-facing
markup (`.kg-card` classes and documented child structures) rather than Ghost
editor comments or exact serializer byte output. Themes that only need card
layout CSS usually work; tooling that parses `kg-card-begin` comments,
reconstructs Lexical/Mobiledoc state from `post.html`, or expects Ghost's
member paywall DOM should read the original Ghost export during migration or
implement a Nectar-specific adapter.

An opt-in compatibility mode such as `[components.markdown] emit_kg_classes =
true` may be added later if a narrow Markdown block can be safely decorated
without changing existing output. It should not try to reimplement Ghost's full
serializer unless Nectar gains a first-class Lexical/Koenig render path.

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

Nectar renders static iframe embeds only for providers whose public embed URL
works without a per-page script loader. Every other known provider keeps the
source URL in the shortcode and renders a bookmark-style fallback link inside
`.kg-embed-card`, so a migrated post still points readers to the original
embed target instead of losing the card entirely.

| Provider | Migration target shape | Rendered output | Notes |
|----------|------------------------|-----------------|-------|
| YouTube | `{{< embed url="https://www.youtube.com/watch?v=..." provider="youtube" />}}` | `https://www.youtube-nocookie.com/embed/...` iframe | Uses YouTube's privacy-enhanced host, but loading the iframe still contacts YouTube/Google once the reader's browser requests it. |
| Vimeo | `{{< embed url="https://vimeo.com/..." provider="vimeo" />}}` | `https://player.vimeo.com/video/...` iframe | No vendor script is injected by Nectar. Vimeo may still process reader IP/user-agent data when the iframe loads. |
| Spotify | `{{< embed url="https://open.spotify.com/{type}/{id}" provider="spotify" />}}` | `https://open.spotify.com/embed/{type}/{id}` iframe | No vendor script is injected by Nectar. Spotify receives a third-party iframe request when loaded. |
| Twitter/X | `{{< embed url="https://twitter.com/.../status/..." provider="twitter" />}}` | Bookmark-style fallback link | Official rendering requires `widgets.js`. |
| Instagram | `{{< embed url="https://www.instagram.com/p/..." provider="instagram" />}}` | Bookmark-style fallback link | Import reads `data-instgrm-permalink` when Ghost exported it. |
| TikTok | `{{< embed url="https://www.tiktok.com/@.../video/..." provider="tiktok" />}}` | Bookmark-style fallback link | Official rendering requires TikTok's embed script. |
| CodePen | `{{< embed url="https://codepen.io/{user}/pen/{id}" provider="codepen" />}}` | Bookmark-style fallback link | Import unwraps `/embed/{id}` iframe URLs back to `/pen/{id}` where possible. |
| GitHub Gist | `{{< embed url="https://gist.github.com/{user}/{id}" provider="gist" />}}` | Bookmark-style fallback link | Import strips `.js` from script-only Gist embeds so the source page is retained. |
| Figma | `{{< embed url="https://www.figma.com/file/..." provider="figma" />}}` | Bookmark-style fallback link | Import unwraps Figma `/embed?url=...` iframe wrappers. |
| SoundCloud | `{{< embed url="https://soundcloud.com/... or https://api.soundcloud.com/tracks/..." provider="soundcloud" />}}` | Bookmark-style fallback link | Import reads the wrapped `url=` parameter from `w.soundcloud.com/player` iframe URLs. |
| Loom | `{{< embed url="https://www.loom.com/share/..." provider="loom" />}}` | Bookmark-style fallback link | No Loom player script is injected by Nectar. |
| Bandcamp | `{{< embed url="https://{artist}.bandcamp.com/..." provider="bandcamp" />}}` | Bookmark-style fallback link | Provider-specific player HTML is not reconstructed. |
| Apple Music | `{{< embed url="https://music.apple.com/..." provider="apple-music" />}}` | Bookmark-style fallback link | Provider-specific player HTML is not reconstructed. |
| Pinterest | `{{< embed url="https://www.pinterest.../pin/..." provider="pinterest" />}}` | Bookmark-style fallback link | Official rendering requires Pinterest's widget script. |
| Reddit | `{{< embed url="https://www.reddit.com/r/.../comments/..." provider="reddit" />}}` | Bookmark-style fallback link | Official rendering requires Reddit's embed script. |
| SlideShare | `{{< embed url="https://www.slideshare.net/..." provider="slideshare" />}}` | Bookmark-style fallback link | Provider-specific iframe HTML is not reconstructed. |
| Unknown provider | `{{< embed url="https://..." />}}` | Bookmark-style fallback link | The provider attribute is omitted, but the source URL is still retained. |

Twitter/X, Instagram, TikTok, CodePen, GitHub Gist, Figma, SoundCloud, Loom,
Bandcamp, Apple Music, Pinterest, Reddit, SlideShare, and other unsupported
embeds are intentionally not hydrated by default. Their official embeds require
third-party JavaScript or provider-specific iframe markup to transform a source
URL into the final widget. Injecting those scripts from post content would
create a larger privacy/GDPR surface: reader identifiers, IP addresses,
cookies, consent state, and cross-site tracking behaviour are controlled by
the provider rather than Nectar. For those providers, Nectar keeps a
`.kg-embed-card` fallback link and caption. Site operators who accept that
tradeoff can add the provider's script deliberately in their theme or plugin
and document the consent/cookie implications for their jurisdiction.

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
does not vendor Ghost's full upstream runtime in static output.

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

When a theme opts into `config.card_assets`, Nectar emits its own static
compatibility bundle and injects `/assets/ghost-card-assets.js` through
`{{ghost_foot}}` only on pages whose rendered body contains runtime-bearing
Koenig cards: audio, embed, signup, toggle, or video. That bundle is deliberately
small: it normalises native audio/video controls, preserves the toggle fallback
used by imported Ghost HTML, and adds safe static niceties such as lazy iframe
loading. Separately, pages that contain imported Twitter/X, Instagram, or TikTok
embed providers get the matching vendor script once in `{{ghost_foot}}`, even
when multiple cards from the same provider appear on the page. CodePen, Ghost
Portal, and other third-party vendor runtimes remain explicit theme/operator
choices.

### Koenig card class hooks

Casper-family themes target Koenig card wrapper classes directly. Nectar keeps
those hooks in `renderMarkdown` output rather than downgrading imported cards to
plain paragraphs or bare media tags.

The current Markdown renderer expands these Ghost-import shortcodes back to
theme-compatible HTML scaffolds:

Every first-class Koenig shortcode that renders a `kg-card` wrapper accepts
`width="regular|wide|full"` and emits
`kg-width-regular|kg-width-wide|kg-width-full`; omitted or unrecognised values
default to `regular`. `size` and `cardWidth` remain accepted as import
compatibility aliases for older generated Markdown. For media shortcodes that
also carry intrinsic dimensions (`figure`, `embed`, `video`), `width` is treated
as the layout modifier only when the value is `regular`, `wide`, `full`, or an
equivalent `kg-width-*` token; numeric values continue to render as media
dimensions, so imported content can still combine `width="1600"` with
`size="wide"`.

Themes such as Source place post bodies inside `gh-content gh-canvas` and rely
on those Koenig width classes to place media on the `main`, `wide`, or `full`
grid tracks.

The body wrapper is a hard compatibility requirement for Source and
Casper-family spacing: post/page templates must keep rendered content inside
one wrapper with both classes, for example
`<section class="gh-content gh-canvas">{{content}}</section>`. Koenig cards
must remain direct children of that wrapper (`.gh-content.gh-canvas > .kg-card`)
so Source/Casper grid selectors can span regular, wide, and full-width cards
correctly. Nectar's renderer deliberately emits the card scaffolds only; it
does not wrap every card in an extra layout container or rewrite arbitrary theme
templates to add `gh-content` / `gh-canvas`.

| Shortcode/input | Rendered wrapper contract |
|-----------------|---------------------------|
| `{{< figure />}}` | `<figure class="kg-card kg-image-card kg-width-*">` with a `.kg-image` image, optional wrapping link, and caption. |
| `{{< bookmark />}}` | `<figure class="kg-card kg-bookmark-card kg-width-*">` with the exact `.kg-bookmark-container` child structure documented below. |
| `{{< embed />}}` | `<figure class="kg-card kg-embed-card kg-width-*">` with a static supported-provider iframe or fallback link. |
| `{{< gallery >}}` | `<figure class="kg-card kg-gallery-card kg-width-*">` with `.kg-gallery-container`, `.kg-gallery-row`, and `.kg-gallery-image`. |
| `{{< callout >}}` | `<div class="kg-card kg-callout-card kg-width-* ...">` with `.kg-callout-emoji` and `.kg-callout-text`. |
| `{{< button >}}` | `<div class="kg-card kg-button-card kg-width-* ...">` with an `.kg-btn` anchor. |
| `{{< toggle >}}` | `<details class="kg-card kg-toggle-card kg-width-*">` plus native `<summary>` behaviour. |
| `{{< file />}}` | `<div class="kg-card kg-file-card kg-width-*">` with a `download` `.kg-file-card-container`, `.kg-file-card-contents`, `.kg-file-card-metadata`, and `.kg-file-card-icon`. |
| `{{< audio />}}` | `<div class="kg-card kg-audio-card kg-width-*">` with an `<audio controls>` element and metadata rows. |
| `{{< video />}}` | `<figure class="kg-card kg-video-card kg-width-*">` with `.kg-video-container`, `<video>`, optional `<track>`, caption, and sanitized `--aspect-ratio`. |
| `{{< product />}}` | `<div class="kg-card kg-product-card kg-width-*">` with image, title, description, optional rating, and CTA scaffold. |
| `{% header %}` | `<div class="kg-card kg-header-card ...">` with optional `kg-style-*`, `kg-size-*`, background image metadata, heading/subheading, and CTA anchor. |

Imported Ghost code cards may arrive as a plain fenced code block or as the
Ghost wrapper when caption/editor metadata needs to survive:

```html
<figure class="kg-card kg-code-card kg-card-hascaption kg-code-card-with-line-numbers">
  <pre><code class="language-js">console.log("hello");</code></pre>
  <figcaption>Runnable example</figcaption>
</figure>
```

Source and Nectar's shared card CSS style `.kg-code-card`, the nested `pre`,
`figcaption`, and `.kg-code-card-with-line-numbers pre`. Nectar does not
generate line-number markers by itself; the line-number selector is a stable
gutter contract for imported markup or plugins that preserve those markers.

Bookmark cards intentionally pin Ghost's Source/Casper DOM contract. The outer
element is always a `figure.kg-card.kg-bookmark-card` plus the resolved
`kg-width-*` layout class; the clickable child is the single
`a.kg-bookmark-container`; title, description, metadata, and thumbnail nodes
stay under Ghost's `kg-bookmark-*` class names so theme CSS can target them
without custom selectors:

```html
<figure class="kg-card kg-bookmark-card kg-width-regular">
  <a class="kg-bookmark-container" href="https://example.com/post">
    <div class="kg-bookmark-content">
      <div class="kg-bookmark-title">Bookmark Title</div>
      <div class="kg-bookmark-description">A short summary.</div>
      <div class="kg-bookmark-metadata">
        <img class="kg-bookmark-icon" src="https://example.com/icon.png" alt="">
        <span class="kg-bookmark-author">Jane Doe</span>
        <span class="kg-bookmark-publisher">Example</span>
      </div>
    </div>
    <div class="kg-bookmark-thumbnail">
      <img src="https://example.com/thumb.jpg" alt="">
    </div>
  </a>
</figure>
```

Nectar does not inject Ghost Admin or shared-theme-assets JavaScript for
bookmark link tracking. A theme or analytics plugin that needs click tracking
must attach its own listener to `.kg-bookmark-container`; Nectar only guarantees
the static DOM and class contract above.

Raw Ghost-compatible HTML scaffolds for `kg-nft-card` and `kg-signup-card` are
preserved through sanitisation so theme CSS hooks and optional hydration code
can still target them. Nectar does not currently build those cards from
first-class Markdown shortcodes: NFT cards keep their static link/image/metadata
scaffold without blockchain runtime integration, and signup cards keep the
`kg-signup-card` wrapper while form fields are normalized for build-time portal
or members adapters.

When `config.card_assets` is enabled, Nectar also emits a static signup-card
stylesheet for themes that do not vendor Ghost Source's signup CSS. The CSS
targets Ghost's public DOM contract:

```html
<div class="kg-card kg-signup-card kg-width-wide kg-style-light kg-signup-card-image-left">
  <img class="kg-signup-card-image" src="/content/images/signup.jpg" alt="">
  <div class="kg-signup-card-content">
    <h2 class="kg-signup-card-heading">Join the newsletter</h2>
    <p class="kg-signup-card-subheading">One short digest per week.</p>
    <form class="kg-signup-card-form" data-members-form="signup">
      <div class="kg-signup-card-fields">
        <input class="kg-signup-card-input" type="email" data-members-email>
      </div>
      <button class="kg-signup-card-button" type="submit">Subscribe</button>
    </form>
    <p class="kg-signup-card-disclaimer">No spam. Unsubscribe anytime.</p>
  </div>
</div>
```

The shared CSS supports `kg-signup-card-image-top`,
`kg-signup-card-image-bottom`, and `kg-signup-card-image-left`, includes a
mobile column fallback for the left-image layout, keeps
`.kg-signup-card-disclaimer` visually secondary, and skins
`.kg-signup-card-input` / `.kg-signup-card-button` with the Ghost accent color
contract. It is deliberately static: form submission still depends on the
configured portal or members adapter, not on a bundled Ghost backend.

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

SRI applies only to fetched subresources. Inline `<script>` blocks from
`{{ghost_head}}`, theme layouts, or code injection are instead covered by CSP:
when `[deploy.headers].security.content_security_policy` is configured, Nectar
hashes the final inline script bodies and appends `sha256-...` sources to
`script-src` in generated deploy artifacts.

## Things Ghost themes do that we explicitly do *not* handle

- Members context (`@member.*`) — undefined; templates that read it get
  empty values via the proxy default.
- Ghost Admin's live member analytics dashboard (`/ghost/#/dashboard`) —
  not implemented in static output. Use your ESP or hosted newsletter
  provider dashboard instead; see
  [`MEMBERS.md` § 5](./MEMBERS.md#5-member-analytics-and-dashboards).
- Runtime subscribe / Portal error context (`error.message`) — only Ghost's
  live runtime populates this after failed POSTs. Nectar leaves `error` unset
  on normal static routes, so those snippets render empty.
- The Ghost Content API (`{{#get}}` against remote endpoints) — we resolve
  against the local content graph only. Browser clients can fetch the emitted
  `/content/*` JSON cross-origin when the host applies Nectar's generated
  `_headers` or the self-hosted CORS snippets for
  [`nginx`](./deploy/cors-nginx.md), [`Apache`](./deploy/cors-apache.md), or
  [`Caddy`](./deploy/cors-caddy.md).
- Mobiledoc / Lexical card-level customization — content comes pre-rendered
  as HTML by the Markdown pipeline; we don't emit card markup.
- Ghost-only HTML transforms (responsive image srcsets via Ghost's image
  service) — pass-through; users can plug an optional `[components.images]`
  later.
- Ghost's `/search/` endpoint and bundled `sodo-search` runtime — Nectar
  does not replicate the live `/content/search/` API shape or vendor Ghost's
  Sodo Search bundle. The `[components.search]` component instead emits a flat
  `content/search.json` ({ `posts`, `pages`, `tags`, `authors` }) and injects a
  static modal shim for Ghost-style `[data-ghost-search]` buttons on JSON
  engines. It can also shell out to Pagefind (`engine = "pagefind"` /
  `"json+pagefind"`) and route the same buttons to Pagefind UI, or use the
  pre-built Lunr index (`engine = "lunr"`) for the same modal. If you opt into
  `engine = "sodo-search"`, pin or self-host the configured external script.
  Themes that hard-code the `/search/` POST shape need to be re-wired to one of
  these consumers.
- Ghost's `shared-theme-assets` runtime — not bundled by Nectar. Theme
  controls such as Ease's `<button class="gh-loadmore">` require the theme to
  vendor and load the matching infinite-scroll JavaScript; otherwise they
  remain static markup.
- Ghost Admin's integrations directory (`/ghost/api/integrations`, including
  Zapier, Slack, and similar app listings) — out of scope. Nectar has no Admin
  UI, no Admin API, and no server runtime to own integration installation or
  webhook delivery. External automation should live in build hooks, CI, or the
  deploy provider's integration/webhook settings around `nectar build`.
