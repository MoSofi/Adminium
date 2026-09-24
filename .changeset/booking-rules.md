---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/public-client': patch
---

**Apps can take bookings against people's hours, not just seats per slot.**

A table may carry a booking rule: the practice's opening hours and breaks, each person's own hours,
closures (for everyone or one person), how many days ahead and how much notice, the slot grid, and
which kinds of visit each person offers. Every write — a guest's, the desk's, an import's — is held
to it on the venue's clock, and two people booking the last time at once get one booking. "Anyone"
picks the first person free in the app's order. Availability answers free or full per time, and a
strip of days open, full or closed; a person moving their own visit is not blocked by it
(`exclude`). A cancellation inside the notice window is flagged on the row, and a guest cannot move
a visit that late. `@adminium/public-client` gains `bookingTimes()` and `bookingDays()`.
