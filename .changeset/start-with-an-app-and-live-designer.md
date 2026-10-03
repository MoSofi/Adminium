---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/i18n': patch
'@adminium/llm': patch
---

Adminium Designer: "Start with an app" on its home page. A published app is installed as it is (Studio's own install, opened on that app) or made your own: its source copied into the project under a key and a name you give, renamed wherever the old key was written, and built with the app's own build once you approved the command's exact words (`adminium app approve-build`). And the Designer on a server people reach: off until the operator sets `ADMINIUM_DESIGNER=live` and a Super Admin switches it on in Settings → AI with their password; it has no preview there. The folder check now judges an app's public access as an install does. In a copied app the Designer asks before it changes a file the app's build runs, and it never writes a `build.json`. Switching the live Designer off stops the turn that is running, a wrong password at the switch and every answered card are in the audit log, and on a live server the Designer uses the models the server has. A model provider's redirect is never followed.
