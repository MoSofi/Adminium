---
'@adminium/server': patch
'@adminium/dashboard': patch
---

A new switch, `ADMINIUM_PRESENCE=on`, has the dashboard send `GET /api/v1/presence` once a minute while its tab is visible and its person moved, typed or scrolled in the last five minutes, so an operator whose proxy puts idle instances to sleep counts someone reading a page as using it. The route answers signed-in staff with an empty 204 and reads nothing; `/system/info` says whether the dashboard sends it. A hidden tab sends nothing. Unset, nothing is sent and the dashboard does not load the code.
