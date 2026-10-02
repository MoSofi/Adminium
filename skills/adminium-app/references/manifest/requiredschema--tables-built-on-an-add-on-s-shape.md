<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Tables built on an add-on's shape; do not edit -->

# Manifest spec: requiredSchema — Tables built on an add-on's shape

### Tables built on an add-on's shape

An add-on can define a **shape**: a set of named parts, each with its columns, the rules Adminium
keeps on them and its states. The Invoices & Receipts add-on defines `invoice@1`, whose parts are a
`document`, its `lines` and its `payments`. An app builds its own tables on it:

```json
{ "ref": "invoices", "builtOn": "invoices/invoice@1", "part": "document",
  "columns": [ … every column of the part, then the app's own … ],
  "states": { … the part's states … } }
```

`builtOn` is `<add-on key>/<shape name>@<version>`. The app must require that add-on in
[`addOns.requires`](https://docs.adminium.dev/reference/manifest/#add-ons). `builtOn` is not the table's [`shape`](https://docs.adminium.dev/reference/manifest/#tables) field: that lets two
apps share one table, while two apps built on one add-on's shape each get tables of their own.

The table **spells out** every column of its part, with the part's type, nullability, enum values,
`maxLength`, `scale`, `unique`, `default` and rules, and the part's `states`. So every check of the
app reads its own manifest alone. Where a part's column refers to another part (`"references":
"document"`), the app's column refers to its own table built on that part (`"references":
"invoices"`), and a rule that names a part (a rollup's `from: "lines"`) names the app's table
instead.

What the app may add to a part, and nothing else:

- columns of its own, with any rules;
- a label, and the rules that label or narrow a part's column: `enumLabels`, `personal`,
  `validation`, `required`, `requiredWhen`, `options`, `notAfter` and `notBefore`;
- a `copy` in front of a column the part fills with a `default` (a client's own tax rate before the
  add-on's default rate): the part's default still answers when the copy comes back empty;
- in the states: more `lock.except` columns (its own columns that stay writable), `roles` on a
  move, more tables in `children`, more columns in a child's `clearOnCreate`, and on a child the
  part ties to the state a `release` and `lockLinked` entries naming only columns the app added
  to that child (a line's own `time_entry_id`), never the part's. A `release` the part has is
  kept as it is, and a `lockLinked` entry it has keeps at least its columns.

Everything else, from a column's type to a rule that decides a value or a move, is the part's own.

The install checks each table against the shape of the add-on it will really run on: the installed
add-on, or the version the install brings with the app. A column dropped or retyped, or a rule
changed, refuses the install or update `409` `SHAPE_MISMATCH`, naming the column, before anything
is written. The app pins the shape's version: `invoice@1` is checked against the add-on's
`invoice@1`, whatever else a newer add-on ships beside it. An add-on update that no longer has a
shape version an installed app is built on is refused `409` `ADD_ON_SHAPE_IN_USE`; update the app
first. The tables themselves are the app's: two apps built on one shape get two sets of tables.

When the shape sends email, the app sends it too: its [`outbox`](https://docs.adminium.dev/reference/manifest/#outbox) has a kind and a
producer for every kind the shape's outbox sends. The shape's document profiles (an invoice, a
receipt) are made for the app's tables when it is installed; see [Documents](https://docs.adminium.dev/reference/manifest/#documents). For the
whole story, see [Building on an add-on](https://docs.adminium.dev/guides/building-on-an-add-on/).
