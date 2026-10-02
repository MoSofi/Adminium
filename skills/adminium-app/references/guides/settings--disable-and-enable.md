<!-- produced from apps/docs/src/content/docs/guides/apps/settings.md § Disable and enable; do not edit -->

# An app's settings page: Disable and enable

**Disable**, in the **Danger zone**, switches the whole app off:

- its section is hidden from the sidebar for everyone;
- its screens and its own public key stop answering: a page load gets the plain page described
  under [Sets of screens](https://docs.adminium.dev/guides/apps/settings/#sets-of-screens), anything else `503` with the code `APP_DISABLED`;
- its roles grant nothing while it is off.

The tables, records and settings stay as they are. **Enable** brings back exactly what was there.
An install that stopped part way cannot be switched on or off; it is finished by installing again.
