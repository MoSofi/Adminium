<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § 2. Build a table on each part; do not edit -->

# Building on an add-on: 2. Build a table on each part

`invoice@1` has three parts: `document`, `lines` and `payments`. The app builds one table on each,
naming the shape and the part:

```json
{ "ref": "invoices", "builtOn": "invoices/invoice@1", "part": "document", "columns": [ … ], "states": { … } },
{ "ref": "invoice_lines", "builtOn": "invoices/invoice@1", "part": "lines", "columns": [ … ] },
{ "ref": "payments", "builtOn": "invoices/invoice@1", "part": "payments", "columns": [ … ] }
```

Each table **spells out** its part: every column, with the same type, nullability, enum values,
length, scale, uniqueness, default and rules, and the part's `states`. The add-on's own
`manifest.json`, under `addOn.shapes`, is where you copy them from. Spelling them out keeps every
check of your app a function of your manifest alone: your CI, an upload and the catalogue need
nothing of the add-on to judge it.

Two things change as you copy. A part names the other parts by their part names; your table names
your tables instead:

| The part says | Your table says |
|---|---|
| `"references": "document"` | `"references": "invoices"` |
| `"rollup": { "from": "lines", … }` | `"rollup": { "from": "invoice_lines", … }` |
| `"children": { "lines": { … } }` in the states | `"children": { "invoice_lines": { … } }` |

And where a part refers to a part of **another** of the add-on's shapes (a line that came from a
quote: `"references": "quote@1/document"`), your app builds a table on that part too
(`"builtOn": "invoices/quote@1", "part": "document"`), and the column refers to it.

Here is part of the `document` part as the `invoices` table spells it:

```json
{ "ref": "invoices", "builtOn": "invoices/invoice@1", "part": "document",
  "label": { "en-US": "Invoice", "de-DE": "Rechnung" },
  "labelPlural": { "en-US": "Invoices", "de-DE": "Rechnungen" },
  "keyField": "number",
  "columns": [
    { "ref": "id", "type": "int", "role": "pk" },
    { "ref": "number_seq", "type": "int", "nullable": true,
      "rules": { "sequence": { "gapless": true,
                               "startSetting": { "addOn": "invoices", "setting": "number_start_invoice" } } } },
    { "ref": "number", "type": "text", "maxLength": 24, "nullable": true, "unique": true,
      "rules": { "format": { "from": "number_seq",
                             "prefixSetting": { "addOn": "invoices", "setting": "prefix_invoice" }, "pad": 4 } } },
    { "ref": "status", "type": "enum", "enum": ["draft", "sent", "void"], "default": "draft" },
    { "ref": "currency", "type": "text", "maxLength": 3, "nullable": true,
      "rules": { "default": { "from": "connection.currency" } } },
    { "ref": "tax_rate", "type": "decimal", "scale": 3, "nullable": true,
      "rules": { "default": { "from": { "addOn": "invoices", "setting": "default_tax_rate" } } } },
    { "ref": "subtotal", "type": "decimal", "scale": "currency", "nullable": true,
      "rules": { "rollup": { "from": "invoice_lines", "via": "document_id", "sum": "amount" } } },
    { "ref": "tax", "type": "decimal", "scale": "currency", "nullable": true,
      "rules": { "formula": { "round": { "div": [{ "mul": ["subtotal", { "coalesce": ["tax_rate", 0] }] }, 100] } } } },
    { "ref": "total", "type": "decimal", "scale": "currency", "nullable": true,
      "rules": { "formula": { "add": [{ "coalesce": ["subtotal", 0] }, { "coalesce": ["tax", 0] }] } } },
    …
  ] }
```

What those rules give you, with no code in the app:

- **Numbers.** `number_seq` is the next number of an unbroken series, taken inside the write that
  creates the invoice, starting at the add-on's `number_start_invoice`. `number` is the same
  number as text with the add-on's prefix, `INV-0042`. The studio changes the prefix and the first
  number in the add-on's settings. See [Numbers without gaps](https://docs.adminium.dev/reference/manifest/#numbers-without-gaps).
- **Currency.** A new invoice takes the connection's currency, and every money column keeps that
  currency's decimals: none for JPY, three for KWD. See
  [Decimal places](https://docs.adminium.dev/reference/manifest/#decimal-places).
- **Totals.** Each line's `amount` is a formula over its quantity, rate and discount; the
  invoice's `subtotal` adds the lines up; `tax` and `total` are formulas over it. The arithmetic
  is exact, and the same on every database. See [Formulas](https://docs.adminium.dev/reference/manifest/#formulas).
- **Balance.** `paid` adds up the payments that are not voided and keeps `balance` beside it; a
  payment that would take the balance below zero is refused. See
  [Totals and balances](https://docs.adminium.dev/reference/manifest/#totals-and-balances).
