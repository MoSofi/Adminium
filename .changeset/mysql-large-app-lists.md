---
'@adminium/meta': patch
'@adminium/server': patch
---

**On a MySQL meta store, a large app no longer stops every app being served.** Installing an app with a large manifest beside another app, such as Client Portal 0.2.1 beside Point of Sale, failed with 500 "Out of sort memory", and the install was left half done. From then on the apps and add-ons lists answered 500, and after a restart no installed app was served at all. MySQL's default sort buffer (256 KB) could not hold a manifest that size while it sorted the list. The lists now sort without carrying the manifests, in the same order as before, on every database, whatever the size of the apps.

The assistant's sweep of sessions a browser left open had the same trouble on MySQL once a draft or conversation grew large, and now lists them the same way.
