<!-- produced from apps/docs/src/content/docs/guides/add-ons/customiser.md § What the app's roles need; do not edit -->

# The Customiser add-on: What the app's roles need

The Customiser draws two panels on the app's records: `customiser-product` on a product, and
`customiser-line` on an order line, where the shop makes the proof and the production files. An
app's role is given what a panel needs in its `roles.json`: the panel's `page:@<panel>:view`, and
the Customiser's tables in `tables` (up to 24 add-on tables a role). A panel that misses a right says
which, and makes nothing.

```json
{ "key": "studio", "name": "Studio",
  "permissions": ["table:@order_lines:read", "page:@customiser-line:view", "page:@customiser:view"],
  "tables": [
    { "addOn": "customiser", "table": "designs", "actions": ["read", "read_pii"],
      "limit": { "rows": { "read": { "reach": "all", "while": { "column": "app", "in": ["maker"] } } } } },
    { "addOn": "customiser", "table": "bases", "actions": ["read"] }
  ] }
```

This is a part of the order-line entry; the full list for each panel and for the set-up page is in
the [Customiser's README](https://github.com/Adminiumjs/add-ons/tree/main/packages/customiser).
Three things to know:

- **How far a role may go.** The Customiser's `appGrants` say the most an app's role may hold of
  each table: the shop's set-up tables may be read and changed, a customer's design only read (with
  `read_pii` for their words, logo and photo), a version and its files made and replaced. Its
  postings and its log of mailed links go to no app's role. An entry that asks for more is cut, and
  the install check says what was cut. Needs Adminium 0.3.47. See
  [What an app's roles may hold of its tables](https://docs.adminium.dev/guides/add-ons-with-tables/#what-an-apps-roles-may-hold-of-its-tables).
- **A limit on `app` keeps each shop to its own rows.** `appGrants` says how far, never on which
  rows. With Maker Shop and Print Shop on one install, a role with no row limit on `app` reads the
  other shop's customers' designs. With it, another app's rows are "not found" to the role.
- **`page:@customiser:view` on a role that makes files**, screens-only roles too. A starter font
  nobody uploaded is read from the file the package ships, beside the set-up page, and only a role
  that may open that page reads it. A screens-only role never sees the page in a menu.

A shop's owner opens the set-up page with a role the app gives `page:@customiser:view` and the
set-up tables: it adds, changes and removes only its own app's rows, and reads the starter fonts
every app shares, but removes none of them. The Customiser's own designer and reader roles reach
every app's rows, for someone who works in the dashboard.
