# Deploying Laurel to Surge

Surge can publish a Laurel `dist/` directory as a simple static site. Laurel
does not currently emit Surge-specific deploy artifacts or a `laurel deploy
surge` target, so publishing uses the Surge CLI after `laurel build`.

## Quickstart

1. Build the site:

   ```sh
   bunx laurel build
   test -f dist/.laurel-manifest.json
   ```

2. Install and authenticate the Surge CLI:

   ```sh
   npm install --global surge
   surge login
   ```

3. Publish `dist/`:

   ```sh
   surge dist my-laurel-site.surge.sh
   ```

4. Verify the home page, a nested route, an asset, and the 404 page:

   ```sh
   curl -sI https://my-laurel-site.surge.sh/ | sort
   curl -sI https://my-laurel-site.surge.sh/about/ | sort
   curl -sI https://my-laurel-site.surge.sh/assets/built/screen.css | sort
   curl -sI https://my-laurel-site.surge.sh/404.html | sort
   ```

## Custom domains

Run `surge dist www.example.com` and follow Surge's DNS instructions. Keep the
domain stable across deploys so existing links and canonical URLs match
`[site].url`.

## Redirects and headers

Surge does not consume Laurel's Cloudflare / Netlify `_headers`, `_redirects`,
Vercel `vercel.json`, or nginx/Caddy output. Use Surge's own static hosting
features for custom domains and fallback behavior, and use a CDN or reverse
proxy in front of Surge when you need custom security headers, cache policy, or
HTTP-level redirects.

If you need redirect parity from `redirects.yaml`, choose a host with a
supported Laurel emitter or put a fronting layer in charge of redirects. HTML
meta-refresh redirects are a last resort because they do not preserve HTTP
status codes.

