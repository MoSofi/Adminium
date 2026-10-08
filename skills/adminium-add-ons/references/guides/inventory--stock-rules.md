<!-- produced from apps/docs/src/content/docs/guides/add-ons/inventory.md § Stock rules; do not edit -->

# The Inventory add-on: Stock rules

**Stock rules** lists the rules that take stock when a row of a table changes: "when an order line
is created, take what it uses", "when a booking is cancelled, put it back". An app that builds on
Inventory brings its own rules; you can add rules for your own tables there too. Switching a rule
off stops it taking stock from that moment on. Rows saved while it was off are not caught up later.
Changing a rule changes what a table means, so it needs the right to change the schema
(`system:schema:remap`); the manager role alone reads the rules and cannot change them.
