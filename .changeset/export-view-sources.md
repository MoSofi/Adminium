---
'@adminium/server': patch
---

Make `source.kind = "view"` exports work, and stop advertising a kind no payload can express.

`exportSourceSchema` accepts three kinds — `table`, `view`, `page` — and the
OpenAPI document offers all three to clients. Only `table` ever worked. The
route answered the other two with "Only `source.kind = "table"` exports are
supported", and `export-run` carried a second copy of the same refusal that
would throw on any row that reached it another way.

**`view` is now real.** A saved view names no table of its own: it names the PAGE
it was saved on, and the page carries the binding. So the route resolves view →
page → `config.source.table`, checks the per-table export grant on the RESOLVED
table exactly as a direct table export does, and stores the resolved table on the
row. `export-run` then keys off that resolved table instead of the kind — which
is what stopped it throwing on a row the route had already accepted and
authorized. A saved view is a shortcut through the same door, never a way around
it: an unauthorized caller still gets `TABLE_FORBIDDEN`, and someone else's
private view is reported absent rather than forbidden, because whether it exists
is the owner's business.

**A view with a search term is refused, not silently widened.** An export source
has nowhere to carry a search, so exporting such a view would hand back MORE rows
than the view displays under the view's own name — the same silent-over-export
failure the queued path is deliberately unwired to avoid. Sort is dropped
silently by contrast: ordering changes how the same rows are arranged, not which
rows they are.

**`page` is refused with the actual reason.** An export source carries `table`,
`viewId` and `filters` and no field that identifies a page, so the kind cannot be
satisfied by any payload. It still answers 422, but now says why and points at
the two kinds that work. Removing it from the vocabulary is a schema change and
therefore an OpenAPI regeneration, which is left for a commit that can regenerate
the document cleanly.
