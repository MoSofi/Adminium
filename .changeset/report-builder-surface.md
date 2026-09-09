---
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/i18n': patch
'@adminium/dashboard': patch
---

The Report builder ships at `/report-builder` (43-report-builder.md): a
two-collection manager plus a block editor, over a new envelope — a report is a
header (kicker · title · subtitle) plus an ORDERED ARRAY of self-contained
blocks, each with its own title, width and visibility, drawn from a palette of
25 kinds. Migration 0030 adds `adminium_report_documents` (prefix `rpt`): one
table, two kinds (template | report), the comp's three-value status
(draft | sent | live), a starter key, a soft `origin_id`, the manager's
`position` and a denormalised `summary`.

Not Scheduled Reports. That surface keeps `/reports`, its `reports.*` keys, the
`rep` prefix and `system:reports:manage`; this one is `/report-builder`, the
`reportBuilder` namespace, `adminium_report_documents` and
`/api/v1/report-documents`, and its writes ride `system:settings:manage` like
the other two document surfaces. No permission key is added.

Server: nine routes in the invoice surface's shape — list with unfiltered tab
counts, the twelve starters, detail, create (blank or from a starter), the
explicit `PUT` save that re-derives the summary, inline rename, duplicate,
delete, and `POST /:id/from-template`, which copies a template's body into a
new report and records its origin. The envelope decodes leniently and holds
both inline-image slots to the existing caps; a block of an unknown kind
becomes a labelled placeholder rather than a card nobody can explain.

Dashboard: the manager (Templates/Reports trays with counts that ignore the
search box, client-side search over name · title · kicker, gallery and list
layouts remembered per browser, four empty states, inline rename, duplicate
with Undo, delete behind a confirm, the New modal with twelve starters and
*Your templates* for reports) and the editor (the 25-kind palette, the always-
light sheet with its background image and tint, the block stack with drag and a
keyboard reorder, half-width blocks, the *Show in export* flag, an inspector
whose 25 field groups each carry Width · Show · Delete, explicit save with
`Ctrl/⌘+S`, sixty steps of undo and a discard guard). A template's primary
saves; a report's *Publish* saves and marks the row Published. Below `lg` the
inspector becomes a drawer and the palette an *Add block* sheet.

Two gaps in the design are filled with its own patterns: the image block gains
the background's Upload / Replace / Remove row, and a KPI metric gains the
*Delta* field that makes its rendered delta reachable. Two of the design's own
defects are corrected: the block label/glyph pair is a record with named fields
(the pair ships swapped for four kinds), and a card's glyph rides its row
rather than a title match, so renaming a report never changes its icon.

Every string of the surface, the twelve starters and the seeded block content
are in all eight languages, in a deferred `reportBuilder` namespace loaded by
its two routes — the strings never ship in a user's entry chunk.
