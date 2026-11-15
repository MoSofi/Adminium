---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

A payment taken online for an app's record is now written down as the app says. A record is payable online only while it meets the app's `payableWhen`; a payment that arrives outside it is never written into the app and waits for a person, while staff may still record a payment by hand. The paid status moves only from the states the app names (`status.from`, and `status.refundedFrom` for a full refund), by the app's own move, so a move only some roles may make is made. That write is now announced like any other, so the app's own "paid" mail, its live screens and its rules hear of it. A lock another write holds is tried again rather than given up, and a record whose table will not let it move to paid is written down and shown in Payments → Activity as "Paid and recorded, but … did not move to its paid state", never only logged. The payment row also gets the service it was taken by, the moment paid, a terminal's approval code and last four, and the currency, in the columns the app names. An app's invoices built on the Invoices shape take online payments only once someone who manages payments switches the app on.
