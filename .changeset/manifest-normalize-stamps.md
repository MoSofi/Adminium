---
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

A few more words an app's manifest may use:

- `rules.normalize`: a text value stored trimmed (`trim`), or trimmed and in
  lower case (`email`), whoever writes it — so an address kept unique and a
  person signing in with it agree on every database.
- A stamp may copy another column of the same row as it stands when the stamp
  is written (`{copy: <column>}`), and a `byOrigin` stamp may leave staff
  their own choice by naming only the public side's value.
- A public entry's `writableWhen` may say a date is `before-today`.
- An app may ship up to 32 email templates.
