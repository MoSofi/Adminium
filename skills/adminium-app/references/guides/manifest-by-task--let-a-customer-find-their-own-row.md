<!-- produced from apps/docs/src/content/docs/guides/apps/manifest-by-task.md § Let a customer find their own row; do not edit -->

# A manifest, task by task: Let a customer find their own row

"Track my order", "my booking", "my ticket": a person who is not signed in sees **one row, their
own**, by typing two things they know about it. Never do this by letting everyone read the table:
anyone could then read every order, with the names and addresses in it, and the check refuses it.

**1. A code Adminium fills in.** Give the table a short code of its own, so there is something to
type that nobody can guess:

```json title="manifest/tables/orders.json (one column)"
{ "ref": "code", "type": "text", "maxLength": 12, "nullable": true,
  "rules": { "code": { "length": 6, "prefix": "CK-" } }, "label": { "en-US": "Order code" } }
```

**2. Two entries on the table.** Anyone may add an order and is shown its code. Reading is behind a
`claim`: the columns a person must both know.

```json title="manifest/access.json"
{
  "publicAccess": [
    { "table": "orders", "methods": ["POST"], "select": ["id", "code"],
      "writable": ["customer_name", "customer_email", "pickup_date"] },
    { "table": "orders", "methods": ["GET"], "select": ["code", "status", "pickup_date"],
      "claim": { "match": ["code", "customer_email"] } }
  ]
}
```

**3. The page.** Show the code when the order is placed. To track, claim first, then read the
claimed endpoint, whose name is the table's with `_claimed` after it:

```tsx
// `config` is the customer config: `useCustomer()` gives it as `loaded.value`, and the starter's
// screen takes it as its prop. Its `tables` are not on the client: `client.config()` has none.
const orders = config.tables['orders'] ?? 'orders';

// Placing the order: the reply carries what the entry's "select" shows.
const made = await client.create(orders, { customer_name, customer_email, pickup_date });
setCode(String(made['code']));

// Tracking it: both details must match one row. A wrong pair answers false, not an error.
const found = await client.claim({ code: typedCode, customer_email: typedEmail });
if (!found) return setProblem('No order matches that code and email address.');
const mine = (await client.list(`${orders}_claimed`, { limit: 1 })).data[0];
```

- `claim.match` names one to three columns, and the person must give every one. A code compares
  the way codes are kept (upper case, spaces and dashes left out), so `ck y28fap` finds `CK-Y28FAP`.
- A public list takes no `where`, `order` or `q` from the page: asking for the row by a filter is
  refused `400` `PUBLIC_QUERY_REFUSED`. The claim is how one row is asked for.
- Before the claim, and after its session ends (30 minutes), the claimed endpoint answers `404`.
- To let the person change their row (cancel it), add `PATCH` to the claimed entry with a narrow
  `writable`: see [A person's own rows](https://docs.adminium.dev/guides/apps/public-access/#a-persons-own-rows).
