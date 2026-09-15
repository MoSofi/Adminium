---
'@adminium/server': patch
---

**Hosted apps can show pictures stored on another host.** A new
`ADMINIUM_CSP_IMG_HOSTS` variable names extra origins the Content-Security-Policy
allows images from, for example `https://images.example.com`.

Adminium sends one policy on everything it serves, and it allowed pictures only
from Adminium itself and the map tiles its map widgets draw. Hosted app surfaces
are served under that same policy, so an app whose data links images kept
elsewhere showed broken pictures. The point-of-sale menu, whose `image_url`
column points at a CDN, rendered every tile as a broken image, while the same
build outside Adminium showed them.

The hosts are appended to `img-src` and nothing else in the policy changes.
Unset, the header is exactly what it was. Each entry must be a scheme and a
host, with an optional port and a leading `*.` for subdomains. A bare `*`, a
scheme on its own, a path, or a wildcard over a whole top-level domain stops the
boot with every refused value named. Either of the first two would let any
script that lands on the instance send data anywhere as an image request.
