<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

- **When it is judged.** On a new row that names a row, and on a change that moves the link to
  another row. A change that leaves the link as the row holds it, or sends it back as it stands (as
  the record form sends every field), is no move: a line naming a price retired since keeps it while
  its quantity changes. An empty link names nothing, and is taken.
- **Who it holds.** Everybody, an admin and the owner too: it is the data's own rule, not a
  permission. It holds on every door a row is written through: a form, a bulk edit, a record's
  action, an automation, the public API, an import (a new line, and a matched line that moves the
  link) and sample data. An undo puts a row back as it was. A row a rule or an
  [effect](https://docs.adminium.dev/reference/manifest/#effects) moves keeps the link it holds.
- **The refusal.** `422` `VALIDATION_FAILED`, the field's code `not-allowed` (the code a value
  outside `options` gets), naming nothing of the row the link named. Through the public API it is
  `PUBLIC_WRITE_REFUSED` with no column. A key that names no row at all is the foreign key's to
  refuse, as it always was; and somebody who does not [reach](https://docs.adminium.dev/reference/manifest/#whose-a-row-is) the named row is
  refused as for a row that is not there, before this rule is asked, so the rule never tells them
  whether a row out of their reach meets it.
- **Read as it stands.** The named row is read when the write is judged. A line retired at the same
  moment as a quote names it may still be named, as if the quote had come first.
- **A rule that can no longer be read.** When the link's relation is gone, or a column a condition
  reads is no longer on the table, no row can be shown to meet the rule: every new link is refused,
  and rows that already hold one keep it. Put the column back, or change the rule in Studio.

##### A row that must match the row written

`same` compares the named row with the row being written instead of with a fixed value: a site
visit names only a contact who works for the company of the visit's deal.

```json
{ "ref": "contact_id", "type": "fk", "references": "contacts", "nullable": true,
  "rules": { "linkable": { "same": [{ "column": "company_id", "as": "deal_id.company_id" }] } } }
```

`same` is 1–4 pairs. `column` is a column of the row the link names (here a contact's
`company_id`); `as` is a column of the row being written, or one link further, `<link
column>.<column>`: the column of the row a foreign key of it names (here the visit's deal's
`company_id`). Each pair must hold: both sides hold the same value. An empty side holds nothing,
so a deal with no company yet matches no contact; an empty link is still taken. `where` and
`same` may be given together, and a rule gives at least one of them. Needs Adminium 0.3.28
(`linkable.same`).

- **When it is judged.** As `where` is, and also when a change moves the column `as` reads on the
  row (a visit moved to another deal), the contact staying: the visit would no longer be the
  deal's company's. The far row is read as it stands when the write is judged: a deal moved to
  another company, or a contact who changes company, keeps the visits that name them.
- **What the refusal says.** The same `422` `not-allowed` on the link's field, naming nothing of
  either row. The far row of `as` is read through the write's own handle; a writer who names a
  deal out of their reach is refused for that deal before this rule is asked, whichever contact
  the visit names.
- The validator refuses a column the linked table does not have, a secret on either side, a hop
  through a column that is not a foreign key, the link compared with itself, and two columns that
  can never hold one value (a number and a text). Studio checks that each column and link is
  there.

An operator may set the same rule on a column in Studio; Studio refuses one whose column is not a
foreign key, or whose conditions name a column the linked table does not have. The screens are
still the app's to filter: a picker that offers only active lines is kinder than a refusal.

#### Who may change a column

`changes` holds a column's changes to 1–8 guards. A quote's approval becomes approved or refused
only from asked, and never by the person who asked for it nor by the deal's owner; an enquiry's
deal is set only while the enquiry is claimed, and only by the person who claimed it:

```json
{ "ref": "approval", "type": "enum", "enum": ["none", "asked", "approved", "refused"],
  "rules": { "changes": [
    { "to": ["approved", "refused"], "from": ["asked"], "notBy": ["asked_by_id", "deal_id.owner_id"] } ] } }

{ "ref": "deal_id", "type": "fk", "references": "deals", "nullable": true,
  "rules": { "changes": [
    { "while": { "column": "state", "in": ["claimed"] }, "by": "claimed_by_id" } ] } }
```

| Key | What it says |
|---|---|
| `to` | 1–32 values of the column: the guard holds a change to one of them. Without it, every change of the column (a new row's value is a change from nothing). |
| `from` | 1–32 values the row holds before the change. A new row holds none, so it is never made with a value the guard holds. |
| `while` | `{ "column", "in" }` or `{ "column", "isNull" }`: another column of the row holds one of the values (or is empty, or not), before the change and as the change leaves it. Never a secret. |
| `by` | The only person who makes the change: the one a staff column of the row names (`claimed_by_id`), or `<link>.<staff column>`, the staff column of the row one of its foreign keys names (`deal_id.owner_id`), as the row stands before the change (a new row: as made). |
| `notBy` | 1–4 people who never make the change, named as `by` names one, before the change and as it leaves the row: naming somebody else in the same write changes nothing. |

A guard says at least one of `from`, `while`, `by` and `notBy`, and every guard that holds a change
must be met. A value sent back as the row holds it is no change and is not judged.
