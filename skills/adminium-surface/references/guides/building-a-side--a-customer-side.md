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
  // client.list(items, { order: 'id.desc', limit: 20 })   → { data: rows }
  // client.create(requests, { message })                  → the new row, as far as `select` shows it
  return null;
}
```

`config.tables` maps each table's short name to the name its public endpoint goes by on this
install. The client also signs guests in, opens a guest's own rows, reads free and full times, and
more; see [An app's public access](https://docs.adminium.dev/guides/apps/public-access/) and
[A person and their own rows](https://docs.adminium.dev/guides/apps/identity-and-own-links/).

Until someone allows the app's public access, no key is served and `useCustomer()` answers `error`
with a sentence saying so.

Four things a customer screen needs that the example above leaves out:

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

The public API does not take payments, run a query you write, or run code of yours on the server.
What a customer may do is exactly the list the manifest grants.
