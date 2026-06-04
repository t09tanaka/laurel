---
name: laurel-deploy
description: Use when publishing a built Laurel site to a host — Cloudflare Pages, Netlify, Vercel, GitHub Pages, S3, R2, or rsync. Covers `laurel deploy <target>`, building for production first, the `--dry-run` / `--preflight` safety passes, and per-target flags and `[deploy.*]` config. For toggling site components or config, defer to laurel-setting; for build failures, laurel-build-troubleshoot.
version: 1
applies_to:
  - claude
  - codex
triggers:
  - deploy the site
  - laurel deploy
  - publish to Cloudflare Pages
  - deploy to Netlify
  - deploy to Vercel
  - deploy to GitHub Pages
  - deploy to S3
  - rsync the site
  - ship the built site
---

# Deploying a Laurel site

`laurel deploy <target>` publishes the built static site (`dist/`) to a hosting
target. It shells out to each host's own tool (`wrangler`, `netlify`, `vercel`,
`git`, `aws s3 sync`, `rsync`), so that tool must be installed and authenticated.
Targets: `cloudflare`, `netlify`, `vercel`, `github-pages`, `s3`, `r2`, `rsync`.

## Build first, then deploy

Deploy publishes whatever is in `dist/`, so build before deploying — or let
deploy build for you:

```sh
laurel build && laurel deploy netlify        # build, then publish dist/
laurel deploy netlify --build                # equivalent: build as part of deploy
```

## Always dry-run / preflight first

```sh
laurel deploy s3 --bucket my-bucket --region us-east-1 --dry-run
```

`--dry-run` prints the external command(s), the files that would be deployed,
and the changed-path diff from the last build — without spawning anything. Run
it before a real deploy to confirm the right target and files. For S3, add
`--preflight` to check the bucket policy and warn if the bucket is public.

## Per-target invocations

```sh
laurel deploy cloudflare --project-name my-blog --build   # Cloudflare Pages (wrangler)
laurel deploy netlify --site-id abc123                    # Netlify
laurel deploy vercel --prod                               # Vercel production deploy
laurel deploy github-pages --branch gh-pages              # push dist/ to a pages branch
laurel deploy s3 --bucket my-bucket --region us-east-1    # aws s3 sync
laurel deploy r2 --bucket my-bucket --endpoint <r2-url>   # Cloudflare R2 (S3-compatible)
laurel deploy rsync --destination user@host:/var/www/site/
```

Flags map to the underlying tool: `--project-name` / `--branch` (cloudflare),
`--site-id` (netlify), `--prod` (netlify/vercel), `--bucket` / `--region`
(s3), `--bucket` / `--endpoint` (r2), `--destination` / `--remote`
(rsync / github-pages). Any flag can instead live under `[deploy.<target>]` in
`laurel.toml` so CI only passes the target name.

## Configure once in laurel.toml

```toml
[deploy.cloudflare]
project_name = "my-blog"

[deploy.s3]
bucket = "my-bucket"
region = "us-east-1"
```

With config in place, CI runs just `laurel deploy cloudflare --build`. Use the
`laurel-setting` skill for editing `laurel.toml`.

## Common mistakes this workflow avoids

- Deploying a stale `dist/` because you forgot to rebuild → use `--build`, or
  `laurel build && laurel deploy …`.
- Running a real deploy to the wrong bucket/site → `--dry-run` first to see the
  exact command and file diff; `--preflight` to catch a public S3 bucket.
- Expecting Laurel to authenticate for you → deploy shells out to `wrangler` /
  `netlify` / `vercel` / `aws` / `rsync`; install and log in to that tool first.
- A failing build surfacing during deploy → fix the build with the
  `laurel-build-troubleshoot` skill before publishing.
