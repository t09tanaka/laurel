# Firebase Hosting deployment recipe

Use this target when Firebase Hosting should serve Nectar's static `dist/`
output. Enable `[deploy.firebase]` to emit `dist/firebase.json` from Nectar's
shared deploy headers, redirects, clean URL, and trailing-slash config.

## Recipe

1. Set `site.url` to the Firebase Hosting URL or custom domain.
2. Add `[deploy.firebase] enabled = true` to `nectar.toml`.
3. Run `bunx nectar build`.
4. Deploy from `dist/`, or copy the generated Hosting block into your root
   `firebase.json` if your workflow runs the Firebase CLI from the project root.
5. Run `firebase deploy --only hosting`.
6. Verify headers, canonical URLs, RSS, sitemap, and imported Ghost redirects.

## Source docs

- Full guide: [`docs/deploy/firebase-hosting.md`](../deploy/firebase-hosting.md)
- Security header checklist: [`docs/security/hosting.md`](../security/hosting.md)
- Deploy tutorial: [`docs/tutorials/04-deploy.md`](../tutorials/04-deploy.md)
