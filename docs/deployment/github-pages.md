# GitHub Pages deployment recipe

Use this target when GitHub Pages should publish the built site as a repository
or project site.

## Recipe

1. Set `site.url` to the final Pages or custom-domain URL.
2. For project sites, set `build.base_path` to the repository path.
3. Run `bunx nectar build` locally and verify asset URLs.
4. Prefer the GitHub Actions artifact workflow for new sites.
5. Enable Pages with source set to GitHub Actions.
6. Verify `.nojekyll`, custom domain behavior, deep routes, RSS, and sitemap.

## Source docs

- Full guide: [`docs/deploy/github-pages.md`](../deploy/github-pages.md)
- CI example: [`examples/ci/github-pages.yml`](../../examples/ci/github-pages.yml)
- Deploy tutorial: [`docs/tutorials/04-deploy.md`](../tutorials/04-deploy.md)
