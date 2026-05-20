# Deploying Nectar to Caddy

Caddy serves static sites with HTTPS, HTTP/3, and compression on by default.
For a Nectar build the configuration is short — most of the work happens in
the `Caddyfile`.

## Quickstart

1. Build the site:

   ```sh
   nectar build
   ```

2. Sync `dist/` to your Caddy host. The `[deploy.rsync]` target is the
   canonical recipe:

   ```toml
   # nectar.toml
   [deploy.rsync]
   destination = "user@host:/var/www/yoursite/"
   ```

   Then:

   ```sh
   nectar deploy rsync
   ```

3. Drop the example
   [`Caddyfile`](../../examples/deploy/caddy/Caddyfile) onto the host (e.g.
   at `/etc/caddy/Caddyfile`) and reload:

   ```sh
   sudo systemctl reload caddy
   ```

   Caddy provisions an HTTPS certificate via Let's Encrypt automatically on
   first request to the configured hostname.

## What the example `Caddyfile` does

- Sets `root * /var/www/yoursite` and `file_server` so Caddy serves
  fingerprinted assets directly off disk.
- Honors `index.html` for directory requests (the default), which matches
  nectar's `slug/index.html` output shape — no rewrite rules needed.
- Adds `Cache-Control: public, max-age=31536000, immutable` for
  fingerprinted asset paths (`/assets/*`, `/content/images/*`) and
  `Cache-Control: public, max-age=0, must-revalidate` for HTML so a redeploy
  is visible on next click.
- Sets security headers (`X-Content-Type-Options`, `Referrer-Policy`) to
  match nectar's `_headers` defaults across hosts.
- Serves `/404.html` for any unmatched path (nectar emits this file
  unconditionally — themes can override via `error.hbs`).
- Enables `encode zstd gzip` so Caddy ships compressed bodies even when the
  build did not pre-compress.

## Pre-compressed sidecars

If `[build].precompress = true` is set in `nectar.toml`, nectar emits `.br`
and `.gz` sidecars next to every text artifact. Caddy can serve them with the
[`precompressed`](https://caddyserver.com/docs/caddyfile/directives/file_server#precompressed)
sub-directive of `file_server`:

```caddyfile
file_server {
    precompressed br gzip
}
```

The example file enables this by default. Without precompressed bodies,
Caddy still gzips/zstds responses on the fly thanks to `encode zstd gzip` —
the precompressed path just saves CPU per request.

## Redirects from a Ghost migration

Caddy doesn't read nectar's `_redirects` file. Translate the entries you
care about into the `Caddyfile`:

```caddyfile
redir /old-permalink/ /new/path/ permanent
```

The example `Caddyfile` keeps a placeholder block at the top so you can
paste in the rules without hunting for the right syntax.

## Troubleshooting

- **Caddy can't get a cert:** confirm DNS resolves the hostname in the
  `Caddyfile` to the server, and that ports 80 + 443 are reachable from the
  internet. Caddy logs the ACME failure verbatim.
- **HTTPS works but 404 is served as Caddy's default page:** the
  `handle_errors` block must reference `/404.html`. The example file does so;
  custom `Caddyfile`s often forget this.
