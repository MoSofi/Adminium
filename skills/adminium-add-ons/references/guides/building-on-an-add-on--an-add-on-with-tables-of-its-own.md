<!-- produced from apps/docs/src/content/docs/guides/building-on-an-add-on.md § An add-on with tables of its own; do not edit -->

# Building on an add-on: An add-on with tables of its own

Some add-ons keep their own data rather than a shape for yours: a stock list, gift cards. An app
that names such an add-on can ship [sample rows for its tables](https://docs.adminium.dev/guides/apps/sample-data/#rows-for-an-add-on-the-app-names)
and lets it serve [public entries through the app's key](https://docs.adminium.dev/guides/apps/public-access/#what-an-add-on-adds).
What such an add-on declares, and how it is installed, is in
[Add-ons that keep tables of their own](https://docs.adminium.dev/guides/add-ons-with-tables/).

### Your app's roles on an add-on's tables

An add-on's own roles grant its tables. Your app's roles may too, with
[`tables`](https://docs.adminium.dev/reference/manifest/#a-role-on-an-add-ons-tables), so a waiter reads stock and a
housekeeper writes a transfer without holding a second role:

```json
{ "key": "housekeeper", "name": { "en-US": "Housekeeper" }, "permissions": ["table:@rooms:read"],
  "tables": [{ "addOn": "inventory", "table": "transfers", "actions": ["read", "create"],
               "limit": { "creatable": ["from_place_id", "to_place_id", "note"] } }] }
```

- The grant is made when the add-on is connected to the app and taken back when it is
  disconnected. The install check lists it.
- It gives `read`, `create` and `update` only: no delete, no export, no import, and no limit to
  some rows.
- `limit` narrows the columns for this role. A person who also holds a role with a plain read of
  the same table reads every column: grants add up.

### Printing from an add-on's page

An add-on's own page prints its documents through the
[data kit](https://docs.adminium.dev/guides/add-ons-with-tables/#printing-from-a-page). Your app's screens print a document
of your own tables as in step 6.
