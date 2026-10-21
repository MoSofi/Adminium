// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/payments.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "panel": {
    "balanceDue": "Udestående beløb",
    "paid": "Betalt",
    "paidInFull": "Betalt fuldt ud",
    "copyLink": "Kopiér betalingslink",
    "record": "Registrér en betaling",
    "revoke": "Tilbagekald",
    "test": "Test",
    "refunded": "Refunderet",
    "linkLine": "Betalingslink lavet {made} · virker til {until}",
    "waitingWith": "Betaling med {way} startet {date} · venter på banken",
    "waitingPlain": "En onlinebetaling startede {date} · venter på banken",
    "recordedBy": "registreret af {name}",
    "online": "Onlinebetaling ({service})",
    "refundedInline": "{amount} refunderet",
    "listLabel": "Betalinger på denne post",
    "notice": {
      "draft": "Send fakturaen først. En betaling kan kun registreres på en sendt faktura.",
      "private": "Kunder kan ikke nå denne server, så betalingslinks er slået fra. Du kan stadig registrere betalinger.",
      "update": "Denne fakturatabel skal have sin apps opdatering for at tage imod onlinebetalinger.",
      "voided": "Denne faktura er annulleret. Der kan ikke tages imod betaling.",
      "noCurrency": "Denne post har ingen valuta, så der kan ikke registreres en betaling.",
      "unclear": "Beløbet på denne post er ikke nøjagtigt i sin valuta, så der kan ikke registreres en betaling.",
      "notPayable": "Denne post kan ikke tage imod en betaling lige nu."
    },
    "by": {
      "bank-transfer": "via bankoverførsel",
      "cash": "kontant",
      "card": "med kort på vores egen terminal",
      "cheque": "med check",
      "other": "på en anden måde",
      "online": "online"
    },
    "toast": {
      "copied": "Betalingslink kopieret.",
      "replaced": "Et nyt betalingslink erstatter det, der blev lavet {date}.",
      "revoked": "Betalingslink tilbagekaldt. Den gamle adresse virker ikke længere.",
      "recorded": "Betaling på {amount} registreret.",
      "copyFailed": "Betalingslinket er lavet, men denne browser ville ikke kopiere det: {url}",
      "failed": "Det virkede ikke: {message}"
    }
  },
  "record": {
    "title": "Registrér en betaling",
    "amount": "Beløb",
    "way": "Betalingsmåde",
    "wayPh": "Vælg en betalingsmåde",
    "ways": {
      "bank-transfer": "Bankoverførsel",
      "cash": "Kontant",
      "card": "Kort på vores egen terminal",
      "cheque": "Check",
      "other": "Andet"
    },
    "date": "Dato",
    "note": "Note",
    "notePh": "Valgfrit",
    "approval": "Godkendelseskode",
    "approvalHelp": "Op til 12 bogstaver og cifre.",
    "approvalErr": "Kun bogstaver og cifre, op til 12.",
    "last4": "Sidste fire cifre",
    "last4Err": "Indtast kun de sidste fire cifre.",
    "cardNumber": "Det ligner et fuldt kortnummer. Skriv aldrig kortnumre her.",
    "amountErr": "Indtast et beløb over nul.",
    "overDue": "Det er mere end de {amount}, der skal betales.",
    "dateErr": "Betalingsdagen kan ikke ligge i fremtiden.",
    "pendingWarn": "En onlinebetaling venter på banken. Registrerer du en til, kan pengene blive taget to gange.",
    "cancel": "Annullér",
    "submit": "Registrér betaling",
    "close": "Luk",
    "failed": "Betalingen blev ikke registreret: {message}"
  }
} as const;
