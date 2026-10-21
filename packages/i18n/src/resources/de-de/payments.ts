// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/de-DE/payments.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "panel": {
    "balanceDue": "Offener Betrag",
    "paid": "Bezahlt",
    "paidInFull": "Vollständig bezahlt",
    "copyLink": "Zahlungslink kopieren",
    "emailLink": "Zahlungslink per E-Mail senden",
    "record": "Zahlung erfassen",
    "revoke": "Widerrufen",
    "test": "Test",
    "refunded": "Erstattet",
    "linkLine": "Zahlungslink erstellt am {made} · gültig bis {until}",
    "waitingWith": "Zahlung per {way} begonnen am {date} · wartet auf die Bank",
    "waitingPlain": "Eine Online-Zahlung begann am {date} · wartet auf die Bank",
    "recordedBy": "erfasst von {name}",
    "online": "Online-Zahlung ({service})",
    "refundedInline": "{amount} erstattet",
    "listLabel": "Zahlungen zu diesem Datensatz",
    "notice": {
      "draft": "Senden Sie die Rechnung zuerst. Eine Zahlung kann nur zu einer gesendeten Rechnung erfasst werden.",
      "private": "Die Kundschaft erreicht diesen Server nicht, daher sind Zahlungslinks aus. Zahlungen können Sie weiterhin erfassen.",
      "update": "Diese Rechnungstabelle braucht das Update ihrer App, um Online-Zahlungen anzunehmen.",
      "voided": "Diese Rechnung wurde storniert. Es kann keine Zahlung angenommen werden.",
      "noCurrency": "Dieser Datensatz hat keine Währung, daher kann keine Zahlung erfasst werden.",
      "unclear": "Der Betrag dieses Datensatzes ist in seiner Währung nicht exakt, daher kann keine Zahlung erfasst werden.",
      "notPayable": "Dieser Datensatz kann gerade keine Zahlung annehmen."
    },
    "by": {
      "bank-transfer": "per Banküberweisung",
      "cash": "in bar",
      "card": "per Karte am eigenen Terminal",
      "cheque": "per Scheck",
      "other": "auf anderem Weg",
      "online": "online"
    },
    "toast": {
      "copied": "Zahlungslink kopiert.",
      "replaced": "Ein neuer Zahlungslink ersetzt den vom {date}.",
      "revoked": "Zahlungslink widerrufen. Die alte Adresse funktioniert nicht mehr.",
      "recorded": "Zahlung über {amount} erfasst.",
      "copyFailed": "Der Zahlungslink ist erstellt, aber dieser Browser hat ihn nicht kopiert: {url}",
      "failed": "Das hat nicht geklappt: {message}",
      "emailed": "Der Zahlungslink ist unterwegs an {to}."
    }
  },
  "record": {
    "title": "Zahlung erfassen",
    "amount": "Betrag",
    "way": "Zahlungsweg",
    "wayPh": "Zahlungsweg wählen",
    "ways": {
      "bank-transfer": "Banküberweisung",
      "cash": "Bargeld",
      "card": "Karte am eigenen Terminal",
      "cheque": "Scheck",
      "other": "Anderer Weg"
    },
    "date": "Datum",
    "note": "Notiz",
    "notePh": "Optional",
    "approval": "Genehmigungscode",
    "approvalHelp": "Bis zu 12 Buchstaben und Ziffern.",
    "approvalErr": "Nur Buchstaben und Ziffern, bis zu 12.",
    "last4": "Letzte vier Ziffern",
    "last4Err": "Geben Sie nur die letzten vier Ziffern ein.",
    "cardNumber": "Das sieht nach einer vollständigen Kartennummer aus. Schreiben Sie hier nie Kartennummern.",
    "amountErr": "Geben Sie einen Betrag über null ein.",
    "overDue": "Das ist mehr als die fälligen {amount}.",
    "dateErr": "Der Zahlungstag kann nicht in der Zukunft liegen.",
    "pendingWarn": "Eine Online-Zahlung wartet auf die Bank. Wenn Sie eine weitere erfassen, wird das Geld womöglich zweimal genommen.",
    "cancel": "Abbrechen",
    "submit": "Zahlung erfassen",
    "close": "Schließen",
    "failed": "Die Zahlung wurde nicht erfasst: {message}"
  }
} as const;
