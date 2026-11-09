---
'@adminium/server': patch
'@adminium/docs': patch
---

`/api/v1/readyz` answers 503 with `checks.packages: "seeding"` until the boot has put the apps and add-ons that come with Adminium in its store, and an app's install check waits for them too: a script that installed an app a few seconds after a first boot was checked against a store still filling, and the install was then refused with "The database changed since this install was checked". When only the app's add-ons moved between the check and the install, the refusal now says so (`details.changed: "add-ons"`) instead of blaming the database. The check's checksum now carries those two parts, so an install checked on an earlier release and sent to this one is refused as a changed database: check it again after the update.
