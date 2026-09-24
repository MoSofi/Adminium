---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
'@adminium/ui': patch
'@adminium/i18n': patch
---

**An app's own roles can see personal data where their work needs it, and an edit can be limited to some columns.**

Personal columns (a patient's mobile, email, address, an allergy note) used to be shown in clear
only to people who manage database connections, so an app's staff roles read them as empty and a
clinic's reception could not ring anyone. A new table permission, `read_pii`, shows one table's
personal columns: an app grants it as `table:@patients:read_pii`, and **People → Roles &
permissions** has a **See personal data in records** row that grants it on every table. The table
asked about is the one the value lives in, so a lookup from appointments to a patient's mobile
needs it on patients. It applies to lists, single records, lookups, measures, dashboard cards,
record pages and exports. A `*` action never includes it, so no existing role gains it. Live
updates stay masked for everyone, and the public API is unchanged.

An app role can limit what its edit permission on a table may change: `limits` on the role, per
table, with `writable` columns and `writableValues`, the names public access uses. A clinician
may move a visit from roomed to ready and nothing else; anything outside the limit is refused
`403` `COLUMN_FORBIDDEN`, naming the column and the value. It covers editing one record, many at
once, and rows edited from another record's form. Someone who also holds a role with an
unlimited edit on the table, an Admin or Super Admin, is not limited. Saving the role in the
permissions matrix keeps its limits, and an app update writes the new version's.
