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

## Install

Nectar ships as a self-contained binary for each tagged release, so you do not
need Bun on your machine to use it. Grab the artifact that matches your platform
from the latest [GitHub Release](https://github.com/t09tanaka/nectar/releases),
verify the checksum, and drop it on your `$PATH`.

```bash
# macOS (Apple Silicon) — substitute the triple that matches your machine
curl -L -o nectar \
  https://github.com/t09tanaka/nectar/releases/latest/download/nectar-darwin-arm64
chmod +x nectar
./nectar --help
```

Available triples: `nectar-linux-x64`, `nectar-linux-arm64`,
`nectar-darwin-x64`, `nectar-darwin-arm64`, `nectar-windows-x64.exe`. Each
release also publishes `SHASUMS256.txt` for verification.

Prefer npm? `npm i -g nectar` works too once Bun is installed locally.

## Quickstart

Requires [Bun](https://bun.sh) >= 1.3 for development. End users running a
prebuilt binary do not need Bun.

```bash
bun install
bun run build
cd example && bun ../src/cli/index.ts build
open example/dist/index.html
```

To produce a single-file binary locally (useful for smoke-testing the release
artifact before tagging):

```bash
bun run compile            # host platform only → dist-bin/nectar-<triple>
bun run compile:all        # every CI target → dist-bin/nectar-*
```

## Tutorials

Copy-pasteable walkthroughs for the common starting points — each one is
self-contained and ends with something running locally.

1. [Start a blog from scratch](./docs/tutorials/01-start-a-blog.md)
2. [Migrate from Ghost in 10 minutes](./docs/tutorials/02-migrate-from-ghost.md)
3. [Customise the Source theme](./docs/tutorials/03-customise-source-theme.md)
4. [Deploy to Cloudflare / Vercel / Netlify / GitHub Pages](./docs/tutorials/04-deploy.md)
5. [Write your first plugin](./docs/tutorials/05-write-your-first-plugin.md)

Index: [`docs/tutorials/`](./docs/tutorials/README.md).

## Layout

```
src/        # SSG implementation (cli, content, theme, render, build, ghost, config)
tests/      # bun test suite mirroring src/
docs/       # Design notes
example/    # Reference blog: content + nectar.toml + vendored Source theme
```

## License

MIT
