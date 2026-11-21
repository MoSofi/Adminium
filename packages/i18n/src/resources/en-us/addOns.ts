// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/addOns.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "notInstalled": {
    "title": "This add-on is not installed",
    "body": "The page you followed belongs to an add-on this server does not have installed, or that has been switched off. An administrator can install it from Studio."
  },
  "unknown": {
    "title": "No such page",
    "body": "This add-on is installed, but it does not have a page at this address."
  },
  "retry": "Try again",
  "noBundle": {
    "title": "This page could not be loaded",
    "body": "The add-on declares this page but does not ship the file it points at. Installing it again, or updating it, is what fixes this."
  },
  "failed": {
    "title": "This page could not be loaded",
    "body": "The add-on’s code could not be fetched, or it did not match the fingerprint recorded when it was installed. Nothing from it has been run."
  },
  "refused": {
    "body": "The page’s code loaded, but the server refused something it asked for: {reason}"
  },
  "crashed": {
    "body": "The page’s code loaded, but stopped with an error: {reason}"
  },
  "listFailed": {
    "body": "The list of installed add-ons could not be read, so there is no way to tell which file this page should load."
  },
  "tooOld": {
    "title": "This page needs a newer Adminium",
    "body": "This add-on's page was built for a newer version of Adminium than this one. Updating Adminium is what opens it; nothing from the page has been run."
  },
  "accounts": {
    "notice": {
      "connectedTitle": "{person} connected an account",
      "connectedBody": "{person} is now connected to {provider} as {account}.",
      "refusedTitle": "{provider} refused this server’s app",
      "refusedBody": "Check the client ID and secret saved for {provider}. Nobody needs to reconnect: connections resume once the app is accepted.",
      "clashTitle": "{person} has a calendar clash",
      "clashBody": "A busy time in {person}’s calendar now overlaps a booking. Open the booking to move it or keep it.",
      "staleTitle": "{person}’s busy times were dropped",
      "staleBody": "{person} has not reconnected for 7 days, so their calendar no longer blocks times.",
      "removedTitle": "{person} removed the {calendar} calendar",
      "removedBody": "It was deleted twice in a week, so bookings no longer go to {person}’s calendar until they turn it back on.",
      "remadeTitle": "The {calendar} calendar was made again",
      "remadeBody": "It was deleted from {person}’s account, so it was made again with their coming bookings.",
      "silentTitle": "Changes from {person}’s calendar are arriving late",
      "silentBody": "Its instant updates have stopped, so changes arrive with the regular check, within about 12 minutes.",
      "secretEndingTitle": "The {provider} client secret ends on {date}",
      "secretEndingBody": "Make a new client secret and paste it into the setup guide before that day, or every {provider} connection stops. Nobody needs to reconnect."
    }
  }
} as const;
