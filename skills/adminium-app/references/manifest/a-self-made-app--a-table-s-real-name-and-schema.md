<!-- produced from apps/docs/src/content/docs/reference/manifest.md § A self-made app — A table's real name and schema; do not edit -->

# Manifest spec: A self-made app — A table's real name and schema

### A table's real name and schema

A table's `ref` is the app's short name for it. A self-made app may give the table's real `name`
(`Order Lines`) beside it, and on Postgres its `schema` (`sales`). The install, the plan, every live
read and the uninstall then use that real table.

- A table that gives `name` or `schema` is never prefixed: a manifest with `"prefixed": true` gives
  neither.
- A name or schema is 1–63 bytes, has no dot, no NUL, no space at either end and no ` as ` between
  words, and does not start with `adminium_`.
- `schema` is for Postgres only. `information_schema` and every `pg_` schema are refused, and so is
  the schema of Adminium's own store (`TABLE_NAME_REFUSED`).
- Two tables whose real names differ only by upper and lower case are refused: MySQL and SQLite
  take them for one.
