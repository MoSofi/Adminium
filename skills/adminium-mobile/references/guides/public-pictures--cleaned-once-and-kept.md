<!-- produced from apps/docs/src/content/docs/guides/apps/public-pictures.md § Cleaned once, and kept; do not edit -->

# Pictures on public pages: Cleaned once, and kept

Staff upload what their camera made. Before a stranger's browser gets it, Adminium reads the file
again and takes out what the camera wrote beside the picture: where it was taken (a kitchen, a
home), the device, comments and XMP.

| Type | What is kept |
|---|---|
| JPEG | The image, its JFIF block, colour profile and Adobe colour block. Nothing after the image's end, and between the scans of a progressive picture the same blocks go as before the first. |
| PNG | Its pixels, palette, transparency, colour chunks, physical size and an animation's frames. Any other chunk goes, including text, time, Exif, a content credential and private chunks: a chunk Adminium does not know is one it cannot vouch for. |
| WebP | Its image (lossy, lossless, alpha), extended header, animation and colour profile. Exif, XMP and any unknown chunk go. |
| GIF | Its frames and its loop. Comments and other application blocks go. |

A picture is cleaned **once**, the first time anyone asks for it. The cleaned copy is kept beside
the original file, in the same storage, and served from there after that, even after a restart or
from another server. It goes when the original does. The original is never changed.

At most two pictures are cleaned at once on a server, and one for any one visitor. A request past
that is answered `503` `PUBLIC_UPSTREAM_UNAVAILABLE` with `Retry-After: 1`.
