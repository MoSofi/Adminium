---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/desktop': patch
'@adminium/i18n': patch
---

"Put this online…" opens adminium.dev/deploy in the browser: in the user menu, on the Export everything page, on About, and in the desktop app's Help menu. An operator hides it everywhere with the new `ADMINIUM_DEPLOY_LINK=off`; `/api/v1/system/info` gains `deployLink`.
