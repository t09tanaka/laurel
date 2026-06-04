---
name: laurel-writing
description: Use when writing or editing Laurel content directly from the CLI and filesystem instead of the dashboard GUI. Covers scaffolding with `laurel new`, editing Markdown files in place, inspecting content with `laurel content`, the `laurel dev` preview loop, and validating with `laurel lint` / `laurel fmt` / `laurel build`. For the YAML frontmatter field reference itself, defer to laurel-frontmatter-authoring.
version: 1
applies_to:
  - claude
  - codex
triggers:
  - edit content from the CLI
  - laurel new post
  - scaffold a post
  - add a post from the terminal
  - list content
  - laurel content list
  - lint content
  - format frontmatter
  - preview the site locally
  - edit markdown directly
---

# Editing Laurel content from the CLI

Laurel has no admin UI requirement: the dashboard (`laurel dashboard`) is optional, and the source of truth is always Markdown files under `content/`. This skill covers the CLI / filesystem workflow — scaffolding, editing, inspecting, and validating content without the GUI. For the exact frontmatter fields and their meaning, see the `laurel-frontmatter-authoring` skill; this skill is about the *workflow*, not the field reference.

## Where content lives

```
content/
├── posts/<slug>.md      # blog posts      → /<slug>/
├── pages/<slug>.md      # static pages     → /<slug>/
├── authors/<slug>.md    # author records   → /author/<slug>/
├── tags/<slug>.md       # tag records      → /tag/<slug>/
└── images/              # local assets referenced from frontmatter/body
```

Editing is just reading and writing these `.md` files. There is no database and no sync step — `laurel build` (or a running `laurel dev`) reads the files fresh every time.

## Scaffold instead of hand-writing frontmatter

Prefer `laurel new` over typing frontmatter from memory — it emits the correct shape, a valid slug, and a timestamp, so the file passes `laurel build` on the first try.

```sh
laurel new post "Hello World"                 # → content/posts/hello-world.md
laurel new post "Draft Idea" --draft          # status: draft (excluded from prod builds)
laurel new post "Tagged" --tags news,tech --author jane
laurel new post "日本語タイトル" --slug custom-slug   # override the derived slug
laurel new page "About"                       # → content/pages/about.md
laurel new tag releases                       # → content/tags/releases.md  (positional IS the slug)
laurel new author jane                        # → content/authors/jane.md
cat draft.md | laurel new post --stdin        # derive title/body from Markdown on stdin
```

Slugs must match `/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/`. For `tag`/`author` the positional argument is already the slug; for `post`/`page`/custom kinds the slug is derived from the title unless `--slug` is given. Use `--force` only to intentionally overwrite an existing file.

After scaffolding, open the file in your editor and write the body below the frontmatter. Do **not** start the body with a top-level `# Heading` — Ghost themes render the H1 from `title:`, so a body H1 produces a duplicate heading.

## Inspect what exists

```sh
laurel content list                           # posts + pages with status/date
laurel content list --kind pages              # only pages
laurel content list --tag changelog --json    # machine-readable, filtered by tag
laurel content show hello-world               # render a single item's frontmatter + body
laurel content show about --kind pages --frontmatter   # frontmatter only
```

`laurel content list` is the fastest way to confirm a new file was picked up, see its resolved slug, and check draft/published status before building. Use it instead of `ls` when you need status and date, not just filenames.

## Rename, move, retire

```sh
laurel content rename old-slug new-slug --redirect   # rename + leave a redirect so old URLs survive
laurel content delete old-slug                       # remove a post/page
laurel content touch hello-world --date 2026-01-02T03:04:05Z   # rewrites updated_at (the "last edited" stamp), NOT the publish date
```

`content touch --date` only moves `updated_at`. A post's **publish** date is its `date:` frontmatter field (Laurel's alias for `published_at`); to re-date when a post is published, edit `date:` directly. (`content touch --published-at <iso>` sets the `published_at` key, but when `date:` is present the loader resolves the publish date as `date ?? published_at`, so `date:` wins — editing `date:` is the reliable path.)

`tags rename` and `authors rename` exist as separate commands and cascade the rename into every post's frontmatter — prefer them over a manual find-and-replace across `content/`.

## Preview while editing

```sh
laurel dev          # build once, watch content/theme/config, live-reload at http://localhost:4321/
```

`laurel dev` does a normal build, so by default it excludes drafts and future/scheduled posts — same content as `laurel build`. To preview drafts, run `laurel build --include-drafts` (or set `LAUREL_DRAFTS=1`); to preview scheduled / future-dated posts, set `[build] include_future_posts = true` in `laurel.toml`. Leave `laurel dev` running in one terminal and edit Markdown in another; saves trigger an incremental rebuild and a browser reload.

## Validate before committing

```sh
laurel lint                                   # warn-level table (titles, alt text, broken local links, future dates, dup slugs); checks all content, takes no file-path argument
laurel lint --strict                          # exit non-zero on any warning (use in CI / pre-commit)
laurel fmt                                    # normalise frontmatter formatting in place
laurel fmt --check                            # CI check: exit 1 when a rewrite is needed, write nothing
laurel build                                  # full build; fails loudly on any error the loader rejects
```

A good local loop before committing content changes: `laurel fmt` → `laurel lint --strict` → `laurel build`. `laurel build` is the ground truth — if it exits 0, the content is structurally valid. If a build fails, switch to the `laurel-build-troubleshoot` skill for the diagnosis recipes.

## Common mistakes this workflow avoids

- Hand-writing frontmatter and getting the slug or date format wrong → use `laurel new`.
- Editing a file and assuming a running `laurel dashboard` will see it — the dashboard and CLI both read the same files, but a prod `laurel build`/`serve` only reflects changes after a rebuild.
- Find-and-replacing a tag/author slug across `content/` by hand → use `laurel tags rename` / `laurel authors rename` so post frontmatter stays consistent.
- Committing without running `laurel build` → broken references (missing tag/author files, bad links) surface at build time, not in the editor.
