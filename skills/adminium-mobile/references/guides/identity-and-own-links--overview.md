<!-- produced from apps/docs/src/content/docs/guides/apps/identity-and-own-links.md; do not edit -->

# Guests, their details and their own links

[An app's public access](https://docs.adminium.dev/guides/apps/public-access/) covers the basics of a guest's session: a
claim by details, the emailed code, the emailed sign-in link, and a link that opens one row. This
page covers what an app builds on them when guests buy things without an account: a box office
selling tickets that the buyer can send on to a friend.

The running example is a box office with four tables: `customers` (the people who sign in),
`orders`, `tickets` (the rows of an order) and `messages` (its [outbox](https://docs.adminium.dev/guides/apps/emails/)). It
has three browser keys: the guests' key `customer`, and two keys that open one row by its own
link, declared in `publicKeys`:

```json
"publicKeys": { "link": {}, "ticket": {} }
```

`link` opens an order, and `ticket` opens one ticket offered to a friend. Neither names a staff
role, because nobody signs in on them: the link is the credential. The fields are listed in the
[manifest reference](https://docs.adminium.dev/reference/manifest/#public-access).
