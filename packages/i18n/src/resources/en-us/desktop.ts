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
      "needsPackages": "This project’s packages are not on this computer yet.",
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
  }
} as const;
