// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/desktop.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "new": {
    "back": "Back",
    "change": "Change…",
    "create": "Create",
    "creating": "Getting it ready…",
    "failed": "The project could not be made.",
    "heading": "Build an app",
    "help": "Adminium makes this folder for you. Everything about your app lives in it.",
    "name": "Name",
    "refuse": {
      "badName": "Use at least one letter or number in the name.",
      "existsWithFiles": "A folder with this name is already there and holds files. Choose another name or another folder.",
      "homeFolder": "A project cannot be kept directly in your home folder. Choose or make a folder inside it.",
      "insideAProject": "This folder is inside another project. Choose a folder outside it.",
      "insideTheApp": "A project cannot be kept inside Adminium itself. Choose another folder.",
      "notAbsolute": "Choose a folder with the “Change…” button.",
      "systemFolder": "A project cannot be kept in a folder that belongs to the system. Choose a folder of your own."
    },
    "step": {
      "files": "Laying out your app’s files",
      "packages": "Getting what your app is built with",
      "database": "Making its database",
      "opening": "Opening your app",
      "slow": "This is the long step, the first time: a few minutes on a slow connection. Later apps start faster.",
      "label": "What is being done"
    },
    "warn": {
      "another": "Choose another folder",
      "anyway": "Use it anyway",
      "dropbox": "This folder is synced by Dropbox. Projects work badly in synced folders: the sync can damage their data.",
      "googledrive": "This folder is synced by Google Drive. Projects work badly in synced folders: the sync can damage their data.",
      "icloud": "This folder is synced by iCloud Drive. Projects work badly in synced folders: the sync can damage their data.",
      "noLinks": "This disk cannot hold the links a project’s packages need, so getting them is likely to fail.",
      "onedrive": "This folder is synced by OneDrive. Projects work badly in synced folders: the sync can damage their data."
    },
    "where": "Where to keep it"
  },
  "packages": {
    "again": "Try again",
    "body": "What this project is built with is not on this computer yet. Adminium can download it now and then open the project. It takes a few minutes on a slow connection.",
    "cancel": "Not now",
    "failed": "The packages could not be fetched.",
    "get": "Get them and open",
    "title": "Get this project’s packages?",
    "working": "Getting the packages"
  },
  "start": {
    "choice": {
      "build": {
        "line": "Describe it, and the Designer builds it on this computer.",
        "title": "Build an app"
      },
      "connect": {
        "line": "Use an Adminium that runs on another computer.",
        "title": "Connect to another Adminium"
      },
      "db": {
        "line": "Make screens for a database you already have.",
        "title": "Use my own database"
      },
      "open": {
        "line": "Go on with an app that is already in a folder, or one someone sent you.",
        "title": "Open a folder"
      }
    },
    "heading": "What would you like to do?",
    "open": {
      "notAProject": "This folder is not an Adminium project."
    },
    "recent": {
      "alreadyListed": "That folder is already in the list.",
      "building": "Building",
      "gone": "This folder was moved or deleted",
      "heading": "Recent projects",
      "locate": "Locate…",
      "locateTitle": "Where is {name} now?",
      "notThatProject": "That folder is not an Adminium project.",
      "open": "Open {name}",
      "openDashboard": "Open dashboard",
      "openDashboardOf": "Open the dashboard of {name}",
      "openDesigner": "Open in Designer",
      "openDesignerOf": "Open {name} in the Designer",
      "opened": "Opened {when}",
      "remove": "Remove",
      "removed": "Removed from the recent projects",
      "shared": "Shared"
    },
    "welcome": "Welcome to Adminium."
  },
  "toast": {
    "dismiss": "Dismiss",
    "region": "Notices"
  },
  "trust": {
    "body": "Opening it runs its code on this computer, with your access to your files. Open only folders you made or that come from someone you trust.",
    "cancel": "Cancel",
    "changed": "This folder’s code changed since you last opened it.",
    "open": "Open",
    "title": "Open this folder?"
  },
  "found": {
    "data": "Found this project’s data.",
    "key": "Found its key.",
    "noData": "This folder has the project but no data.",
    "madeBoth": "Adminium made a new key and an empty database.",
    "madeDatabase": "Adminium made an empty database.",
    "rowsLost": "The apps’ own tables are made again. Rows that were in the old data are not here."
  },
  "opening": {
    "continue": "Continue",
    "close": "Close",
    "notAProject": {
      "line": "You can make a new project in a folder inside it.",
      "another": "Choose another folder",
      "make": "Make a new project here"
    }
  },
  "key": {
    "heading": "This project’s data is here, but its key is missing.",
    "body": "The key is a line in a file named ‹.env› in the project’s folder. Your computer hides files whose names start with a dot.",
    "body2": "Without the key, the saved database connections and API keys in this project’s data cannot be read.",
    "hidden": {
      "mac": "In Finder, press ⌘ ⇧ . to show them.",
      "windows": "In File Explorer, choose View › Show › Hidden items.",
      "linux": "In your file manager, press Ctrl H."
    },
    "env": {
      "title": "I have the .env file",
      "line": "Pick it, and Adminium copies it in.",
      "pick": "Choose the .env file of this project",
      "notAKey": "That file holds no key. Choose the .env file that came with this project’s data."
    },
    "fresh": {
      "title": "Start the data fresh, keep my apps",
      "line": "Your old data is moved to a folder named ‹{folder}›. Nothing is deleted."
    },
    "new": {
      "title": "Go on with a new key",
      "line": "The data is kept. Saved connections and keys in it stop working and must be entered again."
    },
    "failed": "That could not be done."
  },
  "accounts": {
    "heading": "This project came with accounts",
    "people": "{count, plural, one {# person} other {# people}}",
    "peopleLabel": "People",
    "apiKeys": "{count, plural, one {# API key} other {# API keys}}",
    "apiKeysLabel": "API keys",
    "publicKeys": "{count, plural, one {# key open to the public} other {# keys open to the public}}",
    "publicKeysLabel": "Open to the public",
    "body": "You will work as its owner on this computer. Before you share it on your network you will choose a new owner password, and the old sessions and API keys will stop working.",
    "show": "Show them",
    "hide": "Hide them",
    "more": "and {count} more"
  },
  "notice": {
    "manager": {
      "title": "This project uses {manager}.",
      "line": "Adminium installs with npm instead. Your {manager} file is left as it is."
    },
    "older": {
      "title": "This project was made with an older Adminium (‹{was}›).",
      "line": "Update it to ‹{here}› so everything matches. This changes one line in the project and downloads its building blocks again.",
      "update": "Update this project",
      "notNow": "Not now",
      "working": "Updating this project…",
      "failed": "This project could not be updated. It still opens as it is."
    },
    "newer": {
      "title": "This project needs a newer Adminium.",
      "line": "It was last opened with Adminium ‹{last}›. This computer has ‹{here}›.",
      "lineUnknown": "It was last opened with a newer Adminium. This computer has ‹{here}›.",
      "update": "Update Adminium",
      "looking": "Looking for a newer Adminium. It is offered here when it is found.",
      "cannot": "This copy of Adminium does not update itself. Get the newest one from adminium.dev."
    },
    "running": {
      "title": "This project is already running",
      "cli": "It is open in a terminal, on port ‹{port}›. Close it there first.",
      "app": "It is open in another Adminium window, on port ‹{port}›. Close it there first.",
      "again": "Look again"
    }
  },
  "install": {
    "offline": "Could not reach the internet. The packages come from registry.npmjs.org: check your connection and try again.",
    "proxy": "Your network’s proxy refused the download. Check the proxy settings of this computer and try again.",
    "disk": "This disk is full. Free some space and try again.",
    "registry": "The package registry answered with an error. Try again in a moment."
  },
  "shared": {
    "copyFailed": "The address could not be copied.",
    "best": "Best",
    "copy": "Copy {address}",
    "portChanged": "Port {was} was taken, so the address changed to {now}.",
    "heading": "{name} is shared",
    "noNetwork": "This computer is not on a network, so no other device can reach it yet. Join a Wi-Fi or plug in a cable: the address appears here.",
    "open": "Open this on another device",
    "qr": "A code to scan for {address}",
    "notEncrypted": "Traffic on your local network is not encrypted. Share only on a network you trust.",
    "awake": "Your computer stays awake while the project is shared. Closing the lid stops it.",
    "dashboard": "Open the dashboard",
    "build": "Go back to building",
    "designerOff": "The Designer is off while the project is shared. Go back to building to change your apps.",
    "keep": "Keep sharing",
    "buildAsk": "Go back to building?",
    "buildAskBody": "People using it on other devices will be disconnected."
  },
  "connect": {
    "notAnAddress": "That is not an address. Type one like office-pc.local:4600.",
    "notPrivate": "Adminium connects without encryption only on your own network. Use an https address.",
    "noAnswer": "Nothing answered at that address. Check that the other computer is on and sharing.",
    "notAdminium": "Nothing that looks like Adminium answered at that address.",
    "address": "Address",
    "checking": "Checking…",
    "go": "Connect",
    "notEncrypted": "This address is not encrypted. Use it only on a network you trust.",
    "anyway": "Connect anyway",
    "recent": "Recent",
    "version": "Adminium {version}",
    "forgetOf": "Forget {address}",
    "forget": "Forget"
  }
} as const;
