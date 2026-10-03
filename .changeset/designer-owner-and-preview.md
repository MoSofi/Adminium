---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Adminium Designer: who you are, and whose eyes the preview is. The preview's bar says whom it shows ("Seen as: Baker — a preview"; "a visitor, not signed in" for the customer side). "Open in a new tab" opens the staff side inside the dashboard, as staff meet it, and that dashboard says across its top that it is a preview and links to "Open the dashboard as yourself"; a customer page opens as it is, with nobody signed in. The dashboard opened as the owner `adminium design` made, who has no password, offers "Set your password" on the page: an address and a password, the same as `adminium owner set` (`POST /api/v1/designer/owner-password`: only on a `design` server, only for that owner, only once; it never changes a password that exists).
