---
name: nectar-frontmatter-authoring
description: Use when creating or editing posts, pages, authors, or tags in a Nectar project. Teaches the valid YAML frontmatter shape, file locations, slug rules, and Ghost-compatibility fields the build pipeline expects.
version: 1
applies_to:
  - claude
  - codex
triggers:
  - new post
  - new page
  - add a post
  - create a page
  - edit frontmatter
  - publish a draft
---

# Authoring Nectar content

Nectar is a Ghost-theme-compatible static site generator. Posts and pages live as Markdown files with YAML frontmatter under `content/`. The `nectar build` pipeline reads every file once and produces the static site — no admin UI, no database.

## File locations

| Kind | Path | Slug source |
|---|---|---|
| Post | `content/posts/<slug>.md` | filename (`<slug>.md` → `/<slug>/`) or `slug:` frontmatter field |
| Page | `content/pages/<slug>.md` | same as posts, served from `/<slug>/` |
| Author | `content/authors/<slug>.md` | slug from filename or `slug:` field |
| Tag | `content/tags/<slug>.md` | slug from filename or `slug:` field |

Slugs must match `/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/` — lowercase, alphanumeric + hyphens, no leading/trailing hyphen.

## Required and useful frontmatter (posts and pages)

```yaml
---
title: "Welcome to Nectar"              # required
date: 2026-01-15T09:00:00Z              # ISO 8601 with timezone; used for ordering + RSS
updated_at: 2026-02-01T12:00:00Z        # optional, falls back to date
status: published                       # `published` (default) | `draft` | `scheduled`
authors: [casper]                       # slug references, resolved against content/authors/
tags: [announcements, release-notes]    # slug references, resolved against content/tags/
custom_excerpt: "One-sentence summary." # SEO description + RSS body; ~300 char practical cap
feature_image: /content/images/hero.png # path under content/ or absolute URL
feature_image_alt: "Bee on a sunflower" # alt text — set this whenever feature_image is set
slug: welcome                           # override filename-derived slug (rarely needed)
visibility: public                      # public | members — members maps to dashboard gating only
codeinjection_head: "<meta ...>"        # site allow_code_injection must be true to take effect
codeinjection_foot: "<script>...</script>"
---
```

Anything not listed above is passed through to the theme context unchanged (Ghost themes will read `og_image`, `og_title`, `twitter_image`, `meta_title`, `meta_description`, etc.). Stick to documented Ghost field names so Source-family themes render correctly.

## Tag and author references

If a post lists `tags: [announcements]` but `content/tags/announcements.md` does not exist, Nectar auto-creates a placeholder tag at build time and prints a warning. Always vendor the matching `content/tags/<slug>.md` (and `content/authors/<slug>.md`) to silence the warning and to give the tag a real `name` + `description`. Author / tag file frontmatter:

```yaml
# content/authors/casper.md
---
slug: casper
name: "Casper Ghost"
bio: "Default Ghost mascot."
profile_image: /content/authors/casper.png
website: https://example.com
twitter: "@casper"
---

# Optional body — rendered on author archive pages.
```

```yaml
# content/tags/announcements.md
---
slug: announcements
name: Announcements
description: "Project milestones and release notes."
---
```

## Drafts and scheduling

- `status: draft` keeps the post out of the production build by default. `nectar dev` includes drafts so authors can preview them.
- `status: scheduled` + a future `date:` keeps the post out of the build until that timestamp passes. Add `--include-future` to force-include for previews.

## Things to never do

- Don't put posts under `content/pages/` or vice versa — they have different URL shapes (`/<slug>/` vs `/<page-slug>/` with different sitemap behaviour).
- Don't write Markdown lists like `tags: announcements, release-notes` — must be YAML arrays (`[announcements, release-notes]` or block form).
- Don't omit `title:` — it's required and the build fails loudly without it.
- Don't add a top-level `# Heading` as the first line of the body — Ghost themes derive the H1 from `title:` and render an extra H1 from the body, producing duplicate top headings.

## Verifying a draft

Run `nectar lint content/posts/<slug>.md` for frontmatter / content rule checks (title length, alt text, broken local links, future-date sanity). Run `nectar build` to catch any error the loader rejects.
