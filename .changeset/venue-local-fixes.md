---
'@adminium/server': patch
---

**Fixed: times on a venue-local column no longer shift by the server's time zone.**

A booking saved from the dashboard, and a sample time, on a column read on the venue's clock
landed off by the difference between the server's zone and the venue's on SQLite and MySQL. Both
now keep the time the person chose.
