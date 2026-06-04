# Render deployment recipe

Use this target when Render Static Sites should build Laurel from Git and serve
`dist/` as the publish directory.

## Recipe

1. Set `site.url` to the Render URL or custom domain.
2. Build locally once with `bunx laurel build`.
3. Create a Render Static Site.
4. Use build command `bunx laurel build` and publish directory `dist`.
5. For generated redirects and headers, enable the Netlify deploy emitter:

   ```toml
   [deploy.netlify]
   enabled = true
   ```

   Render Static Sites read Netlify-style `_redirects` and `_headers` files
   from the publish directory, so Laurel intentionally reuses the Netlify
   emitter instead of maintaining a separate Render-specific format.
6. Add the optional deploy hook workflow only when CI should trigger deploys.
7. Verify custom domain, `_redirects`, `_headers`, RSS, sitemap, and the
   generated 404 page.

## Source docs

- Full guide: [`docs/deploy/render.md`](../deploy/render.md)
- Render service example: [`examples/render/render.yaml`](../../examples/render/render.yaml)
- CI example: [`examples/ci/render.yml`](../../examples/ci/render.yml)
