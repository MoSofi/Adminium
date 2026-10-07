<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § An add-on with tables of its own; do not edit -->

# Building on an add-on: An add-on with tables of its own

Some add-ons keep their own data rather than a shape for yours: a stock list, gift cards. An app
that names such an add-on can ship [sample rows for its tables](https://docs.adminium.dev/guides/apps/sample-data/#rows-for-an-add-on-the-app-names)
and lets it serve [public entries through the app's key](https://docs.adminium.dev/guides/apps/public-access/#what-an-add-on-adds).
What such an add-on declares, and how it is installed, is in
[Add-ons that keep tables of their own](https://docs.adminium.dev/guides/add-ons-with-tables/).

### Your app's roles on an add-on's tables

An add-on's own roles grant its tables. Your app's roles may too, with
[`tables`](https://docs.adminium.dev/reference/manifest/#a-role-on-an-add-ons-tables), so a waiter reads stock and a
housekeeper writes a transfer without holding a second role:

```json
{ "key": "housekeeper", "name": { "en-US": "Housekeeper" }, "permissions": ["table:@rooms:read"],
  "tables": [{ "addOn": "inventory", "table": "transfers", "actions": ["read", "create"],
               "limit": { "creatable": ["from_place_id", "to_place_id", "note"] } }] }
```

- The grant is made when the add-on is connected to the app and taken back when it is
  disconnected. The install check lists it.
- It gives `read`, `create` and `update` only: no delete, no export, no import, and no limit to
  some rows.
- `limit` narrows the columns for this role. A person who also holds a role with a plain read of
  the same table reads every column: grants add up.

### Printing from an add-on's page

An add-on's own page prints its documents through the
[data kit](https://docs.adminium.dev/guides/add-ons-with-tables/#printing-from-a-page). Your app's screens print a document
of your own tables as in step 6.

### Answering the price question

An add-on that keeps offers exports `adjust(input)` from the server file it names under
`provides` (contract `price-adjust`, version 1). It is handed the order's lines, the codes typed on
it (each already looked up in your tables), who is buying when that was proved, what staff took off
by hand with the most its giver may give, the rows of your `offers` reads and your settings row —
and answers one reduction per line, what was applied, the codes it refuses with a reason, and, where
the order posts, the uses to record. From Adminium 0.3.19.

- **Pure and synchronous.** It reads nothing and keeps no clock: `now`, `today`, `weekday`, `time`
  and `zone` are inputs, on the venue's clock. The same input gives the same answer. A promise, a
  throw or more than a moment's work refuses the save.
- **Nothing it says is taken on trust.** Every line answered once and no other, no reduction above
  its line, the order's reduction the sum of the lines', what was applied adding up line by line,
  every offer, code and voucher named being a row that was read for this call, a reduction by hand
  within what was asked and within its giver's limit. One miss and the save is refused; nothing was
  written yet.
- **Modes.** `save` and `dry` price an order; `try` is staff's preview and may carry a `draft`
  offer and ask you to `explain` every offer; `refund` prices the lines kept (`kept: false` for a
  returned line) under the offers the order had.
- **Adminium writes.** You never write the reductions, the applied rows or the uses: Adminium does,
  in the save's own transaction, from your answer.

The code runs with the clock, timers, the network and dynamic code taken away. That is hardening
against mistakes, not a sandbox: an add-on's server file is code its installer chose to trust.
