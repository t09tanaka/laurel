# Vercel deployment recipe

Use this target when Vercel should build Laurel, publish `dist/`, and provide
preview and production deployments.

## Recipe

1. Set `site.url`; Vercel preview build URLs can override it for previews.
2. Enable `[deploy.vercel]` so Laurel emits `vercel.json`.
3. Run `bunx laurel build` and confirm `dist/vercel.json`.
4. In Vercel, use the `Other` preset, build command `bunx laurel build`, and
   output directory `dist`.
5. Use the prebuilt CI workflow only when GitHub Actions owns production.
6. Verify preview canonical URLs, headers, redirects, RSS, sitemap, and 404s.

## Source docs

- Full guide: [`docs/deploy/vercel.md`](../deploy/vercel.md)
- CI example: [`examples/ci/vercel.yml`](../../examples/ci/vercel.yml)
- Security header checklist: [`docs/security/hosting.md`](../security/hosting.md)
