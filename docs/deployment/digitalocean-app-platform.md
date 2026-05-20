# DigitalOcean App Platform deployment recipe

Use this target when DigitalOcean App Platform should build Nectar and publish
the generated `dist/` directory as a static site.

## Recipe

1. Set `site.url` to the App Platform URL or custom domain.
2. Build locally with `bunx nectar build` and verify `dist/`.
3. Create a static site component in DigitalOcean App Platform.
4. Use build command `bunx nectar build`.
5. Use output directory `dist`.
6. After deploy, verify custom domain settings, deep routes, RSS, sitemap, and
   any migrated redirects.

## Source docs

- Full guide: [`docs/deploy/digitalocean-app-platform.md`](../deploy/digitalocean-app-platform.md)
- General hosting notes: [`docs/HOSTING.md`](../HOSTING.md)
- Security header checklist: [`docs/security/hosting.md`](../security/hosting.md)
