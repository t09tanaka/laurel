# Redirect syntax matrix

Migrated Ghost sites often carry years of redirects. Laurel uses one canonical
input, then translates it only for deploy targets that can consume redirect
rules at request time.

Use this matrix before moving a `dist/` bundle between hosts. A file that works
on one host may be ignored completely on another.

## Canonical input

Put portable redirects in `redirects.yaml` at the project root:

```yaml
- from: /feed
  to: /rss.xml
  status: 301
  force: true
- from: /old-post/
  to: /new-post/
  status: 308
```

Laurel also loads Ghost-style `content/data/redirects.{yaml,yml,json}`. The
canonical status set is `301`, `302`, `307`, and `308`; omitted status defaults
to `301`.

## Target matrix

| Target | Laurel setting | Emitted artifact | Redirect syntax Laurel emits | Host consumes it? | Notes |
| --- | --- | --- | --- | --- | --- |
| Netlify | `[deploy.netlify].enabled = true` | `dist/_redirects` | `/old  /new  301`; `force: true` becomes `301!` | Yes | Netlify uses first match. Without `!`, a real file at the source path can win over the redirect. |
| Cloudflare Pages | default `[components.redirects]`; enable `[deploy.cloudflare_pages]` for the full Pages package | `dist/_redirects` | `/old  /new  301` | Yes | Pages treats redirects as forced; `force` is accepted in shared input but has no Cloudflare-specific marker. |
| Vercel | `[deploy.vercel].enabled = true` | `dist/vercel.json` | `{ "source": "/old", "destination": "/new", "statusCode": 301 }` in `redirects[]` | Yes | Laurel translates `*` to Vercel path-to-regexp `(.*)`. Vercel applies redirects even when a static file exists at `source`. |
| Firebase Hosting | `[deploy.firebase].enabled = true` | `dist/firebase.json` | `{ "source": "/old", "destination": "/new", "type": 301 }` in `hosting.redirects[]` | Yes | Firebase ignores `_redirects`. Deploy with the generated `firebase.json` or merge its `hosting` block into your root config. |
| Apache HTTPD | `[deploy.apache].enabled = true` | `dist/.htaccess` | `RewriteRule ^old$ /new [R=301,L]` | Yes, when `.htaccess` is enabled | Requires `AllowOverride FileInfo` and `mod_rewrite`. Laurel also emits cache/header rules into the same file. |
| nginx | `[deploy.nginx].enabled = true` | `dist/.laurel/nginx.conf` | `location = /old { return 301 /new; }` | Yes, after operator includes the file | nginx does not read files from the publish root automatically. Include the generated server block from the main nginx config. |
| Caddy | `[deploy.caddy].enabled = true` | `dist/.laurel/Caddyfile` | `@redirect_0 path /old` plus `redir @redirect_0 /new 301` | Yes, after operator imports or copies the file | Caddy has no `_redirects` convention. Treat the file as operator config, not public content. |
| GitHub Pages | `[deploy.github_pages].redirects = true` | Static HTML files such as `dist/old/index.html` | `<meta http-equiv="refresh" content="0; url=/new">` | Partially | Pages has no server-side redirect engine. HTTP status is not preserved; clients see a `200` HTML page that jumps. Wildcard, root, query, fragment, and `404.html` sources are skipped. |
| Cloudflare Workers Static Assets | `[deploy.cloudflare_workers].enabled = true` | `dist/_routes-manifest.json` | `{ "source": "/old", "destination": "/new", "status": 301 }` in `redirects[]` | Only with a Worker that reads the manifest | Workers Static Assets does not consume `_redirects`; use Laurel's reference Worker or equivalent code. |
| S3 + CloudFront | no build-time redirect emitter for S3 routing; optional script-generated CloudFront helper | CloudFront Function JavaScript at the path you pass to `scripts/generate-cloudfront-redirects.ts` | Exact-match lookup map returning `{ statusCode, headers: { location } }` | Only after operator wiring | S3 static hosting does not read `_redirects`, `vercel.json`, `.htaccess`, or nginx config. Publish the generated CloudFront Function, configure distribution rules, or use HTML fallback redirects. |
| Render Static Sites | none | none | Not emitted | No | Render does not consume Laurel's `_redirects` as a routing contract. Configure redirects in Render until a native emitter exists. |
| DigitalOcean App Platform | none | none | Not emitted | No | App Platform serves `dist/` but Laurel does not emit App Platform redirect config. Use provider settings or a fronting proxy. |
| Bunny.net | none | none | Not emitted | No | Bunny Storage/Pull Zones do not consume Laurel redirect files. Use Edge Rules or a fronting layer. |

## Component-level `_redirects`

`[components.redirects]` is enabled by default and can emit `dist/_redirects`
even when no deploy target is enabled. That file is intentionally in the
Netlify / Cloudflare Pages shape:

```txt
# Custom redirects (from redirects.yaml)
/old  /new  301
```

Use it directly only on hosts that read `_redirects`. Firebase, Vercel,
Apache, nginx, Caddy, GitHub Pages, S3, Render, DigitalOcean App Platform, and
Bunny ignore that file unless another routing layer consumes it.

If `[components.redirects].emit_html = true`, Laurel also writes static HTML
redirect pages. That is a portability fallback for hosts without request-time
redirect support, but it cannot preserve HTTP status codes.

## Migration rules of thumb

- Keep `redirects.yaml` as the source of truth. Do not maintain separate
  Netlify, Vercel, Firebase, Apache, and nginx rules by hand unless a provider
  needs behavior Laurel cannot model.
- Enable exactly the deploy target for the host that will serve the site.
  Multiple generated artifacts can coexist in `dist/`, but each host only reads
  its own convention.
- Rebuild after changing redirects, then inspect the host-specific artifact
  before deploying.
- Test one existing page, one missing page, one permanent redirect, and one
  redirect whose source path also exists as a static file.
