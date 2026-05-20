# Render deployment recipe

Use this target when Render Static Sites should build Nectar from Git and serve
`dist/` as the publish directory.

## Recipe

1. Set `site.url` to the Render URL or custom domain.
2. Build locally once with `bunx nectar build`.
3. Create a Render Static Site.
4. Use build command `bunx nectar build` and publish directory `dist`.
5. Add the optional deploy hook workflow only when CI should trigger deploys.
6. Verify custom domain, headers managed outside Nectar, redirects, RSS,
   sitemap, and the generated 404 page.

## Source docs

- Full guide: [`docs/deploy/render.md`](../deploy/render.md)
- Render service example: [`examples/render/render.yaml`](../../examples/render/render.yaml)
- CI example: [`examples/ci/render.yml`](../../examples/ci/render.yml)
