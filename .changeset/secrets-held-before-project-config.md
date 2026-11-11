---
'@adminium/server': patch
---

The operator's secrets now leave the server's process environment before a project's `adminium.config` is loaded, not only once the server is built, so the project's own code never finds them there. The server still uses them as before, including the ones read from the project's `.env`.
