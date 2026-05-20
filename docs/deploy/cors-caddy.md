# Content API CORS on Caddy

Nectar emits Content API JSON under `dist/content/`. Netlify and Cloudflare
Pages consume the generated `_headers` files; Caddy needs equivalent `header`
directives in the active site block.

Use this snippet when the site is served by hand-written Caddy config instead
of Nectar's generated `dist/.nectar/Caddyfile`.

## Headers

Define matchers for the Content API tree:

```caddyfile
@contentApi path /content/*
@contentPosts path /content/posts/*
@contentTags path /content/tags/*
@contentAuthors path /content/authors/*
@contentOther {
    path /content/*
    not path /content/posts/* /content/tags/* /content/authors/*
}
```

Then attach the CORS headers and per-resource cache policy:

```caddyfile
header @contentApi {
    Access-Control-Allow-Origin "*"
    Access-Control-Allow-Methods "GET, HEAD, OPTIONS"
    Access-Control-Allow-Headers "Content-Type, Authorization"
}

header @contentPosts Cache-Control "public, max-age=300"
header @contentTags Cache-Control "public, max-age=3600"
header @contentAuthors Cache-Control "public, max-age=3600"
header @contentOther Cache-Control "public, max-age=300"
```

The `@contentOther` fallback covers flat files such as
`/content/posts.json`, `/content/settings.json`, and future Content API
shards.

## Verify

After reload, check one flat shard and one nested shard:

```sh
curl -sI https://example.com/content/posts.json | sort
curl -sI https://example.com/content/tags/news.json | sort
```

Both should include:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`
- `Cache-Control` with the TTL shown above
