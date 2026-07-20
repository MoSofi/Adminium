/**
 * GENERATED MIRROR of ../../../locales/en-US/common.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "common": {
    "dismiss": "Dismiss",
    "notifications": "Notifications",
    "retry": "Retry",
    "undo": "Undo",
    "close": "Close",
    "cancel": "Cancel",
    "back": "Back",
    "loading": "Loading",
    "clearSearch": "Clear search",
    "clear": "Clear",
    "save": "Save"
  },
  "auth": {
    "headline": "Turn any database into a dashboard.",
    "trust": "AGPL core · Self-hosted · Your data stays yours",
    "signIn": {
      "title": "Welcome back",
      "subtitle": "Sign in to your Adminium workspace.",
      "email": "Email",
      "emailInvalid": "Enter a valid email address.",
      "password": "Password",
      "passwordRequired": "Enter your password.",
      "showPassword": "Show password",
      "hidePassword": "Hide password",
      "remember": "Keep me signed in",
      "forgot": "Forgot?",
      "submit": "Sign in",
      "invalid": "Invalid email or password.",
      "rateLimited": "Too many attempts — try again in a minute.",
      "failed": "Sign-in failed. Check your connection and try again."
    },
    "forgot": {
      "title": "Reset your password",
      "email": "Email",
      "emailInvalid": "Enter a valid email address.",
      "submit": "Send reset link",
      "sentTitle": "Check your email",
      "resend": "Send it again",
      "back": "Back to sign in",
      "done": "Back to sign in",
      "rateLimited": "Too many requests — try again later.",
      "failed": "Something went wrong. Try again.",
      "smtpUnconfigured": "This Adminium has no email server configured, so it cannot send a reset link. Ask an administrator to reset your password for you."
    },
    "reset": {
      "title": "Set a new password",
      "subtitle": "Must be at least 8 characters.",
      "password": "New password",
      "confirm": "Confirm password",
      "showPassword": "Show password",
      "hidePassword": "Hide password",
      "strength": "Password strength",
      "weak": "Weak",
      "fair": "Fair",
      "good": "Good",
      "strong": "Strong",
      "tooShort": "Use at least 8 characters.",
      "submit": "Reset password",
      "failed": "Reset failed. Try again."
    },
    "otp": {
      "title": "Two-factor authentication",
      "subtitle": "Enter the 6-digit code from your authenticator app.",
      "code": "One-time code",
      "recoveryCode": "Recovery code",
      "useRecovery": "Lost your device? Use a recovery code",
      "useAuthenticator": "Use your authenticator app instead",
      "submit": "Verify",
      "invalid": "That code didn’t work. Try again.",
      "failed": "Verification failed. Check your connection and try again."
    }
  },
  "nav": {
    "home": "Home",
    "primary": "Primary",
    "account": "Account",
    "signOut": "Sign out",
    "empty": "Pages appear here once a database is connected.",
    "connection": {
      "shared": "Shared",
      "unnamed": "Connection"
    },
    "imports": "Import data",
    "exports": "Data exports",
    "emailTemplates": "Email templates",
    "notificationSettings": "Notification settings",
    "scheduledReports": "Scheduled reports",
    "group": {
      "workspace": "Workspace",
      "library": "Library",
      "planning": "Planning",
      "people": "People",
      "account": "Account"
    }
  },
  "topbar": {
    "search": "Search…",
    "notifications": "Notifications",
    "notificationsLoading": "Loading notifications",
    "notificationsError": "Couldn’t load notifications.",
    "notificationsEmpty": "You’re all caught up.",
    "theme": "Toggle light / dark",
    "userMenu": "Account menu",
    "profile": "Profile",
    "preferences": "Preferences",
    "signOut": "Sign out"
  },
  "palette": {
    "dialog": "Command palette",
    "placeholder": "Type a command or search…",
    "navigate": "Navigate",
    "actions": "Actions",
    "askAi": "Ask AI",
    "shortcuts": "Keyboard shortcuts",
    "signOut": "Sign out",
    "themeDark": "Switch to dark theme",
    "themeLight": "Switch to light theme",
    "footerNavigate": "navigate",
    "footerOpen": "select",
    "footerClose": "close"
  },
  "shortcuts": {
    "title": "Keyboard shortcuts",
    "subtitle": "Work faster across Adminium",
    "close": "Close",
    "dismiss": "Close or dismiss",
    "palette": "Open command palette",
    "panel": "Show shortcuts panel",
    "search": "Focus search",
    "sidebar": "Toggle sidebar",
    "theme": "Toggle light / dark",
    "then": "then",
    "footerPre": "Press",
    "footerPost": "anytime to open this panel."
  },
  "states": {
    "checked": "checked 8s ago",
    "diagnostics": "Diagnostics"
  },
  "notFound": {
    "title": "This page went missing",
    "errorLine": "Error 404",
    "searchPlaceholder": "Search for a page…",
    "matches": "Matching pages",
    "popular": "Popular destinations",
    "goBack": "Go back",
    "backToDashboard": "Back to dashboard"
  },
  "page": {
    "invalid": {
      "title": "This page’s configuration is invalid",
      "body": "The stored page document failed validation and cannot be rendered."
    },
    "renderError": {
      "title": "This page failed to render"
    },
    "tooNew": {
      "title": "This page needs a newer Adminium"
    },
    "unknownTemplate": {
      "title": "Unknown page template"
    }
  },
  "mutation": {
    "created": "Record created",
    "updated": "Record updated",
    "deleted": "Record deleted"
  },
  "undo": {
    "done": "Change undone",
    "failed": "Could not undo this change"
  },
  "prefs": {
    "theme": {
      "label": "Theme",
      "light": "Light",
      "dark": "Dark",
      "system": "System"
    },
    "accent": {
      "label": "Accent color",
      "indigo": "Indigo",
      "blue": "Blue",
      "teal": "Teal",
      "violet": "Violet",
      "rose": "Rose",
      "red": "Red",
      "orange": "Orange",
      "black": "Black"
    },
    "density": {
      "label": "Density",
      "comfortable": "Comfortable",
      "compact": "Compact"
    },
    "locale": {
      "label": "Language",
      "directionNote": "Text direction: right to left (set automatically by the language)"
    }
  },
  "account": {
    "title": "Account",
    "subtitle": "The identity of your current session. Manage display preferences and notification settings on their dedicated pages.",
    "preferencesLink": "Preferences",
    "notificationsLink": "Notification settings",
    "name": "Name",
    "email": "Email",
    "roles": "Roles",
    "twoFactor": "Two-factor",
    "on": "Enabled",
    "off": "Off",
    "preferences": {
      "title": "Preferences",
      "subtitle": "How Adminium looks and reads for you — on this and every device you sign in from.",
      "workspaceDefault": "Workspace default",
      "personal": "Personal",
      "usingDefault": "Using workspace default ({value})",
      "reset": "Reset to workspace default",
      "resetFailed": "Could not reset this preference. Try again.",
      "appliesInstantly": "Changes apply instantly and are saved to your profile."
    }
  },
  "settings": {
    "defaults": {
      "title": "Global defaults",
      "subtitle": "Workspace-wide appearance and language defaults.",
      "explainer": "These defaults apply to all users unless they override them. Anyone can set their own preference under Profile → Preferences — personal preferences always win for that user.",
      "appearanceHeading": "Appearance defaults",
      "languageHeading": "Language & region defaults",
      "adoption": "{following, number} of {total, plural, one {# user} other {# users}} follow this default.",
      "weekStartNote": "Week start and number formats follow the language.",
      "save": "Save defaults",
      "saved": "Workspace defaults updated",
      "saveFailed": "Could not save workspace defaults. Try again.",
      "liveNote": "Saving broadcasts the change live — signed-in users who follow a default see it apply without a reload."
    },
    "notifications": {
      "subtitle": "Choose what you’re notified about and how",
      "matrixLabel": "Notify me about",
      "rowHeader": "Event",
      "saving": "Saving…",
      "saved": "Saved",
      "unavailable": "Not available yet",
      "loading": "Loading preferences",
      "errorTitle": "These settings failed to load",
      "emptyTitle": "Nothing to configure yet",
      "emptyBody": "Notification events appear here as producers ship.",
      "saveFailed": "Could not save this change."
    }
  },
  "studio": {
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
        "testing": "Testing…"
      },
      "card": {
        "readOnly": "Read-only",
        "tables": "Tables",
        "pages": "Pages",
        "latency": "Latency",
        "latencyMs": "{latency, number} ms",
        "lastIntrospected": "Last introspected",
        "never": "Never"
      },
      "action": {
        "test": "Test",
        "reintrospect": "Re-introspect",
        "reintrospectFile": "Schema-file sources have no live database — re-upload the file instead.",
        "remap": "Remap schema",
        "delete": "Delete"
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
        }
      },
      "security": {
        "heading": "Security",
        "require2fa": {
          "label": "Require two-factor auth",
          "desc": "Every member must enable 2FA to sign in."
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
      "review": {
        "title": "Save workspace settings",
        "subtitle": "Review your changes before saving.",
        "confirm": "Save changes",
        "cancel": "Cancel",
        "close": "Close",
        "on": "On",
        "off": "Off",
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
        "body": "This server chose its meta store at first boot. This step validates that your choice is compatible with this connection and records it — the server enforces the same rule independently (409 META_PLACEMENT_INVALID). Moving an existing meta store is an ops task (M10)."
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
      }
    }
  },
  "onboarding": {
    "title": "Getting started",
    "subtitle": "A few steps to get your workspace ready.",
    "loading": "Loading your setup checklist…",
    "welcome": "Welcome to Adminium, {name} 👋",
    "progressBody": "You’ve completed {done} of {total} setup steps. Finish the rest to unlock the full workspace.",
    "completeBody": "You’re all set — your workspace is fully configured.",
    "ringLabel": "{done} of {total} steps complete",
    "done": "Done",
    "skip": "Skip for now",
    "goToWorkspace": "Go to workspace",
    "help": {
      "title": "Need a hand?",
      "body": "We’re here to help you get set up fast."
    },
    "steps": {
      "connectDatabase": {
        "title": "Connect a database",
        "desc": "Point Adminium at your Postgres, MySQL or SQLite — a read-only role is welcome.",
        "time": "5 min",
        "action": "Connect"
      },
      "chooseTables": {
        "title": "Choose your tables",
        "desc": "Pick which tables become pages — PII is masked by default.",
        "time": "2 min",
        "action": "Choose"
      },
      "inviteTeammates": {
        "title": "Invite teammates",
        "desc": "Bring your team in to explore and collaborate.",
        "time": "2 min",
        "action": "Invite"
      },
      "workspaceDefaults": {
        "title": "Set workspace defaults",
        "desc": "Theme, accent, density and language everyone starts with.",
        "time": "1 min",
        "action": "Set defaults"
      }
    },
    "entry": {
      "wayBack": "Getting started · {done}/{total}",
      "dismiss": "Dismiss setup checklist",
      "continue": "Continue setup",
      "banner": "Finish setting up your workspace — {done} of {total} steps done."
    }
  },
  "views": {
    "baseView": "All records",
    "menuLabel": "Saved views",
    "saveAs": "Save current as view…",
    "updateActive": "Update “{name}”",
    "rename": "Rename…",
    "setDefault": "Set as default",
    "delete": "Delete…",
    "saveTitle": "Save view",
    "save": "Save view",
    "renameTitle": "Rename view",
    "saveName": "Save name",
    "nameLabel": "View name",
    "namePlaceholder": "e.g. Active this month",
    "nameRequired": "Enter a name for this view.",
    "saveFailed": "Could not save the view.",
    "deleteTitle": "Delete view",
    "deleteBody": "This removes the saved view. Your data is not affected.",
    "deletePrompt": "Type the view name to confirm",
    "deleteConfirm": "Delete view",
    "savedToast": "View “{name}” saved.",
    "updatedToast": "View “{name}” updated.",
    "defaultToast": "“{name}” is now the default view.",
    "deletedToast": "View “{name}” deleted."
  },
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
      "duplicated": "{name} duplicated."
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
    "versionNamePlaceholder": "e.g. Before Q3 rates change"
  },
  "setup": {
    "title": "Set up Adminium",
    "subtitle": "Create the first administrator. This happens once.",
    "progress": "Setup progress",
    "steps": {
      "account": "Admin account",
      "consent": "Privacy"
    },
    "account": {
      "name": "Your name",
      "email": "Email",
      "emailInvalid": "Enter a valid email address.",
      "password": "Password",
      "passwordHelper": "At least {min} characters.",
      "passwordTooShort": "Use at least {min} characters.",
      "confirm": "Confirm password",
      "passwordMismatch": "Passwords do not match.",
      "continue": "Continue",
      "strength": "Password strength",
      "strengthLevels": {
        "weak": "Weak",
        "fair": "Fair",
        "good": "Good",
        "strong": "Strong"
      }
    },
    "consent": {
      "telemetry": {
        "title": "Share anonymous usage data",
        "description": "Helps us see which database engines to prioritize. Off unless you turn it on."
      },
      "updates": {
        "title": "Check for new releases",
        "description": "Shows a notice when a new version — including a security fix — is available. This asks GitHub for the latest release, which reveals this instance’s IP address and version to GitHub. Nothing else is sent."
      },
      "sentTitle": "Exactly what is sent:",
      "sent": {
        "instanceId": "A random instance ID (a UUID generated here; not derived from your name, host, or database)",
        "version": "The Adminium version this instance runs",
        "engines": "Which database engine types are connected (e.g. \"postgres\") — types only"
      },
      "neverTitle": "Never sent:",
      "never": {
        "schema": "Your schema — no table, column, or enum names",
        "rows": "Your data — not a single row, ever",
        "connections": "Connection strings, hostnames, or credentials",
        "people": "User emails, names, or IDs",
        "llm": "AI prompts or run contents"
      },
      "reversible": "Both are off by default and you can change either one later in Settings.",
      "back": "Back",
      "finish": "Create admin account"
    },
    "error": {
      "alreadyCompleted": "This instance has already been set up. Sign in with the existing admin account.",
      "rejected": "The server rejected those details. Check the email and password and try again.",
      "failed": "Setup failed. Check your connection and try again."
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
  "apiKeys": {
    "title": "API keys & tokens",
    "subtitle": "Manage programmatic access to your workspace.",
    "createButton": "Create key",
    "copy": "Copy",
    "copied": "Copied",
    "revoke": "Revoke key",
    "neverUsed": "Never used",
    "lastUsed": "Last used {since}",
    "scopesOverflow": "+{count} more",
    "status": {
      "active": "Active",
      "revoked": "Revoked",
      "expired": "Expired"
    },
    "list": {
      "title": "Keys",
      "activeCount": "{count, plural, one {# active key} other {# active keys}}"
    },
    "empty": {
      "title": "No API keys yet",
      "body": "Create one to call the Adminium API from your own code."
    },
    "revealed": {
      "title": "New key created",
      "body": "Copy it now — you won’t be able to see it again."
    },
    "rolesUnavailable": {
      "title": "Roles are not visible to you",
      "body": "Creating a key means choosing the role it acts as, and your account cannot read the role list. Ask an administrator for the “Manage roles” permission."
    },
    "quickStart": {
      "title": "Quick start",
      "body": "Authenticate requests with your key in the Authorization header."
    },
    "create": {
      "title": "Create API key",
      "description": "The key acts with the permissions of the role you pick.",
      "name": "Name",
      "namePlaceholder": "e.g. Analytics pipeline",
      "role": "Role",
      "roleHelper": "Pick the least-privileged role that can do the job.",
      "expires": "Expires",
      "expiresHelper": "Leave empty for a key that never expires.",
      "submit": "Create key",
      "failed": "Could not create the key"
    },
    "revokeConfirm": {
      "title": "Revoke API key",
      "body": "Any code still calling the API with “{name}” starts failing immediately. This cannot be undone.",
      "prompt": "Type “{name}” to confirm",
      "confirm": "Revoke key"
    }
  },
  "changelog": {
    "title": "Changelog",
    "subtitle": "Product updates & releases.",
    "allReleases": "All releases",
    "tag": {
      "new": "New",
      "improved": "Improved",
      "fixed": "Fixed",
      "security": "Security"
    },
    "filter": {
      "all": "All",
      "label": "Filter changes by type"
    },
    "empty": {
      "title": "Nothing under this filter",
      "body": "No release has carried a change of this kind yet.",
      "clear": "Show all changes"
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
      "install": {
        "title": "Install Adminium",
        "excerpt": "Run from a source checkout or with docker run, and reach the first-run wizard in a minute."
      },
      "firstAdmin": {
        "title": "Create your first super admin",
        "excerpt": "What the first-run wizard asks for, and why it can only run once."
      },
      "connectDb": {
        "title": "Connecting your first database",
        "excerpt": "Point Adminium at PostgreSQL, MySQL or SQLite and generate an admin app."
      },
      "schemaFile": {
        "title": "Generate from a schema file",
        "excerpt": "Upload a Prisma schema, a Django models.py, a Rails schema.rb or a .sql dump — no connection needed."
      },
      "readOnly": {
        "title": "Use a read-only role",
        "excerpt": "Introspection reads schema metadata only. Give Adminium the least privilege it needs."
      },
      "apiKeys": {
        "title": "Authenticating with API keys",
        "excerpt": "Create and revoke keys, and why a key is only ever shown to you once."
      },
      "rest": {
        "title": "REST API reference",
        "excerpt": "Every endpoint the generated app exposes, with request and response shapes."
      },
      "manifest": {
        "title": "The page manifest",
        "excerpt": "How a page is described as config, and how to hand-edit one."
      },
      "roles": {
        "title": "Roles & permissions",
        "excerpt": "Assign Viewer, Editor and Admin, and build your own roles from the permission matrix."
      },
      "audit": {
        "title": "Reading the audit log",
        "excerpt": "Who changed what, when, and from where."
      },
      "secrets": {
        "title": "How Adminium stores your secrets",
        "excerpt": "Connection credentials are encrypted at rest with ADMINIUM_SECRET. API keys are hashed."
      },
      "docker": {
        "title": "Self-host with Docker",
        "excerpt": "The official image, docker-compose, and running a separate meta database."
      },
      "backup": {
        "title": "Back up and move an instance",
        "excerpt": "export-zip bundles your server config; import it to replay the same setup elsewhere."
      },
      "telemetry": {
        "title": "Telemetry and update checks",
        "excerpt": "Both are opt-in and off by default. What is sent if you turn them on."
      },
      "connectionFails": {
        "title": "A database connection fails",
        "excerpt": "Read the diagnostics card: host, port, TLS, and the IP your database must allow."
      },
      "missingTables": {
        "title": "Tables are missing after introspection",
        "excerpt": "Schema visibility, excluded tables, and re-running generation."
      }
    }
  },
  "desktop": {
    "menu": {
      "file": "File",
      "fileNewDatabase": "New local database…",
      "fileOpenSqlite": "Open SQLite file…",
      "fileBackupNow": "Back up now…",
      "fileRestore": "Restore from backup…",
      "edit": "Edit",
      "view": "View",
      "window": "Window",
      "help": "Help",
      "helpDocs": "Adminium Docs",
      "helpShortcuts": "Keyboard Shortcuts",
      "helpLogs": "Show Logs",
      "helpCheckForUpdates": "Check for Updates…",
      "helpAbout": "About Adminium"
    },
    "settings": {
      "explainer": "These settings apply to the Adminium app on this computer only. They are stored on this machine, not in your workspace."
    },
    "security": {
      "heading": "Sign-in"
    },
    "requireLogin": {
      "label": "Require login on this device",
      "description": "Adminium normally signs you in automatically on this computer. Turn this on to ask for your password at every launch — worth it if other people can use this machine. It takes effect the next time you open Adminium.",
      "savedOn": "Login required on the next launch",
      "savedOff": "Adminium will skip the login on this computer",
      "saveFailed": "Could not save that setting. Try again."
    },
    "chip": {
      "local": "Local",
      "lanShare": "Local · Sharing on LAN",
      "remoteDb": "Local + remote DB",
      "remoteDbOffline": "Remote DB offline",
      "remoteDbOfflineDetail": "Can't reach {names}. Pages for those connections show a reconnect state."
    },
    "lan": {
      "heading": "Share on local network",
      "label": "Let other devices on this network use Adminium",
      "description": "Other computers, tablets and phones on the same network can open Adminium in a browser and sign in with their own account. Adminium has to stay open on this computer for them to reach it.",
      "savedOn": "Sharing on your local network",
      "savedOff": "Sharing stopped — Adminium is back to this computer only",
      "saveFailed": "Could not change network sharing",
      "noUsers": "You're the only person with an account, so nobody else can sign in yet. Sharing still works — you'll just need to invite people before they can use it.",
      "usersUnknown": "Adminium couldn't check who else has an account on this computer. Sharing still works, and anyone with an account can sign in — this check is the only thing that failed.",
      "acknowledge": "I understand — I'll invite people next",
      "port": "Port",
      "portHelper": "Default {port}",
      "portInvalid": "Use a number between 1024 and 65535.",
      "applyPort": "Change port",
      "portInUse": "Port {port} is already in use by another program.",
      "portInUseHint": "Nothing was changed — sharing is still off.",
      "portInUseNoSuggestion": "Nothing was changed. Try a different port.",
      "tryPort": "Try {port}",
      "urlsHeading": "Open this on another device",
      "noUrls": "This computer isn't connected to a network right now, so there's no address to share. Connect to Wi-Fi or plug in a cable and this list will fill in.",
      "copyUrl": "Copy",
      "sessions": "{count, plural, =0 {No devices signed in from this network} one {# device signed in from this network} other {# devices signed in from this network}}",
      "sessionsUnknown": "Checking who is connected…",
      "pending": "Starting to share…",
      "mismatch": "Adminium is still reachable on this network",
      "mismatchBody": "Sharing is switched off, but the server has not released the network yet. Restart Adminium to close it.",
      "transportTitle": "Traffic on your local network is not encrypted.",
      "transportBody": "Share only on networks you trust. For remote access, use Adminium self-host behind HTTPS.",
      "firewall": "The first time you share, your operating system will ask whether to allow incoming connections — choose Allow, or other devices will not be able to reach Adminium."
    },
    "setup": {
      "title": "Welcome to Adminium",
      "subtitle": "Four short steps and Adminium will have built an admin app from your database. Everything stays on this computer.",
      "progress": "Setup progress",
      "back": "Back",
      "continue": "Continue",
      "createAccount": "Create account and continue",
      "step": {
        "location": "Welcome",
        "database": "Your first database",
        "account": "Your account",
        "generate": "Generate"
      },
      "dataDir": {
        "heading": "Where should Adminium keep your data?",
        "description": "Your databases, settings and backups all live in this folder. Everything stays on this computer — nothing is uploaded anywhere.",
        "label": "Data folder",
        "loading": "Reading the current location…",
        "pending": "Adminium restarts when you continue, so it can move to this folder.",
        "change": "Change…",
        "revert": "Undo",
        "dialogTitle": "Choose where Adminium keeps your data",
        "cloudSyncTitle": "This folder is synced to the cloud",
        "cloudSyncWarning": "Adminium stores its data in SQLite files. {provider} syncs files in “{folder}” by copying them in the background, which can corrupt a database that is open — losing data with no warning. Pick a folder outside {provider}.",
        "chooseAnother": "Choose another folder",
        "useAnyway": "Use it anyway — I accept the risk",
        "unusableTitle": "Adminium cannot use that folder",
        "failed": "Adminium could not use that folder."
      },
      "source": {
        "heading": "What should Adminium build from?",
        "description": "Adminium reads a database’s schema and generates an admin app from it. You can add more databases later.",
        "groupLabel": "Database source",
        "local": {
          "title": "Create a new local database",
          "description": "Start from nothing, or from a schema file you already have. The database is created inside your data folder.",
          "name": "Database name",
          "namePlaceholder": "Operations",
          "nameUnusable": "Use at least one letter or number — the file name is built from this.",
          "fileHelper": "Creates {file}",
          "schemaLabel": "Start from",
          "blank": "Blank",
          "fromFile": "A schema file",
          "schemaFile": "Schema file",
          "schemaFileHelper": ".sql, pg_dump, Prisma, Drizzle, TypeORM, Sequelize, schema.rb, Django or Adminium JSON. Adminium translates it to SQLite.",
          "placeholder": "Auto-generate placeholder entries",
          "placeholderHelper": "You imported a schema with no rows. Seed each table with realistic sample data so your dashboards and charts render immediately."
        },
        "openSqlite": {
          "title": "Open an existing SQLite file",
          "description": "Point Adminium at a .sqlite file on this computer. It is opened where it is — nothing is copied or moved.",
          "browse": "Choose a .sqlite file…",
          "change": "Choose a different file…",
          "networkTitle": "That file is on a network share",
          "networkBody": "SQLite locking is unreliable over network file shares, and a dropped connection mid-write can corrupt the database. A copy on this computer’s own disk is safer."
        },
        "remote": {
          "title": "Connect to a server database",
          "description": "PostgreSQL or MySQL. Requires a reachable network database; Adminium’s own tables still stay on this computer.",
          "networkNote": "Requires a reachable network database",
          "metaNote": "Adminium’s own tables — your pages, settings and sign-in — stay in the data folder on this computer either way.",
          "engine": "Engine",
          "name": "Connection name",
          "namePlaceholder": "Production",
          "dsn": "Connection string",
          "dsnHelper": "Adminium tests this when it connects. Use a read-only role if you only want dashboards."
        },
        "demo": {
          "title": "Explore the demo database",
          "description": "A ready-made team-operations database, so you can see what Adminium builds before pointing it at your own data. Delete it whenever you like.",
          "unavailable": "This build does not include the demo data, so there is nothing to load. Pick one of the options above."
        }
      },
      "account": {
        "heading": "Create your account",
        "description": "This is the administrator account for this copy of Adminium. The password protects your backups and anyone you share with on your network — you will not be asked for it at every launch.",
        "name": "Your name",
        "email": "Email",
        "password": "Password",
        "passwordHelper": "At least {min} characters.",
        "confirm": "Confirm password",
        "strength": "Password strength",
        "strengthLevels": {
          "weak": "Weak",
          "fair": "Fair",
          "good": "Good",
          "strong": "Strong"
        },
        "singleUser": "Skip login on this computer",
        "singleUserHelper": "Adminium signs you in automatically when you open it here. Turn this off if other people use this machine. You can change it later in Settings → Desktop.",
        "locale": "Language",
        "theme": "Appearance",
        "alreadyExists": "This copy of Adminium already has an account. Sign in with it instead.",
        "failed": "Adminium could not create that account."
      },
      "generate": {
        "creating": "Setting up your database…",
        "introspecting": "Reading your schema — tables, columns and relationships…",
        "working": "Working…",
        "offlineNote": "All of this happens on this computer.",
        "failedTitle": "Adminium could not set that database up",
        "failedBody": "Something went wrong. Try again.",
        "retry": "Try again"
      }
    }
  },
  "capabilities": {
    "heading": "App permissions",
    "description": "Apps you install can ask to use this computer’s hardware. You approve each one, and can revoke access anytime.",
    "grantedTo": "Allowed for {app}",
    "status": {
      "available": "Available",
      "stub": "Not available yet",
      "unavailable": "Unavailable"
    },
    "allow": {
      "action": "Allow…"
    },
    "revoke": {
      "action": "Revoke",
      "saved": "Access revoked",
      "failed": "Could not revoke access. Try again."
    },
    "grant": {
      "saved": "Access allowed",
      "failed": "Could not allow access. Try again."
    },
    "catalog": {
      "printerEscpos": {
        "name": "Receipt printer (ESC/POS)",
        "scope": "Print to receipt printers and open a connected cash drawer"
      }
    },
    "consent": {
      "title": "Allow {app}?",
      "subtitle": "{app} is asking to use this computer’s hardware.",
      "willAllow": "This will allow {app} to:",
      "revokeNote": "You can revoke this at any time in Settings → Desktop. Only allow apps you trust.",
      "deny": "Not now",
      "approve": "Allow"
    }
  },
  "emailTemplates": {
    "title": "Email templates",
    "subtitle": "Transactional and lifecycle emails your workspace sends.",
    "search": "Search templates…",
    "loadFailed": "Couldn’t load templates",
    "empty": "No email templates yet",
    "emptyBody": "Templates appear here once the server seeds or you create them.",
    "noMatches": "No matching templates",
    "noMatchesBody": "Try a different search.",
    "live": "Live",
    "disabled": "Disabled",
    "name": "Template name",
    "subject": "Subject",
    "enabled": "Enabled"
  },
  "board": {
    "addCard": "Add card",
    "compose": {
      "placeholder": "Card title…",
      "add": "Add",
      "cancel": "Cancel"
    },
    "empty": {
      "title": "No board columns",
      "body": "Add a status field to group cards into columns."
    }
  },
  "calendar": {
    "dateRange": "Date range",
    "compose": {
      "placeholder": "Event title…",
      "add": "Add",
      "cancel": "Cancel",
      "open": "Add event"
    },
    "agenda": {
      "empty": "Nothing scheduled"
    }
  },
  "scheduler": {
    "prevWeek": "Previous week",
    "nextWeek": "Next week",
    "week": "Week",
    "month": "Month",
    "resource": "Resource",
    "coverage": "Coverage",
    "addShift": "Add shift",
    "shiftCount": "{n} shifts"
  },
  "planning": {
    "drawer": {
      "close": "Close",
      "loading": "Loading record",
      "error": "Could not load this record."
    }
  },
  "files": {
    "uploadsUnavailable": "Uploads are not available on this page yet."
  },
  "chat": {
    "messageSent": "Message sent",
    "sendFailed": "The message could not be sent."
  },
  "templates": {
    "crud": {
      "title": "Records"
    },
    "dashboard": {
      "title": "Dashboard"
    },
    "board": {
      "title": "Board"
    },
    "calendar": {
      "title": "Calendar"
    },
    "scheduler": {
      "title": "Scheduler"
    },
    "logViewer": {
      "title": "Logs"
    },
    "files": {
      "title": "Files"
    },
    "chat": {
      "title": "Chat"
    },
    "builder": {
      "title": "Builder"
    },
    "wizard": {
      "title": "Wizard"
    },
    "settings": {
      "title": "Settings"
    },
    "directory": {
      "title": "Directory",
      "searchPlaceholder": "Search people…",
      "allFilter": "All",
      "clearFilters": "Clear filters",
      "detailTitle": "Person",
      "emptyTitle": "No people yet",
      "emptyBody": "People appear here as rows land in the table.",
      "noMatchesTitle": "No matching people",
      "noMatchesBody": "Try a different search or remove a filter.",
      "errorTitle": "This directory failed to load",
      "loading": "Loading people",
      "memberCount": "{count} people"
    },
    "masterDetail": {
      "title": "List & detail",
      "allFilter": "All",
      "clearFilters": "Clear filters",
      "emptyTitle": "Nothing here yet",
      "emptyBody": "Records appear here as rows land in the table.",
      "noMatchesTitle": "No matching records",
      "noMatchesBody": "Try removing a filter.",
      "errorTitle": "This list failed to load",
      "loading": "Loading records",
      "selectPrompt": "Select a record"
    },
    "queueInbox": {
      "title": "Queue",
      "approve": "Approve",
      "reject": "Reject",
      "allSegment": "All",
      "approvedToast": "{count} approved.",
      "rejectedToast": "{count} rejected.",
      "undoneToast": "Decision undone.",
      "failedToast": "Decision failed.",
      "bulkFailed": "{failed} of {total} selected rows could not be updated.",
      "undoFailedToast": "Could not undo this decision.",
      "rejectTitle": "Reject requests",
      "rejectCount": "Selected · {count}",
      "rejectNote": "The requester will be notified with your note.",
      "rejectPlaceholder": "Add a note for the requester…",
      "rejectConfirm": "Reject",
      "emptyTitle": "Nothing in the queue",
      "emptyBody": "New requests appear here as they arrive.",
      "caughtUpTitle": "You’re all caught up",
      "caughtUpBody": "No requests in this tab right now.",
      "errorTitle": "This queue failed to load",
      "loading": "Loading queue",
      "selectPrompt": "Select a request",
      "daysUnit": "{count} days"
    }
  },
  "dataio": {
    "back": "Back",
    "import": {
      "title": "Import data",
      "stepUpload": "Upload",
      "stepMap": "Map columns",
      "stepValidate": "Validate",
      "stepRun": "Import & review",
      "targetLabel": "Target table",
      "targetPlaceholder": "Choose a table page…",
      "notATable": "That page is not a table — pick a table page to import into.",
      "dropTitle": "Drop a CSV file to import",
      "dropHint": "CSV up to 32 MB — the first row must be the header",
      "skipTarget": "Don’t import",
      "mapHint": "{count} data rows in {file} — choose a target for each column.",
      "validating": "Validating…",
      "toValidate": "Validate",
      "validateFailed": "Validation failed.",
      "validationSummary": "{valid} of {total} rows ready to import — {invalid} will be skipped.",
      "allValid": "All rows passed validation",
      "run": "Run import",
      "runSkipping": "Import {valid} rows (skip {invalid})",
      "progressLabel": "Import progress",
      "running": "Importing…",
      "kpiTotal": "Rows in file",
      "kpiCreated": "Created",
      "kpiUpdated": "Updated",
      "kpiSkipped": "Skipped",
      "inconsistent": "Import numbers are inconsistent — total must equal created + updated + skipped.",
      "downloadErrors": "Download the skipped-rows report (CSV)",
      "runFailed": "The import failed."
    },
    "exports": {
      "title": "Data exports",
      "tableLabel": "Table",
      "tablePlaceholder": "Choose a table…",
      "notATable": "That page is not a table — pick a table page to export.",
      "formatLabel": "Format",
      "create": "Export",
      "createFailed": "Could not request the export.",
      "retention": "Exports are kept for 30 days, then expire.",
      "statusProcessing": "Processing…",
      "statusReady": "Ready — {rows} rows · click to download",
      "statusFailed": "Failed — {error}",
      "statusCancelled": "Cancelled",
      "statusExpired": "Expired",
      "emptyTitle": "No exports yet",
      "emptyBody": "Request one above — artifacts appear here with their status."
    }
  },
  "reports": {
    "title": "Scheduled reports",
    "subtitle": "Recurring data snapshots of a page, delivered as in-app notifications.",
    "new": "New report",
    "loadFailed": "Could not load scheduled reports.",
    "saveFailed": "Could not save this report.",
    "nextRun": "Next run",
    "emptyTitle": "No scheduled reports yet",
    "emptyBody": "Create one to get a recurring data snapshot of any table page.",
    "createTitle": "New scheduled report",
    "editTitle": "Edit scheduled report",
    "nameLabel": "Name",
    "namePlaceholder": "e.g. Weekly revenue",
    "pageLabel": "Page",
    "pagePlaceholder": "Choose a page…",
    "frequencyLabel": "Frequency",
    "frequency": {
      "daily": "Daily",
      "weekly": "Weekly",
      "monthly": "Monthly"
    },
    "dayOfWeekLabel": "Day",
    "dayOfMonthLabel": "Day of month",
    "timeLabel": "Time",
    "timezoneLabel": "Timezone",
    "formatLabel": "Delivery",
    "formatHint": "Data snapshot (PDF/PNG rendering arrives in a later release) — each run produces a CSV snapshot and an in-app notification.",
    "recipientsLabel": "Recipients",
    "recipientsHint": "Stored with the report. Email delivery arrives in a later release — runs notify you in-app for now.",
    "deliveryBadge": "CSV snapshot",
    "delete": "Delete",
    "create": "Create",
    "cadence": {
      "daily": "Daily at {time} ({zone})",
      "weekly": "Weekly · {day} at {time} ({zone})",
      "monthly": "Monthly · day {day} at {time} ({zone})"
    }
  },
  "notifications": {
    "channel": {
      "inApp": "In-app",
      "email": "Email",
      "push": "Push"
    },
    "event": {
      "reportReady": "Scheduled report ready",
      "reportFailed": "Scheduled report failed",
      "backupCompleted": "Backup completed"
    }
  }
} as const;
