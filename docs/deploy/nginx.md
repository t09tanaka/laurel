# Deploying Nectar to nginx

Nectar builds a fully static site. nginx serves it as plain files, while the
generated `dist/.nectar/nginx.conf` captures Nectar's cache headers, security
headers, pretty URL fallback, and `redirects.yaml` rules in one `server` block.

## Quickstart

1. Enable the nginx deploy target in `nectar.toml`:

   ```toml
   [deploy.nginx]
   enabled = true
   root = "/var/www/nectar"
   server_name = "example.com"
   ```

   `root` must match the directory where nginx will serve the built files.
   `server_name` defaults to `_`, but a real hostname is safer when the VPS
   serves more than one site.

2. Build locally:

   ```sh
   bunx nectar build
   test -f dist/.nectar/nginx.conf
   ```

3. Sync the complete `dist/` directory to the configured root:

   ```sh
   rsync -avz --delete dist/ user@host:/var/www/nectar/
   ```

   Nectar's `[deploy.rsync]` target can wrap the same copy step:

   ```toml
   [deploy.rsync]
   destination = "user@host:/var/www/nectar/"
   ```

   Then run:

   ```sh
   bunx nectar deploy rsync --build
   ```

4. Include the generated server block from nginx's main config:

   ```nginx
   include /var/www/nectar/.nectar/nginx.conf;
   ```

   Place that include under the top-level `http { ... }` context, not inside
   another `server { ... }` block, because Nectar emits the full `server`
   block.

5. Test and reload nginx:

   ```sh
   sudo nginx -t
   sudo systemctl reload nginx
   ```

## What Nectar Generates

With `[deploy.nginx].enabled = true`, every build writes
`dist/.nectar/nginx.conf`. The file is under `.nectar/` instead of the publish
root so nginx never serves it as public content.

The generated server block:

- sets `root` and `server_name` from `[deploy.nginx]`;
- emits `etag on;` so conditional requests keep working even if a parent
  nginx config changed the default validator setting;
- enables `gzip_static on;` and `brotli_static on;` for pre-compressed
  sidecars;
- emits one `location` per `[deploy.headers].cache_rules` entry;
- repeats the configured security headers inside every `location`, because
  nginx `add_header` directives are not inherited once a child block declares
  its own headers;
- serves Nectar's `slug/index.html` output with
  `try_files $uri $uri/ $uri/index.html =404;`;
- translates `redirects.yaml` rules into `location { return <status> <to>; }`
  directives.

## Headers and Redirects

The default cache rules match the generated Cloudflare Pages and Netlify
headers:

| Path | Cache-Control |
| --- | --- |
| `/assets/*` | `public, max-age=31536000, immutable` |
| `/content/images/*` | `public, max-age=31536000, immutable` |
| `/*` | `public, max-age=0, must-revalidate` |

The long-lived rules are for fingerprinted build output: when the asset
content changes, Nectar changes the URL, so nginx can serve those paths with
`immutable` caching. The catch-all rule covers HTML and other stable URLs and
forces browsers to revalidate before reuse.

Nectar does not emit nginx `expires` directives. `Cache-Control` is the
authoritative freshness policy across the generated deploy targets, and
emitting both would make custom cache rules harder to reason about. The
generated `etag on;` directive keeps nginx validators enabled for revalidation
responses.

Customize those rules, plus security headers such as
`X-Content-Type-Options`, `Referrer-Policy`, and
`Content-Security-Policy`, under `[deploy.headers]` in `nectar.toml`.

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
wins. The Netlify-only `force` flag is ignored by nginx.

Wildcard redirects are emitted as regex `location` blocks. Wildcard captures
are not interpolated into the destination, so use explicit destination paths.

## Pre-compressed Assets

Set `[build].precompress = true` in `nectar.toml` to emit `.br` and `.gz`
sidecars next to text files:

```toml
[build]
precompress = true
```

The generated nginx config enables `brotli_static` and `gzip_static`. Your
nginx build must include the Brotli module for `brotli_static`; if it does
not, remove that line from the deployed include or install a package that
ships the module. `gzip_static` is available in standard nginx builds.

## TLS

Nectar's generated file listens on port 80 only. Terminate HTTPS in your main
nginx config, a load balancer, or a companion Certbot-managed server block.
If nginx owns TLS directly, treat `dist/.nectar/nginx.conf` as the generated
HTTP baseline and keep certificate paths, port 443 listeners, and
HTTP-to-HTTPS redirects in operator-managed config. Do not hand-edit the
generated file in place; the next `nectar build` rewrites it.

## Troubleshooting

- **`nginx -t` fails on `brotli_static`:** the Brotli module is not installed
  or not loaded. Install an nginx package with Brotli support, load the module,
  or remove `brotli_static on;` from the deployed config.
- **`dist/.nectar/nginx.conf` is missing:** confirm
  `[deploy.nginx].enabled = true` and rebuild.
- **Headers are missing on assets:** ensure nginx is using the generated
  include. The headers are repeated per `location`; a separate hand-written
  `server` block may be handling the request first.
- **Pretty URLs 404:** confirm the copied directory matches
  `[deploy.nginx].root` and contains each page's `index.html`.
