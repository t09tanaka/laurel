# Caddy deployment recipe

Use this target when you self-host Nectar behind Caddy and want generated Caddy
config for static files, redirects, cache headers, and security headers.

## Recipe

1. Set the production `site.url` in `nectar.toml`.
2. Enable Caddy output with `[deploy.caddy]` and the target document root.
3. Run `bunx nectar build`.
4. Sync `dist/` to the server document root.
5. Import the generated `dist/.nectar/Caddyfile` from your main Caddyfile.
6. Reload Caddy, then test a page, 404, and migrated redirect.

## Source docs

- Full guide: [`docs/deploy/caddy.md`](../deploy/caddy.md)
- Example Caddyfile: [`examples/deploy/caddy/Caddyfile`](../../examples/deploy/caddy/Caddyfile)
- Security header checklist: [`docs/security/hosting.md`](../security/hosting.md)
