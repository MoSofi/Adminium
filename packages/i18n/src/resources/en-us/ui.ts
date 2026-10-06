// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/ui.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "close": "Close",
    "cancel": "Cancel",
    "confirm": "Confirm",
    "save": "Save",
    "apply": "Apply",
    "delete": "Delete",
    "edit": "Edit",
    "copy": "Copy",
    "copied": "Copied",
    "undo": "Undo",
    "retry": "Retry",
    "clear": "Clear",
    "selectAll": "Select all",
    "clearSelection": "Clear selection",
    "showPassword": "Show password",
    "hidePassword": "Hide password",
    "reveal": "Reveal",
    "hide": "Hide",
    "clearSearch": "Clear search"
  },
  "state": {
    "loading": "Loading…",
    "empty": "Nothing here yet",
    "noResults": "No results",
    "optional": "Optional",
    "required": "Required",
    "error": "Something went wrong"
  },
  "pagination": {
    "previous": "Previous",
    "next": "Next",
    "pageOf": "Page {page, number} of {pages, number}",
    "rowsPerPage": "Rows per page",
    "range": "{from, number}–{to, number} of {total, number}"
  },
  "table": {
    "sortAscending": "Sort ascending",
    "sortDescending": "Sort descending",
    "rowActions": "Row actions",
    "selectRow": "Select row",
    "selectAllRows": "Select all rows"
  },
  "dialog": {
    "close": "Close dialog",
    "confirmTitle": "Are you sure?"
  },
  "formDialog": {
    "calendar": {
      "days": "Days in {month}",
      "next": "Next month",
      "noTimes": "No times on this day",
      "previous": "Previous month",
      "times": "Times",
      "unchecked": "This month has too many bookings to check here."
    },
    "control": {
      "fewer": "One fewer",
      "hide": "Hide",
      "more": "One more",
      "removeChip": "Remove {value}",
      "reveal": "Show",
      "upTo": "up to {size} MB"
    },
    "cta": {
      "add": "Add {entity}",
      "create": "Create {entity}"
    },
    "footnote": {
      "required": "Required fields marked *"
    },
    "issue": {
      "required": "This field is required.",
      "notAllowed": "Choose one of the listed values.",
      "invalid": "This value is not valid here.",
      "invalidCharacter": "This text contains a hidden character that cannot be saved. Type it again.",
      "unknownCode": "No code like this is on offer here.",
      "usedUp": "This code has been used as many times as it can be.",
      "plainText": "Use letters, spaces and ordinary punctuation only: no web or email address.",
      "notFound": "This is no longer there. Choose another.",
      "email": "Enter a valid email address.",
      "url": "Enter a valid web address.",
      "phone": "Enter a valid phone number.",
      "number": "Enter a number.",
      "integer": "Enter a whole number.",
      "tooShort": "Use at least {n} characters.",
      "tooLong": "Use at most {n} characters.",
      "tooSmall": "Must be {min} or more.",
      "tooLarge": "Must be {max} or less.",
      "outOfRange": "This number is out of range.",
      "duplicate": "Already added.",
      "form": "Some values were refused. Check the marked fields."
    },
    "lines": {
      "add": "Add line",
      "remove": "Remove line {n}"
    },
    "quick": {
      "today": "Today",
      "tomorrow": "Tomorrow",
      "thisWeek": "This week",
      "nextWeek": "Next week",
      "pickDate": "Pick a date",
      "clear": "No {field}"
    },
    "reference": {
      "noAccess": "You cannot read {table}, so this cannot be changed here."
    },
    "subtitle": {
      "sections": "{list} details"
    },
    "title": {
      "create": "New {entity}",
      "edit": "Edit {entity}"
    },
    "wizard": {
      "rail": "Steps",
      "step": "Step {n}",
      "back": "Back",
      "next": "Continue"
    },
    "unavailable": "This field can’t be shown: nothing links this record to the rows it names."
  },
  "combobox": {
    "placeholder": "Select…",
    "search": "Search…",
    "noMatches": "No matches"
  },
  "toast": {
    "dismiss": "Dismiss notification"
  },
  "grid": {
    "dragHandle": "Drag to move {title}",
    "resizeHandle": "Resize {title}",
    "a11y": {
      "grabbed": "Grabbed {title}. Use the arrow keys to move, hold Shift to resize, Enter to save, Escape to cancel.",
      "moved": "{title} moved to column {col}, row {row}.",
      "resized": "{title} resized to {w} columns by {h} rows.",
      "committed": "{title} placed at column {col}, row {row}.",
      "reverted": "{title} returned to its original position."
    },
    "draggableRole": "draggable widget"
  },
  "frame": {
    "noResult": "No result for widget",
    "emptyTitle": "No data for range",
    "loadError": "Something went wrong loading this widget.",
    "renderError": "This widget failed to render.",
    "refreshing": "Refreshing",
    "infoLabel": "Widget info",
    "menuLabel": "Widget menu",
    "showData": "Show data",
    "data": {
      "period": "Period",
      "value": "Value",
      "prior": "Period before",
      "category": "Category",
      "share": "Share",
      "row": "Row",
      "from": "From",
      "to": "To",
      "min": "Lowest",
      "q1": "Lower quarter",
      "median": "Middle",
      "q3": "Upper quarter",
      "max": "Highest",
      "open": "Open",
      "high": "High",
      "low": "Low",
      "close": "Close",
      "place": "Place"
    }
  },
  "charts": {
    "livePillLabel": "Live",
    "forecast": {
      "nowLabel": "Now",
      "forecastLabel": "Forecast",
      "actualLabel": "Actual"
    },
    "otherLabel": "Other",
    "heat": {
      "lessLabel": "Less",
      "moreLabel": "More"
    },
    "choropleth": {
      "lowLabel": "Low",
      "highLabel": "High"
    },
    "funnel": {
      "stepConversion": "{pct}% continue",
      "overallConversion": "{pct}% overall"
    }
  },
  "documents": {
    "panel": {
      "title": "Documents",
      "empty": "No documents have been drawn for this record yet.",
      "unnumbered": "Not numbered",
      "voided": "voided",
      "failed": "could not be drawn",
      "redacted": "you may not read this one",
      "download": "Download",
      "print": "Print"
    },
    "make": {
      "label": "Make a document",
      "one": "Make {name}"
    }
  },
  "lists": {
    "name": {
      "countries": "Countries",
      "us-states": "US states",
      "gender": "Gender"
    },
    "gender": {
      "female": "Female",
      "male": "Male",
      "other": "Other"
    }
  },
  "record": {
    "lockedHint": "Locked once {state}",
    "deleteRefused": "This record cannot be deleted. Void it instead.",
    "timedMoveAt": "Moves to {to} on its own at {time}.",
    "timedMoveSoon": "Moves to {to} on its own."
  }
} as const;
