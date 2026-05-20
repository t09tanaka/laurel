# Firebase Hosting deployment recipe

Use this target when Firebase Hosting should serve Nectar's static `dist/`
output. Enable `[deploy.firebase]` to emit `dist/firebase.json` from Nectar's
shared deploy headers, redirects, clean URL, and trailing-slash config.

## Recipe

1. Set `site.url` to the Firebase Hosting URL or custom domain.
2. Add `[deploy.firebase] enabled = true` to `nectar.toml`.
3. Run `bunx nectar build`.
4. Deploy from `dist/`, or use the GitHub Actions sample that points
   FirebaseExtended/action-hosting-deploy at `entryPoint: dist`.
5. Run `firebase deploy --only hosting` for local CLI deploys.
6. Verify headers, canonical URLs, RSS, sitemap, and imported Ghost redirects.

## Source docs

- Full guide: [`docs/deploy/firebase-hosting.md`](../deploy/firebase-hosting.md)
- CI example: [`examples/ci/firebase.yml`](../../examples/ci/firebase.yml)
- Security header checklist: [`docs/security/hosting.md`](../security/hosting.md)
- Deploy tutorial: [`docs/tutorials/04-deploy.md`](../tutorials/04-deploy.md)
