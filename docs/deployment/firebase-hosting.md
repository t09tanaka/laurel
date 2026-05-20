# Firebase Hosting deployment recipe

Use this target when Firebase Hosting should serve Nectar's static `dist/`
output. Nectar does not currently emit Firebase config, so `firebase.json` is
owned by the site.

## Recipe

1. Set `site.url` to the Firebase Hosting URL or custom domain.
2. Run `bunx nectar build`.
3. Create or update `firebase.json` with `dist` as the public directory.
4. Preserve clean URL and 404 behavior from the full guide.
5. Run `firebase deploy --only hosting`.
6. Verify headers, canonical URLs, RSS, sitemap, and imported Ghost redirects.

## Source docs

- Full guide: [`docs/deploy/firebase-hosting.md`](../deploy/firebase-hosting.md)
- Security header checklist: [`docs/security/hosting.md`](../security/hosting.md)
- Deploy tutorial: [`docs/tutorials/04-deploy.md`](../tutorials/04-deploy.md)
