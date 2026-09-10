// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/automations.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "rules": {
    "title": "Automatiseringsregler",
    "subtitle": "Kør arbejdsgange automatisk, når noget sker.",
    "new": "Ny regel",
    "empty": {
      "title": "Ingen regler endnu",
      "body": "Opret en regel, så trin kører automatisk, når noget sker."
    },
    "none": "Vælg en regel for at se dens forløb"
  },
  "kpi": {
    "activeRules": "Aktive regler",
    "runsToday": "Kørsler i dag",
    "successRate": "Succesrate",
    "timeSaved": "Sparet tid (md.)"
  },
  "filter": {
    "all": "Alle",
    "active": "Aktive",
    "paused": "Sat på pause"
  },
  "card": {
    "runs": "kørsler",
    "success": "succes",
    "never": "Aldrig kørt",
    "toggle": "Slå til/fra"
  },
  "status": {
    "active": "Aktiv",
    "paused": "På pause"
  },
  "flow": {
    "steps": "{count, plural, one {# trin} other {# trin}}",
    "saves": "sparer {time} / kørsel",
    "runs30d": "kørsler 30 d.",
    "success": "succes",
    "test": "Test",
    "running": "Kører",
    "noSample": "Ingen post at teste med — opret en først",
    "menu": "Regelhandlinger"
  },
  "menu": {
    "rename": "Omdøb",
    "duplicate": "Dupliker",
    "delete": "Slet"
  },
  "delete": {
    "title": "Slet {name}?",
    "body": "Kørselshistorikken følger med. Det kan ikke fortrydes.",
    "confirm": "Slet",
    "cancel": "Annuller"
  },
  "save": {
    "unsaved": "Ikke gemte ændringer",
    "saving": "Gemmer…",
    "saved": "Alt er gemt",
    "action": "Gem"
  },
  "guard": {
    "title": "Forlad uden at gemme?",
    "body": "Dine ændringer til denne regel går tabt.",
    "stay": "Bliv og rediger",
    "leave": "Forlad"
  },
  "toast": {
    "saved": "Regel gemt",
    "enabled": "{name} er slået til",
    "paused": "{name} er sat på pause",
    "incomplete": "Færdiggør “{step}”, før du slår reglen til",
    "duplicated": "{name} duplikeret",
    "deleted": "{name} slettet",
    "failed": "Det blev ikke gemt — {reason}"
  },
  "canvas": {
    "insert": "Indsæt trin her",
    "addStep": "Tilføj trin",
    "remove": "Fjern trin"
  },
  "kind": {
    "trigger": "UDLØSER",
    "condition": "FILTER",
    "branch": "HVIS / ELLERS",
    "wait": "FORSINKELSE",
    "action": "HANDLING"
  },
  "branch": {
    "ifMatches": "Hvis det passer",
    "otherwise": "Ellers"
  },
  "picker": {
    "title": "Tilføj et trin",
    "before": "Før · {title}",
    "end": "Sidst i forløbet",
    "inBranch": "I grenen · {label}",
    "actions": "Handlinger",
    "logic": "Logik",
    "close": "Luk"
  },
  "pick": {
    "email": "Send e-mail",
    "emailDesc": "Fra en gemt skabelon",
    "notification": "Send notifikation",
    "notificationDesc": "Giv besked til folk i dette workspace",
    "create": "Opret post",
    "createDesc": "Tilføj en række i en tabel",
    "update": "Opdater felt",
    "updateDesc": "Skriv tilbage til en post",
    "webhook": "Kald webhook",
    "webhookDesc": "Send data hvorhen som helst",
    "slack": "Slack-besked",
    "slackDesc": "Slå op i en kanal",
    "branch": "Hvis/ellers-gren",
    "branchDesc": "Del op i to veje",
    "filter": "Fortsæt kun hvis",
    "filterDesc": "Stop, når det ikke passer",
    "wait": "Vent / forsink",
    "waitDesc": "Hold pause før næste trin",
    "stop": "Stop arbejdsgangen",
    "stopDesc": "Afslut denne kørsel her"
  },
  "node": {
    "email": {
      "sub": "Skabelon · vælg en",
      "summary": "Skabelon · {template} → {to}"
    },
    "notification": {
      "sub": "Vælg hvem der skal have besked",
      "summary": "Til · {who}"
    },
    "create": {
      "sub": "Tabel · vælg en",
      "summary": "{table} · {count} værdier"
    },
    "update": {
      "sub": "Sæt en værdi",
      "summary": "{pairs}"
    },
    "webhook": {
      "sub": "POST · JSON-payload",
      "summary": "{method} {host}"
    },
    "slack": {
      "sub": "Kanal · tilføj en webhook-URL",
      "summary": "Slack · {host}"
    },
    "wait": {
      "title": "Vent / forsink",
      "sub": "Pause på {duration}"
    },
    "stop": {
      "title": "Stop arbejdsgangen",
      "sub": "Afslutter kørslen"
    },
    "condition": {
      "empty": "Angiv en betingelse"
    },
    "trigger": {
      "record": "Når en post bliver {event} i {table}",
      "interval": "Hvert {minutes}. minut",
      "daily": "Dagligt kl. {time}",
      "weekly": "Ugentligt om {day} kl. {time}",
      "monthly": "Månedligt den {day}. kl. {time}",
      "sub": "Udløser · {event}"
    }
  },
  "event": {
    "created": "oprettet",
    "updated": "opdateret",
    "deleted": "slettet"
  },
  "insp": {
    "stepName": "Trinnets navn",
    "description": "Beskrivelse",
    "condition": "Betingelse",
    "lookAt": "Kig på",
    "thisRecord": "Denne post",
    "related": "Relaterede poster",
    "field": "Felt",
    "value": "Værdi",
    "countOf": "Antal af",
    "where": "hvor",
    "isThisRecords": "er lig med denne posts",
    "andWhere": "og hvor",
    "branchLabels": "Grennavne",
    "onError": "Fortsæt ved fejl",
    "onErrorBody": "Kør senere trin, selv hvis dette fejler",
    "moveUp": "Flyt op",
    "moveDown": "Flyt ned",
    "duplicate": "Dupliker",
    "delete": "Slet",
    "close": "Luk",
    "settings": "Indstillinger"
  },
  "op": {
    "is": "er",
    "isNot": "er ikke",
    "contains": "indeholder",
    "gt": "er større end",
    "lt": "er mindre end",
    "isEmpty": "er tom",
    "notEmpty": "er ikke tom",
    "withinNext": "er inden for de næste",
    "withinLast": "er inden for de sidste",
    "moreThanAgo": "var for mere end … siden",
    "moreThanAhead": "er mere end … ude i fremtiden"
  },
  "unit": {
    "minutes": "{count, plural, one {minut} other {minutter}}",
    "hours": "{count, plural, one {time} other {timer}}",
    "days": "{count, plural, one {dag} other {dage}}"
  },
  "trig": {
    "title": "Udløser",
    "kind": "Hvornår",
    "record": "En post bliver {event}",
    "schedule": "Efter en tidsplan",
    "table": "Tabel",
    "changed": "Kun når denne kolonne ændrer sig",
    "anyColumn": "Enhver kolonne",
    "watch": {
      "on": "Holder også øje med rækker skrevet uden for Adminium · hvert minut · via {column}",
      "off": "Overvågning er slået fra: tabellen har hverken en “{shape}”-agtig kolonne eller en stigende nøgle, så kun skrivninger via Adminium udløser reglen",
      "deleted": "Slettede rækker kan ikke overvåges; kun sletninger via Adminium udløser reglen",
      "fromNow": "Rækker fra nu af"
    },
    "when": "Kun når",
    "every": "Hvert",
    "at": "Kl.",
    "timezone": "Tidszone",
    "forEach": "For hver post i",
    "forEachWhere": "hvor",
    "noTable": "Ingen tabel — én kørsel pr. tik",
    "once": "Én gang pr. post",
    "onceBody": "En post, der har passet før, køres ikke igen",
    "timeSaved": "Sparet tid pr. kørsel",
    "timeSavedBody": "Minutter en person ville have brugt — vises som “sparer” på reglen",
    "addCondition": "Tilføj en betingelse",
    "connection": "Forbindelse"
  },
  "sched": {
    "interval": "Interval",
    "daily": "Dagligt",
    "weekly": "Ugentligt",
    "monthly": "Månedligt"
  },
  "email": {
    "template": "Skabelon",
    "to": "Til",
    "toField": "Denne posts e-mail",
    "toFixed": "Adresser",
    "column": "Kolonne",
    "addresses": "Tilføj en adresse…"
  },
  "notif": {
    "to": "Send til",
    "roles": "Alle med en rolle",
    "users": "Bestemte personer",
    "title": "Titel",
    "body": "Besked"
  },
  "rec": {
    "table": "Tabel",
    "values": "Værdier",
    "addValue": "Tilføj en værdi",
    "column": "Kolonne",
    "value": "Værdi",
    "now": "Nu",
    "remove": "Fjern denne værdi",
    "tokenHint": "Brug {token} til at hente fra posten"
  },
  "hook": {
    "url": "URL",
    "method": "Metode",
    "body": "Body",
    "bodyJson": "JSON (hændelse, regel, post)",
    "bodyText": "Egen tekst",
    "header": "Header",
    "headerName": "Navn",
    "headerValue": "Værdi",
    "slackUrl": "Slack-webhook-URL",
    "slackText": "Besked"
  },
  "wait": {
    "for": "Vent",
    "max": "Op til 30 dage",
    "amount": "Antal",
    "unit": "Enhed"
  },
  "modal": {
    "title": "Ny regel",
    "subtitle": "Kør arbejdsgange automatisk, når noget sker.",
    "name": "Regelnavn",
    "namePlaceholder": "f.eks. Byd nye tilmeldinger velkommen",
    "when": "Når (udløser)",
    "then": "Så (handling)",
    "enable": "Slå til med det samme",
    "enableBody": "Begynder at køre, så snart reglen er oprettet",
    "cancel": "Annuller",
    "create": "Opret regel",
    "doneTitle": "Regel oprettet",
    "doneBody": "Din regel er aktiv og kører, næste gang den udløses.",
    "savedTitle": "Regel gemt",
    "savedBody": "Færdiggør dens trin, og slå den så til.",
    "done": "Færdig",
    "trigger": {
      "recordCreated": "En post oprettes",
      "recordUpdated": "En post opdateres",
      "recordDeleted": "En post slettes",
      "schedule": "Efter en tidsplan"
    },
    "connection": "{connection} · {table}",
    "tablePlaceholder": "Søg i tabeller…",
    "tableEmpty": "Ingen matchende tabel"
  },
  "logs": {
    "title": "Arbejdsgangslog",
    "subtitle": "Kørselshistorik for dine automatiseringer.",
    "refresh": "Opdater",
    "kpi": {
      "runsToday": "Kørsler i dag",
      "success": "Succesrate",
      "failed": "Fejlede",
      "avgDuration": "Gns. varighed"
    },
    "filter": {
      "all": "Alle",
      "success": "Lykkedes",
      "failed": "Fejlede",
      "running": "Kører"
    },
    "status": {
      "success": "Lykkedes",
      "failed": "Fejlede",
      "running": "Kører",
      "pending": "Starter {when}",
      "waiting": "Venter · fortsætter {when}",
      "skipped": "Sprunget over",
      "cancelled": "Annulleret"
    },
    "trigger": "Udløser",
    "duration": "Varighed",
    "started": "Startet",
    "trace": "Kørselsspor",
    "loadOlder": "Indlæs ældre",
    "empty": {
      "title": "Ingen kørsler endnu",
      "filtered": "Ingen “{status}”-kørsler de sidste 7 dage"
    },
    "select": "Vælg en kørsel for at se dens spor",
    "justNow": "lige nu"
  },
  "trace": {
    "trigger": "post = {label} · {summary}",
    "scheduleTick": "tik · {stamp}",
    "evaluated": "vurderet → {result}",
    "stopped": "vurderet → false · stoppet",
    "branch": "valgte “{label}”",
    "wait": "fortsætter {stamp}",
    "wouldWait": "Ville vente {duration}",
    "email": {
      "ok": "{smtp} · leveret til {to}",
      "fail": "FEJL · {reason}",
      "would": "Ville sende “{subject}” til {to}",
      "noSmtp": "SMTP er ikke sat op — Indstillinger → E-mail",
      "noRecipient": "Ingen modtager: {column} er tom"
    },
    "notif": {
      "ok": "gav besked til {count, plural, one {# person} other {# personer}}"
    },
    "create": {
      "ok": "oprettede {label}"
    },
    "update": {
      "ok": "satte {pairs}"
    },
    "write": {
      "would": "Ville sætte {pairs}"
    },
    "hook": {
      "ok": "{method} {path} → {status} · {ms} ms",
      "fail": "{method} {path} → {status}",
      "would": "Ville {method} {url}"
    },
    "stop": "Stoppet her",
    "undone": "Fortrudt, før den kørte",
    "gone": "Posten findes ikke længere",
    "ruleOff": "Reglen blev slået fra under ventetiden",
    "skipped": "—",
    "document": {
      "ok": "bilag tegnet · {number}",
      "skipped": "intet bilag tegnet · {reason}",
      "would": "Ville tegne {kind} · {name}",
      "off": "tilknytning er slået fra · {name}"
    }
  },
  "dur": {
    "ms": "{ms} ms",
    "s": "{s} s",
    "none": "—"
  },
  "saved": {
    "h": "{h} t",
    "m": "{m} min"
  }
} as const;
