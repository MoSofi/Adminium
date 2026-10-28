<!-- produced from apps/docs/src/content/docs/reference/manifest.md § People; do not edit -->

# Manifest spec: People

`people` says which of the app's tables hold people (or companies), and where. E-mail to contacts
reads it for an audience, a person's data (find, export, erase) for where a person is, and the
consent log for the column it keeps in step. One entry per table, up to eight:

```json
"people": [
  { "table": "contacts", "kind": "people", "email": "email", "name": "name",
    "company": "company_id", "language": "language", "firstName": "firstWordOfName",
    "consent": { "column": "may_email", "purpose": "newsletter" },
    "customer": "won_deals", "optOutMark": "opt_out_offered_at",
    "copies": [
      { "table": "quotes", "column": "sent_to_email", "holds": "email", "via": "sent_to_contact_id" },
      { "table": "sign_offs", "column": "signer_name", "holds": "name" }
    ] },
  { "table": "companies", "kind": "companies", "name": "name" }
]
```

| Field | Required | Rule |
|---|---|---|
| `table` | yes | One of the app's tables, declared once. |
| `kind` | yes | `people`, or `companies`. |
| `email` | for `people` | A `text` column: the address. When the outbox's `recipient.table` is this table, it is `recipient.email`; when a [public entry](https://docs.adminium.dev/reference/manifest/#public-access) on this table claims by an emailed code or link, it is that claim's `email`. |
| `name` | no | A `text` column that names the person. Default: the table's `keyField`; a table with neither is refused, and so is a name that is the address column. A name kept in parts (`first_name`, `last_name`) is named by a [formula](https://docs.adminium.dev/reference/manifest/#formulas) column that joins them. |
| `company` | no | A link (`fk`) to the company the person works for. It may not point at a table declared as `people`. |
| `language` | no | A `text` column of the table with the language the person is written to in. An app that keeps the language only on an order adds one, filled when the person is made (`identity.fill`); rows without one read the install's language. |
| `firstName` | no | `{ "column" }`, a `text` column, or `"firstWordOfName"`: what a mail's `{{first_name}}` reads. |
| `consent` | no | `{ "column", "purpose" }`: a `bool` column that mirrors one purpose of the consent log, `newsletter` or `surveys`. With none, the consent log alone holds consent. The two stay in step: a save that changes the column adds a row to the log in the same write (a staff member's tick in their name, a file brought in as an import, a rule or an API key as the system), and a change that starts in the log (an unsubscribe, "Record consent", a [public tick](https://docs.adminium.dev/reference/manifest/#a-consent-tick)) writes the column and its stamps without a save, so no rule runs on it. "Delete my details" that empties the column first records the person's withdrawal. |
| `copies` | no | Up to 32 columns on **other** tables that hold a copy of the person's address, name or phone number: `{ "table", "column", "holds": "email" \| "name" \| "phone", "via"? }`. `column` is `text`; `via`, when there is one, is that table's link (`fk`) back to this table. A copy is found and exported with the person and blanked when they are erased, except on a table [kept by law](https://docs.adminium.dev/reference/manifest/#kept-by-law). A row is the person's when one of their copies on it links to them, holds their address, or holds one of their phone numbers (the phone columns of their own rows, a leading 0 or a country code aside); then every copy of theirs on it with no link goes too, and, when no copy links to somebody else, every column of the row marked `personal`. Needs Adminium 0.3.39 for a phone copy with no link, and for the personal columns. |
| `customer` | no | A `bool` or number column that says the person is a customer (a count of won deals): "existing customers" counts them. |
| `optOutMark` | no | A `timestamptz` column that is a strict [stamp](https://docs.adminium.dev/reference/manifest/#stamps) (`"strict": true`). Declaring it says the app's staff screens show the line "you can say no to our mail" where they take the address. Only a signed-in staff member's save on such a screen sets it (or a carry, below); never a public page, an import, a rule, an add-on, an API key or sample data. Only marked rows may be mailed as existing customers. The screen says it showed the line with `"optOut": { "shown": true }` beside the row's values (the [data API](https://docs.adminium.dev/reference/rest-api/)'s create or change): the mark is set to now on a create, or on a change of the address, when the row has an address. The stamp's own `on` is never fired; write `{ "set": "now", "on": { "columns": ["email"] }, "strict": true }`. `{ "column", "carryFrom": { "table", "column" } }` also names the mark of the row a person is made from (a claimed enquiry's, itself a strict stamp on another table): the save that makes them sends `"optOut": { "from": "<that row's key>" }`, and the mark comes with them when that row's address is theirs. |
| `carry` | no | Up to 4 things an app update carries over once: `{ "stopList": { "column" } }` puts the address of every row whose column holds a value on the do-not-email list (an old "unsubscribed" mark); `{ "consent": { "from", "via", "column", "latest" } }` writes each person's newest answer on a linked table (`via` links it to this table, `column` is its `bool`, `latest` a date, moment or number that orders the answers) into the `consent` column, as a yes with no record that the first send's review asks about (an answer with no `latest`, an order never confirmed, is none; a person the consent log already holds an answer from keeps it; a person with no address is left alone). It runs on the update that brings it. A carried column is declared in the same manifest: keep it one more release, and drop it in the next. A second update adds nothing. |

`consent`, `customer`, `optOutMark` and `carry` are read to mail the table's people, so an entry
with no `email` names none of them. The `consent` column is not the outbox's `recipient.optIn`:
that is a switch for service mail (a reminder), and the two may differ. A [part](https://docs.adminium.dev/reference/manifest/#parts) left out takes its tables' entries and the copies
kept on them with it. Needs Adminium 0.3.38.

The owner can switch campaigns off for a table, or name another column for the address or the
name, on the table's e-mail sheet. That is the owner's word and stays theirs across updates.
