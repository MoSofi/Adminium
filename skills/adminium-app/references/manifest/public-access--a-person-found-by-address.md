<!-- produced from apps/docs/src/content/docs/reference/manifest.md § Public access — A person found by address; do not edit -->

# Manifest spec: Public access — A person found by address

### A person found by address

A guest checking out types their address. `identity` finds the person it belongs to, or makes one,
and links the new row to them; the guest is never told which happened.

```json
"identity": { "table": "customers", "email": "email", "link": "customer_id",
              "fill": { "name": "name" } }
```

| Field | Rule |
|---|---|
| `table` | The people table: its identity entry signs people in by an [emailed link](https://docs.adminium.dev/reference/manifest/#a-persons-own-rows). |
| `email` | The `text` column of this entry's row the address is typed into: `writable`, in `requires`, with `validation.format: "email"`. The people table's address column is `unique`, nullable (it is emptied when a person is forgotten), kept `normalize: "email"`, and at least as wide. |
| `link` | This row's nullable foreign key to the person. Adminium fills it; it is never shown, since it would tell whether the address was on file. |
| `fill` | Up to 4 `{ "<people column>": "<this row's column>" }`: a new person's `text` columns, filled from what the guest typed. Never a column Adminium decides, a secret, or a unique one. |
| `on` | `{ "to": "<state>" }`, on a change through a row's own link: find the person only on the save that moves the row to that state (a ticket accepted), not on every save made while it has no person. |

A person is found by address whatever its case, and a second person is never made for an address
stored in another case. The entry asks the human check and limits creates per address
(`anonymous.perValue` counting `email`); a signed-in guest's create links them as it always has
(`claimedBy` with `optional: true`). The people table may carry no running number, no limit and no
message on create: each would tell a stranger's order apart from its owner's. Nothing on the row
reads through `link`.
