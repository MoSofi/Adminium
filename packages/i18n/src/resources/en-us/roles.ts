// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/roles.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "delete": "Delete",
    "rename": "Rename"
  },
  "builtinLocked": "Built-in roles cannot be deleted.",
  "category": {
    "access": "Access",
    "data": "Data",
    "operations": "Operations",
    "workspace": "Workspace",
    "records": "Pages & records",
    "apps": "Apps"
  },
  "column": {
    "actions": "Actions",
    "members": "Members",
    "name": "Role"
  },
  "create": {
    "descriptionLabel": "Description",
    "description": "A new role starts with no permissions at all.",
    "failed": "Could not create the role",
    "namePlaceholder": "e.g. Support agent",
    "name": "Name",
    "submit": "Create role",
    "title": "New role"
  },
  "createButton": "New role",
  "delete": {
    "confirm": "Delete role",
    "description": "The role and its permission rows are removed.",
    "failed": "Could not delete the role",
    "hasMembers": "“{name}” still has {count, plural, one {# member} other {# members}}. Choose the role they move to — Adminium will not leave an account with no role.",
    "noMembers": "Nobody holds “{name}”, so nothing moves.",
    "reassignPlaceholder": "Choose a role…",
    "reassignTo": "Move members to",
    "title": "Delete role"
  },
  "list": {
    "title": "Roles"
  },
  "loadFailed": {
    "body": "The matrix below is incomplete, so saving it would clear permissions that are simply not loaded. Reload before making changes.",
    "title": "Some permissions could not be read"
  },
  "matrix": {
    "discard": "Discard",
    "empty": {
      "body": "This instance reported no grantable permissions at all, which should not happen — reload, and if it persists check the server log.",
      "title": "No permissions to show"
    },
    "label": "Role permissions",
    "noChanges": "No pending changes",
    "pending": "{count, plural, one {# pending change} other {# pending changes}}",
    "rowHeader": "Permission",
    "title": "Permissions"
  },
  "memberCount": "{count, plural, one {# user} other {# users}}",
  "permission": {
    "apiKeysManage": "Manage API keys",
    "auditRead": "Read the audit log",
    "connectionsManage": "Manage database connections",
    "exportsManage": "Manage everyone’s exports",
    "importsManage": "Manage everyone’s imports",
    "jobsManage": "Start and cancel background jobs",
    "manifestsManage": "Install and manage apps and add-ons",
    "jobsRead": "See all background jobs",
    "llmRun": "Run AI assist",
    "pagesManage": "Create and organize pages",
    "projectRead": "Read pages and schema changes for a project pull",
    "reportsManage": "Manage scheduled reports",
    "rolesManage": "Manage roles and permissions",
    "schemaRemap": "Edit schema labels and overrides",
    "schemaDdl": "Create, edit and delete tables",
    "settingsManage": "Manage workspace settings",
    "usersManage": "Manage users",
    "filesManage": "Manage everyone’s files",
    "storageManage": "Manage storage destinations",
    "designerUse": "Build apps with Adminium Designer",
    "paymentsManage": "Set up payments",
    "paymentsRefund": "Give refunds",
    "paymentsView": "See payment activity and export it"
  },
  "rename": {
    "failed": "Could not rename the role",
    "title": "Rename role"
  },
  "saveFailed": {
    "title": "Could not save every role"
  },
  "subtitle": "What each role may do. A user gets the union of every role they hold.",
  "title": "Roles & permissions",
  "data": {
    "pagesView": "See every page",
    "read": "Read records",
    "readPii": "See personal data in records",
    "create": "Create records",
    "update": "Edit records",
    "delete": "Delete records",
    "export": "Export records",
    "import": "Import records",
    "pagesEdit": "Change page layouts",
    "narrow": "{count, plural, one {# grant} other {# grants}} on a single page or table also apply, on top of the rows below. Saving keeps them."
  },
  "apps": {
    "every": "Open every app’s staff screens",
    "one": "Open {app}’s staff screens"
  },
  "rows": {
    "locked": "Super Admin reaches every row.",
    "saveFirst": "Save or discard the permission changes first.",
    "action": "Rows",
    "actionLabel": {
      "read": "Read",
      "update": "Change",
      "delete": "Delete"
    },
    "way": {
      "person": "the person in {column}",
      "listingDated": "anyone listed for it in {table} on the day",
      "listing": "anyone listed for it in {table}",
      "parent": "whoever reaches its {table}",
      "whileIn": "while {column} is {values}",
      "whileEmpty": "while {column} is empty",
      "whileSet": "while {column} is filled in"
    },
    "follows": "Follows: {table}",
    "belongs": "A row belongs to {ways}.",
    "sentence": {
      "all": "Every row of {table}.",
      "allWhile": "Every row of {table}",
      "team": "Only rows that belong to this person, or to someone in a team they lead",
      "own": "Only rows that belong to this person",
      "unowned": "and rows nobody owns yet",
      "while": "only while {column} is {values}",
      "by": "and only the ones {column} names them in",
      "notThrough": "but not as someone listed in {listings}",
      "viaOwn": "Only rows of {table} whose {via} names them in {column}",
      "viaTeam": "Only rows of {table} whose {via} names them, or someone in a team they lead, in {column}",
      "allWho": "Every row of {table}, whoever {column} is.",
      "only": "Only rows of {table} where {ways}",
      "onlyTeam": "Only rows of {table} where {ways}, or someone in a team they lead",
      "onlyTeamWays": "Only rows of {table} where {ways}, or the same for someone in a team they lead"
    },
    "title": "Which rows “{role}” reaches",
    "intro": "A role reaches every row of a table it may open, unless it is limited here. A limit holds for a person only when every role that gives them the table is limited.",
    "loadFailed": "The tables could not be read.",
    "empty": {
      "title": "Nothing to limit",
      "body": "No table this role may open says whose its rows are."
    },
    "tryAs": "Try it as",
    "tryAsNone": "Nobody",
    "samplePerson": "{name} (sample)",
    "failed": "Could not save the row limits",
    "private": "Read by the people each row belongs to, and by nobody else. There is nothing to choose.",
    "reachLabel": "{action}: which rows",
    "reach": {
      "all": "All rows",
      "own": "Their own",
      "team": "Their team’s",
      "allWhile": "Every row, only while…"
    },
    "unowned": "and rows nobody owns yet",
    "widened": "This role opens the table through a wider permission. Saving a limit also gives it this table by name.",
    "count": "{name} would see {reached} of {total} rows of {table}.",
    "capped": "This person leads more people than one reach holds, so not all of their team is counted.",
    "lifted": "{name} also holds {roles}, which gives every row. This limit does not hold for them.",
    "several": "Any one of these is enough. The app set them, and they are kept as it wrote them.",
    "wayIs": {
      "person": "{column} is this person",
      "listing": "this person is listed in {table}",
      "listingDated": "this person is listed in {table} on the day",
      "parent": "this person reaches its {table}"
    }
  },
  "partsOff": "Its part of the app is switched off: it gives nothing until that part is on.",
  "people": {
    "unnamed": "Unnamed person"
  }
} as const;
