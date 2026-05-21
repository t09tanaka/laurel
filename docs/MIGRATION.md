# Migration

Nectar's supported Ghost migration path is one-way:

1. Export content from Ghost Admin.
2. Run `nectar import-ghost`.
3. Review the generated Markdown and `nectar.toml`.
4. Build and deploy the static site.

Nectar does not write back to Ghost and does not replace Ghost Admin. Treat the
import as a content conversion step from a Ghost export into files that live in
Git.

For the full walkthrough, use [`docs/migration/ghost.md`](./migration/ghost.md).

## Ghost Admin export to Markdown

From Ghost Admin, open **Settings -> Labs -> Export your content** and download
the JSON export. That JSON contains posts, pages, tags, authors, and many
Ghost-side records. It does not include uploaded media files.

Export or copy the Ghost `content/` media directories separately. The importer
looks for these subdirectories:

- `images/`
- `files/`
- `media/`

Run the importer from the root of a Nectar project:

```bash
nectar import-ghost ./your-site.ghost.2026-05-20.json --assets ./ghost-content
```

You can also pass an unzipped Ghost export directory or the export ZIP itself:

```bash
nectar import-ghost ./ghost-export/
nectar import-ghost ./ghost-export.zip
```

Useful review-first options:

```bash
nectar import-ghost ./ghost-export.zip --dry-run
nectar import-ghost ./ghost-export.zip --output ./review-import
nectar import-ghost ./ghost-export.zip --on-conflict rename
```

See [`docs/cli.md`](./cli.md#nectar-import-ghost) for every flag.

## Hugo / Jekyll Markdown posts

`nectar import-hugo <dir>` and `nectar import-jekyll <dir>` provide a
conservative first-pass import for Markdown posts. They are intended for review
imports into a Nectar project, not a full static-site migration.

```bash
nectar import-hugo ../old-hugo-site --dry-run
nectar import-hugo ../old-hugo-site --on-conflict rename
nectar import-jekyll ../old-jekyll-site --dry-run
nectar import-jekyll ../old-jekyll-site
```

The Hugo importer scans `content/posts/`, `content/post/`, `content/blog/`, then
`content/`. The Jekyll importer scans `_posts/`. Both import Markdown files into
`content/posts/<slug>.md`, preserve the body, and remap common frontmatter:

| Source frontmatter | Nectar output |
| --- | --- |
| `categories` | Merged into `tags` as slug-normalized values |
| `aliases` | Appended to root `redirects.yaml` as 301 redirects to `/<slug>/` |
| `draft: true` | `status: draft` |
| Jekyll `YYYY-MM-DD-slug.md` filename | `slug` plus `date` when frontmatter omits them |

This first slice supports YAML frontmatter and Hugo TOML `+++` frontmatter. It
does not convert layouts, shortcodes, theme templates, site config, data files,
asset pipelines, or custom collections. Review the generated Markdown and
`redirects.yaml` before publishing.

## Imported automatically

`src/ghost/import.ts` currently imports these Ghost export records and assets:

| Ghost export data | Nectar output |
| --- | --- |
| Posts | `content/posts/<slug>.md` with Markdown body and frontmatter |
| Pages | `content/pages/<slug>.md` with Markdown body and frontmatter |
| Tags with metadata | `content/tags/<slug>.md` |
| Authors | `content/authors/<slug>.md` |
| Post-tag and post-author joins | `tags: [...]` and `authors: [...]` frontmatter |
| Tiers attached to posts | `tiers: [...]` frontmatter for posts |
| Feature, Open Graph, Twitter, profile, and cover image fields | Frontmatter image fields, sanitized to http(s) or relative paths |
| `images/`, `files/`, `media/` from `--assets` | Copied under the target content directory |
| Remote images with `--download-images` | Downloaded into `content/images/` and references rewritten |
| Ghost `content/data/redirects.json` | Reviewable redirect snippets under `migration/redirects/` |

Posts with `status: published` and `status: draft` are imported. Other statuses
such as `scheduled` are filtered out. Drafts remain drafts in frontmatter, so a
normal `nectar build` still excludes them unless you opt into draft builds.

## Manual after import

Ghost settings are not converted into `nectar.toml`. After import, copy the
settings that matter to your static site into the Nectar config:

- `[site]` title, description, URL, logo, icon, cover image, locale, timezone,
  and accent color.
- `[[navigation]]` and `[[secondary_navigation]]`.
- Theme custom settings under `[theme.custom]`.
- Optional components such as RSS, sitemap, search, comments, analytics,
  Portal/newsletter wiring, and deployment settings.

The Ghost theme itself is also a separate step. Put the theme under `themes/`
and point `[theme].path` at it, or start from the bundled Source example.

## Not imported

These Ghost features either require a server runtime or do not have a stable
Markdown/frontmatter representation in Nectar:

- Members, subscribers, member labels, customer records, sessions, comped
  subscriptions, and Stripe billing state.
- Custom integrations from Ghost Admin, including Zapier, Slack, webhooks, and
  Admin API credentials.
- Snippets and editor-only reusable content records.
- Custom fields or plugin-owned tables that are not represented in Nectar
  frontmatter.
- Ghost Admin users' permissions, roles, staff invites, and authentication
  settings.
- Ghost settings as an automatic config migration. Move the values you need to
  `nectar.toml` manually.
- Newsletter sending state, email-only delivery settings, and per-recipient
  email analytics.
- Server-side paywall decisions. `visibility` and `tiers` are preserved as
  frontmatter, but a static build cannot decide who is signed in or paid.
- Site-wide code injection. Post-level `codeinjection_head` and
  `codeinjection_foot` are also skipped by default unless you pass
  `--keep-code-injection` and trust the source export.

For member and Portal migration choices, read [`docs/MEMBERS.md`](./MEMBERS.md).
