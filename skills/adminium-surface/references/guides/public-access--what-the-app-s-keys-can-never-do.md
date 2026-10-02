<!-- produced from apps/docs/src/content/docs/guides/apps/public-access.md § What the app's keys can never do; do not edit -->

# An app's public access: What the app's keys can never do

The keys were made in your name from what the install check showed, so they stay that narrow:

- They may hold **GET** and **POST**. **PATCH** only on an endpoint where a guest has signed in
  with a claim and so reaches their own rows alone, or reaches rows only
  [through such a parent](https://docs.adminium.dev/guides/apps/public-access/#rows-reached-through-their-parent), and never on a column Adminium fills in
  itself, such as a copied price, a code, a running number, a total, a stamp of who or when, or a
  late-cancellation flag.
- They never hold **PUT**, **DELETE** or **BATCH**.
- An endpoint where anyone may create a row never also lets anyone read rows.

An edit to one of their endpoints that would add a write method, drop the sign-in, show more
columns, reach more rows, loosen what a guest may write, or loosen the limits on a stranger's
create is refused with `KEY_MANAGED_UNSAFE`. Narrowing it is always allowed. An update of the app
cannot widen it either. Keys you make yourself are not limited this way.
