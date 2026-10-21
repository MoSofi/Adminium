---
'@adminium/desktop': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

The desktop app's menu now says "Adminium" instead of "@adminium/desktop" (in "Hide" and "Quit", for example). Its data and logs stay in the same folders, so nothing moves. "About Adminium" now works on the Start screen and in an open project: it shows the version and offers "Check for Updates…". On macOS, "Check for Updates…" has moved from Help to the Adminium menu, under About. A check started from the menu always gets an answer: you're up to date, an update to download and install, or the check failed. The menu and these dialogs now follow the app's language on the Start screen too, where they used to stay in English.
