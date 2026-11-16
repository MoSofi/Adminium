---
'@adminium/manifest': patch
'@adminium/server': patch
---

A public entry may be open only while the app takes payments online for its table, or only while it does not: `publicAccess[].requirePayments: "on" | "off"` (Adminium 0.3.62 and later), judged as `GET /public/payments/available` answers it, beside `requireSetting`. A hotel that asks guests to pay as they book opens its paying entry with `"on"` and its unpaid one for "required" with `"off"`, so no caller books unpaid while paying is required and possible, and none is held to pay while it is not. Refused as a switched-off setting is (`403 PUBLIC_SWITCHED_OFF`). Only on a create of one of the app's payable tables; a left-out part that takes the payable away opens the `"off"` entries and drops the `"on"` ones. Save as app now also keeps a `requireSetting`'s `in`.
