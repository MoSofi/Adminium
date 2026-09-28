---
'@adminium/server': patch
---

On Postgres, a record that takes the next number of a series without gaps (an invoice number) while another save holds that series — a long import, say — now waits at most ten seconds and is then answered 409 `NUMBER_BUSY` ("Another record is taking the next number. Try again in a moment."), as it already was on MySQL and for every other lock a save waits for. It used to wait until the other save finished, however long that took, holding a database connection all the while.
