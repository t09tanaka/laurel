# `examples/ci/` — GitHub Actions deploy templates

This directory holds **starter workflows** for shipping a Nectar build to
common static-site hosts. Each file is a self-contained `.yml` that runs
`nectar build` on push to `main` and hands the resulting `dist/` to a
provider-specific deploy step.

These are **templates**, not active CI. To use one, copy the file you want
into `.github/workflows/` in your own repo, fill in the placeholder secrets /
variables called out in the header comment, and commit.

## Shared conventions

Every workflow follows the same shape so they are easy to diff and compare:

- Triggered on `push` to `main` and on manual `workflow_dispatch`.
- Uses `oven-sh/setup-bun@v2` pinned to Bun `1.3.0` (matches `package.json#engines`).
- Installs with `bun install --frozen-lockfile` to lock the dependency tree to
  the committed `bun.lock`.
- Builds with `bunx nectar build` and treats `dist/` as the deployable artifact.
- Wraps long-running deploys in a `concurrency` group so back-to-back pushes
  cancel the in-flight run.
- Pins each `actions/*` to a major version (`@v4`) to dodge breaking changes
  without manually bumping every patch release.

If your repo already uses a different Bun version, update the `bun-version`
line in the workflow you copy.

## What lives here

| File                  | Target host         | Auth knobs you must provide                                                                                          |
|-----------------------|---------------------|----------------------------------------------------------------------------------------------------------------------|
| `github-pages.yml`    | GitHub Pages        | None — uses the built-in `GITHUB_TOKEN` and the `actions/deploy-pages` flow. Enable Pages -> Source = GitHub Actions. |
| `cloudflare-pages.yml`| Cloudflare Pages    | Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Edit `CLOUDFLARE_PROJECT_NAME` in the workflow env block.    |
| `netlify.yml`         | Netlify             | Secrets `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`. Also deploys PR previews.                                            |
| `netlify-cli.yml`     | Netlify CLI upload  | Secrets `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`. Use when Netlify is not connected to Git and Actions uploads `dist/`. |
| `vercel.yml`          | Vercel              | Secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Uses `vercel deploy --prebuilt`.                        |
| `azure-static-web-apps.yml` | Azure Static Web Apps | Secret `AZURE_STATIC_WEB_APPS_API_TOKEN` from the SWA resource. PR previews land in named slots automatically.       |
| `s3-cloudfront.yml`   | AWS S3 + CloudFront | Secret `AWS_ROLE_TO_ASSUME` (OIDC), `CLOUDFRONT_DISTRIBUTION_ID`. Variables `AWS_REGION`, `S3_BUCKET`.                |
| `fly.yml`             | Fly.io              | Secret `FLY_API_TOKEN`. Needs a `Dockerfile` + `fly.toml` in the repo (sample in the file header).                   |
| `render.yml`          | Render Static Site  | Secret `RENDER_DEPLOY_HOOK_URL`. Build artifact uploaded for inspection, Render does the publish on the hook call.   |

## Picking one

- **Free + zero setup:** `github-pages.yml`. Works as soon as Pages is enabled
  and Source is set to "GitHub Actions". Pair with `[build].base_path = "/<repo>/"`
  in `nectar.toml` if you use a project site URL.
- **CDN-heavy + low cost:** `cloudflare-pages.yml`. Cloudflare's free tier
  covers most blogs. The provider-managed deploys keep preview URLs per branch.
- **Marketing-site features (forms, redirects, edge functions):** Netlify or
  Vercel. For Netlify's native Git integration, use the `netlify.toml` flow in
  `docs/deploy/netlify.md`. If GitHub Actions should upload `dist/` to a
  Netlify site that is not connected to Git, copy `netlify-cli.yml`.
- **You already live in AWS:** `s3-cloudfront.yml`. Pair with the CloudFront
  Function at `examples/s3-cloudfront/append-index.js` to keep directory-style
  URLs working from an S3 origin. The full setup checklist lives in
  `docs/deploy/s3-cloudfront.md`.
- **You need a server next to the site:** `fly.yml` or `render.yml`. Both ship
  the build inside a tiny container alongside whatever app you add later.

## Things these templates deliberately skip

- **Lint/test on the deploy path.** Run `bun run check && bun test` in a
  separate workflow (e.g. a `ci.yml`). Mixing test and deploy makes failures
  ambiguous and slows the deploy cycle.
- **Per-provider caching of `node_modules` / `~/.bun/install/cache`.**
  `setup-bun@v2` already caches the global Bun store. Adding `actions/cache`
  layers on top mostly helps repos with very large dependency trees.
- **Multi-environment fan-out (staging vs. prod).** Add another job, or
  duplicate the workflow and gate it on `environment:`. Kept out so the
  starter stays scannable.

If something doesn't fit, copy the closest template and edit it. These are
starting points, not a framework.
