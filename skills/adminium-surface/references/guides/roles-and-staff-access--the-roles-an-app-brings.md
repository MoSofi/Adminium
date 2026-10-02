<!-- produced from apps/docs/src/content/docs/guides/apps/roles-and-staff-access.md § The roles an app brings; do not edit -->

# App roles and staff access: The roles an app brings

An app can declare roles of its own, such as a cashier and a manager. They are created when the app
is installed, named as the app names them, and appear under **People → Roles & permissions** beside
yours. Give them to people as you would any role.

An app's role can only grant things inside that app: reading or changing its own tables, seeing
the personal data in them, viewing or editing its own pages, and opening its own staff screens. It
can never grant a console permission, such as managing users or connections, and never a wildcard.

- **Your changes survive updates.** A role's grants are given once. An update adds only the grants
  a new version asks for, so a grant you took away stays away.
- **Disabled with the app.** While the app is switched off, its roles grant nothing. Nothing about
  them is deleted, and switching the app on again restores them.
- **Removed on uninstall.** Uninstalling the app deletes its roles. Everyone who held one loses it,
  and API keys bound to one of those roles are deleted and stop working at once. The uninstall
  dialog says how many people and keys each role has before you confirm.
