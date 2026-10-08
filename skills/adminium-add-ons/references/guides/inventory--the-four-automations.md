<!-- produced from apps/docs/src/content/docs/guides/add-ons/inventory.md § The four automations; do not edit -->

# The Inventory add-on: The four automations

Inventory ships four automations. You find them under **Automations** and can switch each on or
off, or change what it does.

| Automation | Starts as |
|---|---|
| Low stock: draft an order and tell the stock manager | on |
| Expiring within 30 days: tell the stock manager | on |
| Send draft orders at 17:00 | off |
| Send an order 15 minutes after its last line | off |

"Low stock" runs when an item falls to its reorder level; after a save in the dashboard it runs
about a minute later. It puts
the item on a draft order for its first-choice supplier. If another place holds enough, or no
supplier is set, it drafts nothing and tells the manager why. The two daily automations run on the
time zone the server had when Inventory was installed.
