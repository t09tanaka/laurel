# Deploying Nectar to Vercel

Vercel can build a Nectar site from Git or receive a pre-built `dist/`
directory from CI. Nectar has two Vercel-specific pieces:

- `[deploy.vercel]` controls build output for Vercel: a generated
  `vercel.json` at the publish root.
- `nectar deploy vercel` shells out to the Vercel CLI for manual or CI-driven
  uploads of an already-built `dist/`.

Use the Git-connected Vercel flow when Vercel should build every push from the
repository. Use the prebuilt GitHub Actions workflow when GitHub Actions should
own the build, preview, and production promotion flow. Use `nectar deploy
vercel` for manual or custom CI uploads of an already-built `dist/`.

## Quickstart: Vercel builds from Git

1. In `nectar.toml`, enable the Vercel output file:

   ```toml
   [deploy.vercel]
   enabled = true
   ```

   This makes `nectar build` write `dist/vercel.json`. The file folds
   `[deploy.headers]` cache and security headers plus `redirects.yaml` into
   Vercel's native `headers` and `redirects` arrays, and sets Vercel's clean
   URL and trailing-slash behavior from `build.trailing_slash`.

2. Build locally once before wiring Vercel:

   ```sh
   bunx nectar build
   test -f dist/vercel.json
   ```

3. In Vercel, choose **Add New -> Project**, import the repository, and set:

   | Field | Value |
   | --- | --- |
   | Framework Preset | `Other` |
   | Build Command | `bunx nectar build` |
   | Output Directory | `dist` |
   | Install Command | leave blank unless your repo needs a custom install step |
   | Root Directory | blank, unless Nectar lives in a monorepo subdirectory |

4. Deploy.

Vercel detects Bun from `bun.lock`, so a separate `BUN_VERSION` environment
variable is not required for the default Git-connected build.

Nectar is not a Next.js app. It emits a static `dist/` directory directly, so
Next.js-only settings such as `output: 'export'`, `next.config.js`, or a Vercel
adapter are unnecessary and do not apply. Keep the Vercel Framework Preset set
to `Other`, the Build Command set to `bunx nectar build`, and the Output
Directory set to `dist`.

## 404 pages

Nectar always emits `dist/404.html`. If the active theme provides
`error-404.hbs` or `error.hbs`, that template renders the file; otherwise
Nectar writes its built-in branded 404 page.

Vercel treats a `404.html` file at the output root as the custom not-found
page for static site generators. With the Output Directory set to `dist`, an
unmatched URL such as `/missing-page/` receives Vercel's 404 status while
serving Nectar's `dist/404.html` body. No extra rewrite or `routes` entry is
needed for the standard filename.

Keep `404.html` at the publish root. Do not add a catch-all rewrite from
`/(.*)` to `/404.html`; that would turn every unknown URL into an ordinary
rewrite and can mask the intended 404 response semantics. Only use Vercel
`routes` if you intentionally rename the not-found file, which Nectar does
not do by default.

## Clean URLs and trailing slashes

Nectar route pages are directory-index files by default, such as
`dist/about/index.html`, with canonical URLs like `/about/`. The default
`build.trailing_slash = "always"` matches that output, so generated
`dist/vercel.json` includes:

```json
{
  "cleanUrls": true,
  "trailingSlash": true
}
```

If you opt into `build.trailing_slash = "never"`, Nectar still emits
`cleanUrls: true`, but it writes `trailingSlash: false` instead of forcing
slashes. This avoids combining Vercel's `.html` / `index.html` stripping with
a trailing-slash redirect policy that does not match the configured canonical
URLs. This setting controls Vercel URL normalization; it does not rewrite the
static route file layout.

When maintaining `vercel.json` by hand, only use `cleanUrls: true` together
with `trailingSlash: true` for an always-slash build. For no-slash deployments,
pair `cleanUrls: true` with `trailingSlash: false`.

## Redirects

Add redirects to `redirects.yaml` at the project root:

```yaml
- from: /feed
  to: /rss.xml
  status: 301
- from: /old-post/
  to: /new-post/
  status: 308
  force: true
```

With `[deploy.vercel].enabled = true`, Nectar writes those rules to
`dist/vercel.json`:

```json
{
  "cleanUrls": true,
  "trailingSlash": true,
  "redirects": [
    { "source": "/feed", "destination": "/rss.xml", "statusCode": 301 },
    { "source": "/old-post/", "destination": "/new-post/", "statusCode": 308 }
  ]
}
```

Supported status codes are `301`, `302`, `307`, and `308`; omitted status
defaults to `301`. If two rules share the same `from`, the first rule wins.
Vercel always applies redirects even when a static file exists at the source
path, so `force` is accepted in shared `redirects.yaml` files but does not add
an extra Vercel field.

## Headers and caching

When `[deploy.vercel].enabled = true`, every build writes `dist/vercel.json`
with Vercel header rules. The defaults mirror the other generated deploy
targets:

| Path | Cache-Control |
| --- | --- |
| `/assets/*` | `public, max-age=31536000, immutable` |
| `/content/images/*` | `public, max-age=31536000, immutable` |
| `/*` | `public, max-age=0, must-revalidate` |

The catch-all route also receives the baseline security headers from
`[deploy.headers].security`, including `X-Content-Type-Options` and
`Referrer-Policy` by default. Nectar translates glob `*` patterns to Vercel's
path-to-regexp shape, so `/*` is emitted as `/(.*)`.

Do not also hand-maintain the same `headers` or `redirects` in a repo-root
`vercel.json` unless you intentionally want Vercel-owned config to take over.
If your `static/` passthrough contains `vercel.json`, it can overwrite the
generated publish-root file during the build.

## CLI deploys with `nectar deploy vercel`

For a manual deploy or a CI job that should call the Vercel CLI directly,
optionally configure the deploy target:

```toml
[deploy.vercel]
enabled = true
# project = "team-or-scope" # optional; forwarded as --scope
# prod = true              # default; set false for preview-only deploys
```

Then run:

```sh
bunx nectar deploy vercel --build
```

The command runs `nectar build` first, checks that
`dist/.nectar-manifest.json` exists, then executes:

```sh
vercel deploy dist --prod
```

In CI, set `VERCEL_TOKEN`; otherwise the Vercel CLI falls back to interactive
login. You can audit the exact command without uploading:

```sh
bunx nectar deploy vercel --dry-run
```

Pass `--project-name` or set `[deploy.vercel].project` when the CLI should
receive `--scope <value>`. If the project has already been linked with
`vercel link`, leave it unset and let the Vercel CLI use `.vercel/project.json`.

## GitHub Actions prebuilt workflow

If GitHub Actions should be the only deploy driver, disable Vercel's native Git
integration for the project, then copy
[`examples/ci/vercel.yml`](../../examples/ci/vercel.yml) to
`.github/workflows/vercel.yml`.

Keep the linked Vercel project settings aligned with the Git-connected
quickstart:

| Field | Value |
| --- | --- |
| Framework Preset | `Other` |
| Build Command | `bunx nectar build` |
| Output Directory | `dist` |
| Install Command | leave blank unless your repo needs a custom install step |

Do not add Next.js export or adapter settings for this workflow. The Vercel CLI
packages Nectar's static `dist/` output during `vercel build`; there is no
Next.js `output: 'export'` phase to configure.

Add repository secrets:

| Secret | Value |
| --- | --- |
| `VERCEL_TOKEN` | Personal token from Vercel account settings |
| `VERCEL_ORG_ID` | From `.vercel/project.json` after `vercel link` or `vercel pull` |
| `VERCEL_PROJECT_ID` | From `.vercel/project.json` after `vercel link` or `vercel pull` |

That workflow uses `oven-sh/setup-bun@v2`, installs with `bun install
--frozen-lockfile`, runs `vercel pull` for the matching production or preview
environment, runs `vercel build` so the Vercel CLI turns `bunx nectar build`
and `dist/` into `.vercel/output`, then publishes `main` with `vercel deploy
--prebuilt --prod`. Other branches and pull requests publish preview deploys
with `vercel deploy --prebuilt`.

This workflow is different from `nectar deploy vercel`: the sample delegates
the build packaging to Vercel CLI's prebuilt pipeline, while `nectar deploy
vercel --build` runs `nectar build` directly and then calls `vercel deploy
dist --prod`. Prefer the sample when you want GitHub Actions parity with
Vercel preview/production environments; prefer `nectar deploy vercel` for a
small manual command or bespoke CI script.

## Preview deploys

On Git-connected preview and branch builds, Vercel provides `VERCEL_URL`.
Nectar uses it automatically as the `site.url` fallback when
`NECTAR_SITE_URL` is unset. Vercel usually provides this value without a
scheme, so Nectar treats it as HTTPS before building canonical, sitemap, RSS,
and Open Graph URLs. Vercel's `VERCEL_GIT_COMMIT_REF` and
`VERCEL_GIT_COMMIT_SHA` are also exposed to themes as `@site.build.branch` and
`@site.build.commit_sha`.

The URL precedence remains:

```text
--base-url > NECTAR_BUILD_BASE_URL > NECTAR_SITE_URL > VERCEL_URL > site.url
```

Use `--base-url` when you need to force a different host:

```sh
bunx nectar build --base-url https://your-preview.vercel.app
```

If the preview is served from a subpath, pair that with `--base-path` or set
`[build] base_path = "/preview/"` in `nectar.toml`.

## Troubleshooting

- **No `vercel.json` in the deploy:** confirm `[deploy.vercel].enabled = true`
  and that no file in the static passthrough directory overwrote
  `dist/vercel.json`.
- **`nectar deploy vercel` opens an interactive login:** set `VERCEL_TOKEN` in
  the environment.
- **The CLI deploy targets the wrong project:** run `vercel link`, or set
  `[deploy.vercel].project` / pass `--project-name` so Nectar forwards
  `--scope`.
- **Redirects do not work:** confirm `redirects.yaml` is at the project root,
  rebuild, and inspect the generated `redirects` array in `dist/vercel.json`.
- **Security headers need to be stricter:** start with
  [`docs/security/hosting.md`](../security/hosting.md), then adjust
  `[deploy.headers]` in `nectar.toml`.
