# nginx deployment recipe

Use this target when you self-host Nectar behind nginx and want generated
server config for pages, redirects, cache rules, and security headers.

## Recipe

1. Set `site.url` in `nectar.toml`.
2. Enable `[deploy.nginx]` and set the document root nginx will serve.
3. Run `bunx nectar build`.
4. Sync `dist/` to the server.
5. Include `dist/.nectar/nginx.conf` from the main nginx configuration.
6. Reload nginx, then test a page, 404, static asset cache header, and any
   migrated redirect.

## Source docs

- Full guide: [`docs/deploy/nginx.md`](../deploy/nginx.md)
- Docker recipe: [`docker.md`](./docker.md)
- Security header checklist: [`docs/security/hosting.md`](../security/hosting.md)
