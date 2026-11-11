---
'@adminium/server': patch
---

A fresh server now asks for a one-time setup token before anyone can create its first account. Adminium prints it in its log at every start until that account exists (`Setup token: XXXX-XXXX-XXXX-XXXX`), or you choose it with `ADMINIUM_SETUP_TOKEN`. The desktop app, and `adminium dev`, `design` and `try` on this computer only, do not ask.
