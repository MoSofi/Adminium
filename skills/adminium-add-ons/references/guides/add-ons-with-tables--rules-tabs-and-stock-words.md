<!-- produced from apps/docs/src/content/docs/guides/add-ons-with-tables.md § Rules, tabs and stock words; do not edit -->

# Add-ons that keep tables of their own: Rules, tabs and stock words

Three more things are declared, not coded:

- **Rules it ships** ([`automations`](https://docs.adminium.dev/reference/manifest/#automations)): installed with the
  add-on and shown on the rules page under "From your add-ons", where the owner switches them or
  edits a copy.
- **A tab on another table's record** ([`addOn.recordTabs`](https://docs.adminium.dev/reference/manifest/#a-tab-on-another-tables-record)):
  the add-on's rows for a dish, a product or an order, listed on that record's own page. Where the
  add-on needs its own code there, it declares a [panel](https://docs.adminium.dev/guides/add-ons-with-tables/#a-panel-on-another-tables-record).
- **Stock words** ([`addOn.words`](https://docs.adminium.dev/reference/manifest/#stock-words)): "in", "low" or "out" for
  each row a page asks about, answered by the ledger's code with nothing written. Answer each line
  by itself: a page asks about many rows at once, and one row's answer must not depend on the
  others in the same question.
