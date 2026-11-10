<!-- produced from apps/docs/src/content/docs/guides/apps/public-assets.md § Sizes; do not edit -->

# Models, fonts and SVG pieces on public pages: Sizes

| Kind | Largest |
|---|---|
| A model (GLB, STL, 3MF) | 30 MiB |
| A font (WOFF2) | 2 MiB |
| An SVG | 2 MiB |

The size is held where the file is chosen. A column listed in `assets` takes no file of a kind
larger than its size, whatever its own `maxBytes` says: an upload, or a file chosen with **Choose
existing…**, is refused, saying every visitor's browser loads the column's files. A file saved
before this rule and over the size still answers `404`; the server's log says why. A file column's
own `maxBytes` is at most 25 MiB in this release.
