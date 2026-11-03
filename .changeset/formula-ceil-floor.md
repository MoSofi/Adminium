---
'@adminium/manifest': patch
'@adminium/server': patch
---

A formula may round up or down: `{ "ceil": a }` and `{ "floor": a }`, or with places (`[a, places]`, 0–4), beside `round`, worked out on the exact value (`ceil(-1.5)` is `-1`, `floor(-1.5)` is `-2`, `2.000` stays `2`). A print job's sheets are `{ "ceil": { "div": ["qty", "per_sheet"] } }`. An operator's formula rule takes them too.
