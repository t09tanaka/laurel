---
name: laurel-migration
description: Use when importing an existing site into Laurel from Ghost, WordPress, Hugo, or Jekyll. Covers `laurel import-ghost` (Ghost JSON/zip export), `laurel import-wordpress` (WXR XML), `laurel import-hugo`, and `laurel import-jekyll`, the dry-run-first workflow, image and asset handling, conflict policies, and validating the result. For the frontmatter fields an import produces, defer to laurel-frontmatter-authoring; for editing imported content afterward, laurel-writing.
version: 1
applies_to:
  - claude
  - codex
triggers:
  - import from Ghost
  - import-ghost
  - migrate from WordPress
  - import-wordpress
  - migrate a Hugo site
  - import-hugo
  - migrate a Jekyll site
  - import-jekyll
  - import a Ghost JSON export
  - convert a WordPress export to Markdown
---

# Migrating an existing site into Laurel

Laurel ingests an existing blog from four sources and writes Markdown + assets
into `content/`, the same source-of-truth layout `laurel build` reads. Each
importer is one command; the source of truth after import is the Markdown, so
re-running an importer is how you redo a migration, not an incremental sync.

## What each importer takes

| Command | Input | Notes |
|---|---|---|
| `laurel import-ghost <file>` | Ghost JSON export, `.zip`, an export folder, or `-` for stdin | Richest: filters, image download, draft/page inclusion |
| `laurel import-wordpress <file.xml>` | WordPress WXR XML export | |
| `laurel import-hugo <dir>` | A Hugo site directory | Reads its `content/` Markdown |
| `laurel import-jekyll <dir>` | A Jekyll site directory | Reads `_posts/` Markdown |

All four write into `content/` by default (`content/posts/`, `content/pages/`,
`content/authors/`, `content/tags/`). Pass `--output <dir>` to write to a
review directory instead of the live `content/` tree.

## Always dry-run first

Every importer supports `--dry-run`: it parses the source and prints a summary
of what *would* be written (counts, slugs, conflicts) without touching disk.

```sh
laurel import-ghost ghost-export.json --dry-run
laurel import-wordpress wordpress.xml --dry-run
laurel import-hugo ../old-hugo-site --dry-run
laurel import-jekyll ../old-jekyll-site --dry-run
```

Run the dry-run, read the summary, then run again without `--dry-run` to commit
the files. Use `--json` on either pass for a machine-readable summary.

## Conflict handling

When a target file already exists, choose the policy explicitly:

```sh
laurel import-wordpress wordpress.xml --on-conflict skip       # leave existing files (default-safe)
laurel import-wordpress wordpress.xml --on-conflict rename     # write alongside with a suffixed slug
laurel import-wordpress wordpress.xml --on-conflict overwrite  # replace existing files
```

`--on-conflict` is shared by all four importers. Prefer `--output review-import`
into a fresh directory for a first pass so you never clobber existing content,
then diff and move files in deliberately.

## Ghost import: the richer options

`import-ghost` is the most capable because Ghost exports carry drafts, pages,
tags, and remote image URLs:

```sh
laurel import-ghost export.json --include-drafts --include-pages   # drafts + pages are excluded unless asked
laurel import-ghost export.json --only-tags news,blog --since 2024-01-01   # filter what comes in
laurel import-ghost export.json --download-images --max-image-size 5MB     # pull remote images local
laurel import-ghost export.json --source-url https://old.example.com       # resolve relative asset URLs
laurel import-ghost export.json --keep-html --keep-code-injection          # preserve raw HTML / injected code
laurel import-ghost ghost-export.zip                                       # zip archive (auto-detected)
laurel import-ghost ghost-export-folder                                    # all export*.json in stable order
```

Without `--include-drafts` / `--include-pages`, drafts and pages are left out.
`--download-images` rewrites remote image URLs to local `content/images/` paths;
pair it with `--source-url` when the export stores site-relative URLs.

## After importing: validate

The importer produces frontmatter the build expects, but always confirm:

```sh
laurel content list          # confirm posts/pages were picked up with sane slugs/dates
laurel content list --draft  # include imported drafts (content list hides them by default)
laurel lint                  # title length, alt text, broken local links, future dates, dup slugs
laurel build                 # ground truth — exits 0 only if the content is structurally valid
```

If `laurel build` fails after an import, switch to the `laurel-build-troubleshoot`
skill. To edit or re-slug imported content, use `laurel-writing`; for
the frontmatter field meanings, `laurel-frontmatter-authoring`.

## Common mistakes this workflow avoids

- Importing straight into a populated `content/` and clobbering work → dry-run
  first, or `--output review-import` into a fresh dir, then move files in.
- Expecting drafts/pages from a Ghost export and getting only published posts →
  add `--include-drafts` / `--include-pages`.
- Broken images after a Ghost import because remote URLs were kept → use
  `--download-images` (with `--source-url` for relative URLs).
- Treating an importer as a sync tool → it is a one-shot conversion; the
  Markdown under `content/` is the source of truth afterward.
