---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/manifest': patch
'@adminium/i18n': patch
---

"Start with an app" in Adminium Designer now shows each app's real screenshot instead of a placeholder, with a link to the app's demo on adminium.dev (or to its page there when it has no demo). The server fetches the screenshot from adminium.dev, keeps it, and serves it to the page. It does this only while the online app list is on, and it fetches only addresses on adminium.dev under `/shots/` or `/covers/`. If a picture cannot be loaded, the card falls back to the app's icon.
