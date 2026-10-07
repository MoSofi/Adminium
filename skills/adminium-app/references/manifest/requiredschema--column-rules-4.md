<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Column rules; do not edit -->

# Manifest spec: requiredSchema — Column rules

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

- **Exactly.** Every value is read from its decimal text as an exact fraction, and nothing goes
  through a floating-point number. `1 ÷ 3 × 3` is exactly 1, and a total is the same on Postgres,
  MySQL and SQLite to the last minor unit.
- **Rounded once**, half away from zero, to the column's [scale](https://docs.adminium.dev/reference/manifest/#decimal-places). A formula
  column with no `scale` rounds to 0 places when it is an `int` or `bigint`, and to 4 when it is a
  decimal. `round` inside a formula rounds that part early, where the arithmetic calls for it (a
  tax rounded before it is added).
- **Empty in, empty out.** An empty column makes the result empty unless `coalesce` says what to
  read instead: a draft line with no rate yet has no amount, rather than an amount of 0 that looks
  like a price.
- **On every write.** A create works out every formula; an update works out the ones whose inputs
  it changed, reading the stored row with the new values over it. A formula that reads another
  formula column is worked out after it. A formula that reads a [rollup](https://docs.adminium.dev/reference/manifest/#totals-and-balances)
  total is worked out again whenever the total moves.

A formula fills a `decimal`, `money`, `int` or `bigint` column, never a `float` (a
[`join`](https://docs.adminium.dev/reference/manifest/#joined-text) fills a `text` column). It reads only columns of its own table, and every
column it counts with holds a number; `eq`, `neq` and `isNull` may name any column,
`hoursBetween` names two different `timestamptz` columns and `daysBetween` two different `date`
columns. It
may not read itself, formulas may not read each other in a circle, and an expression nests at most
8 deep. A value a writer sends to a formula column is dropped. Anything that reads another row is a
`copy` or a `rollup`, which already keep in step when that other row changes.

#### Hours between two moments

`hoursBetween` works a time entry's hours out from its start and its stop:

```json
{ "ref": "hours", "type": "decimal", "scale": 2, "nullable": true,
  "rules": { "formula": { "hoursBetween": ["started_at", "stopped_at"] } } }
```

09:15 → 11:45 is `2.50`; 22:30 → 01:15 the next day is `2.75`. The hours are exact and rounded
once to the column's scale, like any formula, and they can be counted with further:
`{ "mul": [{ "hoursBetween": ["started_at", "stopped_at"] }, "rate"] }` is the pay at a rate. An
update that moves only the stop works the hours out again from the start as stored.
