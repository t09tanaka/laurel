# Nectar

A static site generator that consumes **Ghost themes** and **Markdown content
from a Git repository** and emits a fully static site. No CMS, no server, no
database.

```
content/*.md   ─┐
                ├─►  nectar build  ─►  dist/  (HTML + CSS + JS + assets)
themes/source/ ─┘
```

Designed around four pillars:

1. **Ghost theme compatibility** — drop a real Ghost theme (e.g. the official
   `Source`) into your project, and Nectar renders it.
2. **Markdown + Git content** — your posts and pages are versioned Markdown
   files with YAML frontmatter.
3. **Static-only runtime** — the output is plain files. Host on anything.
4. **Optional components** — search, RSS, sitemaps, OG images, comments —
   opt in by config; not core.

Plus migration tooling: `nectar import-ghost ghost-export.json` converts a
Ghost admin JSON export into Markdown content.

## Status

Bootstrap in progress. See `docs/DESIGN.md` for the full architecture,
`docs/GHOST_COMPATIBILITY.md` for the helper coverage matrix, and
`docs/migration/ghost.md` for the step-by-step guide to moving a
real blog off Ghost.

## Quickstart

Requires [Bun](https://bun.sh) >= 1.3.

```bash
bun install
bun run build
cd example && bun ../src/cli/index.ts build
open example/dist/index.html
```

## Layout

```
src/        # SSG implementation (cli, content, theme, render, build, ghost, config)
tests/      # bun test suite mirroring src/
docs/       # Design notes
example/    # Reference blog: content + nectar.toml + vendored Source theme
```

## License

MIT
