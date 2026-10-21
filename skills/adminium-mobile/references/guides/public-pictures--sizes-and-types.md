<!-- produced from apps/docs/src/content/docs/guides/apps/public-pictures.md § Sizes and types; do not edit -->

# Pictures on public pages: Sizes and types

| Rule | Limit |
|---|---|
| Type | PNG, JPEG, WebP or GIF, by what the file's bytes are. SVG is never served: it can carry script. |
| File size | 5 MiB (5242880 bytes) at most. |
| Picture size | 8192 pixels a side at most. |
| Frames | 500 at most in an animation (or scans in a progressive JPEG). Every frame lies inside the picture. |

A picture outside these is not served, and answers `404`. A photo resized for the web is far
smaller than any of them.

The file size is held where the picture is chosen, so a picture staff save is one visitors see. A
column listed in `pictures` takes no file over 5 MiB, whatever its own `maxBytes` says: an upload
or a picture chosen with **Choose existing…** is refused with "Customers see these pictures, so each
can be at most 5 MB." The validator warns about a picture column whose `maxBytes` is larger, and the
Designer always writes `5242880`. A picture saved before this rule (or written by a door that is not
a person's) and over the limit still answers `404`; the server's log says why.
