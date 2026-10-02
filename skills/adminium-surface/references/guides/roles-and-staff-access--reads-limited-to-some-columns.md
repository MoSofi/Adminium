<!-- produced from apps/docs/src/content/docs/guides/apps/roles-and-staff-access.md § Reads limited to some columns; do not edit -->

# App roles and staff access: Reads limited to some columns

An app can also limit what a role **reads** of a table. A hotel's housekeeping sees a stay's room,
its dates and its status, so the rooms get turned round in time, and nothing of its guest or its
money. The table's key and its links to other rows are always shown: a screen moves through them.

Every staff read of the table holds to the limit: lists and records, links and lookups, search,
exports and imports, dashboard cards and their live updates, documents, the audit log, files kept
in a hidden column, and the page assistant. Asking for a hidden column by name (to show it, filter
by it or sort by it) is refused `403` `COLUMN_FORBIDDEN` with `details.reason: "read-limit"`. A
refusal of a write never repeats a hidden value, and a figure worked out from hidden columns (a
limit's counts, a stay's nightly lines) is refused rather than shown in part.

A hidden column is not written through the role either, on an edit or a create, unless the role's
edit limit names it. Roles add up here too: someone who also holds a role that reads the table
without a limit reads all of it, two limited roles read what either shows, and Super Admin is never
limited. A card or a live update follows a change to the role at once.

> **Caution: Upgrading**
> Moving back to a release that does not know read limits drops them: a role limited this way would
> read the whole table again. Keep backups of the meta store before an upgrade, and do not roll back
> an install whose app roles rely on read limits.
