# Content API CORS on nginx

Laurel can emit Content API JSON under `dist/content/` when
`[components.content_api].enabled = true` is set (off by default). Netlify
and Cloudflare Pages consume the generated `_headers` files, but self-hosted
nginx needs equivalent `add_header` rules in the active server config.

Use these snippets when the site is served by hand-written nginx config instead
of Laurel's generated `dist/.laurel/nginx.conf`.

## Headers

Add the CORS headers to every `/content/*` response:

```nginx
location ^~ /content/ {
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
    add_header Cache-Control "public, max-age=300" always;

    try_files $uri $uri/ =404;
}
```

Then put the more specific cache rules before that catch-all location:

```nginx
location ^~ /content/posts/ {
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
    add_header Cache-Control "public, max-age=300" always;

    try_files $uri $uri/ =404;
}

location ^~ /content/tags/ {
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
    add_header Cache-Control "public, max-age=3600" always;

    try_files $uri $uri/ =404;
}

location ^~ /content/authors/ {
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
    add_header Cache-Control "public, max-age=3600" always;

    try_files $uri $uri/ =404;
}
```

nginx does not inherit parent `add_header` directives once a child `location`
declares its own headers, so each block repeats the full CORS set.

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
