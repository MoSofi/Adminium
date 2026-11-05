---
'@adminium/server': patch
---

Someone who opens only their app's screens may load a record panel of an add-on connected to their app (`GET /api/v1/add-ons/<add-on>/panels/<panel>/bundle`: a design kit's panel on an order line). It was refused with `APP_SCREENS_ONLY`. The route still serves the code only for a row they reach, with a grant on the panel's table and the panel's own permission; an add-on none of their apps uses stays refused.
