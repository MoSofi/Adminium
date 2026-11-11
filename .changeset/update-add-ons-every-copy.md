---
'@adminium/server': patch
'@adminium/dashboard': patch
---

Updating an app that needs a newer add-on works from the dashboard again. The update's check shows the add-on on an **Add-ons** card with **Update it too** ticked and sends it (before, the update was refused asking for a tick that was never shown). On a server with an add-on copy on each of two databases, **Update** on the Add-ons page now updates every copy in turn, each check naming its database, instead of failing with "installed on 2 databases"; an app's update whose add-on still runs an older version on another database says to update every copy first; and an app's "Update it too" moves the copy on its own database instead of stopping part way.
