<!-- produced from apps/docs/src/content/docs/guides/apps/roles-and-staff-access.md § Edits limited to some columns; do not edit -->

# App roles and staff access: Edits limited to some columns

An app can limit what a role's edit permission on a table may change. A clinic's clinician may move
a visit along, from roomed to with the clinician to ready, and may not cancel it or change its time.

When a limited person saves a change outside the limit, Adminium refuses it with `403` and the code
`COLUMN_FORBIDDEN`, naming the column, and the value when the column may change but not to that
value. The limit covers:

- editing one record, and a column sent unchanged, as a form that sends the whole record does;
- editing many records at once;
- rows edited from another record's form, such as a patient's visits from the patient.

Roles add up. Someone who also holds a role that may edit the table without a limit, such as a
manager, an Admin or Super Admin, is not limited. A role an app copies from a limited role
(`cloneFrom`) is limited the same way.

The limit applies to edits only. Creating records is its own permission, and an app can limit it the
same way (`creatable`): a kitchen tablet may start an order with its name, pickup time and note, and
never choose its channel, its customer or its link. A new record given a column outside that limit
is refused with the same code and `reason: "create-limit"`, whether it is made on its own, added from
another record's form, or imported. Deleting is its own permission too. Undo
puts back what the same person changed a moment ago, and is not limited. Files attached beside a
record are not columns of it, so the limit does not cover them.

An update of the app replaces the role's limits with the ones the new version declares. Saving the
role under **People → Roles & permissions** keeps them; the screen does not show them. See
[`limits`](https://docs.adminium.dev/reference/manifest/#roles) in the manifest reference.
