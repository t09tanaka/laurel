# Deployment recipes

This directory is the short-form deployment map for operators coming from
Ghost. Each page gives the minimum path to publish Nectar's static `dist/`
output on one host, then links back to the maintained long-form guide under
[`docs/deploy/`](../deploy/).

For every target:

1. Set `site.url` in `nectar.toml` to the final public URL.
2. If the site is not served from `/`, set `build.base_path` before building.
3. Run `bunx nectar build` locally once and inspect `dist/`.
4. Follow the target recipe below and the linked full guide for host-specific
   headers, redirects, cache rules, and CI examples.
5. After the first deploy, check the live URL, RSS feed, sitemap, 404 page,
   and any Ghost redirect imports.

| Target | Use when | Recipe |
| --- | --- | --- |
| Apache | You already operate Apache and want checked-in `.htaccess` output. | [apache.md](./apache.md) |
| Azure Static Web Apps | You want a managed Azure static host with GitHub Actions. | [azure-static-web-apps.md](./azure-static-web-apps.md) |
| Bunny.net | You use Bunny Storage and Pull Zones for static delivery. | [bunny.md](./bunny.md) |
| Caddy | You self-host and want generated Caddy config from Nectar. | [caddy.md](./caddy.md) |
| Cloudflare Pages | You want Git-connected deploys on Cloudflare's edge. | [cloudflare-pages.md](./cloudflare-pages.md) |
| Cloudflare Pages + R2 images | A migrated Ghost image library is too large for one Pages upload. | [cloudflare-pages-r2-images.md](./cloudflare-pages-r2-images.md) |
| DigitalOcean App Platform | You want DigitalOcean to build and serve `dist/`. | [digitalocean-app-platform.md](./digitalocean-app-platform.md) |
| Docker | You want to ship a prebuilt `dist/` behind nginx in a container. | [docker.md](./docker.md) |
| Firebase Hosting | You want Firebase CLI hosting for the static output. | [firebase-hosting.md](./firebase-hosting.md) |
| Fly.io | You want to deploy the static site as a small nginx app on Fly. | [fly.md](./fly.md) |
| GitHub Pages | You want Pages to publish a repository or project site. | [github-pages.md](./github-pages.md) |
| Netlify | You want Netlify build/deploy previews and generated `_headers`. | [netlify.md](./netlify.md) |
| nginx | You self-host and want Nectar-generated nginx config. | [nginx.md](./nginx.md) |
| Render | You want Render Static Sites with `dist/` as the publish directory. | [render.md](./render.md) |
| S3 + CloudFront | You want an AWS-native private bucket and CloudFront distribution. | [s3-cloudfront.md](./s3-cloudfront.md) |
| Vercel | You want Vercel previews, production deploys, and generated `vercel.json`. | [vercel.md](./vercel.md) |

For the broader hosting and security checklist, see
[`docs/HOSTING.md`](../HOSTING.md) and
[`docs/security/hosting.md`](../security/hosting.md).
