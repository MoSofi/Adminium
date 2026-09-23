// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/studio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "addOns": {
    "browse": {
      "all": "All",
      "bundled": "Included",
      "categories": "Categories",
      "discard": "Discard",
      "download": "Download",
      "emptyBody": "This build shipped none, and the online catalogue is off.",
      "emptyOnlineBody": "The online catalogue is on, but the last check found nothing. Try checking for newer.",
      "emptyTitle": "No add-ons available",
      "install": "Install",
      "missing": "Missing",
      "missingBody": "Its files are not on this server, so none of it loads.",
      "needsNewer": "Needs Adminium {version} or later",
      "noMatchBody": "No add-on here matches that search and category.",
      "noMatchTitle": "Nothing matches",
      "offline": "Showing the add-ons that came with this build. Browsing online is switched off, and nothing here has contacted the internet.",
      "online": "Includes add-ons from the online catalogue. Checking for newer versions is a separate action.",
      "refresh": "Check for newer",
      "search": "Search add-ons",
      "title": "Available",
      "toggle": "Browse the online catalogue",
      "upgrade": "v{version} available",
      "upgradeAction": "Upgrade"
    },
    "card": {
      "needsApiKey": "Needs an API key",
      "needsOauth": "Connects with OAuth"
    },
    "category": {
      "artwork": "Artwork",
      "data": "Data",
      "delivery": "Delivery",
      "email": "Email",
      "payments": "Payments"
    },
    "confirm": {
      "cancel": "Cancel",
      "close": "Close",
      "discard": "Discard",
      "discardBody": "The downloaded files are deleted. Nothing was installed, so nothing else changes — you can download it again whenever you like.",
      "discardTitle": "Discard this download",
      "disconnect": "Disconnect",
      "disconnectBody": "Its keys are deleted and it stops making calls. Every table and every row it created stays exactly as it is, and you can reconnect at any time.",
      "disconnectTitle": "Disconnect this add-on",
      "uninstall": "Uninstall",
      "uninstallBody": "Its keys are deleted and its files are removed from this server. Every table and every row it created stays exactly as it is. You can install it again later.",
      "uninstallTitle": "Uninstall this add-on"
    },
    "connect": {
      "apiKey": "API key",
      "submit": "Connect"
    },
    "consent": {
      "cancel": "Cancel",
      "close": "Close",
      "confirm": "Install",
      "hosts": "Attach to",
      "loading": "Working out what this would do…",
      "subtitle": "What this add-on will do, before it can do it.",
      "title": "Install {name}"
    },
    "error": "Something went wrong",
    "installed": {
      "connected": "Connected",
      "disconnect": "Disconnect",
      "egress": "May contact: {hosts}",
      "emptyBody": "Install an add-on above and it will appear here with its hosts and connection.",
      "emptyTitle": "Nothing installed yet",
      "missing": "Missing",
      "missingBody": "Its files are not on this server, so none of it loads. Install it again, or remove it.",
      "notConnected": "Not connected",
      "off": "off",
      "on": "on",
      "title": "Installed",
      "uninstall": "Uninstall"
    },
    "job": {
      "body": "Fetching and verifying. Nothing is installed until you say so.",
      "failed": "The download did not finish. Nothing was installed.",
      "title": "Downloading"
    },
    "plan": {
      "blocked": "This cannot be installed here",
      "needsColumns": "This add-on needs columns you do not have",
      "needsColumnsBody": "Adminium will not add columns to tables you already own. Add them yourself, then install.",
      "noData": "This add-on reads and writes no tables of its own.",
      "reuse": "This add-on will use tables you already have:",
      "willCreate": "This will create tables in your database",
      "willCreateBody": "Installing creates these tables. Uninstalling later leaves them, and their data, alone."
    },
    "settings": {
      "badJson": "That is not valid JSON, so it was not saved.",
      "save": "Save settings",
      "title": "Settings"
    },
    "sideload": {
      "file": "Package file (.tgz)",
      "hint": "For a server with no internet. It is checked exactly as a download would be, so it needs the hash that came with it.",
      "sha": "Integrity (sha512-…)",
      "shaHint": "The sha512- fingerprint published with the release, shown beside its Download link on adminium.dev/marketplace. The upload is refused if the bytes do not match.",
      "submit": "Upload",
      "title": "Upload a package",
      "uploaded": {
        "title": "Uploaded {name} {version}",
        "body": "Install it from the list above."
      }
    },
    "subtitle": "Extra capabilities you can add to your apps — shipping, artwork, data. Each one says what it needs before you install it.",
    "title": "Add-ons",
    "upgradeNote": "Upgrading keeps the hosts an add-on is attached to and the connection it already has.",
    "veto": {
      "body": "The setting is saved, but network features are off for this server and that wins. Downloaded add-ons still work, and you can still upload one yourself.",
      "title": "This deployment cannot browse online"
    }
  },
  "capability": {
    "importNoLiveHealth": "No live database connection — health checks and schema-drift detection are unavailable for this source.",
    "importNoRowCounts": "Schema files carry no row counts — the tables list shows — instead of made-up numbers.",
    "mysqlApproxRows": "MySQL row counts are storage-engine estimates (they can drift up to ±40%) — shown with ≈.",
    "mysqlFkEnum": "MySQL FK/enum metadata is weaker: MyISAM tables declare no foreign keys, enums are per-column enum(…) types, and CHECK constraints need MySQL 8.0.16+ / MariaDB 10.2+.",
    "rowsApproximate": "Storage-engine estimate — can drift up to ±40% on InnoDB.",
    "rowsNoEstimate": "The engine reported no estimate for this table.",
    "rowsRunAnalyze": "No estimate yet — run ANALYZE on the database for row counts.",
    "rowsUnavailable": "Schema files have no live database — row counts are unknown until you connect one.",
    "sqliteCheckEnums": "SQLite has no native enum type — enums are synthesized from CHECK (col IN (…)) constraints.",
    "sqliteNoComments": "SQLite has no column comments — use the schema remap editor to add labels."
  },
  "design": {
    "adopt": {
      "action": "Add to my app",
      "done": "{created} pages created, {updated} updated, {unchanged} already current.",
      "everything": "This connection already shows every table, so nothing had to be included.",
      "forbidden": "Your role can change the schema but not generate pages. Ask an admin with connection management to add these tables to the app.",
      "grants": "No role is given access automatically — grant it in Settings → Roles.",
      "offer": "A new table does nothing until it has a page. Add {tables} to your app?",
      "skippedEdited": "Left untouched because you edited them: {pages}."
    },
    "apply": "Apply",
    "brokenEnumValues": "Every allowed value on {columns} needs to be filled in and different from the others.",
    "ceiling": {
      "authorise": "Authorise this rewrite",
      "body": "{table} holds over {rows} rows — past the size Adminium rewrites on its own. Only a Super Admin can authorise this, and the table will be locked for as long as the rewrite takes.",
      "hint": "Type the table name exactly as it appears above.",
      "notYours": "{table} holds over {rows} rows. Only a Super Admin can authorise a rewrite this large — ask one, or run the change during a maintenance window with your own tooling.",
      "prompt": "Type {table} again to authorise the rewrite"
    },
    "column": {
      "default": "Starts as",
      "defaultValue": "Value",
      "help": "What do these settings mean?",
      "length": "Length",
      "link": "Links to",
      "linkHelp": "Connect this to a row in another table.",
      "linkTypeNote": "The type is matched to the linked table’s key.",
      "name": "Name",
      "namePlaceholder": "client_id",
      "noLink": "Nothing",
      "onDelete": "If the linked row is deleted",
      "precision": "Precision",
      "primaryKey": "Primary key",
      "remove": "Remove {name}",
      "required": "Required",
      "type": "Type",
      "unique": "Unique"
    },
    "confirm": {
      "body": "This change discards data or removes an object. Adminium cannot undo it.",
      "cancel": "Cancel",
      "close": "Close",
      "confirm": "Apply changes",
      "prompt": "Type {word} to confirm",
      "title": "Apply a destructive change"
    },
    "default": {
      "autoincrement": "Count up from the last row",
      "false": "No",
      "literal": "A value",
      "none": "Nothing",
      "now": "The current date and time",
      "true": "Yes",
      "uuid": "A new unique id"
    },
    "designer": "Table designer",
    "discard": "Discard changes",
    "discardTable": "Discard this new table",
    "dropping": "Marked for deletion",
    "empty": {
      "body": "Create a table, or pick one to edit. Nothing reaches your database until you review the statements and apply them.",
      "title": "Design your schema"
    },
    "error": {
      "atColumn": "Column {n}, {field}",
      "atTable": "Table {field}",
      "empty": "A name is required.",
      "identifier": "Use lowercase letters, numbers and underscores, starting with a letter.",
      "tooLong": "Too long — {dialect} allows {max} characters."
    },
    "existing": "Existing tables",
    "hazard": {
      "irreversible": "Cannot be undone",
      "locking": "Holds a lock",
      "lossy": "Discards data",
      "refused": "Refused",
      "rewrite": "Rewrites the table",
      "safe": "Safe"
    },
    "help": {
      "close": "Close",
      "default": {
        "example": "A \"created at\" field that starts as the current date and time never has to be typed, and cannot be wrong.",
        "term": "Starts as",
        "what": "What the field holds when nobody fills it in. The database puts the value there itself, so it is also what fills the field for rows created outside Adminium."
      },
      "keyGeneration": {
        "example": "Only PostgreSQL can generate a unique id and hand it straight back, so on the other engines the key counts up.",
        "term": "How the key is filled",
        "what": "Where each row’s id comes from. Counting up from the last row gives 1, 2, 3 and is what most tables want; a unique id is a long random one, which is harder to guess and harder to read out loud."
      },
      "link": {
        "example": "A reservation links to a client. Adminium then shows the client on the reservation, and the reservations on the client.",
        "term": "Link to another table",
        "what": "Connects this row to a row in another table, and asks the database to keep the connection honest — you cannot point at something that is not there."
      },
      "primaryKey": {
        "example": "Without a primary key, Adminium can list the rows but cannot edit or delete an individual one.",
        "term": "Primary key",
        "what": "The field that identifies each row — the one Adminium uses to tell one row from another. Every table should have exactly one, and it is almost always the \"id\" field created for you."
      },
      "required": {
        "example": "An order needs a customer, so that field is required. A delivery note is optional, so it is not.",
        "term": "Required",
        "what": "The field must be filled in. A row cannot be saved while it is empty."
      },
      "subtitle": "Plain-language descriptions of each setting, and what it changes for the people using your app.",
      "title": "What these fields mean",
      "type": {
        "example": "A phone number is usually text, not a number — numbers drop leading zeros.",
        "term": "Type",
        "what": "What kind of information the field holds — words, whole numbers, money, a date, a yes/no answer. Picking the right one is what lets Adminium show a date picker instead of a text box, and add up a column of money."
      },
      "unique": {
        "example": "Two customers should not share an email address — mark it unique and they cannot.",
        "term": "Unique",
        "what": "No two rows may hold the same value. The database refuses the second one."
      },
      "values": {
        "example": "A status of new, in progress or done. Nobody can type \"in-progres\" and create a fourth status by accident.",
        "term": "Allowed values",
        "what": "The complete list of answers this field accepts. The database refuses anything else, and Adminium shows the list as buttons or a menu instead of a text box."
      }
    },
    "keepTable": "Keep {table}",
    "newTable": "New table",
    "onDelete": {
      "cascade": "Delete this row too",
      "restrict": "Prevent the deletion",
      "setNull": "Leave this field empty"
    },
    "plan": "Review changes",
    "result": {
      "applied": "Applied. Adminium re-read your schema.",
      "failed": "Nothing was applied — your database is unchanged. {error}",
      "partial": "Partly applied: {done} of {total} steps ran. Applying the same changes again completes them.",
      "repaired": "The rename was carried into {pages, plural, one {# page} other {# pages}}, {grants, plural, one {# role grant} other {# role grants}} and {overrides, plural, one {# schema override} other {# schema overrides}}."
    },
    "review": {
      "noChanges": "No schema changes yet.",
      "pending": "Review your changes to see the exact statements Adminium will run.",
      "steps": "Planned steps",
      "superAdmin": "Super Admin",
      "unfinished": "A previous apply on this connection never reported an outcome. Its schema may be part-way between two shapes — check the change history before applying more."
    },
    "reviewPane": "Review",
    "table": {
      "addColumn": "Add column",
      "columns": "Columns",
      "drop": "Drop this table",
      "dropHelp": "The table and every row in it are destroyed. You will see exactly what breaks before anything runs.",
      "keyCounted": "Count up from the last row",
      "keyGeneration": "How the key is filled",
      "keyGenerationHelp": "Adminium reads the new row back by this key after every insert.",
      "keyGenerationOne": "On {dialect} a key must be a counted integer: a database-generated id cannot be read back after an insert.",
      "keyUnique": "A new unique id",
      "name": "Table name",
      "nameHelp": "Lowercase letters, numbers and underscores.",
      "namePlaceholder": "reservations",
      "noKey": "This table has no primary key, so Adminium will treat it as read-only — rows can be listed but not edited.",
      "renameHelp": "Changing this renames the table in your database."
    },
    "unnamed": "Name every table and column to review the changes.",
    "unrepresentableDefaults": "These columns keep a database-generated default Adminium cannot edit here, and it is left as it is: {columns}",
    "valuelessEnum": "Give {columns} at least one allowed value to review the changes.",
    "values": {
      "add": "Add value",
      "addOnly": "This list is a type in your database, and Postgres cannot remove or rename a value once it exists. You can add more.",
      "down": "Move {value} down",
      "empty": "A choice column needs at least one value before this change can be reviewed.",
      "label": "Allowed values",
      "placeholder": "in_progress",
      "remove": "Remove {value}",
      "up": "Move {value} up",
      "value": "Value {n}"
    }
  },
  "diagram": {
    "ceiling": "Showing the {shown} most connected tables. {omitted} more are hidden — search to bring one in.",
    "legend": {
      "declared": "Foreign key",
      "inferred": "Inferred",
      "virtual": "Added in Adminium"
    },
    "legendLabel": "Legend",
    "node": {
      "foreignKey": "Foreign key",
      "more": "+{count} more",
      "primaryKey": "Primary key"
    },
    "outline": {
      "intro": "{tables} tables and {relations} relations, as a list.",
      "more": " and {count} more",
      "referencedBy": "Referenced by: {list}",
      "references": "References: {list}"
    },
    "saveLayout": "Save layout",
    "search": "Find a table or column",
    "showDiagram": "Show diagram",
    "showList": "Show as list"
  },
  "documents": {
    "cancel": "Cancel",
    "connectionLabel": "Connection",
    "delete": "Delete",
    "delivery": {
      "email": "Email it to",
      "noEmail": "Nobody — keep it on the record",
      "noEmailSlot": "This kind of document has no address field, so it cannot be emailed.",
      "noSmtp": "This Adminium has no email server set up yet, so nothing can be sent. Set one up in Studio → Settings → Email.",
      "stored": "Kept on the record, always."
    },
    "disabled": "switched off",
    "edit": "Edit",
    "empty": "No mappings yet.",
    "grants": {
      "refused": "This mapping reads {tables}, which you may not read. Documents from it will fail for you.",
      "title": "You cannot read all of this"
    },
    "intro": "A mapping says which columns of which table make one kind of document, what draws it, and where it goes.",
    "name": "Name this mapping",
    "newFrom": "New mapping for:",
    "noProvider": "No installed add-on can draw documents yet. Install one from Add-ons, and the mappings you can make will appear here.",
    "pickTable": "Choose a table…",
    "prefix": "Number prefix",
    "render": {
      "failedRow": "It did not draw: {reason}",
      "intro": "Draw one now, from a row you choose. Nothing is sent anywhere — it is kept on the record like any other.",
      "noRows": "No rows to draw from yet.",
      "open": "Open it",
      "pending": "Drawing…",
      "pick": "Draw this one",
      "ready": "Drawn.",
      "saveFirst": "Save the mapping first. A document is drawn from a saved one, so you can see what it makes before anybody else does.",
      "search": "Search rows",
      "slow": "No document has appeared yet. It may still be waiting its turn, or this installation may not be running background jobs — nothing draws until it does.",
      "slowTitle": "Still nothing"
    },
    "save": "Save mapping",
    "slot": {
      "byDefault": "Filled by Adminium",
      "lineColumnOf": "{column} of each line",
      "lineColumns": "What fills each column of a line",
      "looksLikeLines": "looks like lines",
      "noChildren": "Nothing in your database points at this table, so there are no lines to draw. A document needs a child table with a foreign key back to this one.",
      "noLines": "No lines",
      "pii": "hidden data",
      "typed": "A value I type",
      "typedHint": "Entered here, not read from your data — every document from this mapping gets the same value.",
      "typedValue": "Value for {slot}",
      "unmapped": "Not filled"
    },
    "step": {
      "delivery": "Where it goes",
      "kind": "Kind",
      "mapping": "What fills each field",
      "mappingHelp": "Each field reads a column, or takes a value you type here.",
      "render": "Try it on a row",
      "table": "Connection and table",
      "trigger": "What draws it"
    },
    "tableLabel": "Table",
    "title": "Document mappings",
    "trigger": {
      "created": "When a row is added",
      "manual": "Only when somebody asks",
      "manualShort": "on request",
      "note": "Rows added by an import or written straight into the database do not draw anything — only writes through Adminium do.",
      "noteTitle": "What counts as a change",
      "updated": "When a row changes"
    },
    "unbound": "Still to fill: {slots}",
    "deleteConfirm": {
      "title": "Delete this mapping?",
      "body": "The rule that fires it goes too, and documents already drawn from it lose their link back. This cannot be undone.",
      "prompt": "Type {name} to confirm",
      "confirm": "Delete mapping"
    },
    "deleteFailed": "The mapping was not deleted",
    "loadFailed": "The mappings could not be loaded"
  },
  "enrich": {
    "byo": {
      "cardDescription": "Copy a self-contained prompt into Claude Code, ChatGPT, anything — then paste the JSON back. No key needed, nothing leaves this machine automatically.",
      "cardTitle": "Copy a prompt to my own AI tool",
      "cardTitleRecommended": "Copy a prompt to my own AI tool — recommended",
      "chunkTab": "Prompt {index}",
      "chunkTabs": "Prompt chunks",
      "chunkValid": "Chunk {index} validated",
      "continueReview": "Continue to review",
      "copyErrors": "Copy errors for your AI tool",
      "copyErrorsDone": "Errors copied",
      "copyErrorsHint": "Paste this back into your AI tool to get a corrected response.",
      "copyPrompt": "Copy prompt",
      "copyPromptDone": "Prompt copied",
      "download": "Download .md",
      "droppedItems": "{count} suggestions were dropped during validation — review shows the rest.",
      "errorsTitle": "Validation found {count} issues",
      "guidance": "Run this in any AI tool — Claude Code, ChatGPT, anything. Paste the JSON it returns below.",
      "mergedBody": "Suggestions are ready to review against the heuristic baseline.",
      "mergedTitle": "All {count} chunks validated and merged",
      "mergedTitleSingle": "Response validated",
      "pasteLabel": "Paste the JSON response",
      "pastePlaceholder": "Paste the JSON response here…",
      "pendingBody": "Paste the JSON response above and validate it to continue to review.",
      "pendingBodyChunked": "Each chunk must validate before the suggestions merge. Paste and validate every prompt above.",
      "pendingTitle": "Validate every prompt to continue",
      "promptLabel": "Enrichment prompt",
      "promptLabelN": "Enrichment prompt {index} of {total}",
      "requestFailed": "Could not reach the server to validate — retry.",
      "tokenChip": "≈ {tokens} tokens",
      "valid": "Response validated",
      "validate": "Validate",
      "wholeDocument": "whole document"
    },
    "copied": "Copied",
    "createFailed": "Could not build the enrichment prompt — retry.",
    "createFailedTitle": "Could not start",
    "direct": {
      "back": "Back to options",
      "building": "Building prompt…",
      "cancel": "Cancel",
      "continueReview": "Continue to review",
      "done": "Enrichment complete — review the suggestions.",
      "errorTitle": "Enrichment failed",
      "failed": "The provider run failed. Check your AI settings and retry.",
      "jobFailed": "The enrichment run did not finish.",
      "logLabel": "Enrichment log",
      "retry": "Retry",
      "startFailed": "Could not start the run — retry.",
      "subtitle": "Sending your schema to",
      "title": "Enriching with AI"
    },
    "fileBody": "Schema-file sources have no snapshot to enrich yet. Connect a live database to use AI enrichment, or continue — the heuristic baseline still generates a complete app.",
    "fileTitle": "AI enrichment needs a live database",
    "noTablesBody": "This database has no tables yet, so there is nothing for AI to label or group. Continue — once tables exist, you can run AI enrichment any time from Settings → AI.",
    "noTablesTitle": "No tables to enrich",
    "generatePrompt": "Generate prompt",
    "intentLabel": "How would you like to enrich?",
    "localeLocked": "(required)",
    "localesLegend": "Translate labels into",
    "noSections": "Select at least one decision group to enrich.",
    "provider": {
      "configError": "Could not load the provider settings — set one up in Settings → AI, then come back to this step.",
      "description": "Run enrichment now against your configured provider. You review every suggestion as a diff.",
      "networkDisabled": "This Adminium has no outbound internet access, so it cannot reach a provider API. Use the copy-paste round-trip instead — same prompt, same review.",
      "readyBody": "Pick “Use my AI provider” above to run enrichment on this connection now.",
      "readyTitle": "AI provider configured",
      "setUpHere": "Set up a provider here",
      "setUpHide": "Hide provider setup",
      "settingsHint": "Want to run it directly?",
      "settingsLink": "Configure a provider in Settings → AI",
      "title": "Use my AI provider",
      "unconfigured": "No AI provider is configured yet — set one up below, or copy a prompt to your own AI tool."
    },
    "providerFallback": "your AI provider",
    "samplingHint": "Includes up to 20 real values per non-PII column in the prompt.",
    "samplingPreviewBody": "Up to 20 most-common values per non-PII column, plus min/max for numeric and date columns. PII-flagged columns are never sampled. Everything else stays aggregate-only. Review the exact prompt before copying (BYO) — nothing is sent without your action.",
    "samplingPreviewTitle": "What leaves this machine",
    "samplingTitle": "Include sample values",
    "section": {
      "enums": "Enum semantics",
      "groups": "Navigation groups",
      "icons": "Icons",
      "keys": "Key columns",
      "labels": "Labels & descriptions",
      "microcopy": "Micro-copy",
      "pii": "PII & masking",
      "relations": "Relations",
      "templates": "Page templates",
      "widgets": "Dashboard widgets"
    },
    "sectionsLegend": "What should the AI decide?",
    "skip": {
      "confirmBody": "The generated app will use the heuristic labels, groups and dashboards. Continue to generate — you can run AI enrichment any time from Settings → AI.",
      "confirmTitle": "Continuing with heuristics",
      "description": "Generate from the heuristic baseline. You can enrich later from Settings → AI — skipping is never penalized.",
      "title": "Skip — use heuristics only"
    },
    "startOver": "Start over",
    "startProvider": "Start enrichment",
    "subtitle": "Optionally refine the generated labels, groups, enums and dashboards with an LLM. The heuristic baseline works without it — this only adds suggestions you review before anything applies.",
    "title": "Enrich with AI"
  },
  "generate": {
    "errorTitle": "Generation failed",
    "failed": "Generation failed — retry, or re-run introspection first.",
    "fileBody": "Your schema parsed cleanly and the preview above is real. Generating a running app straight from a schema file (with placeholder rows) is not available yet — connect a live database to generate today.",
    "fileTitle": "Schema file parsed — generation needs a live database",
    "log": {
      "classifying": "Classifying schema…",
      "composing": "Composing templates…",
      "done": "{pages} pages generated across {groups} nav groups",
      "writing": "Writing pages…"
    },
    "logLabel": "Generation log",
    "openApp": "Open your app",
    "run": "Generate dashboard",
    "subtitle": "One page per included table plus dashboards per domain — intent:",
    "successBody": "{pages} pages across {groups} navigation groups — generated from your schema, editable in Studio.",
    "successTitle": "Your dashboard is ready",
    "title": "Generate your app",
    "blankBody": "Nothing was generated, exactly as you asked. Build your first page from this connection whenever you are ready.",
    "blankTitle": "Your connection is ready",
    "createPage": "Create a page"
  },
  "hostedApps": {
    "browse": {
      "title": "Apps you can install",
      "subtitle": "Ready-made apps that came with this build. Installing one creates the tables it needs and serves its screens — nothing happens until you confirm the plan.",
      "search": "Search apps…",
      "clear": "Clear the search",
      "all": "All",
      "by": "by {publisher}",
      "install": "Install",
      "installed": "Installed",
      "missing": "Missing",
      "noMatch": "No apps match that search",
      "noMatchBody": "Try a different term, or another category.",
      "emptyTitle": "No apps are available to install",
      "emptyBody": "Apps shipped with this build appear here. Point ADMINIUM_BUNDLED_APPS at a directory of app bundles, or upload one yourself.",
      "unreadable": "This package’s manifest could not be read. It cannot be installed — discard it below.",
      "subtitleOnline": "Apps that came with this build, plus those in the online catalogue. Installing one downloads it if needed and creates the tables it needs — nothing happens until you confirm the plan.",
      "neverChecked": "The online catalogue is on but has not been checked yet. Check for newer to list its apps.",
      "refresh": "Check for newer",
      "toggle": "Browse the online app catalogue",
      "emptyOnlineBody": "The online catalogue is on, but nothing is listed yet. Check for newer to fetch it.",
      "fromCatalog": "Online",
      "needsNewer": "Needs Adminium {version} or later"
    },
    "domains": {
      "add": "Attach a domain",
      "docsLink": "How to set up a domain",
      "hostLabel": "Host",
      "instanceLabel": "Instance",
      "instanceOwn": "The app's own",
      "issuesTitle": "The domain map was refused",
      "none": "No domains are attached.",
      "remove": "Remove",
      "save": "Save domains",
      "savedBody": "Mappings take effect within a few seconds. A host only answers once its DNS and your proxy actually reach this instance.",
      "savedTitle": "Saved",
      "stepDns": "Point the host at this server in your DNS — the same record type and target as the address you use for this dashboard.",
      "stepProxy": "Give the host its own site block on your reverse proxy, passing the Host header through unchanged — then reload the proxy. Editing its config file does not change a process that is already running.",
      "stepSignIn": "Staff surfaces ask you to sign in again: session cookies belong to one host, so a mapped host sends you to its own login page first.",
      "subtitle": "Point a domain’s DNS at your proxy, pass the Host header through to Adminium, and attach it here — that host then serves the surface instead of this dashboard. Certificates stay on your proxy.",
      "surfaceLabel": "Surface",
      "title": "Domains"
    },
    "emptyBody": "Point ADMINIUM_SURFACES_DIR at a directory of built surfaces — one folder per app and side, each with its index.html — and restart. They are then served under /apps/ and appear here.",
    "emptyTitle": "No app surfaces are being served",
    "error": "Something went wrong",
    "install": {
      "steps": {
        "bundle": "Bundle",
        "database": "Database",
        "plan": "Schema plan",
        "done": "Done"
      },
      "progress": "Install progress",
      "failed": "Install failed",
      "bundle": {
        "title": "Upload the app bundle",
        "hint": "The app’s release file (.tgz) — it holds manifest.json and a staff/ or customer/ directory.",
        "file": "Bundle file (.tgz)",
        "fileHint": "Nothing is created until you confirm on the schema-plan step.",
        "integrity": "Integrity (optional)",
        "integrityHint": "Paste the sha512- fingerprint published with the release to have the server check these exact bytes. Left empty, it is computed here."
      },
      "database": {
        "title": "Install into which database?",
        "hint": "Pick a writable connection. This is where the tables will be created, and it is what the app reads afterwards.",
        "tables": "Tables: {count}",
        "readOnly": "Read-only",
        "writable": "Writable",
        "noWritable": "No writable connection",
        "allReadOnly": "Every connection here uses a read-only role, so no app can create its tables. Connect one that can run DDL first."
      },
      "plan": {
        "title": "Review the schema plan",
        "hint": "Exactly what will be created in your database. Nothing has been written yet.",
        "refused": "This app cannot be installed here",
        "create": "Create",
        "reuse": "Reuse existing",
        "toggleDdl": "Show the DDL preview",
        "ddl": "DDL preview",
        "ddlNote": "Illustrative. The server emits the exact statement for your engine, including foreign keys.",
        "summary": "{created} created · {reused} reused",
        "pageWarnings": "Some of this app’s pages will arrive without a table"
      },
      "done": {
        "body": "{key} is being served now. Choose where its staff side appears below.",
        "titleApp": "{app} is installed",
        "tablesCreated": "Tables created in {connection}",
        "tablesKept": "Tables used as they were",
        "pages": "Pages generated",
        "sampleNotAdded": "not added",
        "sampleAdding": "adding…",
        "sampleAdded": "added",
        "sampleLater": "You can add it later from the app’s page."
      },
      "cancel": "Cancel",
      "back": "Back",
      "upload": "Upload",
      "continue": "Continue",
      "confirm": "Install",
      "finish": "Manage apps",
      "staged": "Files unpacked: {files}",
      "footerStep": "Step {n} of {total}",
      "footerStepApp": "Step {n} of {total} · {app}",
      "chosen": {
        "title": "Install {app}",
        "hint": "This app came with your build and is already on disk. Nothing is created until you confirm the schema plan."
      },
      "downloaded": {
        "hint": "Downloaded from the online app catalogue and checked against its published fingerprint. Nothing is created until you confirm the schema plan."
      },
      "uploaded": {
        "hint": "Read from the manifest.json inside the bundle you uploaded. Nothing is created until you confirm the schema plan.",
        "replace": "Upload a different bundle"
      },
      "check": {
        "title": "Check the tables",
        "hint": "{app} will create these in {connection}. Nothing changes until you press Install.",
        "summaryNew": "{count} new",
        "summaryEarlier": "{count} from your earlier install",
        "summaryShared": "{count} shared with another app",
        "summaryTaken": "{count, plural, one {# name taken} other {# names taken}}",
        "altPrefixInUse": "Checked with the prefix {prefix}.",
        "usualPrefix": "Use the usual prefix",
        "badgeNew": "New",
        "badgeEarlier": "Yours from an earlier install",
        "badgeShared": "Shared with {app}",
        "badgeTaken": "Name taken",
        "columns": "{count, plural, one {# column} other {# columns}}",
        "keep": "Use it and keep its data",
        "sharedNote": "{app} uses this table too. Both apps keep reading and writing the same rows.",
        "earlierNote": "Adminium made this table on an earlier install of {app}.",
        "createPreview": "Create preview",
        "addsColumns": "{count, plural, one {Adds # column:} other {Adds # columns:}}",
        "widens": "Makes {column} wider, from {from} to {to}.",
        "setIdentity": "{column} numbers new rows by itself.",
        "enumValues": "{column} also accepts {values}.",
        "noLoss": "No column is removed and no data is lost.",
        "reuseNote": "The app reads and writes the rows already there.",
        "renameTitle": "Rename the existing table out of the way",
        "renameNote": "A fresh {table} is created for the app.",
        "renameField": "New name for the existing table",
        "renameFieldNote": "Adminium repairs its own pages and rules that pointed at the old name.",
        "prefixTitle": "Use a different prefix for this app",
        "prefixNote": "Applies to all of the app’s tables at once.",
        "prefixField": "Prefix",
        "prefixFieldNote": "{count, plural, one {The table will be checked again.} other {All # tables will be checked again.}}",
        "takenIntro": "{table} already exists and was made by hand. Pick what to do with it.",
        "takenIntroShort": "What to do with {table}",
        "pickFirst": "Pick what to do with {table} before you install.",
        "checkFirst": "Check the tables again before you install.",
        "nothingYet": "Nothing changes until you press Install.",
        "again": "Check again",
        "adoptedNote": "An earlier install of {app} used this table as it found it."
      },
      "running": {
        "title": "Installing {app}",
        "hint": "Writing to {connection}.",
        "tables": "Tables",
        "pages": "Pages"
      },
      "stopped": {
        "failed": "failed",
        "notStarted": "not started",
        "atTables": "Creating the tables failed, so nothing after that ran.",
        "atIntrospect": "The tables were made. Reading them back failed, so nothing after that ran.",
        "atPages": "The tables were made. Creating the pages failed, so nothing after that ran.",
        "atFinish": "The tables and pages were made. Finishing the install failed.",
        "title": "The install stopped part way",
        "created": "{count} created",
        "made": "made",
        "said": "What the database said",
        "saidAbout": "What the database said about {table}",
        "resume": "Nothing was removed. Trying again finishes from where it stopped.",
        "retry": "Try again",
        "back": "Back to Schema plan"
      }
    },
    "installed": {
      "title": "Installed apps",
      "install": "Install an app",
      "emptyTitle": "No apps installed yet",
      "emptyBody": "Upload a built surface bundle to install one. Apps installed here are served immediately — no restart, unlike a directory you point at.",
      "uninstall": "Uninstall",
      "stagedTitle": "Uploaded but not installed",
      "stagedHint": "Discard one you decided against, or upload the same key again to replace it.",
      "discard": "Discard",
      "installedAt": "installed {when}",
      "updatesAvailable": "{count, plural, one {# update available} other {# updates available}}",
      "updateTo": "Update to v{version}",
      "needsNewer": "v{version} needs Adminium {minimum} or later",
      "missing": "Missing",
      "missingBody": "Its files are not on this server, so it is not served. Install the same version again, or uninstall it.",
      "update": "Update",
      "discardFailed": "The upload was not discarded",
      "renamed": "Tables renamed to {prefix}…",
      "oldNames": "This install uses the old table names.",
      "oldNamesWhy": "They were made before prefixes.",
      "renameTo": "Rename to {prefix}…"
    },
    "instances": {
      "add": "Add an instance",
      "appLabel": "App",
      "body": "Serve the same app over more than one database. Each instance is reachable at /apps/<app>/<segment>/<side>/ and reads only the connection you give it.",
      "empty": "No extra instances.",
      "failed": "Instances were not saved",
      "readsLabel": "Reads",
      "remove": "Remove",
      "save": "Save instances",
      "slugLabel": "URL segment",
      "title": "Instances"
    },
    "job": {
      "refreshTitle": "Checking the online app catalogue",
      "downloadTitle": "Downloading {app}",
      "body": "Fetching and verifying. Nothing is installed or changed until you say so.",
      "failed": "The job did not finish. Nothing was installed or changed."
    },
    "names": {
      "label": "Name for {app}",
      "save": "Save name",
      "subtitle": "What each app is called — in its own screens and in this dashboard’s sidebar. Leave it empty to use the name the app was built with.",
      "title": "App names"
    },
    "subtitle": "The app surfaces this instance serves — where each one appears, and the domains pointed at them.",
    "surfaces": {
      "boundKey": "Serves key",
      "connectionLabel": "Reads",
      "connectionUnset": "Whichever is serving",
      "customer": "Customer",
      "mintLink": "Mint one under Public API",
      "noKey": "No key bound — this surface cannot read data until one is minted for it.",
      "noNav": "Internal placement unavailable — rebuild this surface with the current toolkit so it emits surface.json.",
      "placementExternal": "External (own URL only)",
      "placementInternal": "In the sidebar (blended)",
      "placementLabel": "Placement",
      "staff": "Staff",
      "subtitle": "A staff surface can blend into this dashboard’s sidebar or stand on its own; a customer surface is public and reads through its bound key.",
      "title": "Surfaces"
    },
    "title": "Hosted apps",
    "update": {
      "title": "Update {app} to v{version}",
      "subtitle": "This version needs tables the installed one did not have.",
      "body": "They are created in the database this app already uses. Tables that are already there are not changed.",
      "cancel": "Cancel",
      "confirm": "Update",
      "close": "Close",
      "done": "{app} updated to v{version}",
      "missingColumns": "Missing: {tables}.",
      "checkSubtitle": "Check the tables this version uses.",
      "pickFirst": "Pick what to do with {table} before you update.",
      "checkFirst": "Check the tables again before you update.",
      "nothingYet": "Nothing changes until you press Update."
    },
    "veto": {
      "title": "This deployment cannot browse online",
      "body": "The setting is saved, but network features are off for this server and that wins. Installed apps keep working, and you can still upload one yourself."
    },
    "columns": {
      "title": "Update {app} to v{version}",
      "subtitle": "This version needs columns that tables in your database do not have yet.",
      "body": "Adminium can add them for you. You will see the exact statement before anything runs, nothing is removed, and the app is updated only once the columns exist.",
      "alsoCreates": "The update also creates these tables:",
      "noDdl": "Adminium cannot add these columns here",
      "failed": "The columns could not be added",
      "valuesFailed": "The columns were added, but their allowed values could not be recorded",
      "confirm": "Add the columns and update"
    },
    "rename": {
      "title": "Rename tables to {prefix}…",
      "subtitle": "{count, plural, one {# table in {connection}} other {# tables in {connection}}}",
      "close": "Close",
      "body": "This install was made before prefixes. Renaming gives every table the app’s prefix, so {app} can recognise its own tables.",
      "planFailed": "The rename could not be planned",
      "refused": "These tables cannot be renamed here",
      "failed": "The tables were not renamed",
      "repair": "Adminium also updates its own pages and rules that point at the old names.",
      "cancel": "Cancel",
      "confirm": "Rename tables"
    }
  },
  "hub": {
    "action": {
      "delete": "Delete",
      "pause": "Pause",
      "pausedHint": "This connection is paused — resume it to reach the database.",
      "regional": "Regional settings",
      "reintrospect": "Re-introspect",
      "reintrospectFile": "Schema-file sources have no live database — re-upload the file instead.",
      "remap": "Remap schema",
      "rename": "Rename",
      "resume": "Resume",
      "test": "Test"
    },
    "card": {
      "lastIntrospected": "Last introspected",
      "latency": "Latency",
      "latencyMs": "{latency, number} ms",
      "never": "Never",
      "pages": "Pages",
      "paused": "Adminium is not connecting to this database. Its pages load again when you resume it.",
      "pausedSince": "Paused {when} — Adminium is not connecting to this database. Its pages load again when you resume it.",
      "readOnly": "Read-only",
      "tables": "Tables",
      "timezone": "Timezone",
      "timezoneGuessed": "from this server",
      "timezoneNone": "not set — dates render in {zone}, this server’s zone"
    },
    "connectNew": "New connection",
    "delete": {
      "body": "This deletes “{name}” and its generated pages. Your database itself is never touched.",
      "cancel": "Cancel",
      "close": "Close",
      "confirm": "Delete connection",
      "failed": "Could not delete the connection. Try again.",
      "prompt": "Type {name} to confirm",
      "success": "Connection “{name}” deleted",
      "title": "Delete connection",
      "forbidden": "Your role does not include managing connections, so this one was not deleted.",
      "liveKeys": {
        "body": "Pages built on these keys would stop working. Revoke them on the Public API page first, then delete the connection.",
        "title": "Publishable keys still use this connection"
      }
    },
    "empty": {
      "body": "Connect a database and Adminium generates your admin panel from its schema.",
      "cta": "Connect a database",
      "title": "No data sources yet"
    },
    "hostedApps": "Hosted apps",
    "introspect": {
      "failed": "Introspection failed. Try again.",
      "masksProposed": "{count, plural, one {# column} other {# columns}} proposed for masking — review in the remap editor.",
      "noChanges": "Schema unchanged — no new snapshot.",
      "updated": "Schema re-introspected"
    },
    "pause": {
      "body": "Adminium stops opening any connection to “{name}”. Its {pages, plural, one {# page} other {# pages}}, scheduled reports and hosted apps stop loading data until you resume it.",
      "confirm": "Pause connection",
      "keeps": "Nothing is deleted — the connection, its schema and its {pages, plural, one {# page} other {# pages}} are all kept, and one click brings them back.",
      "pauseFailed": "Could not pause the connection. Try again.",
      "pausedToast": "Connection “{name}” paused",
      "resumeFailed": "Could not resume the connection. Try again.",
      "resumedToast": "Connection “{name}” resumed",
      "title": "Pause this connection?"
    },
    "regional": {
      "currency": "Currency",
      "currencyHelper": "Used to format money. Optional — leaving it unset affects formatting only.",
      "currencyPlaceholder": "ISO-4217 code",
      "failed": "Regional settings could not be saved",
      "guessedBody": "Adminium filled it in from the machine it runs on, not from anyone here. Save to confirm it, or pick the zone this business actually keeps.",
      "guessedTitle": "This zone came from the server",
      "intro": "These describe the business this database belongs to, not the person reading it. Apps served from Adminium read them from here.",
      "noMatch": "No matching zone",
      "noMatchCurrency": "No matching currency",
      "notSet": "Not set",
      "save": "Save",
      "saved": "Regional settings updated",
      "timezone": "Timezone",
      "timezoneHelper": "Dates and times render in this zone. Apps hosted by Adminium fall back to UTC without one, and say on screen that they are doing it.",
      "timezonePlaceholder": "Region/City",
      "title": "Regional settings"
    },
    "rename": {
      "failed": "The connection could not be renamed",
      "helper": "What this database is called throughout Adminium — the card, the sidebar group over its pages, and every picker that offers it. The database itself is not renamed.",
      "label": "Name",
      "save": "Rename",
      "saved": "Connection renamed",
      "title": "Rename connection"
    },
    "stats": {
      "connections": "Connections",
      "healthy": "Healthy",
      "pages": "Generated pages",
      "tables": "Tables included"
    },
    "status": {
      "connected": "Connected",
      "error": "Error",
      "paused": "Paused",
      "testing": "Testing…",
      "unconfigured": "Draft"
    },
    "subtitle": "{healthy, number} of {total, plural, one {# connection} other {# connections}} healthy",
    "subtitlePaused": "{healthy, number} of {total, plural, one {# connection} other {# connections}} healthy · {paused, number} paused",
    "test": {
      "failed": "Connection test failed",
      "ok": "Connection healthy · {latency, number} ms"
    },
    "title": "Data connections"
  },
  "intent": {
    "analytics": {
      "description": "Dashboards, charts and read-only grids. No forms, no writes — every role capped at Viewer.",
      "title": "Read-only analytics"
    },
    "crud": {
      "description": "One editing page per table plus search and import/export — a minimal home, no dashboards.",
      "title": "CRUD tables"
    },
    "fullAdmin": {
      "description": "Dashboards, CRUD pages, search, imports and exports — everything your schema supports.",
      "title": "Full admin panel"
    },
    "subtitle": "The intent shapes which pages get generated. You can change it later — changing it proposes a regeneration, never a silent rewrite.",
    "support": {
      "description": "Queues, ticket and customer detail pages first. Deletes off by default. (Queue templates land in M7 — the v1 page set matches Full admin.)",
      "title": "Support console"
    },
    "title": "What do you need?",
    "trust": "We read your schema only — never your row data during setup.",
    "blank": {
      "description": "Generate nothing. Connect a database and build the pages you want, one at a time.",
      "title": "Blank canvas"
    }
  },
  "llmRuns": {
    "review": {
      "applied": {
        "body": "The accepted suggestions below are read-only.",
        "title": "This run has been applied"
      },
      "apply": {
        "confirm": "Apply changes",
        "empty": "Nothing selected to apply.",
        "subtitle": "These changes are written in one transaction and can be undone.",
        "title": "Apply {n} suggestions"
      },
      "applyFailed": "Nothing was applied",
      "applyUnknown": "The server did not say why.",
      "bulk": {
        "acceptAll": "Accept all ≥ {pct}%",
        "clear": "Clear selection",
        "thresholdAria": "Accept-all confidence threshold",
        "thresholdLabel": "Confidence threshold"
      },
      "cat": {
        "copy": "micro-copy",
        "dashboard": "dashboard",
        "enum": "enum",
        "group": "navigation group",
        "key": "key columns",
        "label": "label",
        "pii": "PII",
        "relation": "relation",
        "template": "page template",
        "widget": "widget"
      },
      "empty": {
        "body": "This run produced no suggestions to review.",
        "title": "No suggestions"
      },
      "error": {
        "title": "Could not load this run"
      },
      "footer": {
        "apply": "Apply {n} accepted suggestions",
        "count": "{n} suggestions selected",
        "failed": "Apply failed"
      },
      "group": {
        "dashboards": "Dashboards & widgets",
        "enums": "Enum semantics",
        "icons": "Icons",
        "keys": "Key columns",
        "labels": "Labels & translations",
        "microcopy": "Micro-copy",
        "navigation": "Navigation & domains",
        "pii": "PII & masking",
        "relations": "Relations",
        "templates": "Page templates"
      },
      "header": {
        "agree": "{n} agree",
        "byo": "BYO",
        "conflict": "{n} conflict",
        "countsAria": "Suggestion counts",
        "model": "Model",
        "new": "{n} new",
        "pathByo": "Copy-paste",
        "pathDirect": "Direct API",
        "rejects": "{n} rejects",
        "snapshot": "Snapshot",
        "title": "Review AI suggestions"
      },
      "notReady": {
        "body": "A run must be validated before its suggestions can be reviewed. Generate or paste a response first.",
        "title": "This run has no suggestions to review yet"
      },
      "row": {
        "acceptAria": "Accept {noun} suggestion for {target}",
        "confidenceAria": "Confidence {pct}%",
        "hideTranslations": "Hide translations",
        "keptEdited": "kept — edited by you",
        "noAi": "No AI suggestion",
        "rejectsCallout": "The AI rejects a heuristic decision — confirm before accepting.",
        "showTranslations": "Show translations"
      },
      "section": {
        "acceptedCount": "{n} accepted",
        "selectAllAria": "Select all in {group}"
      },
      "status": {
        "agree": "Agrees",
        "conflict": "Conflict",
        "heuristicOnly": "Heuristic only",
        "locked": "Locked",
        "new": "New",
        "rejects": "Rejects heuristic"
      },
      "toast": {
        "applied": "Applied {n} suggestions",
        "appliedPartial": "Applied {n} suggestions (some skipped)",
        "applyFailed": "Could not apply suggestions",
        "undoFailed": "Could not undo this change"
      },
      "value": {
        "absent": "None",
        "dash": "—",
        "description": "Description",
        "display": "Display",
        "enumCategory": "Category",
        "enumWorkflow": "Workflow",
        "guidance": "Empty-state guidance",
        "headline": "Empty-state headline",
        "key": "Key",
        "label": "Label",
        "none": "No value",
        "notPii": "Not PII",
        "rank": "rank {n}",
        "span": "span {n}",
        "subtitle": "Page subtitle",
        "tableCount": "{n} tables",
        "widgetCount": "{n} widgets"
      }
    }
  },
  "meta": {
    "move": {
      "copying": "Moving Adminium’s tables…",
      "copyingBody": "Copying every adminium_ table into the new database. Your source data is not touched, and nothing is switched over until the copy is verified.",
      "failed": "Could not move Adminium’s tables — retry.",
      "restarting": "Restarting…",
      "restartingBody": "The copy is done. Adminium is restarting onto the new database — this page will continue by itself in a few seconds.",
      "timeout": "Adminium moved its tables but has not come back yet. Your data is safe in the new database — reload this page in a moment.",
      "title": "Moving Adminium’s tables"
    },
    "sameDb": {
      "description": "adminium_* tables are created beside your source tables. Simplest setup — needs a role with write and CREATE TABLE privileges.",
      "disabledFile": "A schema file has no live database — choose a separate database for Adminium’s own tables.",
      "disabledNoDdl": "This role cannot run DDL — Adminium migrations need CREATE TABLE. Choose a separate database for Adminium’s own tables.",
      "disabledReadOnly": "Your role is read-only — Adminium never writes to this database. Choose a separate database for Adminium’s own tables.",
      "title": "Same database"
    },
    "separate": {
      "description": "Adminium keeps its tables in a different database. Your source stays untouched — required for read-only sources.",
      "dsn": "Meta database connection string",
      "errorTitle": "Meta store not compatible",
      "helper": "Needs write + DDL privileges — Adminium runs its own migrations there.",
      "insufficient": "This role cannot host the meta store — Adminium needs write and CREATE TABLE privileges there.",
      "ok": "Compatible — write ✓ · DDL ✓",
      "test": "Test connection",
      "title": "Separate database"
    },
    "subtitle": "Pages, roles, audit log and settings live in adminium_-prefixed tables — never mixed into your data.",
    "testFailed": "Connection failed.",
    "title": "Where should Adminium keep its own tables?",
    "v1Note": {
      "body": "This server already keeps its own tables in a configured database, and this step does not move them. It validates that your choice is compatible with this connection — the server enforces the same rule independently (409 META_PLACEMENT_INVALID).",
      "title": "About this install"
    },
    "willMove": {
      "body": "Adminium is currently using its built-in SQLite store. Continue copies that store into the database you picked and restarts onto it — accounts, pages and settings come with it, so you stay signed in.",
      "title": "This will move Adminium’s tables"
    }
  },
  "pages": {
    "action": {
      "delete": "Delete page",
      "duplicate": "Duplicate",
      "edit": "Edit page",
      "hide": "Hide from sidebar",
      "show": "Show in sidebar"
    },
    "attachments": {
      "accept": "Accepted file types",
      "acceptHint": "Choosing none accepts everything this workspace allows. A choice here can only narrow that list, never widen it.",
      "column": {
        "adoptHint": "This table already has that column, so nothing is created — it is used as it is.",
        "bound": "Files are stored in this table’s {column} column.",
        "boundHint": "Turning attachments off later unbinds this page. The column and the files in it are left alone.",
        "confirm": "Run it",
        "create": "Create the column",
        "createHint": "Adminium adds one text column to this table. You will see the exact statement before anything runs.",
        "createdHint": "The column exists now. Save this page to finish wiring it up.",
        "failed": "That did not work",
        "invalid": "A column name must start with a letter and use only lowercase letters, digits and underscores.",
        "label": "Column that holds the files",
        "required": "Give the column a name.",
        "tooLong": "That name is too long for a column.",
        "use": "Use this column",
        "wrongType": "This table already has a column with that name, and it cannot hold a file reference. Pick another name."
      },
      "destination": "Where the files go",
      "destinationDefault": "The default destination",
      "destinationHint": "Leave this on the default unless this table’s files belong somewhere else.",
      "destinationIsDefault": "{name} (the default)",
      "destinationLocal": "This server’s disk",
      "enable": "Allow attachments on this table’s records",
      "enableHint": "Files are linked on Adminium’s side, so this table needs no new column — it works on a read-only connection, and on a table you would rather not alter.",
      "enableHintColumn": "Files are stored in one column on this table, so they appear in the New and Edit dialogs as well as on each record.",
      "enableHintSidecar": "Files are linked on Adminium’s side instead. They appear on each record’s page, not in the New dialog.",
      "maxBytes": "Largest file (MB)",
      "maxBytesHint": "Leave empty to follow the workspace limit. A number here can only lower it.",
      "maxCount": "Most files per record",
      "maxCountHint": "Leave empty to accept as many as a record needs.",
      "sidecar": {
        "noPrivilege": "This connection's role cannot alter tables, so Adminium cannot add a column to it.",
        "readOnlyIntent": "This connection is set up for read-only analytics, so Adminium cannot add a column to it.",
        "readOnlyRole": "This connection signs in with a read-only role, so Adminium cannot add a column to it.",
        "schemaFile": "This connection was created from a schema file, so Adminium cannot add a column to it."
      },
      "type": {
        "office": "Office documents",
        "text": "Plain text"
      }
    },
    "columns": {
      "addFromLinked": "From linked tables",
      "addFromTable": "From {table}",
      "addLinkedFrom": "Tables that link here",
      "addLinkedFromHelp": "Count the rows that point at each record, or add up one of their numbers.",
      "addLinkedHelp": "Show a value from the table a link column points to.",
      "addNoMatches": "No columns match “{query}”.",
      "addOpen": "Add column",
      "addSearch": "Search columns…",
      "addTitle": "Add a column",
      "addVia": "via {column}",
      "avatar": "Avatar",
      "avatarToggle": "Show a monogram beside {name}",
      "countBadge": "Count",
      "dragHandle": "Reorder {name}",
      "empty": "No columns yet — add them below.",
      "file": {
        "acceptHelp": "Leave every type off to accept whatever this workspace accepts. Choosing types can only narrow that list — a column can never accept a type the workspace refuses.",
        "acceptLabel": "Accepted types",
        "badge": "File",
        "destinationDefault": "The default destination",
        "destinationHelp": "Where the bytes uploaded through this column are kept.",
        "destinationLabel": "Destination",
        "inlineHelp": "Only images are drawn in the cell. Everything else stays a chip with its name and size, however this is set.",
        "inlineLabel": "Show it in the table",
        "maxCountHelp": "Leave empty to accept as many as a record needs.",
        "maxCountLabel": "Most files per record",
        "maxCountToggle": "Most files on one {name}",
        "maxHelp": "Leave empty to use the workspace limit. A column can only ask for less.",
        "maxLabel": "Largest file (MB)",
        "maxToggle": "Largest file accepted by {name}, in MB",
        "multipleHelp": "The column stores a list of files instead of one. Existing single values keep working — they read as a list of one.",
        "multipleLabel": "Hold more than one file",
        "ref": {
          "id": "Adminium's file id",
          "key": "The key in the destination",
          "url": "A link to the file"
        },
        "refHelp": "What is written into this column when a file is uploaded. Values already stored keep working — this only changes the next one.",
        "refLabel": "Stored value",
        "refTooNarrow": "This column is too short to hold that value. Pick one it can hold, or widen the column in the database.",
        "refWidth": "{shape} — needs {needs} characters, this column holds {holds}",
        "switch": "File",
        "switchToggle": "{name} stores a file",
        "type": {
          "csv": "CSV",
          "gif": "GIF",
          "heic": "HEIC",
          "jpeg": "JPEG",
          "json": "JSON",
          "markdown": "Markdown",
          "mp3": "MP3 audio",
          "mp4": "MP4 video",
          "office": "Office documents",
          "ogg": "Ogg",
          "pdf": "PDF",
          "png": "PNG",
          "svg": "SVG",
          "text": "Plain text",
          "wav": "WAV audio",
          "webm": "WebM",
          "webp": "WebP",
          "zip": "ZIP"
        }
      },
      "fold": {
        "avg": "Average",
        "max": "Max",
        "min": "Min",
        "sum": "Sum"
      },
      "foldAdd": "Add",
      "foldLabel": "Aggregate",
      "followColumn": "Follow {name}",
      "header": "Header for {name}",
      "help": "Drag to reorder columns, rename their headers, and choose which are shown in the table.",
      "lookupBack": "Back",
      "lookupBadge": "Linked",
      "lookupBroken": "That link no longer resolves",
      "lookupBrokenBody": "The schema changed while you were browsing. Start the link again.",
      "lookupBrowse": "Pick what to show from {table}",
      "mask": "Mask",
      "maskHelp": "Mask hides a value behind a reveal control for readers allowed to see it. Whether the data leaves the database at all is set on the connection, not here.",
      "maskToggle": "Hide {name} behind a reveal control",
      "masked": "Masked",
      "none": {
        "body": "Columns are read from the table when the page is generated. Bind this page to a table and regenerate to fill them in.",
        "title": "This page has no columns yet"
      },
      "pk": "Key",
      "remove": "Remove {name}",
      "schemaUnavailable": "Database columns could not be listed, so columns cannot be added back here.",
      "shown": "Shown",
      "toggle": "Show {name} in the table"
    },
    "create": {
      "failed": "The page could not be created",
      "submit": "Create page",
      "subtitle": "Pick what this page shows and how it looks.",
      "title": "New page"
    },
    "createButton": "New page",
    "delete": {
      "body": "This cannot be undone. Saved views and personal layouts on this page are deleted for everyone.",
      "bodyGenerated": "This page was created by schema generation, so it will come back the next time you regenerate. Saved views and personal layouts on it are deleted for everyone.",
      "confirm": "Delete page",
      "prompt": "Type {slug} to confirm",
      "title": "Delete this page?",
      "failed": "The page was not deleted"
    },
    "derived": {
      "add": "Add column",
      "atLeast": "is at least",
      "cancel": "Cancel",
      "emptyBody": "Summarize a linked table in the Columns card first — the rules here are built from those numbers.",
      "emptyTitle": "No computed numbers yet",
      "fieldBadge": "Computed",
      "foldBadge": "Fold",
      "help": "Work out numbers from the summaries above and this record’s own columns. They are calculated when the page loads and cannot be sorted.",
      "label": "Column header",
      "minus": "minus",
      "numberHelp": "Numbers are plain decimals — 500 or 12.50, never 1,000 or 5e3.",
      "operandA": "Number",
      "operandB": "Number",
      "operator": "Operator",
      "otherwise": "otherwise",
      "percentOf": "per cent from this record",
      "plus": "plus",
      "preset": {
        "combine": "Add or subtract two numbers",
        "percent": "Percentage of a number",
        "rule": "Rule with a threshold"
      },
      "previewHelp": "Sample values, calculated by the same code the page uses.",
      "previewTitle": "Preview",
      "remove": "Remove {name}",
      "thenShow": "then show"
    },
    "duplicate": {
      "failed": "The page could not be duplicated",
      "submit": "Duplicate",
      "title": "Duplicate page"
    },
    "editor": {
      "appearance": "Appearance",
      "attachments": "Attachments",
      "columns": "Columns",
      "contentInvalid": "This page’s configuration is not readable",
      "contentInvalidBody": "It was written by a newer version, or it is malformed. Regenerate the page or delete it.",
      "contentUnavailable": "Page contents could not be loaded",
      "contentUnavailableBody": "The details above can still be saved.",
      "data": "Data",
      "derived": "Derived numbers",
      "details": "Details",
      "generated": {
        "body": "Your changes survive regeneration. Deleting only lasts until the next run recreates it.",
        "title": "This page was generated from your schema"
      },
      "itemsPending": "Save the change above first — the contents are rebuilt from it.",
      "missing": "That page no longer exists",
      "missingBody": "It may have been deleted, or removed by a regeneration run.",
      "notBindable": "This template is not bound to one table",
      "notBindableBody": "Its contents are built widget by widget instead. Open the page and use Edit to add them.",
      "openPage": "Open page",
      "recompose": "This page will be rebuilt",
      "recomposeBody": "Saving rebuilds the contents. Column and widget edits here are lost.",
      "save": "Save changes",
      "saveFailed": "Changes could not be saved",
      "schemaFailed": "Tables could not be listed",
      "schemaFailedBody": "This connection may not have been analysed yet. Run introspection from Studio → Data connections.",
      "title": "Edit page"
    },
    "empty": {
      "body": "Connect a database to generate pages automatically, or create one by hand.",
      "title": "No pages yet"
    },
    "field": {
      "connection": "Data source",
      "connectionNone": "None",
      "group": "Sidebar group",
      "groupHint": "Which section of the sidebar it appears in.",
      "icon": "Icon",
      "iconHint": "Shown beside the page name in the sidebar.",
      "iconPick": "Choose the page icon",
      "newRowLabel": "Add button",
      "newRowLabelHint": "What the button that adds a record says. Leave empty to use the default, which is translated.",
      "padding": "Page padding",
      "slug": "Page address",
      "slugHint": "Lowercase letters, numbers and dashes. Just the last part — the rest of the address is added for you.",
      "slugTaken": "Another page already uses this address.",
      "slugWarning": "Changing the address breaks existing links and bookmarks to this page.",
      "table": "Table",
      "tableChoose": "Choose a table…",
      "tableCreateHint": "The table this page reads.",
      "tableNeedsConnection": "Pick a data source first.",
      "tableNoConnection": "Connect a database first — this page is built from one of its tables.",
      "tableNone": "Not bound",
      "template": "Template",
      "templateHint": "Decides what the page can hold. You can change it later.",
      "title": "Title",
      "titleHint": "Shown in the sidebar and the page header.",
      "visible": "Show in sidebar",
      "visibleHint": "A hidden page stays reachable at its URL for anyone who has the link.",
      "width": "Content width",
      "widthHint": "How wide the page’s content column may grow on a large screen.",
      "groupApp": "In its app’s own section"
    },
    "filters": {
      "add": "Add a filter",
      "control": "Control for {column}",
      "down": "Move {column} down",
      "empty": "This page has no filters. Add one below.",
      "full": "A page shows at most {max} filters.",
      "name": "Name for {column}",
      "remove": "Remove {column} filter",
      "reset": "Back to the suggested filters",
      "subtitle": "The questions the toolbar can ask about this table. Untouched, it follows the table.",
      "title": "Filters",
      "up": "Move {column} up"
    },
    "fit": {
      "alternatives": {
        "title": "Use a table that already fits",
        "help": "Nothing is written to your database — this only points the page at a table that already has what it needs.",
        "use": "Use this table"
      },
      "checkFailed": "Adminium could not check this table",
      "checkFailedBody": "You can still create the page. If the table cannot back it, creating it will say so.",
      "columns": {
        "title": "Add what is missing to this table",
        "help": "Adminium adds these columns to your table. You will see the exact statement before anything runs, and nothing is removed.",
        "review": "Review the change",
        "confirm": "Run it",
        "failed": "That did not work",
        "partial": "One thing this page needs cannot be added for you, so it will still be incomplete afterwards.",
        "cannot": "Adminium cannot add this one for you",
        "cannotBody": "This page needs a link to another table, which has to be set up in Studio → Schema.",
        "halfDone": "The columns were added, but Adminium could not record what they mean",
        "halfDoneBody": "Nothing needs running again — the columns exist. Set their meaning in Studio → Schema, or ask an administrator to."
      },
      "needs": "To build this page, the table needs:",
      "noDdl": "Adminium cannot change this table for you",
      "role": {
        "eventDate": "a date on each row",
        "title": "a text column to show as each row’s title",
        "status": "a status column whose values read as workflow states",
        "personFk": "a link to a table of people",
        "shiftType": "a column saying which kind of shift each row is"
      },
      "slotOnly": "Nothing on this table can fill its “{slot}” area.",
      "tag": {
        "title": "Use a column you already have",
        "help": "This only records what the column means. Your database is not changed, and you can undo it in Studio → Schema.",
        "action": "Use this column",
        "failed": "That column could not be marked"
      },
      "title": "This table cannot back this page yet",
      "table": {
        "title": "Start a new table for this page",
        "help": "Adminium creates a table with everything this page needs. You will see the exact statement before anything runs, and your other tables are not touched.",
        "open": "Or start a new table for this page",
        "name": "Table name",
        "nameTaken": "A table with this name already exists.",
        "nameInvalid": "Use lowercase letters, numbers and underscores, starting with a letter.",
        "people": "Assign each row to someone from",
        "peopleNew": "A new table of people",
        "peopleCreated": "Also creates “{table}”, a small table of the people rows are assigned to.",
        "noCompose": "A table under this name would not work for this page. Try another name.",
        "confirm": "Create the table",
        "noDdl": "Adminium cannot create a table here",
        "halfDone": "The table was created, but Adminium could not record what its columns mean",
        "halfDoneBody": "Nothing needs running again — the table exists. Set its columns’ meaning in Studio → Schema, or ask an administrator to.",
        "notReread": "The table was created, but Adminium could not read it back yet",
        "notRereadBody": "Nothing needs running again. Refresh the schema from Studio → Data connections, then choose the new table here."
      },
      "related": {
        "title": "Use the dates of a linked table",
        "help": "Nothing is written to your database. The page is built on a table linked to this one, and each entry shows a name from this table.",
        "reason": "Dates from “{date}”, each titled with “{title}” through “{via}”",
        "chosen": "Built on {table}, each entry titled with “{title}” from {from}",
        "undo": "Go back to {table}"
      }
    },
    "form": {
      "addLines": "{label} as lines",
      "dialog": {
        "cta": "Button",
        "ctaIcon": "Button icon",
        "iconDefault": "Default",
        "subtitle": "Subtitle",
        "title": "Dialog title",
        "titleHelp": "Empty uses the generated words."
      },
      "field": {
        "availability": "Already taken when",
        "availabilityAny": "Any row holds that time",
        "availabilityHelp": "Another row holds the same time. Pick a column to narrow it to one room, one person, one machine. Left off, nothing is shown as taken.",
        "availabilityOff": "Do not check",
        "control": "Control",
        "down": "Move {name} down",
        "drag": "Reorder {name}",
        "help": "Help text",
        "initial": "Starting value",
        "initialHelp": "What a NEW record starts with. An edit never applies it.",
        "initialLiteral": "A fixed value",
        "initialNone": "Nothing",
        "initialNow": "The current date and time",
        "initialToday": "Today",
        "initialUser": "Who is signed in",
        "initialValue": "The value",
        "label": "Label",
        "placeholder": "Placeholder",
        "recap": "Recap",
        "recapHelp": "A summary box. Its wording is edited in the page’s JSON for now.",
        "remove": "Remove {name}",
        "required": "Ask for it",
        "requiredHelp": "The form refuses to save without it. What the DATABASE requires is set in Schema.",
        "ruleChecks": "extra checks apply",
        "ruleDatabase": "the database fills it in",
        "ruleFilled": "Adminium fills it in",
        "ruleList": "only values from the list {key}",
        "ruleRequired": "the database requires it",
        "ruleValues": "only a fixed set of values",
        "rules": "This column: {rules}.",
        "rulesLink": "Change in Schema",
        "settings": "Settings for {name}",
        "slotsEnd": "until",
        "slotsEvery": "every",
        "slotsHelp": "Leave the times empty for a day picker with no times.",
        "slotsStart": "Times from",
        "span": "Width",
        "spanHelp": "How many of the section’s columns this field takes.",
        "up": "Move {name} up"
      },
      "gallery": {
        "choice": {
          "body": "Selectable choice cards, a pill switch and a slider.",
          "title": "Choice cards"
        },
        "multi": {
          "body": "Email chips input, role select, permission checkbox list.",
          "title": "Multi-entry"
        },
        "quick": {
          "body": "One title field with inline meta pills. No section chrome.",
          "title": "Quick create"
        },
        "repeater": {
          "body": "A reference, repeatable line items and live totals.",
          "title": "Repeater and totals"
        },
        "sectioned": {
          "body": "Long record split into labelled sections with a scrolling body.",
          "title": "Sectioned"
        },
        "segmented": {
          "body": "Segmented priority, long description, attachment list, assignee.",
          "title": "Segmented and files"
        },
        "split": {
          "body": "Two panes: the first section beside the rest. Made for a calendar.",
          "title": "Split pane"
        },
        "upload": {
          "body": "Media dropzone, currency inputs, tag chips and a publish toggle.",
          "title": "Upload and chips"
        },
        "wizard": {
          "body": "Step-by-step wizard with a progress rail and Back / Next footer.",
          "title": "Wizard"
        }
      },
      "missing": {
        "title": "Not on this form. A column the database demands is added back automatically when the dialog opens."
      },
      "preview": "Preview",
      "previewEntity": "record",
      "reset": "Reset to generated",
      "section": {
        "add": "Add a section",
        "columnCount": "{count} columns",
        "columns": "Columns",
        "empty": "No fields here yet — move one in, or add one below.",
        "label": "Section name",
        "remove": "Remove this section",
        "unnamed": "Unnamed section"
      },
      "subtitle": "What the New and Edit dialogs show. Untouched, it follows the table.",
      "title": "Create form"
    },
    "icon": {
      "noMatches": "No icons match that search.",
      "none": "Choose an icon",
      "search": "Search icons"
    },
    "list": {
      "count": "{count, plural, one {# page} other {# pages}}",
      "title": "Pages"
    },
    "loadFailed": {
      "body": "Managing pages needs the “Manage pages” permission. Ask an administrator to grant it to one of your roles.",
      "title": "Pages could not be loaded"
    },
    "origin": {
      "generated": "Generated",
      "llm": "Assistant",
      "manifest": "Add-on",
      "project": "Project code",
      "system": "System",
      "user": "Custom"
    },
    "padding": {
      "custom": "Custom…",
      "default": "Default for this template",
      "none": "None",
      "standard": "Standard (28 × 24)",
      "x": "Sides (px)",
      "y": "Top and bottom (px)"
    },
    "preview": {
      "note": "An illustration of the layout, not your data.",
      "untitled": "Untitled page"
    },
    "project": {
      "badge": {
        "changed": "Changed on server",
        "conflict": "Conflict",
        "outside": "Not in project"
      },
      "changed": {
        "body": "Pull the changes into your project and deploy it, or they stay on this server only:",
        "title": "{count, plural, one {# page was changed on this server} other {# pages were changed on this server}}"
      },
      "conflicts": {
        "body": "This server keeps its own version until you choose one.",
        "title": "{count, plural, one {# page was changed here and in the project} other {# pages were changed here and in the project}}"
      },
      "fromCode": "This page comes from {source}. Change it there.",
      "invalid": {
        "body": "Fix these files. Until then the last good version stays in use.",
        "title": "{count, plural, one {# project file was not applied} other {# project files were not applied}}"
      },
      "keepServer": "Keep server copy",
      "notConfigured": "Some of them belong to a database the project does not list. Add it to adminium.config.ts to keep its pages in the project.",
      "outside": {
        "body": "They exist on this server only. Pull them into the project to keep them:",
        "title": "{count, plural, one {# page is not in the project} other {# pages are not in the project}}"
      },
      "resolveFailed": "That could not be changed.",
      "useProject": "Use project copy"
    },
    "row": {
      "menu": "Actions for {title}"
    },
    "sidebar": {
      "discard": "Discard",
      "emptyGroup": "No pages in this group.",
      "help": "Reorder pages within a group, or move one to another group. Changes apply to every user.",
      "moveDown": "Move {title} down",
      "moveTo": "Move {title} to a group",
      "moveUp": "Move {title} up",
      "save": "Save order",
      "saveFailed": "The new order could not be saved",
      "ungrouped": {
        "body": "These pages work at their URL but appear nowhere in the sidebar. Open each one and pick a group.",
        "title": "Some pages are in no sidebar group"
      },
      "apps": {
        "title": "In installed apps’ sections",
        "body": "Each app keeps its pages in its own section of the sidebar."
      }
    },
    "status": {
      "hidden": "Hidden",
      "live": "Live"
    },
    "subtitle": "Add, edit and organise the pages of your app, and the order they appear in the sidebar.",
    "tab": {
      "pages": "All pages",
      "sidebar": "Sidebar order"
    },
    "title": "Pages",
    "width": {
      "content": "Content (900px)",
      "dash": "Dashboard (1320px)",
      "default": "Default for this template",
      "full": "Full width (no limit)",
      "narrow": "Narrow (720px)",
      "page": "Page (1080px)",
      "wide": "Wide (1800px)"
    },
    "toggleFailed": "The page was not changed"
  },
  "project": {
    "actions": {
      "bulk": "One or more records",
      "empty": "No actions. A file in actions/ puts a button on records.",
      "needs": "Needs: {permission}",
      "single": "One record",
      "title": "Actions"
    },
    "changes": {
      "empty": "Every page and schema file matches this server.",
      "open": "Resolve in Pages",
      "title": "Changed on this server"
    },
    "code": {
      "disabled": "Not loaded: the desktop app never runs project code",
      "label": "Project code",
      "loaded": "Loaded {when}",
      "none": "None loaded"
    },
    "failures": {
      "empty": "No hook has failed since the server started.",
      "title": "Hook errors"
    },
    "files": {
      "count": "{count, plural, one {# file} other {# files}}",
      "pages": "Page files",
      "schema": "Schema files",
      "title": "Files"
    },
    "folder": "Folder",
    "hooks": {
      "empty": "No hooks. A file in hooks/ runs code when records change.",
      "onImport": "Also for CSV imports",
      "title": "Hooks"
    },
    "loadFailed": "The project could not be loaded",
    "mode": {
      "dev": "Development: the folder and Studio stay in step",
      "label": "Runs as",
      "server": "Server: the folder changes only with a deploy"
    },
    "none": {
      "body": "A project is a folder made with `npx @adminiumjs/adminium new`. Its pages, hooks and actions show here when the server runs it.",
      "title": "This server runs no project"
    },
    "pages": {
      "empty": "No pages. A .tsx file in pages/ adds a page of your own.",
      "hidden": "Not in the sidebar",
      "title": "Pages"
    },
    "permission": {
      "create": "Add",
      "delete": "Delete",
      "read": "View",
      "update": "Edit"
    },
    "problems": {
      "body": "Fix these files. The rest of the project code is running.",
      "title": "{count, plural, one {# file did not load} other {# files did not load}}"
    },
    "status": {
      "changed": "Changed on this server",
      "conflict": "Conflict",
      "invalid": "Not valid",
      "outside": "Not in the project",
      "pending": "Not applied yet"
    },
    "subtitle": "The project folder this server runs, and the code it loaded.",
    "superAdminOnly": "Only a super admin can see the project this server runs.",
    "title": "Project",
    "version": "Adminium",
    "widgets": {
      "card": "Dashboard card",
      "cell": "Table cell",
      "empty": "No widgets. A file in widgets/ adds a table cell or a dashboard card.",
      "title": "Widgets"
    }
  },
  "publicApi": {
    "cancel": "Cancel",
    "close": "Close",
    "error": "Something went wrong",
    "keys": {
      "appHint": "The app’s customer surface then serves this key itself — rotating it needs no rebuild.",
      "appLabel": "Bind to a hosted app surface (optional)",
      "appNone": "Not bound",
      "create": "Create key",
      "emptyBody": "Create a scope first, then mint a key for it.",
      "emptyTitle": "No keys yet",
      "formLabel": "Create a key",
      "nameLabel": "Name",
      "reveal": "Show key",
      "revoke": "Revoke",
      "rotate": "Rotate",
      "scopeIsAuthBody": "A key can reach exactly what its scope lists and nothing else. It does not use roles or table permissions, and it cannot read anything through the rest of the API.",
      "scopeIsAuthTitle": "The scope is the only permission",
      "scopeLabel": "Scope",
      "scopePlaceholder": "Choose a scope",
      "subtitle": "These go in your page’s JavaScript, so anyone can read them. That is expected — a key can only ever do what its scope allows.",
      "title": "Keys"
    },
    "notRegistered": {
      "body": "Set ADMINIUM_PUBLIC_API_ORIGINS to the exact origins allowed to call it, then restart. Until then these routes are not served at all.",
      "title": "Not enabled on this server"
    },
    "origins": {
      "label": "Origins allowed to call it"
    },
    "scopes": {
      "connectionLabel": "Connection ID",
      "create": "Create scope",
      "delete": "Delete",
      "deleteConfirm": "Delete scope",
      "deletePrompt": "Type the scope name to confirm",
      "deleteTitle": "Delete this scope",
      "documentHint": "Compiled against your schema when you save. Every column a caller can reach is listed here and nowhere else. A default may be '{'\"$generate\": \"uuid\"'}' or '{'\"$generate\": \"now\"'}' — the server fills those in on create, so a visitor can add a row without choosing its id.",
      "documentLabel": "Scope document",
      "emptyBody": "Create one below. It is checked against your live schema before it is saved.",
      "emptyTitle": "No scopes yet",
      "formLabel": "Create a scope",
      "issuesTitle": "This scope did not compile",
      "keyCount": "{count, plural, =0 {no keys} one {# key} other {# keys}}",
      "nameLabel": "Name",
      "subtitle": "A scope is the whole of what a key may reach — the tables, the exact columns, and a filter the caller can narrow but never remove.",
      "title": "Scopes",
      "deleteBodyKeys": "A scope with live keys cannot be deleted. Revoke its keys first. Keys that are already revoked or expired are deleted with the scope.",
      "liveKeys": {
        "body": "Pages built on these keys would stop working. Revoke them in the keys list first, then delete the scope.",
        "title": "Publishable keys still use this scope"
      }
    },
    "status": {
      "heading": "Status"
    },
    "subtitle": "Let your own customer- or staff-facing pages read this database, through a scope you define.",
    "title": "Public API",
    "toggle": {
      "hint": "Turning this off stops every public request immediately. Nothing is deleted — keys, scopes and data all survive.",
      "label": "Serve the public API"
    }
  },
  "remap": {
    "badge": {
      "fk": "FK",
      "masked": "Masked",
      "pii": "PII",
      "pk": "PK",
      "unique": "UNIQUE"
    },
    "column": {
      "currency": "Currency",
      "currencyHelper": "ISO 4217 code applied to money formatting.",
      "enum": "Enum semantics",
      "enumCategory": "Category",
      "enumHelper": "Workflow enums drive status pills and board columns; tones map values onto the semantic tint scale.",
      "enumKind": "Enum kind",
      "enumLabelFor": "Label for {value}",
      "enumToneAuto": "auto",
      "enumToneFor": "Tone for {value}",
      "enumWorkflow": "Workflow",
      "labelHelper": "Inferred: {name}",
      "labelOverride": "Display label",
      "logicalType": "Logical type",
      "logicalTypeHelper": "Inferred: {type} (from {dbType}) — mapped by the adapter; not overridable in v1.",
      "nullable": "nullable",
      "pii": "Mask by default",
      "piiHelper": "Masked values render redacted; unmasking requires the data.unmask_pii permission and is audit-logged.",
      "semantic": "Semantic type",
      "semanticHelper": "Classifier: {tag} · {confidence}% confidence · source: {source}",
      "semanticInferred": "inferred: {tag}",
      "unclassified": "Not classified yet."
    },
    "diff": {
      "count": "{count} changes",
      "one": "1 change",
      "regenerate": "Regenerate pages",
      "revertAll": "Revert all",
      "revertOne": "Revert {change}",
      "save": "Save overrides",
      "saved": "Overrides saved."
    },
    "empty": {
      "description": "Select something in the schema tree to remap its label, type, relations or masking.",
      "title": "Pick a table or column"
    },
    "inspector": "Inspector",
    "loadFailed": "Could not load the schema for this connection.",
    "mode": {
      "design": "Design",
      "diagram": "Diagram",
      "remap": "Labels & relations"
    },
    "modeLabel": "Editor mode",
    "noDesign": {
      "noPrivilege": "This connection's role cannot create or alter tables. Grant it schema privileges, or connect a role that has them.",
      "readOnlyIntent": "This connection was set up for read-only analytics. Change its intent in Settings to edit its schema.",
      "readOnlyRole": "This connection signs in with a read-only role, so Adminium cannot change its schema.",
      "schemaFile": "This connection was created from a schema file, so there is no database to change. Labels and relations still work."
    },
    "relations": {
      "accept": "Accept",
      "accepted": "Accepted",
      "add": "Add virtual relation",
      "addButton": "Add relation",
      "cardinality": "Cardinality",
      "confidence": "inferred · {pct}%",
      "declared": "Declared foreign keys",
      "fromColumn": "From column",
      "fromPlaceholder": "customer_id",
      "inferred": "Inferred relations",
      "noColumns": "No matching column",
      "noTables": "No matching table",
      "noneDeclared": "No declared foreign keys touch this table.",
      "noneInferred": "Nothing inferred for this table.",
      "overrideBadge": "override",
      "overrides": "Override relations (applied)",
      "suppress": "Suppress",
      "suppressed": "Suppressed",
      "toColumn": "To column",
      "toTable": "To table"
    },
    "rules": {
      "fill": "Starts as",
      "fillDb": "The database fills it (a trigger)",
      "fillDefault": "Leave it to the database",
      "fillHelp": "What Adminium puts here when nobody fills it in.",
      "fillImplicit": "Adminium fills this in automatically.",
      "fillLiteral": "A fixed value",
      "fillNone": "Nothing — leave it empty",
      "fillNow": "The current date and time",
      "fillText": "The value",
      "fillUser": "Who is signed in",
      "fillUuid": "A new unique id",
      "format": "Format",
      "formatAny": "Anything",
      "formatEmail": "An email address",
      "formatPhone": "A phone number",
      "formatUrl": "A web address",
      "help": "These apply wherever a row is written — forms, imports, automations and the API — not just in this app.",
      "max": "Largest",
      "maxLength": "Longest",
      "min": "Smallest",
      "minLength": "Shortest",
      "onUpdate": "Fill it in again on every change",
      "optionsFromDatabase": "Your database fixes the allowed values for this column. Change them in Design.",
      "optionsHelp": "One per line. Leave empty to accept anything.",
      "required": "Must be filled in",
      "requiredAlready": "Your database already requires this column.",
      "requiredHelp": "The form asks for it, and a write without it is refused.",
      "title": "Rules",
      "optionsAnything": "Anything",
      "optionsInline": "These values",
      "optionsList": "A list",
      "optionsListHelp": "Edit the lists themselves in Studio → Lists.",
      "optionsListLabel": "List",
      "optionsListUnavailable": "The lists could not be read.",
      "optionsMissingList": "{key} (not in this workspace)",
      "optionsPickList": "Choose a list…",
      "optionsSource": "Allowed values",
      "optionsSourceHelp": "A list is written once in Studio and used by every column that names it.",
      "optionsValues": "The values",
      "decided": {
        "title": "Decided by Adminium",
        "help": "Adminium fills this in on every write, and a public endpoint can never let a visitor set it.",
        "copy": "Copied from {from} of the row {via} points at",
        "copyAlways": "always, whatever the writer gives",
        "copyDefault": "unless the writer gives a value",
        "sequence": "The next number in order, from {start}",
        "code": "A random code like {example}",
        "remove": "Remove this rule",
        "rollup": "The total of {sum} over its rows in {from}",
        "rollupTimes": "The total of {sum} × {times} over its rows in {from}"
      },
      "venueLocal": "A time written here without a zone is the venue’s own time."
    },
    "saveFailed": "Save failed: {message}",
    "subtitle": "{tables} tables · {applied} overrides applied",
    "table": {
      "hierarchy": "Hierarchy",
      "icon": "Icon",
      "iconPicker": "Table icon",
      "include": "Include in generated app",
      "includeHelper": "Excluded tables get no pages and disappear from nav.",
      "kind": "Kind",
      "labelHelper": "Inferred: {name}",
      "labelOverride": "Display label",
      "navGroup": "Nav group",
      "navGroupHelper": "Nav placement is decided by the generator — a table.navGroup override is not in the v1 vocabulary.",
      "polymorphic": "Polymorphic pairs",
      "role": "Role",
      "rows": "Row estimate",
      "selfFk": "Self-reference via {column}",
      "shape": "Table shape (classified)",
      "shapeHelper": "Classification is recomputed on every introspection; overrides layer on top and survive regeneration.",
      "system": "System",
      "unclassified": "Not classified"
    },
    "tabs": {
      "details": "Details",
      "relations": "Relations"
    },
    "title": "Schema",
    "toast": {
      "regenerateFailed": "Regeneration failed",
      "regenerated": "{created} created · {updated} updated · {unchanged} unchanged",
      "regeneratedDetail": "Pages you edited by hand are preserved — only pages with an untouched generated_hash were regenerated in place.",
      "saved": "Schema overrides saved",
      "savedDetail": "The applied schema below reflects your changes."
    },
    "tree": {
      "collapse": "Collapse table",
      "excluded": "Excluded",
      "expand": "Expand table",
      "label": "Schema",
      "noMatches": "No tables match your search.",
      "search": "Search tables and columns",
      "searchPlaceholder": "Search tables…",
      "unsaved": "Unsaved change"
    },
    "unavailableBody": "This build does not include the remap editor yet. Re-run generation after it lands to remap labels, types and relations.",
    "unavailableTitle": "Schema remap editor not available"
  },
  "review": {
    "unavailableBody": "This build does not include the enrichment review screen yet. It lands with the diff-and-apply flow.",
    "unavailableTitle": "Review screen not available"
  },
  "settings": {
    "globalDefaultsNav": "Global defaults",
    "title": "Settings",
    "workspaceSection": "Workspace"
  },
  "settingsAi": {
    "assistant": {
      "name": {
        "label": "Assistant name",
        "hint": "Shown on the Ask button and in the assistant window."
      },
      "rowData": {
        "label": "Let {name} read table rows",
        "hint": "When on, {name} may send rows your role can read to the configured provider — masked, at most 50 per request, and listed under Sources read. When off, it works from documents and schema only."
      },
      "save": "Save",
      "saveFailed": "Could not save the assistant settings. Try again.",
      "saved": "Assistant settings saved",
      "subtitle": "What it is called here, and what it may read.",
      "title": "Assistant"
    },
    "byo": {
      "body": "Studio can generate a self-contained prompt from your schema. Run it in Claude Code, ChatGPT, or any tool you like, then paste the JSON it returns back into the connect wizard. Same validation, same review, same result as the direct path.",
      "guarantee1": "The prompt carries only your schema and aggregate stats — never row data by default.",
      "guarantee2": "No credentials, instance URL, or identifiers are embedded.",
      "guarantee3": "BYO runs make zero network calls.",
      "guaranteeTitle": "Telemetry-free guarantee",
      "heading": "No key? Use your own AI tool",
      "headingRecommended": "Use your own AI tool — no key needed",
      "promptVersion": "Prompt {version}",
      "recommended": "Recommended",
      "schemaVersion": "Schema {version}",
      "subtitle": "The copy-paste round-trip — nothing leaves this machine."
    },
    "configure": {
      "heading": "Configure {provider}"
    },
    "field": {
      "baseUrl": "Base URL",
      "baseUrlHelper": "The endpoint root that serves /chat/completions.",
      "baseUrlOptional": "Leave as-is unless Ollama runs on another host.",
      "key": "API key",
      "keyMask": "sk-…{last4}",
      "keyOptional": "Optional — some endpoints need no key.",
      "keyReplace": "Replace key",
      "keyStored": "Stored encrypted. Replace it to use a different key.",
      "keyWriteOnly": "Write-only: once saved it is never shown again.",
      "model": "Model",
      "modelFreeText": "Enter the exact model id your endpoint serves.",
      "modelLive": "Loaded live from the provider.",
      "modelLoading": "Loading…",
      "modelPlaceholder": "Select a model…",
      "modelStatic": "A known-good list; type a custom id after saving to refresh it.",
      "noKeyBody": "Ollama runs locally, so nothing leaves this machine.",
      "noKeyTitle": "No API key needed"
    },
    "history": {
      "byo": "BYO",
      "colChunks": "Chunks",
      "colDate": "Date",
      "colSource": "Source",
      "colStatus": "Status",
      "connection": "Connection",
      "directPath": "Direct",
      "empty": "No enrichment runs yet. Enrich a schema from the connect wizard to see history here.",
      "errorBody": "Refresh the page to try again.",
      "errorTitle": "Could not load runs",
      "heading": "Run history",
      "noConnections": "Connect a database first — enrichment runs are recorded per connection.",
      "openReview": "Open review for the run from {date}",
      "subtitle": "Past enrichment runs. Open one to review its suggestions.",
      "tableLabel": "Enrichment runs"
    },
    "provider": {
      "active": "Active",
      "anthropic": {
        "desc": "Claude models via the Anthropic API.",
        "label": "Anthropic"
      },
      "heading": "AI provider",
      "networkDisabledBody": "This Adminium is configured with no outbound internet access, so it cannot reach a provider API. Use the copy-paste round-trip below — it needs no key and no network.",
      "networkDisabledTitle": "Direct AI providers are turned off on this install",
      "ollama": {
        "desc": "Models running locally through Ollama — no key, no cloud.",
        "label": "Ollama (local)"
      },
      "openai": {
        "desc": "GPT models via the OpenAI API.",
        "label": "OpenAI"
      },
      "openaiCompatible": {
        "desc": "Any endpoint that speaks the OpenAI wire format — Groq, Together, vLLM, LM Studio.",
        "label": "OpenAI-compatible"
      },
      "requiresNetwork": "Requires internet & an API key",
      "subtitle": "Choose how Adminium reaches a model to enrich your schema. Keys are stored encrypted and never shown again."
    },
    "runStatus": {
      "applied": "Applied",
      "awaitingResponse": "Awaiting response",
      "discarded": "Discarded",
      "draft": "Draft",
      "failed": "Failed",
      "partiallyApplied": "Partially applied",
      "running": "Running",
      "validated": "Validated"
    },
    "save": "Save provider",
    "saveFailed": "Could not save the AI provider. Try again.",
    "saved": "AI provider saved",
    "subtitle": "Connect a model to let Adminium suggest labels, groups, relations and more — always reviewed as a diff before anything applies.",
    "test": "Test connection",
    "testError": "Test failed",
    "testErrorBody": "Could not reach the provider. Check the key and base URL.",
    "testHintDirty": "Save your changes before testing.",
    "testOk": "Connected to {model} in {latency} ms",
    "testUnknownModel": "the provider",
    "testing": "Pinging the provider…",
    "title": "AI enrichment"
  },
  "settingsHub": {
    "addOnsCard": {
      "body": "Browse, install and connect add-ons — extra blocks, data packs and integrations — or upload one yourself.",
      "cta": "Open add-ons",
      "heading": "Add-ons"
    },
    "aiCard": {
      "body": "Configure an AI provider (or the copy-paste round-trip) to enrich labels, groups and relations.",
      "cta": "Open AI settings",
      "heading": "AI enrichment"
    },
    "apiCard": {
      "api": {
        "helper": "Serve the endpoints your keys are scoped to. Off, every key stops working at once; nothing is deleted.",
        "label": "Public API"
      },
      "docs": {
        "helper": "A public page at /api-docs listing the endpoints your live keys can call — staff-level ones included — with their paths, methods and column names, to anyone who can reach this server. It shows no data and no keys.",
        "label": "API documentation page"
      },
      "failed": "The switch did not change. Try again.",
      "heading": "Public API",
      "notRegistered": {
        "body": "Set ADMINIUM_PUBLIC_API_ORIGINS and restart. Until then these switches change nothing.",
        "title": "Not enabled on this server"
      }
    },
    "danger": {
      "deleteCta": "Delete connection",
      "deleteDesc": "Deletes the connection and its generated pages. Your database is not touched. Cannot be undone.",
      "empty": "Nothing to delete — no connections yet.",
      "heading": "Danger zone",
      "subtitle": "Irreversible actions."
    },
    "defaultsCard": {
      "body": "Workspace-wide theme, accent, density and language live under Global defaults.",
      "cta": "Open global defaults",
      "heading": "Appearance & language defaults"
    },
    "email": {
      "attachmentCap": {
        "error": "Between {min, number} and {max, number} MB.",
        "helper": "The most one message may carry in attachments.",
        "label": "Attachment limit (MB)"
      },
      "from": {
        "error": "Enter an email address.",
        "helper": "A bare address, or a display name in front of one.",
        "label": "From address"
      },
      "heading": "Email (SMTP)",
      "host": {
        "error": "A bare hostname or IP address — no scheme, port or credentials.",
        "label": "SMTP host"
      },
      "linkOrigin": {
        "error": "Enter an address such as https://admin.example.com, with no path.",
        "helper": "Password-reset and invitation links open this address. If it is empty, Adminium fills it in from the next admin who signs in or saves a change, unless they are on localhost.",
        "label": "Address in email links"
      },
      "pass": {
        "error": "This username needs a password.",
        "helper": "Stored encrypted and never shown again. Leave blank to keep the current one.",
        "label": "Password"
      },
      "port": {
        "error": "Between {min, number} and {max, number}.",
        "label": "Port"
      },
      "remove": "Remove mail server",
      "review": {
        "password": "Replaced",
        "removed": "Removed"
      },
      "secure": {
        "helper": "On for port 465. Off starts in cleartext and upgrades with STARTTLS, which is what port 587 expects.",
        "label": "Implicit TLS"
      },
      "senders": {
        "add": "Add sender",
        "address": "Address",
        "error": "Enter an email address.",
        "heading": "Senders",
        "helper": "Addresses an email may be sent from. The SMTP From address is always available.",
        "implicit": "SMTP From address",
        "name": "Display name",
        "remove": "Remove sender",
        "review": "Senders"
      },
      "unconfigured": "No mail server is set, so Adminium cannot send password resets, user invites or scheduled reports.",
      "user": {
        "helper": "Leave empty for a relay that does not authenticate.",
        "label": "Username"
      }
    },
    "identity": {
      "appName": {
        "error": "Enter a name of at most 60 characters.",
        "helper": "Shown in the sidebar, browser title, and emails.",
        "label": "Application name"
      },
      "heading": "Workspace identity",
      "logo": {
        "badType": "Choose a PNG, JPEG, WebP, GIF or SVG image.",
        "drop": "Drop an image here",
        "helper": "PNG, JPEG, WebP, GIF or SVG, up to 1 MB. Replaces the built-in mark everywhere.",
        "label": "Logo",
        "remove": "Remove",
        "removed": "Logo removed",
        "replace": "Replace logo",
        "tooLarge": "That image is larger than 1 MB.",
        "undo": "Undo",
        "upload": "Upload logo",
        "uploaded": "Logo updated"
      },
      "showVersion": {
        "helper": "The build number beside the logo. Off hides which version you run.",
        "label": "Version in the sidebar"
      }
    },
    "pagesCard": {
      "body": "Add, edit and delete pages, change what each one shows, and reorder the sidebar.",
      "cta": "Manage pages",
      "heading": "Pages"
    },
    "projectCard": {
      "body": "The project folder this server runs: its hooks, actions and page files.",
      "cta": "Open project",
      "heading": "Project"
    },
    "publicApiCard": {
      "body": "Create endpoints and the keys that may call them.",
      "cta": "Open API keys",
      "heading": "API keys"
    },
    "review": {
      "cancel": "Cancel",
      "change": "{before} → {after}",
      "close": "Close",
      "confirm": "Save changes",
      "hidden": "Hidden",
      "off": "Off",
      "on": "On",
      "shown": "Shown",
      "subtitle": "Review your changes before saving.",
      "title": "Save workspace settings"
    },
    "save": "Save changes",
    "saveFailed": "Could not save workspace settings. Try again.",
    "saved": "Workspace settings updated",
    "security": {
      "allowSignup": {
        "desc": "Anyone can create an account — off keeps this workspace invite-only.",
        "label": "Allow self-signup"
      },
      "heading": "Security",
      "passwordMin": {
        "error": "Between {min, number} and {max, number} characters.",
        "label": "Minimum password length"
      },
      "require2fa": {
        "desc": "Every member must enable 2FA to sign in.",
        "label": "Require two-factor auth",
        "note": "Advisory, not a barrier: members without 2FA are sent to set it up and can no longer turn it off, but their sign-in is never blocked, and API keys are unaffected."
      },
      "sessionTtl": {
        "error": "Between {min, number} and {max, number} hours.",
        "label": "Session lifetime (hours)"
      }
    },
    "storageCard": {
      "body": "Choose where uploaded files, exports and other stored bytes live — this server, a bucket, or your own server.",
      "cta": "Open storage",
      "heading": "Storage"
    },
    "subtitle": "Identity, security and destructive actions for this workspace.",
    "superAdminOnly": "Only a super admin can change workspace identity and security settings.",
    "superAdminOnlyTitle": "Super admin required",
    "title": "Workspace settings",
    "translationsCard": {
      "body": "Reword anything in Adminium, choose which languages people can pick, and add your own.",
      "cta": "Open translations",
      "heading": "Languages & translations"
    },
    "listsCard": {
      "body": "The answers a column accepts — countries, stages, departments — named once and used from anywhere.",
      "cta": "Open lists",
      "heading": "Lists"
    }
  },
  "source": {
    "dsn": {
      "helper": "postgres://user:password@host:5432/database — mysql:// and sqlite: work too.",
      "incomplete": "Add host and database, e.g. postgres://user@host:5432/db",
      "invalidScheme": "Unrecognized scheme — expected postgres://, mysql://, mariadb:// or sqlite:",
      "label": "Connection string",
      "quickFill": "Quick fill:"
    },
    "engine": {
      "label": "Database engine",
      "mysql": "MySQL / MariaDB",
      "postgres": "PostgreSQL",
      "sqlite": "SQLite"
    },
    "fields": {
      "database": "Database",
      "host": "Host",
      "password": "Password",
      "port": "Port",
      "preview": "Connection string preview:",
      "ssl": "SSL mode",
      "user": "User"
    },
    "file": {
      "columns": "columns",
      "detectedAs": "Detected: {format}",
      "dropHint": "SQL DDL / pg_dump, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, Django models, Adminium JSON",
      "dropTitle": "Drop your schema file here, or browse",
      "errorTitle": "Could not parse the file",
      "moreWarnings": "+{count} more warnings — the full list appears in the analyze step.",
      "parseFailed": "We could not parse that file. If auto-detect guessed wrong, pick the format explicitly and retry.",
      "parsing": "Reading uploaded schema file…",
      "pitch": "No database connection required — we parse your schema file and build the same dashboards.",
      "requestFailed": "Upload failed — check your connection and try again.",
      "tables": "tables",
      "unsupported": "That format is not recognized — SQL DDL, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, Django models and Adminium JSON are supported. Pick one explicitly and retry.",
      "warnings": "warnings"
    },
    "format": {
      "auto": "Auto-detect",
      "django": "Django models.py",
      "drizzle": "Drizzle ORM",
      "helper": "Leave on auto-detect unless the detection gets it wrong.",
      "json": "Adminium JSON",
      "label": "Schema format",
      "prisma": "Prisma schema",
      "rails": "Rails schema.rb",
      "sequelize": "Sequelize models",
      "sql": "SQL DDL / pg_dump",
      "typeorm": "TypeORM entities"
    },
    "mode": {
      "dsn": "Connection string",
      "fields": "Individual fields",
      "file": "Schema file"
    },
    "modeLabel": "Source input mode",
    "name": "Connection name",
    "namePlaceholder": "Production Postgres",
    "readOnlyRole": {
      "body": "During setup Adminium reads schema metadata only — never your rows. We recommend a dedicated user with SELECT-only grants; you can decide where Adminium keeps its own tables in the meta-storage step.",
      "title": "Use a read-only role"
    },
    "sqlite": {
      "file": "Database file path",
      "helper": "SQLite is a file, not a server — give the absolute path on the machine running Adminium."
    },
    "subtitle": "Point Adminium at a database and we'll generate an admin dashboard from its schema.",
    "title": "Connect your database"
  },
  "storage": {
    "actionFailed": "That did not work",
    "add": "Add a destination",
    "availableOnDisk": "{size} available on this disk",
    "default": "Default",
    "defaultBlockedByDisabled": "A disabled destination cannot be the default. Enable it first.",
    "delete": {
      "blockedBody": "{name} still holds {count, plural, one {# file} other {# files}}. Move them to another destination first, then delete it.",
      "blockedTitle": "This destination still holds files",
      "body": "Adminium forgets {name} and its credential. Nothing stored in it is touched — the bucket or server itself is yours, and files still recorded against it will refuse the delete.",
      "confirm": "Delete destination",
      "title": "Delete this destination"
    },
    "deleteButton": "Delete",
    "disable": "Disable",
    "disabled": "Disabled",
    "driver": {
      "local": "A path on this machine",
      "s3": "S3-compatible bucket",
      "webdav": "WebDAV server"
    },
    "edit": "Edit",
    "editor": {
      "createTitle": "Add a destination",
      "editTitle": "Edit destination",
      "subtitle": "Adminium reads and writes through this destination on your behalf; it is infrastructure you control."
    },
    "enable": "Enable",
    "field": {
      "accessKeyId": "Access key ID",
      "bucket": "Bucket",
      "driver": "Kind",
      "driverLocked": "Changing the kind of a destination that already holds files would leave those files unreachable.",
      "endpoint": "Endpoint",
      "endpointDerived": "Leave empty for AWS itself — the endpoint follows from the region.",
      "name": "Name",
      "namePlaceholder": "Uploads bucket",
      "password": "Password",
      "pathStyle": "Path-style addressing",
      "pathStyleToggle": "Address the bucket as a path rather than a hostname",
      "prefix": "Prefix",
      "prefixHelper": "A folder inside the destination. Two destinations on one bucket that differ only here share the bucket without sharing a namespace.",
      "preset": "Provider",
      "presetHelper": "Fills in the endpoint, region and addressing style. Anything the provider cannot know about your account is left blank for you to type.",
      "publicBaseUrl": "Public base URL",
      "publicBaseUrlHelper": "Optional. Where these objects are readable without Adminium — a CDN in front of a public bucket. Used only when a column stores a link.",
      "region": "Region",
      "root": "Directory",
      "rootHelper": "An absolute path this server can write to — a mounted volume or a network share. Not the default directory, which is already the first entry in the list.",
      "secretAccessKey": "Secret access key",
      "secretKept": "A key is stored. Leave both fields blank to keep it; fill in both to replace it.",
      "url": "Collection URL",
      "urlHelper": "The collection Adminium writes into, as your server publishes it.",
      "username": "Username"
    },
    "fileCount": "{count, plural, one {# file} other {# files}}",
    "kind": {
      "archive": "Archived audit batches",
      "branding": "The workspace logo",
      "export": "Export artifacts",
      "import": "Uploaded CSVs and their error reports",
      "schema": "Imported schema files",
      "upload": "Files attached to records"
    },
    "list": {
      "subtitle": "New files go to the default destination. Existing files stay where they are until you move them.",
      "title": "Destinations"
    },
    "loadFailed": {
      "forbidden": "Changing where files are stored needs the “Manage storage” permission. Ask an administrator to grant it to one of your roles.",
      "title": "Destinations could not be loaded"
    },
    "localDisk": "This server's disk",
    "move": {
      "from": "From",
      "kinds": "Limit to",
      "kindsHelp": "Leave everything unticked to move all of them. Uploads are the files people attach; the rest are artifacts Adminium made.",
      "open": "Move files…",
      "start": "Start the move",
      "startedBody": "It runs in the background as job {jobId} and keeps going if you leave this page. The counts below change as files arrive — reload to see them.",
      "startedTitle": "The move has started",
      "subtitle": "Copies every file from one destination to another and then forgets the old copy. Downloads keep working throughout.",
      "title": "Move files",
      "to": "To"
    },
    "preset": {
      "aws": "AWS S3",
      "b2": "Backblaze B2",
      "minio": "MinIO or another S3-compatible server",
      "r2": "Cloudflare R2",
      "spaces": "DigitalOcean Spaces",
      "tigris": "Tigris",
      "wasabi": "Wasabi"
    },
    "save": "Save destination",
    "secret": {
      "partialBody": "Fill in both fields to replace the stored credential, or clear both to keep it. Saving one alone would quietly keep the old one.",
      "partialTitle": "Half a credential is not a credential"
    },
    "setDefault": "Set as default",
    "status": {
      "error": "Unreachable",
      "ok": "Reachable",
      "untested": "Not tested"
    },
    "subtitle": "Where this instance keeps uploaded files, exports and other stored bytes.",
    "test": {
      "button": "Test",
      "failed": "Could not reach this destination",
      "ok": "Reached in {ms}ms",
      "unreachable": "The test could not be run"
    },
    "title": "Storage",
    "usedBytes": "{size} used"
  },
  "tables": {
    "emptyBody": "This database has no tables yet. You can still continue — once you create tables, use Re-introspect on this connection to bring them in.",
    "emptyFileBody": "This schema file defines no tables. Go back and upload a different file, or continue anyway.",
    "emptyFilter": "No tables match your filter.",
    "emptyTitle": "No tables found",
    "highVolume": "high volume",
    "highVolumeNote": "Tables over 100,000 rows start unchecked — ops tables rarely belong in a dashboard.",
    "importNoCounts": "Schema files carry no row counts — the column shows — until a live database is connected.",
    "joinHidden": "{count} join/system tables are pre-hidden — they still power many-to-many relations.",
    "listLabel": "Includable tables",
    "pii": "PII",
    "search": "Filter tables…",
    "subtitle": "Choose which to include. You can change this anytime.",
    "title": "Choose your tables"
  },
  "test": {
    "errorTitle": "Connection failed",
    "hint": {
      "auth": "Authentication failed — check the user name and password in your DSN.",
      "hostUnreachable": "Host unreachable — check the hostname and port, and that the database accepts connections from this machine (allowlist our IPs).",
      "metaPlacement": "This source cannot host Adminium’s meta tables — continue with a separate meta database.",
      "permission": "The role connected but lacks schema-read privileges — grant USAGE on the schema to your introspection role.",
      "timeout": "The database did not answer in time — check network path and load, then retry.",
      "tls": "TLS negotiation failed — try sslmode=require, or upload the CA certificate your server expects.",
      "unknown": "Connection failed — verify the DSN and retry."
    },
    "log": {
      "connectFailed": "Connection failed.",
      "connected": "Connected ({latency} ms) · read-only introspection",
      "connecting": "Establishing secure connection…",
      "detected": "Detected {tables} tables · {columns} columns",
      "found": "Found {tables} tables · {columns} columns",
      "jobFailed": "Introspection failed.",
      "mapping": "Mapping column types → input widgets",
      "moreWarnings": "+{count} more parser warnings",
      "networkFailed": "Request failed — check your connection and retry.",
      "parsingFile": "Parsing {file}…",
      "piiDone": "PII scan complete — {count} columns masked by default",
      "piiDoneUnknown": "PII scan complete",
      "piiScan": "Scanning for PII columns…",
      "readingFile": "Reading uploaded schema file…",
      "readingSchema": "Reading schema: public",
      "ready": "Ready",
      "relations": "Detecting relations…"
    },
    "logLabel": "Introspection log",
    "retry": "Retry",
    "subtitle": "Introspecting tables, columns, and relationships. This takes a few seconds.",
    "title": "Analyzing your schema",
    "trust": "We only read your schema and data. Nothing is modified."
  },
  "title": "Studio",
  "wizard": {
    "back": "Back",
    "bridgeAppliedBody": "Handed over from adminium.dev by your browser — it went straight to this machine and was never uploaded. Check it below, then continue.",
    "bridgeAppliedTitle": "Connection string received",
    "bridgeFailedBody": "It has already been used or has expired. Paste your connection string below instead.",
    "bridgeFailedTitle": "That hand-off could not be used",
    "continue": "Continue",
    "persistFailed": "Could not save your table selection — retry.",
    "persistFailedTitle": "Save failed",
    "progress": "Setup progress",
    "startOver": {
      "action": "Start over",
      "body": "Everything entered here is cleared and the wizard returns to the first step.",
      "bodyCreated": "Everything entered here is cleared and the wizard returns to the first step. The connection Adminium already created is not deleted — it stays in Data connections.",
      "confirm": "Start over",
      "keep": "Keep going",
      "title": "Start this wizard over?"
    },
    "step": {
      "enrich": "Enrich",
      "generate": "Generate",
      "intent": "Intent",
      "meta": "Meta storage",
      "source": "Source",
      "tables": "Tables",
      "test": "Analyze",
      "finish": "Finish"
    },
    "title": "New connection"
  },
  "lists": {
    "addValue": "Add value",
    "andMore": "and {count} more",
    "builtin": "Built in",
    "builtinCount": "{count} values",
    "builtinSubtitle": "A list Adminium ships. It is the same in every workspace, and its names are written in each person’s own language.",
    "cancel": "Cancel",
    "close": "Close",
    "copiedFrom": "a copy of {key}",
    "copyTitle": "A copy of {name}",
    "create": "Create list",
    "delete": "Delete",
    "deleteBody": "The list goes. The values already stored in your rows stay exactly as they are — a list says what a form offers, not what a column holds.",
    "deleteTitle": "Delete {name}?",
    "edit": "Edit",
    "editSubtitle": "The answers a column with this list accepts, in the order a form offers them.",
    "editTitle": "Edit {name}",
    "emptyBody": "A list is a set of answers a column accepts.",
    "emptyTitle": "No lists yet",
    "errorUnknown": "That did not work. Try again.",
    "inUseBody": "Remove it from {columns} first.",
    "inUseNone": "Remove it from the columns that use it first.",
    "inUseTitle": "{name} is used by a column",
    "issueBlank": "One of the values is empty. Fill it in or remove the row.",
    "issueDuplicate": "\"{value}\" is in the list twice.",
    "issueEmpty": "A list needs at least one value.",
    "issueName": "Give the list a name.",
    "key": "Key",
    "keyFixed": "Rules name this list as",
    "keyHelper": "What rules and project files call this list. It cannot be changed later.",
    "labelAt": "Label {n}",
    "labelPlaceholder": "What people read",
    "makeCopy": "Make a copy I can edit",
    "moveDown": "Move {value} down",
    "moveUp": "Move {value} up",
    "name": "Name",
    "namePlaceholder": "Departments",
    "new": "New list",
    "removeValue": "Remove {value}",
    "save": "Save changes",
    "storeLabel": "Store the label instead",
    "storeLabelHelp": "A copy stores the code, e.g. DE. \"Store the label instead\" stores what it is called here, e.g. Germany — in this workspace’s language, from now on.",
    "subtitle": "The answers a column accepts, named once and used from anywhere.",
    "title": "Lists",
    "valueAt": "Value {n}",
    "valueCount": "{count} values",
    "values": "Values",
    "view": "View"
  },
  "apiKeys": {
    "banner": {
      "bodyOnce": "Copy it now — you won't be able to see it again. Scoped to {summary}.",
      "bodyRevealable": "Copy it now — you can reveal it again from the list below. Scoped to {summary}.",
      "copied": "Copied",
      "copy": "Copy",
      "titleNamed": "{name} created"
    },
    "builder": {
      "auth": {
        "anon": "Anon",
        "authenticated": "Authenticated",
        "label": "Auth requirement",
        "service": "Service role"
      },
      "cancel": "Cancel",
      "columns": {
        "all": "All",
        "label": "Exposed columns",
        "none": "None"
      },
      "create": "Create endpoint",
      "delete": "Delete endpoint",
      "deleteRefused": "{count, plural, one {# key still uses} other {# keys still use}} this endpoint: {names}.",
      "filters": {
        "add": "Add",
        "empty": "No filters — every row of the source is reachable.",
        "label": "Default filters",
        "remove": "Remove filter",
        "value": "value"
      },
      "footer": {
        "applyFirst": "Apply or revert the edited definition first."
      },
      "methodUnsupported": "This source cannot support {method}: it has no primary key.",
      "methods": "Methods",
      "op": {
        "between": "between",
        "eq": "equals",
        "gt": "greater than",
        "gte": "at least",
        "ilike": "contains (any case)",
        "in": "in list",
        "is_null": "is empty",
        "like": "contains",
        "lt": "less than",
        "lte": "at most",
        "neq": "not equals",
        "not_null": "is not empty"
      },
      "paging": {
        "asc": "Asc",
        "defaultLimit": "Default limit",
        "desc": "Desc",
        "label": "Pagination & sorting",
        "maxLimit": "Max limit",
        "orderBy": "Order by"
      },
      "pane": {
        "apply": "Apply to form",
        "dirty": "edited — not applied",
        "format": "Format",
        "label": "Route definition, JSON",
        "more": "{first} (+{n} more)",
        "revert": "Revert",
        "synced": "synced with form",
        "title": "Route definition"
      },
      "rate": {
        "hour": "hour",
        "label": "Rate limit & response",
        "minute": "minute",
        "per": "Per",
        "requests": "Requests",
        "second": "second"
      },
      "refused": {
        "keys": "Saving this would break {count, plural, one {# key} other {# keys}}: {names}."
      },
      "route": "Route",
      "routePlaceholder": "customers",
      "routeRename": "Callers must switch to the new path.",
      "save": "Save changes",
      "shape": {
        "array": "Bare array",
        "label": "Response shape",
        "single": "Single object",
        "wrapped": "Wrapped in '{' data '}'"
      },
      "source": "Source table or view",
      "subtitle": "Configure it visually — Adminium writes the route definition for you",
      "titleEdit": "Edit endpoint",
      "titleNew": "New endpoint"
    },
    "connection": {
      "label": "Connection"
    },
    "create": "Create key",
    "endpoints": {
      "col": {
        "auth": "Auth",
        "methods": "Methods",
        "rate": "Rate limit",
        "route": "Route"
      },
      "custom": "CUSTOM",
      "edit": "Edit endpoint",
      "explore": "Explore API",
      "new": "New endpoint",
      "subtitle": "Generated from your schema. Keys are scoped to these.",
      "title": "Endpoints",
      "unavailable": "UNAVAILABLE"
    },
    "keys": {
      "col": {
        "access": "Access",
        "actions": "Actions",
        "key": "Key",
        "lastUsed": "Last used",
        "name": "Name"
      },
      "count": "{n, plural, one {# key} other {# keys}}",
      "empty": "No active keys. Create one to get started.",
      "hide": "Hide key",
      "kind": {
        "browser": "BROWSER",
        "server": "SERVER"
      },
      "never": "Never",
      "reveal": "Reveal key",
      "revoke": "Revoke",
      "revokeConfirm": {
        "body": "Anything using this key stops working at once. This cannot be undone.",
        "confirm": "Revoke key",
        "prompt": "Type “{name}” to confirm",
        "title": "Revoke {name}?"
      },
      "revokeFailed": "That key could not be revoked. It is still active.",
      "title": "Active keys",
      "untitled": "Untitled key"
    },
    "method": {
      "BATCH": {
        "desc": "Bulk insert or upsert, up to 500 rows",
        "title": "Batch"
      },
      "DELETE": {
        "desc": "Remove a row by primary key",
        "title": "Delete"
      },
      "GET": {
        "desc": "List rows and fetch a single record",
        "title": "Read"
      },
      "PATCH": {
        "desc": "Partial update of a row by primary key",
        "title": "Update"
      },
      "POST": {
        "desc": "Insert a new row",
        "title": "Create"
      },
      "PUT": {
        "desc": "Replace a full row by primary key",
        "title": "Replace"
      }
    },
    "note": {
      "notRegistered": "The public API is not enabled on this server. Set ADMINIUM_PUBLIC_API_ORIGINS and restart — keys made here will work from then on.",
      "off": "The public API is switched off, so no key works right now.",
      "offLink": "Open Workspace settings"
    },
    "quick": {
      "body": "Authenticate requests with your key in the Authorization header.",
      "title": "Quick start"
    },
    "sheet": {
      "allMethods": "Select all methods",
      "app": {
        "label": "App",
        "none": "None"
      },
      "cancel": "Cancel",
      "clear": "Clear",
      "close": "Close",
      "count": "{permissions, plural, one {permission} other {permissions}} on {endpoints, plural, one {# endpoint} other {# endpoints}}",
      "deselectAll": "Deselect all",
      "edit": "Edit endpoint",
      "expires": {
        "d30": "30 days",
        "d90": "90 days",
        "label": "Expires",
        "never": "Never"
      },
      "filter": "Filter endpoints",
      "focusMeta": "{source} · {rows} rows · limit {limit}, order {order}",
      "focusMetaNoRows": "{source} · limit {limit}, order {order}",
      "footer": {
        "empty": "Select at least one method to create a key.",
        "more": "+{n} more",
        "refused": "This key cannot be created yet: {issue}",
        "summary": "This key will be able to call {paths}"
      },
      "kind": {
        "browser": "Browser",
        "label": "Used from",
        "server": "Server"
      },
      "layout": {
        "label": "Layout",
        "list": "List",
        "panes": "Panes"
      },
      "name": {
        "label": "Key name",
        "placeholder": "e.g. Orders sync worker"
      },
      "newEndpoint": "New endpoint",
      "readOnly": "Read-only preset",
      "rowMeta": "{source} · {rows} rows",
      "rowMetaNoRows": "{source}",
      "selectAll": "Select all",
      "selectAllShort": "Select all",
      "submit": "Create key",
      "subtitle": "Pick the endpoints and methods this key may call",
      "title": "Create API key",
      "toggleAll": "Toggle all methods",
      "unsupported": "{count, plural, one {{methods} is not exposed on this route. Edit the endpoint to enable it.} other {{methods} are not exposed on this route. Edit the endpoint to enable them.}}"
    },
    "stats": {
      "endpoints": "Endpoints",
      "keys": "Active keys",
      "requests": "Requests · 24h"
    },
    "subtitle": "Manage programmatic access to your workspace",
    "summary": "{endpoints, plural, one {# endpoint} other {# endpoints}} · {methods, plural, one {# method} other {# methods}}",
    "title": "API keys & tokens"
  },
  "surfacePages": {
    "guest": {
      "title": "{app} isn’t available right now.",
      "body": "Please try again later."
    },
    "staff": {
      "appOff": "{app} is switched off for now.",
      "sideOff": "The staff screens of {app} are switched off.",
      "advice": "Ask your manager to switch it on in {app} → Settings.",
      "signOut": "Sign out",
      "noAccess": "This account can’t open {app}.",
      "noAccessAdvice": "Ask your manager for a role that opens {app}."
    },
    "notFound": {
      "title": "Page not found",
      "body": "There’s nothing at this address. Check the link and try again."
    }
  },
  "appSettings": {
    "notInstalled": "This app is not installed",
    "backToApps": "Back to apps",
    "statusDisabled": "Disabled",
    "statusUpdate": "Update available · {version}",
    "statusActive": "Active",
    "version": "Version {version} · by {publisher}",
    "open": "Open the app",
    "upToDate": "Up to date",
    "update": "Update",
    "saveFailed": "The change was not saved",
    "screens": "Sets of screens",
    "sideStaff": "Staff screens",
    "sideCustomer": "Customer screens",
    "sideAppOff": "The whole app is switched off.",
    "staffOnHelp": "Your team signs in here with their own accounts.",
    "customerOnHelp": "Customers use these pages. They are public.",
    "staffOffHelp": "These screens are not served. Nothing was deleted.",
    "customerOffHelp": "Customers see “not available”. Nothing was deleted.",
    "sideSwitch": "{side}, on or off",
    "on": "On",
    "off": "Off",
    "whereItLives": "Where it lives",
    "ownAddress": "On its own address",
    "insideDashboard": "Inside the dashboard",
    "copyAddress": "Copy address",
    "copied": "Copied",
    "copy": "Copy",
    "addDomain": "Add a domain",
    "preview": "Preview",
    "domainField": "Domain",
    "addDomainSave": "Add",
    "data": "Data",
    "noTables": "This app uses no tables.",
    "rows": "{count, plural, one {# row} other {# rows}}",
    "activity": {
      "staged": "Uploaded by {actor}",
      "installed": "Installed by {actor}",
      "updated": "Updated by {actor}",
      "disabled": "Switched off by {actor}",
      "enabled": "Switched on by {actor}",
      "settings": "Settings changed by {actor}",
      "domains": "Domains changed by {actor}",
      "instances": "Instances changed by {actor}",
      "renamed": "Tables renamed by {actor}",
      "title": "Activity",
      "none": "Nothing yet.",
      "sampleAdded": "Sample data added by {actor}",
      "sampleRemoved": "Sample data removed by {actor}"
    },
    "danger": "Danger zone",
    "disabledNote": "The app is switched off. Enable brings back exactly what was there.",
    "disableNote": "Hides the app everywhere and stops its endpoints. Nothing is deleted.",
    "enable": "Enable",
    "disable": "Disable",
    "uninstallNote": "Removes the app’s files and pages. Keeps the tables and data.",
    "uninstall": "Uninstall",
    "disableTitle": "Disable {app}?",
    "close": "Close",
    "nothingDeleted": "Nothing is deleted.",
    "enableBrings": "Enable brings back exactly what was there.",
    "cancel": "Cancel",
    "disableLine1": "Its section is hidden for everyone.",
    "disableLine2": "Its screens and its own endpoints stop answering.",
    "disableLine3": "The tables, records and settings stay as they are.",
    "crumb": "Apps",
    "sampleLedger": "Adminium’s list of sample records"
  },
  "uninstall": {
    "files": "The app’s files",
    "pages": "{count, plural, one {# page} other {# pages}}",
    "keys": "{count, plural, one {Its browser key} other {Its # browser keys}}",
    "settings": "Its settings",
    "hosts": "{count, plural, one {Its domain} other {Its # domains}}",
    "tables": "{count, plural, one {# table and every record in it} other {# tables and every record in them}}",
    "editedPages": "Pages you edited stay as ordinary pages",
    "audit": "Its entries in the audit log",
    "title": "Uninstall {app}?",
    "close": "Close",
    "planFailed": "What would be removed could not be read",
    "removed": "Removed",
    "kept": "Kept",
    "roleCascade": "Removing this role takes it from {members, plural, one {# person} other {# people}} and deletes {keys, plural, one {# API key} other {# API keys}} bound to it. Those keys stop working at once.",
    "dropTitle": "Also delete its tables and data",
    "dropBody": "{count, plural, one {Deletes the # table it made and every record in it.} other {Deletes the # tables it made and every record in them.}} This cannot be undone.",
    "typeKey": "Type the app’s key {key} to confirm.",
    "failed": "The app was not uninstalled",
    "cancel": "Cancel",
    "confirmDrop": "Uninstall and delete data",
    "confirm": "Uninstall",
    "rules": "{count, plural, one {Its column rule} other {Its # column rules}}"
  },
  "sampleData": {
    "title": "Sample data",
    "add": "Add sample data",
    "installNote": "a few example records in the app’s tables, so there is something to try it with. You can remove it in one click.",
    "remove": "Remove sample data",
    "keptNotice": "{count, plural, one {# sample record stays: your own records use it, or you changed it.} other {# sample records stay: your own records use them, or you changed them.}}",
    "notLoaded": "Not loaded",
    "loadedCount": "Loaded · {count, plural, one {# record} other {# records}}",
    "loaded": "Loaded · {count, plural, one {# record} other {# records}} · {date}",
    "addSubtitle": "Into {connection}",
    "close": "Close",
    "addBodyNoConnection": "A few example records in the app’s tables. Nothing else is touched.",
    "addBody": "A few example records in the app’s tables. Nothing else in {connection} is touched.",
    "images": "Images, added to Files",
    "total": "Total",
    "records": "{count, plural, one {# record} other {# records}}",
    "none": "This app ships no sample data",
    "adding": "Adding sample data",
    "addFailed": "The sample data was not added",
    "addFailedBody": "The sample data was not added. Nothing was written.",
    "cancel": "Cancel",
    "removeSubtitle": "{count, plural, one {# record added on {date}} other {# records added on {date}}}",
    "removeBody": "Adminium kept a list of every record it added, so it takes out exactly those.",
    "planFailed": "What would be removed could not be read",
    "removes": "Removes",
    "kept": "Kept",
    "usedBy": "{count, plural, one {used by # of your own records} other {used by # of your own records}}",
    "keepChanged": "Keep the ones I changed",
    "changedList": "{count, plural, one {# sample record you edited: {names}.} other {# sample records you edited: {names}.}}",
    "removeFailed": "The sample data was not removed",
    "removeConfirm": "Remove",
    "banner": "Sample data is loaded",
    "bannerRemove": "Remove it"
  },
  "appPublicAccess": {
    "title": "Public access",
    "intro": "The app’s customer screens need to:",
    "availability": "Read free or full times of {table}",
    "claim": "Look up their own {table} by {fields}",
    "create": "Add to {table}",
    "update": "Change {table}",
    "read": "Read {table}",
    "later": "arrives in a later release",
    "allow": "Allow this public access",
    "helper": "You can narrow it later on the API keys page.",
    "cannotGrant": "Only someone who may manage API keys can allow it, so the app installs without it.",
    "warning": {
      "apiOff": "The public API is switched off, so none of this answers until it is on.",
      "originSelf": "The allowed origins do not include “self”, so the app’s own pages on this server cannot call it.",
      "timeZone": "This database has no time zone set, which the public API needs for dates and times.",
      "noEmail": "Email is not set up, so guests will not be sent a confirmation."
    },
    "createConfirmed": "Add to {table}, and get a confirmation email"
  }
} as const;
