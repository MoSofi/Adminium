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

A capped write is refused with `BALANCE_EXCEEDED` and the balance it would have gone below. So is a
change to the parent that lowers `of` under what is already paid. Only a write that takes the
balance below zero, or further below it, is refused: a row already negative from older data can
still be edited or voided. Two payments at once are judged one after the other, so they cannot
both pass.

A write that touches several rows of a table feeding a capped total is refused with
`BALANCE_ONE_AT_A_TIME`, because it cannot be judged row by row. Imports and sample data are
settled but not capped: they record what already happened.

A total or a balance a writer sends is dropped, not refused, so a form that sends the whole row
still saves.

#### Totals that count and climb

A total may count its child rows instead of adding a column up: how many tickets an order holds,
how many lines a kitchen ticket has.

```json
{ "ref": "ticket_count", "type": "int", "default": 0,
  "rules": { "rollup": { "from": "tickets", "via": "order_id", "count": true,
                         "unlessSet": "refunded_at" } } }
```

A rollup names `sum` or `"count": true`, never both. A count is kept in an `int` or `bigint`
column, and takes no `times`, `balance` or `cap`; `where` and `unlessSet` leave rows out as they do
for a sum.

A total may also add up another table's totals: an option's price into its line, the line into
its order, the order into the customer's lifetime total. Such totals **climb**, at most three
tables high, and never in a circle (a table adding up its own rows, or two tables adding up each
other). A write that moves a total at the bottom settles every total above it in the same
transaction: each level adds up what the level below has just written, then works out its
formulas and balances. Every door that moves a total does this: a create, a change, a delete, a
create with child rows, a bulk edit, an import, an undo, a parent form and sample data. Two
writers take the rows in one order (the highest parent first), so they never wait on each other
crosswise; a line moved to another order while a write was reading it is refused `409`
`WRITE_CONFLICT` with `details.retry: true`, and the same write a moment later goes through.

Sums are exact on every engine, SQLite included: a total is added up from each row's decimal text,
never through a floating-point number.
