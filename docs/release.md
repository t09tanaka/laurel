# Release operations

Laurel is distributed exclusively on npm. Releases are published manually with a
local `npm publish` from a clean `main` checkout — there is no CI publish
workflow. The end-to-end steps (version bump, bundle regeneration, validation,
tag, publish) are documented in the `laurel-release` skill; this page covers the
publish mechanics and the supply-chain artifacts.

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
