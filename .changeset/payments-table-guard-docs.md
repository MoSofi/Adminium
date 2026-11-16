---
'@adminium/server': patch
---

The manifest reference now says exactly what the payments table's guard holds: a row taken online is the payment's whole (nobody changes its service, approval code or last four), the reference and `refundedElsewhere` are Adminium's on any row, and a payment recorded by hand keeps its approval code and last four as its person wrote them. A test proves the online row's card details are refused to everyone and the hand payment's are its person's.
