# Nectar

[![CI](https://github.com/t09tanaka/nectar/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/t09tanaka/nectar/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/t09tanaka/nectar/branch/main/graph/badge.svg)](https://codecov.io/gh/t09tanaka/nectar)

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
Ghost admin JSON export into Markdown content. The supported migration path is
documented in [`docs/MIGRATION.md`](./docs/MIGRATION.md).

## Status

Bootstrap in progress. See `docs/DESIGN.md` for the full architecture,
[`VERSIONING.md`](./VERSIONING.md) for the SemVer, public API, and
theme-compatibility policy,
`docs/GHOST_COMPATIBILITY.md` for the helper coverage matrix,
`docs/THEME_DEV.md` for the theme developer handbook (helpers, partials,
locales, asset fingerprinting, golden snapshot tests),
`docs/theme-reference.md` for the machine-checked helper inventory plus
content-shape index, and
[`docs/MIGRATION.md`](./docs/MIGRATION.md) for the Ghost Admin export ->
Markdown migration path, and `docs/migration/ghost.md` for the step-by-step
guide to moving a real blog off Ghost. If your Ghost site uses Members / Portal, read
`docs/MEMBERS.md` for what does and doesn't translate to a static build,
plus wiring examples for Buttondown / Beehiiv / Substack.

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
release also publishes `SHASUMS256.txt` for verification. macOS release
binaries are signed and notarized, and the Windows binary is Authenticode-signed;
release operator notes live in [`docs/release.md`](./docs/release.md).

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
4. [Deploy to Cloudflare / Vercel / Netlify / Firebase Hosting / GitHub Pages](./docs/tutorials/04-deploy.md)
5. [Write your first plugin](./docs/tutorials/05-write-your-first-plugin.md)

Index: [`docs/tutorials/`](./docs/tutorials/README.md).

Once a site is live, see
[`docs/security/hosting.md`](./docs/security/hosting.md) for the
`Content-Security-Policy`, `Strict-Transport-Security`, and related HTTP
header snippets each host needs — Nectar emits static files, so these are
the host's job.

Accepting PRs against `content/` or `themes/`? Read
[`docs/security/threat-model.md`](./docs/security/threat-model.md) first.
It documents which frontmatter fields (`codeinjection_*`,
`feature_image_caption`, `unsafe_html`, `slug`) and config fields
(`site.url`, `theme.custom.*`, `build.allow_code_injection`) carry which
level of trust, and what to look for in a contributor's diff.

## Layout

```
src/        # SSG implementation (cli, content, theme, render, build, ghost, config)
tests/      # bun test suite mirroring src/
docs/       # Design notes
example/    # Reference blog: content + nectar.toml + vendored Source theme
examples/   # Deploy snippets and (planned) starter site templates — see examples/README.md
```

## Community

- **Questions / how-do-I:** [GitHub Discussions → Q&A](https://github.com/t09tanaka/nectar/discussions/categories/q-a)
- **Show off a site or theme you built:** [Discussions → Show and tell](https://github.com/t09tanaka/nectar/discussions/categories/show-and-tell)
- **Propose a feature or bounce an idea:** [Discussions → Ideas](https://github.com/t09tanaka/nectar/discussions/categories/ideas)
- **Releases and project-wide notices:** [Discussions → Announcements](https://github.com/t09tanaka/nectar/discussions/categories/announcements)
- **Reproducible bugs:** [open an issue](https://github.com/t09tanaka/nectar/issues/new/choose)
- **Security vulnerabilities:** see [`SECURITY.md`](./SECURITY.md) — please don't file public issues
- **Code of Conduct:** this project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md)

Picking the right venue gets you a faster answer and keeps the issue tracker
scannable. See [`.github/SUPPORT.md`](./.github/SUPPORT.md) for the long
version.

## License

MIT
