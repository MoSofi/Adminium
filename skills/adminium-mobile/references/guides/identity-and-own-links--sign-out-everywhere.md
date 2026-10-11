<!-- produced from apps/docs/src/content/docs/guides/apps/identity-and-own-links.md § Sign out everywhere; do not edit -->

# Guests, their details and their own links: Sign out everywhere

A guest who thinks someone else read their mailbox presses **Sign out everywhere**:
`POST /api/v1/public/session/revoke-all`, with `signOutEverywhere()` in the client.

- Every session of the person ends, this one too.
- Every sign-in link still open to their address is taken back.
- The other devices are told why on their next request ([below](https://docs.adminium.dev/guides/apps/identity-and-own-links/#when-a-session-was-ended)).
- A row's own link is not a session of the person's, and keeps working. To stop one, use
  [Make a new link](https://docs.adminium.dev/guides/apps/identity-and-own-links/#make-a-new-link).

It needs a verified session of the person, signed in by email: a lookup session is refused `403`
`PUBLIC_CLAIM_LEVEL`, and a row's own link `403` `PUBLIC_CLAIM_UNAVAILABLE`.
