# Content API stability

Nectar's emitted Content API JSON follows **semver** at the field level. This
document is the contract between Nectar and downstream consumers (themes,
widgets, custom scripts, server-side rewriters) that read `/content/*.json`
or `/ghost/api/content/*.json`.

## What is covered

The shape of every JSON payload emitted by `nectar build` under
`/content/*` and `/ghost/api/content/*`. Specifically:

- Field names on `posts[]`, `pages[]`, `tags[]`, `authors[]`, and
  `settings`.
- The `meta.pagination` envelope (`page`, `limit`, `pages`, `total`,
  `next`, `prev`).
- Per-resource shard paths (`posts/page/<n>.json`,
  `posts/slug/<slug>.json`, `posts/<id>.json`, `posts/tag/<slug>.json`,
  and the matching `pages/*` paths).
- The `access` field always being `'public'` in public JSON.
- The `meta.pagination.next` / `meta.pagination.prev` semantics (numbers
  when navigable, `null` at the boundary; never URLs).

## What is **not** covered

- The HTML *content* inside `posts[].html` — that depends on the
  Markdown renderer and theme assets and may change between releases.
- File ordering inside a collection — order is documented in the
  build pipeline but the JSON contract treats it as best-effort.
- The `_headers` / `_headers.cf` / `_redirects` payload layout — these
  are platform-tuned artifacts and may evolve (e.g. cache TTLs).
- Endpoints under `/ghost/api/admin/*` — there is no Admin API; see
  [api.md](./api.md).
- Resources Nectar does not implement (members, newsletters, webhooks,
  Stripe, etc.) — they are out of scope and adding stubs is not
  guaranteed to keep their shape stable.

## Versioning rules

- **Major (`x.0.0`)**: any removal or rename of a documented field, any
  removal of a documented shard path, or any change to the
  `meta.pagination` semantics.
- **Minor (`0.x.0`)**: a new optional field, a new shard path, or a new
  optional resource. Existing consumers MUST keep working.
- **Patch (`0.0.x`)**: bug fixes that align the emitted JSON with the
  documented contract (e.g. a missing `count` on `authors[]` getting
  added if previously absent). No new fields.

## Field stability matrix

### `posts[]` and `pages[]`

| Field                  | Stability      | Notes                                            |
| ---------------------- | -------------- | ------------------------------------------------ |
| `id`, `uuid`           | stable         | Currently `uuid === id`                          |
| `slug`                 | stable         |                                                  |
| `title`                | stable         |                                                  |
| `html`                 | content-only   | Field name stable; rendered HTML is not          |
| `plaintext`, `excerpt` | stable         | Stripped to `""` for non-public visibility       |
| `feature_image`*       | stable         | `null` when absent                               |
| `published_at`         | stable         | ISO-8601 UTC                                     |
| `updated_at`           | stable         | ISO-8601 UTC                                     |
| `created_at`           | stable         | ISO-8601 UTC                                     |
| `reading_time`         | stable         | Integer minutes                                  |
| `visibility`           | stable         | `'public'`, `'members'`, `'paid'`, `'tiers'`, `'filter'` |
| `access`               | stable         | Always `'public'` in public JSON                 |
| `tags[]`               | stable         |                                                  |
| `primary_tag`          | stable         | `null` when no tags                              |
| `authors[]`            | stable         |                                                  |
| `primary_author`       | stable         | `null` when no authors                           |
| `url`                  | stable         | Absolute when `[site].url` is configured         |
| `meta_title`, …        | stable         | `null` when absent                               |
| `comments`             | stable (`posts` only) |                                           |

### `tags[]`

| Field           | Stability | Notes                          |
| --------------- | --------- | ------------------------------ |
| `id`, `slug`    | stable    |                                |
| `name`          | stable    |                                |
| `description`   | stable    |                                |
| `visibility`    | stable    | `'public'` or `'internal'`     |
| `url`           | stable    | Includes `/tag/<slug>/`        |
| `count.posts`   | stable    |                                |

### `authors[]`

| Field           | Stability | Notes                                |
| --------------- | --------- | ------------------------------------ |
| `id`, `slug`    | stable    |                                      |
| `name`, `bio`   | stable    |                                      |
| `profile_image`, `cover_image` | stable | `null` when absent             |
| `website`, `location`          | stable | `null` when absent             |
| `twitter`, `facebook`          | stable | `null` when absent             |
| `url`           | stable    | `[site].url` + `[build].base_path` + `/author/<slug>/` |
| `count.posts`   | stable    | Excludes drafts and scheduled posts  |

### `meta.pagination`

| Field   | Stability | Notes                                  |
| ------- | --------- | -------------------------------------- |
| `page`  | stable    | 1-based                                |
| `limit` | stable    | Number or `'all'`                      |
| `pages` | stable    | `max(1, ceil(total / limit))`          |
| `total` | stable    | Across all pages                       |
| `next`  | stable    | Number when navigable, `null` otherwise|
| `prev`  | stable    | Number when navigable, `null` otherwise|

## What changes between Nectar versions

Each release of Nectar that touches the Content API surface MUST:

1. Note any added field in the changelog.
2. Note any deprecated field at least one minor release before removal.
3. Bump the major version on any removal or rename.

When in doubt about whether a change is breaking, treat it as breaking.
The Content API is read by widgets and scripts that we cannot upgrade in
lockstep, so the bar for breaking changes is high.
