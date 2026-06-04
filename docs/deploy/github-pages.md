# Deploying Laurel to GitHub Pages

GitHub Pages hosts the already-built `dist/` directory. It does not run Bun
itself, so the recommended path is a GitHub Actions workflow that installs Bun,
runs `laurel build`, uploads `dist/` as a Pages artifact, and deploys that
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
   deployed URL in `laurel.toml`:

   ```toml
   [site]
   url = "https://<user>.github.io/<repo>/"
   ```

   In GitHub Actions, when `GITHUB_PAGES=true` and `GITHUB_REPOSITORY` is
   available, Laurel derives `[build].base_path = "/<repo>/"` automatically for
   project sites. Set `[build].base_path` yourself only when you need to
   override the repository-derived path. User / organization sites such as
   `https://<user>.github.io/`, and custom domains served from `/`, keep
   `base_path = "/"`.

4. Build locally before the first push:

   ```sh
   GITHUB_PAGES=true GITHUB_REPOSITORY=<owner>/<repo> bunx laurel build
   test -f dist/.nojekyll
   ```

   For user / organization sites or custom domains, plain `bunx laurel build`
   is enough because the site is served from `/`.

5. Commit and push to `main`. The workflow publishes `dist/` to Pages.

## What Laurel emits for Pages

Every `laurel build` writes an empty `.nojekyll` file at the output root.
GitHub Pages runs Jekyll by default, and Jekyll ignores files or directories
that start with `_`; `.nojekyll` disables that behavior so Laurel's generated
assets are served verbatim.

Laurel writes the not-found page as `dist/404.html`, even when
`[build].base_path` is set for a project site. This matches GitHub Pages'
publishing convention: the `404.html` file belongs at the root of the uploaded
artifact / publishing source. For a project site, Pages exposes that file at
`https://<user>.github.io/<repo>/404.html`; do not move or copy it to
`dist/<repo>/404.html`. `base_path` only changes generated URLs and links, not
the physical `dist/` layout.

GitHub Pages does **not** support arbitrary response headers. Laurel therefore
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

## Redirects

GitHub Pages does not read `_redirects`, `vercel.json`, `.htaccess`, or any
other server-side redirect config. To keep redirects from `redirects.yaml` or
Ghost-style `content/data/redirects.*` on Pages, opt in to static HTML redirect
stubs:

```toml
[deploy.github_pages]
redirects = true
```

Laurel writes one meta-refresh page for each supported `from` path. Clean URLs
such as `/old-post/` become `dist/old-post/index.html`; file-like paths such as
`/old.html` become `dist/old.html`. Each stub points both
`<meta http-equiv="refresh">` and `<link rel="canonical">` at the redirect
destination.

For project Pages with `[build].base_path = "/repo/"`, the file layout remains
rooted at `dist/`, but root-relative destinations are prefixed with the base
path in the generated HTML. For example, `from: /old` and `to: /new` writes
`dist/old/index.html` with a browser redirect to `/repo/new`.

Laurel skips redirects whose source is `/` or `/404.html` so the home page and
GitHub Pages not-found fallback keep working. Pattern redirects such as
`/old/*` cannot be represented as static files on Pages; use a host with native
redirect rules for those.

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
DNS at GitHub Pages. Laurel writes the matching `CNAME` file during the build,
so the Actions artifact keeps the binding in place.

## Optional gh-pages branch deploy

The Actions artifact workflow above is the preferred GitHub Pages setup. It
does not need a separate `gh-pages` branch and uses GitHub's current Pages
deployment API.

Laurel also exposes a `github-pages` deploy target for branch-based publishing:

```sh
laurel deploy github-pages --dry-run
laurel deploy github-pages --branch gh-pages --remote origin
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

- **CSS or assets 404 on project Pages:** confirm the build ran with
  `GITHUB_PAGES=true` and `GITHUB_REPOSITORY=<owner>/<repo>`, or set
  `[build].base_path` to the repo path manually, including leading and trailing
  slashes, for example `"/my-blog/"`.
- **Project Pages 404 page is not being used:** confirm the built artifact
  contains `dist/404.html`, not `dist/<repo>/404.html`. `base_path` should stay
  `"/<repo>/"`, but the file layout remains rooted at `dist/`.
- **The deployed site shows old content:** confirm **Source = GitHub Actions**
  and inspect the latest `Deploy to GitHub Pages` workflow run.
- **Files or directories beginning with `_` are missing:** rebuild and confirm
  `dist/.nojekyll` exists. Laurel emits it automatically on successful builds.
- **Custom domain does not stick:** set `[deploy.github_pages].custom_domain`
  to only the hostname and verify `dist/CNAME` contains that hostname exactly.
- **Need custom security headers:** GitHub Pages does not support custom
  response headers. See [`docs/security/hosting.md`](../security/hosting.md)
  for the available workarounds.
