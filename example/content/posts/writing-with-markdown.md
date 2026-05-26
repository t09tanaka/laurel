---
title: "Writing with Markdown"
slug: writing-with-markdown
date: 2026-05-10T15:00:00Z
authors: [honeybee]
tags: [getting-started]
feature_image: "/content/images/markdown-cover.svg"
feature_image_alt: "Markdown symbols on a document beside the Nectar logo"
custom_excerpt: "A short primer on the frontmatter conventions Nectar expects."
---

Posts are Markdown files with YAML frontmatter. The frontmatter is the same
shape Ghost uses to talk to themes, just expressed in YAML instead of JSON.

```yaml
---
title: "My Post"
slug: my-post
date: 2026-01-01T09:00:00Z
authors: [casper]
tags: [news]
feature_image: /content/images/cover.jpg
custom_excerpt: "Optional summary"
status: published
---
```

## The body

The body is plain Markdown, with GFM tables, code fences, and heading IDs.

```js
function hello(name) {
  return `hello, ${name}`;
}
```

Inline `code`, **bold**, _italic_, ~~strikethrough~~, footnotes[^1], and
ordinary lists:

1. Posts go in `content/posts/`.
2. Pages go in `content/pages/`.
3. Drafts (`status: draft`) are skipped at build time.

[^1]: Yes, footnotes too.
