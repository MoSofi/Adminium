---
'@adminium/server': patch
---

A project can now hold an app of your own in `apps/<key>/`, and `adminium app check` checks it without starting anything. The app's manifest may be written as one `manifest.json` or as a `manifest/` folder of small files — one per table, one per page, and one per block such as roles or public access — which Adminium puts together into the same document. The check validates it exactly as an install does and names the file and field of each problem, checks that every side the manifest declares has its code and that the sample data fits the tables, and lists what the customer side may reach. `--split` rewrites a single `manifest.json` as parts.
