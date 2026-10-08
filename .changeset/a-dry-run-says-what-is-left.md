---
'@adminium/server': patch
---

A dry run of a payment whose amount Adminium decides (a gift card paying part of an order that is already there) answered `payment.due` as what was due before the payment. It now answers what would be left after it, as the save does: a desk's "Check" reads "$19.00 from this card · $10.23 still to pay".
