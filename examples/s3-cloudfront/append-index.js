// CloudFront Function (viewer-request) — append index.html for sub-path requests.
//
// Problem: S3 (used as a private origin behind CloudFront with OAC/OAI) treats
// the bucket as object storage. Only the root key `index.html` is mapped to `/`
// by CloudFront's "Default root object" setting. Sub-paths like `/about/` or
// `/about` do NOT auto-resolve to `/about/index.html`. The legacy S3 "website
// hosting" mode does, but it exposes a public HTTP origin (no OAC) and is
// generally discouraged for production.
//
// Fix: rewrite the request URI inside a CloudFront Function attached to the
// distribution's "viewer-request" event so every directory-style URL hits the
// expected `index.html` object in S3.
//
// Behavior:
//   /                        -> CloudFront's "Default root object" handles it.
//   /about/                  -> rewrite to /about/index.html
//   /about                   -> 301 redirect to /about/ (canonical trailing slash)
//   /tag/news/               -> rewrite to /tag/news/index.html
//   /assets/built/screen.css -> unchanged (has an extension)
//
// The trailing-slash redirect is intentional: Nectar emits `<slug>/index.html`,
// so the canonical URL ends in `/`. Without the redirect, an HTML page served
// for `/about` would resolve sibling relative URLs against `/`, breaking
// `./image.png`, `./assets/...`, etc. This mirrors the nginx recipe that
// relies on `try_files $uri $uri/ $uri/index.html` to trigger nginx's
// directory `index` directive (which issues the same redirect).
//
// Install:
//   1. CloudFront console -> Functions -> Create function.
//      Name: append-index   Runtime: cloudfront-js-2.0 (or 1.0)
//   2. Paste this file's contents, Save, Publish.
//   3. Open your distribution -> Behaviors -> the default `*` behavior
//      (and any other behaviors that serve HTML) -> Edit -> Function
//      associations -> Viewer request: Function type = CloudFront Functions,
//      Function ARN = the published function. Save.
//   4. Wait for the distribution to redeploy.
//
// See docs/tutorials/04-deploy.md for the broader deploy walkthrough.

function handler(event) {
  const request = event.request;
  const uri = request.uri;

  if (uri.endsWith('/')) {
    request.uri = `${uri}index.html`;
    return request;
  }

  const lastSlash = uri.lastIndexOf('/');
  const lastSegment = uri.slice(lastSlash + 1);
  if (lastSegment.indexOf('.') === -1) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: `${uri}/` },
      },
    };
  }

  return request;
}
