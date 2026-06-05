# Release operations

Laurel is distributed exclusively on npm. Tagged releases are published by
`.github/workflows/release.yml`, which resolves the tag, runs the full
verification suite (`check` / `typecheck` / `test`), and publishes the npm
package with provenance.

The end-to-end manual release steps (version bump, bundle regeneration, tag,
publish) are documented in the `laurel-release` skill. This page covers the CI
workflow and the supply-chain artifacts it produces.

## SBOM and npm provenance

The release workflow generates a CycloneDX SBOM with `bun run sbom:cyclonedx`
after `bun install --frozen-lockfile`, so it reflects the reviewed `bun.lock`
dependency graph instead of resolving new versions during release. The SBOM is
retained as a workflow artifact (`laurel-cyclonedx-sbom`) for supply-chain
auditing.

To generate the same CycloneDX SBOM locally without publishing anything:

```bash
bun install --frozen-lockfile
bun run sbom:cyclonedx
```

The npm package is published only by the release workflow, using:

```bash
npm publish --provenance --access public
```

Keep that command in CI so npm can attach provenance to the package. If the
repository remains private, the workflow still builds the SBOM for internal use,
but skips npm publication because npm provenance requires a public source
repository. Public npm releases additionally require the `NPM_TOKEN` secret or
an npm trusted publisher configuration that matches this workflow.

## Verification after release

Consumers can verify a published release with npm's provenance attestation:

```bash
npm audit signatures
```

This confirms the package on the registry was built and published by this
repository's release workflow.
