---
title: "Theme development"
slug: theme-development
date: 2026-05-20T00:00:00Z
authors: [nectar]
meta_title: "Theme development | Nectar Docs"
meta_description: "Write or customise a Ghost theme that Nectar can render."
---

# Theme development

Nectar consumes the same `.hbs` Handlebars templates that Ghost themes ship
with. If your theme renders on Ghost, it should render on Nectar — modulo the
subset of helpers and contexts Nectar implements.

The canonical guide lives in
[`docs/THEME_DEV.md`](https://github.com/t09tanaka/nectar/blob/main/docs/THEME_DEV.md).
It covers:

- Layout inheritance with `{{!< default}}`.
- Partials with `{{> "partial-name"}}`.
- Block helpers (`foreach`, `is`, `match`, `has`, `get`, …).
- Inline helpers (`asset`, `img_url`, `ghost_head`, `ghost_foot`, …).
- Per-theme custom settings via `[theme.custom]` in `nectar.toml`.
- Asset fingerprinting via `{{asset "built/screen.css"}}`.
- Locale-driven translation via `{{t}}` and `locales/<tag>.json`.

## Smoke test your theme

```bash
nectar build --strict
```

`--strict` fails the build on any unknown helper or missing context field.

## What is not implemented

See the [helper matrix](/helper-matrix/) for the exact coverage map.
