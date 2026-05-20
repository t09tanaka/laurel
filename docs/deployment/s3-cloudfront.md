# S3 + CloudFront deployment recipe

Use this target when a Ghost migration should become an AWS-native static site
served from S3 through CloudFront.

## Recipe

1. Set `site.url` to the CloudFront or custom-domain URL.
2. Run `bunx nectar build`.
3. Create a private S3 bucket and CloudFront distribution with OAC.
4. Add directory-style URL rewriting for `/page/` to `/page/index.html`.
5. Publish `dist/` with `nectar deploy s3` or the CI workflow.
6. Verify custom error responses, redirects, cache policy, RSS, sitemap, and
   old Ghost URLs.

## Lifecycle controls

Add S3 lifecycle rules before enabling production traffic. Nectar fingerprints
built assets under `assets/built/`, so replaced JS and CSS objects are safe to
remove after the new build has settled.

- If bucket versioning is enabled, expire non-current versions under
  `assets/built/` after 30 days. Keep the current version because CloudFront may
  still serve the hashed URL until its cache naturally drains.
- For CloudFront or S3 access logs, write them to a dedicated `logs/` prefix or
  bucket, then transition them to a Glacier storage class such as
  `GLACIER_IR`, `GLACIER`, or `DEEP_ARCHIVE` after the hot debugging window.
  Add a final expiration if your retention policy allows it.

Without these rules, old fingerprinted assets and access logs can accumulate
forever and quietly grow the AWS bill.

## Source docs

- Full guide: [`docs/deploy/s3-cloudfront.md`](../deploy/s3-cloudfront.md)
- CI example: [`examples/ci/s3-cloudfront.yml`](../../examples/ci/s3-cloudfront.yml)
- Terraform and CloudFront examples: [`examples/deploy/s3-cloudfront/`](../../examples/deploy/s3-cloudfront/)
