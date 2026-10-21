---
'@adminium/desktop': patch
---

The desktop app now carries the AI allow-lists, so Milo, the page assistant, works in it: before, the app's server started with no assistant at all ("Route GET:/api/v1/assistant/availability … not found"). It also carries the sample database seed, like the npm package. A desktop build now stops if any of these, or the Designer's skills and styles, is missing from the app.
