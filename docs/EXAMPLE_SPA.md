# Example SPA consumer

Laurel emits a static, Ghost-shaped Content API during `laurel build`. A
single-page app can read that JSON directly from the deployed site with the
same `@tryghost/content-api` SDK used for a hosted Ghost site.

This example uses React, but the SDK setup is the important part. The same
client can be used from Vue, Svelte, or plain browser JavaScript.

## 1. Enable and deploy the Content API

The Content API is off by default. SPA consumers must opt it in:

```toml
[components.content_api]
enabled = true
```

Build and deploy the generated `dist/` directory to a static host:

```bash
laurel build
```

The deployed site must serve these generated files:

- `/ghost/api/content/posts.json`
- `/ghost/api/content/posts/index.json`
- `/ghost/api/content/settings.json`
- `/content/posts.json`

## 2. Install the SDK

```bash
npm install @tryghost/content-api
```

Use the package manager that matches the SPA project. The SDK does not need a
Laurel-specific adapter.

## 3. Fetch posts from React

```tsx
import GhostContentAPI from '@tryghost/content-api';
import { useEffect, useState } from 'react';

const api = new GhostContentAPI({
  // Use the public URL that serves the Laurel build's dist/ directory.
  // Include the base path for subpath deploys, for example:
  // https://example.com/blog
  url: 'https://blog.example.com',

  // Laurel is static and does not validate keys. The SDK still requires one.
  key: '00000000000000000000000000',

  // Match the Ghost Content API SDK version shape Laurel mirrors.
  version: 'v5.0',
});

type Post = {
  id: string;
  slug: string;
  title: string;
  excerpt?: string;
  url?: string;
};

export function LatestPosts() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    api.posts
      .browse({ limit: 5, include: ['tags', 'authors'] })
      .then((items) => setPosts(items as Post[]))
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  if (error) {
    return <p>Could not load posts.</p>;
  }

  return (
    <ul>
      {posts.map((post) => (
        <li key={post.id}>
          <a href={post.url ?? `/${post.slug}/`}>{post.title}</a>
          {post.excerpt ? <p>{post.excerpt}</p> : null}
        </li>
      ))}
    </ul>
  );
}
```

With the `url` above, the SDK requests:

```text
https://blog.example.com/ghost/api/content/posts/?key=00000000000000000000000000&limit=5&include=tags%2Cauthors
```

Static hosts that do not map extensionless directory URLs to `index.json`
need the generated redirects / rewrites from Laurel's platform outputs, or an
equivalent host rule, so `/ghost/api/content/posts/` resolves to
`/ghost/api/content/posts/index.json`.

## SDK shadow tree vs flat dump

Laurel writes the same Content API payloads in two layouts:

| Layout | Use it when | Example |
| ------ | ----------- | ------- |
| `/ghost/api/content/*` | You use `@tryghost/content-api` or another Ghost SDK-compatible client. | `/ghost/api/content/posts/` -> `/ghost/api/content/posts/index.json` |
| `/content/*` | You fetch JSON yourself without the SDK. | `/content/posts.json` |

Use only `/ghost/api/content/*` with `@tryghost/content-api`. The SDK always
builds Ghost-style URLs under `/ghost/api/content/`; pointing it at
`/content/posts.json` is not supported. If you prefer the flat dump, skip the
SDK:

```ts
const response = await fetch('https://blog.example.com/content/posts.json');
const { posts } = await response.json();
```

## Keys and public data

Ghost's SDK requires a `key` during initialization and appends it as `?key=...`
to each request. Laurel accepts and ignores that query parameter because the
build output is static public JSON. Use a dummy value in browser code, and do
not put a real Ghost Admin API key or any private secret in an SPA bundle.

## Cross-origin SPAs

If the SPA runs on a different origin from the Laurel build, the host serving
`dist/` must return CORS headers for the Content API paths it reads:

- SDK clients need CORS on `/ghost/api/content/*`.
- Flat `fetch()` clients need CORS on `/content/*`.

Netlify and Cloudflare Pages can use Laurel's generated `_headers` files for
the flat `/content/*` dump. If an SDK-powered SPA is cross-origin, add a
matching host rule for `/ghost/api/content/*` unless your fronting layer already
applies the same CORS policy globally. Self-hosted deployments can adapt the
snippets linked from [`docs/api.md`](./api.md#per-resource-cache-control).

For the full emitted API contract, see [`docs/api.md`](./api.md).
