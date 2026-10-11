<!-- produced from apps/docs/src/content/docs/guides/apps/identity-and-own-links.md § Keeping a session; do not edit -->

# Guests, their details and their own links: Keeping a session

### Reads for a signed-in guest alone

Some rows are for anyone who has signed in, but belong to nobody: the box office's settings,
payment instructions. An entry with a `level` and no `claim`, `claimedBy` or `visibleWith` is such
a read:

```json
{ "table": "settings", "methods": ["GET"], "level": "verified", "select": ["offer_hours"] }
```

- It answers `404` `PUBLIC_REF_NOT_FOUND` with no session, and `403` `PUBLIC_CLAIM_LEVEL` to a
  session below its level.
- It is not listed in `/public/config`, so a visitor who has not signed in does not learn it
  exists.
- It only reads, lists what it shows in `select`, and needs a key that signs people in. On a key
  whose sessions are all verified (an emailed link, or a row's own link) it says `verified`.

### Across a reload

A page that reloads loses its client, and with it the session. `@adminiumjs/public-client` lets
the page keep it:

```ts
const kept = sessionStorage.getItem('session');
const client = createPublicClient({
  baseUrl,
  publishableKey,
  session: kept === null ? undefined : JSON.parse(kept),
  onSessionChange: (session) =>
    session === null ? sessionStorage.removeItem('session') : sessionStorage.setItem('session', JSON.stringify(session)),
  onSessionEnded: (reason) => showSignedOut(reason),
});
```

- `session()` answers `{ token, level, expiresAt }`, or null.
- `onSessionChange` is called whenever the session is opened, adopted, raised, ended or dropped
  (then with null).
- A `session` option already past its `expiresAt`, or with no token, is not held.
- `signOut()` ends a kept session on the server too, and drops it locally whatever the server
  answered.

### The server's clock

A guest's phone can be hours out. `/public/config` carries `now`, the server's clock when it
answered, and is never cached (`cache-control: no-store`). `client.now()` answers the device's
clock set right by the difference the config showed, so a page asks for the venue's today, not
the phone's. The staff and customer `surface-config.json` carry `now` too.
