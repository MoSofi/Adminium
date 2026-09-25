---
title: Building on an add-on
description: How an app builds its invoices on the Invoices & Receipts add-on's invoice@1 shape — requiring the add-on, spelling out the parts, adding your own columns, emails, documents, a client portal and sample data.
---

An add-on can define a **shape**: the tables a job needs, with the rules Adminium keeps on them.
The Invoices & Receipts add-on (`invoices`) defines `invoice@1`: a document, its lines and its
payments, with gapless numbers, exact totals in the currency's decimals, a balance that never goes
below zero, a draft–sent–void life, reminder emails and printed invoices and receipts.

An app that sends invoices does not have to invent any of that. It builds its own tables on the
shape and adds what is its own: its clients, its projects, its portal. This page walks through
such an app, a small studio that bills its clients. Every field it uses is listed in the
[manifest reference](/reference/manifest/).

## 1. Require the add-on

The shape belongs to the add-on, so the app requires it:

```json
"compatibility": { "minAdminiumVersion": "0.3.1" },
"addOns": {
  "requires": [{ "key": "invoices", "range": ">=1.0.3",
                 "reason": { "en-US": "Invoices, quotes and receipts are made by this add-on.",
                             "de-DE": "Rechnungen, Angebote und Quittungen macht dieses Add-on." } }]
}
```

Installing the app then installs or connects the add-on first, before the app's own tables, and
the add-on cannot be removed while the app is installed. The `range` is the add-on versions your
tables were built against. Raise `minAdminiumVersion` to the release that reads the fields on this
page: an older server then asks the operator to upgrade instead of calling the manifest invalid.
See [Add-ons](/reference/manifest/#add-ons).

## 2. Build a table on each part

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
  number in the add-on's settings. See [Numbers without gaps](/reference/manifest/#numbers-without-gaps).
- **Currency.** A new invoice takes the connection's currency, and every money column keeps that
  currency's decimals: none for JPY, three for KWD. See
  [Decimal places](/reference/manifest/#decimal-places).
- **Totals.** Each line's `amount` is a formula over its quantity, rate and discount; the
  invoice's `subtotal` adds the lines up; `tax` and `total` are formulas over it. The arithmetic
  is exact, and the same on every database. See [Formulas](/reference/manifest/#formulas).
- **Balance.** `paid` adds up the payments that are not voided and keeps `balance` beside it; a
  payment that would take the balance below zero is refused. See
  [Totals and balances](/reference/manifest/#totals-and-balances).

## 3. Add what is yours

Your table may carry columns of its own, beside the part's. The studio links each invoice to a
client and a project, and lets a client say "I've paid":

```json
{ "ref": "client_id", "type": "fk", "references": "clients" },
{ "ref": "project_id", "type": "fk", "references": "projects", "nullable": true },
{ "ref": "client_paid_at", "type": "timestamptz", "nullable": true }
```

On the part's own columns you may relabel, and add rules that label or narrow: `enumLabels`,
`personal`, `validation`, `required` and `options`. You may also put a `copy` in front of a column
the part fills from a setting, so a client's own tax rate (a `tax_rate` on the app's `clients`
table) comes first and the add-on's default rate answers when the client has none:

```json
{ "ref": "tax_rate", "type": "decimal", "scale": 3, "nullable": true,
  "rules": { "copy": { "via": "client_id", "from": "tax_rate" },
             "default": { "from": { "addOn": "invoices", "setting": "default_tax_rate" } } } }
```

Anything else about a part's column (its type, a rule that decides its value) stays exactly as
the part declares it.

## 4. Keep the part's states

The `document` part declares the invoice's life: a draft is sent once it has a line and a total
above zero, a sent invoice with nothing paid may be voided, and a sent or void invoice is locked
except for a few columns. The lines are locked with it, and payments are recorded only against a
sent invoice. See [States](/reference/manifest/#states).

Your table spells out the same states, and may add to them in four ways: more columns that stay
writable in `lock.except` (its own), `roles` on a move, more child tables in `children`, and more
of its own columns in a child's `clearOnCreate`. The studio keeps voiding a sent invoice for its
managers, and a recorded payment clears the client's "I've paid":

```json
"states": {
  "column": "status", "initial": "draft",
  "moves": {
    "draft": [{ "to": "sent", "requires": { "children": { "invoice_lines": 1 },
                                            "where": [{ "column": "total", "gt": 0 }] } }, "void"],
    "sent":  [{ "to": "void", "requires": { "where": [{ "column": "paid", "eq": 0 }] },
                "roles": ["manager"] }]
  },
  "lock": { "when": ["sent", "void"], "except": ["due_on", "ladder", "void_reason", "client_paid_at"] },
  "children": {
    "invoice_lines": { "via": "document_id", "lock": true },
    "payments": { "via": "document_id", "parentIn": ["sent"], "clearOnCreate": ["client_paid_at"] }
  },
  "noDelete": { "when": "numbered" }
}
```

## 5. Send the shape's emails

A shape can send email: `invoice@1` sends the invoice when it is sent, three held reminders
after its due date, and a receipt for each payment. An app built on the shape sends them too, so
its [outbox](/reference/manifest/#outbox) has a kind, a producer and a template for each kind the
shape's outbox sends, with the shape's producers as the starting point:

```json
"outbox": {
  "table": "messages",
  "columns": { "kind": "kind", "status": "status", "to": "to", "due": "due",
               "skipReason": "skip_reason", "bodyOverride": "body_override",
               "approvedBy": "approved_by", "sentAt": "sent_at", "error": "error" },
  "links": { "invoice": "invoice_id", "payment": "payment_id", "client": "client_id" },
  "recipient": { "via": "client_id", "table": "clients", "email": "email", "name": "contact_name" },
  "kinds": { "invoice-sent": "studio-invoice-sent", "invoice-rung-1": "studio-invoice-rung-1", … },
  "producers": [
    { "kind": "invoice-sent", "link": "invoice_id",
      "onChange": { "table": "invoices", "column": "status", "to": "sent" } },
    { "kind": "invoice-rung-1", "link": "invoice_id", "hold": true,
      "onChange": { "table": "invoices", "column": "status", "to": "sent" },
      "due": { "date": "due_on", "at": "09:00",
               "days": { "setting": { "addOn": "invoices", "setting": "ladders" }, "byColumn": "ladder", "index": 0 } },
      "supersede": "rungs",
      "dropWhen": [{ "column": "balance", "lte": 0, "reason": "paid" },
                   { "column": "status", "eq": "void", "reason": "void" }] },
    …
  ]
}
```

A reminder is written `held`: the studio reads it, may reword it, and approves it or skips it. A
later reminder that comes due overtakes an earlier one not yet sent, and paying or voiding the
invoice drops the ones still waiting. See [Held messages](/reference/manifest/#held-messages).

The outbox table's `kind` enum lists every kind, its `status` enum includes `held`, and its links
are nullable foreign keys. A template may carry the invoice as an attachment with
`"attach": { "kind": "invoice", "link": "invoice" }`.

## 6. Print invoices and statements

The shape's document profiles (an invoice, a receipt) are made for your tables when the app is
installed, with their real names, and removed when it is uninstalled. A printed invoice also wants
the client's company and address, which are your columns, not the part's. A `documents` entry of
the same kind on the same table adds them to the shape's profile:

```json
"documents": [
  { "kind": "invoice", "addOn": "invoices", "table": "invoices", "name": { "en-US": "Invoice" },
    "mapping": { "customerName": { "via": "client_id", "column": "company" },
                 "customerLines": { "via": "client_id", "column": "address" } } },
  { "kind": "statement", "addOn": "invoices", "table": "clients", "name": { "en-US": "Statement" },
    "mapping": { "customerName": { "column": "company" } },
    "statement": {
      "documents": { "table": "invoices", "via": "client_id", "date": "issued_on", "amount": "total",
                     "number": "number", "where": { "column": "status", "in": ["sent", "void"] } },
      "payments":  { "table": "payments", "via": "client_id", "date": "paid_on", "amount": "amount",
                     "unless": "voided" } } }
]
```

The statement lists a client's sent invoices and payments over a period, with a running balance.
Each source's `via` points at the client, so the app adds a `client_id` to its `payments` table,
copied from the invoice the payment is for:

```json
{ "ref": "client_id", "type": "fk", "references": "clients", "nullable": true,
  "rules": { "copy": { "via": "document_id", "from": "client_id", "mode": "always" } } }
```

See [Documents](/reference/manifest/#documents).

## 7. Open a portal for clients

A client signs in with a link emailed to their address, sees their sent invoices with the lines
and payments of each, opens the printed invoice, and says "I've paid" once:

```json
"publicAccess": [
  { "table": "clients", "methods": ["GET"], "select": ["contact_name"],
    "claim": { "verify": "email-link", "email": "email" }, "humanCheck": true },
  { "table": "invoices", "methods": ["GET", "PATCH"], "level": "verified",
    "claimedBy": { "table": "clients", "column": "client_id" },
    "filters": [{ "column": "status", "op": "in", "value": ["sent", "void"] }],
    "select": ["number", "status", "total", "balance", "due_on", "client_paid_at"],
    "writable": ["client_paid_at"], "writableWhen": { "client_paid_at": [null] },
    "documents": ["invoice", "statement"] },
  { "table": "invoice_lines", "methods": ["GET"], "level": "verified",
    "visibleWith": { "table": "invoices", "via": "document_id" },
    "select": ["description", "qty", "rate", "amount"] },
  { "table": "payments", "methods": ["GET"], "level": "verified",
    "visibleWith": { "table": "invoices", "via": "document_id" },
    "select": ["number", "amount", "paid_on"], "documents": ["receipt"] }
]
```

The lines and payments are reached through the invoice entry, so a draft's lines are as hidden as
the draft. Nothing a client writes can touch a number, a total or a balance: those are values
Adminium decides. See [Public access](/reference/manifest/#public-access) and
[Rows visible with their parent](/reference/manifest/#rows-visible-with-their-parent).

## 8. Ship sample data

Sample invoices must not take numbers from the real series, or the studio's first real invoice
would not be number one. A sample row spells every gapless number `null`:

```json
{ "ref": "invoices", "rows": [
  { "@label": "inv-1", "client_id": { "@ref": "ada" }, "status": "sent",
    "number_seq": null, "number": "SAMPLE-1",
    "issued_on": { "@month": -1, "@dom": 3 }, "due_on": { "@month": -1, "@dom": 17 } }
] }
```

Adding the sample is refused while a row gives a gapless column a number or leaves it out. See
[Sample data](/reference/manifest/#sample-data).

## 9. Check it before you release

Run `validateManifest` from the `@adminiumjs/manifest` package in your CI. It reads your manifest
alone, and refuses one whose names do not add up: a rule's column the table lacks, a formula
reading a column that holds no number, a state that is not a value of the state column, a
`builtOn` whose add-on the app does not require. It also returns `warnings`, advice that never
refuses a manifest; see [Validation](/reference/manifest/#validation).
