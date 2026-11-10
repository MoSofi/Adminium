<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § What an app's roles may hold of its tables; do not edit -->

# Add-ons that keep tables of their own: What an app's roles may hold of its tables

An app that names the add-on may give its own roles a hold on the add-on's tables: a hotel's
housekeeping adds stock transfers, a sales team reads what is in stock. Those rows are the
add-on's, and another app may use them too. So the add-on says how far an app's role may go, table
by table, with [`appGrants`](https://docs.adminium.dev/reference/manifest/#what-an-apps-role-may-hold-of-an-add-ons-table):
which actions, and which columns it may read, change or fill in.

```json
{ "ref": "items", "columns": [ … ],
  "appGrants": { "actions": ["read"], "never": ["cost_avg", "supplier_cost", "value"] } }
```

- **Say it for every table an app may use.** Once one table has it, a table without it is given to
  no app's role.
- **Name what an app may write.** `writable` and `creatable` are lists, never "every column". Leave
  out what decides where something is sent or what it costs: a supplier's address, a price.
- **Keep back what only your own staff should read** with `readable` (the only columns) or `never`
  (every column but these). A secret is never read either way.
- An add-on that says nothing is held only by its own shape, as before: no hold on a ledger's
  receipt table, read only on a table its ledger writes. Add `appGrants` in a release that asks for
  Adminium 0.3.28.

What an app asks for past it is left out and named. As the owner, you see each role's hold with its
columns on the install check, under the add-on's row ("…'s roles get 6 of its tables"). An app
update that would let its roles do more with an add-on's tables shows what is new and asks before
it is given. An add-on update that narrows its `appGrants` narrows what the apps' roles hold at
once; one that widens them lists each app's role that would get more, and asks before it is given
(Studio's **Update** button allows it; through the API, `"roleTables": true`, or the update is
refused with `ROLE_TABLES_WIDER`).
