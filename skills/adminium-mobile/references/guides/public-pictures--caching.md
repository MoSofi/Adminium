<!-- produced from apps/docs/src/content/docs/guides/apps/public-pictures.md § Caching; do not edit -->

# Pictures on public pages: Caching

A picture is served for any page to show, and for browsers and caches to keep:

| Header | Value |
|---|---|
| `cache-control` | `public, max-age=604800, immutable`: a week |
| `etag` | `"p2-"` and a SHA-256 of the bytes served, never of the original |
| `content-disposition` | `inline`, named after the column (`poster.jpg`), never the name staff gave the file |
| `access-control-allow-origin` | `*` |
| `cross-origin-resource-policy` | `cross-origin` |
| `content-security-policy` | `default-src 'none'; sandbox` |
| `x-content-type-options` | `nosniff` |
| `referrer-policy` | `no-referrer` |

A browser that sends the tag back in `If-None-Match` gets `304`, answered before the picture is
opened and without counting against the key. The address never changes for a given picture: a new
picture is a new file, and so a new address.

The `p2-` prefix is the version of the cleaning. When the cleaning changes, the prefix changes, and
browsers fetch each picture once more.
