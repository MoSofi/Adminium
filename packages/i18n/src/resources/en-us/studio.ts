// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/studio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "title": "Studio",
  "settings": {
    "title": "Settings",
    "workspaceSection": "Workspace",
    "globalDefaultsNav": "Global defaults"
  },
  "source": {
    "engine": {
      "label": "Database engine",
      "postgres": "PostgreSQL",
      "mysql": "MySQL / MariaDB",
      "sqlite": "SQLite"
    },
    "format": {
      "label": "Schema format",
      "helper": "Leave on auto-detect unless the detection gets it wrong.",
      "auto": "Auto-detect",
      "sql": "SQL DDL / pg_dump",
      "prisma": "Prisma schema",
      "drizzle": "Drizzle ORM",
      "typeorm": "TypeORM entities",
      "sequelize": "Sequelize models",
      "rails": "Rails schema.rb",
      "django": "Django models.py",
      "json": "Adminium JSON"
    },
    "sqlite": {
      "file": "Database file path",
      "helper": "SQLite is a file, not a server — give the absolute path on the machine running Adminium."
    },
    "file": {
      "detectedAs": "Detected: {format}",
      "moreWarnings": "+{count} more warnings — the full list appears in the analyze step.",
      "dropTitle": "Drop your schema file here, or browse",
      "dropHint": "SQL DDL / pg_dump, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, Django models, Adminium JSON",
      "pitch": "No database connection required — we parse your schema file and build the same dashboards.",
      "parsing": "Reading uploaded schema file…",
      "tables": "tables",
      "columns": "columns",
      "warnings": "warnings",
      "errorTitle": "Could not parse the file",
      "parseFailed": "We could not parse that file. If auto-detect guessed wrong, pick the format explicitly and retry.",
      "unsupported": "That format is not recognized — SQL DDL, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, Django models and Adminium JSON are supported. Pick one explicitly and retry.",
      "requestFailed": "Upload failed — check your connection and try again."
    },
    "title": "Connect your database",
    "subtitle": "Point Adminium at a database and we'll generate an admin dashboard from its schema.",
    "name": "Connection name",
    "namePlaceholder": "Production Postgres",
    "modeLabel": "Source input mode",
    "mode": {
      "dsn": "Connection string",
      "fields": "Individual fields",
      "file": "Schema file"
    },
    "dsn": {
      "label": "Connection string",
      "helper": "postgres://user:password@host:5432/database — mysql:// and sqlite: work too.",
      "incomplete": "Add host and database, e.g. postgres://user@host:5432/db",
      "invalidScheme": "Unrecognized scheme — expected postgres://, mysql://, mariadb:// or sqlite:",
      "quickFill": "Quick fill:"
    },
    "fields": {
      "host": "Host",
      "port": "Port",
      "database": "Database",
      "user": "User",
      "password": "Password",
      "ssl": "SSL mode",
      "preview": "Connection string preview:"
    },
    "readOnlyRole": {
      "title": "Use a read-only role",
      "body": "Adminium never writes to your database — setup uses schema metadata only. We recommend a dedicated user with SELECT-only grants; you can decide where Adminium keeps its own tables in the meta-storage step."
    }
  },
  "capability": {
    "mysqlApproxRows": "MySQL row counts are storage-engine estimates (they can drift up to ±40%) — shown with ≈.",
    "mysqlFkEnum": "MySQL FK/enum metadata is weaker: MyISAM tables declare no foreign keys, enums are per-column enum(…) types, and CHECK constraints need MySQL 8.0.16+ / MariaDB 10.2+.",
    "sqliteCheckEnums": "SQLite has no native enum type — enums are synthesized from CHECK (col IN (…)) constraints.",
    "sqliteNoComments": "SQLite has no column comments — use the schema remap editor to add labels.",
    "importNoRowCounts": "Schema files carry no row counts — the tables list shows — instead of made-up numbers.",
    "importNoLiveHealth": "No live database connection — health checks and schema-drift detection are unavailable for this source.",
    "rowsUnavailable": "Schema files have no live database — row counts are unknown until you connect one.",
    "rowsRunAnalyze": "No estimate yet — run ANALYZE on the database for row counts.",
    "rowsNoEstimate": "The engine reported no estimate for this table.",
    "rowsApproximate": "Storage-engine estimate — can drift up to ±40% on InnoDB."
  },
  "test": {
    "log": {
      "moreWarnings": "+{count} more parser warnings",
      "connecting": "Establishing secure connection…",
      "connected": "Connected ({latency} ms) · read-only introspection",
      "connectFailed": "Connection failed.",
      "readingSchema": "Reading schema: public",
      "readingFile": "Reading uploaded schema file…",
      "parsingFile": "Parsing {file}…",
      "detected": "Detected {tables} tables · {columns} columns",
      "found": "Found {tables} tables · {columns} columns",
      "mapping": "Mapping column types → input widgets",
      "relations": "Detecting relations…",
      "piiScan": "Scanning for PII columns…",
      "piiDone": "PII scan complete — {count} columns masked by default",
      "piiDoneUnknown": "PII scan complete",
      "jobFailed": "Introspection failed.",
      "networkFailed": "Request failed — check your connection and retry.",
      "ready": "Ready"
    },
    "title": "Analyzing your schema",
    "subtitle": "Introspecting tables, columns, and relationships. This takes a few seconds.",
    "trust": "We only read your schema and data. Nothing is modified.",
    "errorTitle": "Connection failed",
    "retry": "Retry",
    "logLabel": "Introspection log",
    "hint": {
      "auth": "Authentication failed — check the user name and password in your DSN.",
      "hostUnreachable": "Host unreachable — check the hostname and port, and that the database accepts connections from this machine (allowlist our IPs).",
      "metaPlacement": "This source cannot host Adminium’s meta tables — continue with a separate meta database.",
      "permission": "The role connected but lacks schema-read privileges — grant USAGE on the schema to your introspection role.",
      "timeout": "The database did not answer in time — check network path and load, then retry.",
      "tls": "TLS negotiation failed — try sslmode=require, or upload the CA certificate your server expects.",
      "unknown": "Connection failed — verify the DSN and retry."
    }
  },
  "tables": {
    "importNoCounts": "Schema files carry no row counts — the column shows — until a live database is connected.",
    "title": "Choose your tables",
    "subtitle": "Choose which to include. You can change this anytime.",
    "search": "Filter tables…",
    "listLabel": "Includable tables",
    "emptyFilter": "No tables match your filter.",
    "pii": "PII",
    "highVolume": "high volume",
    "highVolumeNote": "Tables over 100,000 rows start unchecked — ops tables rarely belong in a dashboard.",
    "joinHidden": "{count} join/system tables are pre-hidden — they still power many-to-many relations."
  },
  "hub": {
    "title": "Data connections",
    "subtitle": "{healthy, number} of {total, plural, one {# connection} other {# connections}} healthy",
    "connectNew": "New connection",
    "stats": {
      "connections": "Connections",
      "healthy": "Healthy",
      "tables": "Tables included",
      "pages": "Generated pages"
    },
    "status": {
      "connected": "Connected",
      "error": "Error",
      "unconfigured": "Draft",
      "testing": "Testing…",
      "paused": "Paused"
    },
    "card": {
      "readOnly": "Read-only",
      "tables": "Tables",
      "pages": "Pages",
      "latency": "Latency",
      "latencyMs": "{latency, number} ms",
      "lastIntrospected": "Last introspected",
      "never": "Never",
      "timezone": "Timezone",
      "timezoneGuessed": "from this server",
      "paused": "Adminium is not connecting to this database. Its pages load again when you resume it.",
      "pausedSince": "Paused {when} — Adminium is not connecting to this database. Its pages load again when you resume it."
    },
    "action": {
      "test": "Test",
      "reintrospect": "Re-introspect",
      "reintrospectFile": "Schema-file sources have no live database — re-upload the file instead.",
      "remap": "Remap schema",
      "delete": "Delete",
      "regional": "Regional settings",
      "pause": "Pause",
      "resume": "Resume",
      "pausedHint": "This connection is paused — resume it to reach the database.",
      "rename": "Rename"
    },
    "regional": {
      "title": "Regional settings",
      "intro": "These describe the business this database belongs to, not the person reading it. Apps served from Adminium read them from here.",
      "timezone": "Timezone",
      "timezoneHelper": "Dates and times render in this zone. Apps hosted by Adminium fall back to UTC without one, and say on screen that they are doing it.",
      "guessedTitle": "This zone came from the server",
      "guessedBody": "Adminium filled it in from the machine it runs on, not from anyone here. Save to confirm it, or pick the zone this business actually keeps.",
      "timezonePlaceholder": "Region/City",
      "currency": "Currency",
      "currencyHelper": "Used to format money. Optional — leaving it unset affects formatting only.",
      "currencyPlaceholder": "ISO-4217 code",
      "notSet": "Not set",
      "noMatch": "No matching zone",
      "noMatchCurrency": "No matching currency",
      "save": "Save",
      "failed": "Regional settings could not be saved",
      "saved": "Regional settings updated"
    },
    "test": {
      "ok": "Connection healthy · {latency, number} ms",
      "failed": "Connection test failed"
    },
    "introspect": {
      "noChanges": "Schema unchanged — no new snapshot.",
      "updated": "Schema re-introspected",
      "masksProposed": "{count, plural, one {# column} other {# columns}} proposed for masking — review in the remap editor.",
      "failed": "Introspection failed. Try again."
    },
    "delete": {
      "title": "Delete connection",
      "body": "This deletes “{name}” and its generated pages. Your database itself is never touched.",
      "prompt": "Type {name} to confirm",
      "confirm": "Delete connection",
      "cancel": "Cancel",
      "close": "Close",
      "success": "Connection “{name}” deleted",
      "failed": "Could not delete the connection. Try again."
    },
    "empty": {
      "title": "No data sources yet",
      "body": "Connect a database and Adminium generates your admin panel from its schema.",
      "cta": "Connect a database"
    },
    "hostedApps": "Hosted apps",
    "subtitlePaused": "{healthy, number} of {total, plural, one {# connection} other {# connections}} healthy · {paused, number} paused",
    "pause": {
      "title": "Pause this connection?",
      "body": "Adminium stops opening any connection to “{name}”. Its {pages, plural, one {# page} other {# pages}}, scheduled reports and hosted apps stop loading data until you resume it.",
      "keeps": "Nothing is deleted — the connection, its schema and its {pages, plural, one {# page} other {# pages}} are all kept, and one click brings them back.",
      "confirm": "Pause connection",
      "pausedToast": "Connection “{name}” paused",
      "resumedToast": "Connection “{name}” resumed",
      "pauseFailed": "Could not pause the connection. Try again.",
      "resumeFailed": "Could not resume the connection. Try again."
    },
    "rename": {
      "title": "Rename connection",
      "label": "Name",
      "helper": "What this database is called throughout Adminium — the card, the sidebar group over its pages, and every picker that offers it. The database itself is not renamed.",
      "save": "Rename",
      "saved": "Connection renamed",
      "failed": "The connection could not be renamed"
    }
  },
  "settingsHub": {
    "title": "Workspace settings",
    "subtitle": "Identity, security and destructive actions for this workspace.",
    "save": "Save changes",
    "saved": "Workspace settings updated",
    "saveFailed": "Could not save workspace settings. Try again.",
    "superAdminOnlyTitle": "Super admin required",
    "superAdminOnly": "Only a super admin can change workspace identity and security settings.",
    "identity": {
      "heading": "Workspace identity",
      "appName": {
        "label": "Application name",
        "helper": "Shown in the sidebar, browser title, and emails.",
        "error": "Enter a name of at most 60 characters."
      },
      "logo": {
        "label": "Logo",
        "drop": "Drop an image here",
        "helper": "PNG, JPEG, WebP, GIF or SVG, up to 1 MB. Replaces the built-in mark everywhere.",
        "upload": "Upload logo",
        "replace": "Replace logo",
        "remove": "Remove",
        "uploaded": "Logo updated",
        "removed": "Logo removed",
        "tooLarge": "That image is larger than 1 MB.",
        "badType": "Choose a PNG, JPEG, WebP, GIF or SVG image.",
        "undo": "Undo"
      },
      "showVersion": {
        "label": "Version in the sidebar",
        "helper": "The build number beside the logo. Off hides which version you run."
      }
    },
    "security": {
      "heading": "Security",
      "require2fa": {
        "label": "Require two-factor auth",
        "desc": "Every member must enable 2FA to sign in.",
        "note": "Advisory, not a barrier: members without 2FA are sent to set it up and can no longer turn it off, but their sign-in is never blocked, and API keys are unaffected."
      },
      "allowSignup": {
        "label": "Allow self-signup",
        "desc": "Anyone can create an account — off keeps this workspace invite-only."
      },
      "sessionTtl": {
        "label": "Session lifetime (hours)",
        "error": "Between {min, number} and {max, number} hours."
      },
      "passwordMin": {
        "label": "Minimum password length",
        "error": "Between {min, number} and {max, number} characters."
      }
    },
    "email": {
      "heading": "Email (SMTP)",
      "unconfigured": "No mail server is set, so Adminium cannot send password resets, user invites or scheduled reports.",
      "host": {
        "label": "SMTP host",
        "error": "A bare hostname or IP address — no scheme, port or credentials."
      },
      "port": {
        "label": "Port",
        "error": "Between {min, number} and {max, number}."
      },
      "user": {
        "label": "Username",
        "helper": "Leave empty for a relay that does not authenticate."
      },
      "pass": {
        "label": "Password",
        "helper": "Stored encrypted and never shown again. Leave blank to keep the current one.",
        "error": "This username needs a password."
      },
      "from": {
        "label": "From address",
        "helper": "A bare address, or a display name in front of one.",
        "error": "Enter an email address."
      },
      "secure": {
        "label": "Implicit TLS",
        "helper": "On for port 465. Off starts in cleartext and upgrades with STARTTLS, which is what port 587 expects."
      },
      "remove": "Remove mail server",
      "review": {
        "removed": "Removed",
        "password": "Replaced"
      }
    },
    "review": {
      "title": "Save workspace settings",
      "subtitle": "Review your changes before saving.",
      "confirm": "Save changes",
      "cancel": "Cancel",
      "close": "Close",
      "on": "On",
      "off": "Off",
      "shown": "Shown",
      "hidden": "Hidden",
      "change": "{before} → {after}"
    },
    "defaultsCard": {
      "heading": "Appearance & language defaults",
      "body": "Workspace-wide theme, accent, density and language live under Global defaults.",
      "cta": "Open global defaults"
    },
    "danger": {
      "heading": "Danger zone",
      "subtitle": "Irreversible actions.",
      "empty": "Nothing to delete — no connections yet.",
      "deleteDesc": "Deletes the connection and its generated pages. Your database is not touched. Cannot be undone.",
      "deleteCta": "Delete connection"
    },
    "aiCard": {
      "heading": "AI enrichment",
      "body": "Configure an AI provider (or the copy-paste round-trip) to enrich labels, groups and relations.",
      "cta": "Open AI settings"
    },
    "pagesCard": {
      "heading": "Pages",
      "body": "Add, edit and delete pages, change what each one shows, and reorder the sidebar.",
      "cta": "Manage pages"
    },
    "translationsCard": {
      "heading": "Languages & translations",
      "body": "Reword anything in Adminium, choose which languages people can pick, and add your own.",
      "cta": "Open translations"
    }
  },
  "settingsAi": {
    "title": "AI enrichment",
    "subtitle": "Connect a model to let Adminium suggest labels, groups, relations and more — always reviewed as a diff before anything applies.",
    "saved": "AI provider saved",
    "saveFailed": "Could not save the AI provider. Try again.",
    "save": "Save provider",
    "test": "Test connection",
    "testHintDirty": "Save your changes before testing.",
    "testing": "Pinging the provider…",
    "testError": "Test failed",
    "testErrorBody": "Could not reach the provider. Check the key and base URL.",
    "testOk": "Connected to {model} in {latency} ms",
    "testUnknownModel": "the provider",
    "provider": {
      "heading": "AI provider",
      "subtitle": "Choose how Adminium reaches a model to enrich your schema. Keys are stored encrypted and never shown again.",
      "active": "Active",
      "anthropic": {
        "label": "Anthropic",
        "desc": "Claude models via the Anthropic API."
      },
      "openai": {
        "label": "OpenAI",
        "desc": "GPT models via the OpenAI API."
      },
      "openaiCompatible": {
        "label": "OpenAI-compatible",
        "desc": "Any endpoint that speaks the OpenAI wire format — Groq, Together, vLLM, LM Studio."
      },
      "ollama": {
        "label": "Ollama (local)",
        "desc": "Models running locally through Ollama — no key, no cloud."
      },
      "requiresNetwork": "Requires internet & an API key",
      "networkDisabledTitle": "Direct AI providers are turned off on this install",
      "networkDisabledBody": "This Adminium is configured with no outbound internet access, so it cannot reach a provider API. Use the copy-paste round-trip below — it needs no key and no network."
    },
    "configure": {
      "heading": "Configure {provider}"
    },
    "field": {
      "baseUrl": "Base URL",
      "baseUrlOptional": "Leave as-is unless Ollama runs on another host.",
      "baseUrlHelper": "The endpoint root that serves /chat/completions.",
      "model": "Model",
      "modelFreeText": "Enter the exact model id your endpoint serves.",
      "modelLive": "Loaded live from the provider.",
      "modelStatic": "A known-good list; type a custom id after saving to refresh it.",
      "modelLoading": "Loading…",
      "modelPlaceholder": "Select a model…",
      "key": "API key",
      "keyStored": "Stored encrypted. Replace it to use a different key.",
      "keyMask": "sk-…{last4}",
      "keyReplace": "Replace key",
      "keyOptional": "Optional — some endpoints need no key.",
      "keyWriteOnly": "Write-only: once saved it is never shown again.",
      "noKeyTitle": "No API key needed",
      "noKeyBody": "Ollama runs locally, so nothing leaves this machine."
    },
    "runStatus": {
      "draft": "Draft",
      "running": "Running",
      "awaitingResponse": "Awaiting response",
      "validated": "Validated",
      "applied": "Applied",
      "partiallyApplied": "Partially applied",
      "failed": "Failed",
      "discarded": "Discarded"
    },
    "byo": {
      "heading": "No key? Use your own AI tool",
      "subtitle": "The copy-paste round-trip — nothing leaves this machine.",
      "body": "Studio can generate a self-contained prompt from your schema. Run it in Claude Code, ChatGPT, or any tool you like, then paste the JSON it returns back into the connect wizard. Same validation, same review, same result as the direct path.",
      "guaranteeTitle": "Telemetry-free guarantee",
      "guarantee1": "The prompt carries only your schema and aggregate stats — never row data by default.",
      "guarantee2": "No credentials, instance URL, or identifiers are embedded.",
      "guarantee3": "BYO runs make zero network calls.",
      "promptVersion": "Prompt {version}",
      "schemaVersion": "Schema {version}",
      "headingRecommended": "Use your own AI tool — no key needed",
      "recommended": "Recommended"
    },
    "history": {
      "heading": "Run history",
      "subtitle": "Past enrichment runs. Open one to review its suggestions.",
      "tableLabel": "Enrichment runs",
      "colDate": "Date",
      "colSource": "Source",
      "colStatus": "Status",
      "colChunks": "Chunks",
      "openReview": "Open review for the run from {date}",
      "connection": "Connection",
      "empty": "No enrichment runs yet. Enrich a schema from the connect wizard to see history here.",
      "errorTitle": "Could not load runs",
      "errorBody": "Refresh the page to try again.",
      "noConnections": "Connect a database first — enrichment runs are recorded per connection.",
      "byo": "BYO",
      "directPath": "Direct"
    }
  },
  "enrich": {
    "title": "Enrich with AI",
    "subtitle": "Optionally refine the generated labels, groups, enums and dashboards with an LLM. The heuristic baseline works without it — this only adds suggestions you review before anything applies.",
    "intentLabel": "How would you like to enrich?",
    "sectionsLegend": "What should the AI decide?",
    "localesLegend": "Translate labels into",
    "localeLocked": "(required)",
    "samplingTitle": "Include sample values",
    "samplingHint": "Includes up to 20 real values per non-PII column in the prompt.",
    "samplingPreviewTitle": "What leaves this machine",
    "samplingPreviewBody": "Up to 20 most-common values per non-PII column, plus min/max for numeric and date columns. PII-flagged columns are never sampled. Everything else stays aggregate-only. Review the exact prompt before copying (BYO) — nothing is sent without your action.",
    "noSections": "Select at least one decision group to enrich.",
    "generatePrompt": "Generate prompt",
    "startProvider": "Start enrichment",
    "startOver": "Start over",
    "copied": "Copied",
    "createFailed": "Could not build the enrichment prompt — retry.",
    "createFailedTitle": "Could not start",
    "providerFallback": "your AI provider",
    "fileTitle": "AI enrichment needs a live database",
    "fileBody": "Schema-file sources have no snapshot to enrich yet. Connect a live database to use AI enrichment, or continue — the heuristic baseline still generates a complete app.",
    "section": {
      "labels": "Labels & descriptions",
      "groups": "Navigation groups",
      "enums": "Enum semantics",
      "relations": "Relations",
      "keys": "Key columns",
      "templates": "Page templates",
      "widgets": "Dashboard widgets",
      "pii": "PII & masking",
      "icons": "Icons",
      "microcopy": "Micro-copy"
    },
    "provider": {
      "title": "Use my AI provider",
      "description": "Run enrichment now against your configured provider. You review every suggestion as a diff.",
      "unconfigured": "No AI provider is configured yet — copy a prompt to your own tool below, or configure a provider first.",
      "settingsHint": "Want to run it directly?",
      "settingsLink": "Configure a provider in Settings → AI",
      "networkDisabled": "This Adminium has no outbound internet access, so it cannot reach a provider API. Use the copy-paste round-trip instead — same prompt, same review."
    },
    "byo": {
      "cardTitle": "Copy a prompt to my own AI tool",
      "cardDescription": "Copy a self-contained prompt into Claude Code, ChatGPT, anything — then paste the JSON back. No key needed, nothing leaves this machine automatically.",
      "guidance": "Run this in any AI tool — Claude Code, ChatGPT, anything. Paste the JSON it returns below.",
      "promptLabel": "Enrichment prompt",
      "promptLabelN": "Enrichment prompt {index} of {total}",
      "tokenChip": "≈ {tokens} tokens",
      "copyPrompt": "Copy prompt",
      "copyPromptDone": "Prompt copied",
      "download": "Download .md",
      "chunkTabs": "Prompt chunks",
      "chunkTab": "Prompt {index}",
      "chunkValid": "Chunk {index} validated",
      "pasteLabel": "Paste the JSON response",
      "pastePlaceholder": "Paste the JSON response here…",
      "validate": "Validate",
      "valid": "Response validated",
      "mergedTitle": "All {count} chunks validated and merged",
      "mergedTitleSingle": "Response validated",
      "mergedBody": "Suggestions are ready to review against the heuristic baseline.",
      "errorsTitle": "Validation found {count} issues",
      "copyErrors": "Copy errors for your AI tool",
      "copyErrorsDone": "Errors copied",
      "copyErrorsHint": "Paste this back into your AI tool to get a corrected response.",
      "droppedItems": "{count} suggestions were dropped during validation — review shows the rest.",
      "pendingTitle": "Validate every prompt to continue",
      "pendingBody": "Paste the JSON response above and validate it to continue to review.",
      "pendingBodyChunked": "Each chunk must validate before the suggestions merge. Paste and validate every prompt above.",
      "requestFailed": "Could not reach the server to validate — retry.",
      "continueReview": "Continue to review",
      "wholeDocument": "whole document",
      "cardTitleRecommended": "Copy a prompt to my own AI tool — recommended"
    },
    "direct": {
      "title": "Enriching with AI",
      "subtitle": "Sending your schema to",
      "building": "Building prompt…",
      "logLabel": "Enrichment log",
      "cancel": "Cancel",
      "back": "Back to options",
      "retry": "Retry",
      "done": "Enrichment complete — review the suggestions.",
      "continueReview": "Continue to review",
      "failed": "The provider run failed. Check your AI settings and retry.",
      "jobFailed": "The enrichment run did not finish.",
      "startFailed": "Could not start the run — retry.",
      "errorTitle": "Enrichment failed"
    },
    "skip": {
      "title": "Skip — use heuristics only",
      "description": "Generate from the heuristic baseline. You can enrich later from Settings → AI — skipping is never penalized.",
      "confirmTitle": "Continuing with heuristics",
      "confirmBody": "The generated app will use the heuristic labels, groups and dashboards. Continue to generate — you can run AI enrichment any time from Settings → AI."
    }
  },
  "review": {
    "unavailableTitle": "Review screen not available",
    "unavailableBody": "This build does not include the enrichment review screen yet (06-T14). It lands with the diff-and-apply flow."
  },
  "llmRuns": {
    "review": {
      "header": {
        "title": "Review AI suggestions",
        "model": "Model",
        "snapshot": "Snapshot",
        "byo": "BYO",
        "pathDirect": "Direct API",
        "pathByo": "Copy-paste",
        "agree": "{n} agree",
        "conflict": "{n} conflict",
        "new": "{n} new",
        "rejects": "{n} rejects",
        "countsAria": "Suggestion counts"
      },
      "bulk": {
        "thresholdLabel": "Confidence threshold",
        "thresholdAria": "Accept-all confidence threshold",
        "acceptAll": "Accept all ≥ {pct}%",
        "clear": "Clear selection"
      },
      "section": {
        "selectAllAria": "Select all in {group}",
        "acceptedCount": "{n} accepted"
      },
      "group": {
        "labels": "Labels & translations",
        "navigation": "Navigation & domains",
        "enums": "Enum semantics",
        "relations": "Relations",
        "keys": "Key columns",
        "templates": "Page templates",
        "dashboards": "Dashboards & widgets",
        "pii": "PII & masking",
        "icons": "Icons",
        "microcopy": "Micro-copy"
      },
      "status": {
        "agree": "Agrees",
        "conflict": "Conflict",
        "new": "New",
        "heuristicOnly": "Heuristic only",
        "rejects": "Rejects heuristic",
        "locked": "Locked"
      },
      "row": {
        "acceptAria": "Accept {noun} suggestion for {target}",
        "keptEdited": "kept — edited by you",
        "rejectsCallout": "The AI rejects a heuristic decision — confirm before accepting.",
        "showTranslations": "Show translations",
        "hideTranslations": "Hide translations",
        "confidenceAria": "Confidence {pct}%",
        "noAi": "No AI suggestion"
      },
      "value": {
        "none": "No value",
        "absent": "None",
        "dash": "—",
        "display": "Display",
        "key": "Key",
        "rank": "rank {n}",
        "span": "span {n}",
        "tableCount": "{n} tables",
        "widgetCount": "{n} widgets",
        "enumWorkflow": "Workflow",
        "enumCategory": "Category",
        "notPii": "Not PII",
        "label": "Label",
        "description": "Description",
        "subtitle": "Page subtitle",
        "headline": "Empty-state headline",
        "guidance": "Empty-state guidance"
      },
      "apply": {
        "title": "Apply {n} suggestions",
        "subtitle": "These changes are written in one transaction and can be undone.",
        "empty": "Nothing selected to apply.",
        "confirm": "Apply changes"
      },
      "footer": {
        "count": "{n} suggestions selected",
        "apply": "Apply {n} accepted suggestions",
        "failed": "Apply failed"
      },
      "toast": {
        "applied": "Applied {n} suggestions",
        "appliedPartial": "Applied {n} suggestions (some skipped)",
        "applyFailed": "Could not apply suggestions",
        "undoFailed": "Could not undo this change"
      },
      "error": {
        "title": "Could not load this run"
      },
      "notReady": {
        "title": "This run has no suggestions to review yet",
        "body": "A run must be validated before its suggestions can be reviewed. Generate or paste a response first."
      },
      "applied": {
        "title": "This run has been applied",
        "body": "The accepted suggestions below are read-only."
      },
      "empty": {
        "title": "No suggestions",
        "body": "This run produced no suggestions to review."
      },
      "cat": {
        "label": "label",
        "key": "key columns",
        "enum": "enum",
        "relation": "relation",
        "pii": "PII",
        "template": "page template",
        "group": "navigation group",
        "dashboard": "dashboard",
        "widget": "widget",
        "copy": "micro-copy"
      }
    }
  },
  "wizard": {
    "title": "New connection",
    "back": "Back",
    "continue": "Continue",
    "progress": "Setup progress",
    "persistFailed": "Could not save your table selection — retry.",
    "persistFailedTitle": "Save failed",
    "bridgeAppliedTitle": "Connection string received",
    "bridgeAppliedBody": "Handed over from adminium.dev by your browser — it went straight to this machine and was never uploaded. Check it below, then continue.",
    "bridgeFailedTitle": "That hand-off could not be used",
    "bridgeFailedBody": "It has already been used or has expired. Paste your connection string below instead.",
    "step": {
      "source": "Source",
      "test": "Analyze",
      "tables": "Tables",
      "meta": "Meta storage",
      "intent": "Intent",
      "enrich": "Enrich",
      "generate": "Generate"
    }
  },
  "meta": {
    "title": "Where should Adminium keep its own tables?",
    "subtitle": "Pages, roles, audit log and settings live in adminium_-prefixed tables — never mixed into your data.",
    "sameDb": {
      "title": "Same database",
      "description": "adminium_* tables are created beside your source tables. Simplest setup — needs a role with write and CREATE TABLE privileges.",
      "disabledReadOnly": "Your role is read-only — Adminium never writes to this database. Choose a separate database for Adminium’s own tables.",
      "disabledNoDdl": "This role cannot run DDL — Adminium migrations need CREATE TABLE. Choose a separate database for Adminium’s own tables.",
      "disabledFile": "A schema file has no live database — choose a separate database for Adminium’s own tables."
    },
    "separate": {
      "title": "Separate database",
      "description": "Adminium keeps its tables in a different database. Your source stays untouched — required for read-only sources.",
      "dsn": "Meta database connection string",
      "helper": "Needs write + DDL privileges — Adminium runs its own migrations there.",
      "test": "Test connection",
      "ok": "Compatible — write ✓ · DDL ✓",
      "insufficient": "This role cannot host the meta store — Adminium needs write and CREATE TABLE privileges there.",
      "errorTitle": "Meta store not compatible"
    },
    "testFailed": "Connection failed.",
    "v1Note": {
      "title": "About this install",
      "body": "This server already keeps its own tables in a configured database, and this step does not move them. It validates that your choice is compatible with this connection — the server enforces the same rule independently (409 META_PLACEMENT_INVALID)."
    },
    "move": {
      "title": "Moving Adminium’s tables",
      "copying": "Moving Adminium’s tables…",
      "restarting": "Restarting…",
      "copyingBody": "Copying every adminium_ table into the new database. Your source data is not touched, and nothing is switched over until the copy is verified.",
      "restartingBody": "The copy is done. Adminium is restarting onto the new database — this page will continue by itself in a few seconds.",
      "failed": "Could not move Adminium’s tables — retry.",
      "timeout": "Adminium moved its tables but has not come back yet. Your data is safe in the new database — reload this page in a moment."
    },
    "willMove": {
      "title": "This will move Adminium’s tables",
      "body": "Adminium is currently using its built-in SQLite store. Continue copies that store into the database you picked and restarts onto it — accounts, pages and settings come with it, so you stay signed in."
    }
  },
  "intent": {
    "title": "What do you need?",
    "subtitle": "The intent shapes which pages get generated. You can change it later — changing it proposes a regeneration, never a silent rewrite.",
    "trust": "We read your schema only — never your row data during setup.",
    "fullAdmin": {
      "title": "Full admin panel",
      "description": "Dashboards, CRUD pages, search, imports and exports — everything your schema supports."
    },
    "analytics": {
      "title": "Read-only analytics",
      "description": "Dashboards, charts and read-only grids. No forms, no writes — every role capped at Viewer."
    },
    "crud": {
      "title": "CRUD tables",
      "description": "One editing page per table plus search and import/export — a minimal home, no dashboards."
    },
    "support": {
      "title": "Support console",
      "description": "Queues, ticket and customer detail pages first. Deletes off by default. (Queue templates land in M7 — the v1 page set matches Full admin.)"
    }
  },
  "generate": {
    "title": "Generate your app",
    "subtitle": "One page per included table plus dashboards per domain — intent:",
    "run": "Generate dashboard",
    "openApp": "Open your app",
    "logLabel": "Generation log",
    "log": {
      "classifying": "Classifying schema…",
      "composing": "Composing templates…",
      "writing": "Writing pages…",
      "done": "{pages} pages generated across {groups} nav groups"
    },
    "successTitle": "Your dashboard is ready",
    "successBody": "{pages} pages across {groups} navigation groups — generated from your schema, editable in Studio.",
    "errorTitle": "Generation failed",
    "failed": "Generation failed — retry, or re-run introspection first.",
    "fileTitle": "Schema file parsed — generation needs a live database",
    "fileBody": "Your schema parsed cleanly and the preview above is real. Generating a running app straight from a schema file (with placeholder rows) is not available yet — connect a live database to generate today."
  },
  "remap": {
    "column": {
      "nullable": "nullable",
      "labelOverride": "Display label",
      "labelHelper": "Inferred: {name}",
      "logicalType": "Logical type",
      "logicalTypeHelper": "Inferred: {type} (from {dbType}) — mapped by the adapter; not overridable in v1.",
      "semantic": "Semantic type",
      "unclassified": "Not classified yet.",
      "semanticHelper": "Classifier: {tag} · {confidence}% confidence · source: {source}",
      "semanticInferred": "inferred: {tag}",
      "currency": "Currency",
      "currencyHelper": "ISO 4217 code applied to money formatting.",
      "pii": "Mask by default",
      "piiHelper": "Masked values render redacted; unmasking requires the data.unmask_pii permission and is audit-logged.",
      "enum": "Enum semantics",
      "enumKind": "Enum kind",
      "enumWorkflow": "Workflow",
      "enumCategory": "Category",
      "enumLabelFor": "Label for {value}",
      "enumToneFor": "Tone for {value}",
      "enumToneAuto": "auto",
      "enumHelper": "Workflow enums drive status pills and board columns; tones map values onto the semantic tint scale."
    },
    "diff": {
      "one": "1 change",
      "count": "{count} changes",
      "saved": "Overrides saved.",
      "revertOne": "Revert {change}",
      "regenerate": "Regenerate pages",
      "revertAll": "Revert all",
      "save": "Save overrides"
    },
    "table": {
      "iconPicker": "Table icon",
      "system": "System",
      "labelOverride": "Display label",
      "labelHelper": "Inferred: {name}",
      "icon": "Icon",
      "navGroup": "Nav group",
      "navGroupHelper": "Nav placement is decided by the generator — a table.navGroup override is not in the v1 vocabulary.",
      "include": "Include in generated app",
      "includeHelper": "Excluded tables get no pages and disappear from nav.",
      "shape": "Table shape (classified)",
      "role": "Role",
      "unclassified": "Not classified",
      "kind": "Kind",
      "hierarchy": "Hierarchy",
      "selfFk": "Self-reference via {column}",
      "polymorphic": "Polymorphic pairs",
      "rows": "Row estimate",
      "shapeHelper": "Classification is recomputed on every introspection; overrides layer on top and survive regeneration."
    },
    "relations": {
      "declared": "Declared foreign keys",
      "noneDeclared": "No declared foreign keys touch this table.",
      "inferred": "Inferred relations",
      "noneInferred": "Nothing inferred for this table.",
      "confidence": "inferred · {pct}%",
      "accepted": "Accepted",
      "suppressed": "Suppressed",
      "accept": "Accept",
      "suppress": "Suppress",
      "overrides": "Override relations (applied)",
      "overrideBadge": "override",
      "add": "Add virtual relation",
      "fromColumn": "From column",
      "noColumns": "No matching column",
      "fromPlaceholder": "customer_id",
      "toTable": "To table",
      "noTables": "No matching table",
      "toColumn": "To column",
      "cardinality": "Cardinality",
      "addButton": "Add relation"
    },
    "toast": {
      "saved": "Schema overrides saved",
      "savedDetail": "The applied schema below reflects your changes.",
      "regenerated": "{created} created · {updated} updated · {unchanged} unchanged",
      "regeneratedDetail": "Pages you edited by hand are preserved — only pages with an untouched generated_hash were regenerated in place.",
      "regenerateFailed": "Regeneration failed"
    },
    "title": "Schema remap",
    "subtitle": "{tables} tables · {applied} overrides applied",
    "saveFailed": "Save failed: {message}",
    "loadFailed": "Could not load the schema for this connection.",
    "inspector": "Inspector",
    "empty": {
      "title": "Pick a table or column",
      "description": "Select something in the schema tree to remap its label, type, relations or masking."
    },
    "tabs": {
      "details": "Details",
      "relations": "Relations"
    },
    "tree": {
      "label": "Schema",
      "search": "Search tables and columns",
      "searchPlaceholder": "Search tables…",
      "noMatches": "No tables match your search.",
      "collapse": "Collapse table",
      "expand": "Expand table",
      "unsaved": "Unsaved change",
      "excluded": "Excluded"
    },
    "badge": {
      "pk": "PK",
      "fk": "FK",
      "unique": "UNIQUE",
      "pii": "PII",
      "masked": "Masked"
    },
    "unavailableTitle": "Schema remap editor not available",
    "unavailableBody": "This build does not include the remap editor yet (09-T12). Re-run generation after it lands to remap labels, types and relations."
  },
  "publicApi": {
    "error": "Something went wrong",
    "scopes": {
      "deleteTitle": "Delete this scope",
      "deleteBody": "Any page using a key bound to this scope stops loading data. Keys are not deleted — revoke them first if that is what you meant.",
      "deletePrompt": "Type the scope name to confirm",
      "deleteConfirm": "Delete scope",
      "issuesTitle": "This scope did not compile",
      "title": "Scopes",
      "subtitle": "A scope is the whole of what a key may reach — the tables, the exact columns, and a filter the caller can narrow but never remove.",
      "emptyTitle": "No scopes yet",
      "emptyBody": "Create one below. It is checked against your live schema before it is saved.",
      "keyCount": "{count, plural, =0 {no keys} one {# key} other {# keys}}",
      "delete": "Delete",
      "nameLabel": "Name",
      "connectionLabel": "Connection ID",
      "documentLabel": "Scope document",
      "documentHint": "Compiled against your schema when you save. Every column a caller can reach is listed here and nowhere else.",
      "create": "Create scope",
      "formLabel": "Create a scope"
    },
    "cancel": "Cancel",
    "close": "Close",
    "title": "Public API",
    "subtitle": "Let your own customer- or staff-facing pages read this database, through a scope you define.",
    "notRegistered": {
      "title": "Not enabled on this server",
      "body": "Set ADMINIUM_PUBLIC_API_ORIGINS to the exact origins allowed to call it, then restart. Until then these routes are not served at all."
    },
    "toggle": {
      "label": "Serve the public API",
      "hint": "Turning this off stops every public request immediately. Nothing is deleted — keys, scopes and data all survive."
    },
    "origins": {
      "label": "Origins allowed to call it"
    },
    "keys": {
      "title": "Keys",
      "subtitle": "These go in your page’s JavaScript, so anyone can read them. That is expected — a key can only ever do what its scope allows.",
      "emptyTitle": "No keys yet",
      "emptyBody": "Create a scope first, then mint a key for it.",
      "reveal": "Show key",
      "rotate": "Rotate",
      "revoke": "Revoke",
      "nameLabel": "Name",
      "scopeLabel": "Scope",
      "scopePlaceholder": "Choose a scope",
      "create": "Create key",
      "formLabel": "Create a key",
      "scopeIsAuthTitle": "The scope is the only permission",
      "scopeIsAuthBody": "A key can reach exactly what its scope lists and nothing else. It does not use roles or table permissions, and it cannot read anything through the rest of the API.",
      "appLabel": "Bind to a hosted app surface (optional)",
      "appHint": "The app’s customer surface then serves this key itself — rotating it needs no rebuild.",
      "appNone": "Not bound"
    },
    "status": {
      "heading": "Status"
    }
  },
  "hostedApps": {
    "title": "Hosted apps",
    "subtitle": "The app surfaces this instance serves — where each one appears, and the domains pointed at them.",
    "error": "Something went wrong",
    "emptyTitle": "No app surfaces are being served",
    "emptyBody": "Point ADMINIUM_SURFACES_DIR at a directory of built surfaces — one folder per app and side, each with its index.html — and restart. They are then served under /apps/ and appear here.",
    "surfaces": {
      "title": "Surfaces",
      "subtitle": "A staff surface can blend into this dashboard’s sidebar or stand on its own; a customer surface is public and reads through its bound key.",
      "staff": "Staff",
      "customer": "Customer",
      "noNav": "Internal placement unavailable — rebuild this surface with the current toolkit so it emits surface.json.",
      "noKey": "No key bound — this surface cannot read data until one is minted for it.",
      "mintLink": "Mint one under Public API",
      "boundKey": "Serves key",
      "placementLabel": "Placement",
      "placementInternal": "In the sidebar (blended)",
      "placementExternal": "External (own URL only)",
      "connectionLabel": "Reads",
      "connectionUnset": "Whichever is serving"
    },
    "domains": {
      "title": "Domains",
      "subtitle": "Point a domain’s DNS at your proxy, pass the Host header through to Adminium, and attach it here — that host then serves the surface instead of this dashboard. Certificates stay on your proxy.",
      "issuesTitle": "The domain map was refused",
      "savedTitle": "Saved",
      "savedBody": "Mappings take effect within a few seconds. A host only answers once its DNS and your proxy actually reach this instance.",
      "none": "No domains are attached.",
      "hostLabel": "Host",
      "surfaceLabel": "Surface",
      "remove": "Remove",
      "add": "Attach a domain",
      "save": "Save domains",
      "instanceLabel": "Instance",
      "instanceOwn": "The app's own"
    },
    "instances": {
      "title": "Instances",
      "body": "Serve the same app over more than one database. Each instance is reachable at /apps/<app>/<segment>/<side>/ and reads only the connection you give it.",
      "appLabel": "App",
      "slugLabel": "URL segment",
      "readsLabel": "Reads",
      "add": "Add an instance",
      "save": "Save instances",
      "remove": "Remove",
      "empty": "No extra instances.",
      "failed": "Instances were not saved"
    }
  },
  "addOns": {
    "plan": {
      "blocked": "This cannot be installed here",
      "needsColumns": "This add-on needs columns you do not have",
      "needsColumnsBody": "Adminium will not add columns to tables you already own. Add them yourself, then install.",
      "willCreate": "This will create tables in your database",
      "willCreateBody": "Installing creates these tables. Uninstalling later leaves them, and their data, alone.",
      "noData": "This add-on reads and writes no tables of its own.",
      "reuse": "This add-on will use tables you already have:"
    },
    "consent": {
      "title": "Install {name}",
      "subtitle": "What this add-on will do, before it can do it.",
      "close": "Close",
      "loading": "Working out what this would do…",
      "hosts": "Attach to",
      "cancel": "Cancel",
      "confirm": "Install"
    },
    "connect": {
      "apiKey": "API key",
      "submit": "Connect"
    },
    "title": "Add-ons",
    "subtitle": "Extra capabilities you can add to your apps — shipping, artwork, data. Each one says what it needs before you install it.",
    "error": "Something went wrong",
    "browse": {
      "title": "Available",
      "online": "Includes add-ons from the online catalogue. Checking for newer versions is a separate action.",
      "offline": "Showing the add-ons that came with this build. Browsing online is switched off, and nothing here has contacted the internet.",
      "refresh": "Check for newer",
      "emptyTitle": "No add-ons available",
      "emptyBody": "This build shipped none, and the online catalogue is off.",
      "bundled": "Included",
      "upgrade": "v{version} available",
      "download": "Download",
      "install": "Install",
      "discard": "Discard",
      "upgradeAction": "Upgrade",
      "toggle": "Browse the online catalogue"
    },
    "installed": {
      "title": "Installed",
      "emptyTitle": "Nothing installed yet",
      "emptyBody": "Install an add-on above and it will appear here with its hosts and connection.",
      "connected": "Connected",
      "notConnected": "Not connected",
      "egress": "May contact: {hosts}",
      "on": "on",
      "off": "off",
      "disconnect": "Disconnect",
      "uninstall": "Uninstall"
    },
    "confirm": {
      "close": "Close",
      "disconnectTitle": "Disconnect this add-on",
      "uninstallTitle": "Uninstall this add-on",
      "discardTitle": "Discard this download",
      "disconnectBody": "Its keys are deleted and it stops making calls. Every table and every row it created stays exactly as it is, and you can reconnect at any time.",
      "uninstallBody": "Its keys are deleted and its files are removed from this server. Every table and every row it created stays exactly as it is. You can install it again later.",
      "discardBody": "The downloaded files are deleted. Nothing was installed, so nothing else changes — you can download it again whenever you like.",
      "cancel": "Cancel",
      "disconnect": "Disconnect",
      "uninstall": "Uninstall",
      "discard": "Discard"
    },
    "upgradeNote": "Upgrading keeps the hosts an add-on is attached to and the connection it already has.",
    "job": {
      "title": "Downloading",
      "body": "Fetching and verifying. Nothing is installed until you say so.",
      "failed": "The download did not finish. Nothing was installed."
    },
    "veto": {
      "title": "This deployment cannot browse online",
      "body": "The setting is saved, but network features are off for this server and that wins. Downloaded add-ons still work, and you can still upload one yourself."
    },
    "sideload": {
      "title": "Upload a package",
      "hint": "For a server with no internet. It is checked exactly as a download would be, so it needs the hash that came with it.",
      "file": "Package file (.tgz)",
      "key": "Add-on key",
      "version": "Version",
      "sha": "Integrity (sha512-…)",
      "shaHint": "The `integrity` value `npm pack --json` printed. The upload is refused if the bytes do not match.",
      "submit": "Upload"
    }
  },
  "pages": {
    "title": "Pages",
    "subtitle": "Add, edit and organise the pages of your app, and the order they appear in the sidebar.",
    "createButton": "New page",
    "loadFailed": {
      "title": "Pages could not be loaded",
      "body": "Managing pages needs the “Manage pages” permission. Ask an administrator to grant it to one of your roles."
    },
    "tab": {
      "pages": "All pages",
      "sidebar": "Sidebar order"
    },
    "list": {
      "title": "Pages",
      "count": "{count, plural, one {# page} other {# pages}}"
    },
    "empty": {
      "title": "No pages yet",
      "body": "Connect a database to generate pages automatically, or create one by hand."
    },
    "status": {
      "live": "Live",
      "hidden": "Hidden"
    },
    "origin": {
      "generated": "Generated",
      "manifest": "Add-on",
      "llm": "Assistant",
      "system": "System",
      "user": "Custom"
    },
    "row": {
      "menu": "Actions for {title}"
    },
    "action": {
      "edit": "Edit page",
      "duplicate": "Duplicate",
      "hide": "Hide from sidebar",
      "show": "Show in sidebar",
      "delete": "Delete page"
    },
    "create": {
      "title": "New page",
      "failed": "The page could not be created",
      "submit": "Create page",
      "subtitle": "Pick what this page shows and how it looks."
    },
    "duplicate": {
      "title": "Duplicate page",
      "failed": "The page could not be duplicated",
      "submit": "Duplicate"
    },
    "delete": {
      "title": "Delete this page?",
      "body": "This cannot be undone. Saved views and personal layouts on this page are deleted for everyone.",
      "bodyGenerated": "This page was created by schema generation, so it will come back the next time you regenerate. Saved views and personal layouts on it are deleted for everyone.",
      "prompt": "Type {slug} to confirm",
      "confirm": "Delete page"
    },
    "field": {
      "title": "Title",
      "titleHint": "Shown in the sidebar and the page header.",
      "slug": "Page address",
      "slugHint": "Lowercase letters, numbers and dashes. Just the last part — the rest of the address is added for you.",
      "slugTaken": "Another page already uses this address.",
      "slugWarning": "Changing the address breaks existing links and bookmarks to this page.",
      "template": "Template",
      "templateHint": "Decides what the page can hold. You can change it later.",
      "group": "Sidebar group",
      "groupHint": "Which section of the sidebar it appears in.",
      "icon": "Icon",
      "iconHint": "Shown beside the page name in the sidebar.",
      "visible": "Show in sidebar",
      "visibleHint": "A hidden page stays reachable at its URL for anyone who has the link.",
      "table": "Table",
      "tableCreateHint": "The table this page reads. You can bind it later.",
      "tableNone": "Not bound",
      "tableNeedsConnection": "Pick a data source first.",
      "connection": "Data source",
      "connectionNone": "None",
      "iconPick": "Choose the page icon",
      "padding": "Page padding",
      "width": "Content width",
      "widthHint": "How wide the page’s content column may grow on a large screen."
    },
    "editor": {
      "title": "Edit page",
      "save": "Save changes",
      "saveFailed": "Changes could not be saved",
      "openPage": "Open page",
      "generated": {
        "title": "This page was generated from your schema",
        "body": "Your changes survive regeneration. Deleting only lasts until the next run recreates it."
      },
      "contentUnavailable": "Page contents could not be loaded",
      "contentUnavailableBody": "The details above can still be saved.",
      "contentInvalid": "This page’s configuration is not readable",
      "contentInvalidBody": "It was written by a newer version, or it is malformed. Regenerate the page or delete it.",
      "data": "Data",
      "schemaFailed": "Tables could not be listed",
      "schemaFailedBody": "This connection may not have been analysed yet. Run introspection from Studio → Data connections.",
      "notBindable": "This template is not bound to one table",
      "notBindableBody": "Its contents are built widget by widget instead. Open the page and use Edit to add them.",
      "recompose": "This page will be rebuilt",
      "recomposeBody": "Saving rebuilds the contents. Column and widget edits here are lost.",
      "missing": "That page no longer exists",
      "missingBody": "It may have been deleted, or removed by a regeneration run.",
      "details": "Details",
      "itemsPending": "Save the change above first — the contents are rebuilt from it.",
      "columns": "Columns",
      "appearance": "Appearance"
    },
    "sidebar": {
      "help": "Reorder pages within a group, or move one to another group. Changes apply to every user.",
      "discard": "Discard",
      "save": "Save order",
      "saveFailed": "The new order could not be saved",
      "emptyGroup": "No pages in this group.",
      "moveUp": "Move {title} up",
      "moveDown": "Move {title} down",
      "moveTo": "Move {title} to a group",
      "ungrouped": {
        "title": "Some pages are in no sidebar group",
        "body": "These pages work at their URL but appear nowhere in the sidebar. Open each one and pick a group."
      }
    },
    "columns": {
      "help": "Drag to reorder columns, rename their headers, and choose which are shown in the table.",
      "empty": "No columns yet — add them below.",
      "pk": "Key",
      "pii": "PII",
      "header": "Header for {name}",
      "shown": "Shown",
      "toggle": "Show {name} in the table",
      "dragHandle": "Reorder {name}",
      "remove": "Remove {name}",
      "addOpen": "Add column",
      "addTitle": "Add a column",
      "addSearch": "Search columns…",
      "addFromTable": "From {table}",
      "addFromLinked": "From linked tables",
      "addLinkedHelp": "Show a value from the table a link column points to.",
      "addVia": "via {column}",
      "addNoMatches": "No columns match “{query}”.",
      "followColumn": "Follow {name}",
      "addLinkedFrom": "Tables that link here",
      "addLinkedFromHelp": "Add a count of the rows that point at each record.",
      "countBadge": "Count",
      "lookupBadge": "Linked",
      "lookupBack": "Back",
      "lookupBrowse": "Pick what to show from {table}",
      "lookupBroken": "That link no longer resolves",
      "lookupBrokenBody": "The schema changed while you were browsing. Start the link again.",
      "schemaUnavailable": "Database columns could not be listed, so columns cannot be added back here.",
      "none": {
        "title": "This page has no columns yet",
        "body": "Columns are read from the table when the page is generated. Bind this page to a table and regenerate to fill them in."
      }
    },
    "icon": {
      "none": "Choose an icon",
      "search": "Search icons",
      "noMatches": "No icons match that search."
    },
    "preview": {
      "untitled": "Untitled page",
      "note": "An illustration of the layout, not your data."
    },
    "padding": {
      "default": "Default for this template",
      "none": "None",
      "standard": "Standard (28 × 24)",
      "custom": "Custom…",
      "x": "Sides (px)",
      "y": "Top and bottom (px)"
    },
    "width": {
      "default": "Default for this template",
      "narrow": "Narrow (720px)",
      "content": "Content (900px)",
      "page": "Page (1080px)",
      "dash": "Dashboard (1320px)",
      "wide": "Wide (1800px)",
      "full": "Full width (no limit)"
    }
  }
} as const;
