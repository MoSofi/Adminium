<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

The row is judged as the write leaves it, whenever the write changes either column: a create or an
update that leaves `person_id` empty while `kind` is `away` or `sick` is refused, and so is moving
an event whose `person_id` is empty to `away`. A write that changes neither column is not judged —
a column sent back as it is stored, as the record form sends every field, is no change — so a row
stored before the rule can still be edited. Empty means no value, or only spaces. On a create that
leaves `kind` out, `kind` is its database default: a trip that is away unless it says otherwise
asks for a person. The record form marks the field required as soon as the other column holds one
of the values, and asks nothing of an edit that changes neither.

- **As the database compares.** A `bool` column's yes is a yes in any spelling (`true`, `on`, `y`,
  `1`, ` TRUE`), and it is stored as the answer it names on every engine; a word that is no yes and
  no no is refused. On MySQL a plain text column is compared as MySQL compares it, so `AWAY ` is
  `away` there, and asks for a person; Postgres and SQLite keep `Away` apart from `away`.
- **Two writers at once.** An update that moves `kind` to `away` over a person it did not send, or
  empties `person_id` over a `kind` it did not send, asks the database, in the same statement, that
  what it read is still so. Two people changing one event at the same moment cannot together leave
  it away with nobody named: the second is refused as the first would have been.

`column` is another column of the same table, and every value in `in` must fit it (a value of an
enum, a number for a number column, `true` or `false` for a `bool`). The rule's own column must be
`nullable`: one that is never empty is simply `required`. A column cannot take both `required` and
`requiredWhen`, and a column Adminium fills (`copy`, `default`, `sequence`, `format`, `code`,
`rollup`, `formula`, `stamp`) takes no `requiredWhen`, because nobody is asked for it.

```json
{ "ref": "subtotal", "type": "money", "default": 0,
  "rules": { "rollup": { "from": "ticket_items", "via": "ticket_id", "sum": "unit_price",
                         "times": "qty", "unlessSet": "voided_at" } } }
```

#### Totals and balances

A rollup can also filter its child rows, keep a balance beside the total, and refuse a change
that would take the balance below zero: what a visit's fee, its payments and its write-offs need.

| Field | Rule |
|---|---|
| `where` | `{ "column", "eq" }`: only child rows whose column equals the value are added up (`voided` is `false`). The value must fit the column, and the column must not be nullable: a row left empty would drop out of the total unseen. |
| `balance` | `{ "column", "of", "minus"? }`: a second column of this row, kept as `of − minus… − total` (`balance = fee − waived − paid`). `minus` lists up to 4 columns. Every column named is a number column of this table, and the balance is a column of its own, with no rules of its own. |
| `cap` | `true`: a child write that would take the balance below zero is refused. It needs a `balance` on the same rollup, or a balance elsewhere on the row whose `minus` lists this total (a write-off is capped by the balance it lowers). |
| `capUnless` | `{ "column" }`, with `cap`: a yes/no column of the same row that lifts the cap while it is on (a stock level a shop sells from whether or not the count is right). The column is never empty. A balance guarded by two capped totals is lifted only when both name the same column. |

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

A capped balance whose `of` is a [formula](https://docs.adminium.dev/reference/manifest/#formulas) (a total of subtotal and tax) is judged
against the cap one row at a time; a bulk edit or an import settles it afterwards, without the
cap. So `validateManifest` [warns](https://docs.adminium.dev/reference/manifest/#validation) when the formula reads a column that stays
writable while the capped rows can exist: lock those columns with the table's
[states](https://docs.adminium.dev/reference/manifest/#states) (and the lines they add up with `lock: true`) in every state a capped row can be
written in or reached from.

#### Formulas

A `formula` works a number out from the other columns of the same row: a line's amount, a
document's tax and total.

```json
{ "ref": "amount", "type": "decimal", "scale": "currency", "nullable": true,
  "rules": { "formula": { "max": [0, { "sub": [{ "mul": ["qty", "rate"] }, { "coalesce": ["discount", 0] }] }] } } }
```
