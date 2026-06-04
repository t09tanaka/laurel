# Nix Packaging

`flake.nix` packages the prebuilt Linux release binaries for `x86_64-linux` and
`aarch64-linux`. Before publishing, update `version` and the two placeholder
hashes from the release assets:

```sh
nix flake prefetch github:t09tanaka/laurel/<tag>
```

The flake is intentionally a template. It is not wired into release automation
until a maintainer owns Nixpkgs or a dedicated flake repository updates.
