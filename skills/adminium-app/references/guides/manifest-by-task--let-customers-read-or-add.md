<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Let customers read or add; do not edit -->

# A manifest, task by task: Let customers read or add

`access.json` holds `publicAccess`: the only things the customer side can reach. A table with no
entry here is out of its reach, whatever the screens try. The app needs a customer side for it:
`{ "side": "customer", "kind": "spa" }` in `frontends`, and its code in `customer/`.

```json title="manifest/access.json"
{
  "publicAccess": [
    { "table": "jobs", "methods": ["GET"], "select": ["number", "status"] },
    { "table": "requests", "methods": ["POST"], "select": ["id"],
      "writable": ["message"], "defaults": { "handled": false } }
  ]
}
```

`requests` is a table made for what customers send in:

```json title="manifest/tables/requests.json"
{
  "ref": "requests",
  "columns": [
    { "ref": "id", "type": "int", "role": "pk" },
    { "ref": "message", "type": "text", "maxLength": 500, "default": "" },
    { "ref": "handled", "type": "bool", "default": false },
    { "ref": "created_at", "type": "timestamptz", "role": "created_at", "default": "now" }
  ]
}
```

| Field | What it says |
|---|---|
| `table` | One of the app's table refs. |
| `methods` | `GET` to read, `POST` to add, `PATCH` to change. |
| `select` | The columns a reply carries. Leave it out and every column is sent, so list them. |
| `writable` | The columns a browser may set. |
| `defaults` | Values the server writes whatever the browser sends. |

- **Add or read, not both.** A table anyone may add a row to may not also be one anyone may read:
  every row could be read by guessing ids. Put `GET` and `POST` on different tables, as here.
- `PATCH` is refused without a `claim`, a `claimedBy` or a `visibleWith`: nobody changes a row
  without proving it is theirs.
- `writable` never names a column Adminium fills (a `sequence`, a `code`, a `stamp`, a total).

**A person's own rows.** An entry with `claim` lets a person prove who they are, by details of
their row or by a link emailed to them, and so opens a session. An entry with
`claimedBy: { "table", "column" }` then reaches only that person's rows: their own jobs, not
everyone's. Read [Guests, their details and their own links](https://docs.adminium.dev/guides/apps/identity-and-own-links/)
before writing either.

Reference: [Public access](https://docs.adminium.dev/reference/manifest/#public-access),
[A person's own rows](https://docs.adminium.dev/reference/manifest/#a-persons-own-rows).
