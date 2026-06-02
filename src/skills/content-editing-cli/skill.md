---
name: nectar-content-editing-cli
description: Use when editing a Nectar site directly from the CLI and filesystem instead of the dashboard GUI. Covers scaffolding with `nectar new`, editing Markdown files in place, inspecting content with `nectar content`, the `nectar dev` preview loop, and validating with `nectar lint` / `nectar fmt` / `nectar build`. For the YAML frontmatter field reference itself, defer to nectar-frontmatter-authoring.
version: 1
applies_to:
  - claude
  - codex
triggers:
  - edit content from the CLI
  - nectar new post
  - scaffold a post
  - add a post from the terminal
  - list content
  - nectar content list
  - lint content
  - format frontmatter
  - preview the site locally
  - edit markdown directly
---

# Editing Nectar content from the CLI

Nectar has no admin UI requirement: the dashboard (`nectar dashboard`) is optional, and the source of truth is always Markdown files under `content/`. This skill covers the CLI / filesystem workflow — scaffolding, editing, inspecting, and validating content without the GUI. For the exact frontmatter fields and their meaning, see the `nectar-frontmatter-authoring` skill; this skill is about the *workflow*, not the field reference.

## Where content lives

```
content/
├── posts/<slug>.md      # blog posts      → /<slug>/
├── pages/<slug>.md      # static pages     → /<slug>/
├── authors/<slug>.md    # author records   → /author/<slug>/
├── tags/<slug>.md       # tag records      → /tag/<slug>/
└── images/              # local assets referenced from frontmatter/body
```

Editing is just reading and writing these `.md` files. There is no database and no sync step — `nectar build` (or a running `nectar dev`) reads the files fresh every time.

## Scaffold instead of hand-writing frontmatter

Prefer `nectar new` over typing frontmatter from memory — it emits the correct shape, a valid slug, and a timestamp, so the file passes `nectar build` on the first try.

```sh
nectar new post "Hello World"                 # → content/posts/hello-world.md
nectar new post "Draft Idea" --draft          # status: draft (excluded from prod builds)
nectar new post "Tagged" --tags news,tech --author jane
nectar new post "日本語タイトル" --slug custom-slug   # override the derived slug
nectar new page "About"                       # → content/pages/about.md
nectar new tag releases                       # → content/tags/releases.md  (positional IS the slug)
nectar new author jane                        # → content/authors/jane.md
cat draft.md | nectar new post --stdin        # derive title/body from Markdown on stdin
```

Slugs must match `/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/`. For `tag`/`author` the positional argument is already the slug; for `post`/`page`/custom kinds the slug is derived from the title unless `--slug` is given. Use `--force` only to intentionally overwrite an existing file.

After scaffolding, open the file in your editor and write the body below the frontmatter. Do **not** start the body with a top-level `# Heading` — Ghost themes render the H1 from `title:`, so a body H1 produces a duplicate heading.

## Inspect what exists

```sh
nectar content list                           # posts + pages with status/date
nectar content list --kind pages              # only pages
nectar content list --tag changelog --json    # machine-readable, filtered by tag
nectar content show hello-world               # render a single item's frontmatter + body
nectar content show about --kind pages --frontmatter   # frontmatter only
```

`nectar content list` is the fastest way to confirm a new file was picked up, see its resolved slug, and check draft/published status before building. Use it instead of `ls` when you need status and date, not just filenames.

## Rename, move, retire

```sh
nectar content rename old-slug new-slug --redirect   # rename + leave a redirect so old URLs survive
nectar content delete old-slug                       # remove a post/page
nectar content touch hello-world --date 2026-01-02T03:04:05Z   # rewrites updated_at (the "last edited" stamp), NOT the publish date
```

`content touch --date` only moves `updated_at`. A post's **publish** date is its `date:` frontmatter field (Nectar's alias for `published_at`); to re-date when a post is published, edit `date:` directly. (`content touch --published-at <iso>` sets the `published_at` key, but when `date:` is present the loader resolves the publish date as `date ?? published_at`, so `date:` wins — editing `date:` is the reliable path.)

`tags rename` and `authors rename` exist as separate commands and cascade the rename into every post's frontmatter — prefer them over a manual find-and-replace across `content/`.

## Preview while editing

```sh
nectar dev          # build once, watch content/theme/config, live-reload at http://localhost:4321/
```

`nectar dev` does a normal build, so by default it excludes drafts and future/scheduled posts — same content as `nectar build`. To preview drafts, run `nectar build --include-drafts` (or set `NECTAR_DRAFTS=1`); to preview scheduled / future-dated posts, set `[build] include_future_posts = true` in `nectar.toml`. Leave `nectar dev` running in one terminal and edit Markdown in another; saves trigger an incremental rebuild and a browser reload.

## Validate before committing

```sh
nectar lint                                   # warn-level table (titles, alt text, broken local links, future dates, dup slugs); checks all content, takes no file-path argument
nectar lint --strict                          # exit non-zero on any warning (use in CI / pre-commit)
nectar fmt                                    # normalise frontmatter formatting in place
nectar fmt --check                            # CI check: exit 1 when a rewrite is needed, write nothing
nectar build                                  # full build; fails loudly on any error the loader rejects
```

A good local loop before committing content changes: `nectar fmt` → `nectar lint --strict` → `nectar build`. `nectar build` is the ground truth — if it exits 0, the content is structurally valid. If a build fails, switch to the `nectar-build-troubleshoot` skill for the diagnosis recipes.

## Common mistakes this workflow avoids

- Hand-writing frontmatter and getting the slug or date format wrong → use `nectar new`.
- Editing a file and assuming a running `nectar dashboard` will see it — the dashboard and CLI both read the same files, but a prod `nectar build`/`serve` only reflects changes after a rebuild.
- Find-and-replacing a tag/author slug across `content/` by hand → use `nectar tags rename` / `nectar authors rename` so post frontmatter stays consistent.
- Committing without running `nectar build` → broken references (missing tag/author files, bad links) surface at build time, not in the editor.
