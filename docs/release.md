# Release operations

Laurel is distributed exclusively on npm. Releases are published manually with a
local `npm publish` from a clean `main` checkout — there is no CI publish
workflow. The end-to-end steps (version bump, CHANGELOG update, bundle
regeneration, validation, tag, GitHub Release, publish) are documented in the
`laurel-release` skill; this page covers the publish mechanics, the GitHub
Release, and the supply-chain artifacts.

## Publishing

From a clean `main` checkout, after the `laurel-release` prep (version bump,
bundle regeneration, `release:` commit and `v<X.Y.Z>` tag):

```bash
npm publish
```

`access: public` and `provenance: false` come from `publishConfig` in
`package.json`, so no flags are needed. The `prepublishOnly` hook regenerates
every embedded bundle (`build:dashboard-bundle && build:skill-bundle &&
build:cli && build:types`), so the published artifact always matches source.

npm provenance is intentionally disabled: provenance attestation requires CI
OIDC and fails locally with `provider: null`. Re-enable it (and a CI publish
path) only if/when publishing moves back into CI.

## GitHub Release

Every pushed `v<X.Y.Z>` tag gets a GitHub Release whose body is generated from
`CHANGELOG.md` — the changelog is the single source of truth, so the release
notes never drift from it. The `release:notes` script combines the curated
CHANGELOG section with GitHub's auto-generated PR / "New Contributors" list and
a full-changelog compare link:

```bash
bun run release:notes X.Y.Z > /tmp/laurel-release-notes.md
gh release create v<X.Y.Z> \
  --title "v<X.Y.Z>" \
  --notes-file /tmp/laurel-release-notes.md \
  --verify-tag
```

The tag must be pushed first — `gh` resolves the PR/contributor list from the
tag on the remote. Run `bun run release:notes X.Y.Z` on its own to preview the
body, or add `--no-gh` to render only the CHANGELOG section and compare link
without contacting the GitHub API (useful before the tag exists).

## SBOM

A CycloneDX SBOM can be generated locally from the reviewed `bun.lock` graph
without publishing anything:

```bash
bun install --frozen-lockfile
bun run sbom:cyclonedx
```

The SBOM is written to `dist-sbom/laurel.cyclonedx.json`.

## Verification after release

```bash
npm view @t09tanaka/laurel version    # should match the new tag
npx @t09tanaka/laurel@latest --version
```
