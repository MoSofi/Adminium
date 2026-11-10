---
'@adminium/server': patch
---

When an app's update starts numbering a column per record (a line's position on its order, a job's place in its order), the rows already there are numbered too: each order's lines with no number take the next numbers after the largest it holds, in the order they were made, and the numbers already there stay. What is worked out from the number (a line's label) follows. Before, lines made by hand before the update stayed without a number. A document's own series (an invoice's number) is not given out after the fact.
