# Nectar Homebrew Tap

This directory documents the separate `t09tanaka/homebrew-nectar` tap repository
that makes `brew tap t09tanaka/nectar && brew install nectar` work for release
users.

The tap repository should contain:

```text
Formula/
  nectar.rb
README.md
```

`Formula/nectar.rb` is generated from
`../homebrew/Formula/nectar.rb.template` by the release workflow after the
GitHub Release exists. The generated formula downloads the signed and notarized
Darwin binaries, or the Linux binaries, from the matching release tag and embeds
the SHA-256 checksums from `SHASUMS256.txt`.

## Release automation

The `bump-homebrew-tap` job in `.github/workflows/release.yml`:

1. downloads `SHASUMS256.txt` from the newly created GitHub Release,
2. generates `Formula/nectar.rb`,
3. validates it with Ruby and `brew audit`, and
4. opens or updates a pull request against `t09tanaka/homebrew-nectar`.

The workflow needs a `HOMEBREW_TAP_TOKEN` repository secret with permission to
push branches and open pull requests in the tap repository.
