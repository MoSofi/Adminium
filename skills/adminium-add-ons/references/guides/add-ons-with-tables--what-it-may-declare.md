<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § What it may declare; do not edit -->

# Add-ons that keep tables of their own: What it may declare

- **Tables**, always under the add-on's own prefix: the add-on `stock-kit` makes `stock_kit_items`,
  never `items`. A table of yours that already has one of those names is never renamed or changed:
  the check says so and the install stops.
- **Pages** in the dashboard, generated ones and screens of its own code, in a section of the
  sidebar that carries the add-on's name.
- **Roles** that open those pages and tables. Whoever installs the add-on is given its first role,
  so they can open what they just installed. Nobody else gets one until you assign it.
- **Lists of choices** for its columns, **document layouts** for its rows, **emails** it sends from
  a table of its own, and a few **starting rows** (units of measure, reasons, its one settings row).
- **Public entries**, described [below](https://docs.adminium.dev/guides/add-ons-with-tables/#what-it-opens-to-the-public).
