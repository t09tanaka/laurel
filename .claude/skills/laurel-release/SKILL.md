---
name: laurel-release
description: Use when preparing a new npm release of the Laurel CLI. Runs the prepublish chain (skill bundle, dashboard bundle, CLI bundle, types), validates with check/typecheck/test, bumps the package version, creates a release commit + tag, and primes the repo so `npm publish` is the only remaining manual step. Explicitly does NOT publish on CI — every release is a deliberate manual act.
---

# Releasing Laurel to npm

Laurel's only distribution channel is npm. Releases are published manually with a local `npm publish` from a clean `main` checkout — there is no CI publish workflow. This skill covers the full manual flow: version bump, bundle regeneration, validation, commit + tag, and publish.

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

### 4. Validate the full build chain

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

### 5. Sanity-check the publish artifact

```sh
npm pack --dry-run
```

Inspect the file list. Anything obviously oversized or unexpected (e.g. `.theme-cache/`, `coverage/`, source maps you do not mean to ship) means `files:` in `package.json` is missing something — fix that before publishing.

### 6. Commit + tag

```sh
git add \
  package.json \
  src/cli/dashboard/bundled-assets.ts \
  src/cli/skill/bundled-skills.ts \
  # any other generated artifact that changed
git commit -m "release: v<X.Y.Z>"
git tag v<X.Y.Z>
```

Use `release:` as the commit prefix so the tag and changelog story stay easy to grep. Never `git commit --amend` a release commit — if you need to fix something after tagging, delete the tag, make a new commit, re-tag.

### 7. Push the release commit and tag

```sh
git push origin main
git push origin v<X.Y.Z>
```

The tag is a release marker only — there is no CI publish workflow to trigger.

### 8. Publish to npm (local)

```sh
npm whoami                       # confirm you are logged in (else `npm login`)
npm view @t09tanaka/laurel version   # confirm this version is not already published
npm publish
```

`access: public` and `provenance: false` come from `publishConfig`, so no flags
are needed. `prepublishOnly` re-runs the full bundle chain, so `npm publish` from
a clean checkout produces a correct artifact. Do not pass `--provenance` locally —
it requires CI OIDC and fails with `provider: null`.

### 9. Verify

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

## Out of scope

- CHANGELOG.md generation — not enforced yet. If you maintain one, update it before step 6
- Non-npm distribution (binaries, Homebrew, Scoop, Docker images) — not provided. npm is the only official channel; any other packaging is left to downstream maintainers
