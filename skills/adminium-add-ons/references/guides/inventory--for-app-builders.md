<!-- produced from apps/docs/src/content/docs/guides/add-ons/inventory.md § For app builders; do not edit -->

# The Inventory add-on: For app builders

An app's table takes stock through a posting into Inventory's ledger `stock`
(see [Rows that post into a ledger](https://docs.adminium.dev/guides/apps/postings/)). Five actions are for a host's rows:

| Action | For | What it writes |
|---|---|---|
| `use` | a row whose record has a Stock tab (a line of a dish, a treatment) | takes what the linked items and kits say, for the row's quantity |
| `hold` | the same, before the sale is final | holds the stock; a later `use` takes what was held |
| `use-item` | a row that names an item itself | takes that item |
| `return` | a row that gives stock back | puts it on the shelf again, or into another place |
| `adopt` | a row that should be a stock item itself (a product, a dish) | makes an item with the row's name and links the row to it; nothing when the row already has one |

Two ids answer "is there enough?" before a save, for a public page or a till
(see [Building on an add-on](https://docs.adminium.dev/guides/building-on-an-add-on/)): `stock`, for a row with a Stock tab,
and `item`, for an item. Each answers yes or no and, when you set "Show customers what is left
below" in the settings, how many are left under that number.

An app's own sample data may add rows to Inventory's catalogue (items, kits, places) and name the
rows of Inventory's sample by their labels: `item:<SKU>`, `kit:<name>`, `place:<name>`,
`batch:<code>`, and the seeded `unit:<code>` and `reason:<name>`.
