---
'@adminium/add-on-contracts': patch
'@adminium/manifest': patch
---

An add-on can now name the kind of table its record action is for: a `record.actions` slot fill with `on: "companies"`, a `label` (and `labels` in other languages) and an `icon` is shown by Adminium's own record page on tables declared as companies (the new `addOn.slots.on` word). A source in `addOn.sources` can now carry its name as people read it (`label`, `labels`), used where Adminium says which source filled a field.
