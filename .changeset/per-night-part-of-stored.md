---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

A price by the night can be a part of another row's: `perNight.of: { "via": "stay_id", "column": "room_total" }`. A hotel's credit for the nights a guest did not stay was priced at today's rates, so after a rate change it credited nights at a price the stay never paid. It now comes to what those nights cost the guest: today's price while the stay's rates are unchanged, scaled to what the stay was charged after they changed, and never more than it.
