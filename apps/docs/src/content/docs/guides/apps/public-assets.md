---
title: Models, fonts and SVG pieces on public pages
description: How a shop serves its 3D models (GLB, STL, 3MF), web fonts (WOFF2) and SVG pieces to every visitor's browser, how Adminium reads each file whole before keeping it, and how an SVG is cleaned.
---

A maker's shop shows each product in a 3D viewer, offers the product's print file, draws a
customer's name in the shop's own font, and lays out the SVG pieces a book nook is cut from. Staff
upload these files in the staff screens. Every visitor's browser loads them on the app's public
pages: a viewer `fetch`es the model, a page's `@font-face` loads the font. These requests send no
key and no session, so the files are served by a route of their own, on the same terms as
[pictures](/guides/apps/public-pictures/): only when the app declared them public and the row they
belong to is one anyone may read.

Needs Adminium 0.3.43.

## The kinds

| Kind | `accept` word | Stored as | Taken only when |
|---|---|---|---|
| A preview model | `glb` | `model/gltf-binary` | It is glTF 2 and as long as its header says. Its description (the JSON chunk) is at most 4 MB and is JSON. Every buffer and picture is inside the file: no `uri` anywhere, so a viewer fetches nothing from elsewhere. Pictures inside it are PNG or JPEG. Its extensions are `KHR_materials_*`, `KHR_texture_transform` or `KHR_mesh_quantization`; Draco, meshopt and Basis textures are refused, so the viewer needs no decoder of its own. |
| A print model | `stl` | `model/stl` | Its name ends in `.stl` (an STL has no signature), and it is one of the two forms: binary, when 84 + 50 × the triangle count at byte 80 is exactly its size, whatever its header says; otherwise text, read to its end by its grammar (`solid` … `endsolid`, each facet three vertices). |
| A print model | `3mf` | `model/3mf` | It is a zip whose package names its model part. It is read from the zip's own directory, never unzipped whole: at most 64 entries, each declared size and all of them together at most 200 MB, `[Content_Types].xml` and `_rels/.rels` present, the model part they name there. The model part is unpacked as a stream that stops the moment it passes what it declared. |
| A web font | `woff2` | `font/woff2` | It starts with `wOF2` and is as long as its header says. Browsers check a font's tables themselves before they draw it. |
| An SVG | `svg` | `image/svg+xml` | It is kept only as Adminium writes it again: see [Cleaned SVG](#cleaned-svg). |

A file that is not what its kind says is refused `415` with the reason, for example "This GLB
points at files outside it (a "uri"). Export it with everything embedded (one .glb file)." or "This
is not a 3MF: it has no package parts". A plain zip renamed `.3mf` is refused as no 3MF. A small
file declaring a huge entry is refused before anything is unpacked.

The workspace's `files.allowedTypes` takes these kinds by default. A workspace whose list was
changed before this release keeps its own list: add the kinds there to take them.

## Declaring them

Each asset lives in a column with a [file rule](/reference/manifest/#files-in-a-column) whose
`accept` names only these kinds. A `json` column holds a list, such as a book nook's pieces.

```json
{ "ref": "preview", "type": "text", "nullable": true, "rules": { "file": { "accept": ["glb"], "maxBytes": 26214400 } } },
{ "ref": "print", "type": "text", "nullable": true, "rules": { "file": { "accept": ["stl", "3mf"], "maxBytes": 26214400 } } },
{ "ref": "font", "type": "text", "nullable": true, "rules": { "file": { "accept": ["woff2"], "maxBytes": 2097152 } } },
{ "ref": "pieces", "type": "json", "nullable": true, "rules": { "file": { "accept": ["svg"], "maxBytes": 2097152, "maxCount": 12 } } }
```

A read-only entry of the guests' key names these columns in `assets`. Its filters say which rows
are published:

```json
{ "table": "products", "methods": ["GET"], "select": ["id", "name", "preview", "print", "font", "pieces"],
  "filters": [{ "column": "published", "op": "eq", "value": true }],
  "assets": ["preview", "print", "font", "pieces"] }
```

The validator refuses `assets` unless all of these hold:

| Field | Rule |
|---|---|
| `assets` | 1 to 8 columns of the entry's table, each named once. |
| The entry | Only reads rows: `methods` is `["GET"]`, and it is not an availability entry. |
| The entry | Is for every visitor: no `claim`, `claimedBy`, `visibleWith`, `unlockBy`, or a level read by a session alone. |
| `key` | The app's `customer` key. |
| Each column | Has a file rule whose `accept` names only `glb`, `stl`, `3mf`, `woff2` and `svg`. |
| Each column | In `select`, when the entry has one. |
| Each column | Not written by the entry, not in its `files` or its `pictures`. |
| Each column | Not kept from readers, and not personal data. |

See the [manifest reference](/reference/manifest/#assets).

## What a page loads

`/public/config` says where the key's assets are, and which columns of each entry are assets:

```json
{ "data": { "assets": "/api/v1/public/assets/pbk_01J9Z6Q4M2V8XK3T7B5N0R4WQE", "refs": { "nooks_products": { "assets": ["preview", "print", "font", "pieces"] } } } }
```

An asset's full address names the entry, the row, the column and the file:

```text
GET /api/v1/public/assets/{keyId}/{ref}/{rowId}/{column}/{fileId}
```

The file id is the one the row's column holds (for a list, one of them). The route answers a
browser's preflight, so a viewer's `fetch` and a cross-origin `@font-face` both work.
`@adminiumjs/public-client` turns a column's value into the addresses, in the value's order:

```ts
import { assetUrls } from '@adminiumjs/public-client';

const config = await client.config();
const { data: products } = await client.list('nooks_products');
for (const product of products) {
  const [model] = assetUrls(baseUrl, config, 'nooks_products', product.id, 'preview', product.preview);
  const pieces = assetUrls(baseUrl, config, 'nooks_products', product.id, 'pieces', product.pieces);
  // []: nothing Adminium keeps in that column, or the entry serves none there.
}
```

## When an asset is served

All of these hold at the time it is asked for, as for pictures:

- **The key** is live, is the app's customer key, and is not bound to a staff screen.
- **The entry** is one of the key's reads that shows this column as assets to every visitor.
- **The row** is read through the entry's own filters: an unpublished product is no row at all.
  Its column names this file.
- **The file** is live, on the key's own database, attached to this very row, a model, a font or an
  SVG by what its bytes were found to be, and within its kind's size.

Every refusal is the same `404` `PUBLIC_REF_NOT_FOUND`.

## Sizes

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

## Headers

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

## Cleaned SVG

An SVG is a document a browser runs. So Adminium keeps an SVG only as it writes it again from its
own reading of the file, for any column that takes `svg` (a customer's logo, a shop's pieces):

- **Read strictly, as XML.** A DOCTYPE, any entity but the five built-in ones, a processing
  instruction (the XML declaration at the very start aside), CDATA, and any namespace but SVG's and
  xlink's are refused. A file that is not well formed is refused, never repaired. An SVG saved by an
  editor with its own namespaces (Inkscape's, Illustrator's) is refused: save it as a plain SVG.
- **Kept from a short list.** Elements: `svg`, `g`, `defs`, `symbol`, `path`, `rect`, `circle`,
  `ellipse`, `line`, `polyline`, `polygon`, `linearGradient`, `radialGradient`, `stop`,
  `clipPath`, `mask`, `use`, `text`, `tspan`, `title`, `desc`. Attributes: geometry, paint, text and
  font ones. A link (`href`, `xlink:href`) only on `use` and gradients, and only to `#id`. A `style`
  attribute only with paint, text and font properties, and no `url(` but `url(#id)`.
- **What draws nothing goes.** A `<script>` and `<metadata>` with all they hold, event handlers
  (`onload`, `onclick`, …), `class`, `data-…`, `aria-…`, `role`, `version`, comments, and an
  editor's own style properties (`-inkscape-…`).
- **What could change the drawing is refused**, naming it, rather than quietly cut: a
  `<foreignObject>`, an `<image>`, a `<style>` element, a filter, a pattern, an animation, an
  embedded font, a link to anything outside the drawing, an attribute not on the list.

What is stored is the cleaned copy. Cleaning it again gives the same bytes, and a file column takes
an SVG only when that holds: an SVG uploaded through another door, never cleaned, is refused
`file-not-here` when a record names it. The staff file routes still never show an SVG inline; it
downloads.
