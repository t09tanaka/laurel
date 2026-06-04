---
title: "Migrating from Ghost"
slug: migration-from-ghost
date: 2026-05-20T00:00:00Z
authors: [laurel]
meta_title: "Migrating from Ghost | Laurel Docs"
meta_description: "How to move a real Ghost blog to Laurel in roughly 10 minutes."
---

# Migrating from Ghost

Laurel ships an `import-ghost` command that consumes a Ghost admin JSON
export, writes Markdown into `content/posts/` and `content/pages/`, and copies
referenced images into `content/images/`. The same workflow works for
WordPress through `import-wordpress` against a WXR XML export.

The full migration playbook lives in
[`docs/migration-from-ghost/`](https://github.com/t09tanaka/laurel/tree/main/docs/migration-from-ghost)
and the 10-minute walkthrough is in
[`docs/tutorials/02-migrate-from-ghost.md`](https://github.com/t09tanaka/laurel/blob/main/docs/tutorials/02-migrate-from-ghost.md).

## Sketch

```bash
# 1. Export from Ghost admin → Labs → Export JSON.
# 2. Import into your Laurel project:
laurel import-ghost ./ghost-export.json --content-dir ./content

# 3. Inspect the diff, fix anything import flagged.
git status

# 4. Build.
laurel build
```

## What translates 1:1

- Posts and pages (Markdown + frontmatter).
- Tags and authors.
- Feature images (downloaded, fingerprinted, rewritten).
- Internal links (rewritten against the new site URL).

## What does **not** translate

- Members, subscriptions, comments. See
  [`docs/MEMBERS.md`](https://github.com/t09tanaka/laurel/blob/main/docs/MEMBERS.md)
  for how to wire Buttondown / Beehiiv / Substack as a client-only newsletter
  drop-in.
- Live preview, drafts via API, admin/edit links.
- Ghost Admin integrations (`/ghost/api/integrations`, Zapier, Slack, etc.).
  Keep those workflows in build hooks, CI, or your deploy provider's
  integration / webhook settings.
- Routes.yaml overrides — these need manual review.
