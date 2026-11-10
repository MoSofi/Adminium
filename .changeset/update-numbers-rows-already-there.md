---
'@adminium/server': patch
---

When an app numbers a column per record (a line's position on its order, a job's place in its order), every update of the app now numbers the rows that have no number yet: each order's lines without one take the next numbers after the largest it holds, in the order they were made, and the numbers already there stay. What is worked out from the number (a line's label) follows. This also reaches lines added by hand under an earlier version, though the update does not change the rule. A document's own series (an invoice's number) is not given out after the fact.
