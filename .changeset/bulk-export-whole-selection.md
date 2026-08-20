---
'@adminium/widgets': patch
'@adminium/i18n': patch
---

Stop bulk export silently dropping every row selected on an earlier page.

`page-crud`'s selection survives paging, and the browser-side export — which is
the path every user takes, because no host implements the optional
`CrudApi.export` — filtered the CURRENTLY LOADED page by the selected ids.
Select on page one, page forward, select again, export: page one's rows were
gone from the file, with nothing on screen to say so. The toolbar still counted
them.

The template now snapshots the selected rows as pages arrive (a row has to be on
screen to be selected, so the snapshot can only be complete) and exports from
that, in selection order. Deselecting drops a row from the snapshot; deleting a
row drops it from the SELECTION too, on the single-row path as well as the bulk
one — a deleted row must not keep being counted, and must not turn up in a file.

One new string, `templates.crud.toast.exportIncomplete`, covers the case the
design makes unreachable: if the snapshot were ever short, the export says how
many rows it wrote. The point of the fix is that a short export can no longer be
a silent one.

The queued server-side run is deliberately still not wired: `ExportSource` on the
wire carries `{kind, table, viewId, filters}` and no row selection at all, so
implementing `export` against it as it stands would widen a selection export to
the whole table — trading a silent drop for a silent over-export.
