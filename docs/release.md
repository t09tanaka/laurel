# Release operations

Tagged releases are published by `.github/workflows/release.yml`. The workflow
verifies the tag, builds platform binaries, publishes build provenance, creates
the GitHub Release, and publishes the npm package.

## SBOM and npm provenance

The release workflow generates `release/nectar.cyclonedx.json` with
`bun run sbom:cyclonedx` and uploads it as `nectar.cyclonedx.json` next to the
release binaries. The SBOM is generated after `bun install --frozen-lockfile`, so
it reflects the reviewed `bun.lock` dependency graph instead of resolving new
versions during release.

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
repository remains private, the workflow still builds the SBOM and GitHub
Release assets for internal use, but skips npm publication because npm
provenance requires a public source repository. Public npm releases additionally
require the `NPM_TOKEN` secret or an npm trusted publisher configuration that
matches this workflow.

## Platform binary signing

Release binaries are signed before they are uploaded as release artifacts:

- `nectar-darwin-x64` and `nectar-darwin-arm64` are built on `macos-14`, signed
  with an Apple Developer ID Application certificate, and submitted to Apple
  notarization with `xcrun notarytool`.
- `nectar-windows-x64.exe` is built on `windows-latest` and signed with
  Authenticode.
- Linux binaries are not code-signed. They are covered by `SHASUMS256.txt` and
  GitHub build provenance attestations.

The workflow fails the release job with a clear missing-secret error when a
required signing secret is absent. This does not affect normal pull request or
branch CI because signing only runs in the release workflow.

## Required GitHub secrets

macOS signing and notarization require these repository secrets:

| Secret | Description |
| --- | --- |
| `APPLE_DEVELOPER_ID_CERT_BASE64` | Base64-encoded `.p12` export containing the Developer ID Application certificate and private key. |
| `APPLE_DEVELOPER_ID_CERT_PASSWORD` | Password for the `.p12` export. |
| `APPLE_TEAM_ID` | Apple Developer Team ID used for signing and notarization. |
| `APPLE_NOTARYTOOL_APPLE_ID` | Apple ID email used by `xcrun notarytool`. |
| `APPLE_NOTARYTOOL_PASSWORD` | App-specific password or notarytool password for the Apple ID. |

Windows signing requires these repository secrets:

| Secret | Description |
| --- | --- |
| `WINDOWS_SIGNING_CERT_BASE64` | Base64-encoded `.pfx` export containing the Authenticode code-signing certificate and private key. |
| `WINDOWS_SIGNING_CERT_PASSWORD` | Password for the `.pfx` export. |

## Optional GitHub variables

| Variable | Default | Description |
| --- | --- | --- |
| `WINDOWS_SIGNING_TIMESTAMP_URL` | `http://timestamp.digicert.com` | Authenticode timestamp server URL. |

## Preparing certificate secrets

Encode certificate files without committing them to the repository:

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
base64 -i AuthenticodeSigning.pfx | pbcopy
```

Paste the resulting values into the matching GitHub repository secrets. Keep the
certificate files outside the repository and rotate the secrets if an export is
lost or shared accidentally.

## Verification after release

Consumers can verify release assets with:

```bash
shasum -a 256 -c SHASUMS256.txt --ignore-missing
gh attestation verify <binary> --repo t09tanaka/nectar
```

On macOS, `codesign --verify --strict --verbose=2 <binary>` checks the Developer
ID signature. On Windows, `Get-AuthenticodeSignature .\nectar-windows-x64.exe`
checks the Authenticode signature.

## Homebrew tap formula

The release workflow generates a `nectar.rb` Homebrew formula from
`packaging/homebrew/Formula/nectar.rb.template` and uploads it next to the
release binaries. The generated formula embeds the release tag and the
platform-specific SHA-256 values from `SHASUMS256.txt`.

The public tap should live in a separate `t09tanaka/homebrew-nectar` repository
with the generated file at `Formula/nectar.rb`. After the GitHub Release is
created, the `bump-homebrew-tap` job uses `Homebrew/actions/setup-homebrew`,
regenerates that formula from the release checksums, runs `brew audit`, and
opens a pull request against the tap. The job requires a `HOMEBREW_TAP_TOKEN`
repository secret with permission to push branches and open pull requests in the
tap repository.

Users can install the CLI with:

```bash
brew tap t09tanaka/nectar
brew install nectar
```

To regenerate the formula locally before updating the tap:

```bash
bun run homebrew:formula -- \
  --version v0.1.0 \
  --shasums dist-bin/SHASUMS256.txt \
  --output ../homebrew-nectar/Formula/nectar.rb
ruby -c ../homebrew-nectar/Formula/nectar.rb
brew audit --new --strict ../homebrew-nectar/Formula/nectar.rb
```

The tap repository layout and automation notes are tracked in
`packaging/homebrew-tap/README.md`.

## Scoop bucket manifest

The release workflow also generates a `nectar.json` Scoop manifest from
`packaging/scoop/bucket/nectar.json.template` and uploads it next to the
release binaries. The generated manifest points at `nectar-windows-x64.exe`,
aliases it to the `nectar` command, and embeds the SHA-256 value from
`SHASUMS256.txt`.

The public bucket should live in a separate `t09tanaka/scoop-nectar` repository
with the generated file copied to `bucket/nectar.json`. After that bucket
exists, Windows users can install the CLI with:

```powershell
scoop bucket add nectar https://github.com/t09tanaka/scoop-nectar
scoop install nectar
```

To regenerate the manifest locally before updating the bucket:

```bash
bun run scoop:manifest -- \
  --version v0.1.0 \
  --shasums dist-bin/SHASUMS256.txt \
  --output ../scoop-nectar/bucket/nectar.json
bun -e 'JSON.parse(await Bun.file("../scoop-nectar/bucket/nectar.json").text())'
```
