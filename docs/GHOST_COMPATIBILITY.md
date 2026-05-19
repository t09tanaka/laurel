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

## Things Ghost themes do that we explicitly do *not* handle

- Members context (`@member.*`) — undefined; templates that read it get
  empty values via the proxy default.
- The Ghost Content API (`{{#get}}` against remote endpoints) — we resolve
  against the local content graph only.
- Mobiledoc / Lexical card-level customization — content comes pre-rendered
  as HTML by the Markdown pipeline; we don't emit card markup.
- Ghost-only HTML transforms (responsive image srcsets via Ghost's image
  service) — pass-through; users can plug an optional `[components.images]`
  later.
