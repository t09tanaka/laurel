# Release operations

Tagged releases are published by `.github/workflows/release.yml`. The workflow
verifies the tag, builds platform binaries, publishes build provenance, creates
the GitHub Release, and publishes the npm package.

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
