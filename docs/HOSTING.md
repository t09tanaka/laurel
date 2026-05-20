# Hosting Nectar sites

Nectar emits plain static files. Anything served at request time — TLS,
HTTP response headers, redirects, cache rules — is the host's job. This page
collects the operator-facing pieces of that contract in one place:

- [`docs/security/hosting.md`](./security/hosting.md) — copy-pasteable
  **security header** snippets (HSTS, CSP, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`) for
  Cloudflare Pages, Vercel, Netlify, and GitHub Pages. Start here for any new
  deploy.
- [`docs/security/threat-model.md`](./security/threat-model.md) —
  build-time security model. Covers `build.allow_code_injection`,
  `codeinjection_head` / `codeinjection_foot`, `unsafe_html`, and other
  raw-HTML exits. Read this before flipping `allow_code_injection = true`.
- [`docs/deploy/cloudflare-pages.md`](./deploy/cloudflare-pages.md) —
  Cloudflare Pages quickstart covering the Git-connected build, generated
  `_headers` / `_routes.json`, redirects, and `nectar deploy cloudflare`.
- [`docs/deploy/cloudflare-pages-r2-images.md`](./deploy/cloudflare-pages-r2-images.md)
  — move image variants to R2 when a Pages deploy approaches the 25,000-file
  limit, including the private-bucket Worker pattern, R2 endpoint/credential
  setup, and the difference between scoped image sync and `nectar deploy r2`.
- [`docs/tutorials/04-deploy.md`](./tutorials/04-deploy.md) — host-by-host
  deploy walkthroughs (Cloudflare Pages, Vercel, Netlify, GitHub Pages),
  without security headers wired in. Pair with `security/hosting.md` for the
  full set.
- [`docs/deploy/github-pages.md`](./deploy/github-pages.md) — GitHub Pages
  quickstart with the recommended Actions artifact workflow, project-site
  `base_path`, `.nojekyll`, and `CNAME` notes.
- [`docs/deploy/netlify.md`](./deploy/netlify.md) — Netlify-specific
  quickstart for Git builds and CI uploads, including Nectar's generated
  `_headers` / `_redirects` behavior.
- [`docs/deploy/s3-cloudfront.md`](./deploy/s3-cloudfront.md) — AWS S3 +
  CloudFront quickstart, including the GitHub Actions workflow template,
  private S3 origin notes, directory-style URL rewrites, and
  `nectar deploy s3`.
- [`SECURITY.md`](../SECURITY.md) — how to report vulnerabilities and the
  trust model for content contributors.

## Quick start

If you just want a defensible default stack on a new deploy:

1. Pick your host's section in
   [`docs/security/hosting.md`](./security/hosting.md) and drop the
   `_headers` / `vercel.json` / `netlify.toml` snippet into the repo root.
2. Verify with `curl -sI https://your-site.example/ | sort` after the next
   deploy — you should see `Strict-Transport-Security`,
   `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy`, and `Permissions-Policy`.
3. Run the deployed URL through
   [securityheaders.com](https://securityheaders.com/) or
   [Mozilla Observatory](https://observatory.mozilla.org/) to confirm the
   grade.

For Cloudflare Pages specifically, start with
[`docs/deploy/cloudflare-pages.md`](./deploy/cloudflare-pages.md) before adding
the stricter security header baseline. If the build is image-heavy, check the
file count before wiring the final deploy:

```sh
bunx nectar build
find dist -type f | wc -l
```

Cloudflare Pages rejects uploads above 25,000 files. Around 20,000 files, plan
the R2 image-origin split in
[`docs/deploy/cloudflare-pages-r2-images.md`](./deploy/cloudflare-pages-r2-images.md)
instead of waiting for a failed Pages upload.

## Code injection

`build.allow_code_injection` is **off by default**. When off, per-post
`codeinjection_head` / `codeinjection_foot` frontmatter and site-level
`[site].codeinjection_head` / `[site].codeinjection_foot` config are dropped
at config / content load time, with a warning. When on, those values ship
verbatim into `{{ghost_head}}` / `{{ghost_foot}}` — including any inline
`<script>`. Combine that with a baseline CSP that allows `'unsafe-inline'`
(the default for Ghost-theme compatibility) and a single PR can ship
site-wide JS once merged.

If you flip the flag on, treat every PR that touches `content/` like a code
review of the inlined HTML. See
[`security/threat-model.md` § Render-side raw-HTML exits](./security/threat-model.md#render-side-raw-html-exits--ghost_head--ghost_foot).

## What this page is not

- A general "how to host static sites" tutorial — the deploy walkthroughs
  under `tutorials/` are the right starting point if you've never shipped a
  Nectar build.
- A platform comparison — the hosts covered are the ones whose deploy
  conventions Nectar documents or emits first-class static artifacts for.
