---
'@adminium/server': patch
'@adminium/manifest': patch
---

A column may be required for some values of another (`requiredWhen`) and also be filled by a copy that only fills what a write leaves out (`copy` with `mode: "default"`, without `follow`). The copy runs first; the column is asked for only when there was nothing to copy either, so an order sent by email needs an address: its supplier's, or one typed on the order. An add-on's settings table (`addOn.settingsTable`) now counts as a one-row table a rule may read a setting from, even when it links to other tables.
