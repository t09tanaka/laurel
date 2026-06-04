# Deploying a Cloudflare Pages site with images on R2

Cloudflare Pages caps deployments at **25,000 files** per upload. A
content-heavy Laurel build can blow past that limit once `[components.images]`
generates responsive width variants and WebP/AVIF format variants for every
post image — a 200-post site with three widths and three formats per image
ships 1800+ image files alone.

The fix is to keep HTML, CSS, JS, and JSON on Pages, and move the image
output tree (`/content/images/`) to **Cloudflare R2** behind a Worker or a
Cloudflare-managed public/custom domain.
The browser sees a single origin (your Pages domain) thanks to a Cloudflare
Worker that rewrites `/content/images/*` requests to R2.

This recipe is intentionally explicit about which command syncs what:

- `laurel deploy cloudflare` deploys the static Pages bundle with Wrangler.
- `laurel deploy r2` wraps `aws s3 sync dist s3://<bucket> --endpoint-url
  <endpoint>` and is useful when an R2 bucket is the deploy target for the
  whole `dist/` tree.
- For the split Pages + R2 image-origin pattern below, sync
  `dist/content/images/` with the AWS CLI so only image objects land in R2.

## When to use this recipe

Run `laurel build` and count the files in `dist/`:

```sh
find dist -type f | wc -l
```

If you are within 80% of 25,000 (around 20,000 files), set this up before
the next image-heavy post pushes you over the limit. `laurel deploy
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

The Pages deployment carries everything *except* `/content/images/`. A Worker
mounted on the Pages hostname rewrites `/content/images/*` to the R2 bucket so
the browser keeps requesting the normal Laurel image URLs. Caching, security
headers, and the rest of the Pages config still apply to the Pages-rendered
HTML.

## Setup

### 1. Create an R2 bucket and credentials

In the Cloudflare dashboard, **R2 -> Create bucket**. Name it after your
site (e.g. `yoursite-images`). For the Worker pattern, leave public access off;
the Worker reads the private bucket through an R2 binding.

Then create an R2 API token from **R2 -> Manage R2 API tokens** with object
read/write access to that bucket. The AWS CLI uses the generated access key id
and secret access key:

```sh
export AWS_ACCESS_KEY_ID=<r2-access-key-id>
export AWS_SECRET_ACCESS_KEY=<r2-secret-access-key>
export AWS_DEFAULT_REGION=auto
```

The R2 S3-compatible endpoint is:

```text
https://<account-id>.r2.cloudflarestorage.com
```

### 2. Sync laurel's image output to R2

After every build, push `dist/content/images/` to the bucket under the same
key prefix. That keeps the generated Laurel URLs stable:

```sh
aws s3 sync dist/content/images/ s3://yoursite-images/content/images/ \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --delete
```

Use `--delete` only when this bucket/prefix is dedicated to generated Laurel
images; it removes stale responsive variants that no longer exist locally.

If you want R2 to host the entire `dist/` output instead of only images,
configure Laurel's R2 deploy target and use `laurel deploy r2`:

```toml
# laurel.toml
[deploy.r2]
bucket = "yoursite-static"
endpoint = "https://<account-id>.r2.cloudflarestorage.com"
delete = true
```

```sh
bunx laurel deploy r2 --build --dry-run
bunx laurel deploy r2 --build
```

That command syncs the configured build output directory, normally `dist/`, to
the bucket root. It does not currently have a flag for syncing only
`dist/content/images/`.

When R2 hosts the complete `dist/` tree behind a Worker, copy
[`examples/r2/worker.ts`](../../examples/r2/worker.ts) and
[`examples/r2/wrangler.toml`](../../examples/r2/wrangler.toml) into your site
repo. The sample maps `/` to `index.html` and `<slug>/` to
`<slug>/index.html`, then reads `dist/_routes-manifest.json` from R2 so the
same `[deploy.headers]` security/cache headers and `redirects.yaml` rules can
apply at the Worker edge. Generate that manifest by enabling:

```toml
[deploy.cloudflare_workers]
enabled = true
```

Then rebuild before syncing to R2:

```sh
bunx laurel build
bunx laurel deploy r2 --dry-run
bunx laurel deploy r2
```

### 3. Strip images from the Pages upload

The Pages deploy should *exclude* `dist/content/images/` so the file count
stays small. The simplest way: a build step that moves the directory aside
before the upload step and back afterwards.

```yaml
# In your GitHub Actions workflow:
- name: Move images out of Pages upload
  run: mv dist/content/images /tmp/laurel-images

- name: Deploy to Cloudflare Pages
  run: npx wrangler pages deploy dist --project-name=yoursite

- name: Restore for the R2 sync step
  run: mv /tmp/laurel-images dist/content/images

- name: Sync images to R2
  run: |
    aws s3 sync dist/content/images/ s3://yoursite-images/content/images/ \
      --endpoint-url https://${{ secrets.CF_ACCOUNT_ID }}.r2.cloudflarestorage.com \
      --delete
```

If the images directory may be absent on small sites, guard the move:

```sh
if [ -d dist/content/images ]; then
  mv dist/content/images /tmp/laurel-images
fi
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
    if (!url.pathname.startsWith('/content/images/')) {
      return new Response('Not found', { status: 404 });
    }
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

### 5. Alternative: R2 public or custom domain

R2 can also serve a bucket through a Cloudflare-managed `r2.dev` URL or a
custom domain attached to your zone. That removes the Worker code, but the
tradeoff is origin shape:

- A custom domain such as `images.example.com` is simple and cacheable, but
  Laurel image URLs are still emitted as `/content/images/...`; you need a
  redirect/rewrite layer on Pages or theme/config changes that point images at
  the image domain.
- A public `r2.dev` URL is useful for smoke tests, but Cloudflare recommends a
  custom domain for production control over cache, TLS, and hostname policy.
- A Worker binding keeps the bucket private and preserves same-origin
  `/content/images/...` URLs, which is why it is the default recipe here.

### 6. Verify

Open the site and inspect an image element in DevTools. The request to
`/content/images/<hash>/foo.webp` should return 200 from your Pages origin,
served by the Worker out of R2. The CDN edge caches the response per the
Worker's `Cache-Control`, so repeated requests skip the R2 round trip.

Before running a real Pages upload in CI, dry-run the Pages deploy command.
You can also dry-run the whole-bucket R2 target if you use R2 as the complete
static host:

```sh
bunx laurel deploy cloudflare --build --dry-run --project-name yoursite
bunx laurel deploy r2 --dry-run --bucket yoursite-static \
  --endpoint https://<account-id>.r2.cloudflarestorage.com
```

The second command is a whole-`dist/` plan check. For the split image-origin
setup, keep using the scoped `aws s3 sync dist/content/images/ ...` command
shown above.

## Cost notes

R2 charges per GB stored and per Class A operation (writes). Reads from the
Worker are billed as Class B (much cheaper) and are free up to 10M / month.
For a typical blog the monthly bill is a few cents — R2 has no egress fees,
which is why this works.

## Alternative: Cloudflare Images

If you'd rather not run a Worker, **Cloudflare Images** ($5/mo + per-image
fees) accepts your origin images and serves resized variants from
`imagedelivery.net`. Laurel's `{{img_url}}` helper output points at
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
- **Stale variants:** keep `--delete` on the scoped
  `aws s3 sync dist/content/images/ s3://.../content/images/` command when
  that bucket/prefix is dedicated to generated Laurel images. Without it old
  variants linger forever and rack up storage cost.
