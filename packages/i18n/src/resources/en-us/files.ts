// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/files.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "toast": {
    "restored": "{name} was restored",
    "restoreFailed": "Could not restore this file",
    "trashed": "{name} was moved to the trash",
    "trashFailed": "Could not move this file to the trash"
  },
  "title": "Files",
  "subtitle": "Everything uploaded through this workspace, and where its bytes are stored.",
  "search": "Search by file name",
  "trash": {
    "notice": {
      "title": "The trash empties itself",
      "body": "A trashed file is removed, bytes and all, once this server's retention window has passed. Restore anything you still need before then."
    }
  },
  "listFailed": {
    "title": "Could not load these files"
  },
  "empty": {
    "filtered": {
      "title": "Nothing here",
      "body": "Clear the search, or pick another shortcut from the rail."
    },
    "title": "No files yet",
    "body": "Files land here when someone attaches one to a record or fills a file field."
  },
  "loadMore": "Load more files",
  "usage": {
    "label": "Storage in use",
    "used": "{size} used",
    "count": "{count, plural, one {# file} other {# files}}",
    "diskLabel": "Disk in use",
    "ofDisk": "{used} of {size} on this disk"
  },
  "rail": {
    "label": "File shortcuts",
    "byTable": "By table",
    "byDestination": "By destination",
    "byConnection": "By connection"
  },
  "preset": {
    "all": "All files",
    "unattached": "Not attached",
    "trash": "Trash",
    "recent": "Recent"
  },
  "column": {
    "name": "File",
    "size": "Size",
    "attachedTo": "Attached to",
    "destination": "Destination",
    "added": "Added",
    "actions": "Actions"
  },
  "row": {
    "unattached": "Not attached",
    "localDestination": "This server's disk",
    "noRecord": "Not attached to a record"
  },
  "action": {
    "restore": "Restore",
    "download": "Download",
    "deleteNamed": "Delete {name}",
    "delete": "Delete"
  },
  "drawer": {
    "none": "None",
    "subtitle": "{size} · {type}",
    "destination": "Destination",
    "attachedTo": "Attached to",
    "uploadedBy": "Uploaded by",
    "added": "Added",
    "attachedAt": "Attached",
    "trashedAt": "Moved to trash",
    "id": "File id",
    "checksum": "Checksum"
  },
  "view": {
    "label": "How files are shown",
    "grid": "Grid",
    "list": "List"
  },
  "upload": {
    "open": "Upload",
    "title": "Upload files",
    "subtitle": "Add files to this workspace.",
    "connection": "Which connection these belong to",
    "drop": "Drag files here",
    "browse": "Browse your computer",
    "sending": "Uploading",
    "cancelOne": "Cancel {name}",
    "removeOne": "Remove {name}",
    "complete": "Upload complete",
    "completeBody": "These files are now in this workspace and can be attached to a record later.",
    "send": "{count, plural, one {Upload # file} other {Upload # files}}",
    "done": "Done",
    "failed": "Failed",
    "cancelled": "Cancelled"
  }
} as const;
