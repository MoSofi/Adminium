// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/pay.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "documentTitle": "Zaplatit {label}",
  "documentTitlePlain": "Platba",
  "testBand": "Testovací stránka — žádné peníze se nepřevádějí.",
  "language": {
    "menu": "Jazyk",
    "button": "Jazyk: {name}"
  },
  "hero": {
    "due": "Částka k úhradě",
    "paid": "Zaplaceno",
    "started": "Platba zahájena",
    "partly": "Už je zaplaceno {paid} z {total}.",
    "dueBy": "Splatnost: {date}"
  },
  "ways": {
    "title": "Způsoby platby",
    "stripe": "Zaplatit kartou a dalšími způsoby",
    "stripeSub": "Karta, Apple Pay, Google Pay a další, na zabezpečené stránce Stripe",
    "paypal": "Zaplatit přes PayPal",
    "demo": "Zaplatit přes ukázkovou službu",
    "demoSub": "Smyšlené peníze, jen v testovacím režimu",
    "online": "Zaplatit online",
    "bank": "Zaplatit bankovním převodem",
    "cash": "Zaplatit při doručení",
    "other": "Jiný způsob platby",
    "gettingReady": "Připravujeme…",
    "noteStripe": "Zaplatíte na stránce Stripe. Tento obchod vaši kartu nikdy neuvidí.",
    "notePaypal": "Zaplatíte na stránce PayPal. Tento obchod vaši kartu nikdy neuvidí.",
    "noteBoth": "Zaplatíte na stránce Stripe nebo PayPal. Tento obchod vaši kartu nikdy neuvidí."
  },
  "provider": {
    "stripe": "Stripe",
    "paypal": "PayPal",
    "demo": "ukázkovou službu",
    "other": "platební službu"
  },
  "redirect": {
    "title": "Přesměrováváme vás na {provider}…",
    "link": "Nic se neděje? Pokračovat na {provider}",
    "notArabic": "Stránka Stripe není dostupná v arabštině."
  },
  "checking": {
    "title": "Ověřujeme platbu přes {provider}…",
    "body": "Trvá to pár sekund. Tuto stránku můžete zavřít; obchod vaši platbu i tak dostane.",
    "slow": "Trvá to déle než obvykle. Tuto stránku můžete zavřít; obchod vaši platbu i tak dostane."
  },
  "paid": {
    "title": "Děkujeme. Vaše platba {amount} dorazila.",
    "receiptAsk": "Pokud potřebujete doklad, obraťte se na {shop}.",
    "already": "Toto je zaplaceno. Děkujeme.",
    "receiptSent": "Doklad je na cestě na váš e-mail."
  },
  "processing": {
    "title": "Vaše banka platbu potvrzuje",
    "withMethod": "Platba {amount} (způsob: {method}) byla zahájena dne {date}. Vaše banka ji potvrdí během několika pracovních dnů. Není nutné platit znovu.",
    "plain": "Platba {amount} byla zahájena dne {date}. Vaše banka ji potvrdí během několika pracovních dnů. Není nutné platit znovu."
  },
  "failed": {
    "title": "Platba neproběhla.",
    "body": "Nic nebylo strženo.",
    "retry": "Zkusit znovu"
  },
  "cancelled": {
    "title": "Opustili jste platební stránku před zaplacením.",
    "body": "Nic nebylo strženo.",
    "stripe": "Opustili jste stránku Stripe před zaplacením.",
    "paypal": "Opustili jste stránku PayPal před zaplacením."
  },
  "shopChecks": {
    "title": "Obchod tuto platbu zkontroluje",
    "body": "Přijali jsme platbu, ale neodpovídá částce k úhradě. Obchod ji prověří a napíše vám."
  },
  "retryLater": "Otevřete platební odkaz znovu a zkuste to ještě jednou.",
  "nothingDue": {
    "title": "Zatím tu není nic k zaplacení.",
    "body": "Obraťte se prosím na {shop}."
  },
  "voided": {
    "title": "Toto už zde nelze zaplatit.",
    "body": "Obraťte se prosím na {shop}."
  },
  "expired": {
    "title": "Platnost tohoto platebního odkazu vypršela.",
    "body": "Požádejte {shop} o nový."
  },
  "testEnded": {
    "title": "Toto byl testovací odkaz.",
    "body": "{shop} nyní přijímá skutečné platby. Požádejte o odkaz k platbě."
  },
  "unknown": {
    "title": "Tento odkaz nefunguje.",
    "body": "Požádejte {shop} o nový."
  },
  "locked": {
    "title": "Příliš mnoho pokusů o platbu přes tento odkaz.",
    "bodyBank": "Zkuste to prosím znovu za hodinu, nebo zaplaťte bankovním převodem.",
    "body": "Zkuste to prosím znovu za hodinu."
  },
  "noWays": {
    "title": "Tuto částku tu nelze zaplatit online.",
    "body": "Obraťte se prosím na {shop}."
  },
  "unavailable": {
    "title": "{shop} teď nemůže přijímat online platby.",
    "body": "Obraťte se prosím přímo na obchod."
  },
  "testStaffOnly": {
    "title": "Tento testovací odkaz se otevře jen zaměstnancům obchodu {shop}.",
    "body": "Přihlaste se v tomto prohlížeči do dashboardu a pak odkaz otevřete znovu."
  },
  "offline": {
    "title": "Tato stránka se nemohla spojit s obchodem.",
    "body": "Zkontrolujte připojení a zkuste to znovu.",
    "retry": "Zkusit znovu"
  },
  "proofFailed": "Ověření, že jste člověk, neprošlo. Zkuste to znovu.",
  "bank": {
    "title": "Bankovní převod",
    "holder": "Majitel účtu",
    "iban": "IBAN",
    "bic": "BIC",
    "accountNumber": "Číslo účtu",
    "sortCode": "Kód banky (sort code)",
    "bankName": "Banka",
    "amount": "Částka",
    "reference": "Reference platby",
    "note": "Uveďte tuto referenci, aby obchod vaši platbu našel. Jako zaplacená se zobrazí, jakmile ji obchod zkontroluje.",
    "copy": "Kopírovat",
    "copied": "Zkopírováno",
    "copyLabel": "Kopírovat {label}",
    "copiedLive": "Zkopírováno: {label}.",
    "otherWays": "Jiné způsoby platby",
    "noAccount": "Požádejte {shop} o bankovní údaje pro tuto měnu."
  },
  "cash": {
    "title": "Zaplatit při doručení",
    "plain": "Částku k úhradě zaplaťte, až vám objednávka dorazí."
  },
  "footer": {
    "questions": "Máte dotazy? Napište na"
  },
  "demo": {
    "title": "Ukázková platební služba",
    "staff": "Jen pro zaměstnance. Smyšlená platební služba: žádné peníze se nepřevádějí a karta není potřeba.",
    "succeeds": "Zaplatit: karta projde",
    "fails": "Zaplatit: karta je zamítnuta",
    "needsStep": "Zaplatit: banka žádá další krok",
    "settlesLate": "Zaplatit: peníze dorazí později",
    "finishStep": "Dokončit krok banky",
    "leave": "Odejít bez zaplacení",
    "gone": "V této ukázkové platbě nelze pokračovat. Vraťte se na platební stránku."
  },
  "lines": {
    "title": "Za co platíte"
  },
  "noscript": {
    "title": "Tato stránka potřebuje k online platbě JavaScript."
  }
} as const;
