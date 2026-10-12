---
'@adminium/server': patch
---

The Designer looks at the page again after it builds. When it built the screens and then applied the app, which is what it does in almost every turn, it waited half a minute for the preview and then finished without having seen the page, so it could say a change was made when nothing looked different. The picture it is shown is also right now on a page whose sections are sized by the window's height. A file edit that changes nothing is no longer reported as an edit, and the Designer no longer tells you to refresh the preview.
