---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Adminium Designer's preview: the app being built, beside the chat, as its people will see it — the dashboard with the app's own pages, the staff side and the customer side (a side the app does not have is not offered), at desktop, tablet or phone width. It is served on the preview's own host name and signed in as a user that holds only the app's roles; its session cookie is made for a frame on another site. It reloads when the app is applied again, says when a side is building, and when a side did not build shows the first error with "Ask the Designer to fix it". "Open in a new tab" opens it on its own. The dashboard's app frame can now be pointed at another address and speaks only to that address's origin.
