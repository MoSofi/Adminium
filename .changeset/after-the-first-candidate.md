---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/add-on-contracts': patch
---

Fixed: an app removed with its tables kept and installed again lost track of its sample data, so the sample could no longer be removed with one button. Fixed: an app made with `adminium app new` on a release candidate asked for that candidate as its minimum Adminium; it asks for the release. Installing an add-on whose code decides while a record is saved, from a package nobody vouches for, now says before and after the install that this code will not run. Adminium Designer asks before it builds on an add-on that is in the server's store and not installed, naming how many tables it adds, and the app check warns when a rule takes stock and never gives it back. An add-on's own pages are told the currency of their database (`useAccess().currency`), and the bar at the foot of such a page reaches the page's edges.
