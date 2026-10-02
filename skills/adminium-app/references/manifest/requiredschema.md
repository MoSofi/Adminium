<!-- produced from apps/docs/src/content/docs/reference/manifest.md § requiredSchema; do not edit -->

# Manifest spec: requiredSchema

`requiredSchema` lists the tables the package needs. Apps must declare it; for add-ons it is
optional. At install Adminium compares it with the operator's database and shows a plan: which
tables it will create, which existing tables it will reuse, and what it needs from the operator
first. Nothing is created until the operator confirms.

```json
"requiredSchema": {
  "prefixed": true,
  "tables": [ … ]
}
```

| Field | Required | Rule |
|---|---|---|
| `tables` | yes | At least one table. Table refs must be unique. |
| `prefixed` | no | `true`, or leave it out. Apps only. |
