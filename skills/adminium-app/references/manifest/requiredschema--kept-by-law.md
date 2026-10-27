<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema — Kept by law; do not edit -->

# Manifest spec: requiredSchema — Kept by law

### Kept by law

`keep`, on a table, says the law makes the business keep its rows, and why:

```json
{ "ref": "invoices", "columns": [ … ], "keep": { "law": "tax" } }
```

`law` is one of `tax` (invoices, receipts, payments), `health` (a patient's records), `contract`
(a signed agreement) and `safety` (a certificate, an incident). When a person's data is erased,
the rows of such a table are left as they are, a [copy of the person](https://docs.adminium.dev/reference/manifest/#people) on them included,
and the erasure lists them under "What stays" with the reason, in the reader's language. Their
copies are still found and exported with the person.

`keep` is not [`states.noDelete`](https://docs.adminium.dev/reference/manifest/#states): that refuses a delete of a row in some states (a sent
invoice is voided, not deleted) and says nothing of the law. Needs Adminium 0.3.38.
