---
'@adminium/server': patch
---

When turning on People in an add-on that finds companies is refused, the refusal now also lists what is missing as data (`details.problems`), each by a stable code: `purpose-missing` (with the languages it is missing in), `keep-time`, `smtp`, `public-origin`, `mail-door`, `privacy-notice`, `tell-outbox` and `tables`. The add-on can say each one in its reader's language and link to where it is put right; the English message stays as it was.
