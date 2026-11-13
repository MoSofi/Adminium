---
'@adminium/server': patch
'@adminium/meta': patch
'@adminium/dashboard': patch
---

A fresh server now asks for a one-time setup token before anyone can create its first account. Adminium prints it in its log at every start until that account exists (`Setup token: XXXX-XXXX-XXXX-XXXX`), or you choose it with `ADMINIUM_SETUP_TOKEN`. The desktop app, and `adminium dev`, `design` and `try` on this computer only, do not ask; `adminium start` always does. Whether a server asks is decided when it starts, never by what the meta store holds: a server that asks refuses every setup call when the token's record is missing instead of letting it through, and after the wizard moves or adopts a meta store, the restarted server puts a token in the new store and prints it. A link that hands the token over carries it after `#` (`/setup#setup-token=…`), so it reaches no server or proxy log; it works on any address of the server, such as its home page or the sign-in page, and the wizard opens with the token filled in and removes it from the address bar.
