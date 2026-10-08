<!-- produced from apps/docs/src/content/docs/guides/apps/discounts-and-codes.md § When the add-on cannot be asked; do not edit -->

# Discounts, codes and refunds worked out by Adminium: When the add-on cannot be asked

| The add-on is… | A save that would ask the price |
|---|---|
| not installed, or not connected to this app | saves at the order's own price; only a typed code is refused |
| switched off for the rule by the owner | the same: nothing is asked, only a typed code is refused |
| connected but switched off for the app, being updated, or its code cannot be loaded | refused (`POSTING_REFUSED`, reason `add-on-unavailable`), an order with no code included |

Money fails closed: an order is never saved at a price nobody worked out. The owner's switch is the
way through.
