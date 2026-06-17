# Laurel

[![CI](https://github.com/t09tanaka/laurel/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/t09tanaka/laurel/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/t09tanaka/laurel/branch/main/graph/badge.svg)](https://codecov.io/gh/t09tanaka/laurel)

A static site generator that consumes **Ghost themes** and **Markdown content
from a Git repository** and emits a fully static site. No CMS, no server, no
database.

```
content/*.md   ─┐
                ├─►  laurel build  ─►  dist/  (HTML + CSS + JS + assets)
themes/casper/ ─┘
```

Designed around four pillars:

1. **Ghost theme compatibility** — drop a real Ghost theme (e.g. the official
   `Source`) into your project, and Laurel renders it.
2. **Markdown + Git content** — your posts and pages are versioned Markdown
   files with YAML frontmatter.
3. **Static-only runtime** — the output is plain files. Host on anything.
4. **Optional components** — search, RSS, sitemaps, OG images, comments —
   opt in by config; not core.

Plus migration tooling: `laurel import-ghost ghost-export.json` converts a
Ghost admin JSON export into Markdown content, and `laurel import-hugo` /
`laurel import-jekyll` provide conservative Markdown-post imports from existing
static sites. The supported migration paths are documented in
[`docs/MIGRATION.md`](./docs/MIGRATION.md).

## Status

Bootstrap in progress. See `docs/DESIGN.md` for the full architecture,
[`docs/admin-dashboard.md`](./docs/admin-dashboard.md) for the local
file-backed Admin design direction,
[`VERSIONING.md`](./VERSIONING.md) for the SemVer, public API, and
theme-compatibility policy,
`docs/GHOST_COMPATIBILITY.md` for the helper coverage matrix,
`docs/THEME_DEV.md` for the theme developer handbook (helpers, partials,
locales, asset fingerprinting, golden snapshot tests),
`docs/theme-reference.md` for the machine-checked helper inventory plus
content-shape index,
[`docs/api.md`](./docs/api.md) for the static Content API contract plus
[`docs/EXAMPLE_SPA.md`](./docs/EXAMPLE_SPA.md) for a minimal
`@tryghost/content-api` SPA consumer, and
[`docs/MIGRATION.md`](./docs/MIGRATION.md) for the Ghost Admin export ->
Markdown migration path, and `docs/migration/ghost.md` for the step-by-step
guide to moving a real blog off Ghost. If your Ghost site uses Members / Portal, read
`docs/MEMBERS.md` for what does and doesn't translate to a static build,
plus wiring examples for Buttondown / Beehiiv / Substack.

## Install

Laurel is distributed on npm. It runs on the [Bun](https://bun.sh) runtime, so
install Bun >= 1.3 first, then install the CLI globally:

```bash
npm i -g @t09tanaka/laurel
laurel --help
```

Or run it without a global install:

```bash
bunx @t09tanaka/laurel --help
```

To update an existing install, `laurel upgrade` detects how Laurel was installed
(`npm i -g`, `bun install -g`, or `bunx`) and runs the matching command. Release
operator notes live in [`docs/release.md`](./docs/release.md).

## Quickstart

Requires [Bun](https://bun.sh) >= 1.3 to run Laurel.

```bash
bun install
bun run build
cd example && bun ../src/cli/index.ts build
open example/dist/index.html
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
header snippets each host needs — Laurel emits static files, so these are
the host's job.

For build-time expectations, scaling guidance, recommended cache headers, image
limits, and a manual 1k-post benchmark, see
[`docs/PERFORMANCE.md`](./docs/PERFORMANCE.md).

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
example/    # Reference blog: content + laurel.toml + vendored Ghost themes (Source, Casper)
examples/   # Deploy snippets and (planned) starter site templates — see examples/README.md
```

## Community

- **Questions / how-do-I:** [GitHub Discussions → Q&A](https://github.com/t09tanaka/laurel/discussions/categories/q-a)
- **Show off a site or theme you built:** [Discussions → Show and tell](https://github.com/t09tanaka/laurel/discussions/categories/show-and-tell)
- **Propose a feature or bounce an idea:** [Discussions → Ideas](https://github.com/t09tanaka/laurel/discussions/categories/ideas)
- **Releases and project-wide notices:** [Discussions → Announcements](https://github.com/t09tanaka/laurel/discussions/categories/announcements)
- **Reproducible bugs:** [open an issue](https://github.com/t09tanaka/laurel/issues/new/choose)
- **Security vulnerabilities:** see [`SECURITY.md`](./SECURITY.md) — please don't file public issues
- **Code of Conduct:** this project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md)

Picking the right venue gets you a faster answer and keeps the issue tracker
scannable. See [`.github/SUPPORT.md`](./.github/SUPPORT.md) for the long
version.

## License

MIT.

### Third-party themes

This repository vendors two official Ghost themes for use as reference
fixtures and compatibility targets:

- [`example/themes/source/`](./example/themes/source/) — the **Source** theme
- [`example/themes/casper/`](./example/themes/casper/) — the **Casper** theme

Both are © Ghost Foundation and distributed under the MIT License. Their
respective `LICENSE` files are retained inside each theme directory, as the
license requires. Laurel's own MIT license does not extend to these vendored
themes; they remain under their upstream license.
