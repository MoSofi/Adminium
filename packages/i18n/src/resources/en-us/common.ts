// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/common.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
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
    "description": "Connect PostgreSQL and Adminium generates a themeable, permission-aware admin app — no code required.",
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
      "smtpUnconfigured": "This Adminium has no email server configured, so it cannot send a reset link. Ask an administrator to reset your password for you.",
      "subtitle": "Enter your email and we'll send you a reset link.",
      "sentBody": "We sent a reset link to {email}. It expires in 15 minutes.",
      "resendHint": "Didn't get it?"
    },
    "reset": {
      "title": "Choose a password",
      "subtitle": "Must be at least 8 characters.",
      "password": "Password",
      "confirm": "Confirm password",
      "showPassword": "Show password",
      "hidePassword": "Hide password",
      "strength": "Password strength",
      "weak": "Weak",
      "fair": "Fair",
      "good": "Good",
      "strong": "Strong",
      "tooShort": "Use at least 8 characters.",
      "submit": "Save password",
      "failed": "That did not save. Try again.",
      "mismatch": "Passwords don't match."
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
    },
    "staff": {
      "subtitle": "{app} · Staff sign-in",
      "shared": "Shared tablet? Everyone signs in with their own account.",
      "remember": "Keep me signed in on this tablet",
      "invalid": "We couldn’t sign you in. Check your email and password, then try again.",
      "rateLimited": "Too many tries. Try again in a minute.",
      "offline": "Can’t reach {app}. Check the network.",
      "opening": "Opening {app}…",
      "openingApp": "Opening the app…",
      "signedInAs": "Signed in as {name}",
      "codeInvalid": "That code didn’t work. Try the newest one in your app."
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
    "invoices": "Invoices",
    "reportBuilder": "Report builder",
    "automations": "Automations",
    "workflowLogs": "Workflow logs",
    "notificationSettings": "Notification settings",
    "scheduledReports": "Scheduled reports",
    "group": {
      "workspace": "Workspace",
      "library": "Library",
      "planning": "Planning",
      "people": "People",
      "account": "Account"
    },
    "back": "Back",
    "team": "People",
    "roles": "Roles & permissions",
    "audit": "Audit log",
    "security": "Password & sessions",
    "files": "Files",
    "emptyWithheld": "No pages have been shared with your role yet. Ask an administrator for access.",
    "emptyConnected": "Pages appear here once they are made from the connected database.",
    "app": {
      "openStaff": "Open the staff screens",
      "openStaffInstance": "Open the staff screens · {instance}"
    },
    "drawerTitle": "Navigation",
    "emptyPartsOff": "Nothing is switched on for you right now. Ask an administrator.",
    "teams": "Teams"
  },
  "apps": {
    "frame": {
      "noFrames": "This app needs a browser that supports frames."
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
    "studio": "Studio",
    "dataConnections": "Data connections",
    "workspaceSettings": "Workspace settings",
    "help": "Help centre",
    "changelog": "What’s new",
    "signOut": "Sign out",
    "toggleSidebar": "Toggle sidebar"
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
    "studio": "Go to Studio",
    "theme": "Toggle light / dark",
    "then": "then",
    "footerPre": "Press",
    "footerPost": "anytime to open this panel."
  },
  "states": {
    "checked": "checked 8s ago",
    "diagnostics": "Diagnostics",
    "reference": {
      "label": "Reference",
      "copy": "Copy reference",
      "copied": "Copied",
      "hint": "Quote this when reporting the problem — your server log records the same id."
    },
    "notFound": {
      "title": "Page not found",
      "body": "We couldn't find that page. It may have been moved or the link is broken.",
      "primary": "Back to dashboard",
      "secondary": "Contact support"
    },
    "forbidden": {
      "title": "You don’t have access",
      "body": "This dashboard is restricted. Ask a workspace admin to grant you access.",
      "primary": "Request access",
      "secondary": "Go back"
    },
    "error": {
      "title": "Something went wrong",
      "body": "Adminium hit an unexpected error handling this request. The details are in the server log.",
      "primary": "Try again"
    },
    "dbUnreachable": {
      "title": "Database unreachable",
      "body": "We couldn't connect to prod-db. Your dashboards will resume once the connection is restored.",
      "primary": "Retry connection",
      "secondary": "Edit connection",
      "diag": {
        "status": "connection timed out (10s)",
        "hint": "allowlist 52.9.14.2, then retry"
      }
    },
    "maintenance": {
      "title": "Scheduled maintenance",
      "body": "Adminium is undergoing maintenance and will be back shortly. Thanks for your patience.",
      "primary": "View status"
    },
    "rateLimited": {
      "title": "Rate limit reached",
      "body": "Too many requests in a short time. Wait a few minutes and try again.",
      "primary": "Try again",
      "secondary": "Go back"
    },
    "offline": {
      "title": "You're offline",
      "body": "Check your internet connection. Adminium will reconnect automatically when you’re back.",
      "primary": "Retry now",
      "banner": "You're offline — trying to reconnect…"
    },
    "expiredLink": {
      "title": "This link has expired",
      "body": "Magic sign-in links expire after 10 minutes. Request a fresh one to continue.",
      "primary": "Send a new link",
      "secondary": "Back to sign in"
    },
    "expiredSession": {
      "title": "Your session expired",
      "body": "For your security you were signed out after a period of inactivity. Sign in to pick up where you left off.",
      "primary": "Sign in again"
    },
    "emptyNoSources": {
      "title": "No data sources yet",
      "body": "Connect a database and Adminium will generate your first admin dashboard.",
      "primary": "Connect a database",
      "secondary": "Import sample data"
    },
    "emptyNoPages": {
      "title": "No pages yet",
      "body": "A database is connected, but no pages have been made from it yet. Make them in Studio, or install an app."
    },
    "emptyWithheld": {
      "title": "No pages shared with you yet",
      "body": "No pages have been shared with your role yet. Ask an administrator for access."
    },
    "readOnly": {
      "title": "Read-only mode",
      "body": "You have Viewer access to this workspace. You can explore dashboards, but editing and destructive actions are disabled.",
      "primary": "Request edit access",
      "secondary": "Got it"
    },
    "suspended": {
      "title": "This workspace is suspended",
      "body": "This workspace has been suspended by an administrator. Your data is preserved — contact the workspace owner to restore access.",
      "primary": "Contact owner",
      "secondary": "Go back"
    },
    "connectionPaused": {
      "title": "This connection is paused",
      "body": "An admin paused the database behind this page, so it is not loading data right now. Nothing has been deleted — it comes back as soon as the connection is resumed in Studio → Data connections.",
      "secondary": "Go back"
    },
    "appDisabled": {
      "title": "This app is switched off",
      "body": "An admin switched this app off. Nothing was deleted — switch it on in Studio → Apps.",
      "secondary": "Go back"
    },
    "screensOff": {
      "title": "These screens are switched off",
      "body": "An admin switched off this app’s staff screens. Nothing was deleted — switch them on in Studio → Apps.",
      "secondary": "Go back"
    },
    "appExternal": {
      "title": "This app opens on its own",
      "body": "It opens at its own address, not inside the dashboard.",
      "primary": "Open it"
    },
    "partOff": {
      "title": "This part of the app is switched off",
      "body": "An admin switched this part of the app off. Nothing was deleted — switch it on in Studio → Apps, under Parts.",
      "secondary": "Go back"
    },
    "partsOff": {
      "title": "Nothing is switched on for you",
      "body": "Every role you hold belongs to a part of an app that is switched off right now. Nothing was deleted. Ask an administrator to switch that part on, or to give you another role."
    }
  },
  "notFound": {
    "title": "This page went missing",
    "body": "The page you're looking for doesn't exist or was moved. Check the URL, or head back to your dashboard.",
    "errorLine": "Error 404",
    "searchPlaceholder": "Search for a page…",
    "matches": "Matching pages",
    "popular": "Popular destinations",
    "goBack": "Go back",
    "backToDashboard": "Back to dashboard",
    "noMatches": "No pages match \"{query}\""
  },
  "page": {
    "emptyLayout": {
      "title": "This page has nothing to show yet",
      "board": "Bind it to a table with a status column, and its rows become cards grouped into columns.",
      "calendar": "Bind it to a table with a date column, and its rows become events on the month grid.",
      "scheduler": "Bind it to a table with a date column and a person to schedule, and its rows become shifts on a timeline.",
      "action": "Open page settings",
      "askAdmin": "Ask an administrator to finish setting it up."
    },
    "invalid": {
      "title": "This page’s configuration is invalid",
      "body": "The stored page document failed validation and cannot be rendered."
    },
    "renderError": {
      "title": "This page failed to render"
    },
    "tooNew": {
      "title": "This page needs a newer Adminium",
      "body": "This page was saved with config version {version}, but this build understands up to version {latest}. Upgrade Adminium to open it."
    },
    "unknownTemplate": {
      "title": "Unknown page template",
      "body": "This page uses a template this build doesn’t recognize. It may come from a newer Adminium or an extension that isn’t installed."
    },
    "linkFilters": {
      "pending": "Applying the link’s filters",
      "failedTitle": "This link’s filters could not be applied",
      "failedBody": "The list is not shown, so it is not mistaken for the filtered one.",
      "showAll": "Show the whole list",
      "group": "Filters from the link"
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
  "projectAction": {
    "done": "{label}: done",
    "failed": "{label} did not finish",
    "menu": "Actions",
    "run": "Run",
    "selected": "{count, plural, one {# record} other {# records}}"
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
      "directionNote": "Text direction: right to left (set automatically by the language)",
      "communityDraft": "This translation is a community draft — it has not been reviewed by a native speaker yet."
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
    },
    "translations": {
      "title": "Languages & translations",
      "subtitle": "Change any wording in Adminium, choose which languages people can pick, and add languages of your own.",
      "warning": "Error messages and sign-in text are editable too. Those are what people read when something goes wrong, so change them carefully.",
      "editor": {
        "heading": "Edit translations"
      },
      "localeLabel": "Language",
      "groupLabel": "Area",
      "allAreas": "All areas",
      "stateLabel": "Show",
      "state": {
        "all": "Everything",
        "overridden": "Customised only",
        "untranslated": "Untranslated only",
        "stale": "English changed since"
      },
      "searchLabel": "Search",
      "searchPlaceholder": "Key or English text",
      "loading": "Loading strings…",
      "noMatches": "No strings match those filters.",
      "count": "{total, plural, one {# string} other {# strings}}",
      "badge": {
        "custom": "Customised",
        "stale": "English changed",
        "a11y": "Accessible name"
      },
      "sourceLabel": "English source",
      "valueLabel": "Translation",
      "save": "Save",
      "saved": "Translation saved",
      "resetAction": "Reset to built-in",
      "reset": "Reset to the built-in text",
      "locales": {
        "heading": "Available languages",
        "help": "Turn a language off to remove it from every language picker. Anyone already using it keeps it until they choose another."
      },
      "locale": {
        "builtin": "Built in",
        "custom": "Custom",
        "overrides": "{count, plural, =0 {no custom text} one {# custom string} other {# custom strings}}",
        "enable": "Turn on",
        "disable": "Turn off",
        "delete": "Delete",
        "deleted": "Language removed",
        "deletedDetail": "{users, plural, one {# person} other {# people}} moved back to the workspace default; {strings, plural, one {# translation} other {# translations}} deleted.",
        "deleteFailed": "Could not remove that language",
        "add": "Add a language",
        "added": "Language added",
        "create": "Add language",
        "id": "Language code",
        "intlTag": "Formatting rules from",
        "native": "Name in the language itself",
        "english": "Name in English",
        "dir": "Text direction",
        "ltr": "Left to right",
        "rtl": "Right to left",
        "font": "Script",
        "latin": "Latin",
        "arabic": "Arabic",
        "cjk": "Chinese / Japanese / Korean",
        "intlHelp": "Formatting rules decide how numbers, dates and plurals behave. Pick the closest language that already has them — it does not have to match your language code."
      }
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
  "desktop": {
    "settings": {
      "explainer": "These settings apply to the Adminium app on this computer only. They are stored on this machine, not in your workspace.",
      "title": "Desktop settings"
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
      "firewall": "The first time you share, your operating system will ask whether to allow incoming connections — choose Allow, or other devices will not be able to reach Adminium.",
      "manageTeam": "Manage users & roles"
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
    },
    "stop": {
      "turn": "The Designer is in the middle of a turn.",
      "start": "An app is being added to this project.",
      "save": "Your changes are being saved.",
      "restore": "An earlier version is being put back.",
      "style": "The style is being changed.",
      "other": "This project is being changed.",
      "quitDetail": "If you quit now it is stopped where it is. What was already written stays.",
      "closeDetail": "If you close the project now it is stopped where it is. What was already written stays.",
      "quitAnyway": "Quit anyway",
      "closeAnyway": "Close anyway",
      "keepWorking": "Keep working",
      "shareDetail": "If you share now it is stopped where it is. What was already written stays.",
      "shareAnyway": "Stop and share"
    },
    "shared": {
      "banner": "This project is shared on your network. The Designer is off while it is.",
      "details": "Sharing details"
    }
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
      "body": "Add a status field to group cards into columns.",
      "noRowsTitle": "No cards yet",
      "noRowsBody": "Cards appear here as soon as the table has rows."
    }
  },
  "calendar": {
    "dateRange": "Date range",
    "compose": {
      "placeholder": "Event title…",
      "add": "Add",
      "cancel": "Cancel",
      "open": "Add event",
      "choose": "What this event is for",
      "choosePlaceholder": "Choose…"
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
  "chat": {
    "messageSent": "Message sent",
    "sendFailed": "The message could not be sent."
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
      "backupCompleted": "Backup completed",
      "ruleNotice": "A notice from a rule",
      "mention": "Somebody mentioned me"
    }
  },
  "theme": {
    "toLight": "Light mode",
    "toDark": "Dark mode"
  },
  "invoices": {
    "copySuffix": "{name} (copy)",
    "untitled": {
      "invoice": "Untitled invoice",
      "template": "Untitled template"
    }
  },
  "reportBuilder": {
    "copySuffix": "{name} (copy)",
    "untitled": {
      "report": "Untitled report",
      "template": "Untitled template"
    }
  },
  "shell": {
    "assistant": {
      "open": "Ask {name}",
      "working": "{name} is working",
      "unread": "1 unread answer",
      "proposal": "A change is waiting for you"
    }
  }
} as const;
