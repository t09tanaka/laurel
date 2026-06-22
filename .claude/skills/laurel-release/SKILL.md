---
name: laurel-release
description: Use when preparing a new npm release of the Laurel CLI. Runs the prepublish chain (skill bundle, dashboard bundle, CLI bundle, types), validates with check/typecheck/test, bumps the package version, updates CHANGELOG.md, creates a release commit + tag, publishes a standardized GitHub Release generated from the changelog, and primes the repo so `npm publish` is the only remaining manual step. Explicitly does NOT publish on CI — every release is a deliberate manual act.
---

# Releasing Laurel to npm

Laurel's only distribution channel is npm. Releases are published manually with a local `npm publish` from a clean `main` checkout — there is no CI publish workflow. This skill covers the full manual flow: version bump, CHANGELOG update, bundle regeneration, validation, commit + tag, GitHub Release, and publish.

The `prepublishOnly` hook in `package.json` already runs the full bundle chain (`build:dashboard-bundle && build:skill-bundle && build:cli && build:types`), so `npm publish` from a clean checkout is sufficient to produce a correct artifact. This skill walks through the safety gates that go around that.

npm provenance is intentionally disabled (`publishConfig.provenance: false`): provenance attestation requires CI OIDC and fails locally. Re-enable it and a CI publish path only if publishing moves back into CI.

## Step-by-step

### 1. Confirm the working tree is clean main

```sh
git checkout main
git pull --ff-only origin main
git status                       # must report clean
```

If anything is dirty or you are not on `main`, stop and resolve before continuing.

### 2. Decide the semver bump

- **patch** — bugfixes only, no behaviour or API change (`0.1.0 → 0.1.1`)
- **minor** — new features, backwards-compatible (`0.1.0 → 0.2.0`)
- **major** — breaking change to CLI flags, config schema, theme contract, or output shape (`0.1.0 → 1.0.0`)

Pre-1.0 grace: while `0.x.y`, minor bumps may carry breaking changes — call them out in commit + release notes regardless.

### 3. Bump `package.json` (without auto-tagging)

```sh
npm version <patch|minor|major> --no-git-tag-version
```

The flag is mandatory — we tag from a release commit ourselves so the tag points at a tree that includes regenerated bundles.

### 4. Update CHANGELOG.md

`CHANGELOG.md` is the single source of truth for release notes — the GitHub
Release body is generated from it in step 9. It must be updated in the same
release commit as the version bump.

1. Move everything under `## [Unreleased]` into a new dated section for this
   version, and reset `## [Unreleased]` back to the `_Nothing yet._` placeholder:

   ```markdown
   ## [Unreleased]

   _Nothing yet._

   ## [X.Y.Z] - YYYY-MM-DD

   ### Added
   - ...

   ### Fixed
   - ...
   ```

   Use today's date (`YYYY-MM-DD`) and keep the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
   section names (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
   `Security`).
2. If `## [Unreleased]` was empty because entries were not kept during
   development, reconstruct them from the commits since the last tag:

   ```sh
   git log --no-merges --pretty='%s (%h)' v<previous>..HEAD
   ```

   Write user-facing entries (what changed and why), not raw commit subjects,
   and cite the PR number (`(#NNN)`) where one exists.
3. Update the reference-link footer at the bottom of `CHANGELOG.md`: point
   `[Unreleased]` at `compare/v<X.Y.Z>...HEAD` and add a `[X.Y.Z]` line for the
   new version (`compare/v<previous>...v<X.Y.Z>`):

   ```markdown
   [Unreleased]: https://github.com/t09tanaka/laurel/compare/vX.Y.Z...HEAD
   [X.Y.Z]: https://github.com/t09tanaka/laurel/compare/v<previous>...vX.Y.Z
   ```
4. Sanity-check that the new section extracts cleanly — this is exactly what the
   GitHub Release step consumes:

   ```sh
   bun run release:notes X.Y.Z --no-gh
   ```

   `--no-gh` skips the GitHub API call (the tag does not exist yet at this
   point) and prints the CHANGELOG section plus the compare link. If it errors
   with "No CHANGELOG.md section found", the heading does not match `## [X.Y.Z]`.

### 5. Validate the full build chain

```sh
bun run check
bun run typecheck
bun test
```

All three must be green. Then regenerate every embedded bundle so the tagged commit captures the latest source:

```sh
bun run build:dashboard-bundle
bun run build:skill-bundle
bun run build:cli
bun run build:types
```

### 6. Sanity-check the publish artifact

```sh
npm pack --dry-run
```

Inspect the file list. Anything obviously oversized or unexpected (e.g. `.theme-cache/`, `coverage/`, source maps you do not mean to ship) means `files:` in `package.json` is missing something — fix that before publishing.

### 7. Commit + tag

```sh
git add \
  package.json \
  CHANGELOG.md \
  src/cli/dashboard/bundled-assets.ts \
  src/cli/skill/bundled-skills.ts \
  # any other generated artifact that changed
git commit -m "release: v<X.Y.Z>"
git tag v<X.Y.Z>
```

`CHANGELOG.md` must be in the release commit — `release:notes` in step 9 reads the working-copy `CHANGELOG.md`, so committing it here (and running both steps from the same clean checkout) keeps the tagged content and the generated release notes identical. Use `release:` as the commit prefix so the tag and changelog story stay easy to grep. Never `git commit --amend` a release commit — if you need to fix something after tagging, delete the tag, make a new commit, re-tag.

### 8. Push the release commit and tag

```sh
git push origin main
git push origin v<X.Y.Z>
```

The tag must reach GitHub before step 9 — `gh` resolves the release notes' PR
and contributor list from the pushed tag. There is no CI publish workflow to
trigger.

### 9. Create the GitHub Release

Every tag gets a GitHub Release, generated from `CHANGELOG.md` so the release
notes never drift from the changelog. `bun run release:notes` combines the
curated CHANGELOG section with GitHub's auto-generated "What's Changed" /
"New Contributors" list and a full-changelog compare link:

```sh
bun run release:notes X.Y.Z > /tmp/laurel-release-notes.md
gh release create v<X.Y.Z> \
  --title "v<X.Y.Z>" \
  --notes-file /tmp/laurel-release-notes.md \
  --verify-tag
```

`--verify-tag` refuses to create the release if the tag was never pushed
(catches a skipped step 8). For a pre-release, add `--prerelease`. If
`release:notes` prints a warning that it could not reach the GitHub API, the tag
is probably not pushed yet — push it and re-run.

To inspect the generated body before publishing the release:

```sh
bun run release:notes X.Y.Z        # prints the full body to stdout
```

### 10. Publish to npm (local)

```sh
npm whoami                       # confirm you are logged in (else `npm login`)
npm view @t09tanaka/laurel version   # confirm this version is not already published
npm publish
```

`access: public` and `provenance: false` come from `publishConfig`, so no flags
are needed. `prepublishOnly` re-runs the full bundle chain, so `npm publish` from
a clean checkout produces a correct artifact. Do not pass `--provenance` locally —
it requires CI OIDC and fails with `provider: null`.

### 11. Verify

```sh
npm view @t09tanaka/laurel version    # should match the new tag
npx @t09tanaka/laurel@latest --version  # round-trip through the registry
```

## When something breaks

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm publish` fails on auth | not logged in | `npm whoami` → `npm login` |
| `prepublishOnly` fails on `build:cli` | source bundle out of sync | re-run `bun run build:dashboard-bundle && bun run build:skill-bundle` first |
| Tagged commit missing a bundle update | forgot to stage the generated file | delete the tag (`git tag -d v<X.Y.Z>` + `git push origin :refs/tags/v<X.Y.Z>`), commit the missing file, re-tag, re-publish |
| Published version has wrong files | `files:` in `package.json` overspecified | bump patch, fix `files:`, re-release |
| `release:notes` errors "No CHANGELOG.md section found" | heading does not match `## [X.Y.Z]` or CHANGELOG not updated | fix the heading / complete step 4 |
| `gh release create` fails on `--verify-tag` | tag not pushed | run step 8 (`git push origin v<X.Y.Z>`) first |
| GitHub Release body missing the PR / contributor list | tag was not on the remote when notes were generated | delete the release, push the tag, re-run step 9 |

## Out of scope

- Non-npm distribution (binaries, Homebrew, Scoop, Docker images) — not provided. npm is the only official channel; any other packaging is left to downstream maintainers
