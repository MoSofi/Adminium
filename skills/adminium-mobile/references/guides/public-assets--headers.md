<!-- produced from apps/docs/src/content/docs/guides/apps/public-assets.md § Headers; do not edit -->

# Models, fonts and SVG pieces on public pages: Headers

| Header | Value |
|---|---|
| `content-type` | The stored kind: `model/gltf-binary`, `model/stl`, `model/3mf`, `font/woff2`, `image/svg+xml` |
| `cache-control` | `public, max-age=86400, immutable`: a file's bytes never change under its id |
| `etag` | `"a-"` and the SHA-256 of the file; `If-None-Match` gets `304` without counting against the key |
| `content-disposition` | `inline`, named after the column (`preview.glb`), never the name staff gave the file |
| `content-security-policy` | `default-src 'none'; sandbox`; for an SVG `default-src 'none'; style-src 'unsafe-inline'; sandbox` |
| `x-content-type-options` | `nosniff` |
| `access-control-allow-origin` | `*` |
| `cross-origin-resource-policy` | `cross-origin` |

Nothing is cleaned when an asset is served: each was read whole, or cleaned, as it was uploaded.
Assets are counted with pictures: 1,200 a minute for one visitor, 6,000 for the whole key.
