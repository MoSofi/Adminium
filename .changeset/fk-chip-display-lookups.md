---
'@adminium/widgets': patch
'@adminium/engine': patch
'@adminium/dashboard': patch
---

FK chips in generated grids now show the referenced record's display value
("Drift & Fern") instead of the raw foreign-key id ("5"), wired through the
existing `lookup=` machinery — no new server surface.

The grid spec's `fk` block always defined `displayKey` (a row key carrying a
pre-joined display value) but nothing ever populated it, so `FkChipCell` fell
back to the raw id on every generated page and owners added a separate linked
column just to see who a row points to. The missing fact was the referenced
table's display column, which only the generator knows:

- The crud composer stamps a new optional `fk.display` — the referenced
  table's classified display column — into each FK column spec, from a
  `displayColumns` map (`crudDisplayColumns`) built over the included
  candidate model. Stamping is pre-checked at generation time: skipped when
  the referenced display column is secret (the server hard-422s lookups on
  secret identifiers), when it IS the referenced column, and when the derived
  alias would shadow a real source-table column or break the server's alias
  grammar.
- The dashboard interpreter (`withFkDisplay`) turns each `fk.display` into a
  `lookup=<name>__display:<name>.<display>` read param and stamps
  `fk.displayKey` so the chip picks the joined value up — on list pages,
  record pages, and record-page related tabs. Explicit lookup columns keep
  absolute priority inside the server's MAX_LOOKUPS=12 budget; derived params
  only spend what is left and drop deterministically (with a console note)
  beyond it. A column already covered by an explicit single-hop lookup of the
  same display value reuses that alias instead of spending budget on a twin.
- Masking degrades honestly: a PII display column the caller may not read
  arrives as `null` + `_masked`, and the chip falls back to the raw id —
  never a blank chip.

The field is optional and regeneration-composed: stored pages predate it and
keep today's raw-id fallback untouched until their next regeneration (whose
`generatedHash` move rewrites untouched generated pages in place — that hash
move is the delivery mechanism, and the northwind baseline was re-recorded in
this change to pin it). Columns re-added through the Studio column manager
stay unstamped until regeneration — the schema reply does not carry the
referenced table's display-column pick.
