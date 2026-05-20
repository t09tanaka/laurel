# Deploying Nectar to GitHub Pages

GitHub Pages hosts the already-built `dist/` directory. It does not run Bun
itself, so the recommended path is a GitHub Actions workflow that installs Bun,
runs `nectar build`, uploads `dist/` as a Pages artifact, and deploys that
artifact with `actions/deploy-pages`.

## Quickstart

1. Copy the starter workflow:

   ```sh
   mkdir -p .github/workflows
   cp examples/ci/github-pages.yml .github/workflows/pages.yml
   ```

2. In the GitHub repo, open **Settings -> Pages -> Build and deployment** and
   set **Source** to **GitHub Actions**.

3. If this is a project site at `https://<user>.github.io/<repo>/`, set the
   deployed URL and base path in `nectar.toml`:

   ```toml
   [site]
   url = "https://<user>.github.io/<repo>/"

   [build]
   base_path = "/<repo>/"
   ```

   Skip `base_path` for user / organization sites such as
   `https://<user>.github.io/`, and for custom domains served from `/`.

4. Build locally before the first push:

   ```sh
   bunx nectar build
   test -f dist/.nojekyll
   ```

5. Commit and push to `main`. The workflow publishes `dist/` to Pages.

## What Nectar emits for Pages

Every `nectar build` writes an empty `.nojekyll` file at the output root.
GitHub Pages runs Jekyll by default, and Jekyll ignores files or directories
that start with `_`; `.nojekyll` disables that behavior so Nectar's generated
assets are served verbatim.

GitHub Pages does **not** support arbitrary response headers. Nectar therefore
does not emit a Pages-specific `_headers`, `vercel.json`, or equivalent header
configuration for this target: Pages ignores those files and serves a
platform-controlled header set. In particular, you cannot set
`Content-Security-Policy`, `Referrer-Policy`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy`, or custom cache headers directly on GitHub
Pages.

If you need those headers, use a host or fronting layer that can set them:
Cloudflare Pages, Vercel, Netlify, self-hosted nginx, or a CDN / reverse proxy
in front of the GitHub Pages origin. See
[`docs/security/hosting.md`](../security/hosting.md#github-pages) for the
tradeoffs and examples.

If `[deploy.github_pages].custom_domain` is set, the build also writes a
`CNAME` file at the output root:

```toml
[deploy.github_pages]
custom_domain = "blog.example.com"
```

Use only the hostname, without `https://` or a path. Leave it unset for
`*.github.io` deployments.

## Custom domains

For `https://blog.example.com/`, use the root path:

```toml
[site]
url = "https://blog.example.com/"

[build]
base_path = "/"

[deploy.github_pages]
custom_domain = "blog.example.com"
```

Then configure the domain in **Settings -> Pages -> Custom domain** and point
DNS at GitHub Pages. Nectar writes the matching `CNAME` file during the build,
so the Actions artifact keeps the binding in place.

## Optional gh-pages branch deploy

The Actions artifact workflow above is the preferred GitHub Pages setup. It
does not need a separate `gh-pages` branch and uses GitHub's current Pages
deployment API.

Nectar also exposes a `github-pages` deploy target for branch-based publishing:

```sh
nectar deploy github-pages --dry-run
nectar deploy github-pages --branch gh-pages --remote origin
```

The dry run prints the git push plan and reads defaults from:

```toml
[deploy.github_pages]
branch = "gh-pages"
remote = "origin"
```

Use this path only when your repository is explicitly configured to serve Pages
from a branch. For new sites, prefer the `examples/ci/github-pages.yml`
artifact workflow.

## Troubleshooting

- **CSS or assets 404 on project Pages:** set `[build].base_path` to the repo
  path, including leading and trailing slashes, for example `"/my-blog/"`.
- **The deployed site shows old content:** confirm **Source = GitHub Actions**
  and inspect the latest `Deploy to GitHub Pages` workflow run.
- **Files or directories beginning with `_` are missing:** rebuild and confirm
  `dist/.nojekyll` exists. Nectar emits it automatically on successful builds.
- **Custom domain does not stick:** set `[deploy.github_pages].custom_domain`
  to only the hostname and verify `dist/CNAME` contains that hostname exactly.
- **Need custom security headers:** GitHub Pages does not support custom
  response headers. See [`docs/security/hosting.md`](../security/hosting.md)
  for the available workarounds.
