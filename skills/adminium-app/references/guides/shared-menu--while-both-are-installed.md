<!-- produced from apps/docs/src/content/docs/guides/apps/shared-menu.md § While both are installed; do not edit -->

# A menu two apps share: While both are installed

- **Both read and write the same rows.** A dish the till adds and renames reads renamed through
  the shop's public key.
- **Switching one app off** leaves the other's pages, roles and public key on the shared menu
  working.
- **Updates go on sharing.** A new version of either app that adds a column adds it to the shared
  table, under the same rules as any column an app adds.
- **Dropping the shape.** An update that stops declaring a table's shape while another app shares
  it is refused with `409` `SHAPE_IN_USE`, naming that app: it goes on writing the table as the
  shape. Uninstall that app first, or keep the shape. When no other app shares the table, the
  update is applied and the shape is cleared from it, so a later app is no longer offered it.
- **Never renamed out of the way.** When a check finds one of an app's names taken, it can offer to
  rename the existing table. A table another app still uses is never offered for renaming.
