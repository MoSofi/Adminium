---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
---

A timed move may now say `"waitsForPayment": true`: while a payment for its row is on its way (the service has said it is processing, or the money is being written down), the move waits and runs the minute after the payment settles, so an unpaid hold never lapses under money that is landing. It waits seven hours at most; later money goes to a person. When a write takes a payable record out of its app's `payableWhen` (cancelled, lapsed, paid another way), any pay page still open for it is ended at its service by a job that tries again while the service cannot be reached, and its pay links are retired; the payments sweep does the same for a page whose write was lost. A state a customer pays in may not be a hold counted by the clock (`capacity.hold.states`). A record found already paid by a run that took over from one that died is announced again, so the app's "paid" mail is never lost (and still sent once). `waitsForPayment` needs Adminium 0.3.59.
