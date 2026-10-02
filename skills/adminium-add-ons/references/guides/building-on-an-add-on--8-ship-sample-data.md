<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § 8. Ship sample data; do not edit -->

# Building on an add-on: 8. Ship sample data

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
[Sample data](https://docs.adminium.dev/reference/manifest/#sample-data).
