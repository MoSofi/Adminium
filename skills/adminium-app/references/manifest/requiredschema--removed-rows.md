<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Removed rows; do not edit -->

# Manifest spec: requiredSchema — Removed rows

### Removed rows

`removal`, on a table, says what a removal of one of its rows takes and keeps:

```json
{ "ref": "deal_members", "columns": [ … ], "removal": { "reason": "required", "history": true } }
```

- **`reason`**: every door a person removes a row through takes a reason: the delete route
  (`DELETE /api/v1/data/{connection}/{table}/{record}` with the body `{ "reason": "…" }`), a bulk
  delete (`POST …/{table}/bulk` with `"reason"`, one for the batch) and the add-on kit's
  `useWrite(table).remove(key, { reason })`. It is trimmed, at most 500 characters, and written
  into the removal's audit entry (`changes.reason`). `true` asks for one; `"required"` refuses a
  removal without one (`422`, `fields.reason.code` `required`). Every other removal (an undo, a row
  taken off under its parent's save, a rule's or a move's delete, a public entry's) is written with
  `"reason": null`, no reason. A table without `reason` refuses one (`not-allowed`): nothing would
  keep it. The reason travels in the body, never in the address, which logs keep. The console's
  delete dialogs, for one row and for the rows ticked in a list, ask "Why is it removed?" on such
  a table (marked optional where it is `true`) and hold the Delete button until something is
  written where it is `"required"`. The page assistant is told which tables ask: a delete it
  proposes carries the person's reason, shown on the card before it is confirmed, and one without
  a reason on a `"required"` table is refused at the check.
- **`history: true`**: a removed row stays readable, through a row it linked to that the reader
  reads now (a deal's removed member, a job's cancelled visit), until an undo brings it back.
  Every removal keeps it, by whichever door: who removed it, when, why, and the row as it was,
  masked as the audit log keeps it (no personal data, no code). Never on a [private](https://docs.adminium.dev/reference/manifest/#whose-a-row-is)
  table, and only on a table with a link (`fk`) to the row it is read through.

The removed rows are read by two routes:

```http
GET /api/v1/data/{connection}/{table}/{record}/removed/{childTable}
GET /api/v1/data/{connection}/{table}/{record}/removed/{childTable}/{childRecord}/history
```

The first lists the rows of `childTable` that linked to the record and were removed, newest first,
paged by `cursor` like a row's history: each with its `key`, `removedAt`, who removed it
(`actorKind`, `actorLabel`), its `reason` (`null` for none), the link column that named the record
(`via`) and the row as it was. The second is one of those rows' own history, as a live row's
history route answers it. Both answer `404` for a record the reader does not read now (as for a
record that is not there), and for a child table that keeps no removed rows (`This table keeps no
removed rows.`) or does not link to the record; `403` where the reader's role may not read the
child table. A removed row is shown only to a reader whose read of the child table would reach it:
their row limit there is judged on the row as it was, and the columns their role does not read
are left out, as a live read leaves them out. A table that never says `history` keeps nothing: a
rep cannot read a contact the admin removed, through anything.
