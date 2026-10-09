---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/i18n': patch
---

Sample data ticked at an app's install now also loads the sample data of the add-ons that install put in, after the app's own. Before, an add-on's sample was a second step under Add-ons that nothing on the install screen mentioned, and the app's rows that point at it (a clinic's kits, for one) stayed out until then. An add-on that was already installed is left as it is, and the install screen says so. `POST /apps/:key/sample-data` takes an optional `addOns` list for this; it refuses an add-on the app does not name.
