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
    "emailLink": "Send betalingslink på e-mail",
    "record": "Registrér en betaling",
    "revoke": "Tilbagekald",
    "test": "Test",
    "refunded": "Refunderet",
    "linkLine": "Betalingslink lavet {made} · virker til {until}",
    "waitingWith": "Betaling med {way} startet {date} · venter på banken",
    "waitingPlain": "En onlinebetaling startede {date} · venter på banken",
    "recordedBy": "registreret af {name}",
    "online": "Onlinebetaling ({service})",
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
      "failed": "Det virkede ikke: {message}",
      "emailed": "Betalingslinket er på vej til {to}.",
      "refundRequested": "Refundering af {amount} anmodet.",
      "refundFailed": "Refunderingen af {amount} mislykkedes: {reason}"
    },
    "moreFor": "Mere for {ref}",
    "menu": {
      "refund": "Refundér…"
    },
    "why": {
      "pending": "Denne betaling venter stadig på banken.",
      "full": "Denne betaling er refunderet fuldt ud.",
      "offline": "Denne betalingsmåde kan ikke refunderes online. Refundér kunden selv.",
      "disputed": "Der er gjort indsigelse mod denne betaling. Besvar først indsigelsen i {service}-dashboardet.",
      "notTaken": "Der blev ikke trukket penge for denne betaling."
    },
    "disputed": "Indsigelse",
    "disputeLine": "Indsigelse — besvar den i {service}-dashboardet",
    "disputeNote": "Tabes indsigelsen, går pengene tilbage til kunden. Fakturaen ændres ikke af sig selv.",
    "disputeClosed": "Indsigelsen er lukket. Udfaldet står i {service}-dashboardet.",
    "needsLook": "Skal tjekkes",
    "demoService": "demotjenesten",
    "refund": {
      "dispute": "Indsigelsen tabt — {amount} gik tilbage til kunden",
      "provider": "Refundering af {amount} foretaget i {service}-dashboardet",
      "staff": "Refundering af {amount} foretaget i Adminium",
      "done": "Gennemført",
      "waitingCustomer": "Venter på kunden",
      "failed": "Mislykkedes",
      "failedNext": "Kontakt kunden, og registrér det, I aftaler.",
      "cancelled": "Annulleret: intet blev refunderet",
      "requested": "Anmodet",
      "written": "Refundering af {amount}"
    },
    "partlyRefunded": "Delvist refunderet",
    "disputeWon": "Indsigelsen blev vundet.",
    "disputeLost": "Indsigelsen blev tabt. {amount} gik tilbage til kunden.",
    "disputeLostPlain": "Indsigelsen blev tabt. Pengene gik tilbage til kunden."
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
  },
  "notice": {
    "landed": {
      "title": "Betaling modtaget",
      "body": "{amount} for {label}",
      "bodyWith": "{amount} for {label} med {paidWith}"
    },
    "look": {
      "title": "En betaling skal ses efter",
      "notRecorded": "Betalt hos {provider}, ikke registreret: {label}",
      "notYet": "Betalt hos {provider}, ikke registreret endnu: {label}",
      "amount": "Betalt hos {provider}, ikke det beløb der blev bedt om: {label}",
      "voided": "Betalt hos {provider} efter den blev annulleret: {label}",
      "mode": "Betalt hos {provider} i den anden tilstand, ikke godtaget: {label}",
      "twice": "Betalt to gange hos {provider}: {label}",
      "missing": "Den registrerede betaling er der ikke længere: {label}",
      "refundedThere": "Refunderet i {provider}-dashboardet: {amount} på {label}. Registreret."
    },
    "key": {
      "title": "{provider} afviste nøglen",
      "body": "Betalinger er sat på pause, indtil en nøgle, der virker, er gemt."
    },
    "webhook": {
      "title": "Webhooken hos {provider} er tavs",
      "body": "Ingen hændelse siden {date}. Betalinger findes ved at spørge, langsommere.",
      "bodyNever": "Der er ikke kommet nogen live-hændelse endnu. Betalinger findes ved at spørge, langsommere."
    },
    "reads": {
      "title": "Adminium spørger {provider} sjældnere",
      "body": "Halvdelen af de opslag, {provider} tillader denne måned, er brugt."
    },
    "keysRemoved": {
      "title": "Nøglerne til {provider} blev fjernet",
      "body": "Af {by}. Ingen betaling starter med {provider}, før nye nøgler er gemt."
    },
    "redirect": {
      "account": "En betalingsnøgle hører nu til en anden konto",
      "bank": "Bankoplysningerne til bankoverførsler er ændret",
      "payAddress": "Betalingsadressen er ændret",
      "body": "Før {from} · nu {to} · af {by}",
      "byTo": "Nu {to} · af {by}",
      "byOnly": "Af {by}"
    },
    "refundFailed": {
      "title": "Refusion mislykkedes",
      "body": "{amount} til {paidWith}"
    },
    "dispute": {
      "title": "Indsigelse åbnet",
      "body": "{label} · svar senest {date}",
      "bodyNoDate": "{label} · besvar den i {provider}-dashboardet"
    }
  },
  "refund": {
    "step1": "Trin 1 af 2",
    "step2": "Trin 2 af 2",
    "title": "Refundér en betaling",
    "close": "Luk",
    "amount": "Beløb",
    "full": "Fuld",
    "part": "Delvis",
    "upTo": "Op til {amount} kan refunderes",
    "reason": "Årsag",
    "reasons": {
      "requested_by_customer": "Kunden har bedt om det",
      "duplicate": "Dublet",
      "fraudulent": "Svindel",
      "other": "Andet"
    },
    "note": "Note",
    "notePh": "Valgfri",
    "goesBack": "Går tilbage til {paidWith}. Normalt 5–10 dage.",
    "goesBackPlain": "Går tilbage samme vej, som der blev betalt. Normalt 5–10 dage.",
    "cancel": "Annullér",
    "continue": "Fortsæt",
    "question": "Refundér {amount} til {paidWith}?",
    "questionPlain": "Refundér {amount}?",
    "cantUndo": "Det kan ikke fortrydes.",
    "back": "Tilbage",
    "submit": "Refundér",
    "failed": "Der blev ikke anmodet om refunderingen: {message}",
    "lost": "Der kom intet svar. Tryk på Refundér igen: Det beder om den samme refusion, aldrig en ny."
  }
} as const;
