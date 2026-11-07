<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request — The app's page; do not edit -->

# Error codes: Codes met outside a request — The app's page

### The app's page

| Status | Code | When |
|---|---|---|
| `409` | `AFTER_INSTALL_NOT_DONE` | **Hide** on the After you install list while something on it is still to do. `details.open` counts them. |
| `403` | `FORBIDDEN`, `details.reason: "AFTER_INSTALL_RIGHT"` | Ticking an after-install item by someone without the right the item needs (managing automations, settings, reports, roles or payments). `details.right` names it. |
