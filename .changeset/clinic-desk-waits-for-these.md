---
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
---

Four things an app that builds on an add-on needed.

- A link into an add-on's table may take its default from the app's settings row, when the settings column links into the same table (`rules.default` beside `rules.addOnLink`). The default is left empty, and no save is refused, while the add-on is not connected.
- A role's limit may say which rows its update reaches, by what a column holds now (`writableFrom`): a clinician moves a visit along until it is seen, and cannot take a seen visit back. Judged on the stored row, through every way of changing a record.
- Someone who opens only their app's screens can ask the stock words of an add-on connected to that app ("3 left", the batch about to expire).
- An app's sample may hold the rows that link its records to an add-on's ("this visit type offers the flu kit"), and they are removed with the app's sample. What an add-on's ledger counts is still the add-on's to write.

A manifest that uses the first two sets `minAdminiumVersion` to 0.3.19 or later.
