---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

An app's state rules say a few more things. A late move may carry a `where`: only a move whose row meets it is judged, so a hotel's cancellation by the house is never marked late, even inside the window, and a late flag sent for it is dropped. An `onlyLater` entry may be `{ "column": "depart", "in": ["in_house"] }`: the date moves only later while the row is in one of those states, so a stay in the house cannot be shortened by a change of its departure while a booked one still can. A table may set off up to 8 effects (was 4), and an app may list up to 64 public entries (was 32).
