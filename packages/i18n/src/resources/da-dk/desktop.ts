// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/desktop.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "new": {
    "back": "Tilbage",
    "change": "Skift…",
    "create": "Opret",
    "creating": "Gør klar…",
    "failed": "Projektet kunne ikke oprettes.",
    "heading": "Byg en app",
    "help": "Adminium opretter denne mappe for dig. Alt om din app ligger i den.",
    "name": "Navn",
    "refuse": {
      "badName": "Brug mindst ét bogstav eller tal i navnet.",
      "existsWithFiles": "Der findes allerede en mappe med dette navn, og den indeholder filer. Vælg et andet navn eller en anden mappe.",
      "homeFolder": "Et projekt kan ikke ligge direkte i din hjemmemappe. Vælg eller opret en mappe i den.",
      "insideAProject": "Denne mappe ligger i et andet projekt. Vælg en mappe uden for det.",
      "insideTheApp": "Et projekt kan ikke ligge inde i selve Adminium. Vælg en anden mappe.",
      "notAbsolute": "Vælg en mappe med knappen “Skift…”.",
      "systemFolder": "Et projekt kan ikke ligge i en mappe, der tilhører systemet. Vælg en af dine egne mapper."
    },
    "step": {
      "files": "Lægger din apps filer på plads",
      "packages": "Henter det, din app er bygget med",
      "database": "Opretter dens database",
      "opening": "Åbner din app",
      "slow": "Det her er det lange trin første gang: et par minutter på en langsom forbindelse. Senere apps starter hurtigere.",
      "label": "Det, der sker nu"
    },
    "warn": {
      "another": "Vælg en anden mappe",
      "anyway": "Brug den alligevel",
      "dropbox": "Denne mappe synkroniseres af Dropbox. Projekter fungerer dårligt i synkroniserede mapper: synkroniseringen kan beskadige deres data.",
      "googledrive": "Denne mappe synkroniseres af Google Drive. Projekter fungerer dårligt i synkroniserede mapper: synkroniseringen kan beskadige deres data.",
      "icloud": "Denne mappe synkroniseres af iCloud Drive. Projekter fungerer dårligt i synkroniserede mapper: synkroniseringen kan beskadige deres data.",
      "noLinks": "Denne disk kan ikke rumme de links, som et projekts pakker har brug for, så det vil sandsynligvis mislykkes at hente dem.",
      "onedrive": "Denne mappe synkroniseres af OneDrive. Projekter fungerer dårligt i synkroniserede mapper: synkroniseringen kan beskadige deres data."
    },
    "where": "Hvor den skal ligge"
  },
  "packages": {
    "again": "Prøv igen",
    "body": "Det, dette projekt er bygget med, findes ikke på denne computer endnu. Adminium kan hente det nu og derefter åbne projektet. Det tager et par minutter på en langsom forbindelse.",
    "cancel": "Ikke nu",
    "failed": "Pakkerne kunne ikke hentes.",
    "get": "Hent dem og åbn",
    "title": "Hent projektets pakker?",
    "working": "Henter pakkerne"
  },
  "start": {
    "choice": {
      "build": {
        "line": "Beskriv den, så bygger Designer den på denne computer.",
        "title": "Byg en app"
      },
      "connect": {
        "line": "Brug et Adminium, der kører på en anden computer.",
        "title": "Opret forbindelse til et andet Adminium"
      },
      "db": {
        "line": "Lav skærme til en database, du allerede har.",
        "title": "Brug min egen database"
      },
      "open": {
        "line": "Fortsæt med en app, der allerede ligger i en mappe, eller som nogen har sendt dig.",
        "title": "Åbn en mappe"
      }
    },
    "heading": "Hvad vil du gerne gøre?",
    "open": {
      "notAProject": "Denne mappe er ikke et Adminium-projekt."
    },
    "recent": {
      "alreadyListed": "Den mappe står allerede på listen.",
      "building": "Under opbygning",
      "gone": "Denne mappe er flyttet eller slettet",
      "heading": "Seneste projekter",
      "locate": "Find…",
      "locateTitle": "Hvor ligger {name} nu?",
      "notThatProject": "Den mappe er ikke et Adminium-projekt.",
      "open": "Åbn {name}",
      "openDashboard": "Åbn dashboard",
      "openDashboardOf": "Åbn dashboardet for {name}",
      "openDesigner": "Åbn i Designer",
      "openDesignerOf": "Åbn {name} i Designer",
      "opened": "Åbnet {when}",
      "remove": "Fjern",
      "removed": "Fjernet fra de seneste projekter",
      "shared": "Delt"
    },
    "welcome": "Velkommen til Adminium."
  },
  "toast": {
    "dismiss": "Luk",
    "region": "Meddelelser"
  },
  "trust": {
    "body": "Når du åbner den, køres dens kode på denne computer med din adgang til dine filer. Åbn kun mapper, du selv har lavet, eller som kommer fra nogen, du har tillid til.",
    "cancel": "Annuller",
    "changed": "Koden i denne mappe er ændret, siden du sidst åbnede den.",
    "open": "Åbn",
    "title": "Vil du åbne denne mappe?"
  },
  "found": {
    "data": "Fandt dette projekts data.",
    "key": "Fandt dets nøgle.",
    "noData": "Denne mappe har projektet, men ingen data.",
    "madeBoth": "Adminium lavede en ny nøgle og en tom database.",
    "madeDatabase": "Adminium lavede en tom database.",
    "rowsLost": "Appenes egne tabeller laves igen. Rækker fra de gamle data er her ikke."
  },
  "opening": {
    "continue": "Fortsæt",
    "close": "Luk",
    "notAProject": {
      "line": "Du kan lave et nyt projekt i en mappe inde i den.",
      "another": "Vælg en anden mappe",
      "make": "Lav et nyt projekt her"
    }
  },
  "key": {
    "heading": "Dette projekts data er her, men dets nøgle mangler.",
    "body": "Nøglen er en linje i en fil med navnet ‹.env› i projektets mappe. Din computer skjuler filer, hvis navn begynder med et punktum.",
    "body2": "Uden nøglen kan de gemte databaseforbindelser og API-nøgler i projektets data ikke læses.",
    "hidden": {
      "mac": "Tryk ⌘ ⇧ . i Finder for at vise dem.",
      "windows": "Vælg Vis › Vis › Skjulte elementer i Stifinder.",
      "linux": "Tryk Ctrl H i din filhåndtering."
    },
    "env": {
      "title": "Jeg har .env-filen",
      "line": "Vælg den, så kopierer Adminium den ind.",
      "pick": "Vælg dette projekts .env-fil",
      "notAKey": "Den fil indeholder ingen nøgle. Vælg den .env-fil, der fulgte med projektets data."
    },
    "fresh": {
      "title": "Start forfra med data, behold mine apps",
      "line": "Dine gamle data flyttes til en mappe med navnet ‹{folder}›. Intet slettes."
    },
    "new": {
      "title": "Fortsæt med en ny nøgle",
      "line": "Dataene beholdes. Gemte forbindelser og nøgler i dem holder op med at virke og skal indtastes igen."
    },
    "failed": "Det kunne ikke lade sig gøre."
  },
  "accounts": {
    "heading": "Dette projekt kom med konti",
    "people": "{count, plural, one {# person} other {# personer}}",
    "peopleLabel": "Personer",
    "apiKeys": "{count, plural, one {# API-nøgle} other {# API-nøgler}}",
    "apiKeysLabel": "API-nøgler",
    "publicKeys": "{count, plural, one {# nøgle åben for offentligheden} other {# nøgler åbne for offentligheden}}",
    "publicKeysLabel": "Åben for offentligheden",
    "body": "Du arbejder som dets ejer på denne computer. Før du deler det på dit netværk, vælger du en ny ejeradgangskode, og de gamle sessioner og API-nøgler holder op med at virke.",
    "show": "Vis dem",
    "hide": "Skjul dem",
    "more": "og {count} mere"
  },
  "notice": {
    "manager": {
      "title": "Dette projekt bruger {manager}.",
      "line": "Adminium installerer med npm i stedet. Din {manager}-fil efterlades, som den er."
    },
    "older": {
      "title": "Dette projekt blev lavet med en ældre Adminium (‹{was}›).",
      "line": "Opdater det til ‹{here}›, så alt passer sammen. Det ændrer én linje i projektet og henter dets byggesten igen.",
      "update": "Opdater dette projekt",
      "notNow": "Ikke nu",
      "working": "Opdaterer dette projekt…",
      "failed": "Dette projekt kunne ikke opdateres. Det åbner stadig, som det er."
    },
    "newer": {
      "title": "Dette projekt kræver en nyere Adminium.",
      "line": "Det blev sidst åbnet med Adminium ‹{last}›. Denne computer har ‹{here}›.",
      "lineUnknown": "Det blev sidst åbnet med en nyere Adminium. Denne computer har ‹{here}›.",
      "update": "Opdater Adminium",
      "looking": "Leder efter en nyere Adminium. Den tilbydes her, når den er fundet.",
      "cannot": "Denne kopi af Adminium opdaterer ikke sig selv. Hent den nyeste på adminium.dev."
    },
    "running": {
      "title": "Dette projekt kører allerede",
      "cli": "Det er åbent i en terminal, på port ‹{port}›. Luk det der først.",
      "app": "Det er åbent i et andet Adminium-vindue, på port ‹{port}›. Luk det der først.",
      "again": "Kig igen"
    }
  },
  "install": {
    "offline": "Kunne ikke nå internettet. Pakkerne kommer fra registry.npmjs.org: tjek din forbindelse, og prøv igen.",
    "proxy": "Dit netværks proxy afviste hentningen. Tjek denne computers proxyindstillinger, og prøv igen.",
    "disk": "Denne disk er fuld. Frigør plads, og prøv igen.",
    "registry": "Pakkeregistret svarede med en fejl. Prøv igen om lidt."
  },
  "shared": {
    "copyFailed": "Adressen kunne ikke kopieres.",
    "best": "Bedst",
    "copy": "Kopiér {address}",
    "portChanged": "Port {was} var optaget, så adressen blev ændret til {now}.",
    "heading": "{name} er delt",
    "noNetwork": "Denne computer er ikke på et netværk, så ingen anden enhed kan nå den endnu. Gå på et Wi-Fi, eller sæt et kabel i: adressen vises her.",
    "open": "Åbn dette på en anden enhed",
    "qr": "En kode til at scanne for {address}",
    "notEncrypted": "Trafikken på dit lokale netværk er ikke krypteret. Del kun på et netværk, du stoler på.",
    "awake": "Din computer holder sig vågen, mens projektet er delt. Hvis du lukker låget, stopper det.",
    "dashboard": "Åbn dashboardet",
    "build": "Gå tilbage til at bygge",
    "designerOff": "Designeren er slået fra, mens projektet er delt. Gå tilbage til at bygge for at ændre dine apps.",
    "keep": "Bliv ved med at dele",
    "buildAsk": "Gå tilbage til at bygge?",
    "buildAskBody": "Personer, der bruger det på andre enheder, bliver afbrudt."
  },
  "connect": {
    "notAnAddress": "Det er ikke en adresse. Skriv en som office-pc.local:4600.",
    "notPrivate": "Adminium forbinder kun uden kryptering på dit eget netværk. Brug en https-adresse.",
    "noAnswer": "Intet svarede på den adresse. Tjek, at den anden computer er tændt og deler.",
    "notAdminium": "Intet, der ligner Adminium, svarede på den adresse.",
    "address": "Adresse",
    "checking": "Tjekker…",
    "go": "Forbind",
    "notEncrypted": "Denne adresse er ikke krypteret. Brug den kun på et netværk, du stoler på.",
    "anyway": "Forbind alligevel",
    "recent": "Seneste",
    "version": "Adminium {version}",
    "forgetOf": "Glem {address}",
    "forget": "Glem"
  }
} as const;
