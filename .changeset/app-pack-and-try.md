---
'@adminium/server': patch
---

`adminium app pack` checks an app in your project, builds its sides and writes the `.tgz` and its fingerprint that Studio → Hosted apps → Install an app takes, with the sample data inside. `adminium app try` goes one step further and proves the package installs: it starts a throwaway Adminium on an empty SQLite database, installs the package through the same routes Studio uses, opens each side, and asks the public API both for what the app's `access.json` grants and for what it does not. `adminium app check` now also refuses a table that anyone may add to and anyone may read, which an install would refuse part way through.
