---
'@adminium/server': patch
---

A staff create may carry a row below it that takes a resource for a time (a table with `occupies` or a booking rule): a batch with its machine booking and the stock it takes, made as one write. The row is placed under its resource's lock, named with the write's other locks, and judged inside the write: a time that is taken refuses the whole write with `BOOKING_TAKEN`, naming the row, and nothing is written. A quote of such a write, a guest's, and a row whose resource or time only a fill gives are still refused one at a time.
