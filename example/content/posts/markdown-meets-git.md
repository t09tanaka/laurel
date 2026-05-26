---
title: "Markdown Meets Git"
slug: markdown-meets-git
date: 2026-04-12T07:00:00Z
authors: [honeybee]
tags: [getting-started]
feature_image: "/content/images/git-cover.svg"
feature_image_alt: "A branching Git graph with a bee hovering above it"
custom_excerpt: "How treating content as Markdown in Git changes editorial workflow."
---

Treating content as Markdown files in a Git repo unlocks workflow primitives
that a database-backed CMS struggles to express:

- **Branch a draft.** `git switch -c drafts/holiday-roundup`, write in your
  editor, push, get a pull request review from your team, merge to publish.
- **Schedule a post by merging on a date.** The build pipeline runs on push,
  and `status: draft` keeps things hidden until you flip it.
- **History is free.** `git log content/posts/<slug>.md` is the version
  history. No vendor lock-in.

Content as code, code as content. Either way, you get diffs, reviews, and
deploys for free.
