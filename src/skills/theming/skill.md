---
name: nectar-theming
description: Use when installing, switching, scaffolding, forking, auditing, or packaging a Ghost-compatible theme for a Nectar site. Covers `nectar theme list/new/zip/lint/serve`, vendoring a Ghost theme, selecting the active theme, and the theme dev loop. For build errors like a missing theme or partial, defer to nectar-build-troubleshoot; for nectar.toml `[theme]` keys, nectar-setting.
version: 1
applies_to:
  - claude
  - codex
triggers:
  - install a theme
  - switch themes
  - nectar theme new
  - fork a theme
  - lint a theme
  - package a theme
  - vendor a Ghost theme
  - nectar theme serve
  - create a custom theme
---

# Theming a Nectar site

Nectar renders Ghost-compatible `.hbs` themes. Themes live under the directory
named by `[theme].dir` (default `themes/`), and the active one is `[theme].name`
in `nectar.toml`. The compatibility target is the official Ghost **Source** theme.

## See and select themes

```sh
nectar theme list                    # themes found under [theme].dir, with the active one marked
nectar theme list --json             # machine-readable
```

Switch the active theme by pointing `[theme].name` at another directory under
`[theme].dir` (use the `nectar-setting` skill / `nectar config set theme.name <name>`),
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
nectar theme new my-theme            # scaffold a fresh themes/my-theme/
nectar theme new my-fork --from source   # fork the active (or named) theme to iterate on
```

`--from` copies an existing theme as the starting point — prefer it over a manual
copy when adapting a working theme, so partials and assets come along intact. New
themes are written under `[theme].dir`.

## Iterate with the theme dev server

```sh
nectar theme serve                   # fast theme dev server backed by fixture content
nectar theme serve --port 8080       # pick a different port
```

`nectar theme serve` renders the theme against built-in fixture content, so you
can iterate on `.hbs` and assets without a full `content/` tree. For previewing
the theme against the *real* site content, use `nectar dev` instead.

## Audit and package before shipping

```sh
nectar theme lint themes/my-theme    # audit: required templates, missing partials, helper usage
nectar theme zip                     # produce a ship-ready zip of the active theme in cwd
nectar theme zip --output dist/theme.zip   # write the zip to a specific path
```

Run `nectar theme lint` before distributing a theme — it surfaces missing
required templates (`default.hbs`, `index.hbs`, `post.hbs`) and referenced-but-
absent partials, the same classes of problem that otherwise only surface at
build time.

## Common mistakes this workflow avoids

- Setting `[theme].name` to a theme that was never cloned → `Theme directory not
  found` at build time. Vendor it first (`git clone … themes/<name>`).
- Hand-copying a theme to fork it and dropping `partials/` or `assets/` → use
  `nectar theme new <name> --from <source>`.
- Shipping a theme with a missing required template or partial → run
  `nectar theme lint` first; if a *build* fails on a theme error, switch to the
  `nectar-build-troubleshoot` skill.
- Using `nectar theme serve` to verify real content — it uses fixture content;
  use `nectar dev` to preview the theme against `content/`.
