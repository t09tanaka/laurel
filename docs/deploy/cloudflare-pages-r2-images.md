# Serving images from R2 on a Cloudflare Pages site

Cloudflare Pages caps deployments at **25,000 files** per upload. A
content-heavy Nectar build can blow past that limit once `[components.images]`
generates responsive width variants and WebP/AVIF format variants for every
post image — a 200-post site with three widths and three formats per image
ships 1800+ image files alone.

The fix is to keep HTML, CSS, JS, and JSON on Pages, and move the image
output tree (`/content/images/`) to **Cloudflare R2** behind a public bucket.
The browser sees a single origin (your Pages domain) thanks to a Cloudflare
Worker that rewrites `/content/images/*` requests to R2.

This recipe walks through the full setup.

## When to use this recipe

Run `nectar build` and count the files in `dist/`:

```sh
find dist -type f | wc -l
```

If you are within 80% of 25,000 (around 20,000 files), set this up before
the next image-heavy post pushes you over the limit. `nectar deploy
cloudflare` warns when `dist/` exceeds 25,000 files; that warning is your
cue.

## Architecture

```
+---------------------+         +-------------------------+
| Browser request     |         | Cloudflare Pages        |
| /post/foo           +-------->+ Static HTML, CSS, JS    |
|                     |         +-----------+-------------+
| /content/images/x   |                     | rewrite via Worker
|                     |                     v
|                     |         +-------------------------+
|                     |         | R2 bucket (public)      |
|                     +-------->+ width / format variants |
|                     |         +-------------------------+
+---------------------+
```

The Pages deployment carries everything *except* `/content/images/`. A
Worker mounted at the Pages site rewrites `/content/images/*` to the R2
bucket so the browser never learns the bucket exists. Caching, security
headers, and the rest of the Pages config still apply.

## Setup

### 1. Create an R2 bucket

In the Cloudflare dashboard, **R2 -> Create bucket**. Name it after your
site (e.g. `yoursite-images`). Leave it private — the Worker fronts it.

### 2. Sync nectar's image output to R2

After every build, push `dist/content/images/` to the bucket. Nectar's
`[deploy.r2]` target does this with one command:

```toml
# nectar.toml
[deploy.r2]
bucket = "yoursite-images"
endpoint = "https://<account-id>.r2.cloudflarestorage.com"
delete = true  # mirror exactly so stale variants are cleaned up
```

Run it scoped to the images subtree:

```sh
aws s3 sync dist/content/images/ s3://yoursite-images/content/images/ \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --delete
```

(`nectar deploy r2` wraps this; pass `--bucket` and `--endpoint` overrides if
you don't want to commit them to `nectar.toml`.)

### 3. Strip images from the Pages upload

The Pages deploy should *exclude* `dist/content/images/` so the file count
stays small. The simplest way: a build step that moves the directory aside
before the upload step and back afterwards.

```yaml
# In your GitHub Actions workflow:
- name: Move images out of Pages upload
  run: mv dist/content/images /tmp/nectar-images

- name: Deploy to Cloudflare Pages
  run: npx wrangler pages deploy dist --project-name=yoursite

- name: Restore for the R2 sync step
  run: mv /tmp/nectar-images dist/content/images

- name: Sync images to R2
  run: |
    aws s3 sync dist/content/images/ s3://yoursite-images/content/images/ \
      --endpoint-url https://${{ secrets.CF_ACCOUNT_ID }}.r2.cloudflarestorage.com \
      --delete
```

### 4. Add the rewrite Worker

In `wrangler.toml` at the project root:

```toml
name = "yoursite-image-proxy"
main = "src/image-proxy.ts"
compatibility_date = "2024-09-25"

[[r2_buckets]]
binding = "IMAGES"
bucket_name = "yoursite-images"

[[routes]]
pattern = "yoursite.example.com/content/images/*"
zone_name = "yoursite.example.com"
```

In `src/image-proxy.ts`:

```ts
export interface Env {
  IMAGES: R2Bucket;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // Strip the leading slash; R2 keys don't have one.
    const key = url.pathname.slice(1);
    const obj = await env.IMAGES.get(key);
    if (!obj) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('etag', obj.httpEtag);
    return new Response(obj.body, { headers });
  },
};
```

Deploy:

```sh
npx wrangler deploy
```

### 5. Verify

Open the site and inspect an image element in DevTools. The request to
`/content/images/<hash>/foo.webp` should return 200 from your Pages origin,
served by the Worker out of R2. The CDN edge caches the response per the
Worker's `Cache-Control`, so repeated requests skip the R2 round trip.

## Cost notes

R2 charges per GB stored and per Class A operation (writes). Reads from the
Worker are billed as Class B (much cheaper) and are free up to 10M / month.
For a typical blog the monthly bill is a few cents — R2 has no egress fees,
which is why this works.

## Alternative: Cloudflare Images

If you'd rather not run a Worker, **Cloudflare Images** ($5/mo + per-image
fees) accepts your origin images and serves resized variants from
`imagedelivery.net`. Nectar's `{{img_url}}` helper output points at
`/content/images/...` regardless of host, so you'd configure a
`[components.images]`-style rewrite to swap origins — currently a future
work item, tracked separately.

## Troubleshooting

- **404 on every image:** confirm the Worker route `pattern` matches the
  hostname Pages serves on (including the apex/www split). The Worker only
  fires when the route pattern matches.
- **Mixed-origin warnings:** the Worker should set a `Cache-Control` header.
  The image origin is otherwise indistinguishable from any other Pages
  asset.
- **Stale variants:** the `nectar deploy r2 --delete` flag mirrors the
  bucket; without it old variants linger forever and rack up storage cost.
