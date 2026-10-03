---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/llm': patch
'@adminium/manifest': patch
'@adminium/meta': patch
'@adminium/i18n': patch
---

Adminium Designer, tuned on real models. A new app starts bare, named from what was asked. The Designer builds on an add-on's shape from the add-on's own manifest (`build_on_shape`), is sent back to check errors it left and told once about a table nobody can open, asks a model's server again after a passing failure, and asks for a screen's packages at the version this server knows. A turn may use 1,500,000 tokens and a session 15,000,000 (`designer.turnTokens`, `designer.sessionTokens`). A screen that stops with an error when it opens says so in the preview. The app's tests, and any file in `hooks/` or `actions/`, wait for the person's yes; an app's own screens are served only on the preview's address while the Designer runs; a connection test sends a saved key only to the address it was saved for; and the link `adminium design` prints is good for fifteen minutes.
