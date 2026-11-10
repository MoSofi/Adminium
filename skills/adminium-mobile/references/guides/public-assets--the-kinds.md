<!-- produced from apps/docs/src/content/docs/guides/apps/public-assets.md § The kinds; do not edit -->

# Models, fonts and SVG pieces on public pages: The kinds

| Kind | `accept` word | Stored as | Taken only when |
|---|---|---|---|
| A preview model | `glb` | `model/gltf-binary` | It is glTF 2 and as long as its header says. Its description (the JSON chunk) is at most 4 MB and is JSON. Every buffer and picture is inside the file: no `uri` anywhere, so a viewer fetches nothing from elsewhere. Pictures inside it are PNG or JPEG. Its extensions are `KHR_materials_*`, `KHR_texture_transform` or `KHR_mesh_quantization`; Draco, meshopt and Basis textures are refused, so the viewer needs no decoder of its own. |
| A print model | `stl` | `model/stl` | Its name ends in `.stl` (an STL has no signature), and it is one of the two forms: binary, when 84 + 50 × the triangle count at byte 80 is exactly its size, whatever its header says; otherwise text, read to its end by its grammar (`solid` … `endsolid`, each facet three vertices). |
| A print model | `3mf` | `model/3mf` | It is a zip whose package names its model part. It is read from the zip's own directory, never unzipped whole: at most 64 entries, each declared size and all of them together at most 200 MB, `[Content_Types].xml` and `_rels/.rels` present, the model part they name there. The model part is unpacked as a stream that stops the moment it passes what it declared. |
| A web font | `woff2` | `font/woff2` | It starts with `wOF2` and is as long as its header says. Browsers check a font's tables themselves before they draw it. |
| An SVG | `svg` | `image/svg+xml` | It is kept only as Adminium writes it again: see [Cleaned SVG](https://docs.adminium.dev/guides/apps/public-assets/#cleaned-svg). |

A file that is not what its kind says is refused `415` with the reason, for example "This GLB
points at files outside it (a "uri"). Export it with everything embedded (one .glb file)." or "This
is not a 3MF: it has no package parts". A plain zip renamed `.3mf` is refused as no 3MF. A small
file declaring a huge entry is refused before anything is unpacked.

The server's `files.allowedTypes` takes these kinds by default. A server whose list was
changed before this release keeps its own list: add the kinds there to take them.
