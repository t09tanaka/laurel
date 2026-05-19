# Contributing to Nectar

Thanks for your interest in Nectar — a Ghost-theme-compatible static site
generator built on Bun + TypeScript. This document covers everything you need to
get a working dev environment, send a change, and have it merged.

If you are reporting a security issue, **do not open a public issue or PR** —
follow [`SECURITY.md`](./SECURITY.md) instead.

## Code of Conduct

Be kind. Assume good intent. Critique code, not people. Maintainers may close
issues or PRs that violate this in spirit even if no formal CoC document exists.

## Ways to Contribute

- **Bug reports** — open a GitHub issue with a minimal reproduction (a small
  theme/content pair that triggers the bug is gold).
- **Feature ideas** — open an issue first so we can discuss scope before you
  write code. Nectar deliberately keeps the Ghost compatibility surface focused;
  see [`CLAUDE.md`](./CLAUDE.md) for what's in and out of scope.
- **Pull requests** — see [Pull Request workflow](#pull-request-workflow) below.
- **Docs improvements** — `README.md`, `docs/`, and tutorial fixes are always
  welcome and tend to merge quickly.

## Dev Setup

### Prerequisites

- [Bun](https://bun.sh) **>= 1.3** (the `engines.bun` field in
  [`package.json`](./package.json) is the source of truth).
- Git.
- A shell that supports the examples below (macOS, Linux, or WSL).

You do **not** need Node.js. Bun is the runtime, package manager, test runner,
and bundler for this repo.

### First-time clone

```bash
git clone https://github.com/t09tanaka/nectar.git
cd nectar
bun install
```

### Build the example site

The reference blog under [`example/`](./example/) is the integration test for
the whole pipeline. If it renders, the Ghost compatibility surface is healthy.

```bash
bun run build:example
open example/dist/index.html       # macOS — substitute your OS's opener
```

### Run the tests

```bash
bun test                # one-shot
bun run test:watch      # watch mode while iterating
```

### Lint / format / typecheck

Biome handles lint and format. TypeScript handles type checking.

```bash
bun run check           # biome check (lint + format check)
bun run format          # biome format --write
bun run typecheck       # tsc --noEmit
bun run lint:html       # html-validate against example/dist (run build:example first)
```

## Repo Layout

See [`CLAUDE.md`](./CLAUDE.md) for the full architectural tour. The short
version:

```
src/      # SSG implementation (cli, content, theme, render, build, ghost, config)
tests/    # bun test suite — mirrors src/ layout 1:1
docs/     # Design notes, tutorials, migration guide
example/  # Reference blog: content + nectar.toml + vendored Source theme
```

Tests are **colocated by mirror**: `src/render/helpers.ts` →
`tests/render/helpers.test.ts`. When you add a file under `src/`, add the
matching test under `tests/`.

## Branching

- **Default branch:** `main`. All PRs target `main`.
- **Feature branches:** name them descriptively (`feat/foo-bar`, `fix/asset-url`,
  `docs/contributing`). Worktree-based branches in this repo use the
  `parallel/<task-name>` convention — that's an internal convenience, not a
  requirement for external contributors.
- **Never merge locally.** All changes go in through `gh pr create` / the GitHub
  UI so CI runs and history stays consistent.
- **No `--amend` / no force-push to shared branches.** If your PR needs a fix,
  add a new commit. Maintainers will squash on merge if appropriate.

## Commit Style

This project uses [Conventional Commits](https://www.conventionalcommits.org/)
because the release pipeline (`release-please`) reads the history to compute the
next version and generate `CHANGELOG.md`.

Format:

```
<type>(<scope>): <short summary>
```

Common types in this repo:

| Type     | Use for                                                     |
| -------- | ----------------------------------------------------------- |
| `feat`   | New user-visible feature                                    |
| `fix`    | Bug fix                                                     |
| `docs`   | Documentation only                                          |
| `refactor` | Code change that doesn't add a feature or fix a bug       |
| `test`   | Adding or fixing tests, no production code change           |
| `chore`  | Tooling, deps, repo housekeeping                            |
| `ci`     | CI / release pipeline changes                               |
| `perf`   | Performance improvement                                     |

Scopes are optional but help readers. Examples seen in `git log`:

- `feat(seo): emit BreadcrumbList JSON-LD on post pages`
- `fix(build): rewrite Ghost members form action to configured provider`
- `docs(packaging): surface single-file binary downloads to end users`
- `ci(release): add CHANGELOG.md and release-please pipeline`

Breaking changes: add `!` after the type/scope and include a `BREAKING CHANGE:`
footer.

```
feat(config)!: rename `output.dir` to `build.outDir`

BREAKING CHANGE: `output.dir` in nectar.toml has been renamed to `build.outDir`.
Update your config before upgrading.
```

Keep the subject line under ~72 characters, in the imperative mood ("add X",
not "added X" or "adds X").

### Sign-off / DCO

Nectar does **not** currently require a Developer Certificate of Origin (DCO)
sign-off on commits. You do not need to add `Signed-off-by:` trailers, and CI
will not reject commits that lack them.

By opening a pull request you affirm that your contribution is your own work
(or that you have the right to submit it) and that you license it under the
project's [MIT License](./LICENSE). If this policy changes in the future, the
requirement will be documented here and enforced by CI before it is required of
contributors.

## Testing Expectations

- **Every behavior change needs a test.** Bug fix → add a regression test that
  fails on `main`. New helper or builder → add unit + integration tests.
- **Use `bun test`.** No Jest, no Vitest. Tests live under `tests/` mirroring
  `src/`.
- **Integration coverage:** if you touch the build pipeline or a helper used by
  the Source theme, also confirm `bun run build:example` still produces a clean
  `example/dist/`.
- **No skipped tests in PRs.** If a test is flaky or genuinely blocked, open an
  issue and link it; don't merge `.skip` silently.

### What counts as a "theme-compat regression"

The project's north star is that the vendored Ghost Source theme (under
`example/themes/source/`) renders end-to-end against the content in
`example/content/`. Anything that breaks that rendering is a **theme-compat
regression** and blocks merge until fixed. Concretely, a change is a
theme-compat regression if any of the following are true:

- `bun run build:example` exits non-zero where it previously succeeded.
- A Ghost helper used by Source (`{{asset}}`, `{{img_url}}`, `{{ghost_head}}`,
  `{{foreach}}`, `{{is}}`, `{{match}}`, `{{has}}`, `{{get}}`, `{{t}}`,
  `{{date}}`, `{{reading_time}}`, `{{navigation}}`, `{{pagination}}`,
  `{{content}}`, `{{excerpt}}`, `{{authors}}`, `{{tags}}`, etc.) throws or
  silently emits a wrong value.
- A Ghost context field that Source reads (`@site`, `@custom`, `@page`, `post`,
  `page`, `author`, `tag`, pagination metadata) is missing, renamed, or
  reshaped incompatibly.
- Asset fingerprinting via `{{asset}}` produces broken or non-content-addressed
  URLs that 404 in the built `example/dist/`.
- The pages that `docs/CLAUDE.md` calls out as required output for the
  bootstrap milestone (`index.html`, `<post-slug>/index.html`,
  `tag/<tag>/index.html`, `author/<author>/index.html`, `<page-slug>/index.html`,
  `sitemap.xml`, `rss.xml`) stop being emitted or stop being valid.

Items declared **out of scope** in `CLAUDE.md` (members, server-side search,
live drafts, email-only posts) are **not** theme-compat regressions even if a
Source partial mentions them — those helpers are intentionally stubbed.

If you suspect your change is a theme-compat regression, run `bun run
build:example` locally and open the resulting `example/dist/index.html` in a
browser to confirm before pushing.

### Before pushing

Run the full local check the same way CI does:

```bash
bun run check && bun test
```

Both must be green. Optional but recommended for non-trivial changes:

```bash
bun run typecheck
bun run build:example      # smoke-test the example site
```

## Pull Request Workflow

1. **Fork** (if you're external) or **branch** (if you have write access).
2. Make your change. Keep PRs **small and focused** — one logical change per
   PR. Drive-by refactors in unrelated files make review slow.
3. Ensure `bun run check && bun test` passes locally.
4. Push and open a PR against `main`.
5. Fill in the PR description:
   - **What** changed and **why**.
   - Link the issue it closes (`Closes #123`) if applicable.
   - Screenshots / before-after for user-visible changes.
   - Anything reviewers should pay extra attention to.
6. CI will run lint, typecheck, and tests. Fix any failures.
7. A maintainer will review. Address feedback by **adding commits** (don't
   force-push). The PR will typically be squash-merged on approval.

### What gets merged quickly

- Bug fixes with a regression test.
- Docs improvements with concrete examples.
- New Ghost helpers / context fields with theme-driven justification (e.g.
  "Source uses this and we don't currently render it").
- Small, focused refactors that come with measurable wins (clearer types,
  removed dead code).

### What gets pushback

- Large refactors without a discussion issue first.
- New optional components that aren't actually needed to render Source against
  `example/`.
- Changes that expand the Ghost compatibility scope beyond what
  [`CLAUDE.md`](./CLAUDE.md) declares (members, server-side search, live
  drafts) without prior agreement.
- PRs that change unrelated files alongside the target change.

## Style Notes

The full coding standards live in [`CLAUDE.md`](./CLAUDE.md). Quick reference:

- TypeScript strict mode. No `any` — use `unknown` and narrow.
- Prefer Bun-native APIs (`Bun.file`, `Bun.write`, `Bun.glob`) over `node:fs`.
- Small, composable functions. Files usually < 300 lines.
- Errors propagate as thrown `Error`s with useful messages. No silent catches.
- Comment **why**, not **what**. Don't restate the code.
- No emojis in code, comments, or filenames unless explicitly requested.

## License

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](./LICENSE).

## Questions

If you're unsure whether a change is in scope or how to structure it, open a
GitHub issue and ask before writing the code. Saving a wasted afternoon is
worth a five-minute discussion.
