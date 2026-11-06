---
'@adminium/dashboard': patch
'@adminium/server': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/i18n': patch
'@adminium/docs': patch
---

Save workspace puts one app per database of a workspace into a single file, with one review of every app's choices and a fingerprint for the file and each app inside. Uploading it opens one review: choose a database for each app, create or add to a workspace (for people who manage connections), and unfold each app's own review. A newer app in the file updates every copy already installed. An app that is refused does not stop the others, and an install that stops part way waits on Hosted apps with Install the rest, even after a reload. `adminium workspace list` and `adminium workspace save` do the saving from the command line. A workspace file holds up to eight apps and 128 MB, and an older Adminium refuses it with the version it needs.
