---
title: "Helper matrix"
slug: helper-matrix
date: 2026-05-20T00:00:00Z
authors: [nectar]
meta_title: "Helper matrix | Nectar Docs"
meta_description: "Which Ghost helpers Nectar implements, and which it deliberately does not."
---

# Helper matrix

The full Ghost helper coverage map lives in
[`docs/GHOST_COMPATIBILITY.md`](https://github.com/t09tanaka/nectar/blob/main/docs/GHOST_COMPATIBILITY.md)
and is regenerated as the implementation evolves.

## Implemented (MVP)

**Block helpers**

- Built-in: `if`, `unless`, `each`, `with`.
- Ghost: `foreach`, `is`, `match`, `has`, `post`, `page`, `tag`, `author`,
  `get`.

**Inline helpers**

- `asset`, `img_url`, `ghost_head`, `ghost_foot`, `body_class`,
  `post_class`, `meta_title`, `meta_description`, `date`, `t`, `url`,
  `concat`, `link`, `link_class`, `navigation`, `pagination`,
  `reading_time`, `excerpt`, `content`, `authors`, `tags`, `social_url`,
  `lang`.

**Contexts**

- `@site`, `@blog` (alias), `@custom`, `@page`.
- `post`, `page`, `author`, `tag`, pagination.

## Out of scope (for now)

- Members, subscriptions, payments, comments — `{{comments}}` outputs empty.
- Newsletter rendering / email-only posts.
- Server-side search — client-side search wires in as an optional component.
- Admin/edit links inside themes.
- Live preview / drafts via API.
- Multi-locale routing. One build = one locale.

If a Ghost helper you depend on is missing, please
[open an issue](https://github.com/t09tanaka/nectar/issues/new/choose) so it
can be prioritised against the next milestone.
