---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/public-client': patch
---

A shop's product assets: a file column may take a cleaned SVG (`svg`, kept only as Adminium writes it again from its own tree, with no script, event handler, outside link or foreign namespace), 3D models (`glb`, `stl`, `3mf`) and web fonts (`woff2`), each read whole as it is uploaded and refused when it is not what it says (a GLB pointing outside itself or needing Draco or meshopt, a zip renamed 3MF, a 3MF declaring more than it may unpack). A public entry's new `assets` list serves such columns to every visitor's browser at `GET /api/v1/public/assets/…`, on the pictures route's terms, each kind held to its own size (a model 30 MiB, a font or an SVG 2 MiB). `assetUrls` in the public client builds their addresses.
