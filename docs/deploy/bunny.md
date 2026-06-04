# Deploying Laurel to Bunny.net

Bunny.net can serve a Laurel build by storing the generated `dist/` files in
a Bunny Storage Zone and delivering them through a connected Pull Zone. Laurel
does not currently ship a Bunny-specific deploy emitter or `laurel deploy
bunny` target, so Bunny-owned routing, headers, cache policy, purge behavior,
and file mirroring stay outside Laurel for now.

Use this guide when you want Bunny's CDN in front of a fully static Laurel
site and are comfortable uploading the built artifact yourself from a local
machine or CI.

## Quickstart

1. Build the site locally:

   ```sh
   bunx laurel build
   test -f dist/.laurel-manifest.json
   ```

2. In the Bunny dashboard, create a **Storage Zone** for the site. Standard
   storage is usually enough for a static site served through CDN cache; Edge
   SSD can make uncached reads faster at a higher cost. Pick the primary and
   replication regions before the first upload.

3. Create or connect a **Pull Zone** with **Origin Type = Storage Zone**, then
   select the storage zone you created. Public traffic should go through the
   Pull Zone URL, for example `https://my-blog.b-cdn.net/`, not directly
   through the Storage API endpoint.

4. Upload the contents of `dist/` to the root of the Storage Zone. For a small
   first deploy, the dashboard file browser is enough. For scripted uploads,
   Bunny's HTTP Storage API accepts one `PUT` per file using the storage-zone
   password as the `AccessKey`:

   ```sh
   export BUNNY_STORAGE_ZONE="my-blog"
   export BUNNY_STORAGE_ENDPOINT="https://storage.bunnycdn.com"
   export BUNNY_STORAGE_PASSWORD="<storage-zone-password>"

   find dist -type f -print0 | while IFS= read -r -d '' file; do
     remote_path="${file#dist/}"
     curl --fail --show-error --silent \
       --request PUT \
       --url "${BUNNY_STORAGE_ENDPOINT%/}/${BUNNY_STORAGE_ZONE}/${remote_path}" \
       --header "AccessKey: ${BUNNY_STORAGE_PASSWORD}" \
       --header "Content-Type: application/octet-stream" \
       --upload-file "$file"
   done
   ```

   Use the regional storage endpoint shown in the Storage Zone's Access tab
   when Bunny gives you one. The simple loop above assumes URL-safe generated
   paths; if your content imports files with spaces or other characters that
   need URL encoding, use a storage client that encodes object paths correctly.

5. Open the Pull Zone hostname and verify the root page, a nested page, an
   asset, and the 404 page:

   ```sh
   curl -sI https://my-blog.b-cdn.net/ | sort
   curl -sI https://my-blog.b-cdn.net/about/ | sort
   curl -sI https://my-blog.b-cdn.net/assets/built/screen.css | sort
   curl -sI https://my-blog.b-cdn.net/404.html | sort
   ```

6. If you use a custom domain, add it under the Pull Zone hostnames, point DNS
   at the assigned `*.b-cdn.net` hostname, and enable Bunny-managed SSL.

## What Laurel does not emit for Bunny

Bunny does not consume Laurel's Cloudflare / Netlify `_headers` and
`_redirects` conventions, Vercel's `vercel.json`, or the nginx config under
`dist/.laurel/`. Keep these limitations in mind:

- There is no `[deploy.bunny]` config block and no `laurel deploy bunny`
  command.
- Cache headers and security headers need to be configured in Bunny's Pull
  Zone settings / Edge Rules, or by another layer in front of Bunny.
- `redirects.yaml` may still produce `dist/_redirects` for other hosts, but
  Bunny will not apply it as routing config. Use Bunny Edge Rules for HTTP
  redirects, or enable `[components.redirects].emit_html = true` only when a
  browser-level fallback with a `200` response is acceptable.
- Stale remote files are not removed by the upload loop above. Use a managed
  sync tool or an explicit cleanup step when deleted posts, images, or assets
  must disappear from the Storage Zone.
- CDN cache purge is operator-owned. Purge the Pull Zone after replacing HTML
  if your cache settings keep old pages at the edge.

## Error pages and route checks

Laurel emits real static files, including `404.html` and directory-style page
outputs such as `about/index.html`. After the first deploy, verify that Bunny
serves both `/about/` and the exact object path `/about/index.html` as
expected for your Storage Zone and Pull Zone settings.

For the themed 404 page, set the Storage Zone's custom 404 file path to
`/404.html`. Do not enable an SPA-style `/index.html` fallback unless you have
intentionally converted the site into a client-routed app; Laurel pages are
already pre-rendered.

## Production notes

- Store `BUNNY_STORAGE_PASSWORD` as a CI secret. It is the Storage API
  credential for that zone, not the account-wide Bunny API key.
- Prefer short or revalidating cache for HTML and long cache for fingerprinted
  assets. The exact rule placement belongs in Bunny's Pull Zone configuration
  until Laurel has a Bunny-specific emitter.
- Check the official Bunny docs for the current Storage API endpoint, regional
  endpoint, and Pull Zone setup flow:
  - <https://docs.bunny.net/storage/quickstart>
  - <https://docs.bunny.net/api-reference/storage>
  - <https://support.bunny.net/hc/en-us/articles/8561433879964-How-to-access-and-deliver-files-from-Bunny-Storage>
