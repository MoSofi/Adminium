// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/payments.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "panel": {
    "balanceDue": "Balance due",
    "paid": "Paid",
    "paidInFull": "Paid in full",
    "copyLink": "Copy pay link",
    "emailLink": "Email pay link",
    "record": "Record a payment",
    "revoke": "Revoke",
    "test": "Test",
    "refunded": "Refunded",
    "linkLine": "Pay link made {made} · works until {until}",
    "waitingWith": "Payment by {way} started {date} · waiting for the bank",
    "waitingPlain": "An online payment started {date} · waiting for the bank",
    "recordedBy": "recorded by {name}",
    "online": "Online payment ({service})",
    "refundedInline": "refunded {amount}",
    "listLabel": "Payments on this record",
    "notice": {
      "draft": "Send the invoice first. A payment can only be recorded against a sent invoice.",
      "private": "Customers cannot reach this server, so pay links are off. You can still record payments.",
      "update": "This invoice table needs its app's update to take online payments.",
      "voided": "This invoice was voided. No payment can be taken.",
      "noCurrency": "This record has no currency, so no payment can be recorded.",
      "unclear": "The amount of this record is not exact in its currency, so no payment can be recorded.",
      "notPayable": "This record cannot take a payment right now."
    },
    "by": {
      "bank-transfer": "by bank transfer",
      "cash": "in cash",
      "card": "by card on our own terminal",
      "cheque": "by cheque",
      "other": "another way",
      "online": "online"
    },
    "toast": {
      "copied": "Pay link copied.",
      "replaced": "A new pay link replaces the one made on {date}.",
      "revoked": "Pay link revoked. The old address no longer works.",
      "recorded": "Payment of {amount} recorded.",
      "copyFailed": "The pay link is made, but this browser would not copy it: {url}",
      "failed": "That did not work: {message}",
      "emailed": "The pay link is on its way to {to}."
    }
  },
  "record": {
    "title": "Record a payment",
    "amount": "Amount",
    "way": "Way to pay",
    "wayPh": "Choose a way to pay",
    "ways": {
      "bank-transfer": "Bank transfer",
      "cash": "Cash",
      "card": "Card on our own terminal",
      "cheque": "Cheque",
      "other": "Other"
    },
    "date": "Date",
    "note": "Note",
    "notePh": "Optional",
    "approval": "Approval code",
    "approvalHelp": "Up to 12 letters and digits.",
    "approvalErr": "Use letters and digits only, up to 12.",
    "last4": "Last four digits",
    "last4Err": "Enter the last four digits only.",
    "cardNumber": "This looks like a full card number. Never write card numbers here.",
    "amountErr": "Enter an amount above zero.",
    "overDue": "That is more than the {amount} that is due.",
    "dateErr": "The day it was paid cannot be in the future.",
    "pendingWarn": "An online payment is waiting for the bank. Recording another one may take the money twice.",
    "cancel": "Cancel",
    "submit": "Record payment",
    "close": "Close",
    "failed": "The payment was not recorded: {message}"
  }
} as const;
