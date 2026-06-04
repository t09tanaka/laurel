# Cloudflare Pages deployment recipe

Use this target when you want Cloudflare Pages to build Laurel from Git and
serve `dist/` on Cloudflare's edge network.

## Recipe

1. Set `site.url` to the production Pages or custom-domain URL.
2. Enable `[deploy.cloudflare_pages]` so Laurel emits Pages files.
3. Run `bunx laurel build` and confirm `dist/_headers` and
   `dist/_routes.json` exist.
4. In Cloudflare Pages, use build command `bunx laurel build` and output
   directory `dist`.
5. Set `BUN_VERSION` to a supported Bun version.
6. For Content API SDK clients, route missing `/content/*` JSON requests to
   `dist/content/404.json` only from a Function or Worker after static lookup;
   do not use a broad Pages `_redirects` rule because it shadows real files.
7. Verify headers, redirects, RSS, sitemap, and the generated 404 page.

## Source docs

- Full guide: [`docs/deploy/cloudflare-pages.md`](../deploy/cloudflare-pages.md)
- CI example: [`examples/ci/cloudflare-pages.yml`](../../examples/ci/cloudflare-pages.yml)
- Workers Static Assets example: [`examples/cloudflare-workers/wrangler.toml`](../../examples/cloudflare-workers/wrangler.toml)
