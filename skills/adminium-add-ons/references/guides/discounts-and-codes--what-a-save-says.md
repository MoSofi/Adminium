<!-- produced from apps/docs/src/content/docs/guides/apps/discounts-and-codes.md § What a save says; do not edit -->

# Discounts, codes and refunds worked out by Adminium: What a save says

Every save and quote in which a price was asked says which reductions applied:

```json
{ "applied": [
    { "line": "order_lines/1", "name": "Tote pair", "kind": "offer", "amount": "15.00", "typed": false },
    { "line": null, "name": "Autumn 5", "kind": "code", "amount": "5.00", "typed": true } ] }
```

One entry per reduction, in the reader's language. A reduction on one line names the line (by its
place in what was sent, or `<table>:<key>` at the desk); one spread over several is one entry with
their sum. A voucher carries `codeLast4`. No reply carries an add-on's ids, a whole code, or the
reason staff wrote beside a reduction by hand.

A guest who reads their own order again (`GET /public/records/:ref/:id`) is told the same, from the
rows that were kept — through an entry they prove the order is theirs by, and that shows the
order's reduction. A create sent twice with the same retry key answers as the first did.
