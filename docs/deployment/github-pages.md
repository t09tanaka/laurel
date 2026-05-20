# GitHub Pages deployment recipe

Use this target when GitHub Pages should publish the built site as a repository
or project site.

## Recipe

1. Set `site.url` to the final Pages or custom-domain URL.
2. For project sites built in GitHub Actions, set `GITHUB_PAGES=true` so
   Nectar derives `build.base_path` from `GITHUB_REPOSITORY`; set
   `build.base_path` manually only when overriding that path.
3. Run `GITHUB_PAGES=true GITHUB_REPOSITORY=<owner>/<repo> bunx nectar build`
   locally for project-site smoke tests, or plain `bunx nectar build` for
   custom domains and user / organization sites.
4. Prefer the GitHub Actions artifact workflow for new sites.
5. Enable Pages with source set to GitHub Actions.
6. Verify `.nojekyll`, custom domain behavior, deep routes, RSS, and sitemap.

## Source docs

- Full guide: [`docs/deploy/github-pages.md`](../deploy/github-pages.md)
- CI example: [`examples/ci/github-pages.yml`](../../examples/ci/github-pages.yml)
- Deploy tutorial: [`docs/tutorials/04-deploy.md`](../tutorials/04-deploy.md)
