<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Validation; do not edit -->

# Manifest spec: Validation

Adminium validates a manifest when a package is uploaded or downloaded from the catalogue, and
refuses an invalid one before anything is written. The refusal lists every problem,
each with the path of the field (`requiredSchema.tables.0.columns.2.default`) and a message. The
checks are:

- **The schema.** Every field on this page, its type and its limits. Every object is strict, so a
  misspelled or unknown field is an error.
- **Cross-references.** Every name the manifest uses must be declared in it, and be of the right
  type: a rule's columns, a formula's inputs, a setting a rule reads, a capacity's or a booking's
  tables and columns, a table's states and the child tables tied to them, a public entry's table
  and columns, a public key's role, the outbox's columns and templates, a document's columns, an
  add-on a shape or a document needs, a page's feature, an option list, a foreign key's target. A `PATCH` without a claim, a writable column that Adminium decides, and an
  `availability` entry on a table with neither `capacity` nor `booking` are refused, along with
  every rule stated in the sections above.
- **Policy.** The publisher must be `adminium`, or `local` for an app installed from a file, and the key must not be reserved.
- **The version floor.** An app or add-on whose `minAdminiumVersion` is newer than the server is
  refused with a message naming both versions, including when an older server cannot parse a
  newer manifest.
- **The install plan**, against the operator's database: name lengths for that database (63 bytes
  on Postgres and SQLite, 64 on MySQL, including foreign key names `fk_<table>_<column>`), role
  names, page forms, email template blocks, public endpoints, and tables that are taken.

There is no published JSON Schema file for manifests. The schema itself is published as the
`@adminiumjs/manifest` npm package. Its `validateManifest(document)` runs the schema,
cross-reference and policy checks and returns every issue, so an app's own CI can refuse a bad
manifest before it is released.

Beside `issues`, `validateManifest` returns `warnings`: advice that never refuses a manifest. A
manifest with warnings validates. Today there are four:

- a column that is neither nullable nor given a `default`, a role or a rule that fills it will be
  `NOT NULL` once installed, so every new row must give it a value, and a draft saved half-filled
  is refused;
- a `text` column in a [unique set](https://docs.adminium.dev/reference/manifest/#columns-unique-together) with no `normalize` (and no `code`
  rule): MySQL compares text ignoring case and accents, Postgres and SQLite do not, so give it
  `normalize: "email"` or `"trim"`;
- a [setting](https://docs.adminium.dev/reference/manifest/#settings) whose key reads like bank details and is not `secret`: a setting that is
  not secret is published to the customer side;
- a capped balance whose `of` is a formula reading a column that stays writable while the capped
  rows can exist: a bulk edit or an import settles the balance without the cap (see [Totals that
  count and climb](https://docs.adminium.dev/reference/manifest/#totals-that-count-and-climb)).

Keep warnings apart from issues in your CI, so that new advice never fails a build.

```json
{ "ok": true, "manifest": { … }, "warnings": [
  { "path": "requiredSchema.tables.2.columns.4",
    "message": "\"invoices.client_id\" has no default and is not nullable, so it will be required at install: every new row must give it a value" } ] }
```
