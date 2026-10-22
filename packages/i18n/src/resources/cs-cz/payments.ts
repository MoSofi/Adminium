// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/payments.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "panel": {
    "balanceDue": "Zbývá zaplatit",
    "paid": "Zaplaceno",
    "paidInFull": "Zaplaceno v plné výši",
    "copyLink": "Kopírovat platební odkaz",
    "emailLink": "Poslat platební odkaz e-mailem",
    "record": "Zaznamenat platbu",
    "revoke": "Zrušit",
    "test": "Test",
    "refunded": "Vráceno",
    "linkLine": "Platební odkaz vytvořen {made} · platí do {until}",
    "waitingWith": "Platba (způsob: {way}) zahájena {date} · čeká na banku",
    "waitingPlain": "Online platba zahájena {date} · čeká na banku",
    "recordedBy": "zaznamenal(a) {name}",
    "online": "Online platba ({service})",
    "listLabel": "Platby k tomuto záznamu",
    "notice": {
      "draft": "Nejdřív fakturu odešlete. Platbu lze zaznamenat jen k odeslané faktuře.",
      "private": "Zákazníci se k tomuto serveru nedostanou, proto jsou platební odkazy vypnuté. Platby můžete dál zaznamenávat.",
      "update": "Tato tabulka faktur potřebuje aktualizaci své aplikace, aby přijímala online platby.",
      "voided": "Tato faktura byla stornována. Žádnou platbu nelze přijmout.",
      "noCurrency": "Tento záznam nemá měnu, proto nelze zaznamenat žádnou platbu.",
      "unclear": "Částka tohoto záznamu není ve své měně přesná, proto nelze zaznamenat žádnou platbu.",
      "notPayable": "Tento záznam teď nemůže přijmout platbu."
    },
    "by": {
      "bank-transfer": "bankovním převodem",
      "cash": "v hotovosti",
      "card": "kartou na vlastním terminálu",
      "cheque": "šekem",
      "other": "jiným způsobem",
      "online": "online"
    },
    "toast": {
      "copied": "Platební odkaz zkopírován.",
      "replaced": "Nový platební odkaz nahrazuje ten vytvořený {date}.",
      "revoked": "Platební odkaz zrušen. Stará adresa už nefunguje.",
      "recorded": "Platba {amount} zaznamenána.",
      "copyFailed": "Platební odkaz je vytvořen, ale tento prohlížeč ho nezkopíroval: {url}",
      "failed": "To se nepovedlo: {message}",
      "emailed": "Platební odkaz je na cestě na {to}.",
      "refundRequested": "Vrácení {amount} vyžádáno.",
      "refundFailed": "Vrácení {amount} se nezdařilo: {reason}"
    },
    "moreFor": "Další k {ref}",
    "menu": {
      "refund": "Vrátit peníze…"
    },
    "why": {
      "pending": "Tato platba stále čeká na banku.",
      "full": "Tato platba je vrácena celá.",
      "offline": "Tento způsob platby nelze vrátit online. Vraťte zákazníkovi peníze sami.",
      "disputed": "K této platbě je otevřen spor. Nejdřív na spor odpovězte v ovládacím panelu {service}.",
      "notTaken": "Za tuto platbu nebyly strženy žádné peníze."
    },
    "disputed": "Spor",
    "disputeLine": "Spor — odpovězte v ovládacím panelu {service}",
    "disputeNote": "Pokud se spor prohraje, peníze se vrátí zákazníkovi. Faktura se tím sama nezmění.",
    "disputeClosed": "Spor je uzavřen. Jeho výsledek najdete v ovládacím panelu {service}.",
    "needsLook": "Ke kontrole",
    "demoService": "ukázková služba",
    "refund": {
      "dispute": "Spor prohrán — {amount} se vrátilo zákazníkovi",
      "provider": "Vrácení {amount} provedené v ovládacím panelu {service}",
      "staff": "Vrácení {amount} provedené v aplikaci Adminium",
      "done": "Hotovo",
      "waitingCustomer": "Čeká na zákazníka",
      "failed": "Nezdařilo se",
      "failedNext": "Spojte se se zákazníkem a zaznamenejte, na čem se dohodnete.",
      "cancelled": "Zrušeno: nic nebylo vráceno",
      "requested": "Vyžádáno",
      "written": "Vrácení {amount}"
    },
    "partlyRefunded": "Částečně vráceno",
    "disputeWon": "Spor byl vyhrán.",
    "disputeLost": "Spor byl prohrán. {amount} se vrátilo zákazníkovi.",
    "disputeLostPlain": "Spor byl prohrán. Peníze se vrátily zákazníkovi."
  },
  "record": {
    "title": "Zaznamenat platbu",
    "amount": "Částka",
    "way": "Způsob platby",
    "wayPh": "Zvolte způsob platby",
    "ways": {
      "bank-transfer": "Bankovní převod",
      "cash": "Hotovost",
      "card": "Karta na vlastním terminálu",
      "cheque": "Šek",
      "other": "Jiný"
    },
    "date": "Datum",
    "note": "Poznámka",
    "notePh": "Nepovinné",
    "approval": "Autorizační kód",
    "approvalHelp": "Až 12 písmen a číslic.",
    "approvalErr": "Jen písmena a číslice, nejvýše 12.",
    "last4": "Poslední čtyři číslice",
    "last4Err": "Zadejte jen poslední čtyři číslice.",
    "cardNumber": "Vypadá to jako celé číslo karty. Čísla karet sem nikdy nepište.",
    "amountErr": "Zadejte částku větší než nula.",
    "overDue": "To je víc než dlužná částka {amount}.",
    "dateErr": "Den platby nemůže být v budoucnosti.",
    "pendingWarn": "Online platba čeká na banku. Když zaznamenáte další, peníze se možná stáhnou dvakrát.",
    "cancel": "Zrušit",
    "submit": "Zaznamenat platbu",
    "close": "Zavřít",
    "failed": "Platba nebyla zaznamenána: {message}"
  },
  "notice": {
    "landed": {
      "title": "Platba přijata",
      "body": "{amount} za {label}",
      "bodyWith": "{amount} za {label} přes {paidWith}"
    },
    "look": {
      "title": "Platba potřebuje kontrolu",
      "notRecorded": "Zaplaceno přes {provider}, nezaznamenáno: {label}",
      "notYet": "Zaplaceno přes {provider}, zatím nezaznamenáno: {label}",
      "amount": "Zaplaceno přes {provider}, ale ne požadovaná částka: {label}",
      "voided": "Zaplaceno přes {provider} až po zrušení: {label}",
      "mode": "Zaplaceno přes {provider} v jiném režimu, neuznáno: {label}",
      "twice": "Zaplaceno dvakrát přes {provider}: {label}",
      "missing": "Zaznamenaná platba už tam není: {label}",
      "refundedThere": "Vráceno v ovládacím panelu {provider}: {amount} u {label}. Zaznamenáno."
    },
    "key": {
      "title": "Služba {provider} odmítla klíč",
      "body": "Platby jsou pozastavené, dokud nebude uložen funkční klíč."
    },
    "webhook": {
      "title": "Webhook služby {provider} mlčí",
      "body": "Žádná událost od {date}. Platby se hledají dotazováním, pomaleji.",
      "bodyNever": "Zatím nedorazila žádná ostrá událost. Platby se hledají dotazováním, pomaleji."
    },
    "reads": {
      "title": "Adminium se službě {provider} ptá méně často",
      "body": "Tento měsíc je využita polovina dotazů, které {provider} povoluje."
    },
    "keysRemoved": {
      "title": "Klíče služby {provider} byly odstraněny",
      "body": "Odstranil(a): {by}. Žádná platba přes {provider} nezačne, dokud nebudou uloženy nové klíče."
    },
    "redirect": {
      "account": "Platební klíč teď patří jinému účtu",
      "bank": "Bankovní údaje pro převody se změnily",
      "payAddress": "Platební adresa se změnila",
      "body": "Dříve {from} · nyní {to} · změnil(a) {by}",
      "byTo": "Nyní {to} · změnil(a) {by}",
      "byOnly": "Změnil(a) {by}"
    },
    "refundFailed": {
      "title": "Vrácení peněz selhalo",
      "body": "{amount} na {paidWith}"
    },
    "dispute": {
      "title": "Otevřen spor",
      "body": "{label} · odpovězte do {date}",
      "bodyNoDate": "{label} · odpovězte v ovládacím panelu {provider}"
    }
  },
  "refund": {
    "step1": "Krok 1 ze 2",
    "step2": "Krok 2 ze 2",
    "title": "Vrátit platbu",
    "close": "Zavřít",
    "amount": "Částka",
    "full": "Celá",
    "part": "Část",
    "upTo": "Vrátit lze až {amount}",
    "reason": "Důvod",
    "reasons": {
      "requested_by_customer": "Na žádost zákazníka",
      "duplicate": "Duplicitní",
      "fraudulent": "Podvodná",
      "other": "Jiný"
    },
    "note": "Poznámka",
    "notePh": "Nepovinné",
    "goesBack": "Vrátí se na {paidWith}. Obvykle za 5–10 dní.",
    "goesBackPlain": "Vrátí se stejnou cestou, jakou bylo zaplaceno. Obvykle za 5–10 dní.",
    "cancel": "Zrušit",
    "continue": "Pokračovat",
    "question": "Vrátit {amount} na {paidWith}?",
    "questionPlain": "Vrátit {amount}?",
    "cantUndo": "Tento krok nelze vrátit.",
    "back": "Zpět",
    "submit": "Vrátit",
    "failed": "Vrácení nebylo vyžádáno: {message}",
    "lost": "Nepřišla žádná odpověď. Stiskněte znovu Vrátit: požádá o stejné vrácení, nikdy o druhé."
  }
} as const;
