# Deploying Nectar behind Fastly

Fastly can serve a Nectar build from an origin you control, such as S3,
Cloudflare R2, nginx, or another static file host. Nectar does not currently
emit Fastly VCL, Compute config, or a `nectar deploy fastly` target, so Fastly
is best treated as the CDN layer in front of `dist/`.

## Quickstart

1. Build the site and upload `dist/` to your origin:

   ```sh
   bunx nectar build
   test -f dist/.nectar-manifest.json
   ```

2. Create a Fastly service and add the static origin. If the origin is an
   object store, enable TLS to origin and set the expected host header for that
   provider.

3. Add your production domain to the Fastly service, configure DNS to the
   assigned Fastly hostname, and issue a TLS certificate through Fastly.

4. Configure default caching:

   - HTML: short TTL or revalidation.
   - Fingerprinted assets under `/assets/`: long TTL with `immutable`.
   - API JSON under `/content/` and `/ghost/api/content/`: match your SPA /
     frontend cache policy.

5. Verify representative paths:

   ```sh
   curl -sI https://www.example.com/ | sort
   curl -sI https://www.example.com/about/ | sort
   curl -sI https://www.example.com/assets/built/screen.css | sort
   curl -sI https://www.example.com/404.html | sort
   ```

## Redirects and headers

Nectar's generated `_headers`, `_redirects`, `vercel.json`, and nginx/Caddy
artifacts are not consumed by Fastly automatically. Keep the source of truth in
Nectar (`redirects.yaml`, `[deploy.headers]`) and translate the required subset
into Fastly service configuration, VCL snippets, or Compute code.

When strict security headers matter, configure them at Fastly so they apply to
every response, including error responses and cache hits. Pair the Fastly
configuration with [`docs/security/hosting.md`](../security/hosting.md).

## Purge strategy

Purge HTML after each deploy, or use surrogate keys if your upload process can
tag responses by route. Fingerprinted assets can stay cached indefinitely
because new builds write new filenames.

