---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/widgets': patch
'@adminium/public-client': patch
---

A booking rule can now keep a buffer after each visit, block the times a person is away (time off, or a calendar table only Adminium writes), share "anyone" evenly and flag who it picked, cap a person's hours by the studio's, and hold only guests to the booking window. A strip of days reads its days once, and names the window's last day. Hours a booking rule reads must be a time of day. A guest may not change who they see inside the cancellation window. A dashboard can ask how booked each person is (`booking-occupancy`).
