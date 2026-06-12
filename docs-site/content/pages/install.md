---
title: "Install"
slug: install
date: 2026-05-20T00:00:00Z
authors: [laurel]
meta_title: "Install | Laurel Docs"
meta_description: "How to install the Laurel CLI on macOS, Linux, and Windows."
---

# Install

Laurel is distributed on npm and runs on the [Bun](https://bun.sh) runtime.

## npm

Install Bun >= 1.3 on the host machine, then install the CLI globally:

```bash
npm i -g laurel
```

Or run it without a global install:

```bash
bunx laurel --help
```

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
