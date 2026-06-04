---
title: "Install"
slug: install
date: 2026-05-20T00:00:00Z
authors: [laurel]
meta_title: "Install | Laurel Docs"
meta_description: "How to install the Laurel CLI on macOS, Linux, and Windows."
---

# Install

Laurel ships as a self-contained binary for each tagged release, plus an npm
package for projects that already have a JavaScript toolchain.

## Prebuilt binaries (no Bun required)

Grab the artifact that matches your platform from the latest
[GitHub Release](https://github.com/t09tanaka/laurel/releases), verify the
checksum from `SHASUMS256.txt`, and drop it on your `$PATH`.

```bash
# macOS (Apple Silicon)
curl -L -o laurel \
  https://github.com/t09tanaka/laurel/releases/latest/download/laurel-darwin-arm64
chmod +x laurel
./laurel --help
```

Available triples: `laurel-linux-x64`, `laurel-linux-arm64`,
`laurel-darwin-x64`, `laurel-darwin-arm64`, `laurel-windows-x64.exe`.

## npm

```bash
npm i -g laurel
```

The npm distribution requires [Bun](https://bun.sh) >= 1.3 on the host
machine.

## From source

```bash
git clone https://github.com/t09tanaka/laurel.git
cd laurel
bun install
bun run build
```

## Verify

```bash
laurel --version
laurel build --help
```

> The canonical install matrix lives in the repo
> [`README.md`](https://github.com/t09tanaka/laurel/blob/main/README.md#install)
> and `docs/cli.md`. This page tracks the user-facing surface and is the entry
> point for the install guide on the docs site.
