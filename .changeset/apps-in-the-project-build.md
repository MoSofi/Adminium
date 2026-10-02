---
'@adminium/server': patch
---

`adminium build` and `adminium check` now include the apps in your project. Each `apps/<key>/` is checked, its manifest is put together into `.adminium/build/apps/<key>/app.json`, and its screens are built beside it. An app with a problem is listed with the problem and fails the command (exit 2); the rest of the project still builds. A change under `apps/` makes the build stale, like a change to a hook or a page. An app that runs from the project folder is marked "From this project's folder" in Studio, and a package may not be uploaded under its key.
