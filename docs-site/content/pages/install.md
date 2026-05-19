---
title: "Install"
slug: install
date: 2026-05-20T00:00:00Z
authors: [nectar]
meta_title: "Install | Nectar Docs"
meta_description: "How to install the Nectar CLI on macOS, Linux, and Windows."
---

# Install

Nectar ships as a self-contained binary for each tagged release, plus an npm
package for projects that already have a JavaScript toolchain.

## Prebuilt binaries (no Bun required)

Grab the artifact that matches your platform from the latest
[GitHub Release](https://github.com/t09tanaka/nectar/releases), verify the
checksum from `SHASUMS256.txt`, and drop it on your `$PATH`.

```bash
# macOS (Apple Silicon)
curl -L -o nectar \
  https://github.com/t09tanaka/nectar/releases/latest/download/nectar-darwin-arm64
chmod +x nectar
./nectar --help
```

Available triples: `nectar-linux-x64`, `nectar-linux-arm64`,
`nectar-darwin-x64`, `nectar-darwin-arm64`, `nectar-windows-x64.exe`.

## npm

```bash
npm i -g nectar
```

The npm distribution requires [Bun](https://bun.sh) >= 1.3 on the host
machine.

## From source

```bash
git clone https://github.com/t09tanaka/nectar.git
cd nectar
bun install
bun run build
```

## Verify

```bash
nectar --version
nectar build --help
```

> The canonical install matrix lives in the repo
> [`README.md`](https://github.com/t09tanaka/nectar/blob/main/README.md#install)
> and `docs/cli.md`. This page tracks the user-facing surface and is the entry
> point for the install guide on the docs site.
