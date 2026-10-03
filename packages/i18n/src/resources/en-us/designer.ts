// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/designer.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "brand": "Adminium Designer",
  "spent": {
    "title": "This link has been used",
    "body": "Run the design command again to open Adminium Designer.",
    "copy": "Copy the command",
    "copied": "Copied"
  },
  "topbar": {
    "home": "Adminium Designer home",
    "toDark": "Switch to dark theme",
    "toLight": "Switch to light theme",
    "dashboard": "Open the dashboard",
    "language": "Language"
  },
  "home": {
    "title": "What do you want to build?",
    "lead": "Describe it. Adminium brings the database, the dashboard, sign-in and the API.",
    "promptLabel": "Describe your app",
    "placeholder": "Describe your app…",
    "placeholderNoModel": "Add a model to start",
    "send": "Send",
    "noModel": "Adminium Designer uses your own AI model. Add one to begin.",
    "cannotBuild": "This model cannot build apps: it does not support tools. Pick another model.",
    "failed": "The Designer could not start"
  },
  "target": {
    "label": "What to build: {target}",
    "menu": "What to build",
    "auto": "Auto",
    "autoLine": "Adminium decides",
    "dashboard": "Dashboard only",
    "dashboardLine": "tables and admin pages",
    "web": "Web",
    "webLine": "a staff or customer side"
  },
  "examples": {
    "label": "Examples",
    "refresh": "Show other examples",
    "repair": {
      "label": "Repair shop",
      "text": "A repair shop: customers drop off an item, staff log the job and the parts, and the customer gets a message when it is ready to collect."
    },
    "classes": {
      "label": "Class sign-ups",
      "text": "Class sign-ups for a small studio: a weekly timetable, places per class, a waiting list and a reminder the day before."
    },
    "loans": {
      "label": "Equipment loans",
      "text": "Equipment loans for a team: who has which item, when it is due back, and a reminder when it is late."
    },
    "catering": {
      "label": "Catering orders",
      "text": "Catering orders: customers pick a menu and a date, staff confirm, and the kitchen sees what to prepare each day."
    },
    "volunteers": {
      "label": "Volunteer rota",
      "text": "A volunteer rota for a community kitchen: shifts each week, who signed up for which, and a list of the shifts still open."
    },
    "nursery": {
      "label": "Plant nursery stock",
      "text": "Stock for a plant nursery: plants, their sizes and prices, how many are on each bench, and what to repot this week."
    },
    "grooming": {
      "label": "Dog grooming",
      "text": "Dog grooming bookings: owners book a slot online for their dog, staff see the day, and each visit keeps its notes."
    },
    "tutoring": {
      "label": "Tutoring sessions",
      "text": "Tutoring sessions: students, tutors and subjects, the sessions booked each week, and what was covered in each one."
    },
    "bikes": {
      "label": "Bike rentals",
      "text": "Bike rentals: the bikes and their condition, rentals by the hour or the day, and which bikes are out right now."
    },
    "lost": {
      "label": "Lost and found",
      "text": "A lost and found desk: items handed in with where and when, and a public page where people can describe what they lost."
    },
    "foodbank": {
      "label": "Food bank pickups",
      "text": "Food bank pickups: households register, book a pickup time, and staff mark each parcel as handed out."
    },
    "rooms": {
      "label": "Room bookings",
      "text": "Room bookings for a shared studio: rooms, who booked which one and when, and no two bookings at the same time."
    }
  },
  "start": {
    "title": "Start with an app",
    "filters": "Filter apps",
    "all": "All",
    "browse": "Browse all",
    "loading": "Loading the app list",
    "off": "The online app list is switched off for this install.",
    "failed": "The app list could not be loaded.",
    "stillDescribe": "You can still describe an app above.",
    "retry": "Try again",
    "startThis": "Start with this",
    "startApp": "Start with this: {name}",
    "staffSide": "Staff side",
    "customerSide": "Customer side"
  },
  "apps": {
    "title": "Your apps",
    "noVersions": "No versions yet",
    "versions": "{count, plural, one {# version} other {# versions}}",
    "edited": "Edited {when}",
    "continue": "Continue",
    "continueApp": "Continue {name}"
  },
  "model": {
    "add": "Add a model",
    "button": "Model: {model}",
    "buttonCannot": "Model: {model}. It cannot build apps.",
    "choose": "Choose a model",
    "fromSettings": "{provider} · saved in Settings",
    "find": "Find a model",
    "list": "Models",
    "empty": "No models yet.",
    "cannotBuild": "Cannot build",
    "cannotBuildHint": "This model does not support tools, so it cannot build apps.",
    "unreachable": "Could not reach this connection",
    "retry": "Try again",
    "keyRefused": "The key was refused.",
    "testFailed": "The test failed: {message}",
    "chooseProvider": "Choose a provider",
    "addedChip": "Added",
    "close": "Close",
    "address": "Address",
    "key": "API key",
    "optional": "Optional",
    "keySaved": "A key is saved. Type a new one to replace it.",
    "showKey": "Show the key",
    "hideKey": "Hide the key",
    "copyKey": "Copy the key",
    "copied": "Copied",
    "model": "Model",
    "testKeyFirst": "Test the key to list models",
    "testAddressFirst": "Test the address to list models",
    "connected": "Connected. {model} answered in {seconds} s.",
    "checking": "Asking this model whether it can build…",
    "canBuild": "This model can build apps.",
    "cannotBuildSave": "This model cannot build apps: it does not support tools. You can still save it for other uses.",
    "keptLead": "Where this is kept:",
    "kept": "in the file {file} in your project folder, on this machine. It is not sent to the browser and not committed to git.",
    "back": "Back",
    "test": "Test",
    "testing": "Testing…",
    "save": "Save",
    "saving": "Saving…",
    "addedToast": "Model added."
  },
  "provider": {
    "anthropic": "Anthropic",
    "openai": "OpenAI",
    "compatible": "OpenAI-compatible",
    "ollama": "Ollama (local)",
    "anthropicLine": "Claude models. Needs an API key.",
    "openaiLine": "GPT models. Needs an API key.",
    "compatibleLine": "Any service that speaks the same protocol. Needs an address.",
    "ollamaLine": "Models running on this machine. No key."
  }
} as const;
