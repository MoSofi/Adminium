---
'@adminium/server': patch
'@adminium/dashboard': patch
'@adminium/widgets': patch
'@adminium/i18n': patch
---

The import wizard can be mounted on an app's own staff screen: `mount('import', element, props)`. The screen names the table (or a few to pick from), its columns and which of them no two rows share, the modes this person is allowed and the config's `csrfToken`; the part pastes or uploads, maps, shows what each line would do, runs, and tells the screen what the import did. It is the dashboard's own wizard, now one component with two hosts, and it reads nothing of the dashboard. Somebody whose role opens only an app's screens may use the routes of one import, each of which still asks the table's own rights. The wizard now says in words when the right to update is missing, when a paste is too large and when a run is refused, and no longer shows "failed" for a moment before an import's first answer. The words of the setup checklist, the audit log, the desktop app's capabilities card and the command palette are fetched with their screens instead of with the first paint.
