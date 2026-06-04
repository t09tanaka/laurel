# Deploying Laurel to Caddy

Laurel builds a fully static site. Caddy serves it as plain files, while the
generated `dist/.laurel/Caddyfile` captures Laurel's cache headers, security
headers, pretty URL fallback, themed 404 handling, and `redirects.yaml` rules
in one site block.

## Quickstart

1. Enable the Caddy deploy target in `laurel.toml`:

   ```toml
   [deploy.caddy]
   enabled = true
   root = "/var/www/laurel"
   site_address = "example.com"
   ```

   `root` must match the directory where Caddy will serve the built files.
   `site_address` defaults to `:80`; set a real hostname when Caddy should
   provision HTTPS automatically.

2. Build locally:

   ```sh
   bunx laurel build
   test -f dist/.laurel/Caddyfile
   ```

3. Sync the complete `dist/` directory to the configured root:

   ```sh
   rsync -avz --delete dist/ user@host:/var/www/laurel/
   ```

   Laurel's `[deploy.rsync]` target can wrap the same copy step:

   ```toml
   [deploy.rsync]
   destination = "user@host:/var/www/laurel/"
   ```

   Then run:

   ```sh
   bunx laurel deploy rsync --build
   ```

4. Import the generated site block from `/etc/caddy/Caddyfile`:

   ```caddyfile
   import /var/www/laurel/.laurel/Caddyfile
   ```

5. Reload Caddy:

   ```sh
   sudo systemctl reload caddy
   ```

   When `site_address` is a public hostname, Caddy provisions an HTTPS
   certificate via Let's Encrypt automatically on first request.

## What Laurel Generates

With `[deploy.caddy].enabled = true`, every build writes
`dist/.laurel/Caddyfile`. The file is under `.laurel/` instead of the publish
root so Caddy never serves it as public content.

The generated Caddyfile:

- sets the site address and `root *` from `[deploy.caddy]`;
- enables `encode zstd gzip` for dynamic compression;
- serves pre-compressed `.br` / `.gz` sidecars with `file_server`;
- emits one path matcher per `[deploy.headers].cache_rules` entry;
- attaches configured security headers globally;
- serves Laurel's `slug/index.html` output with
  `try_files {path} {path}/index.html =404`;
- translates `redirects.yaml` rules into named path matchers plus `redir`;
- rewrites Caddy error responses to Laurel's generated `/404.html`.

## Headers and Redirects

The default cache rules match the generated Cloudflare Pages, Netlify, Vercel,
and nginx outputs:

| Path | Cache-Control |
| --- | --- |
| `/assets/*` | `public, max-age=31536000, immutable` |
| `/content/images/*` | `public, max-age=31536000, immutable` |
| `/*` | `public, max-age=0, must-revalidate` |

Customize those rules, plus security headers such as
`X-Content-Type-Options`, `Referrer-Policy`, and
`Content-Security-Policy`, under `[deploy.headers]` in `laurel.toml`.

If a browser client will fetch Laurel's emitted `/content/*` JSON from another
origin and you are not using the generated Caddyfile, copy the Content API CORS
snippet from [`cors-caddy.md`](./cors-caddy.md).

Put custom redirects in `redirects.yaml` at the project root before building:

```yaml
- from: /feed
  to: /rss.xml
  status: 301
- from: /old-post/
  to: /new-post/
  status: 308
```

Supported redirect status codes are `301`, `302`, `307`, and `308`; omitted
status defaults to `301`. If two rules share the same `from`, the first rule
wins. The Netlify-only `force` flag is ignored by Caddy.

Wildcard redirects are emitted as Caddy `path` matchers. Wildcard captures are
not interpolated into the destination, so use explicit destination paths.

## Pre-compressed Sidecars

Set `[build].precompress = true` in `laurel.toml` to emit `.br` and `.gz`
sidecars next to text files:

```toml
[build]
precompress = true
```

The generated Caddyfile enables:

```caddyfile
file_server {
    precompressed br gzip
}
```

Without precompressed bodies, Caddy still gzips/zstds responses on the fly via
`encode zstd gzip`; the precompressed path saves CPU per request.

## TLS

Caddy owns HTTPS when `site_address` is a public hostname such as
`example.com`. If TLS terminates elsewhere, leave `site_address = ":80"` and
put the generated site block behind that proxy or load balancer.

Do not hand-edit `dist/.laurel/Caddyfile` in place; the next `laurel build`
rewrites it. Put operator-specific TLS policy, additional site blocks, and
global Caddy options in `/etc/caddy/Caddyfile`, then `import` the generated
file.

## Manual Example

The hand-written example at
[`examples/deploy/caddy/Caddyfile`](../../examples/deploy/caddy/Caddyfile)
is still useful when you want a starting point without enabling the emitter.
For production deploys that need Laurel-managed headers and redirects, prefer
`[deploy.caddy].enabled = true`.

## Troubleshooting

- **`dist/.laurel/Caddyfile` is missing:** confirm
  `[deploy.caddy].enabled = true` and rebuild.
- **Caddy cannot get a cert:** confirm DNS resolves `site_address` to the
  server and that ports 80 and 443 are reachable from the internet. Caddy logs
  the ACME failure verbatim.
- **HTTPS works but 404 is served as Caddy's default page:** confirm the
  generated file is imported and contains the `handle_errors` block.
- **Pretty URLs 404:** confirm the copied directory matches
  `[deploy.caddy].root` and contains each page's `index.html`.
