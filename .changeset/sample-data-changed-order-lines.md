---
'@adminium/server': patch
---

Adding an app's sample data again no longer leaves an empty order beside one
you changed. A sample order your own records use stays after a removal, with
its lines; once you change it, it is yours, and the next add writes the
sample's order again. But the lines of your order were taken back into the
sample by their names, still under your order, so the sample's fresh order
had no lines and totals of zero (in Online Ordering, a fresh #2107 with
nothing on it).

A record's lines, and what those lines add up, now come back only with their
record. When the record stays yours, so do its lines, and the sample writes
its own record whole.
