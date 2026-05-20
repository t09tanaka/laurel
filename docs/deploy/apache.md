# Deploying Nectar to Apache HTTPD

Nectar builds a fully static site. Apache serves it as plain files. This guide
covers the quickstart, the generated `.htaccess` that turns on redirects,
Cache-Control, MIME hints, and ETag, plus the gotchas that bite Ghost
migrations.

## Quickstart

1. Build the site:

   ```sh
   nectar build
   ```

2. Copy `dist/` to your Apache document root, for example via rsync:

   ```sh
   rsync -avz --delete dist/ user@host:/var/www/yoursite/
   ```

   Nectar's `[deploy.rsync]` target wraps the same command — set
   `destination` in `nectar.toml` and run `nectar deploy rsync`.

3. Confirm Apache is configured with at least `mod_headers`, `mod_expires`,
   and `mod_rewrite` enabled. On Debian/Ubuntu:

   ```sh
   sudo a2enmod headers expires rewrite
   sudo systemctl reload apache2
   ```

4. Enable the Apache emitter in `nectar.toml`, then rebuild:

   ```toml
   [deploy.apache]
   enabled = true
   ```

   Nectar writes `dist/.htaccess`. The generated file pins fingerprinted assets
   to a year of immutable caching, forces HTML to revalidate, resolves Nectar's
   `slug/index.html` output for clean URLs, translates `redirects.yaml` into
   `RewriteRule` redirects, sets configured security headers, adds common static
   MIME types, enables pre-compressed sidecar hints, and wires Apache to
   `dist/404.html`.

   For a hand-written baseline instead, see
   [`examples/deploy/apache/.htaccess`](../../examples/deploy/apache/.htaccess).

## Why the bundled `.htaccess` matters

Apache's defaults serve every file with no `Cache-Control` header at all, and
ETags that include the inode number (so the same file behind two load
balancers serves under two different ETags). Both behaviours undo the work
Nectar already did on the build side:

- Nectar fingerprints `/assets/built/screen.css` → `/assets/built/screen-<hash>.css`.
  Without `Cache-Control: public, max-age=31536000, immutable`, browsers
  re-validate every request and the fingerprint is wasted.
- Without `FileETag MTime Size` (or `None`), Apache's default `INode MTime Size`
  ETag changes between filesystems, breaking conditional GETs across hosts.

The generated `.htaccess` fixes both. The cache rules mirror what nectar's
`_headers` emitter ships for Netlify / Cloudflare Pages so the same site
behaves the same on every host:

| Path                | Cache-Control                              |
| ------------------- | ------------------------------------------ |
| `/assets/*`         | `public, max-age=31536000, immutable`      |
| `/content/images/*` | `public, max-age=31536000, immutable`      |
| `/*` (HTML)         | `public, max-age=0, must-revalidate`       |

For browser clients that fetch Nectar's emitted `/content/*` JSON from another
origin, see [`cors-apache.md`](./cors-apache.md). You can either copy the
virtual-host snippet there or set `[components.content_api].emit_htaccess =
true` to write `dist/content/.htaccess` with the Content API CORS rules.

## Pretty URLs

Nectar emits posts and pages as `slug/index.html`. The generated `.htaccess`
keeps `DirectoryIndex index.html` for canonical directory requests like
`/about/`, and also adds a `mod_rewrite` fallback so `/about` resolves to
`about/index.html` without requiring a separate trailing-slash redirect.

The clean URL fallback runs after explicit redirects and after the rewrite
environment markers used for Cache-Control. It only rewrites when the request is
not an existing file and the matching `index.html` exists, so direct assets and
index-less directories are left alone.

If you have redirects from a Ghost migration, drop a `redirects.yaml` into the
project root before building. With `[deploy.apache].enabled = true`, Nectar
translates the canonical redirect list into Apache `RewriteRule` directives in
`dist/.htaccess`, preserving the configured 301 / 302 / 307 / 308 status code.

## Gzip / Brotli

Enable `[build].precompress = true` in `nectar.toml` so the build emits
`.br` + `.gz` sidecars next to every text artifact. The generated `.htaccess`
includes `AddEncoding` directives for those sidecars; pair that with
`mod_negotiation` / `mod_brotli` on the server to avoid per-request
compression work.

## Logs and the 404 page

Nectar emits `404.html`. Tell Apache to use it:

```apache
ErrorDocument 404 /404.html
```

The generated `.htaccess` already includes this line. Without it Apache serves
its built-in "Not Found" page and the operator loses the themed 404.

## Troubleshooting

- **Caching seems off:** confirm `mod_headers` is loaded (`apachectl -M | grep headers`),
  and that `.htaccess` is actually being read (set `AllowOverride All` for the
  document root in `apache2.conf`).
- **Brotli not served:** `mod_brotli` must be loaded; without it the `.br`
  sidecars are ignored and clients fall back to identity encoding.
- **ETags differ across hosts:** double-check `FileETag MTime Size` (or
  `None`) is in `.htaccess` — Apache defaults still include the inode.
