# S3 + CloudFront Terraform sample

This sample creates the AWS hosting layer for a Nectar `dist/` directory:

- a private S3 bucket with public access blocked
- a CloudFront distribution that serves that bucket through Origin Access
  Control (OAC)
- a bucket policy that only allows the CloudFront distribution to read objects
- CloudFront custom error responses that serve `/404.html` for S3-origin `403`
  and `404` misses while preserving the viewer `404` status

It intentionally uses OAC, not the legacy Origin Access Identity (OAI) model.

## Usage

```sh
terraform init
terraform plan \
  -var='bucket_name=my-nectar-site-prod' \
  -var='site_name=my-nectar-site'
```

For a custom domain, create or import an ACM certificate in `us-east-1`, then
set both `aliases` and `acm_certificate_arn`:

```sh
terraform plan \
  -var='bucket_name=my-nectar-site-prod' \
  -var='aliases=["www.example.com"]' \
  -var='acm_certificate_arn=arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000'
```

After applying, upload a built site with the GitHub Actions workflow in
`examples/ci/s3-cloudfront.yml` or with:

```sh
bunx nectar build
aws s3 sync dist s3://my-nectar-site-prod --delete
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths '/*'
```

## Relationship to `cloudfront-custom-errors.tf.example`

This full sample already includes the two `custom_error_response` blocks from
`../cloudfront-custom-errors.tf.example`. Use the standalone fragment only when
you already manage your CloudFront distribution elsewhere and just need to add
Nectar's `403` / `404` mapping.

For directory-style URLs such as `/about/`, also attach the CloudFront Function
from `examples/s3-cloudfront/append-index.js` to the viewer-request event. This
Terraform sample keeps that function separate so teams can decide whether to
manage function code in Terraform, the AWS console, or CI.
