---
'@adminium/server': patch
---

The Designer can now add the packages an app's screens need (React, Tailwind, the icon set, a font) to a project that has no `package.json`. A trial's or hosted installation's project is made with none, so npm took the nearest folder above with a `node_modules` as the project: in the image that is `/`, and the install failed there with `Tracker "idealTree" already exists`. The first customer or staff side of such an installation was written and never built. The Designer now writes a `package.json` that lists nothing into the project before it installs, and never over one that is there.
