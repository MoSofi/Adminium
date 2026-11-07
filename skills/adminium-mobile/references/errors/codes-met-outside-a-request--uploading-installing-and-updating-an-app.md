<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request — Uploading, installing and updating an app; do not edit -->

# Error codes: Codes met outside a request — Uploading, installing and updating an app

### Uploading, installing and updating an app

The app routes (`/api/v1/apps/upload`, `/apps/plan`, `/apps/install`, `/apps/:key/update`) answer
these refusals with the staff envelope. A refusal said in `details.reason` comes with the code
`VALIDATION_FAILED`, `CONFLICT` or `FORBIDDEN` around it. Nothing is written.

| Status | Code | When |
|---|---|---|
| `422` | `VALIDATION_FAILED`, `details.reason: "VERSION_OLDER"` | The file is older than the version a database here runs. `details.installed` lists each database and its version. Upload the newer file, or nothing. |
| `422` | `VALIDATION_FAILED`, `details.reason: "LINEAGE_DIFFERS"` | A self-made app saved somewhere else under a key this server already has. The key names one app across the whole server, so this is refused for every database. `details.connectionName` says where the other one is. Save it again with another key. |
| `422` | `VALIDATION_FAILED`, `details.reason: "IS_WORKSPACE_FILE"` | The file sent to `/apps/upload` is a workspace file. Send it to `/apps/upload-workspace`. |
| `422` | `VALIDATION_FAILED`, `details.reason: "PAGE_SLUG_UNANSWERED"` | An install sent no choice for a page whose address is taken (see above). `details.page` names it. |
| `409` | `CONFLICT`, `details.reason: "ONE_VERSION_PER_APP"` | Another database runs another version of the app (see above). `details.installed` and `details.connectionId` say which. |
| `409` | `CONFLICT`, `details.reason: "BARE_ADDRESS_TAKEN"` | The install asked for the app's plain addresses (`bareAddress: true`), and another copy of the app has them. Install this one under its own addresses. |
| `409` | `APP_UPDATE_INCOMPLETE` | An update stopped after its version moved. `details.stage` says where it stopped, with `from`, `to` and `cause`. Nothing was undone and the earlier pages are still there: send the same update again to finish it. `GET /apps` shows it on the copy as `unfinishedUpdate`. |
| `409` | `APP_REQUIRED_BY` | An uninstall of an app another app on the same database needs (`apps.requires`). `details.apps` names them. Uninstall those first. |
| `403` | `FORBIDDEN`, `details.reason: "INSTANCE_PERMISSION"` | `instance: true` was sent to apply the file's look and words by someone who may not manage server settings. Send it without, or ask someone who can. |
| `403` | `FORBIDDEN`, `details.reason: "SAVED_PART_PERMISSION"` | The file brings report documents, invoice layouts, scheduled reports or payments, and the installer lacks the right to make them here. `details.permission` names it. |
