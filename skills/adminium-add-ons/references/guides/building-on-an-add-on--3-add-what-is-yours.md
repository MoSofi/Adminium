<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § 3. Add what is yours; do not edit -->

# Building on an add-on: 3. Add what is yours

Your table may carry columns of its own, beside the part's. The studio links each invoice to a
client and a project, and lets a client say "I've paid":

```json
{ "ref": "client_id", "type": "fk", "references": "clients" },
{ "ref": "project_id", "type": "fk", "references": "projects", "nullable": true },
{ "ref": "client_paid_at", "type": "timestamptz", "nullable": true }
```

On the part's own columns you may relabel, and add rules that label or narrow: `enumLabels`,
`personal`, `validation`, `required`, `options`, `notAfter` and `notBefore`. You may also put a `copy` in front of a column
the part fills from a setting, so a client's own tax rate (a `tax_rate` on the app's `clients`
table) comes first and the add-on's default rate answers when the client has none:

```json
{ "ref": "tax_rate", "type": "decimal", "scale": 3, "nullable": true,
  "rules": { "copy": { "via": "client_id", "from": "tax_rate" },
             "default": { "from": { "addOn": "invoices", "setting": "default_tax_rate" } } } }
```

Anything else about a part's column (its type, a rule that decides its value) stays exactly as
the part declares it. The install checks this against the add-on it will really run on, and
refuses a table that differs with `SHAPE_MISMATCH`, naming the column, before anything is written.
