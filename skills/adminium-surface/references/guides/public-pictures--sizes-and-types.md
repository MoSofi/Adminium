<!-- produced from apps/docs/src/content/docs/guides/apps/public-pictures.md § Sizes and types; do not edit -->

# Pictures on public pages: Sizes and types

| Rule | Limit |
|---|---|
| Type | PNG, JPEG, WebP or GIF, by what the file's bytes are. SVG is never served: it can carry script. |
| File size | 2 MiB at most. |
| Picture size | 8192 pixels a side at most. |
| Frames | 500 at most in an animation (or scans in a progressive JPEG). Every frame lies inside the picture. |

A picture outside these is not served, and answers `404`. A photo resized for the web is far
smaller than any of them.
