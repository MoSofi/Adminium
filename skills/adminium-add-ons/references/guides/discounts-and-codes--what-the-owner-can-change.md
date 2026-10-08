<!-- produced from apps/docs/src/content/docs/guides/apps/discounts-and-codes.md § What the owner can change; do not edit -->

# Discounts, codes and refunds worked out by Adminium: What the owner can change

An owner switches an app's price rule off and on (`PATCH /connections/:id/tables/:table/adjust/switch`);
an app update leaves the switch be. For a table of their own they store a rule themselves
(`PUT …/adjust`), and may ask Adminium to add what the rule needs — the reduction columns, a line's
amount, the order's subtotal, net and total, the table of typed codes — with `make`, after a
`dryRun` that says what would be added. `GET /add-ons/:key/adjusts` lists every table whose price an
add-on lowers. All of it is in the [REST API reference](https://docs.adminium.dev/reference/rest-api/).
