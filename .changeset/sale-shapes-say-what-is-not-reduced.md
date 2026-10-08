---
'@adminium/manifest': patch
'@adminium/server': patch
---

A shape's part can say what its rows are to a price rule on the same table: `inAdjust` names the column that marks a row which takes no reduction (a gift-card load) or is something sold that pays later (a voucher). When Adminium Designer adds such a shape to an app's lines, or adds the price rule to lines that already carry one, it writes `excludes` or `paidBy` on the rule's line, so a discount for the whole order no longer comes off a card load.
