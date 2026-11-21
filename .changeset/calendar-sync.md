---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/widgets': patch
'@adminium/add-on-contracts': patch
---

A booking rule can sync each person's calendar (`booking.sync`): bookings go out to their own calendar and their busy times block new ones, by push or a regular read. A new `calendar-provider` contract, a built-in demo calendar and a conformance kit carry it. The desk reads a person's calendar state, busy times and clashes, and can keep a clash. A dashboard card can read a table of an add-on the app names, and count calendar connections (`calendar-connections`).
