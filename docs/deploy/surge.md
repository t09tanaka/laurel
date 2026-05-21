# Deploying Nectar to Surge

Surge can publish a Nectar `dist/` directory as a simple static site. Nectar
does not currently emit Surge-specific deploy artifacts or a `nectar deploy
surge` target, so publishing uses the Surge CLI after `nectar build`.

## Quickstart

1. Build the site:

   ```sh
   bunx nectar build
   test -f dist/.nectar-manifest.json
   ```

2. Install and authenticate the Surge CLI:

   ```sh
   npm install --global surge
   surge login
   ```

3. Publish `dist/`:

   ```sh
   surge dist my-nectar-site.surge.sh
   ```

4. Verify the home page, a nested route, an asset, and the 404 page:

   ```sh
   curl -sI https://my-nectar-site.surge.sh/ | sort
   curl -sI https://my-nectar-site.surge.sh/about/ | sort
   curl -sI https://my-nectar-site.surge.sh/assets/built/screen.css | sort
   curl -sI https://my-nectar-site.surge.sh/404.html | sort
   ```

## Custom domains

Run `surge dist www.example.com` and follow Surge's DNS instructions. Keep the
domain stable across deploys so existing links and canonical URLs match
`[site].url`.

## Redirects and headers

Surge does not consume Nectar's Cloudflare / Netlify `_headers`, `_redirects`,
Vercel `vercel.json`, or nginx/Caddy output. Use Surge's own static hosting
features for custom domains and fallback behavior, and use a CDN or reverse
proxy in front of Surge when you need custom security headers, cache policy, or
HTTP-level redirects.

If you need redirect parity from `redirects.yaml`, choose a host with a
supported Nectar emitter or put a fronting layer in charge of redirects. HTML
meta-refresh redirects are a last resort because they do not preserve HTTP
status codes.

