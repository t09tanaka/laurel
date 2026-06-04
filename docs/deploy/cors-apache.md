# Content API CORS on Apache HTTPD

Laurel emits Content API JSON under `dist/content/`. Netlify and Cloudflare
Pages consume the generated `_headers` files; Apache needs equivalent
`mod_headers` rules.

If Apache can read `.htaccess`, the simplest option is Laurel's dedicated
Content API file:

```toml
[components.content_api]
enabled = true
emit_htaccess = true
```

That writes `dist/content/.htaccess`. Deploy the full `dist/` tree and ensure
the virtual host allows file-info overrides for the document root:

```apache
<Directory "/var/www/laurel">
    AllowOverride FileInfo
</Directory>
```

## Manual snippet

If you keep Apache config in the virtual host instead of `.htaccess`, use the
same header set directly:

```apache
<IfModule mod_headers.c>
    <LocationMatch "^/content/">
        Header always set Access-Control-Allow-Origin "*"
        Header always set Access-Control-Allow-Methods "GET, HEAD, OPTIONS"
        Header always set Access-Control-Allow-Headers "Content-Type, Authorization"
        Header set Cache-Control "public, max-age=300"
    </LocationMatch>

    <LocationMatch "^/content/tags/">
        Header set Cache-Control "public, max-age=3600"
    </LocationMatch>

    <LocationMatch "^/content/authors/">
        Header set Cache-Control "public, max-age=3600"
    </LocationMatch>
</IfModule>
```

Posts and the `/content/*` fallback use `public, max-age=300`. Tags and authors
use `public, max-age=3600`, matching the generated Netlify and Cloudflare
headers.

## Verify

After reload, check one flat shard and one nested shard:

```sh
curl -sI https://example.com/content/posts.json | sort
curl -sI https://example.com/content/authors/casper.json | sort
```

Both should include:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`
- `Cache-Control` with the TTL shown above
