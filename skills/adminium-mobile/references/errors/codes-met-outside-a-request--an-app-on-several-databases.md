<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request — An app on several databases; do not edit -->

# Error codes: Codes met outside a request — An app on several databases

### An app on several databases

| Status | Code | When |
|---|---|---|
| `409` | `APP_INSTALL_AMBIGUOUS` | The app is installed on more than one database and the request did not say which copy. `details.installs` lists each copy you can open: its `installId`, `connectionId`, `connectionName` and `slug`; `details.installedOn` counts every copy, yours or not, and the message says how many of them are yours. Send `X-Adminium-Install`, `?connectionId=`, or the `key~slug` address. The public API never answers this. |
| `410` | `APP_ADDRESS_RETIRED` | The app's plain address belonged to a copy that was uninstalled. Signed in, `details.installs` lists the copies you can open; a browser gets a page with a link to each. Signed out, or with no copy you can open, it names none: "This address moved; sign in to see where." |
| `409` | `CONNECTION_HAS_INSTALLS` | A database connection cannot be deleted while an app is installed on it: "Remove Invoices & Receipts from kiln first." Uninstall the app from it first. |
| `409` | `CONFLICT`, `details.reason: "INSTALL_OWNS_DATABASE"` | The app's own staff screens, or a later copy's, were given the database another copy of the app is installed on. That copy reads it already. In `PUT /surfaces/instances` the same refusal is a `422` issue with code `INSTALL_OWNS_DATABASE`. |
| `409` | `CONFLICT`, `details.reason: "INSTANCE_IS_AN_INSTALL"` | An extra instance asked to be adopted as a copy (`/apps/:key/instances/:slug/adopt`) is one already. |
