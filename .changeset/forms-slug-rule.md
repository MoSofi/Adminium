---
'@adminium/add-on-contracts': patch
'@adminium/server': patch
---

A form's slug rule is shared: `@adminium/add-on-contracts/forms` exports `FORM_SLUG`, `FORM_SLUG_MAX`, `FORM_SLUGS_RESERVED` and `isFormSlug(slug)`, which the engine's door and a forms add-on's builder both hold a slug to. `api` and `surveys` are reserved: a form with either slug is never served.
