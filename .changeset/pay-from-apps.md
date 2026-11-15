---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/public-client': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

An app's own screens can now take payments online. `GET /api/v1/public/payments/available` answers whether the key's app takes payments online right now (switched on in Payments → Apps, a payment service live, the pay address reachable, payments allowed by the operator), and nothing else. `POST /api/v1/public/payments/start` with `{ ref, id }` answers the pay link of a record the visitor can already read through that entry, with the same 404 as a read for a record that is not theirs; it always owes a `pay-start` proof, uses the record's own amount, reuses the record's current live link, and is refused `409 PUBLIC_PAY_REFUSED` (`params.reason`: `off`, `nothing-due`, `not-now`, `not-payable`). A public create entry that says `"pay": true` (of one of the app's payable tables, behind the human check) answers the new row's `payUrl` in its first reply, never in a replay; an endpoint made in the builder that says `pay` must be a single create, behind the human check when anyone may make it; an app update that newly makes an entry answer pay links is asked like any other widening. The pay page offers "Back to {app}" once a visit is over, to the app's own customer address and the path its payable names (`returnTo`). The public client has `payments.available()`, `payments.start(ref, id)` and `payUrl` on a create. `pay` needs Adminium 0.3.59.
