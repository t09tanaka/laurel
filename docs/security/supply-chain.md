# Supply Chain Integrity

Nectar treats `bun.lock` as the source of truth for package resolution. Install dependencies with:

```sh
bun install --frozen-lockfile
```

or:

```sh
bun run verify:lockfile
```

The frozen install must fail if `package.json` and `bun.lock` drift. It also forces Bun to resolve packages from the locked entries instead of refreshing dependency versions during CI.

GitHub Actions jobs that install dependencies use `bun install --frozen-lockfile`, including CI, lint, coverage, release, preview, docs-site, and security checks. The security workflow also runs `bun audit` and `bun pm scan` against the lockfile so advisory and integrity checks fail before build or publish steps run.
