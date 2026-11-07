<!-- produced from apps/docs/src/content/docs/reference/errors.md § Codes met outside a request — An app's install check; do not edit -->

# Error codes: Codes met outside a request — An app's install check

### An app's install check

`POST /apps/plan` lists what stops an install in `problems`, each with a `code`, `table` and
`column`. An install that meets one is refused `422` `VALIDATION_FAILED` with
`details.reason: "PLAN_REFUSED"` and the same `problems`.

| Code | Meaning |
|---|---|
| `LINK_ORPHANS` | A foreign key the update adds to a column that was there as a plain value, which rows already in the table break: they name a row that does not exist. Point them at one that does, or empty them, then check again. |
| `UNIQUE_DUPLICATES` | A unique rule the install adds, which rows already in the table break. Make them differ, then check again. |
| `UNIQUE_KEY_TOO_LONG` | On MySQL, a unique column or set of columns wider than MySQL can index (3072 bytes together, 768 characters for one text column). Make the text columns shorter. |
| `SAVED_FROM_HERE` | The file was saved with Save as app from this very database. Its tables and pages are here already, and installing it would run every rule twice. Install it on another database. |
| `EXISTING_TABLE_UNUSABLE` | With "use the existing tables" (`existing: "use"`), a table that is here cannot be used as it is: using it would change it, or it is missing what the app needs. Nothing is ever renamed or changed. Rename the table here, or save the app again without it. |
| `ONE_VERSION_PER_APP` | Another database runs another version of this app. Every copy of an app runs one version: update the copies first, then install this one. |
| `PAGE_SLUG_TAKEN` | One of the app's page addresses belongs to another installed app's page on this database. Uninstall that app, or install on another database. |
| `PAGE_SLUG_UNANSWERED` | A page that is not an app's already has one of the app's addresses, and no choice was sent for it in `pages`. A self-made app's install waits for the choice; a released app's page is left out with a warning instead. |
| `PAGE_SLUG_ANSWER_INVALID` | The choice cannot be carried out: a page someone edited cannot be replaced, or the new address for the page here is not lower-case words joined by `-`, or another page has it. |
| `TABLE_NAME_REFUSED` | A table's real `name` or `schema` cannot be made here: a schema on MySQL or SQLite, the schema Adminium keeps its own tables in, or a name the database takes for another table's, because it does not tell upper and lower case apart. |
| `REQUIRED_APP_MISSING` | The app needs another app (`apps.requires`) installed on this database, and it is not. Install that app here first. |
| `REQUIRED_APP_PUBLISHER` | An app with the required key is here, but from another publisher, so it is not that app. |
| `REQUIRED_APP_VERSION` | The required app is here at a version outside the range the file asks for. Update it first. |
| `REQUIRED_APP_TABLE` | The file uses a table of the required app that the required app does not keep on this database. |
