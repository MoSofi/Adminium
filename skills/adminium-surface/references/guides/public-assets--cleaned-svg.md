<!-- produced from apps/docs/src/content/docs/guides/apps/public-assets.md § Cleaned SVG; do not edit -->

# Models, fonts and SVG pieces on public pages: Cleaned SVG

An SVG is a document a browser runs. So Adminium keeps an SVG only as it writes it again from its
own reading of the file, for any column that takes `svg` (a customer's logo, a shop's pieces):

- **Read strictly, as XML.** A DOCTYPE, any entity but the five built-in ones, a processing
  instruction (the XML declaration at the very start aside), CDATA, and any namespace but SVG's and
  xlink's are refused. A file that is not well formed is refused, never repaired. A drawing saved
  as "Inkscape SVG" is taken: Inkscape's own notes (its `inkscape:` and `sodipodi:` parts, such as
  the page view and the layers' names) draw nothing and are dropped. Another editor's namespaces
  (Illustrator's) are refused: save the drawing as a plain SVG.
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

A customer's SVG logo uploaded through a public entry (`POST /api/v1/public/uploads`) is cleaned
the same way as it is taken, and one that is refused is answered `PUBLIC_UPLOAD_REFUSED` with
`reason: "kind"` and a message saying what it holds. It stays private: the customer reads it back
only as a download, and a column customers upload into is never served as an asset.
