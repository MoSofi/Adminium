<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request — An app's install check; do not edit -->

# Error codes: Codes met outside a request — An app's install check

### An app's install check

`POST /apps/plan` lists what stops an install in `problems`, each with a `code`, `table` and
`column`. An install that meets one is refused `422` `VALIDATION_FAILED` with
`details.reason: "PLAN_REFUSED"` and the same `problems`.

| Code | Meaning |
|---|---|
| `LINK_ORPHANS` | A foreign key the update adds to a column that was there as a plain value, which rows already in the table break: they name a row that does not exist. Point them at one that does, or empty them, then check again. |
| `UNIQUE_DUPLICATES` | A unique rule the install adds, which rows already in the table break. Make them differ, then check again. |
| `UNIQUE_KEY_TOO_LONG` | On MySQL, a unique column or set of columns wider than MySQL can index (3072 bytes together, 768 characters for one text column). Make the text columns shorter. |
