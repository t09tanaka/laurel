# Ghost compatibility notes

Living document. Every time a Ghost helper or context field is implemented or
deliberately scoped out, record it here.

For a practical, signature-level reference of every helper and context with
worked examples, see [`THEME_DEV.md`](./THEME_DEV.md). This document tracks
status and edge cases as we discover them.

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

### `@custom`
Built from the theme's `package.json` `config.custom.*` defaults, with
overrides applied from `nectar.toml [theme.custom]`.

### `post` / `page` / `tag` / `author`
The exposed fields are exactly the keys on `Post`/`Page`/`Tag`/`Author` model
types defined in `src/content/model.ts`. Keep that as the source of truth.

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
