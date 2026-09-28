---
'@adminium/server': patch
---

A guest signed in by an emailed link can now read their own details. Reading "my details" answered 503 when the details showed the guest's email address or first and last name, which are masked as personal data, although changing the same details answered them in full. The guest's own row is now shown as it is to the session their sign-in link (or a confirmed emailed code) opened, whether it is read as a list, read by id or answered after a change; nobody else gains anything from it: another signed-in guest, a guest found by what they know who has not confirmed the emailed code, an order's own link and a visitor who is not signed in still read none of it. A change's answer never shows more than a read of the same row would.

An app, or an endpoint made in Studio, that shows a column masked as personal data to signed-in guests none of whom have proved the mailbox is now refused where it is written, naming the column, instead of answering 503 to the first guest who asks: a guest's own records need the `verified` level, and a sign-in by a looked-up detail needs `verified` too, unless the sign-in is an emailed link.
