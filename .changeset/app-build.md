---
'@adminium/server': patch
---

`adminium app build` builds the screens of an app in your project. Each side in `apps/<key>/staff/` or `apps/<key>/customer/` is bundled with the project's esbuild, starting at `src/main.tsx`, into `.adminium/build/apps/<key>/<side>/`: a page with no inline script, its script and stylesheet with a hash in their names and addressed under the side's own mount, and `surface.json` for the dashboard's sidebar when the side has a `nav.json`.
