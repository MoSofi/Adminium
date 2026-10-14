<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

`where` is 1–8 conditions on the row the link names, in the shape a move's
[`linked`](https://docs.adminium.dev/reference/manifest/#conditions-a-move-waits-for) takes: `{ "column", <one test> }`, the test `eq` or `in`
(values that fit the column), `isNull`, or `gt`, `gte`, `lt` or `lte` on a number column. Every
condition must hold. The rule's column is a foreign key, and each condition names a column of the
table it points at that is not a `secret`.

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

#### Totals and balances

A rollup can also filter its child rows, keep a balance beside the total, and refuse a change
that would take the balance below zero: what a visit's fee, its payments and its write-offs need.

| Field | Rule |
|---|---|
| `where` | `{ "column", "eq" }`: only child rows whose column equals the value are added up (`voided` is `false`). The value must fit the column, and the column must not be nullable: a row left empty would drop out of the total unseen. |
| `balance` | `{ "column", "of", "minus"? }`: a second column of this row, kept as `of − minus… − total` (`balance = fee − waived − paid`). `minus` lists up to 4 columns. Every column named is a number column of this table, and the balance is a column of its own, with no rules of its own. |
| `cap` | `true`: a child write that would take the balance below zero is refused. It needs a `balance` on the same rollup, or a balance elsewhere on the row whose `minus` lists this total (a write-off is capped by the balance it lowers). |
| `capUnless` | `{ "column" }`, with `cap`: a yes/no column of the same row that lifts the cap while it is on (a stock level a shop sells from whether or not the count is right). The column is never empty. A balance guarded by two capped totals is lifted only when both name the same column. |
| `latest` | `{ "of", "by", "row"? }`, in place of `sum` and `count`: the column holds the value of `of` in the newest child row, the one whose `by` (a date, a time or a number) is the greatest (a deal's amount is the total of its last sent quote: `{ "from": "quotes", "via": "deal_id", "latest": { "of": "total", "by": "sent_at", "row": "quote_id" } }`). A row whose `by` is empty is left out; of two rows with the same `by`, the one with the greater key is taken; `where` and `unlessSet` leave rows out as they do of a total. The column is nullable (it is empty while no row qualifies) and of the type of `of`. `row` names a nullable column of this table that Adminium fills with the key of the row it took: a plain column of the key's type, not a link (a link would stop that row being deleted), with no rules of its own. No `times`, `balance` or `cap`. Kept in the statement that writes the child row, like a total, and it climbs like one: a line added to the quote that counts moves the deal. Needs Adminium 0.3.28. |

```json
{ "ref": "paid", "type": "money", "default": 0,
  "rules": { "rollup": { "from": "payments", "via": "visit_id", "sum": "amount",
                         "where": { "column": "voided", "eq": false },
                         "balance": { "column": "balance", "of": "fee", "minus": ["waived"] },
                         "cap": true } } }
```

`of` may be another total of the row, so money given back is capped by money taken: two totals
over the same payments, `taken` (`where` `kind` `taken`) and `given_back` (`where` `kind`
`given_back`, `balance: { "column": "refundable", "of": "taken" }`, `cap: true`). A refund past what
was taken is refused, and so is lowering a payment taken below what already went back.
