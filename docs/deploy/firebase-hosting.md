# Deploying Nectar to Firebase Hosting

Firebase Hosting serves Nectar's already-built `dist/` directory as static
files. Nectar does not currently ship a Firebase-specific emitter, a
`[deploy.firebase]` config block, or a `nectar deploy firebase` command. Keep
Firebase configuration in a hand-maintained `firebase.json`, build with
`nectar build`, then deploy `dist/` with the Firebase CLI.

This guide covers the local CLI path only. If you want GitHub Actions to run
the deploy, wire the same commands into your own workflow; Nectar does not
currently include a Firebase Actions template.

## Quickstart

1. Install and sign in to the Firebase CLI:

   ```sh
   npm install -g firebase-tools
   firebase login
   ```

2. Create or select a Firebase project, then initialize Hosting from the
   Nectar project root:

   ```sh
   firebase init hosting
   ```

   When prompted, use:

   | Prompt | Value |
   | --- | --- |
   | Public directory | `dist` |
   | Configure as a single-page app | `No` |
   | Set up automatic builds and deploys with GitHub | `No` |

   Nectar emits real HTML files and directory `index.html` files, not a
   client-side SPA shell. Do not add a catch-all rewrite to `/index.html`
   unless your site intentionally needs SPA behavior.

3. Replace or confirm the Hosting block in `firebase.json`:

   ```json
   {
     "hosting": {
       "public": "dist",
       "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
       "cleanUrls": true,
       "trailingSlash": true,
       "headers": [
         {
           "source": "/assets/**",
           "headers": [
             {
               "key": "Cache-Control",
               "value": "public, max-age=31536000, immutable"
             }
           ]
         },
         {
           "source": "/content/images/**",
           "headers": [
             {
               "key": "Cache-Control",
               "value": "public, max-age=31536000, immutable"
             }
           ]
         },
         {
           "source": "**/*.@(html|xml|json)",
           "headers": [
             {
               "key": "Cache-Control",
               "value": "public, max-age=0, must-revalidate"
             },
             {
               "key": "X-Content-Type-Options",
               "value": "nosniff"
             },
             {
               "key": "Referrer-Policy",
               "value": "strict-origin-when-cross-origin"
             }
           ]
         }
       ]
     }
   }
   ```

   `"public": "dist"` is the important bit: Firebase uploads the already-built
   Nectar output. `cleanUrls` and `trailingSlash` keep Firebase's URL handling
   aligned with Nectar's directory-style pages such as `/about/`.

4. Build and test locally:

   ```sh
   bunx nectar build
   firebase emulators:start --only hosting
   ```

   Open the printed local Hosting URL and click through posts, tag pages, RSS,
   and assets before publishing.

5. Deploy the static output:

   ```sh
   firebase deploy --only hosting
   ```

## Redirects

Nectar's generic redirects component can emit `dist/_redirects`, but Firebase
Hosting does not read Netlify / Cloudflare Pages `_redirects` files. Put
Firebase redirects directly in `firebase.json`:

```json
{
  "hosting": {
    "public": "dist",
    "redirects": [
      {
        "source": "/feed",
        "destination": "/rss.xml",
        "type": 301
      },
      {
        "source": "/old-post",
        "destination": "/new-post/",
        "type": 308
      }
    ]
  }
}
```

Keep this file as the Firebase source of truth until Nectar grows a
Firebase-specific emitter.

## Headers and caching

Firebase reads custom response headers from the `headers` array in
`firebase.json`. Because Nectar has no Firebase emitter today,
`[deploy.headers]` is not translated into Firebase config. If you tighten
cache or security headers in `nectar.toml`, mirror the policy manually in
`firebase.json`.

Use long-lived immutable cache headers only for fingerprinted or otherwise
stable asset paths such as `/assets/**` and `/content/images/**`. Keep HTML,
feed, sitemap, and JSON responses revalidating so a deploy becomes visible
without waiting for a browser cache to expire.

For a fuller security baseline, copy the Firebase example from
[`docs/security/hosting.md`](../security/hosting.md#firebase-hosting) into the
same `headers` array.

## Custom domains and paths

For a custom domain served from the root path, set the deployed URL in
`nectar.toml` and leave `base_path` as `/`:

```toml
[site]
url = "https://blog.example.com/"

[build]
base_path = "/"
```

Firebase Hosting normally serves each site at the domain root. If you put a
Nectar build behind another Firebase route or CDN path such as `/blog/`, set
`[build].base_path` to that path, including leading and trailing slashes, and
update `[site].url` to the final public URL.

## Troubleshooting

- **Deploy says `dist` does not exist:** run `bunx nectar build` before
  `firebase deploy --only hosting`.
- **Every route shows the home page:** remove any catch-all rewrite to
  `/index.html`; Nectar is not an SPA.
- **Redirects from `redirects.yaml` do nothing:** Firebase ignores
  `dist/_redirects`; copy the rules into `firebase.json` under `redirects`.
- **Header changes do not appear:** confirm the rule's `source` pattern matches
  the deployed file and redeploy with `firebase deploy --only hosting`.
