---
'@adminium/server': patch
---

The links Adminium puts in a form's bells, staff e-mails and limit alert now open the forms add-on's own page, whose ref is the add-on's key: `/add-ons/<key>/<key>/<slug>/answers?answer=<id>`, `/add-ons/<key>/<key>/surveys/<slug>/results?answer=<id>` and `/add-ons/<key>/<key>/<slug>?settings=limits`. A survey's link named a page ref (`surveys`) no add-on keyed `forms` may declare, so it opened "No such page".
