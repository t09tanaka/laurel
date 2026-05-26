---
title: "Static-Only Runtime"
slug: static-runtime
date: 2026-04-20T14:00:00Z
authors: [casper]
tags: [news]
feature_image: "/content/images/static-cover.svg"
feature_image_alt: "Static files flowing from a build box to a browser"
custom_excerpt: "Why Nectar emits plain files and nothing else."
---

A Nectar build produces a tree of plain HTML, CSS, JS, and image assets in
`dist/`. There is no Node server, no edge function, no database. You can:

- Drop `dist/` into S3 or R2 behind any CDN.
- Push it to GitHub Pages or Cloudflare Pages.
- `rsync` it to a single VPS and serve it with nginx.

Because the output is static, anything that *requires* a server (members
paywalls, server-side search, comment storage) lives at the edges as optional
client-side components — never in the core renderer. That keeps the security
surface and the deploy story boring, which is exactly what a blog needs.
