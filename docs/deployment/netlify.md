# Netlify deployment recipe

Use this target when Netlify should build Nectar, publish `dist/`, and manage
deploy previews.

## Recipe

1. Set `site.url`; Netlify preview URLs can still override this during builds.
2. Enable `[deploy.netlify]` so Nectar emits `_headers` and `_redirects`.
3. Run `bunx nectar build` and confirm the generated Netlify files.
4. In Netlify, use build command `bunx nectar build` and publish directory
   `dist`.
5. Use the CLI workflow only when CI, not Netlify, owns the upload.
6. Verify preview canonical URLs, redirects, headers, RSS, sitemap, and 404s.

## Source docs

- Full guide: [`docs/deploy/netlify.md`](../deploy/netlify.md)
- Netlify config example: [`examples/deploy/netlify/netlify.toml`](../../examples/deploy/netlify/netlify.toml)
- CI examples: [`examples/ci/netlify.yml`](../../examples/ci/netlify.yml) and [`examples/ci/netlify-cli.yml`](../../examples/ci/netlify-cli.yml)
