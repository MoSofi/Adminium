<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Add-on manifests — Shapes; do not edit -->

# Manifest spec: Add-on manifests — Shapes

### Shapes

A shape is what an app's tables are [built on](https://docs.adminium.dev/reference/manifest/#tables-built-on-an-add-ons-shape): named parts, each
with its columns, rules and states, the document profiles made for an app's tables, and the
messages an app built on it sends.

| Field | Required | Rule |
|---|---|---|
| `name` | yes | kebab-case. An app names the shape `<add-on key>/<name>@<version>`. |
| `version` | yes | 1–99. A change an app's tables cannot follow is a new version. |
| `parts` | yes | At least one, keyed by a snake_case part name: `{ "columns", "states"? }`, with 1–60 [columns](https://docs.adminium.dev/reference/manifest/#columns) and optional [states](https://docs.adminium.dev/reference/manifest/#states). |
| `documentProfiles` | no | Up to 8 [documents](https://docs.adminium.dev/reference/manifest/#documents), each naming the `part` it is drawn for instead of a `table`, with no `addOn` and no `feature`. |
| `outbox` | no | `{ "producers", "templates"? }`: 1–16 [producers](https://docs.adminium.dev/reference/manifest/#outbox), whose tables are the shape's parts, and up to 16 templates, each an [email template](https://docs.adminium.dev/reference/manifest/#emailtemplates) with a `kind` (the producer's) instead of a `key`. |

A part is checked the way an app's tables are, with the parts of all the add-on's shapes as the
tables. A column's `references` names another part of the same shape (`"document"`), or a part of
another of the add-on's shapes (`"quote@1/document"`). A rule in a part that reads a setting reads
one of the add-on's own (`{ "addOn": "<its key>", "setting" }`), since the add-on cannot know an
app's settings row.

A part may also carry the rules an app's table gets: `postings`, `adjust` and `indexes`. A shape
with such a part is not built as new tables: an app adds it to tables it already has, under its own
names, and writes no `builtOn`. A part of such a shape may say what its rows are to a price rule
that prices the same table, with `inAdjust`: `{ "excludes": "<column>" }` (a row that fills the
column takes no reduction, as a gift-card load) or `{ "paidBy": "<column>" }` (a row that fills it
is something sold that pays later, as a voucher). The column is one of the part's. The app's price
rule then names it on its line (`excludes`, `paidBy`); a tool that adds the shape writes it there.
