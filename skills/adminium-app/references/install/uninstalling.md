<!-- produced from apps/docs/src/content/docs/self-hosting/installing-apps.md § Uninstalling; do not edit -->

# Installing apps: Uninstalling

**Uninstall**, on the installed row or in the **Danger zone** of the app's page, opens a dialog
that lists what goes and what stays, read from the server before anything happens.

| Removed | Kept |
|---|---|
| The app's files | Its tables, and every record in them |
| The pages it made that nobody edited, with their grants | Pages you edited, as ordinary pages |
| Its browser key, revoked, and the public endpoints it made | Its entries in the audit log |
| Its roles | |
| Its settings, placement, name and extra instances | |
| The column rules it wrote, unless someone changed them | |
| Its domains | |

Removing an app's role takes it from everyone who holds it, and **deletes** the API keys bound to
it. When a role has members or keys, the dialog says how many before you confirm.

### Deleting its tables too

Tables and data are kept unless you tick **Also delete its tables and data** and type the app's key
to confirm; the button then reads **Uninstall and delete data**. Only the tables this app created
and no other app uses are dropped, and the dialog lists them. A table the app found and used, or
shares with another app, is always kept. This cannot be undone, and it needs Super Admin: the
option is not shown to anyone else.

### After an uninstall

- **A reinstall recognises the kept tables.** Installing the same app into the same database
  again shows them as **Yours from an earlier install** and uses them, with their rows.
- **A domain mapped to the app stops serving.** Its DNS still points here, so every request to
  it answers `503` with the code `SURFACE_UNAVAILABLE` until you attach the host to an app again.
  It never falls back to the dashboard.
