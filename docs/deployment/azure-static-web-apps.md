# Azure Static Web Apps deployment recipe

Use this target when you want Azure Static Web Apps to run the Laurel build and
serve the generated `dist/` directory from GitHub Actions.

## Recipe

1. Set `site.url` to the production Azure or custom-domain URL.
2. Build once locally with `bunx laurel build` and verify `dist/index.html`.
3. Copy the Azure workflow example into `.github/workflows/`.
4. In Azure, create the Static Web App and connect it to the repository.
5. Use `dist` as the app artifact output location.
6. After the first deploy, verify canonical URLs, RSS, sitemap, and 404s.

## Source docs

- Full guide: [`docs/deploy/azure-static-web-apps.md`](../deploy/azure-static-web-apps.md)
- CI example: [`examples/ci/azure-static-web-apps.yml`](../../examples/ci/azure-static-web-apps.yml)
- General hosting notes: [`docs/HOSTING.md`](../HOSTING.md)
