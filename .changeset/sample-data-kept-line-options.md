---
'@adminium/server': patch
---

Removing an app's sample data no longer strips the chosen options from the
lines of a sample order your own records use. A removal keeps a sample record
your records use, with its lines, but it deleted the rows those lines add up:
in Online Ordering, a kept order's lines lost the options their price counts
("Oat milk", "Extra shot"), so the order no longer showed what was ordered,
and its line prices no longer matched what was left.

A kept record now keeps the rows its lines add up, as well as the lines. When
the sample is added again they come back with it, as they are, and the sample
writes none beside them. An option you changed stays yours. This reaches only
a record's own parts: a kept customer still lets go of the sample orders its
count adds up.
