<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Documents; do not edit -->

# Manifest spec: Documents

When a table is [built on an add-on's shape](https://docs.adminium.dev/reference/manifest/#tables-built-on-an-add-ons-shape), the shape's own
profiles are made for it at install. An app entry of the same kind on that table does not make a
second profile: its slots are added to the shape's mapping (the app's slot wins on the same name,
so an invoice can print the client's address from the app's own `clients` table), and its `name`
replaces the shape's.

The app's staff screens ask for a document by the app's own names:
`POST /api/v1/apps/<key>/documents/render` with `{ "kind", "ref", "pk", "period"?, "locale"?, "values"? }`,
where `ref` is the table's short ref and `pk` the row's key. `values` fills the slots the entry
lists in `requestValues`, by slot id, typed by the add-on's outline (`{ "count": 12 }`); a value for
any other slot, for one a value typed into the profile fills, or one its type cannot hold is `400`
`DOCUMENT_VALUE_REFUSED`, naming the slot, and nothing is drawn. A document drawn with values
lists the slots they filled under `requestValues` in its subject, is never emailed on its own
(`pending-review`, as a stranger's is), and a later draw of the same row takes nothing from it. The document is drawn now, or the one
already drawn is handed back while the row is unchanged, with `contentUrl` for its bytes and
`printUrl` for a copy to print. The caller must be signed in and able to read every table the
document reads, a statement's sources included. An app, kind, row or table they cannot reach is
the one `404`; an add-on that is detached, or a feature switched off, is `409` `FEATURE_OFF`; a
document that cannot be drawn (a required slot left empty) is `422` `DOCUMENT_NOT_DRAWN`.
