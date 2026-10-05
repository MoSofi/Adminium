// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/common.json (its builder, kb, about, team groups: en-US's deferred part of `common`) — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "builder": {
    "view": "View",
    "edit": "Edit",
    "done": "Done",
    "addWidget": "Add widget",
    "saveLayout": "Save layout",
    "saving": "Saving…",
    "savedShort": "Saved",
    "options": "Dashboard options",
    "resetLayout": "Reset layout",
    "resetTitle": "Reset to the shared layout?",
    "resetBody": "This removes your personal changes and restores the dashboard everyone sees. Your data isn’t affected.",
    "resetConfirm": "Reset layout",
    "resetDone": "Layout reset to the shared default.",
    "sharedNote": "You’re editing the shared dashboard everyone sees.",
    "personalNote": "You’re editing your personal layout — only you see these changes.",
    "savedShared": "Dashboard saved for everyone with access.",
    "empty": "This dashboard has no widgets yet.",
    "emptyAction": "Add a widget",
    "palette": {
      "title": "Add a widget",
      "count": "{count} widgets",
      "searchLabel": "Search widgets",
      "searchPlaceholder": "Search widgets…",
      "clear": "Clear search",
      "noResults": "No widgets match “{query}”.",
      "add": "Add {name}",
      "added": "{name} added."
    },
    "inspector": {
      "title": "Configure widget",
      "empty": "This widget has no options to configure.",
      "locked": "Locked",
      "lockedHint": "This field is set by the source and can’t be edited here.",
      "selectPlaceholder": "Select…",
      "increment": "Increase",
      "decrement": "Decrease",
      "done": "Done"
    },
    "item": {
      "configure": "Configure {name}",
      "duplicate": "Duplicate {name}",
      "remove": "Remove {name}",
      "removed": "{name} removed.",
      "duplicated": "{name} duplicated.",
      "unboundHint": "This widget shows sample data here and on the live page. Open Configure to connect it to a table.",
      "unbound": "Sample data"
    },
    "families": {
      "kpi": "KPIs",
      "charts": "Charts",
      "tables": "Tables",
      "feeds": "Feeds",
      "calendar": "Calendar",
      "boards": "Boards",
      "geo": "Maps",
      "media": "Media",
      "communication": "Communication",
      "forms": "Forms",
      "chrome": "Navigation",
      "system": "System",
      "domain": "Domain"
    },
    "versions": "Versions",
    "versionsEmpty": "No saved versions yet",
    "saveAsVersion": "Save as version",
    "saveVersionTitle": "Save a version",
    "saveVersionBody": "Snapshots the current document. Restore it any time from Versions.",
    "versionName": "Version name",
    "versionNamePlaceholder": "e.g. Before Q3 rates change",
    "discard": "Discard changes",
    "discardTitle": "Discard your changes?",
    "discardBody": "The dashboard goes back to how it looked when you opened the editor. Your data isn’t affected.",
    "discardConfirm": "Discard changes",
    "keepEditing": "Keep editing",
    "discarded": "Changes discarded.",
    "binding": {
      "addFilter": "Add filter",
      "brokenBody": "It no longer matches a query this version understands, so the widget shows an error on the live page.",
      "brokenTitle": "This widget’s query is broken",
      "bucketColumn": "Date column",
      "bucketRequired": "Pick the column that carries the date.",
      "bucketUnit": "Group time by",
      "columnNone": "None",
      "columnPlaceholder": "Choose a column…",
      "connect": "Connect to data",
      "edit": "Edit query",
      "event": {
        "category": "Category column (optional)",
        "date": "Start date column",
        "end": "End date column (optional)",
        "title": "Title column"
      },
      "filterColumnRequired": "Pick a column.",
      "filterColumn": "Column",
      "filterListHelper": "Separate values with commas.",
      "filterOp": "Condition",
      "filterValue": "Value",
      "fn": {
        "avg": "Average",
        "countDistinct": "Count of distinct values",
        "count": "Count of rows",
        "max": "Maximum",
        "min": "Minimum",
        "sum": "Sum"
      },
      "groupByColumns": "Columns",
      "groupByRequired": "This view needs a breakdown column.",
      "groupByRows": "Rows",
      "groupBy": "Group by",
      "incompleteBody": "Fill in the highlighted fields — a half-written query would fail on the live dashboard.",
      "incompleteTitle": "This query isn’t finished",
      "limit": "Most rows to fetch",
      "loadingSchema": "Loading tables…",
      "lossyBody": "Parts of it — extra measures, sorts or page-filter links — aren’t shown here and will be dropped if you save.",
      "lossyTitle": "This query is more advanced than the editor",
      "measureColumnRequired": "This calculation needs a column.",
      "measureColumn": "Of column",
      "measureFn": "Calculate",
      "noConnectionBody": "Widgets can only be bound on a page that belongs to a connection.",
      "noConnectionTitle": "This page has no database connection",
      "noDateColumns": "This table has no date or timestamp column.",
      "noFilters": "No filters — every row in the table is counted.",
      "noSnapshotBody": "Tables and columns come from the connection’s last introspection. Run introspection in Studio, then reopen this editor.",
      "noSnapshotTitle": "No schema snapshot for this connection",
      "op": {
        "between": "is between",
        "ilike": "contains (any case)",
        "in": "is one of",
        "isNull": "is empty",
        "like": "contains",
        "notNull": "is not empty"
      },
      "orderAsc": "Oldest / lowest first",
      "orderBy": "Sort by",
      "orderDesc": "Newest / highest first",
      "orderDir": "Direction",
      "orderNone": "Database order",
      "pickTableFirst": "Pick a table to choose its columns.",
      "removeFilter": "Remove filter",
      "remove": "Remove data source",
      "save": "Use this query",
      "sectionBreakdown": "Breakdown",
      "sectionColumns": "Columns",
      "sectionFilters": "Filters",
      "sectionMeasure": "Measure",
      "sectionRows": "Rows",
      "sectionSource": "Source",
      "sectionTime": "Time axis",
      "sectionWindow": "Period",
      "selectColumns": "Columns to show",
      "selectRequired": "Choose at least one column to show.",
      "shape": {
        "calendarEvents": "Dated events",
        "categorical": "A value per category",
        "distribution": "The spread of one column",
        "matrix": "A grid of rows by columns",
        "metricDelta": "A number, compared to the period before",
        "multiTimeseries": "One line over time per category",
        "recordList": "A list of rows",
        "record": "One row",
        "singleMetric": "A single number",
        "stream": "A live feed of recent rows",
        "timeseries": "A value over time",
        "tree": "A value per category, split in two levels",
        "geoPoints": "A value per place or region",
        "flows": "How much moves from one category to another",
        "ohlc": "Open, high, low and close per period",
        "booleanMap": "An on/off flag per key"
      },
      "shapeHelper": "Changing this changes which query controls apply.",
      "shapeLabel": "What this widget shows",
      "summaryColumns": "{count, plural, one {# column} other {# columns}}",
      "summaryFilters": "{count, plural, one {# filter} other {# filters}}",
      "tableEmpty": "No matching table.",
      "tablePlaceholder": "Search tables…",
      "tableRequired": "Pick a table to query.",
      "table": "Table or view",
      "title": "Data source",
      "unbindableBody": "It shows the shape of data the query engine doesn’t build yet, so it renders its own sample content.",
      "unbindableTitle": "This widget can’t query data yet",
      "unboundBody": "It shows sample numbers here AND on the live page. Connect it to a table to show real data.",
      "unboundTitle": "Not connected to your data",
      "unit": {
        "day": "Daily",
        "hour": "Hourly",
        "month": "Monthly",
        "quarter": "Quarterly",
        "week": "Weekly",
        "year": "Yearly"
      },
      "valueColumnRequired": "Pick the column to measure.",
      "valueColumn": "Value column",
      "windowColumn": "Date column",
      "windowLast": "Last",
      "windowNone": "All time",
      "windowRequired": "Comparing to the previous period needs a date column.",
      "windowUnit": {
        "day": "days",
        "hour": "hours",
        "month": "months",
        "quarter": "quarters",
        "week": "weeks",
        "year": "years"
      },
      "windowUnitLabel": "Unit",
      "role": {
        "flagKey": "Key column",
        "flagValue": "On/off column"
      },
      "roleColumnsRequired": "Fill every required column, and leave no gaps before one you filled — these columns are read in order."
    }
  },
  "kb": {
    "title": "Knowledge Base",
    "subtitle": "{count, plural, one {# guide} other {# guides}} · full docs at docs.adminium.dev",
    "openDocs": "Open the docs",
    "browse": "Browse by topic",
    "hero": {
      "title": "How can we help?",
      "subtitle": "Search guides, API docs and troubleshooting.",
      "placeholder": "Search the knowledge base…",
      "label": "Search the knowledge base",
      "clear": "Clear search"
    },
    "category": {
      "start": "Getting started",
      "connect": "Connecting data",
      "api": "API & developers",
      "security": "Security & access",
      "selfhost": "Self-hosting",
      "trouble": "Troubleshooting",
      "count": "{count, plural, one {# article} other {# articles}}",
      "selected": "Filtering"
    },
    "list": {
      "all": "All guides",
      "clear": "Clear filter"
    },
    "empty": {
      "title": "No guides match your search",
      "body": "Try a different word, or search the full documentation at docs.adminium.dev.",
      "openDocs": "Open the docs"
    },
    "article": {
      "apiKeys": {
        "title": "Authenticating with API keys",
        "excerpt": "Create and revoke keys, and why a key is only ever shown to you once."
      },
      "audit": {
        "title": "Reading the audit log",
        "excerpt": "Who changed what, when, and from where."
      },
      "backup": {
        "title": "Back up and move an instance",
        "excerpt": "export-zip bundles your server config; import it to replay the same setup elsewhere."
      },
      "columnRules": {
        "title": "Rules on a column",
        "excerpt": "What fills a column, what it accepts and what its limits are — on every write, not just one form."
      },
      "connectDb": {
        "title": "Connecting your first database",
        "excerpt": "Point Adminium at PostgreSQL, MySQL or SQLite and generate an admin app."
      },
      "connectionFails": {
        "title": "A database connection fails",
        "excerpt": "Read the diagnostics card: host, port, TLS, and the IP your database must allow."
      },
      "createDialog": {
        "title": "The New and Edit dialogs",
        "excerpt": "Where every field comes from, and how to design your own instead of the generated one."
      },
      "docker": {
        "title": "Self-host with Docker",
        "excerpt": "The official image, docker-compose, and running a separate meta database."
      },
      "firstAdmin": {
        "title": "Create your first super admin",
        "excerpt": "What the first-run wizard asks for, and why it can only run once."
      },
      "install": {
        "title": "Install Adminium",
        "excerpt": "Create a project with one command, or run Adminium from Docker or a source checkout."
      },
      "lineItems": {
        "title": "Line items and bookings",
        "excerpt": "Tables of child rows with live totals, calendars bound to what is already booked, and one record per chip."
      },
      "manifest": {
        "title": "The page manifest",
        "excerpt": "How a page is described as config, and how to hand-edit one."
      },
      "missingTables": {
        "title": "Tables are missing after introspection",
        "excerpt": "Schema visibility, excluded tables, and re-running generation."
      },
      "readOnly": {
        "title": "Use a read-only role",
        "excerpt": "Introspection reads schema metadata only. Give Adminium the least privilege it needs."
      },
      "rest": {
        "title": "REST API reference",
        "excerpt": "Every endpoint the generated app exposes, with request and response shapes."
      },
      "publicApi": {
        "title": "Endpoints and keys for your pages",
        "excerpt": "Let a page or another server call the tables you choose, with keys scoped to endpoints and methods."
      },
      "apiDocsPage": {
        "title": "The API documentation page",
        "excerpt": "Publish /api-docs so the people who call your API can browse it and try a request."
      },
      "roles": {
        "title": "Roles & permissions",
        "excerpt": "Assign Viewer, Editor and Admin, and build your own roles from the permission matrix."
      },
      "schemaFile": {
        "title": "Generate from a schema file",
        "excerpt": "Upload a Prisma schema, a Django models.py, a Rails schema.rb or a .sql dump — no connection needed."
      },
      "secrets": {
        "title": "How Adminium stores your secrets",
        "excerpt": "Connection credentials are encrypted at rest with ADMINIUM_SECRET. API keys are hashed."
      },
      "tableFilters": {
        "title": "Filtering a table",
        "excerpt": "The six kinds of filter, the two a page gets on its own, and how they ride into a saved view."
      },
      "telemetry": {
        "title": "Telemetry and update checks",
        "excerpt": "Both are opt-in and off by default. What is sent if you turn them on."
      }
    }
  },
  "about": {
    "title": "About Adminium",
    "subtitle": "Version, licence, and where this instance’s source code lives.",
    "version": "Version",
    "license": "Licence",
    "metaStore": "Meta store",
    "node": "Node.js",
    "engine": {
      "postgres": "PostgreSQL",
      "mysql": "MySQL / MariaDB",
      "sqlite": "SQLite"
    },
    "licenseCard": {
      "title": "Free and open source",
      "body": "Adminium is licensed under the GNU Affero General Public License v3.0. You are free to run, study, modify, and share it. If you offer a modified version to others over a network, the AGPL asks you to offer them its source code too."
    },
    "viewLicense": "Read the licence",
    "viewSource": "Get the source code",
    "updates": {
      "title": "Updates",
      "description": "Whether this instance checks for new releases."
    },
    "update": {
      "disabled": "Update checks are off, so this instance never contacts GitHub. Turn them on in Settings to hear about new releases.",
      "current": "You are on the latest release.",
      "available": "Adminium {version} is available",
      "availableBody": "You are running {version}.",
      "viewRelease": "View release notes"
    },
    "desktop": {
      "unknown": "Unknown",
      "appVersion": "App version",
      "serverVersion": "Server version",
      "migration": "Meta-store migration",
      "electron": "Electron",
      "chromium": "Chromium",
      "runtimeNode": "Node runtime",
      "system": {
        "title": "System"
      },
      "dataDir": "Data directory",
      "reveal": "Show in folder",
      "secret": {
        "title": "Secret storage",
        "safe": "Encrypted by your operating system",
        "plainWarning": "This computer has no system keychain available, so your Adminium secret is stored unencrypted on disk. Anyone who can read this machine’s files can read it. Set up a login keychain (or a Linux secret service) and restart Adminium to protect it."
      },
      "updates": {
        "title": "Updates",
        "mode": {
          "notify": "Notify me about new versions",
          "manual": "Only when I check",
          "disabled": "Off (air-gapped)"
        },
        "disabledBody": "Automatic updates are off (air-gapped). Install new versions manually.",
        "check": "Check for updates",
        "checking": "Checking…",
        "lastChecked": "Last checked {when}",
        "available": "Version {version} is available",
        "none": "You are on the latest version.",
        "unavailable": "Updates are turned off in this installation.",
        "error": "Could not check for updates.",
        "download": "Download update",
        "downloading": "Downloading… {percent}%",
        "downloaded": "Version {version} is ready to install",
        "restart": "Restart to install",
        "downloadError": "The download did not finish. You can try again.",
        "toast": {
          "available": "A new version of Adminium is available",
          "view": "View",
          "downloaded": "Update ready to install",
          "restart": "Restart now"
        }
      },
      "legal": {
        "title": "Licences",
        "agpl": "Adminium Desktop is free software under the GNU Affero General Public License v3.0.",
        "viewLicense": "View licence",
        "licenseTitle": "GNU Affero General Public License v3.0",
        "licenseUnavailable": "The bundled licence file is not available in this build.",
        "viewNotices": "Third-party licences",
        "noticesTitle": "Third-party notices",
        "noticesUnavailable": "Third-party notices are generated when the app is packaged and are not available in this build.",
        "source": "Source code",
        "close": "Close"
      },
      "telemetry": {
        "title": "Anonymous usage data",
        "label": "Share anonymous usage data",
        "description": "Helps us decide which database engines to prioritise. Off unless you turn it on; no schema, data, or personal information is ever sent.",
        "saveFailed": "Could not save that setting. Try again."
      },
      "diagnostics": {
        "title": "Diagnostics",
        "description": "Details that help when you report a problem. No schema or data is included.",
        "copy": "Copy diagnostic info",
        "copied": "Copied",
        "showLogs": "Show logs",
        "dataSize": "Data size: {size}"
      }
    }
  },
  "team": {
    "action": {
      "reactivate": "Reactivate",
      "remove": "Delete",
      "resend": "New link",
      "roles": "Roles",
      "suspend": "Suspend"
    },
    "column": {
      "actions": "Actions",
      "lastSeen": "Last seen",
      "person": "Person",
      "roles": "Roles",
      "status": "Status"
    },
    "counts": "{active} active · {invited} invited · {suspended} suspended",
    "empty": {
      "body": "Invite a teammate to give them their own sign-in and role.",
      "filtered": {
        "body": "Clear the filters to see the whole directory.",
        "title": "No one matches these filters"
      },
      "title": "Only you have an account"
    },
    "filterRoleAny": "Any role",
    "filterRole": "Filter by role",
    "filterStatusAny": "Any status",
    "filterStatus": "Filter by status",
    "invite": {
      "copied": "Copied",
      "copyLink": "Copy link",
      "created": {
        "body": "Send this link to {email} yourself. It is shown once — Adminium stores only a hash of it, so if you lose it you will have to delete the invitation and issue a new one.",
        "title": "Invitation created",
        "bodyEmailed": "Adminium emailed this link to {email}. It is here too in case the email does not arrive, and it is shown once — Adminium stores only a hash of it."
      },
      "emailIt": "Email the invitation",
      "expiresRelative": "The link expires {at} ({relative}).",
      "expires": "The link expires {at}.",
      "noEmail": {
        "smtp": "No SMTP server is configured on this instance, so there is nothing to send mail with. Share the link over a channel you already trust.",
        "title": "Adminium did not email this link",
        "unknown": "Adminium could not check whether this instance can send mail. Share the link over a channel you already trust."
      },
      "emailed": {
        "title": "Adminium emailed this link",
        "body": "The invitation is on its way to {email}. If it has not arrived in a few minutes, share the link above over a channel you already trust."
      }
    },
    "inviteButton": "Invite teammate",
    "inviteDialog": {
      "description": "Adminium creates the account and gives you a one-time activation link to pass on.",
      "emailPlaceholder": "name@example.com",
      "email": "Email",
      "failed": "Could not create the invitation",
      "namePlaceholder": "e.g. Dana Osei",
      "name": "Name",
      "rolesHelper": "Pick the least-privileged role that lets them do their job. You can change this later.",
      "roles": "Roles",
      "submit": "Create invitation",
      "title": "Invite a teammate"
    },
    "listFailed": {
      "title": "Could not load the directory"
    },
    "loadMore": "Load more",
    "neverSignedIn": "Never signed in",
    "noRoles": "No roles",
    "remove": {
      "body": "This erases {name}’s account, their preferences and their sign-in sessions, and blanks their name from the record of settings they changed. Suspending instead keeps all of it and only stops them signing in. This cannot be undone.",
      "confirm": "Delete permanently",
      "prompt": "Type “{email}” to confirm",
      "title": "Delete account permanently",
      "failed": "The account was not deleted"
    },
    "roles": {
      "unavailable": "Roles are not visible to your account, so none can be assigned here."
    },
    "rolesDialog": {
      "description": "A user gets the union of every role they hold.",
      "failed": "Could not change the roles",
      "title": "Roles for {name}"
    },
    "rolesLocked": "Changing roles needs the “Manage roles” permission.",
    "search": "Search name or email",
    "status": {
      "active": "Active",
      "invited": "Invited",
      "suspended": "Suspended"
    },
    "subtitle": "Who has an account on this Adminium, and what each of them can do.",
    "title": "Team",
    "twoFactorOn": "Two-factor authentication is on",
    "twoFactorShort": "2FA",
    "actionFailed": "That change was not made"
  }
} as const;
