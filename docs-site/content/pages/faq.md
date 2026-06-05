---
title: "FAQ"
slug: faq
date: 2026-05-20T00:00:00Z
authors: [laurel]
meta_title: "FAQ | Laurel Docs"
meta_description: "The questions we keep getting about Laurel."
---

# FAQ

## Is Laurel a fork of Ghost?

No. Laurel is an independent static site generator that happens to consume
the same `.hbs` Handlebars template format that Ghost themes ship with. There
is no shared code with Ghost.

## Does Laurel require Bun?

Yes. Laurel is distributed on npm and runs on the [Bun](https://bun.sh) runtime,
so end users need Bun >= 1.3 installed (`npm i -g laurel`, then `laurel build`,
or `bunx laurel build`). Building Laurel from source and developing on it have
the same requirement.

## Can I keep my Ghost theme?

If your theme uses helpers Laurel implements, yes. The vendored Ghost
**Source** theme is the compatibility target, and the
[helper matrix](/helper-matrix/) lists everything supported. Themes that
depend on members, subscriptions, comments, server-side search, or admin
links will need those pieces stubbed or replaced.

## Where do posts come from?

Markdown files with YAML frontmatter in `content/posts/`. The schema and
field reference live in
[`docs/config.md`](https://github.com/t09tanaka/laurel/blob/main/docs/config.md)
and the file-format guide in
[`docs/THEME_DEV.md`](https://github.com/t09tanaka/laurel/blob/main/docs/THEME_DEV.md).

## What about members and subscriptions?

Out of scope for the core build. Laurel is static. Newsletter signups wire in
as an opt-in client-only component pointed at Buttondown, Beehiiv, Substack,
or a similar service. See
[`docs/MEMBERS.md`](https://github.com/t09tanaka/laurel/blob/main/docs/MEMBERS.md).

## How do I deploy?

The output is plain HTML/CSS/JS. Any static host works — Cloudflare Pages,
Vercel, Netlify, GitHub Pages, S3 + CloudFront, and so on. See
[`docs/tutorials/04-deploy.md`](https://github.com/t09tanaka/laurel/blob/main/docs/tutorials/04-deploy.md)
for one-click recipes.

## Where do I report bugs or request features?

Reproducible bugs: the
[issue tracker](https://github.com/t09tanaka/laurel/issues/new/choose).
Open-ended questions or ideas: the
[discussions board](https://github.com/t09tanaka/laurel/discussions).
Security vulnerabilities: read
[`SECURITY.md`](https://github.com/t09tanaka/laurel/blob/main/SECURITY.md)
first — please do not file public issues.
