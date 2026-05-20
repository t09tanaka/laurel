# Deploying Nectar to S3 + CloudFront

S3 + CloudFront is the AWS-native path for serving Nectar's static `dist/`
behind a private bucket. Nectar's deploy CLI handles the S3 upload with
`aws s3 sync`; CloudFront distribution setup, directory-style URL rewrites,
cache policy, and invalidations stay in AWS or your CI workflow.

Use this guide when you already operate in AWS or need CloudFront-specific
controls. For a lower-ops static host, Cloudflare Pages, Netlify, Vercel, and
GitHub Pages have more managed defaults.

## Quickstart: GitHub Actions deploys to AWS

1. Create an S3 bucket for the built site. For a production CloudFront origin,
   keep the bucket private and grant CloudFront access with Origin Access
   Control (OAC). Avoid legacy S3 website hosting unless you intentionally
   need a public HTTP website endpoint.

   If you want Terraform to create the private bucket, CloudFront distribution,
   OAC, and bucket policy together, start from
   [`examples/deploy/s3-cloudfront/terraform/`](../../examples/deploy/s3-cloudfront/terraform/).

2. Create a CloudFront distribution with the S3 bucket as the origin. Set:

   | Setting | Value |
   | --- | --- |
   | Default root object | `index.html` |
   | Viewer protocol policy | Redirect HTTP to HTTPS |
   | Origin access | Origin Access Control for the private S3 bucket |

   Also add CloudFront custom error responses for both `403` and `404` origin
   errors. Point each response at `/404.html` and set the viewer
   `response_code` to `404`. Private S3 origins often return `403
   AccessDenied` for a missing key when CloudFront cannot list the bucket, while
   other policies can return `404 NoSuchKey`; handling both paths ensures real
   misses use Nectar's generated not-found page without converting them into a
   successful `200`.

3. Attach the CloudFront Function in
   [`examples/s3-cloudfront/append-index.js`](../../examples/s3-cloudfront/append-index.js)
   to the viewer-request event for behaviors that serve HTML.

   S3 is object storage, so CloudFront's default root object only maps `/` to
   `/index.html`; it does not map `/about/` to `/about/index.html`. The
   function rewrites trailing-slash page URLs to their generated `index.html`
   object and redirects extensionless page URLs to the canonical trailing
   slash.

4. Copy the starter workflow:

   ```sh
   mkdir -p .github/workflows
   cp examples/ci/s3-cloudfront.yml .github/workflows/s3-cloudfront.yml
   ```

5. In the GitHub repo, add the values referenced by the workflow:

   | Type | Name | Value |
   | --- | --- | --- |
   | Secret | `AWS_ROLE_TO_ASSUME` | IAM role ARN that trusts GitHub OIDC |
   | Secret | `CLOUDFRONT_DISTRIBUTION_ID` | CloudFront distribution ID |
   | Variable | `AWS_REGION` | Bucket / deploy region, for example `us-east-1` |
   | Variable | `S3_BUCKET` | Destination bucket name |

   Prefer OIDC over long-lived `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
   The role needs enough access to sync objects into the bucket and create a
   CloudFront invalidation for the distribution.

   Scope the role to the target resources and allow:

   - `s3:ListBucket` on the destination bucket
   - `s3:GetObject` and `s3:PutObject` on the bucket's objects
   - `s3:DeleteObject` on the bucket's objects if you keep the workflow's
     `aws s3 sync --delete`
   - `cloudfront:CreateInvalidation` on the target distribution

6. Build locally before the first push:

   ```sh
   bunx nectar build
   test -f dist/.nectar-manifest.json
   ```

7. Commit and push to `main`. The workflow installs Bun, builds `dist/`,
   verifies `dist/.nectar-manifest.json`, syncs fingerprinted assets with long
   immutable caching, syncs HTML / XML / TXT with revalidation, then
   invalidates the paths listed in `dist/.nectar/changed-paths.txt` in
   CloudFront.

## Terraform OAC sample

Nectar includes a complete Terraform starter in
[`examples/deploy/s3-cloudfront/terraform/`](../../examples/deploy/s3-cloudfront/terraform/).
It creates:

- a private S3 bucket with public access blocked
- a CloudFront distribution that uses Origin Access Control (OAC), not legacy
  Origin Access Identity (OAI)
- a bucket policy that allows `cloudfront.amazonaws.com` to read objects only
  when `AWS:SourceArn` matches the distribution ARN
- the same custom error responses described below, mapping both S3-origin
  `403` and `404` misses to `/404.html` with viewer status `404`

The sample manages the AWS infrastructure only. It does not run `nectar build`,
upload `dist/`, or create invalidations; use the GitHub Actions workflow above
or your existing CI for that deploy step.

The older
[`examples/deploy/s3-cloudfront/cloudfront-custom-errors.tf.example`](../../examples/deploy/s3-cloudfront/cloudfront-custom-errors.tf.example)
file is a small fragment for teams that already have a CloudFront distribution
and only need Nectar's custom 404 mapping. Do not copy the fragment into the
Terraform starter unless you remove the duplicate `custom_error_response`
blocks already present there.

## Custom 404 responses

Nectar writes `dist/404.html` on every build. S3 does not automatically use
that file as the error document when it is accessed through a CloudFront REST
origin, so configure CloudFront custom error responses instead:

| Origin error | Response page path | Viewer response code |
| --- | --- | --- |
| `403` | `/404.html` | `404` |
| `404` | `/404.html` | `404` |

Keep the `response_code` as `404`. Setting it to `200` makes real missing URLs
look successful to browsers, crawlers, caches, analytics, and uptime checks. The
custom error response should only replace the body with Nectar's branded
`404.html`; the HTTP semantics still need to say "not found".

Terraform distributions can copy the fragment in
[`examples/deploy/s3-cloudfront/cloudfront-custom-errors.tf.example`](../../examples/deploy/s3-cloudfront/cloudfront-custom-errors.tf.example):

```hcl
custom_error_response {
  error_code            = 403
  response_code         = 404
  response_page_path    = "/404.html"
  error_caching_min_ttl = 60
}

custom_error_response {
  error_code            = 404
  response_code         = 404
  response_page_path    = "/404.html"
  error_caching_min_ttl = 60
}
```

CloudFormation uses the same mapping under `CustomErrorResponses`:

```yaml
CustomErrorResponses:
  - ErrorCode: 403
    ResponseCode: 404
    ResponsePagePath: /404.html
    ErrorCachingMinTTL: 60
  - ErrorCode: 404
    ResponseCode: 404
    ResponsePagePath: /404.html
    ErrorCachingMinTTL: 60
```

Use a short `ErrorCachingMinTTL` while you are still changing routes. A longer
TTL is fine once the site structure is stable, but stale cached error responses
can otherwise hide newly uploaded pages until the TTL expires or an invalidation
runs.

## Local deploys with `nectar deploy s3`

For a manual upload after a successful build, configure the S3 target:

```toml
[deploy.s3]
bucket = "my-blog-prod"
region = "us-east-1"
# delete = true # optional: pass --delete to remove stale remote objects
```

Then run:

```sh
bunx nectar deploy s3 --build
```

The command runs `nectar build` first, checks that `dist/.nectar-manifest.json`
exists, then executes:

```sh
aws s3 sync dist s3://my-blog-prod --region us-east-1
```

Use `--dry-run` to audit the exact command before uploading:

```sh
bunx nectar deploy s3 --bucket my-blog-prod --region us-east-1 --dry-run
```

`nectar deploy s3` does not create CloudFront invalidations and does not split
cache-control by file type. Use the GitHub Actions template above when you
want the full S3 + CloudFront production flow with cache headers and
invalidation.

The deploy command reads credentials from the AWS CLI's normal credential
chain. Set `AWS_PROFILE` for a local named profile, or use CI-provided
credentials such as GitHub OIDC. If neither `AWS_ACCESS_KEY_ID` nor
`AWS_PROFILE` is set, Nectar warns and lets the AWS CLI continue with its
default chain.

## CloudFront invalidations

Every successful `nectar build` writes `dist/.nectar/changed-paths.txt` for
CloudFront invalidations. The file contains one invalidation path per line,
using CloudFront's leading-slash format. It is computed from
`dist/.nectar/build-manifest.json` when a previous build manifest exists. On
the first build, or when the previous manifest cannot be read, Nectar writes
the safe fallback `/*`.

After syncing `dist/` to S3, pass the file directly to the AWS CLI:

```sh
aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths $(cat dist/.nectar/changed-paths.txt)
```

If you want to skip no-op invalidations when a rebuild produces no changed
public files, guard the command:

```sh
if [ -s dist/.nectar/changed-paths.txt ]; then
  aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
    --paths $(cat dist/.nectar/changed-paths.txt)
fi
```

For `index.html` routes, Nectar includes both the generated object path and the
viewer-facing directory path, for example `/about/index.html` and `/about/`.
Internal build metadata under `dist/.nectar/` is not included in the
invalidation list.

## Redirects

Nectar writes `dist/_redirects` when `[components.redirects]` is enabled, but
S3 and CloudFront do not consume that file automatically. For S3 + CloudFront,
choose one of these paths:

- Model redirects in CloudFront, Lambda@Edge, CloudFront Functions, or another
  AWS-owned routing layer.
- Enable HTML refresh fallback pages when HTTP status preservation is not
  required:

  ```toml
  [components.redirects]
  emit_html = true
  ```

  This writes `<from>/index.html` pages that jump to the target URL in the
  browser. Each response is still a `200`, so prefer real CloudFront routing
  for permanent redirects, SEO-sensitive migrations, and API-like paths.

## Headers and caching

S3 + CloudFront ignores Nectar's `_headers` output conventions for Cloudflare
Pages and Netlify. Configure response headers in CloudFront with a Response
Headers Policy, and configure caching with CloudFront cache policies plus the
object metadata you upload to S3.

The starter workflow uses two `aws s3 sync` passes:

- fingerprinted assets receive `Cache-Control: public, max-age=31536000,
  immutable`
- HTML, XML, and TXT receive `Cache-Control: public, max-age=0,
  must-revalidate`

If you deploy locally with `nectar deploy s3`, add cache headers yourself or
adapt the workflow's two-pass `aws s3 sync` commands.

## Troubleshooting

- **`nectar deploy s3` asks for a bucket:** set `[deploy.s3].bucket` or pass
  `--bucket`.
- **AWS CLI uploads to the wrong region:** set `[deploy.s3].region`, pass
  `--region`, or configure the active AWS profile's default region.
- **Old pages stay visible after upload:** create a CloudFront invalidation
  after the S3 sync, or use the starter workflow's invalidation step.
- **`/about/` returns 403 or 404:** attach
  `examples/s3-cloudfront/append-index.js` to the viewer-request event, and
  confirm the object `about/index.html` exists in S3.
- **Redirects in `redirects.yaml` do nothing:** S3 + CloudFront does not read
  `dist/_redirects`. Move those rules into CloudFront or enable
  `[components.redirects].emit_html` for client-side fallback pages.
