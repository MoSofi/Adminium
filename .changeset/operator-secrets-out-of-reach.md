---
'@adminium/server': patch
---

The server now takes `ADMINIUM_SECRET`, `ADMINIUM_SETUP_TOKEN`, `ADMINIUM_ARCHIVE_KEY`, every `ADMINIUM_AI_*` variable, `ADMINIUM_FIGMA_TOKEN` and the picture sites' keys (`PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`, `PIXABAY_API_KEY`) out of its process environment once it has read them at start, and every program it starts (an app's tests, an app's own build, package installs, git, the browser) is given a short, named environment instead of a copy of its own. A project hook or config that reads one of these variables from `process.env` after the server started now gets nothing; give it a variable of its own.
