<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

A rollup can also filter its child rows, keep a balance beside the total, and refuse a change
that would take the balance below zero: what a visit's fee, its payments and its write-offs need.

| Field | Rule |
|---|---|
| `where` | `{ "column", "eq" }`: only child rows whose column equals the value are added up (`voided` is `false`). The value must fit the column, and the column must not be nullable: a row left empty would drop out of the total unseen. |
| `balance` | `{ "column", "of", "minus"? }`: a second column of this row, kept as `of − minus… − total` (`balance = fee − waived − paid`). `minus` lists up to 4 columns. Every column named is a number column of this table, and the balance is a column of its own, with no rules of its own. |
| `cap` | `true`: a child write that would take the balance below zero is refused. It needs a `balance` on the same rollup, or a balance elsewhere on the row whose `minus` lists this total (a write-off is capped by the balance it lowers). |

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

An expression is a number, a column of the same row by its ref (`"qty"`), or one of these objects:

| Expression | Value |
|---|---|
| `{ "add": [a, b, …] }` | The sum of 2–8 expressions. |
| `{ "sub": [a, b] }` | `a − b`. |
| `{ "mul": [a, b, …] }` | The product of 2–8 expressions. |
| `{ "div": [a, b] }` | `a ÷ b`. Empty when `b` is zero. |
| `{ "min": [a, b, …] }`, `{ "max": [a, b, …] }` | The smallest or largest of 2–8 expressions. |
| `{ "round": a }` or `{ "round": [a, places] }` | `a` rounded half away from zero, to the column's scale or to `places` (0–4). |
| `{ "coalesce": [a, b] }` | `a`, or `b` when `a` is empty. |
| `{ "if": [condition, a, b] }` | `a` when the condition holds, else `b`. |
| `{ "hoursBetween": [start, stop] }` | The hours from the `start` column to the `stop` column, both `timestamptz` columns of the row. See [Hours between two moments](https://docs.adminium.dev/reference/manifest/#hours-between-two-moments). |
| `{ "daysBetween": [from, to] }` | The whole calendar days from the `from` date to the `to` date, two `date` columns of the row: a stay's nights. |
| `{ "join": [part, part, …] }` | Text: 2–8 parts, each a column of the row or a piece of text, joined in order. The whole formula, of a `text` column; see [Joined text](https://docs.adminium.dev/reference/manifest/#joined-text). |

A condition is one of:

| Condition | Holds when |
|---|---|
| `{ "eq": [column, value] }`, `{ "neq": [column, value] }` | The column equals, or does not equal, a string, number or boolean. The column may be of any type (an enum, a bool). `neq` does not hold for an empty column. |
| `{ "gt": [a, b] }`, `{ "gte": … }`, `{ "lt": … }`, `{ "lte": … }` | `a` is greater, greater or equal, less, or less or equal than `b`. A comparison with an empty side does not hold. |
| `{ "isNull": column }` | The column is empty. |
| `{ "and": [c, c, …] }`, `{ "or": [c, c, …] }` | All, or any, of 2–8 conditions. |

```json
{ "if": [{ "eq": ["discount_kind", "percent"] },
         { "mul": ["qty", "rate", { "sub": [1, { "div": [{ "coalesce": ["discount", 0] }, 100] }] }] },
         { "sub": [{ "mul": ["qty", "rate"] }, { "coalesce": ["discount", 0] }] }] }
```

How a formula is worked out:
