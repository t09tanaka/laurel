# Cloudflare Pages + R2 images deployment recipe

Use this target when a migrated Ghost image library pushes a Cloudflare Pages
deploy near the file-count limit. Keep pages and assets on Pages, then serve
large `/content/images/` output from R2.

## Recipe

1. Build locally and count files with `find dist -type f | wc -l`.
2. If the deploy is image-heavy, plan the R2 split before Pages rejects it.
3. Deploy the non-image Pages bundle with Cloudflare Pages.
4. Sync image output to R2 with Laurel's R2 deploy target or an S3-compatible
   sync command.
5. Put a Worker or equivalent route in front of image requests.
6. Verify old Ghost image URLs and responsive variants.

## Source docs

- Full guide: [`docs/deploy/cloudflare-pages-r2-images.md`](../deploy/cloudflare-pages-r2-images.md)
- Cloudflare Pages recipe: [`cloudflare-pages.md`](./cloudflare-pages.md)
- General hosting notes: [`docs/HOSTING.md`](../HOSTING.md)
