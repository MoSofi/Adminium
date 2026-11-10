<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Installing an app — Apps whose tables are prefixed; do not edit -->

# Installing apps: Installing an app — Apps whose tables are prefixed

### Apps whose tables are prefixed

Most apps name their tables with a prefix made from the app's key: an app with the key `pos` makes
`pos_menu_items`, not `menu_items`, so its tables cannot collide with yours or with another app's.
The app reads its tables under whatever real names the install gave them. An app whose tables are
not prefixed uses the names it declares.

A name longer than the database allows (63 bytes on PostgreSQL and SQLite, 64 on MySQL) is refused
at the check, and a shorter prefix fixes it.
