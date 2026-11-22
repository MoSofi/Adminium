<!-- produced from apps/docs/src/content/docs/guides/apps/building-a-side.md § A customer side; do not edit -->

# Building an app's screens: A customer side

A customer side reaches the public API, and there only what the app's `access.json` grants. Write
`access.json` first, run `adminium app check` to read back what it grants, then write the screen.

```tsx
import { useMemo } from 'react';
import { createPublicClient } from '@adminiumjs/public-client';
import { useCustomer, type CustomerConfig } from '@adminiumjs/adminium/side';

export function App() {
  const loaded = useCustomer();
  if (loaded.state === 'loading') return <p>Loading…</p>;
  if (loaded.state === 'error') return <p>{loaded.message}</p>;
  return <Menu config={loaded.value} />;
}

function Menu({ config }: { config: CustomerConfig }) {
  const client = useMemo(() => createPublicClient(config), [config]);
  const items = config.tables['items'] ?? 'items';
  // client.list(items, { limit: 50 })                     → { data: rows }, in key order
  // client.create(requests, { message })                  → the new row, as far as `select` shows it
  return null;
}
```

`config.tables` maps each table's short name to the name its public endpoint goes by on this
install. It is the customer config's (`useCustomer()`'s `loaded.value`), not the client's:
`client.config()` answers other things and has no `tables`. The client also signs guests in, opens a guest's own rows, reads free and full times, and
more; see [An app's public access](https://docs.adminium.dev/guides/apps/public-access/) and
[A person and their own rows](https://docs.adminium.dev/guides/apps/identity-and-own-links/).

Until someone allows the app's public access, no key is served and `useCustomer()` answers `error`
with a sentence saying so.

Five things a customer screen needs that the example above leaves out:

- **A list comes in key order unless its entry says otherwise.** An app's public endpoint always
  takes `limit`, `offset` and `cursor`. The rest must be declared in `manifest/access.json`, where
  `n` is the entry's place in the `publicAccess` array:
  - `q` needs text columns in `publicAccess[n].searchable`. Send it from 2 characters.
  - `order` (`'price.asc'`) needs the column in `publicAccess[n].orderable`.
  - `where` (`{ column: 'price', op: 'lte', value: 20 }`, several under `{ and: [ … ] }`, never
    `or`) needs the column in `publicAccess[n].filterable`.
  - `via` (the same shape as `where`) asks about the rows of another list that link to this one,
    such as a product's variants. It needs `publicAccess[n].via`, for example
    `{ "entry": "variants", "on": "product_id", "columns": ["colour", "size"] }`. Every condition
    must hold on one of those rows, and each column must be in that other list's `select`.

  Every other column must be in that entry's `select`. Only an entry with `"methods": ["GET"]`, no
  sign-in and no code may declare these, and `compatibility.minAdminiumVersion` in
  `manifest/app.json` must be `0.3.68` or later. See
  [Filters, search and sort on public lists](https://docs.adminium.dev/guides/apps/shopper-lists/). Anything undeclared is
  refused with `400 PUBLIC_QUERY_REFUSED`: sort or narrow the rows in the screen instead. To keep
  rows out of the public list for everyone, write `publicAccess[n].filters`: that is decided by
  the app, not by whoever calls.

- **`createPublicClient` may return `null`**, when it is given no address or no key. Check for it
  and show a "not connected" line.
- **The venue's clock and money come from the client**, not from `useCustomer()`:
  `await client.config()` gives `timezone` and `currency`, and `await client.now()` gives the
  server's time, so "today" is right on a device whose clock is wrong.
- **A public error's `message` is for developers, not for visitors.** Catch `PublicApiError`, read
  its `code`, and say your own sentence. This is the opposite of the staff side, where the
  server's message is written to be shown.
- **The human check is automatic.** When an entry asks for it (`"humanCheck": true` in
  `access.json`), the client solves it in the background and sends again. Pass
  `humanCheck: { refs: [requests] }` to `createPublicClient` to solve it up front for the endpoints
  you know ask for it, and save the refused first try.

What a public create can and cannot hold a stranger to is in
[Limits on a stranger's create](https://docs.adminium.dev/guides/apps/public-access/#limits-on-a-strangers-create). A rule
you need that is not there, such as "the pickup date is not in the past", can only be checked in
the screen: say so to whoever asked for it.

The public API never takes a card itself, runs a query you write, or runs code of yours on the
server. A customer pays on Adminium's pay page, which a screen opens for a record the app's
`payments.payables` name; the screen then asks how the payment stands (see
[Paying from the app's own customer screens](https://docs.adminium.dev/reference/manifest/#paying-from-the-apps-own-customer-screens)).
What a customer may do is exactly the list the manifest grants.
