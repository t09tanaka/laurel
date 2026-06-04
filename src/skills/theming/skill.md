---
name: laurel-theming
description: Use when installing, switching, scaffolding, forking, auditing, or packaging a Ghost-compatible theme for a Laurel site. Covers `laurel theme list/new/zip/lint/serve`, vendoring a Ghost theme, selecting the active theme, and the theme dev loop. For build errors like a missing theme or partial, defer to laurel-build-troubleshoot; for laurel.toml `[theme]` keys, laurel-setting.
version: 1
applies_to:
  - claude
  - codex
triggers:
  - install a theme
  - switch themes
  - laurel theme new
  - fork a theme
  - lint a theme
  - package a theme
  - vendor a Ghost theme
  - laurel theme serve
  - create a custom theme
---

# Theming a Laurel site

Laurel renders Ghost-compatible `.hbs` themes. Themes live under the directory
named by `[theme].dir` (default `themes/`), and the active one is `[theme].name`
in `laurel.toml`. The compatibility target is the official Ghost **Source** theme.

## See and select themes

```sh
laurel theme list                    # themes found under [theme].dir, with the active one marked
laurel theme list --json             # machine-readable
```

Switch the active theme by pointing `[theme].name` at another directory under
`[theme].dir` (use the `laurel-setting` skill / `laurel config set theme.name <name>`),
then rebuild. The theme directory must actually exist — see "Vendor a theme".

## Vendor a Ghost theme

Most themes are cloned in, not scaffolded:

```sh
git clone https://github.com/TryGhost/Source themes/source
```

Other Ghost-compatible themes (Casper, Edition, Headline, Wave, Liebling, …)
follow the same pattern — clone into `themes/<name>/` and set `[theme].name` to
`<name>`. An npm-distributed theme is wired by setting `[theme].dir` to a package
spec resolvable under `node_modules/`.

## Scaffold or fork a theme

```sh
laurel theme new my-theme            # scaffold a fresh themes/my-theme/
laurel theme new my-fork --from source   # fork the active (or named) theme to iterate on
```

`--from` copies an existing theme as the starting point — prefer it over a manual
copy when adapting a working theme, so partials and assets come along intact. New
themes are written under `[theme].dir`.

## Iterate with the theme dev server

```sh
laurel theme serve                   # fast theme dev server backed by fixture content
laurel theme serve --port 8080       # pick a different port
```

`laurel theme serve` renders the theme against built-in fixture content, so you
can iterate on `.hbs` and assets without a full `content/` tree. For previewing
the theme against the *real* site content, use `laurel dev` instead.

## Audit and package before shipping

```sh
laurel theme lint themes/my-theme    # audit: required templates, missing partials, helper usage
laurel theme zip                     # produce a ship-ready zip of the active theme in cwd
laurel theme zip --output dist/theme.zip   # write the zip to a specific path
```

Run `laurel theme lint` before distributing a theme — it surfaces missing
required templates (`default.hbs`, `index.hbs`, `post.hbs`) and referenced-but-
absent partials, the same classes of problem that otherwise only surface at
build time.

## Common mistakes this workflow avoids

- Setting `[theme].name` to a theme that was never cloned → `Theme directory not
  found` at build time. Vendor it first (`git clone … themes/<name>`).
- Hand-copying a theme to fork it and dropping `partials/` or `assets/` → use
  `laurel theme new <name> --from <source>`.
- Shipping a theme with a missing required template or partial → run
  `laurel theme lint` first; if a *build* fails on a theme error, switch to the
  `laurel-build-troubleshoot` skill.
- Using `laurel theme serve` to verify real content — it uses fixture content;
  use `laurel dev` to preview the theme against `content/`.
