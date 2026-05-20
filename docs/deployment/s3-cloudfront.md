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

## Source docs

- Full guide: [`docs/deploy/s3-cloudfront.md`](../deploy/s3-cloudfront.md)
- CI example: [`examples/ci/s3-cloudfront.yml`](../../examples/ci/s3-cloudfront.yml)
- Terraform and CloudFront examples: [`examples/deploy/s3-cloudfront/`](../../examples/deploy/s3-cloudfront/)
