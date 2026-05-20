# `examples/` — deploy snippets and starter templates

This directory collects **small, copy-pasteable artifacts** that help real users
get a Nectar site off the ground. It is *not* the same as `example/` (singular),
which is the reference blog used by tests and the design docs to prove that the
vendored Ghost Source theme renders end-to-end. Treat `example/` as the
"litmus-test site" and `examples/` as the "starter kit aisle".

## What lives here today

| Folder                     | Purpose                                                                 |
|----------------------------|-------------------------------------------------------------------------|
| `ci/`                      | GitHub Actions workflow templates for shipping a Nectar build to popular static hosts (GitHub Pages, Cloudflare Pages, Netlify, Vercel, Azure Static Web Apps, S3 + CloudFront, Fly.io, Render). See `ci/README.md` for the per-host setup matrix. |
| `deploy/apache/.htaccess`  | Apache HTTPD `.htaccess` with Cache-Control, ETag, security headers, and pre-compressed-sidecar serving. Pairs with `docs/deploy/apache.md`. |
| `deploy/caddy/Caddyfile`   | Caddy v2 server block with HTTPS, header pinning, and `/404.html` fallback. Pairs with `docs/deploy/caddy.md`. |
| `deploy/netlify/netlify.toml` | Netlify build config with `bunx nectar build`, `dist` publishing, `BUN_VERSION`, and a commented Netlify build-plugin block. Pairs with `docs/deploy/netlify.md`. |
| `s3-cloudfront/append-index.js` | CloudFront Function (viewer-request) that rewrites `/about/` to `/about/index.html` so a private S3 origin behind CloudFront serves directory-style URLs. |

These are deliberately tiny: a single file each, with the deploy-platform's
quirks documented in the file header. Copy → paste → fill in the blanks.

## Planned site templates

The deploy snippets above answer *where* to host a Nectar build. They do not
answer *what* the source repo of a real-world blog looks like. Issue
[#920](https://github.com/t09tanaka/nectar/issues/920) tracks adding runnable
**site templates** here, one folder per use case, each with its own
`nectar.toml`, `content/`, and theme reference. The catalog below pins the
intended scope so future PRs can land them incrementally.

Until a template ships, `example/` is the runnable reference — every template
in the list below is a focused subset or extension of it.

| Template folder                       | What it demonstrates                                                                                                | Pairs well with                                       |
|---------------------------------------|---------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| `minimal-blog/`                       | Smallest viable site: one author, a handful of posts, default Source theme, no optional components beyond RSS.       | `ci/github-pages.yml`                                 |
| `photo-blog/`                         | Image-heavy posts, `[content].copy_content_assets = true`, `{{img_url}}` and OG-image generation tuned for galleries. | `s3-cloudfront/append-index.js` (asset-heavy origin)  |
| `multi-author/`                       | Multiple `content/authors/*.md` entries, per-author archives, `{{authors}}` and contributor bylines.                  | `ci/github-pages.yml`                                 |
| `multi-language/`                     | One folder per locale, each its own `nectar.toml` + `content/` tree, demonstrating the **one-build-per-locale** rule from `docs/DESIGN.md` §1. No router fan-out — outputs are stitched at the host. | Any deploy snippet                                    |
| `members-stripe-redirect/`            | `[components.portal]` adapter wired to Stripe Checkout / Customer Portal redirects, paywall truncation via `[content].visibility_policy`. See `docs/MEMBERS.md` for the underlying contract. | Newsletter provider of choice                          |
| `newsletter-rss-only/`                | RSS + JSON feed as the only distribution surface, no on-site search/comments, Buttondown/Beehiiv embed for sign-up. | `ci/github-pages.yml`                                 |

Each template, when added, must:

1. **Be runnable in isolation.** `cd examples/<name> && bun ../../src/cli/index.ts build` produces a working `dist/` against the bundled config.
2. **Vendor or symlink the theme it needs.** Most will reuse `example/themes/source/` via a relative symlink to avoid duplicating the vendored theme. Templates that demonstrate a third-party theme bring their own.
3. **Keep `content/` tiny.** Two or three posts is enough — these are skeletons, not demo blogs.
4. **Document the `nectar.toml` knobs it exercises.** A short `README.md` in the template folder explaining *why* this config exists and which docs section it maps to (e.g. `docs/MEMBERS.md` for the members template).
5. **Stay independent of `example/`.** Tests against `example/` must keep passing without depending on anything under `examples/`.

## Contributing a new template

Open an issue or pick up [#920](https://github.com/t09tanaka/nectar/issues/920)
with the template name in the title (`docs(examples): add minimal-blog
template`). Land one template per PR — bundling templates makes review harder
and makes individual templates harder to revert if the convention shifts later.
