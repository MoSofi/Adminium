// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/studio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "addOns": {
    "browse": {
      "all": "Alle",
      "bundled": "Included",
      "categories": "Kategorier",
      "discard": "Discard",
      "download": "Download",
      "emptyBody": "This build shipped none, and the online catalogue is off.",
      "emptyOnlineBody": "Onlinekataloget er slået til, men sidste tjek fandt intet. Prøv at søge efter nyere.",
      "emptyTitle": "No add-ons available",
      "install": "Install",
      "missing": "Mangler",
      "missingBody": "Dens filer findes ikke på denne server, så intet af den indlæses.",
      "needsNewer": "Kræver Adminium {version} eller nyere",
      "noMatchBody": "Ingen tilføjelse her matcher den søgning og kategori.",
      "noMatchTitle": "Ingen match",
      "offline": "Showing the add-ons that came with this build. Browsing online is switched off, and nothing here has contacted the internet.",
      "online": "Includes add-ons from the online catalogue. Checking for newer versions is a separate action.",
      "refresh": "Check for newer",
      "search": "Søg efter tilføjelser",
      "title": "Available",
      "toggle": "Browse the online catalogue",
      "upgrade": "v{version} available",
      "upgradeAction": "Upgrade"
    },
    "card": {
      "needsApiKey": "Kræver en API-nøgle",
      "needsOauth": "Forbinder med OAuth"
    },
    "category": {
      "artwork": "Design",
      "data": "Data",
      "delivery": "Levering",
      "email": "E-mail",
      "payments": "Betalinger"
    },
    "confirm": {
      "cancel": "Cancel",
      "close": "Close",
      "discard": "Discard",
      "discardBody": "The downloaded files are deleted. Nothing was installed, so nothing else changes — you can download it again whenever you like.",
      "discardTitle": "Discard this download",
      "disconnect": "Disconnect",
      "disconnectBody": "Its keys are deleted and it stops making calls. Every table and every row it created stays exactly as it is, and you can reconnect at any time.",
      "disconnectTitle": "Disconnect this add-on",
      "uninstall": "Uninstall",
      "uninstallBody": "Its keys are deleted and its files are removed from this server. Every table and every row it created stays exactly as it is. You can install it again later.",
      "uninstallTitle": "Uninstall this add-on"
    },
    "connect": {
      "apiKey": "API key",
      "submit": "Connect"
    },
    "consent": {
      "cancel": "Cancel",
      "close": "Close",
      "confirm": "Install",
      "hosts": "Attach to",
      "loading": "Working out what this would do…",
      "subtitle": "What this add-on will do, before it can do it.",
      "title": "Install {name}"
    },
    "error": "Something went wrong",
    "installed": {
      "connected": "Connected",
      "disconnect": "Disconnect",
      "egress": "May contact: {hosts}",
      "emptyBody": "Install an add-on above and it will appear here with its hosts and connection.",
      "emptyTitle": "Nothing installed yet",
      "missing": "Mangler",
      "missingBody": "Dens filer findes ikke på denne server, så intet af den indlæses. Installer den igen, eller fjern den.",
      "notConnected": "Not connected",
      "off": "off",
      "on": "on",
      "title": "Installed",
      "uninstall": "Uninstall"
    },
    "job": {
      "body": "Fetching and verifying. Nothing is installed until you say so.",
      "failed": "The download did not finish. Nothing was installed.",
      "title": "Downloading"
    },
    "plan": {
      "blocked": "This cannot be installed here",
      "needsColumns": "This add-on needs columns you do not have",
      "needsColumnsBody": "Adminium will not add columns to tables you already own. Add them yourself, then install.",
      "noData": "This add-on reads and writes no tables of its own.",
      "reuse": "This add-on will use tables you already have:",
      "willCreate": "This will create tables in your database",
      "willCreateBody": "Installing creates these tables. Uninstalling later leaves them, and their data, alone."
    },
    "settings": {
      "badJson": "Det er ikke gyldig JSON, så intet blev gemt.",
      "save": "Gem indstillinger",
      "title": "Indstillinger"
    },
    "sideload": {
      "file": "Package file (.tgz)",
      "hint": "For a server with no internet. It is checked exactly as a download would be, so it needs the hash that came with it.",
      "sha": "Integrity (sha512-…)",
      "shaHint": "The sha512- fingerprint published with the release, shown beside its Download link on adminium.dev/marketplace. The upload is refused if the bytes do not match.",
      "submit": "Upload",
      "title": "Upload a package",
      "uploaded": {
        "title": "{name} {version} er uploadet",
        "body": "Installer det fra listen ovenfor."
      }
    },
    "subtitle": "Extra capabilities you can add to your apps — shipping, artwork, data. Each one says what it needs before you install it.",
    "title": "Add-ons",
    "upgradeNote": "Upgrading keeps the hosts an add-on is attached to and the connection it already has.",
    "veto": {
      "body": "The setting is saved, but network features are off for this server and that wins. Downloaded add-ons still work, and you can still upload one yourself.",
      "title": "This deployment cannot browse online"
    }
  },
  "capability": {
    "importNoLiveHealth": "Ingen live databaseforbindelse — sundhedstjek og registrering af skemadrift er ikke tilgængelige for denne kilde.",
    "importNoRowCounts": "Skemafiler indeholder ingen rækkeantal — tabellisten viser — i stedet for opdigtede tal.",
    "mysqlApproxRows": "MySQL-rækkeantal er estimater fra lagringsmotoren (kan afvige op til ±40 %) — vises med ≈.",
    "mysqlFkEnum": "MySQL’s FK-/enum-metadata er svagere: MyISAM-tabeller deklarerer ingen fremmednøgler, enums er kolonnetyper som enum(…), og CHECK-begrænsninger kræver MySQL 8.0.16+ / MariaDB 10.2+.",
    "rowsApproximate": "Estimat fra lagringsmotoren — kan afvige op til ±40 % på InnoDB.",
    "rowsNoEstimate": "Motoren rapporterede intet estimat for denne tabel.",
    "rowsRunAnalyze": "Intet estimat endnu — kør ANALYZE på databasen for at få rækkeantal.",
    "rowsUnavailable": "Skemafiler har ingen live database — rækkeantal er ukendte, indtil du forbinder en.",
    "sqliteCheckEnums": "SQLite har ingen indbygget enum-type — enums syntetiseres fra CHECK (col IN (…))-begrænsninger.",
    "sqliteNoComments": "SQLite har ingen kolonnekommentarer — brug skema-remap-editoren til at tilføje etiketter."
  },
  "design": {
    "adopt": {
      "action": "Tilføj til min app",
      "done": "{created} sider oprettet, {updated} opdateret, {unchanged} allerede aktuelle.",
      "everything": "Denne forbindelse viser allerede alle tabeller, så intet skulle inkluderes.",
      "forbidden": "Din rolle kan ændre skemaet, men ikke generere sider. Bed en administrator med forbindelsesstyring om at tilføje disse tabeller til appen.",
      "grants": "Ingen rolle får adgang automatisk — tildel den under Indstillinger → Roller.",
      "offer": "En ny tabel gør ingenting, før den har en side. Vil du tilføje {tables} til din app?",
      "skippedEdited": "Efterladt urørt, fordi du har redigeret dem: {pages}."
    },
    "apply": "Anvend",
    "brokenEnumValues": "Hver tilladt værdi på {columns} skal være udfyldt og forskellig fra de andre.",
    "ceiling": {
      "authorise": "Godkend denne omskrivning",
      "body": "{table} har over {rows} rækker — mere, end Adminium omskriver af sig selv. Kun en Super Admin kan godkende det, og tabellen er låst, så længe omskrivningen varer.",
      "hint": "Skriv tabelnavnet præcis som det står ovenfor.",
      "notYours": "{table} har over {rows} rækker. Kun en Super Admin kan godkende en omskrivning af den størrelse — spørg en, eller kør ændringen i et servicevindue med dine egne værktøjer.",
      "prompt": "Skriv {table} igen for at godkende omskrivningen"
    },
    "column": {
      "default": "Starter som",
      "defaultValue": "Værdi",
      "help": "Hvad betyder disse indstillinger?",
      "length": "Længde",
      "link": "Linker til",
      "linkHelp": "Forbind dette til en række i en anden tabel.",
      "linkTypeNote": "Typen matcher den linkede tabels nøgle.",
      "name": "Navn",
      "namePlaceholder": "client_id",
      "noLink": "Ingenting",
      "onDelete": "Hvis den linkede række slettes",
      "precision": "Præcision",
      "primaryKey": "Primærnøgle",
      "remove": "Fjern {name}",
      "required": "Påkrævet",
      "type": "Type",
      "unique": "Unik"
    },
    "confirm": {
      "body": "Denne ændring kasserer data eller fjerner et objekt. Adminium kan ikke fortryde den.",
      "cancel": "Annullér",
      "close": "Luk",
      "confirm": "Anvend ændringer",
      "prompt": "Skriv {word} for at bekræfte",
      "title": "Anvend en destruktiv ændring"
    },
    "default": {
      "autoincrement": "Tæl op fra den sidste række",
      "false": "Nej",
      "literal": "En værdi",
      "none": "Intet",
      "now": "Den aktuelle dato og tid",
      "true": "Ja",
      "uuid": "Et nyt unikt id"
    },
    "designer": "Tabeldesigner",
    "discard": "Kassér ændringer",
    "discardTable": "Kassér denne nye tabel",
    "dropping": "Markeret til sletning",
    "empty": {
      "body": "Opret en tabel, eller vælg en at redigere. Intet når din database, før du har gennemgået sætningerne og anvendt dem.",
      "title": "Design dit skema"
    },
    "error": {
      "atColumn": "Kolonne {n}, {field}",
      "atTable": "Tabel {field}",
      "empty": "Et navn er påkrævet.",
      "identifier": "Brug små bogstaver, tal og understregninger, og start med et bogstav.",
      "tooLong": "For langt — {dialect} tillader {max} tegn."
    },
    "existing": "Eksisterende tabeller",
    "hazard": {
      "irreversible": "Kan ikke fortrydes",
      "locking": "Holder en lås",
      "lossy": "Kasserer data",
      "refused": "Afvist",
      "rewrite": "Omskriver tabellen",
      "safe": "Sikker"
    },
    "help": {
      "close": "Luk",
      "default": {
        "example": "Et felt \"oprettet den\", der starter som den aktuelle dato og tid, skal aldrig tastes og kan ikke blive forkert.",
        "term": "Starter som",
        "what": "Hvad feltet indeholder, når ingen udfylder det. Databasen sætter selv værdien ind — også for rækker, der oprettes uden for Adminium."
      },
      "keyGeneration": {
        "example": "Kun PostgreSQL kan generere et unikt id og give det tilbage med det samme, så på de andre motorer tæller nøglen op.",
        "term": "Hvordan nøglen udfyldes",
        "what": "Hvor hver rækkes id kommer fra. At tælle op fra den sidste række giver 1, 2, 3 og passer til de fleste tabeller; et unikt id er langt og tilfældigt, sværere at gætte og sværere at læse højt."
      },
      "link": {
        "example": "En reservation linker til en klient. Adminium viser så klienten på reservationen og reservationerne på klienten.",
        "term": "Link til en anden tabel",
        "what": "Forbinder denne række med en række i en anden tabel og beder databasen om at holde linket ærligt — du kan ikke pege på noget, der ikke findes."
      },
      "primaryKey": {
        "example": "Uden en primærnøgle kan Adminium vise rækkerne på en liste, men ikke redigere eller slette en enkelt af dem.",
        "term": "Primærnøgle",
        "what": "Feltet, der identificerer hver række — det, Adminium bruger til at skelne én række fra en anden. Hver tabel bør have præcis ét, og det er næsten altid det \"id\"-felt, der blev oprettet for dig."
      },
      "required": {
        "example": "En ordre skal have en kunde, så det felt er påkrævet. En leveringsbemærkning er valgfri, så det er den ikke.",
        "term": "Påkrævet",
        "what": "Feltet skal udfyldes. En række kan ikke gemmes, så længe det er tomt."
      },
      "subtitle": "Beskrivelser i almindeligt sprog af hver indstilling, og hvad den ændrer for dem, der bruger din app.",
      "title": "Hvad disse felter betyder",
      "type": {
        "example": "Et telefonnummer er som regel tekst, ikke et tal — tal taber nuller i starten.",
        "term": "Type",
        "what": "Hvilken slags oplysning feltet indeholder — ord, hele tal, penge, en dato, et ja/nej-svar. Det er valget af den rigtige, der gør, at Adminium kan vise en datovælger i stedet for et tekstfelt og lægge en kolonne med penge sammen."
      },
      "unique": {
        "example": "To kunder bør ikke dele den samme e-mailadresse — marker feltet som unikt, og så kan de ikke.",
        "term": "Unik",
        "what": "To rækker må ikke indeholde den samme værdi. Databasen afviser den anden."
      },
      "values": {
        "example": "En status: ny, i gang eller færdig. Ingen kan skrive \"i-gan\" og ved et uheld skabe en fjerde status.",
        "term": "Tilladte værdier",
        "what": "Den komplette liste over svar, feltet accepterer. Databasen afviser alt andet, og Adminium viser listen som knapper eller en menu i stedet for et tekstfelt."
      }
    },
    "keepTable": "Behold {table}",
    "newTable": "Ny tabel",
    "onDelete": {
      "cascade": "Slet også denne række",
      "restrict": "Forhindr sletningen",
      "setNull": "Lad feltet være tomt"
    },
    "plan": "Gennemgå ændringer",
    "result": {
      "applied": "Anvendt. Adminium har genindlæst dit skema.",
      "failed": "Intet blev anvendt — din database er uændret. {error}",
      "partial": "Delvist anvendt: {done} af {total} trin blev kørt. Anvend de samme ændringer igen for at fuldføre dem.",
      "repaired": "Omdøbningen blev ført videre til {pages, plural, one {# side} other {# sider}}, {grants, plural, one {# rolletilladelse} other {# rolletilladelser}} og {overrides, plural, one {# skemaoverstyring} other {# skemaoverstyringer}}."
    },
    "review": {
      "noChanges": "Ingen skemaændringer endnu.",
      "pending": "Gennemgå dine ændringer for at se de præcise sætninger, Adminium vil køre.",
      "steps": "Planlagte trin",
      "superAdmin": "Superadministrator",
      "unfinished": "En tidligere anvendelse på denne forbindelse rapporterede aldrig et resultat. Dens skema er måske halvvejs mellem to former — tjek ændringshistorikken, før du anvender flere."
    },
    "reviewPane": "Gennemgang",
    "table": {
      "addColumn": "Tilføj kolonne",
      "columns": "Kolonner",
      "drop": "Slet denne tabel",
      "dropHelp": "Tabellen og alle dens rækker destrueres. Du får se præcis hvad der går i stykker, før noget køres.",
      "keyCounted": "Tæl op fra den sidste række",
      "keyGeneration": "Hvordan nøglen udfyldes",
      "keyGenerationHelp": "Adminium læser den nye række tilbage via denne nøgle efter hver indsættelse.",
      "keyGenerationOne": "På {dialect} skal en nøgle være et tællende heltal: et id genereret af databasen kan ikke læses tilbage efter en indsættelse.",
      "keyUnique": "Et nyt unikt id",
      "name": "Tabelnavn",
      "nameHelp": "Små bogstaver, tal og understregninger.",
      "namePlaceholder": "reservations",
      "noKey": "Denne tabel har ingen primærnøgle, så Adminium behandler den som skrivebeskyttet — rækker kan vises, men ikke redigeres.",
      "renameHelp": "Ændrer du dette, omdøbes tabellen i din database."
    },
    "unnamed": "Navngiv hver tabel og kolonne for at gennemgå ændringerne.",
    "unrepresentableDefaults": "Disse kolonner beholder en databasegenereret standardværdi, som Adminium ikke kan redigere her, og den efterlades som den er: {columns}",
    "valuelessEnum": "Giv {columns} mindst én tilladt værdi for at gennemgå ændringerne.",
    "values": {
      "add": "Tilføj værdi",
      "addOnly": "Denne liste er en type i din database, og Postgres kan ikke fjerne eller omdøbe en værdi, når den først findes. Du kan tilføje flere.",
      "down": "Flyt {value} ned",
      "empty": "En valgkolonne skal have mindst én værdi, før ændringen kan gennemgås.",
      "label": "Tilladte værdier",
      "placeholder": "in_progress",
      "remove": "Fjern {value}",
      "up": "Flyt {value} op",
      "value": "Værdi {n}"
    }
  },
  "diagram": {
    "ceiling": "Viser de {shown} mest forbundne tabeller. {omitted} flere er skjult — søg for at hente en frem.",
    "legend": {
      "declared": "Fremmednøgle",
      "inferred": "Udledt",
      "virtual": "Tilføjet i Adminium"
    },
    "legendLabel": "Signaturforklaring",
    "node": {
      "foreignKey": "Fremmednøgle",
      "more": "+{count} mere",
      "primaryKey": "Primærnøgle"
    },
    "outline": {
      "intro": "{tables} tabeller og {relations} relationer, som en liste.",
      "more": " og {count} mere",
      "referencedBy": "Refereret af: {list}",
      "references": "Refererer: {list}"
    },
    "saveLayout": "Gem layout",
    "search": "Find en tabel eller kolonne",
    "showDiagram": "Vis diagram",
    "showList": "Vis som liste"
  },
  "documents": {
    "cancel": "Annullér",
    "connectionLabel": "Forbindelse",
    "delete": "Slet",
    "delivery": {
      "email": "Send til",
      "noEmail": "Ingen — behold det på posten",
      "noEmailSlot": "Denne bilagstype har ikke noget adressefelt og kan derfor ikke sendes.",
      "noSmtp": "Dette Adminium har endnu ingen e-mailserver, så der kan ikke sendes noget. Opsæt en under Studio → Indstillinger → E-mail.",
      "stored": "Bliver altid på posten."
    },
    "disabled": "slået fra",
    "edit": "Rediger",
    "empty": "Ingen tilknytninger endnu.",
    "grants": {
      "refused": "Denne tilknytning læser {tables}, som I ikke må læse. Bilag herfra vil fejle for jer.",
      "title": "I må ikke læse det hele"
    },
    "intro": "En tilknytning siger, hvilke kolonner i hvilken tabel der udgør én slags bilag, hvad der tegner det, og hvor det går hen.",
    "name": "Navngiv denne tilknytning",
    "newFrom": "Ny tilknytning til:",
    "noProvider": "Intet installeret add-on kan endnu tegne bilag. Installér et under Add-ons, så vises de mulige tilknytninger her.",
    "pickTable": "Vælg en tabel…",
    "prefix": "Nummerforstavelse",
    "render": {
      "failedRow": "Der blev ikke tegnet noget: {reason}",
      "intro": "Tegn et nu, ud fra en række, du vælger. Intet sendes nogen steder hen — det bliver på posten som alle andre.",
      "noRows": "Ingen rækker at tegne ud fra endnu.",
      "open": "Åbn",
      "pending": "Tegner…",
      "pick": "Tegn denne",
      "ready": "Tegnet.",
      "saveFirst": "Gem tilknytningen først. Et bilag tegnes ud fra en gemt, så du kan se, hvad den laver, før andre gør.",
      "search": "Søg i rækker",
      "slow": "Der er endnu ikke dukket et bilag op. Det venter måske på tur, eller denne installation kører ingen baggrundsopgaver — der tegnes ikke noget, før den gør.",
      "slowTitle": "Stadig ingenting"
    },
    "save": "Gem tilknytning",
    "slot": {
      "byDefault": "Udfyldes af Adminium",
      "lineColumnOf": "{column} for hver linje",
      "lineColumns": "Hvad der udfylder hver kolonne i en linje",
      "looksLikeLines": "ligner linjer",
      "noChildren": "Intet i din database peger på denne tabel, så der er ingen linjer at tegne. Et bilag har brug for en underordnet tabel med en fremmednøgle tilbage til denne.",
      "noLines": "Ingen linjer",
      "pii": "skjulte data",
      "typed": "En værdi, jeg skriver",
      "typedHint": "Skrevet her, ikke læst fra dine data — hvert bilag fra denne tilknytning får den samme værdi.",
      "typedValue": "Værdi for {slot}",
      "unmapped": "Ikke udfyldt"
    },
    "step": {
      "delivery": "Hvor det går hen",
      "kind": "Slags",
      "mapping": "Hvad der udfylder hvert felt",
      "mappingHelp": "Hvert felt læser en kolonne — eller tager en værdi, du skriver her.",
      "render": "Prøv den på en række",
      "table": "Forbindelse og tabel",
      "trigger": "Hvad der tegner det"
    },
    "tableLabel": "Tabel",
    "title": "Bilagstilknytninger",
    "trigger": {
      "created": "Når en række kommer til",
      "manual": "Kun når nogen beder om det",
      "manualShort": "på anmodning",
      "note": "Rækker fra en import eller skrevet direkte i databasen tegner intet — kun skrivninger gennem Adminium gør.",
      "noteTitle": "Hvad der tæller som en ændring",
      "updated": "Når en række ændres"
    },
    "unbound": "Mangler stadig: {slots}",
    "deleteConfirm": {
      "title": "Slet denne tilknytning?",
      "body": "Reglen, der udløser den, forsvinder også, og dokumenter, der allerede er dannet ud fra den, mister deres link tilbage. Dette kan ikke fortrydes.",
      "prompt": "Skriv {name} for at bekræfte",
      "confirm": "Slet tilknytning"
    },
    "deleteFailed": "Tilknytningen blev ikke slettet",
    "loadFailed": "Tilknytningerne kunne ikke indlæses"
  },
  "enrich": {
    "byo": {
      "cardDescription": "Kopiér en selvstændig prompt ind i Claude Code, ChatGPT, hvad som helst — og indsæt så JSON’en tilbage. Ingen nøgle nødvendig, intet forlader denne maskine automatisk.",
      "cardTitle": "Kopiér en prompt til mit eget AI-værktøj",
      "cardTitleRecommended": "Kopiér en prompt til mit eget AI-værktøj — anbefalet",
      "chunkTab": "Prompt {index}",
      "chunkTabs": "Prompt-dele",
      "chunkValid": "Del {index} valideret",
      "continueReview": "Fortsæt til gennemgang",
      "copyErrors": "Kopiér fejl til dit AI-værktøj",
      "copyErrorsDone": "Fejl kopieret",
      "copyErrorsHint": "Indsæt dette tilbage i dit AI-værktøj for at få et rettet svar.",
      "copyPrompt": "Kopiér prompt",
      "copyPromptDone": "Prompt kopieret",
      "download": "Download .md",
      "droppedItems": "{count} forslag blev frasorteret under valideringen — gennemgangen viser resten.",
      "errorsTitle": "Valideringen fandt {count} problemer",
      "guidance": "Kør dette i et hvilket som helst AI-værktøj — Claude Code, ChatGPT, hvad som helst. Indsæt den returnerede JSON nedenfor.",
      "mergedBody": "Forslagene er klar til gennemgang mod det heuristiske grundlag.",
      "mergedTitle": "Alle {count} dele valideret og flettet",
      "mergedTitleSingle": "Svar valideret",
      "pasteLabel": "Indsæt JSON-svaret",
      "pastePlaceholder": "Indsæt JSON-svaret her…",
      "pendingBody": "Indsæt JSON-svaret ovenfor og validér det for at fortsætte til gennemgang.",
      "pendingBodyChunked": "Hver del skal valideres, før forslagene flettes. Indsæt og validér hver prompt ovenfor.",
      "pendingTitle": "Validér hver prompt for at fortsætte",
      "promptLabel": "Berigelsesprompt",
      "promptLabelN": "Berigelsesprompt {index} af {total}",
      "requestFailed": "Kunne ikke nå serveren for at validere — prøv igen.",
      "tokenChip": "≈ {tokens} tokens",
      "valid": "Svar valideret",
      "validate": "Validér",
      "wholeDocument": "hele dokumentet"
    },
    "copied": "Kopieret",
    "createFailed": "Berigelsesprompten kunne ikke bygges — prøv igen.",
    "createFailedTitle": "Kunne ikke starte",
    "direct": {
      "back": "Tilbage til valg",
      "building": "Bygger prompt…",
      "cancel": "Annullér",
      "continueReview": "Fortsæt til gennemgang",
      "done": "Berigelse fuldført — gennemgå forslagene.",
      "errorTitle": "Berigelse mislykkedes",
      "failed": "Udbyderkørslen mislykkedes. Tjek dine AI-indstillinger, og prøv igen.",
      "jobFailed": "Berigelseskørslen blev ikke fuldført.",
      "logLabel": "Berigelseslog",
      "retry": "Prøv igen",
      "startFailed": "Kunne ikke starte kørslen — prøv igen.",
      "subtitle": "Sender dit skema til",
      "title": "Beriger med AI"
    },
    "fileBody": "Skemafil-kilder har endnu ikke et snapshot at berige. Forbind en live-database for at bruge AI-berigelse, eller fortsæt — det heuristiske grundlag genererer stadig en komplet app.",
    "fileTitle": "AI-berigelse kræver en live-database",
    "noTablesBody": "Denne database har endnu ingen tabeller, så der er intet for AI at navngive eller gruppere. Fortsæt — når der findes tabeller, kan du til enhver tid køre AI-berigelse fra Indstillinger → AI.",
    "noTablesTitle": "Ingen tabeller at berige",
    "generatePrompt": "Generér prompt",
    "intentLabel": "Hvordan vil du berige?",
    "localeLocked": "(påkrævet)",
    "localesLegend": "Oversæt etiketter til",
    "noSections": "Vælg mindst én beslutningsgruppe at berige.",
    "provider": {
      "configError": "Udbyderindstillingerne kunne ikke indlæses — konfigurér en udbyder i Indstillinger → AI, og kom tilbage til dette trin.",
      "description": "Kør berigelsen nu mod din konfigurerede udbyder. Du gennemgår hvert forslag som en diff.",
      "networkDisabled": "Dette Adminium har ingen udgående internetadgang og kan ikke nå en udbyder-API. Brug kopier-indsæt-turen i stedet — samme prompt, samme gennemgang.",
      "readyBody": "Vælg “Brug min AI-udbyder” ovenfor for at køre berigelsen på denne forbindelse nu.",
      "readyTitle": "AI-udbyder konfigureret",
      "setUpHere": "Konfigurér en udbyder her",
      "setUpHide": "Skjul udbyderopsætning",
      "settingsHint": "Vil du køre den direkte?",
      "settingsLink": "Konfigurér en udbyder i Indstillinger → AI",
      "title": "Brug min AI-udbyder",
      "unconfigured": "Der er endnu ikke konfigureret nogen AI-udbyder — konfigurér en nedenfor, eller kopiér en prompt til dit eget AI-værktøj."
    },
    "providerFallback": "din AI-udbyder",
    "samplingHint": "Inkluderer op til 20 rigtige værdier pr. ikke-PII-kolonne i prompten.",
    "samplingPreviewBody": "Op til 20 hyppigste værdier pr. ikke-PII-kolonne, plus min/maks for numeriske og datokolonner. PII-markerede kolonner udtages aldrig. Alt andet forbliver kun aggregeret. Gennemgå den præcise prompt før kopiering (BYO) — intet sendes uden din handling.",
    "samplingPreviewTitle": "Hvad forlader denne maskine",
    "samplingTitle": "Inkludér eksempelværdier",
    "section": {
      "enums": "Enum-semantik",
      "groups": "Navigationsgrupper",
      "icons": "Ikoner",
      "keys": "Nøglekolonner",
      "labels": "Etiketter og beskrivelser",
      "microcopy": "Mikrotekst",
      "pii": "PII og maskering",
      "relations": "Relationer",
      "templates": "Sideskabeloner",
      "widgets": "Dashboard-widgets"
    },
    "sectionsLegend": "Hvad skal AI’en beslutte?",
    "skip": {
      "confirmBody": "Den genererede app vil bruge de heuristiske etiketter, grupper og dashboards. Fortsæt for at generere — du kan køre AI-berigelse når som helst fra Indstillinger → AI.",
      "confirmTitle": "Fortsætter med heuristik",
      "description": "Generér fra det heuristiske grundlag. Du kan berige senere fra Indstillinger → AI — at springe over straffes aldrig.",
      "title": "Spring over — brug kun heuristik"
    },
    "startOver": "Start forfra",
    "startProvider": "Start berigelse",
    "subtitle": "Forfin eventuelt de genererede etiketter, grupper, enums og dashboards med en LLM. Det heuristiske grundlag fungerer uden — dette tilføjer kun forslag, som du gennemgår, før noget anvendes.",
    "title": "Berig med AI"
  },
  "generate": {
    "errorTitle": "Generering mislykkedes",
    "failed": "Generering mislykkedes — prøv igen, eller kør introspektionen igen først.",
    "fileBody": "Dit skema blev fortolket rent, og forhåndsvisningen ovenfor er ægte. Generering af en kørende app direkte fra en skemafil (med pladsholderrækker) er ikke tilgængelig endnu — forbind en live database for at generere i dag.",
    "fileTitle": "Skemafil fortolket — generering kræver en live database",
    "log": {
      "classifying": "Klassificerer skema…",
      "composing": "Sammensætter skabeloner…",
      "done": "{pages} sider genereret på tværs af {groups} navigationsgrupper",
      "writing": "Skriver sider…"
    },
    "logLabel": "Genereringslog",
    "openApp": "Åbn din app",
    "run": "Generér dashboard",
    "subtitle": "Én side pr. medtaget tabel plus dashboards pr. domæne — formål:",
    "successBody": "{pages} sider i {groups} navigationsgrupper — genereret fra dit skema, redigerbare i Studio.",
    "successTitle": "Dit dashboard er klar",
    "title": "Generér din app",
    "blankBody": "Der blev ikke genereret noget, præcis som du bad om. Byg din første side fra denne forbindelse, når du er klar.",
    "blankTitle": "Din forbindelse er klar",
    "createPage": "Opret en side"
  },
  "hostedApps": {
    "browse": {
      "title": "Apps du kan installere",
      "subtitle": "Færdige apps, der fulgte med dette build. En installation opretter de nødvendige tabeller og serverer appens skærme — der sker intet, før du bekræfter planen.",
      "search": "Søg efter apps…",
      "clear": "Ryd søgningen",
      "all": "Alle",
      "by": "af {publisher}",
      "install": "Installér",
      "installed": "Installeret",
      "missing": "Mangler",
      "noMatch": "Ingen apps matcher den søgning",
      "noMatchBody": "Prøv et andet ord eller en anden kategori.",
      "emptyTitle": "Ingen apps er tilgængelige",
      "emptyBody": "Apps, der følger med dette build, vises her. Lad ADMINIUM_BUNDLED_APPS pege på en mappe med app-pakker, eller upload selv en.",
      "unreadable": "Pakkens manifest kunne ikke læses. Den kan ikke installeres — kassér den nedenfor.",
      "subtitleOnline": "Apps, der fulgte med dette build, plus dem i onlinekataloget. En installation downloader appen efter behov og opretter de nødvendige tabeller — der sker intet, før du bekræfter planen.",
      "neverChecked": "Onlinekataloget er slået til, men er ikke tjekket endnu. Søg efter nyere for at vise dets apps.",
      "refresh": "Søg efter nyere",
      "toggle": "Gennemse onlinekataloget over apps",
      "emptyOnlineBody": "Onlinekataloget er slået til, men intet er vist endnu. Søg efter nyere for at hente det.",
      "fromCatalog": "Online",
      "needsNewer": "Kræver Adminium {version} eller nyere"
    },
    "domains": {
      "add": "Tilknyt et domæne",
      "docsLink": "Sådan opsætter du et domæne",
      "hostLabel": "Vært",
      "instanceLabel": "Instans",
      "instanceOwn": "Appens egen",
      "issuesTitle": "Domænekortet blev afvist",
      "none": "Ingen domæner er tilknyttet.",
      "remove": "Fjern",
      "save": "Gem domæner",
      "savedBody": "Tilknytninger træder i kraft inden for få sekunder. En vært svarer først, når dens DNS og din proxy faktisk når denne instans.",
      "savedTitle": "Gemt",
      "stepDns": "Peg værten mod denne server i dit DNS — samme posttype og mål som den adresse, du bruger til dette dashboard.",
      "stepProxy": "Giv værten sin egen site-blok på din reverse proxy, der sender Host-headeren uændret videre — og genindlæs derefter proxyen. At redigere dens konfigurationsfil ændrer ikke en proces, der allerede kører.",
      "stepSignIn": "Personaleflader beder dig logge ind igen: sessionscookies hører til én vært, så en tilknyttet vært sender dig først til sin egen loginside.",
      "subtitle": "Peg et domænes DNS på din proxy, send Host-headeren videre til Adminium, og tilknyt det her — værten serverer så fladen i stedet for dette dashboard. Certifikater bliver på din proxy.",
      "surfaceLabel": "Flade",
      "title": "Domæner"
    },
    "emptyBody": "Peg ADMINIUM_SURFACES_DIR på en mappe med byggede flader — én mappe pr. app og side, hver med sin index.html — og genstart. De serveres derefter under /apps/ og vises her.",
    "emptyTitle": "Der serveres ingen app-flader",
    "error": "Noget gik galt",
    "install": {
      "steps": {
        "bundle": "Pakke",
        "database": "Database",
        "plan": "Skemaplan",
        "done": "Færdig"
      },
      "progress": "Installationsforløb",
      "failed": "Installationen mislykkedes",
      "bundle": {
        "title": "Upload app-pakken",
        "hint": "Appens udgivelsesfil (.tgz) — den indeholder manifest.json og en staff/- eller customer/-mappe.",
        "file": "Pakkefil (.tgz)",
        "fileHint": "Der oprettes intet, før du bekræfter på skemaplan-trinnet.",
        "integrity": "Integritet (valgfrit)",
        "integrityHint": "Indsæt den sha512-værdi, der er udgivet med versionen, så serveren kontrollerer netop disse bytes. Står feltet tomt, beregnes den her."
      },
      "database": {
        "title": "Hvilken database skal den installeres i?",
        "hint": "Vælg en forbindelse med skriveadgang. Det er her, tabellerne oprettes, og det er den, appen læser fra bagefter.",
        "tables": "Tabeller: {count}",
        "readOnly": "Skrivebeskyttet",
        "writable": "Skrivbar",
        "noWritable": "Ingen skrivbar forbindelse",
        "allReadOnly": "Alle forbindelser her bruger en skrivebeskyttet rolle, så ingen app kan oprette sine tabeller. Tilslut først en, der må køre DDL."
      },
      "plan": {
        "title": "Gennemgå skemaplanen",
        "hint": "Præcis det, der bliver oprettet i din database. Der er endnu ikke skrevet noget.",
        "refused": "Denne app kan ikke installeres her",
        "create": "Opret",
        "reuse": "Genbrug eksisterende",
        "toggleDdl": "Vis DDL-forhåndsvisning",
        "ddl": "DDL-forhåndsvisning",
        "ddlNote": "Vejledende. Serveren danner den præcise sætning til din motor, inklusive fremmednøgler.",
        "summary": "{created} oprettet · {reused} genbrugt",
        "pageWarnings": "Nogle af appens sider kommer uden en tabel"
      },
      "done": {
        "body": "{key} serveres nu. Vælg nedenfor, hvor medarbejdersiden skal vises.",
        "titleApp": "{app} er installeret",
        "tablesCreated": "Tabeller oprettet i {connection}",
        "tablesKept": "Tabeller brugt, som de var",
        "pages": "Genererede sider",
        "sampleNotAdded": "ikke tilføjet",
        "sampleAdding": "tilføjer…",
        "sampleAdded": "tilføjet",
        "sampleLater": "Du kan tilføje dem senere fra appens side."
      },
      "cancel": "Annullér",
      "back": "Tilbage",
      "upload": "Upload",
      "continue": "Fortsæt",
      "confirm": "Installér",
      "finish": "Administrér apps",
      "staged": "Udpakkede filer: {files}",
      "footerStep": "Trin {n} af {total}",
      "footerStepApp": "Trin {n} af {total} · {app}",
      "chosen": {
        "title": "Installér {app}",
        "hint": "Denne app fulgte med dit build og ligger allerede på disken. Der oprettes intet, før du bekræfter skemaplanen."
      },
      "downloaded": {
        "hint": "Downloadet fra onlinekataloget over apps og kontrolleret mod dets offentliggjorte fingeraftryk. Der oprettes intet, før du bekræfter skemaplanen."
      },
      "uploaded": {
        "hint": "Læst fra manifest.json i den pakke, du uploadede. Der oprettes intet, før du bekræfter skemaplanen.",
        "replace": "Upload en anden pakke"
      },
      "check": {
        "title": "Tjek tabellerne",
        "hint": "{app} opretter disse i {connection}. Intet ændres, før du trykker på Installer.",
        "summaryNew": "{count} nye",
        "summaryEarlier": "{count} fra din tidligere installation",
        "summaryShared": "{count} delt med en anden app",
        "summaryTaken": "{count, plural, one {# navn optaget} other {# navne optaget}}",
        "altPrefixInUse": "Tjekket med præfikset {prefix}.",
        "usualPrefix": "Brug det sædvanlige præfiks",
        "badgeNew": "Ny",
        "badgeEarlier": "Din fra en tidligere installation",
        "badgeShared": "Delt med {app}",
        "badgeTaken": "Navn optaget",
        "columns": "{count, plural, one {# kolonne} other {# kolonner}}",
        "keep": "Brug den og behold dens data",
        "sharedNote": "{app} bruger også denne tabel. Begge apps bliver ved med at læse og skrive de samme rækker.",
        "earlierNote": "Adminium oprettede denne tabel ved en tidligere installation af {app}.",
        "createPreview": "Forhåndsvisning af oprettelse",
        "addsColumns": "{count, plural, one {Tilføjer # kolonne:} other {Tilføjer # kolonner:}}",
        "widens": "Gør {column} bredere, fra {from} til {to}.",
        "setIdentity": "{column} nummererer selv nye rækker.",
        "enumValues": "{column} accepterer også {values}.",
        "noLoss": "Ingen kolonne fjernes, og ingen data går tabt.",
        "reuseNote": "Appen læser og skriver de rækker, der allerede er der.",
        "renameTitle": "Omdøb den eksisterende tabel, så den er af vejen",
        "renameNote": "En ny {table} oprettes til appen.",
        "renameField": "Nyt navn til den eksisterende tabel",
        "renameFieldNote": "Adminium reparerer sine egne sider og regler, der pegede på det gamle navn.",
        "prefixTitle": "Brug et andet præfiks til denne app",
        "prefixNote": "Gælder for alle appens tabeller på én gang.",
        "prefixField": "Præfiks",
        "prefixFieldNote": "{count, plural, one {Tabellen bliver tjekket igen.} other {Alle # tabeller bliver tjekket igen.}}",
        "takenIntro": "{table} findes allerede og blev lavet i hånden. Vælg, hvad der skal ske med den.",
        "takenIntroShort": "Hvad der skal ske med {table}",
        "pickFirst": "Vælg, hvad der skal ske med {table}, før du installerer.",
        "checkFirst": "Tjek tabellerne igen, før du installerer.",
        "nothingYet": "Intet ændres, før du trykker på Installer.",
        "again": "Tjek igen",
        "adoptedNote": "En tidligere installation af {app} brugte denne tabel, som den fandt den."
      },
      "running": {
        "title": "Installerer {app}",
        "hint": "Skriver til {connection}.",
        "tables": "Tabeller",
        "pages": "Sider"
      },
      "stopped": {
        "failed": "mislykkedes",
        "notStarted": "ikke startet",
        "atTables": "Oprettelsen af tabellerne mislykkedes, så intet efter det blev kørt.",
        "atIntrospect": "Tabellerne blev oprettet. Genindlæsningen af dem mislykkedes, så intet efter det blev kørt.",
        "atPages": "Tabellerne blev oprettet. Oprettelsen af siderne mislykkedes, så intet efter det blev kørt.",
        "atFinish": "Tabellerne og siderne blev oprettet. Afslutningen af installationen mislykkedes.",
        "title": "Installationen stoppede halvvejs",
        "created": "{count} oprettet",
        "made": "oprettet",
        "said": "Hvad databasen svarede",
        "saidAbout": "Hvad databasen svarede om {table}",
        "resume": "Intet blev fjernet. Prøv igen fortsætter, hvor den stoppede.",
        "retry": "Prøv igen",
        "back": "Tilbage til skemaplan"
      }
    },
    "installed": {
      "title": "Installerede apps",
      "install": "Installér en app",
      "emptyTitle": "Ingen apps installeret endnu",
      "emptyBody": "Upload en bygget fladepakke for at installere en. Apps installeret her serveres med det samme — uden genstart, i modsætning til en mappe.",
      "uninstall": "Afinstallér",
      "stagedTitle": "Uploadet, men ikke installeret",
      "stagedHint": "Kassér den, du har fravalgt, eller upload den samme nøgle igen for at erstatte den.",
      "discard": "Kassér",
      "installedAt": "installeret {when}",
      "updatesAvailable": "{count, plural, one {# opdatering tilgængelig} other {# opdateringer tilgængelige}}",
      "updateTo": "Opdatér til v{version}",
      "needsNewer": "v{version} kræver Adminium {minimum} eller nyere",
      "cannotUpdate": "v{version} kan ikke opdatere denne version direkte. Afinstaller den først, og installer derefter v{version}.",
      "missing": "Mangler",
      "missingBody": "Dens filer findes ikke på denne server, så den serveres ikke. Installer den samme version igen, eller afinstaller den.",
      "update": "Opdatér",
      "discardFailed": "Uploadet blev ikke kasseret",
      "renamed": "Tabeller omdøbt til {prefix}…",
      "oldNames": "Denne installation bruger de gamle tabelnavne.",
      "oldNamesWhy": "De blev lavet før præfikser.",
      "renameTo": "Omdøb til {prefix}…"
    },
    "instances": {
      "add": "Tilføj en instans",
      "appLabel": "App",
      "body": "Server den samme app over flere databaser. Hver instans er tilgængelig på /apps/<app>/<segment>/<side>/ og læser kun den forbindelse, du giver den.",
      "empty": "Ingen ekstra instanser.",
      "failed": "Instanserne blev ikke gemt",
      "readsLabel": "Læser",
      "remove": "Fjern",
      "save": "Gem instanser",
      "slugLabel": "URL-segment",
      "title": "Instanser"
    },
    "job": {
      "refreshTitle": "Tjekker onlinekataloget over apps",
      "downloadTitle": "Downloader {app}",
      "body": "Henter og kontrollerer. Intet installeres eller ændres, før du siger til.",
      "failed": "Jobbet blev ikke færdigt. Intet blev installeret eller ændret."
    },
    "names": {
      "label": "Navn til {app}",
      "save": "Gem navn",
      "subtitle": "Hvad hver app hedder — på dens egne skærme og i dette dashboards sidepanel. Lad feltet stå tomt for at bruge det navn, appen blev bygget med.",
      "title": "App-navne"
    },
    "subtitle": "De app-flader denne instans serverer — hvor hver enkelt vises, og hvilke domæner der peger på dem.",
    "surfaces": {
      "boundKey": "Serverer nøgle",
      "connectionLabel": "Læser",
      "connectionUnset": "Den der kører",
      "customer": "Kunde",
      "mintLink": "Opret en under Offentligt API",
      "noKey": "Ingen nøgle tilknyttet — denne flade kan ikke læse data, før der oprettes en til den.",
      "noNav": "Intern placering utilgængelig — byg denne flade igen med det aktuelle toolkit, så den udsender surface.json.",
      "placementExternal": "Ekstern (kun egen URL)",
      "placementInternal": "I sidepanelet (indlejret)",
      "placementLabel": "Placering",
      "staff": "Medarbejder",
      "subtitle": "En medarbejderflade kan glide ind i dette dashboards sidepanel eller stå for sig selv; en kundeflade er offentlig og læser gennem sin tilknyttede nøgle.",
      "title": "Flader"
    },
    "title": "Hostede apps",
    "update": {
      "title": "Opdatér {app} til v{version}",
      "subtitle": "Denne version kræver tabeller, som den installerede ikke havde.",
      "body": "De oprettes i den database, appen allerede bruger. Tabeller, der allerede findes, ændres ikke.",
      "cancel": "Annullér",
      "confirm": "Opdatér",
      "close": "Luk",
      "done": "{app} opdateret til v{version}",
      "missingColumns": "Mangler: {tables}.",
      "checkSubtitle": "Tjek de tabeller, denne version bruger.",
      "pickFirst": "Vælg, hvad der skal ske med {table}, før du opdaterer.",
      "checkFirst": "Tjek tabellerne igen, før du opdaterer.",
      "nothingYet": "Intet ændres, før du trykker på Opdater."
    },
    "veto": {
      "title": "Denne installation kan ikke gennemse online",
      "body": "Indstillingen er gemt, men netværksfunktioner er slået fra på denne server, og det vejer tungest. Installerede apps virker fortsat, og du kan stadig selv uploade en."
    },
    "columns": {
      "title": "Opdater {app} til v{version}",
      "subtitle": "Denne version skal bruge kolonner, som tabeller i din database ikke har endnu.",
      "body": "Adminium kan tilføje dem for dig. Du ser den præcise sætning, før noget køres, intet fjernes, og appen opdateres først, når kolonnerne findes.",
      "alsoCreates": "Opdateringen opretter også disse tabeller:",
      "noDdl": "Adminium kan ikke tilføje disse kolonner her",
      "failed": "Kolonnerne kunne ikke tilføjes",
      "valuesFailed": "Kolonnerne blev tilføjet, men deres tilladte værdier kunne ikke gemmes",
      "confirm": "Tilføj kolonnerne og opdater"
    },
    "rename": {
      "title": "Omdøb tabeller til {prefix}…",
      "subtitle": "{count, plural, one {# tabel i {connection}} other {# tabeller i {connection}}}",
      "close": "Luk",
      "body": "Denne installation blev lavet før præfikser. Omdøbningen giver hver tabel appens præfiks, så {app} kan genkende sine egne tabeller.",
      "planFailed": "Omdøbningen kunne ikke planlægges",
      "refused": "Disse tabeller kan ikke omdøbes her",
      "failed": "Tabellerne blev ikke omdøbt",
      "repair": "Adminium opdaterer også sine egne sider og regler, der peger på de gamle navne.",
      "cancel": "Annuller",
      "confirm": "Omdøb tabeller"
    }
  },
  "hub": {
    "action": {
      "delete": "Slet",
      "pause": "Sæt på pause",
      "pausedHint": "Denne forbindelse er sat på pause – genoptag den for at nå databasen.",
      "regional": "Regionale indstillinger",
      "reintrospect": "Introspicer igen",
      "reintrospectFile": "Skemafil-kilder har ingen aktiv database — upload filen igen i stedet.",
      "remap": "Ommap skema",
      "rename": "Omdøb",
      "resume": "Genoptag",
      "test": "Test"
    },
    "card": {
      "lastIntrospected": "Senest introspiceret",
      "latency": "Latenstid",
      "latencyMs": "{latency, number} ms",
      "never": "Aldrig",
      "pages": "Sider",
      "paused": "Adminium opretter ikke forbindelse til denne database. Dens sider indlæses igen, når du genoptager den.",
      "pausedSince": "Sat på pause {when} – Adminium opretter ikke forbindelse til denne database. Dens sider indlæses igen, når du genoptager den.",
      "readOnly": "Skrivebeskyttet",
      "tables": "Tabeller",
      "timezone": "Tidszone",
      "timezoneGuessed": "fra denne server",
      "timezoneNone": "ikke angivet — datoer vises i {zone}, denne servers zone"
    },
    "connectNew": "Ny forbindelse",
    "delete": {
      "body": "Dette sletter “{name}” og de genererede sider. Selve din database røres aldrig.",
      "cancel": "Annuller",
      "close": "Luk",
      "confirm": "Slet forbindelse",
      "failed": "Forbindelsen kunne ikke slettes. Prøv igen.",
      "prompt": "Skriv {name} for at bekræfte",
      "success": "Forbindelsen “{name}” er slettet",
      "title": "Slet forbindelse",
      "forbidden": "Din rolle omfatter ikke administration af forbindelser, så denne blev ikke slettet.",
      "liveKeys": {
        "body": "Sider, der bygger på disse nøgler, ville holde op med at virke. Tilbagekald dem først på siden Offentligt API, og slet derefter forbindelsen.",
        "title": "Publicerbare nøgler bruger stadig denne forbindelse"
      }
    },
    "empty": {
      "body": "Forbind en database, så genererer Adminium dit adminpanel ud fra dens skema.",
      "cta": "Forbind en database",
      "title": "Ingen datakilder endnu"
    },
    "hostedApps": "Hostede apps",
    "introspect": {
      "failed": "Introspektion mislykkedes. Prøv igen.",
      "masksProposed": "{count, plural, one {# kolonne} other {# kolonner}} foreslået til maskering — gennemgå i ommapnings-editoren.",
      "noChanges": "Skemaet er uændret — intet nyt snapshot.",
      "updated": "Skemaet er introspiceret igen"
    },
    "pause": {
      "body": "Adminium åbner ikke længere nogen forbindelse til “{name}”. {pages, plural, one {# side} other {# sider}}, planlagte rapporter og hostede apps holder op med at indlæse data, indtil du genoptager den.",
      "confirm": "Sæt forbindelsen på pause",
      "keeps": "Intet slettes – forbindelsen, dens skema og {pages, plural, one {dens # side} other {dens # sider}} bevares alle, og ét klik henter dem tilbage.",
      "pauseFailed": "Forbindelsen kunne ikke sættes på pause. Prøv igen.",
      "pausedToast": "Forbindelsen “{name}” er sat på pause",
      "resumeFailed": "Forbindelsen kunne ikke genoptages. Prøv igen.",
      "resumedToast": "Forbindelsen “{name}” er genoptaget",
      "title": "Sæt denne forbindelse på pause?"
    },
    "regional": {
      "currency": "Valuta",
      "currencyHelper": "Bruges til at formatere beløb. Valgfri — undlader du den, påvirker det kun formateringen.",
      "currencyPlaceholder": "ISO-4217-kode",
      "failed": "De regionale indstillinger kunne ikke gemmes",
      "guessedBody": "Adminium hentede den fra den maskine, det kører på — ingen her har valgt den. Gem for at bekræfte den, eller vælg den tidszone, virksomheden faktisk arbejder i.",
      "guessedTitle": "Denne tidszone kom fra serveren",
      "intro": "De beskriver den virksomhed, databasen tilhører — ikke den, der læser. Apps, der leveres af Adminium, henter dem her.",
      "noMatch": "Ingen matchende zone",
      "noMatchCurrency": "Ingen matchende valuta",
      "notSet": "Ikke angivet",
      "save": "Gem",
      "saved": "Regionale indstillinger opdateret",
      "timezone": "Tidszone",
      "timezoneHelper": "Datoer og klokkeslæt vises i denne tidszone. Uden en falder Adminium-hostede apps tilbage til UTC og skriver det på skærmen.",
      "timezonePlaceholder": "Region/By",
      "title": "Regionale indstillinger"
    },
    "rename": {
      "failed": "Forbindelsen kunne ikke omdøbes",
      "helper": "Hvad denne database hedder i hele Adminium — kortet, sidepanelgruppen over dens sider og hver vælger, der tilbyder den. Selve databasen omdøbes ikke.",
      "label": "Navn",
      "save": "Omdøb",
      "saved": "Forbindelse omdøbt",
      "title": "Omdøb forbindelse"
    },
    "stats": {
      "connections": "Forbindelser",
      "healthy": "Sunde",
      "pages": "Genererede sider",
      "tables": "Inkluderede tabeller"
    },
    "status": {
      "connected": "Forbundet",
      "error": "Fejl",
      "paused": "Sat på pause",
      "testing": "Tester…",
      "unconfigured": "Kladde"
    },
    "subtitle": "{healthy, number} af {total, plural, one {# forbindelse} other {# forbindelser}} sunde",
    "subtitlePaused": "{healthy, number} af {total, plural, one {# forbindelse} other {# forbindelser}} sunde · {paused, number} sat på pause",
    "test": {
      "failed": "Forbindelsestest mislykkedes",
      "ok": "Forbindelsen er sund · {latency, number} ms"
    },
    "title": "Dataforbindelser"
  },
  "intent": {
    "analytics": {
      "description": "Dashboards, diagrammer og skrivebeskyttede tabeller. Ingen formularer, ingen skrivninger — hver rolle begrænset til Fremviser.",
      "title": "Skrivebeskyttet analyse"
    },
    "crud": {
      "description": "Én redigeringsside pr. tabel plus søgning og import/eksport — et minimalt hjem, ingen dashboards.",
      "title": "CRUD-tabeller"
    },
    "fullAdmin": {
      "description": "Dashboards, CRUD-sider, søgning, import og eksport — alt hvad dit skema understøtter.",
      "title": "Fuldt adminpanel"
    },
    "subtitle": "Formålet afgør, hvilke sider der genereres. Du kan ændre det senere — en ændring foreslår en regenerering, aldrig en stille omskrivning.",
    "support": {
      "description": "Køer, ticket- og kundedetaljesider først. Sletning slået fra som standard. (Kø-skabeloner lander i M7 — v1-sidesættet svarer til fuldt admin.)",
      "title": "Supportkonsol"
    },
    "title": "Hvad har du brug for?",
    "trust": "Vi læser kun dit skema — aldrig dine rækkedata under opsætningen.",
    "blank": {
      "description": "Generér ingenting. Forbind en database, og byg de sider, du vil have, én ad gangen.",
      "title": "Blankt lærred"
    }
  },
  "llmRuns": {
    "review": {
      "applied": {
        "body": "De accepterede forslag nedenfor er skrivebeskyttede.",
        "title": "Denne kørsel er blevet anvendt"
      },
      "apply": {
        "confirm": "Anvend ændringer",
        "empty": "Intet valgt at anvende.",
        "subtitle": "Disse ændringer skrives i én transaktion og kan fortrydes.",
        "title": "Anvend {n} forslag"
      },
      "applyFailed": "Intet blev anvendt",
      "applyUnknown": "Serveren sagde ikke hvorfor.",
      "bulk": {
        "acceptAll": "Accepter alle ≥ {pct}%",
        "clear": "Ryd markering",
        "thresholdAria": "Tillidstærskel for “Accepter alle”",
        "thresholdLabel": "Tillidstærskel"
      },
      "cat": {
        "copy": "mikrotekst",
        "dashboard": "dashboard",
        "enum": "enum",
        "group": "navigationsgruppe",
        "key": "nøglekolonner",
        "label": "etiket",
        "pii": "personoplysninger",
        "relation": "relation",
        "template": "sideskabelon",
        "widget": "widget"
      },
      "empty": {
        "body": "Denne kørsel gav ingen forslag til gennemgang.",
        "title": "Ingen forslag"
      },
      "error": {
        "title": "Kunne ikke indlæse denne kørsel"
      },
      "footer": {
        "apply": "Anvend {n} accepterede forslag",
        "count": "{n} forslag valgt",
        "failed": "Anvendelse mislykkedes"
      },
      "group": {
        "dashboards": "Dashboards og widgets",
        "enums": "Enum-semantik",
        "icons": "Ikoner",
        "keys": "Nøglekolonner",
        "labels": "Etiketter og oversættelser",
        "microcopy": "Mikrotekst",
        "navigation": "Navigation og domæner",
        "pii": "Personoplysninger og maskering",
        "relations": "Relationer",
        "templates": "Sideskabeloner"
      },
      "header": {
        "agree": "{n} enige",
        "byo": "BYO",
        "conflict": "{n} konflikt",
        "countsAria": "Antal forslag",
        "model": "Model",
        "new": "{n} nye",
        "pathByo": "Kopiér-indsæt",
        "pathDirect": "Direkte API",
        "rejects": "{n} afvisninger",
        "snapshot": "Øjebliksbillede",
        "title": "Gennemgå AI-forslag"
      },
      "notReady": {
        "body": "En kørsel skal være valideret, før dens forslag kan gennemgås. Generér eller indsæt et svar først.",
        "title": "Denne kørsel har endnu ingen forslag til gennemgang"
      },
      "row": {
        "acceptAria": "Accepter {noun}-forslag for {target}",
        "confidenceAria": "Tillid {pct}%",
        "hideTranslations": "Skjul oversættelser",
        "keptEdited": "bevaret – redigeret af dig",
        "noAi": "Intet AI-forslag",
        "rejectsCallout": "AI’en afviser en heuristisk beslutning – bekræft før accept.",
        "showTranslations": "Vis oversættelser"
      },
      "section": {
        "acceptedCount": "{n} accepteret",
        "selectAllAria": "Vælg alle i {group}"
      },
      "status": {
        "agree": "Stemmer overens",
        "conflict": "Konflikt",
        "heuristicOnly": "Kun heuristik",
        "locked": "Låst",
        "new": "Ny",
        "rejects": "Afviser heuristik"
      },
      "toast": {
        "applied": "Anvendte {n} forslag",
        "appliedPartial": "Anvendte {n} forslag (nogle sprunget over)",
        "applyFailed": "Kunne ikke anvende forslag",
        "undoFailed": "Kunne ikke fortryde denne ændring"
      },
      "value": {
        "absent": "Ingen",
        "dash": "—",
        "description": "Beskrivelse",
        "display": "Visning",
        "enumCategory": "Kategori",
        "enumWorkflow": "Arbejdsgang",
        "guidance": "Vejledning for tom tilstand",
        "headline": "Overskrift for tom tilstand",
        "key": "Nøgle",
        "label": "Etiket",
        "none": "Ingen værdi",
        "notPii": "Ikke personoplysninger",
        "rank": "rang {n}",
        "span": "bredde {n}",
        "subtitle": "Sideundertekst",
        "tableCount": "{n} tabeller",
        "widgetCount": "{n} widgets"
      }
    }
  },
  "meta": {
    "move": {
      "copying": "Flytter Adminiums tabeller …",
      "copyingBody": "Kopierer hver adminium_-tabel til den nye database. Dine kildedata røres ikke, og der skiftes først over, når kopien er verificeret.",
      "failed": "Kunne ikke flytte Adminiums tabeller — prøv igen.",
      "restarting": "Genstarter …",
      "restartingBody": "Kopien er færdig. Adminium genstarter på den nye database — denne side fortsætter af sig selv om få sekunder.",
      "timeout": "Adminium flyttede sine tabeller, men er ikke kommet tilbage endnu. Dine data er sikre i den nye database — genindlæs siden om et øjeblik.",
      "title": "Flytter Adminiums tabeller"
    },
    "sameDb": {
      "description": "adminium_*-tabeller oprettes ved siden af dine kildetabeller. Enkleste opsætning — kræver en rolle med skrive- og CREATE TABLE-rettigheder.",
      "disabledFile": "En skemafil har ingen live database — vælg en separat database til Adminiums egne tabeller.",
      "disabledNoDdl": "Denne rolle kan ikke køre DDL — Adminium-migreringer kræver CREATE TABLE. Vælg en separat database til Adminiums egne tabeller.",
      "disabledReadOnly": "Din rolle er skrivebeskyttet — Adminium skriver aldrig til denne database. Vælg en separat database til Adminiums egne tabeller.",
      "title": "Samme database"
    },
    "separate": {
      "description": "Adminium holder sine tabeller i en anden database. Din kilde forbliver urørt — påkrævet for skrivebeskyttede kilder.",
      "dsn": "Forbindelsesstreng til metadatabasen",
      "errorTitle": "Metalager ikke kompatibelt",
      "helper": "Kræver skrive- + DDL-rettigheder — Adminium kører sine egne migreringer dér.",
      "insufficient": "Denne rolle kan ikke huse metalageret — Adminium behøver skrive- og CREATE TABLE-rettigheder dér.",
      "ok": "Kompatibel — skrivning ✓ · DDL ✓",
      "test": "Test forbindelse",
      "title": "Separat database"
    },
    "subtitle": "Sider, roller, auditlog og indstillinger bor i tabeller med adminium_-præfiks — aldrig blandet med dine data.",
    "testFailed": "Forbindelsen mislykkedes.",
    "title": "Hvor skal Adminium gemme sine egne tabeller?",
    "v1Note": {
      "body": "Denne server gemmer allerede sine egne tabeller i en konfigureret database, og dette trin flytter dem ikke. Det validerer, at dit valg er kompatibelt med denne forbindelse — serveren håndhæver den samme regel uafhængigt (409 META_PLACEMENT_INVALID).",
      "title": "Om denne installation"
    },
    "willMove": {
      "body": "Adminium bruger i øjeblikket sit indbyggede SQLite-lager. Fortsæt kopierer det lager til den valgte database og genstarter på den — konti, sider og indstillinger følger med, så du forbliver logget ind.",
      "title": "Dette flytter Adminiums tabeller"
    }
  },
  "pages": {
    "action": {
      "delete": "Slet side",
      "duplicate": "Dupliker",
      "edit": "Rediger side",
      "hide": "Skjul fra sidepanelet",
      "show": "Vis i sidepanelet"
    },
    "attachments": {
      "accept": "Accepterede filtyper",
      "acceptHint": "Vælger du ingen, accepteres alt, hvad dette arbejdsområde tillader. Et valg her kan kun indsnævre listen, aldrig udvide den.",
      "column": {
        "adoptHint": "Denne tabel har allerede kolonnen, så der oprettes ikke noget — den bruges, som den er.",
        "bound": "Filer gemmes i denne tabels {column}-kolonne.",
        "boundHint": "Slår du vedhæftninger fra senere, frakobles kun denne side. Kolonnen og filerne i den røres ikke.",
        "confirm": "Kør den",
        "create": "Opret kolonnen",
        "createHint": "Adminium tilføjer én tekstkolonne til denne tabel. Du ser den præcise sætning, før noget kører.",
        "createdHint": "Kolonnen findes nu. Gem denne side for at gøre koblingen færdig.",
        "failed": "Det virkede ikke",
        "invalid": "Et kolonnenavn skal starte med et bogstav og må kun indeholde små bogstaver, cifre og understregninger.",
        "label": "Kolonne der indeholder filerne",
        "required": "Giv kolonnen et navn.",
        "tooLong": "Det navn er for langt til en kolonne.",
        "use": "Brug denne kolonne",
        "wrongType": "Tabellen har allerede en kolonne med det navn, og den kan ikke rumme en filreference. Vælg et andet navn."
      },
      "destination": "Hvor filerne havner",
      "destinationDefault": "Standarddestinationen",
      "destinationHint": "Lad den stå på standarden, medmindre denne tabels filer hører hjemme et andet sted.",
      "destinationIsDefault": "{name} (standarden)",
      "destinationLocal": "Denne servers disk",
      "enable": "Tillad vedhæftede filer på denne tabels poster",
      "enableHint": "Filerne knyttes til på Adminiums side, så denne tabel behøver ingen ny kolonne — det virker på en skrivebeskyttet forbindelse og på en tabel, du helst ikke vil ændre.",
      "enableHintColumn": "Filer gemmes i én kolonne på denne tabel, så de vises både i dialogerne Ny og Rediger og på hver post.",
      "enableHintSidecar": "Filer kobles i stedet på Adminiums side. De vises på hver posts side, ikke i dialogen Ny.",
      "maxBytes": "Største fil (MB)",
      "maxBytesHint": "Lad feltet stå tomt for at følge arbejdsområdets grænse. Et tal her kan kun sænke den.",
      "maxCount": "Flest filer pr. post",
      "maxCountHint": "Lad feltet stå tomt for at acceptere så mange, som en post har brug for.",
      "sidecar": {
        "noPrivilege": "Denne forbindelses rolle kan ikke ændre tabeller, så Adminium kan ikke tilføje en kolonne til den.",
        "readOnlyIntent": "Denne forbindelse er sat op til skrivebeskyttet analyse, så Adminium kan ikke tilføje en kolonne til den.",
        "readOnlyRole": "Denne forbindelse logger på med en skrivebeskyttet rolle, så Adminium kan ikke tilføje en kolonne til den.",
        "schemaFile": "Denne forbindelse blev oprettet ud fra en skemafil, så Adminium kan ikke tilføje en kolonne til den."
      },
      "type": {
        "office": "Office-dokumenter",
        "text": "Almindelig tekst"
      }
    },
    "columns": {
      "addFromLinked": "Fra linkede tabeller",
      "addFromTable": "Fra {table}",
      "addLinkedFrom": "Tabeller, der linker hertil",
      "addLinkedFromHelp": "Tæl rækkerne, der peger på hver post, eller læg et af deres tal sammen.",
      "addLinkedHelp": "Vis en værdi fra den tabel, som en linkkolonne peger på.",
      "addNoMatches": "Ingen kolonner matcher “{query}”.",
      "addOpen": "Tilføj kolonne",
      "addSearch": "Søg i kolonner…",
      "addTitle": "Tilføj en kolonne",
      "addVia": "via {column}",
      "avatar": "Avatar",
      "avatarToggle": "Vis et monogram ved siden af {name}",
      "countBadge": "Antal",
      "dragHandle": "Flyt {name}",
      "empty": "Ingen kolonner endnu — tilføj dem nedenfor.",
      "file": {
        "acceptHelp": "Lad alle typer være slået fra for at acceptere det, dette arbejdsområde accepterer. Vælger du typer, kan det kun indsnævre listen — en kolonne kan aldrig acceptere en type, arbejdsområdet afviser.",
        "acceptLabel": "Accepterede typer",
        "badge": "Fil",
        "destinationDefault": "Standarddestinationen",
        "destinationHelp": "Hvor de bytes, der uploades gennem denne kolonne, opbevares.",
        "destinationLabel": "Destination",
        "inlineHelp": "Kun billeder tegnes i cellen. Alt andet forbliver et mærke med sit navn og sin størrelse, uanset hvad der er valgt her.",
        "inlineLabel": "Vis den i tabellen",
        "maxCountHelp": "Lad feltet stå tomt for at acceptere så mange, som en post har brug for.",
        "maxCountLabel": "Højst antal filer pr. post",
        "maxCountToggle": "Højst antal filer for {name}",
        "maxHelp": "Lad feltet stå tomt for at bruge arbejdsområdets grænse. En kolonne kan kun bede om mindre.",
        "maxLabel": "Største fil (MB)",
        "maxToggle": "Største fil, {name} accepterer, i MB",
        "multipleHelp": "Kolonnen gemmer en liste af filer i stedet for én. Eksisterende enkeltværdier virker fortsat — de læses som en liste med ét element.",
        "multipleLabel": "Rumme mere end én fil",
        "ref": {
          "id": "Adminiums fil-id",
          "key": "Nøglen i destinationen",
          "url": "Et link til filen"
        },
        "refHelp": "Det, der skrives i denne kolonne, når en fil uploades. Værdier, der allerede er gemt, virker fortsat — dette ændrer kun den næste.",
        "refLabel": "Gemt værdi",
        "refTooNarrow": "Denne kolonne er for kort til at rumme den værdi. Vælg en, den kan rumme, eller gør kolonnen bredere i databasen.",
        "refWidth": "{shape} — kræver {needs} tegn, denne kolonne rummer {holds}",
        "switch": "Fil",
        "switchToggle": "{name} gemmer en fil",
        "type": {
          "csv": "CSV",
          "gif": "GIF",
          "heic": "HEIC",
          "jpeg": "JPEG",
          "json": "JSON",
          "markdown": "Markdown",
          "mp3": "MP3-lyd",
          "mp4": "MP4-video",
          "office": "Office-dokumenter",
          "ogg": "Ogg",
          "pdf": "PDF",
          "png": "PNG",
          "svg": "SVG",
          "text": "Almindelig tekst",
          "wav": "WAV-lyd",
          "webm": "WebM",
          "webp": "WebP",
          "zip": "ZIP"
        }
      },
      "fold": {
        "avg": "Gennemsnit",
        "max": "Maks",
        "min": "Min",
        "sum": "Sum"
      },
      "foldAdd": "Tilføj",
      "foldLabel": "Aggregering",
      "followColumn": "Følg {name}",
      "header": "Overskrift for {name}",
      "help": "Træk for at omarrangere kolonner, omdøb deres overskrifter, og vælg hvilke der vises i tabellen.",
      "lookupBack": "Tilbage",
      "lookupBadge": "Sammenkædet",
      "lookupBroken": "Kæden kan ikke længere følges",
      "lookupBrokenBody": "Skemaet ændrede sig undervejs. Start kæden forfra.",
      "lookupBrowse": "Vælg hvad der skal vises fra {table}",
      "mask": "Maskér",
      "maskHelp": "Maskering skjuler en værdi bag en vis-knap for læsere, der må se den. Om data overhovedet forlader databasen, indstilles på forbindelsen, ikke her.",
      "maskToggle": "Skjul {name} bag en vis-knap",
      "masked": "Maskeret",
      "none": {
        "body": "Kolonner læses fra tabellen, når siden genereres. Knyt siden til en tabel og generer igen for at udfylde dem.",
        "title": "Denne side har ingen kolonner endnu"
      },
      "pk": "Nøgle",
      "remove": "Fjern {name}",
      "schemaUnavailable": "Databasens kolonner kunne ikke hentes, så kolonner kan ikke tilføjes her.",
      "shown": "Vist",
      "toggle": "Vis {name} i tabellen"
    },
    "create": {
      "failed": "Siden kunne ikke oprettes",
      "submit": "Opret side",
      "subtitle": "Vælg hvad siden viser, og hvordan den ser ud. Forhåndsvisningen følger dine valg.",
      "title": "Ny side"
    },
    "createButton": "Ny side",
    "delete": {
      "body": "Dette kan ikke fortrydes. Gemte visninger og personlige layouts på denne side slettes for alle.",
      "bodyGenerated": "Denne side stammer fra skemagenerering, så den kommer igen næste gang du genererer. Gemte visninger og personlige layouts slettes for alle.",
      "confirm": "Slet side",
      "prompt": "Skriv {slug} for at bekræfte",
      "title": "Slet denne side?",
      "failed": "Siden blev ikke slettet"
    },
    "derived": {
      "add": "Tilføj kolonne",
      "atLeast": "er mindst",
      "cancel": "Annuller",
      "emptyBody": "Opsummer først en forbundet tabel i Kolonner-kortet — reglerne her bygger på de tal.",
      "emptyTitle": "Ingen beregnede tal endnu",
      "fieldBadge": "Beregnet",
      "foldBadge": "Opsummering",
      "help": "Beregn tal ud fra oversigterne ovenfor og denne posts egne kolonner. De beregnes, når siden indlæses, og kan ikke sorteres.",
      "label": "Kolonneoverskrift",
      "minus": "minus",
      "numberHelp": "Tal er almindelige decimaler — 500 eller 12.50, aldrig 1,000 eller 5e3.",
      "operandA": "Tal",
      "operandB": "Tal",
      "operator": "Operator",
      "otherwise": "ellers",
      "percentOf": "procent fra denne post",
      "plus": "plus",
      "preset": {
        "combine": "Læg to tal sammen eller træk fra",
        "percent": "Procent af et tal",
        "rule": "Regel med en tærskel"
      },
      "previewHelp": "Eksempelværdier, beregnet af den samme kode, som siden bruger.",
      "previewTitle": "Forhåndsvisning",
      "remove": "Fjern {name}",
      "thenShow": "så vis"
    },
    "duplicate": {
      "failed": "Siden kunne ikke duplikeres",
      "submit": "Dupliker",
      "title": "Dupliker side"
    },
    "editor": {
      "appearance": "Udseende",
      "attachments": "Vedhæftede filer",
      "columns": "Kolonner",
      "contentInvalid": "Denne sides konfiguration kan ikke læses",
      "contentInvalidBody": "Den er skrevet af en nyere version, eller den er ugyldig. Generer siden igen, eller slet den.",
      "contentUnavailable": "Sidens indhold kunne ikke indlæses",
      "contentUnavailableBody": "Oplysningerne ovenfor kan stadig gemmes.",
      "data": "Data",
      "derived": "Afledte tal",
      "details": "Detaljer",
      "generated": {
        "body": "Dine ændringer bevares, når du genererer igen — siden markeres som redigeret og røres ikke. En sletning holder derimod kun, indtil næste generering opretter den på ny.",
        "title": "Denne side blev genereret ud fra dit skema"
      },
      "itemsPending": "Gem først ændringen ovenfor — sidens indhold bygges op igen ud fra den nye skabelon og tabel.",
      "missing": "Denne side findes ikke længere",
      "missingBody": "Den er måske slettet eller fjernet af en generering.",
      "notBindable": "Denne skabelon er ikke knyttet til én tabel",
      "notBindableBody": "Dens indhold bygges widget for widget i stedet. Åbn siden, og brug “Rediger” til at tilføje dem.",
      "openPage": "Åbn side",
      "recompose": "Denne side bliver bygget om",
      "recomposeBody": "Når du gemmer, erstattes indholdet af et nyt layout for skabelonen og tabellen ovenfor. Kolonnetilpasninger og widget-ændringer på siden går tabt.",
      "save": "Gem ændringer",
      "saveFailed": "Ændringerne kunne ikke gemmes",
      "schemaFailed": "Tabellerne kunne ikke vises",
      "schemaFailedBody": "Denne forbindelse er måske ikke analyseret endnu. Kør introspektion fra Studio → Dataforbindelser.",
      "title": "Rediger side"
    },
    "empty": {
      "body": "Forbind en database for at generere sider automatisk, eller opret en i hånden.",
      "title": "Ingen sider endnu"
    },
    "field": {
      "connection": "Datakilde",
      "connectionNone": "Ingen",
      "group": "Gruppe i sidepanelet",
      "groupHint": "Hvilken del af sidepanelet den vises i.",
      "icon": "Ikon",
      "iconHint": "Vises ved siden af sidens navn i sidepanelet.",
      "iconPick": "Vælg sidens ikon",
      "newRowLabel": "Tilføj-knap",
      "newRowLabelHint": "Hvad der står på knappen, der tilføjer en post. Lad feltet stå tomt for at bruge standardteksten, som er oversat.",
      "padding": "Sidemargen",
      "slug": "Sideadresse",
      "slugHint": "Små bogstaver, tal og bindestreger. Kun den sidste del — resten af adressen tilføjer vi.",
      "slugTaken": "En anden side bruger allerede denne adresse.",
      "slugWarning": "Ændrer du adressen, går eksisterende links og bogmærker til siden i stykker.",
      "table": "Tabel",
      "tableChoose": "Vælg en tabel…",
      "tableCreateHint": "Tabellen som denne side læser fra.",
      "tableNeedsConnection": "Vælg en datakilde først.",
      "tableNoConnection": "Forbind en database først — denne side bygges ud fra en af dens tabeller.",
      "tableNone": "Ikke knyttet",
      "template": "Skabelon",
      "templateHint": "Afgør hvad siden kan indeholde. Kan ændres senere.",
      "title": "Titel",
      "titleHint": "Vises i sidepanelet og i sidens overskrift.",
      "visible": "Vis i sidepanelet",
      "visibleHint": "En skjult side kan stadig tilgås på sin URL af alle med linket.",
      "width": "Indholdsbredde",
      "widthHint": "Hvor bred sidens indholdskolonne må blive på en stor skærm.",
      "groupApp": "I sin apps egen sektion"
    },
    "filters": {
      "add": "Tilføj et filter",
      "control": "Kontrol til {column}",
      "down": "Flyt {column} ned",
      "empty": "Denne side har ingen filtre. Tilføj et nedenfor.",
      "full": "En side viser højst {max} filtre.",
      "name": "Navn til {column}",
      "remove": "Fjern {column}-filter",
      "reset": "Tilbage til de foreslåede filtre",
      "subtitle": "De spørgsmål, værktøjslinjen kan stille om denne tabel. Urørt følger den tabellen.",
      "title": "Filtre",
      "up": "Flyt {column} op"
    },
    "fit": {
      "alternatives": {
        "title": "Brug en tabel, der allerede passer",
        "help": "Der skrives intet til din database — siden peges blot på en tabel, der allerede har det nødvendige.",
        "use": "Brug denne tabel"
      },
      "checkFailed": "Adminium kunne ikke tjekke denne tabel",
      "checkFailedBody": "Du kan stadig oprette siden. Hvis tabellen ikke kan bære den, siger oprettelsen det.",
      "columns": {
        "title": "Tilføj det, der mangler, til denne tabel",
        "help": "Adminium tilføjer disse kolonner til din tabel. Du ser den nøjagtige sætning, før noget køres, og intet fjernes.",
        "review": "Se ændringen",
        "confirm": "Kør den",
        "failed": "Det virkede ikke",
        "partial": "Én af de ting, siden mangler, kan ikke tilføjes for dig, så den vil stadig være ufuldstændig bagefter.",
        "cannot": "Den her kan Adminium ikke tilføje for dig",
        "cannotBody": "Denne side skal bruge en henvisning til en anden tabel, som skal sættes op under Studio → Skema.",
        "halfDone": "Kolonnerne blev tilføjet, men Adminium kunne ikke notere, hvad de betyder",
        "halfDoneBody": "Intet skal køres igen — kolonnerne findes. Angiv deres betydning under Studio → Skema, eller bed en administrator om det."
      },
      "needs": "For at bygge siden mangler tabellen:",
      "noDdl": "Adminium kan ikke ændre denne tabel for dig",
      "role": {
        "eventDate": "en dato på hver række",
        "title": "en tekstkolonne, der vises som hver rækkes titel",
        "status": "en statuskolonne, hvis værdier beskriver arbejdstrin",
        "personFk": "en henvisning til en tabel med personer",
        "shiftType": "en kolonne, der angiver hvilken slags vagt hver række er"
      },
      "slotOnly": "Intet i denne tabel kan udfylde området “{slot}”.",
      "tag": {
        "title": "Brug en kolonne, du allerede har",
        "help": "Dette noterer kun, hvad kolonnen betyder. Din database ændres ikke, og du kan fortryde det under Studio → Skema.",
        "action": "Brug denne kolonne",
        "failed": "Kolonnen kunne ikke markeres"
      },
      "title": "Denne tabel kan endnu ikke bære denne side",
      "table": {
        "title": "Opret en ny tabel til denne side",
        "help": "Adminium opretter en tabel med alt, hvad denne side har brug for. Du ser den præcise sætning, før noget køres, og dine andre tabeller røres ikke.",
        "open": "Eller opret en ny tabel til denne side",
        "name": "Tabelnavn",
        "nameTaken": "Der findes allerede en tabel med dette navn.",
        "nameInvalid": "Brug små bogstaver, tal og understreger, og start med et bogstav.",
        "people": "Tildel hver række til en person fra",
        "peopleNew": "En ny tabel med personer",
        "peopleCreated": "Opretter også “{table}”, en lille tabel over de personer, rækkerne tildeles.",
        "noCompose": "En tabel med dette navn ville ikke virke til denne side. Prøv et andet navn.",
        "confirm": "Opret tabellen",
        "noDdl": "Adminium kan ikke oprette en tabel her",
        "halfDone": "Tabellen blev oprettet, men Adminium kunne ikke gemme, hvad dens kolonner betyder",
        "halfDoneBody": "Intet skal køres igen — tabellen findes. Angiv kolonnernes betydning i Studio → Skema, eller bed en administrator om det.",
        "notReread": "Tabellen blev oprettet, men Adminium kunne ikke læse den ind igen endnu",
        "notRereadBody": "Intet skal køres igen. Opdater skemaet fra Studio → Dataforbindelser, og vælg derefter den nye tabel her."
      },
      "related": {
        "title": "Brug datoerne fra en tilknyttet tabel",
        "help": "Der skrives intet til din database. Siden bygges på en tabel, der er knyttet til denne, og hver post viser et navn fra denne tabel.",
        "reason": "Datoer fra “{date}”, hver med titlen “{title}” via “{via}”",
        "chosen": "Bygget på {table}, hver post med titlen “{title}” fra {from}",
        "undo": "Gå tilbage til {table}"
      }
    },
    "form": {
      "addLines": "{label} som linjer",
      "dialog": {
        "cta": "Knap",
        "ctaIcon": "Knapikon",
        "iconDefault": "Standard",
        "subtitle": "Undertitel",
        "title": "Dialogtitel",
        "titleHelp": "Tom bruger de genererede ord."
      },
      "field": {
        "availability": "Optaget når",
        "availabilityAny": "En hvilken som helst række har det tidspunkt",
        "availabilityHelp": "En anden række har samme tidspunkt. Vælg en kolonne for at indsnævre til ét lokale, én person, én maskine. Uden den vises intet som optaget.",
        "availabilityOff": "Tjek ikke",
        "control": "Kontrol",
        "down": "Flyt {name} ned",
        "drag": "Omarrangér {name}",
        "help": "Hjælpetekst",
        "initial": "Startværdi",
        "initialHelp": "Det, en NY post starter med. En redigering anvender den aldrig.",
        "initialLiteral": "En fast værdi",
        "initialNone": "Ingenting",
        "initialNow": "Dato og klokkeslæt nu",
        "initialToday": "I dag",
        "initialUser": "Den, der er logget ind",
        "initialValue": "Værdien",
        "label": "Etiket",
        "placeholder": "Pladsholder",
        "recap": "Opsummering",
        "recapHelp": "En opsummeringsboks. Dens tekst redigeres indtil videre i sidens JSON.",
        "remove": "Fjern {name}",
        "required": "Spørg efter det",
        "requiredHelp": "Formularen gemmer ikke uden det. Hvad DATABASEN kræver, sættes i Skema.",
        "ruleChecks": "der gælder ekstra tjek",
        "ruleDatabase": "databasen udfylder det",
        "ruleFilled": "Adminium udfylder det",
        "ruleList": "kun værdier fra listen {key}",
        "ruleRequired": "databasen kræver det",
        "ruleValues": "kun et fast sæt værdier",
        "rules": "Denne kolonne: {rules}.",
        "rulesLink": "Ret i Skema",
        "settings": "Indstillinger for {name}",
        "slotsEnd": "til",
        "slotsEvery": "hver",
        "slotsHelp": "Lad tiderne stå tomme for kun at vælge dag.",
        "slotsStart": "Tider fra",
        "span": "Bredde",
        "spanHelp": "Hvor mange af sektionens kolonner feltet fylder.",
        "up": "Flyt {name} op"
      },
      "gallery": {
        "choice": {
          "body": "Valgbare valgkort, en pille-kontakt og en skyder.",
          "title": "Valgkort"
        },
        "multi": {
          "body": "E-mail-chips, rollevalg, liste med tilladelser.",
          "title": "Flere indtastninger"
        },
        "quick": {
          "body": "Ét titelfelt med meta-piller på linjen. Ingen sektionsramme.",
          "title": "Hurtig oprettelse"
        },
        "repeater": {
          "body": "En reference, gentagelige linjer og løbende totaler.",
          "title": "Gentagelse og totaler"
        },
        "sectioned": {
          "body": "Lang post delt op i navngivne sektioner med et rullende felt.",
          "title": "Sektioner"
        },
        "segmented": {
          "body": "Segmenteret prioritet, lang beskrivelse, vedhæftningsliste, ansvarlig.",
          "title": "Segmenter og filer"
        },
        "split": {
          "body": "To ruder: det første afsnit ved siden af resten. Lavet til en kalender.",
          "title": "Delt rude"
        },
        "upload": {
          "body": "Medie-dropzone, valutafelter, tag-chips og en udgiv-kontakt.",
          "title": "Upload og chips"
        },
        "wizard": {
          "body": "Trin-for-trin-guide med statusskinne og Tilbage/Næste-fod.",
          "title": "Guide"
        }
      },
      "missing": {
        "title": "Ikke på denne formular. En kolonne, databasen kræver, tilføjes automatisk, når dialogen åbnes."
      },
      "preview": "Forhåndsvis",
      "previewEntity": "post",
      "reset": "Nulstil til genereret",
      "section": {
        "add": "Tilføj en sektion",
        "columnCount": "{count} kolonner",
        "columns": "Kolonner",
        "empty": "Ingen felter her endnu — flyt et herind, eller tilføj et nedenfor.",
        "label": "Sektionsnavn",
        "remove": "Fjern denne sektion",
        "unnamed": "Unavngiven sektion"
      },
      "subtitle": "Det, dialogerne Ny og Rediger viser. Urørt følger den tabellen.",
      "title": "Opret-formular"
    },
    "icon": {
      "noMatches": "Ingen ikoner matcher den søgning.",
      "none": "Vælg et ikon",
      "search": "Søg efter ikoner"
    },
    "list": {
      "count": "{count, plural, one {# side} other {# sider}}",
      "title": "Sider"
    },
    "loadFailed": {
      "body": "Sidestyring kræver tilladelsen “Administrer sider”. Bed en administrator om at give den til en af dine roller.",
      "title": "Siderne kunne ikke indlæses"
    },
    "origin": {
      "generated": "Genereret",
      "llm": "Assistent",
      "manifest": "Tilføjelse",
      "project": "Projektkode",
      "system": "System",
      "user": "Egen"
    },
    "padding": {
      "custom": "Tilpasset…",
      "default": "Standard for denne skabelon",
      "none": "Ingen",
      "standard": "Standard (28 × 24)",
      "x": "Sider (px)",
      "y": "Top og bund (px)"
    },
    "preview": {
      "note": "En illustration af layoutet, ikke dine data. Den rigtige side fyldes ud, når den er gemt.",
      "untitled": "Side uden titel"
    },
    "project": {
      "badge": {
        "changed": "Ændret på serveren",
        "conflict": "Konflikt",
        "outside": "Ikke i projektet"
      },
      "changed": {
        "body": "Hent ændringerne ind i dit projekt og udrul det, ellers findes de kun på denne server:",
        "title": "{count, plural, one {# side er ændret på denne server} other {# sider er ændret på denne server}}"
      },
      "conflicts": {
        "body": "Denne server beholder sin egen version, indtil du vælger en.",
        "title": "{count, plural, one {# side er ændret både her og i projektet} other {# sider er ændret både her og i projektet}}"
      },
      "fromCode": "Denne side kommer fra {source}. Ret den dér.",
      "invalid": {
        "body": "Ret disse filer. Indtil da bruges den seneste gyldige version.",
        "title": "{count, plural, one {# projektfil blev ikke anvendt} other {# projektfiler blev ikke anvendt}}"
      },
      "keepServer": "Behold serverens version",
      "notConfigured": "Nogle af dem hører til en database, som projektet ikke nævner. Tilføj den i adminium.config.ts for at beholde dens sider i projektet.",
      "outside": {
        "body": "De findes kun på denne server. Hent dem ind i projektet for at beholde dem:",
        "title": "{count, plural, one {# side er ikke i projektet} other {# sider er ikke i projektet}}"
      },
      "resolveFailed": "Det kunne ikke ændres.",
      "useProject": "Brug projektets version"
    },
    "row": {
      "menu": "Handlinger for {title}"
    },
    "sidebar": {
      "discard": "Kassér",
      "emptyGroup": "Ingen sider i denne gruppe.",
      "help": "Omarranger sider inden for en gruppe, eller flyt en til en anden gruppe. Ændringerne gælder for alle.",
      "moveDown": "Flyt {title} ned",
      "moveTo": "Flyt {title} til en gruppe",
      "moveUp": "Flyt {title} op",
      "save": "Gem rækkefølge",
      "saveFailed": "Den nye rækkefølge kunne ikke gemmes",
      "ungrouped": {
        "body": "Siderne virker på deres URL, men vises ingen steder i sidepanelet. Åbn hver enkelt og vælg en gruppe.",
        "title": "Nogle sider hører ikke til nogen gruppe"
      },
      "apps": {
        "title": "I installerede apps’ sektioner",
        "body": "Hver app har sine sider i sin egen sektion af sidepanelet."
      }
    },
    "status": {
      "hidden": "Skjult",
      "live": "Aktiv"
    },
    "subtitle": "Tilføj, rediger og organiser din apps sider — og den rækkefølge de vises i sidepanelet.",
    "tab": {
      "pages": "Alle sider",
      "sidebar": "Rækkefølge i sidepanelet"
    },
    "title": "Sider",
    "width": {
      "content": "Indhold (900 px)",
      "dash": "Dashboard (1320 px)",
      "default": "Standard for denne skabelon",
      "full": "Fuld bredde (ingen grænse)",
      "narrow": "Smal (720 px)",
      "page": "Side (1080 px)",
      "wide": "Bred (1800 px)"
    },
    "toggleFailed": "Siden blev ikke ændret"
  },
  "project": {
    "actions": {
      "bulk": "En eller flere poster",
      "empty": "Ingen handlinger. En fil i actions/ sætter en knap på poster.",
      "needs": "Kræver: {permission}",
      "single": "Én post",
      "title": "Handlinger"
    },
    "changes": {
      "empty": "Alle side- og skemafiler stemmer med denne server.",
      "open": "Løs det under Sider",
      "title": "Ændret på denne server"
    },
    "code": {
      "disabled": "Ikke indlæst: skrivebordsappen kører aldrig projektkode",
      "label": "Projektkode",
      "loaded": "Indlæst {when}",
      "none": "Intet indlæst"
    },
    "failures": {
      "empty": "Ingen hook er fejlet, siden serveren startede.",
      "title": "Hook-fejl"
    },
    "files": {
      "count": "{count, plural, one {# fil} other {# filer}}",
      "pages": "Sidefiler",
      "schema": "Skemafiler",
      "title": "Filer"
    },
    "folder": "Mappe",
    "hooks": {
      "empty": "Ingen hooks. En fil i hooks/ kører kode, når poster ændres.",
      "onImport": "Også ved CSV-import",
      "title": "Hooks"
    },
    "loadFailed": "Projektet kunne ikke indlæses",
    "mode": {
      "dev": "Udvikling: mappen og Studio holdes i takt",
      "label": "Kører som",
      "server": "Server: mappen ændres kun ved en udrulning"
    },
    "none": {
      "body": "Et projekt er en mappe oprettet med `npx @adminiumjs/adminium new`. Dets sider, hooks og handlinger vises her, når serveren kører det.",
      "title": "Denne server kører intet projekt"
    },
    "pages": {
      "empty": "Ingen sider. En .tsx-fil i pages/ tilføjer en side, du selv har skrevet.",
      "hidden": "Ikke i sidepanelet",
      "title": "Sider"
    },
    "permission": {
      "create": "Tilføje",
      "delete": "Slette",
      "read": "Se",
      "update": "Redigere"
    },
    "problems": {
      "body": "Ret disse filer. Resten af projektkoden kører.",
      "title": "{count, plural, one {# fil blev ikke indlæst} other {# filer blev ikke indlæst}}"
    },
    "status": {
      "changed": "Ændret på denne server",
      "conflict": "Konflikt",
      "invalid": "Ugyldig",
      "outside": "Ikke i projektet",
      "pending": "Ikke anvendt endnu"
    },
    "subtitle": "Projektmappen, som denne server kører, og den kode, den har indlæst.",
    "superAdminOnly": "Kun en superadministrator kan se det projekt, som denne server kører.",
    "title": "Projekt",
    "version": "Adminium",
    "widgets": {
      "card": "Dashboardkort",
      "cell": "Tabelcelle",
      "empty": "Ingen widgets. En fil i widgets/ tilføjer en tabelcelle eller et dashboardkort.",
      "title": "Widgets"
    }
  },
  "publicApi": {
    "cancel": "Annuller",
    "close": "Luk",
    "error": "Noget gik galt",
    "keys": {
      "appHint": "Appens kundeflade serverer så selv denne nøgle — rotation kræver ingen ny build.",
      "appLabel": "Tilknyt en hostet app-flade (valgfrit)",
      "appNone": "Ikke tilknyttet",
      "create": "Opret nøgle",
      "emptyBody": "Opret først et scope, og opret så en nøgle til det.",
      "emptyTitle": "Ingen nøgler endnu",
      "formLabel": "Opret en nøgle",
      "nameLabel": "Navn",
      "reveal": "Vis nøgle",
      "revoke": "Tilbagekald",
      "rotate": "Rotér",
      "scopeIsAuthBody": "En nøgle kan nå præcis det, der står i dens scope, og intet andet. Den bruger hverken roller eller tabeltilladelser, og den kan ikke læse noget gennem resten af API’et.",
      "scopeIsAuthTitle": "Scopet er den eneste tilladelse",
      "scopeLabel": "Scope",
      "scopePlaceholder": "Vælg et scope",
      "subtitle": "De ligger i din sides JavaScript, så alle kan læse dem. Sådan skal det være — en nøgle kan aldrig gøre andet end det, dens scope tillader.",
      "title": "Nøgler"
    },
    "notRegistered": {
      "body": "Sæt ADMINIUM_PUBLIC_API_ORIGINS til de præcise origins, der må kalde det, og genstart så. Indtil da serveres disse ruter slet ikke.",
      "title": "Ikke slået til på denne server"
    },
    "origins": {
      "label": "Origins, der må kalde det"
    },
    "scopes": {
      "connectionLabel": "Forbindelses-id",
      "create": "Opret scope",
      "delete": "Slet",
      "deleteConfirm": "Slet scope",
      "deletePrompt": "Skriv scopets navn for at bekræfte",
      "deleteTitle": "Slet dette scope",
      "documentHint": "Kompileres mod dit skema, når du gemmer. Hver eneste kolonne, en kalder kan nå, står her og ingen andre steder. En standardværdi kan være '{'\"$generate\": \"uuid\"'}' eller '{'\"$generate\": \"now\"'}' — serveren udfylder dem ved oprettelse, så en besøgende kan tilføje en række uden at vælge dens id.",
      "documentLabel": "Scope-dokument",
      "emptyBody": "Opret et nedenfor. Det tjekkes mod dit aktuelle skema, før det gemmes.",
      "emptyTitle": "Ingen scopes endnu",
      "formLabel": "Opret et scope",
      "issuesTitle": "Dette scope kunne ikke kompileres",
      "keyCount": "{count, plural, =0 {ingen nøgler} one {# nøgle} other {# nøgler}}",
      "nameLabel": "Navn",
      "subtitle": "Et scope er alt det, en nøgle må nå — tabellerne, de præcise kolonner og et filter, som kalderen kan indsnævre, men aldrig fjerne.",
      "title": "Scopes",
      "deleteBodyKeys": "Et scope med aktive nøgler kan ikke slettes. Tilbagekald først dets nøgler. Nøgler, der allerede er tilbagekaldt eller udløbet, slettes sammen med scopet.",
      "liveKeys": {
        "body": "Sider, der bygger på disse nøgler, ville holde op med at virke. Tilbagekald dem først i nøglelisten, og slet derefter scopet.",
        "title": "Publicerbare nøgler bruger stadig dette scope"
      }
    },
    "status": {
      "heading": "Status"
    },
    "subtitle": "Lad dine egne kunde- eller medarbejdervendte sider læse denne database gennem et scope, du definerer.",
    "title": "Offentligt API",
    "toggle": {
      "hint": "Slår du dette fra, stopper enhver offentlig forespørgsel med det samme. Intet slettes — nøgler, scopes og data bevares alle.",
      "label": "Servér det offentlige API"
    }
  },
  "remap": {
    "badge": {
      "fk": "FK",
      "masked": "Maskeret",
      "pii": "PII",
      "pk": "PK",
      "unique": "UNIK"
    },
    "column": {
      "currency": "Valuta",
      "currencyHelper": "ISO 4217-kode anvendt på beløbsformatering.",
      "enum": "Enum-semantik",
      "enumCategory": "Kategori",
      "enumHelper": "Arbejdsgangs-enums driver statusmærker og tavlekolonner; toner knytter værdierne til den semantiske farvetoneskala.",
      "enumKind": "Enum-art",
      "enumLabelFor": "Etiket for {value}",
      "enumToneAuto": "auto",
      "enumToneFor": "Tone for {value}",
      "enumWorkflow": "Arbejdsgang",
      "labelHelper": "Udledt: {name}",
      "labelOverride": "Visningsetiket",
      "logicalType": "Logisk type",
      "logicalTypeHelper": "Udledt: {type} (fra {dbType}) — kortlagt af adapteren; kan ikke tilsidesættes i v1.",
      "nullable": "kan være NULL",
      "pii": "Maskér som standard",
      "piiHelper": "Maskerede værdier vises slørede; afmaskering kræver tilladelsen data.unmask_pii og logges i auditloggen.",
      "semantic": "Semantisk type",
      "semanticHelper": "Klassifikator: {tag} · {confidence}% tillid · kilde: {source}",
      "semanticInferred": "udledt: {tag}",
      "unclassified": "Endnu ikke klassificeret."
    },
    "diff": {
      "count": "{count} ændringer",
      "one": "1 ændring",
      "regenerate": "Regenerér sider",
      "revertAll": "Fortryd alle",
      "revertOne": "Fortryd {change}",
      "save": "Gem tilsidesættelser",
      "saved": "Tilsidesættelser gemt."
    },
    "empty": {
      "description": "Vælg noget i skematræet for at ommappe dets etiket, type, relationer eller maskering.",
      "title": "Vælg en tabel eller kolonne"
    },
    "inspector": "Inspektør",
    "loadFailed": "Kunne ikke indlæse skemaet for denne forbindelse.",
    "mode": {
      "design": "Design",
      "diagram": "Diagram",
      "remap": "Etiketter og relationer"
    },
    "modeLabel": "Redigeringstilstand",
    "noDesign": {
      "noPrivilege": "Denne forbindelses rolle kan ikke oprette eller ændre tabeller. Giv den skemarettigheder, eller forbind en rolle, der har dem.",
      "readOnlyIntent": "Denne forbindelse blev sat op til skrivebeskyttet analyse. Skift dens formål i Indstillinger for at redigere dens skema.",
      "readOnlyRole": "Denne forbindelse logger på med en skrivebeskyttet rolle, så Adminium kan ikke ændre dens skema.",
      "schemaFile": "Denne forbindelse blev oprettet ud fra en skemafil, så der er ingen database at ændre. Etiketter og relationer virker fortsat."
    },
    "relations": {
      "accept": "Accepter",
      "accepted": "Accepteret",
      "add": "Tilføj virtuel relation",
      "addButton": "Tilføj relation",
      "cardinality": "Kardinalitet",
      "confidence": "udledt · {pct}%",
      "declared": "Deklarerede fremmednøgler",
      "fromColumn": "Fra kolonne",
      "fromPlaceholder": "customer_id",
      "inferred": "Udledte relationer",
      "noColumns": "Ingen matchende kolonne",
      "noTables": "Ingen matchende tabel",
      "noneDeclared": "Ingen deklarerede fremmednøgler berører denne tabel.",
      "noneInferred": "Intet udledt for denne tabel.",
      "overrideBadge": "tilsidesættelse",
      "overrides": "Relationer fra tilsidesættelser (anvendt)",
      "suppress": "Undertryk",
      "suppressed": "Undertrykt",
      "toColumn": "Til kolonne",
      "toTable": "Til tabel"
    },
    "rules": {
      "fill": "Starter som",
      "fillDb": "Databasen udfylder det (en trigger)",
      "fillDefault": "Overlad det til databasen",
      "fillHelp": "Hvad Adminium sætter ind her, når ingen udfylder det.",
      "fillImplicit": "Adminium udfylder dette automatisk.",
      "fillLiteral": "En fast værdi",
      "fillNone": "Intet — lad det stå tomt",
      "fillNow": "Den aktuelle dato og tid",
      "fillText": "Værdien",
      "fillUser": "Den, der er logget ind",
      "fillUuid": "Et nyt unikt id",
      "format": "Format",
      "formatAny": "Hvad som helst",
      "formatEmail": "En e-mailadresse",
      "formatPhone": "Et telefonnummer",
      "formatUrl": "En webadresse",
      "help": "De gælder overalt, hvor en række skrives — formularer, import, automatiseringer og API'et — ikke kun i denne app.",
      "max": "Størst",
      "maxLength": "Længste",
      "min": "Mindst",
      "minLength": "Korteste",
      "onUpdate": "Udfyld det igen ved hver ændring",
      "optionsFromDatabase": "Din database fastlægger de tilladte værdier for denne kolonne. Ret dem i Design.",
      "optionsHelp": "Én pr. linje. Lad feltet stå tomt for at acceptere alt.",
      "required": "Skal udfyldes",
      "requiredAlready": "Din database kræver allerede denne kolonne.",
      "requiredHelp": "Formularen beder om det, og en skrivning uden bliver afvist.",
      "title": "Regler",
      "optionsAnything": "Hvad som helst",
      "optionsInline": "Disse værdier",
      "optionsList": "En liste",
      "optionsListHelp": "Selve listerne redigerer du under Studio → Lister.",
      "optionsListLabel": "Liste",
      "optionsListUnavailable": "Listerne kunne ikke læses.",
      "optionsMissingList": "{key} (ikke i dette arbejdsområde)",
      "optionsPickList": "Vælg en liste…",
      "optionsSource": "Tilladte værdier",
      "optionsSourceHelp": "En liste skrives én gang i Studio og bruges af hver kolonne, der nævner den.",
      "optionsValues": "Værdierne",
      "decided": {
        "title": "Bestemt af Adminium",
        "help": "Adminium udfylder dette ved hver skrivning, og et offentligt endpoint kan aldrig lade en besøgende angive det.",
        "copy": "Kopieret fra {from} i den række, {via} peger på",
        "copyAlways": "altid, uanset hvad skribenten angiver",
        "copyDefault": "medmindre skribenten angiver en værdi",
        "sequence": "Det næste nummer i rækkefølge, fra {start}",
        "code": "En tilfældig kode som {example}",
        "remove": "Fjern denne regel",
        "rollup": "Summen af {sum} over dens rækker i {from}",
        "rollupTimes": "Summen af {sum} × {times} over dens rækker i {from}",
        "stampCreate": "Sættes til {what}, når rækken oprettes",
        "stampChange": "Sættes til {what}, når {column} bliver {values}",
        "stampNow": "tidspunktet",
        "stampUserName": "navnet på den, der gør det",
        "stampUserId": "id’et på den, der gør det",
        "stampByOrigin": "“{public}” fra den offentlige side, “{staff}” fra personalet",
        "rollupWhere": "tæller kun rækker, hvor {column} er {value}",
        "rollupBalance": "og holder {balance} = {of} − {minus} − denne sum",
        "rollupCap": "En ændring, der ville bringe saldoen under nul, afvises.",
        "stampToday": "datoen",
        "stampClaim": "den indloggede persons {column}",
        "stampAddDays": "{date} plus {days} dage",
        "stampAddDaysColumn": "{date} plus de dage, {column} angiver",
        "stampHashOf": "et fingeraftryk af rækken",
        "stampFilled": "Sættes til {what}, når {column} udfyldes første gang",
        "sequenceGapless": "Det næste nummer i rækkefølge, uden huller og uden gentagelser",
        "sequenceScope": "tælles for sig for hver {scope}",
        "formula": "Udregnes ud fra {columns} ved hver skrivning",
        "format": "Skrives som {example} ud fra nummeret i {from}",
        "scale": "Afrundet til {places} decimaler",
        "scaleCurrency": "Afrundet til valutaens decimaler",
        "stampByOriginOwn": "“{public}” fra den offentlige side og det, personalet vælger, fra personalet",
        "stampCopy": "værdien af {column}",
        "normalizeEmail": "Gemmes uden mellemrum i enderne og med små bogstaver",
        "normalizeTrim": "Gemmes uden mellemrum i begge ender",
        "states": "Ændres kun ved de skridt, dens regler tillader",
        "statesLock": "rækken er låst, mens den er {states}"
      },
      "venueLocal": "Et tidspunkt skrevet her uden tidszone er stedets egen tid.",
      "fillFromCurrency": "Forbindelsens valuta",
      "fillFromSetting": "En indstilling: {setting}",
      "shape": {
        "setBy": "Angivet af {addOn}",
        "confirmTitle": "Slå en regel angivet af {addOn} fra?",
        "numbers": "Numre kan gentage sig eller springes over.",
        "totals": "Totaler bliver det, der tastes ind.",
        "edits": "Sendte fakturaer kan redigeres.",
        "kept": "{addOn} holder op med at udfylde dette.",
        "confirmHelp": "Når du ændrer den, er reglen din: ingen opdatering af appen eller tilføjelsen sætter den tilbage.",
        "keep": "Behold den",
        "switchOff": "Slå den fra"
      }
    },
    "saveFailed": "Lagring mislykkedes: {message}",
    "subtitle": "{tables} tabeller · {applied} tilsidesættelser anvendt",
    "table": {
      "hierarchy": "Hierarki",
      "icon": "Ikon",
      "iconPicker": "Tabelikon",
      "include": "Medtag i den genererede app",
      "includeHelper": "Udeladte tabeller får ingen sider og forsvinder fra navigationen.",
      "kind": "Art",
      "labelHelper": "Udledt: {name}",
      "labelOverride": "Visningsetiket",
      "navGroup": "Navigationsgruppe",
      "navGroupHelper": "Navigationsplaceringen bestemmes af generatoren — en table.navGroup-tilsidesættelse er ikke en del af v1-vokabularet.",
      "polymorphic": "Polymorfe par",
      "role": "Rolle",
      "rows": "Rækkeestimat",
      "selfFk": "Selvreference via {column}",
      "shape": "Tabelform (klassificeret)",
      "shapeHelper": "Klassificeringen genberegnes ved hver introspektion; tilsidesættelser lægges ovenpå og overlever regenerering.",
      "system": "System",
      "unclassified": "Ikke klassificeret"
    },
    "tabs": {
      "details": "Detaljer",
      "relations": "Relationer"
    },
    "title": "Skema",
    "toast": {
      "regenerateFailed": "Regenerering mislykkedes",
      "regenerated": "{created} oprettet · {updated} opdateret · {unchanged} uændret",
      "regeneratedDetail": "Sider, du har redigeret i hånden, bevares — kun sider med en urørt generated_hash blev regenereret på stedet.",
      "saved": "Skema-tilsidesættelser gemt",
      "savedDetail": "Det anvendte skema nedenfor afspejler dine ændringer."
    },
    "tree": {
      "collapse": "Fold tabel sammen",
      "excluded": "Udeladt",
      "expand": "Fold tabel ud",
      "label": "Skema",
      "noMatches": "Ingen tabeller matcher din søgning.",
      "search": "Søg i tabeller og kolonner",
      "searchPlaceholder": "Søg i tabeller…",
      "unsaved": "Ugemt ændring"
    },
    "unavailableBody": "Dette build indeholder endnu ikke ommapnings-editoren. Kør genereringen igen, når den er kommet, for at ommappe etiketter, typer og relationer.",
    "unavailableTitle": "Editor til skema-ommapning ikke tilgængelig"
  },
  "review": {
    "unavailableBody": "Denne build indeholder endnu ikke berigelsens gennemgangsskærm. Den kommer med diff-og-anvend-flowet.",
    "unavailableTitle": "Gennemgangsskærm ikke tilgængelig"
  },
  "settings": {
    "globalDefaultsNav": "Globale standarder",
    "title": "Indstillinger",
    "workspaceSection": "Arbejdsområde"
  },
  "settingsAi": {
    "assistant": {
      "name": {
        "label": "Assistentens navn",
        "hint": "Vises på spørgeknappen og i assistentvinduet."
      },
      "rowData": {
        "label": "Lad {name} læse tabelrækker",
        "hint": "Når det er slået til, må {name} sende de rækker, din rolle kan læse, til den konfigurerede udbyder — maskeret, højst 50 pr. forespørgsel og opført under „Læste kilder“. Når det er slået fra, arbejder den kun ud fra dokumenter og skema."
      },
      "save": "Gem",
      "saveFailed": "Assistentindstillingerne kunne ikke gemmes. Prøv igen.",
      "saved": "Assistentindstillinger gemt",
      "subtitle": "Hvad den hedder her, og hvad den må læse.",
      "title": "Assistent"
    },
    "byo": {
      "body": "Studio kan generere en selvstændig prompt ud fra dit skema. Kør den i Claude Code, ChatGPT eller et hvilket som helst værktøj, og indsæt derefter den returnerede JSON tilbage i forbindelsesguiden. Samme validering, samme gennemgang, samme resultat som den direkte vej.",
      "guarantee1": "Prompten indeholder kun dit skema og aggregeret statistik — aldrig rækkedata som standard.",
      "guarantee2": "Ingen legitimationsoplysninger, instans-URL eller identifikatorer er indlejret.",
      "guarantee3": "BYO-kørsler foretager ingen netværkskald.",
      "guaranteeTitle": "Telemetrifri garanti",
      "heading": "Ingen nøgle? Brug dit eget AI-værktøj",
      "headingRecommended": "Brug dit eget AI-værktøj — ingen nøgle nødvendig",
      "promptVersion": "Prompt {version}",
      "recommended": "Anbefalet",
      "schemaVersion": "Skema {version}",
      "subtitle": "Kopiér-indsæt-turen — intet forlader denne maskine."
    },
    "configure": {
      "heading": "Konfigurér {provider}"
    },
    "field": {
      "baseUrl": "Basis-URL",
      "baseUrlHelper": "Endpoint-roden, der leverer /chat/completions.",
      "baseUrlOptional": "Lad stå, medmindre Ollama kører på en anden vært.",
      "key": "API-nøgle",
      "keyMask": "sk-…{last4}",
      "keyOptional": "Valgfri — nogle endpoints kræver ingen nøgle.",
      "keyReplace": "Erstat nøgle",
      "keyStored": "Gemt krypteret. Erstat den for at bruge en anden nøgle.",
      "keyWriteOnly": "Kun skrivning: når den er gemt, vises den aldrig igen.",
      "model": "Model",
      "modelFreeText": "Indtast det præcise model-id, dit endpoint leverer.",
      "modelLive": "Indlæst live fra udbyderen.",
      "modelLoading": "Indlæser…",
      "modelPlaceholder": "Vælg en model…",
      "modelStatic": "En gennemprøvet liste; skriv et brugerdefineret id efter at have gemt for at opdatere den.",
      "noKeyBody": "Ollama kører lokalt, så intet forlader denne maskine.",
      "noKeyTitle": "Ingen API-nøgle nødvendig"
    },
    "history": {
      "byo": "BYO",
      "colChunks": "Blokke",
      "colDate": "Dato",
      "colSource": "Kilde",
      "colStatus": "Status",
      "connection": "Forbindelse",
      "directPath": "Direkte",
      "empty": "Ingen berigelseskørsler endnu. Berig et skema fra forbindelsesguiden for at se historik her.",
      "errorBody": "Genindlæs siden for at prøve igen.",
      "errorTitle": "Kunne ikke indlæse kørsler",
      "heading": "Kørselshistorik",
      "noConnections": "Forbind først en database — berigelseskørsler registreres pr. forbindelse.",
      "openReview": "Åbn gennemgang for kørslen fra {date}",
      "subtitle": "Tidligere berigelseskørsler. Åbn en for at gennemgå dens forslag.",
      "tableLabel": "Berigelseskørsler"
    },
    "provider": {
      "active": "Aktiv",
      "anthropic": {
        "desc": "Claude-modeller via Anthropic-API’en.",
        "label": "Anthropic"
      },
      "heading": "AI-udbyder",
      "networkDisabledBody": "Dette Adminium er konfigureret uden udgående internetadgang og kan ikke nå en udbyder-API. Brug kopier-indsæt-turen nedenfor — den kræver hverken nøgle eller netværk.",
      "networkDisabledTitle": "Direkte AI-udbydere er slået fra i denne installation",
      "ollama": {
        "desc": "Modeller kører lokalt via Ollama — ingen nøgle, ingen sky.",
        "label": "Ollama (lokal)"
      },
      "openai": {
        "desc": "GPT-modeller via OpenAI-API’en.",
        "label": "OpenAI"
      },
      "openaiCompatible": {
        "desc": "Ethvert endpoint, der taler OpenAI-formatet — Groq, Together, vLLM, LM Studio.",
        "label": "OpenAI-kompatibel"
      },
      "requiresNetwork": "Kræver internet og en API-nøgle",
      "subtitle": "Vælg, hvordan Adminium når en model til at berige dit skema. Nøgler gemmes krypteret og vises aldrig igen."
    },
    "runStatus": {
      "applied": "Anvendt",
      "awaitingResponse": "Afventer svar",
      "discarded": "Kasseret",
      "draft": "Kladde",
      "failed": "Mislykkedes",
      "partiallyApplied": "Delvist anvendt",
      "running": "Kører",
      "validated": "Valideret"
    },
    "save": "Gem udbyder",
    "saveFailed": "AI-udbyderen kunne ikke gemmes. Prøv igen.",
    "saved": "AI-udbyder gemt",
    "subtitle": "Forbind en model, så Adminium kan foreslå etiketter, grupper, relationer og mere — altid gennemgået som en diff, før noget anvendes.",
    "test": "Test forbindelse",
    "testError": "Testen mislykkedes",
    "testErrorBody": "Kunne ikke nå udbyderen. Tjek nøglen og basis-URL.",
    "testHintDirty": "Gem dine ændringer, før du tester.",
    "testOk": "Forbundet til {model} på {latency} ms",
    "testUnknownModel": "udbyderen",
    "testing": "Kontakter udbyderen…",
    "title": "AI-berigelse"
  },
  "settingsHub": {
    "addOnsCard": {
      "body": "Gennemse, installer og forbind tilføjelser — ekstra blokke, datapakker og integrationer — eller upload selv en.",
      "cta": "Åbn tilføjelser",
      "heading": "Tilføjelser"
    },
    "aiCard": {
      "body": "Konfigurér en AI-udbyder (eller kopiér-indsæt-turen) for at berige etiketter, grupper og relationer.",
      "cta": "Åbn AI-indstillinger",
      "heading": "AI-berigelse"
    },
    "apiCard": {
      "api": {
        "helper": "Server de endpoints, dine nøgler er begrænset til. Slået fra holder alle nøgler op med at virke med det samme; intet slettes.",
        "label": "Offentligt API"
      },
      "docs": {
        "helper": "En offentlig side på /api-docs, der viser alle, som kan nå denne server, de endpoints, dine aktive nøgler kan kalde — også dem på medarbejderniveau — med deres stier, metoder og kolonnenavne. Den viser ingen data og ingen nøgler.",
        "label": "Side med API-dokumentation"
      },
      "failed": "Kontakten blev ikke ændret. Prøv igen.",
      "heading": "Offentligt API",
      "notRegistered": {
        "body": "Sæt ADMINIUM_PUBLIC_API_ORIGINS, og genstart. Indtil da ændrer disse kontakter ingenting.",
        "title": "Ikke slået til på denne server"
      }
    },
    "danger": {
      "deleteCta": "Slet forbindelse",
      "deleteDesc": "Sletter forbindelsen og de genererede sider. Din database røres ikke. Kan ikke fortrydes.",
      "empty": "Intet at slette — ingen forbindelser endnu.",
      "heading": "Farezone",
      "subtitle": "Uigenkaldelige handlinger."
    },
    "defaultsCard": {
      "body": "Tema, accentfarve, tæthed og sprog for hele arbejdsområdet findes under globale standarder.",
      "cta": "Åbn globale standarder",
      "heading": "Standarder for udseende og sprog"
    },
    "email": {
      "attachmentCap": {
        "error": "Mellem {min, number} og {max, number} MB.",
        "helper": "Det meste, én besked må indeholde af vedhæftninger.",
        "label": "Grænse for vedhæftninger (MB)"
      },
      "from": {
        "error": "Indtast en e-mailadresse.",
        "helper": "Kun adressen, eller et visningsnavn foran den.",
        "label": "Afsenderadresse"
      },
      "heading": "E-mail (SMTP)",
      "host": {
        "error": "Kun et værtsnavn eller en IP-adresse — uden skema, port eller loginoplysninger.",
        "label": "SMTP-vært"
      },
      "linkOrigin": {
        "error": "Angiv en adresse som https://admin.example.com uden sti.",
        "helper": "Links til nulstilling af adgangskode og invitationer åbner denne adresse. Hvis den er tom, udfylder Adminium den fra den næste administrator, der logger ind eller gemmer en ændring, medmindre vedkommende bruger localhost.",
        "label": "Adresse i e-maillinks"
      },
      "pass": {
        "error": "Dette brugernavn kræver en adgangskode.",
        "helper": "Gemmes krypteret og vises aldrig igen. Lad feltet stå tomt for at beholde den nuværende.",
        "label": "Adgangskode"
      },
      "port": {
        "error": "Mellem {min, number} og {max, number}.",
        "label": "Port"
      },
      "remove": "Fjern mailserver",
      "review": {
        "password": "Erstattet",
        "removed": "Fjernet"
      },
      "secure": {
        "helper": "Til på port 465. Fra starter i klartekst og skifter med STARTTLS, som port 587 forventer.",
        "label": "Implicit TLS"
      },
      "senders": {
        "add": "Tilføj afsender",
        "address": "Adresse",
        "error": "Indtast en e-mailadresse.",
        "heading": "Afsendere",
        "helper": "Adresser, en e-mail må sendes fra. SMTP-afsenderadressen er altid tilgængelig.",
        "implicit": "SMTP-afsenderadresse",
        "name": "Visningsnavn",
        "remove": "Fjern afsender",
        "review": "Afsendere"
      },
      "unconfigured": "Der er ikke opsat nogen mailserver, så Adminium kan ikke sende nulstilling af adgangskode, invitationer eller planlagte rapporter.",
      "user": {
        "helper": "Lad feltet stå tomt, hvis relayet ikke kræver login.",
        "label": "Brugernavn"
      }
    },
    "identity": {
      "appName": {
        "error": "Angiv et navn på højst 60 tegn.",
        "helper": "Vises i sidepanelet, browsertitlen og e-mails.",
        "label": "Applikationsnavn"
      },
      "heading": "Arbejdsområdets identitet",
      "logo": {
        "badType": "Vælg et PNG-, JPEG-, WebP-, GIF- eller SVG-billede.",
        "drop": "Slip et billede her",
        "helper": "PNG, JPEG, WebP, GIF eller SVG på op til 1 MB. Erstatter det indbyggede mærke overalt.",
        "label": "Logo",
        "remove": "Fjern",
        "removed": "Logo fjernet",
        "replace": "Erstat logo",
        "tooLarge": "Billedet er større end 1 MB.",
        "undo": "Fortryd",
        "upload": "Upload logo",
        "uploaded": "Logo opdateret"
      },
      "showVersion": {
        "helper": "Buildnummeret ved siden af logoet. Slået fra skjuler, hvilken version du kører.",
        "label": "Version i sidepanelet"
      }
    },
    "pagesCard": {
      "body": "Tilføj, rediger og slet sider, skift hvad hver enkelt viser, og omarranger sidepanelet.",
      "cta": "Administrer sider",
      "heading": "Sider"
    },
    "projectCard": {
      "body": "Projektmappen, som denne server kører: dens hooks, handlinger og sidefiler.",
      "cta": "Åbn projekt",
      "heading": "Projekt"
    },
    "publicApiCard": {
      "body": "Opret endpoints og de nøgler, der må kalde dem.",
      "cta": "Åbn API-nøgler",
      "heading": "API-nøgler"
    },
    "review": {
      "cancel": "Annuller",
      "change": "{before} → {after}",
      "close": "Luk",
      "confirm": "Gem ændringer",
      "hidden": "Skjult",
      "off": "Fra",
      "on": "Til",
      "shown": "Vist",
      "subtitle": "Gennemgå dine ændringer, før du gemmer.",
      "title": "Gem arbejdsområdeindstillinger"
    },
    "save": "Gem ændringer",
    "saveFailed": "Arbejdsområdeindstillingerne kunne ikke gemmes. Prøv igen.",
    "saved": "Arbejdsområdeindstillinger opdateret",
    "security": {
      "allowSignup": {
        "desc": "Alle kan oprette en konto — slået fra er arbejdsområdet kun på invitation.",
        "label": "Tillad selvregistrering"
      },
      "heading": "Sikkerhed",
      "passwordMin": {
        "error": "Mellem {min, number} og {max, number} tegn.",
        "label": "Minimal adgangskodelængde"
      },
      "require2fa": {
        "desc": "Alle medlemmer skal aktivere 2FA for at logge ind.",
        "label": "Kræv tofaktorgodkendelse",
        "note": "Vejledende, ikke en spærring: medlemmer uden 2FA sendes til opsætningen og kan ikke slå den fra igen, men deres login blokeres aldrig, og API-nøgler er ikke omfattet."
      },
      "sessionTtl": {
        "error": "Mellem {min, number} og {max, number} timer.",
        "label": "Sessionslevetid (timer)"
      }
    },
    "storageCard": {
      "body": "Vælg hvor uploadede filer, eksporter og andre gemte bytes bor — denne server, en bucket eller din egen server.",
      "cta": "Åbn lagring",
      "heading": "Lagring"
    },
    "subtitle": "Identitet, sikkerhed og destruktive handlinger for dette arbejdsområde.",
    "superAdminOnly": "Kun en superadmin kan ændre arbejdsområdets identitet og sikkerhedsindstillinger.",
    "superAdminOnlyTitle": "Superadmin påkrævet",
    "title": "Arbejdsområdeindstillinger",
    "translationsCard": {
      "body": "Omformulér hvad som helst i Adminium, vælg hvilke sprog folk kan vælge, og tilføj dine egne.",
      "cta": "Åbn oversættelser",
      "heading": "Sprog og oversættelser"
    },
    "listsCard": {
      "body": "De svar, en kolonne accepterer — lande, stadier, afdelinger — navngivet én gang og brugt overalt.",
      "cta": "Åbn lister",
      "heading": "Lister"
    }
  },
  "source": {
    "dsn": {
      "helper": "postgres://bruger:kodeord@vaert:5432/database — mysql:// og sqlite: virker også.",
      "incomplete": "Tilføj vært og database, f.eks. postgres://user@host:5432/db",
      "invalidScheme": "Ukendt skema — forventede postgres://, mysql://, mariadb:// eller sqlite:",
      "label": "Forbindelsesstreng",
      "quickFill": "Hurtig udfyldning:"
    },
    "engine": {
      "label": "Databasemotor",
      "mysql": "MySQL / MariaDB",
      "postgres": "PostgreSQL",
      "sqlite": "SQLite"
    },
    "fields": {
      "database": "Database",
      "host": "Vært",
      "password": "Adgangskode",
      "port": "Port",
      "preview": "Forhåndsvisning af forbindelsesstreng:",
      "ssl": "SSL-tilstand",
      "user": "Bruger"
    },
    "file": {
      "columns": "kolonner",
      "detectedAs": "Registreret: {format}",
      "dropHint": "SQL DDL / pg_dump, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, Django-modeller, Adminium JSON",
      "dropTitle": "Slip din skemafil her, eller gennemse",
      "errorTitle": "Kunne ikke fortolke filen",
      "moreWarnings": "+{count} flere advarsler — den fulde liste vises i analysetrinnet.",
      "parseFailed": "Vi kunne ikke fortolke den fil. Hvis auto-genkendelsen gættede forkert, så vælg formatet eksplicit og prøv igen.",
      "parsing": "Læser den uploadede skemafil…",
      "pitch": "Ingen databaseforbindelse påkrævet — vi fortolker din skemafil og bygger de samme dashboards.",
      "requestFailed": "Upload mislykkedes — tjek din forbindelse og prøv igen.",
      "tables": "tabeller",
      "unsupported": "Formatet blev ikke genkendt — SQL DDL, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, Django-modeller og Adminium JSON understøttes. Vælg ét eksplicit og prøv igen.",
      "warnings": "advarsler"
    },
    "format": {
      "auto": "Registrér automatisk",
      "django": "Django models.py",
      "drizzle": "Drizzle ORM",
      "helper": "Lad automatisk registrering være slået til, medmindre den tager fejl.",
      "json": "Adminium JSON",
      "label": "Skemaformat",
      "prisma": "Prisma-skema",
      "rails": "Rails schema.rb",
      "sequelize": "Sequelize-modeller",
      "sql": "SQL DDL / pg_dump",
      "typeorm": "TypeORM-entiteter"
    },
    "mode": {
      "dsn": "Forbindelsesstreng",
      "fields": "Enkelte felter",
      "file": "Skemafil"
    },
    "modeLabel": "Kildeinputtilstand",
    "name": "Forbindelsesnavn",
    "namePlaceholder": "Produktions-Postgres",
    "readOnlyRole": {
      "body": "Under opsætningen læser Adminium kun skemametadata — aldrig dine rækker. Vi anbefaler en dedikeret bruger med kun SELECT-rettigheder; hvor Adminium gemmer sine egne tabeller, bestemmer du i trinnet om metadatalagring.",
      "title": "Brug en skrivebeskyttet rolle"
    },
    "sqlite": {
      "file": "Sti til databasefil",
      "helper": "SQLite er en fil, ikke en server — angiv den absolutte sti på den maskine, der kører Adminium."
    },
    "subtitle": "Peg Adminium mod en database, så genererer vi et admin-dashboard ud fra dens skema.",
    "title": "Forbind din database"
  },
  "storage": {
    "actionFailed": "Det virkede ikke",
    "add": "Tilføj en destination",
    "availableOnDisk": "{size} tilgængelig på denne disk",
    "default": "Standard",
    "defaultBlockedByDisabled": "En destination, der er slået fra, kan ikke være standard. Slå den til først.",
    "delete": {
      "blockedBody": "{name} indeholder stadig {count, plural, one {# fil} other {# filer}}. Flyt først indholdet til en anden destination, og slet så denne.",
      "blockedTitle": "Denne destination indeholder stadig filer",
      "body": "Adminium glemmer {name} og dens loginoplysninger. Intet af det, der er gemt i den, røres — selve bucketen eller serveren er din, og filer, der stadig er registreret på den, afviser sletningen.",
      "confirm": "Slet destination",
      "title": "Slet denne destination"
    },
    "deleteButton": "Slet",
    "disable": "Slå fra",
    "disabled": "Slået fra",
    "driver": {
      "local": "En sti på denne maskine",
      "s3": "S3-kompatibel bucket",
      "webdav": "WebDAV-server"
    },
    "edit": "Rediger",
    "editor": {
      "createTitle": "Tilføj en destination",
      "editTitle": "Rediger destination",
      "subtitle": "Adminium læser og skriver gennem denne destination på dine vegne; det er infrastruktur, du selv styrer."
    },
    "enable": "Slå til",
    "field": {
      "accessKeyId": "Adgangsnøgle-id",
      "bucket": "Bucket",
      "driver": "Type",
      "driverLocked": "Ændrer du typen på en destination, der allerede indeholder filer, kan de filer ikke længere nås.",
      "endpoint": "Endpoint",
      "endpointDerived": "Lad feltet stå tomt for AWS selv — endpointet følger af regionen.",
      "name": "Navn",
      "namePlaceholder": "Bucket til uploads",
      "password": "Adgangskode",
      "pathStyle": "Stibaseret adressering",
      "pathStyleToggle": "Adressér bucketen som en sti frem for et værtsnavn",
      "prefix": "Præfiks",
      "prefixHelper": "En mappe inde i destinationen. To destinationer på samme bucket, der kun adskiller sig her, deler bucketen uden at dele navnerum.",
      "preset": "Udbyder",
      "presetHelper": "Udfylder endpoint, region og adresseringsform. Alt, hvad udbyderen ikke kan vide om din konto, står tomt, så du selv kan skrive det.",
      "publicBaseUrl": "Offentlig basis-URL",
      "publicBaseUrlHelper": "Valgfri. Hvor disse objekter kan læses uden Adminium — et CDN foran en offentlig bucket. Bruges kun, når en kolonne gemmer et link.",
      "region": "Region",
      "root": "Mappe",
      "rootHelper": "En absolut sti, som denne server kan skrive til — et monteret drev eller et netværksdrev. Ikke standardmappen, som allerede er den første i listen.",
      "secretAccessKey": "Hemmelig adgangsnøgle",
      "secretKept": "Der er gemt en nøgle. Lad begge felter stå tomme for at beholde den; udfyld begge for at erstatte den.",
      "url": "Samlings-URL",
      "urlHelper": "Den samling, Adminium skriver i, sådan som din server offentliggør den.",
      "username": "Brugernavn"
    },
    "fileCount": "{count, plural, one {# fil} other {# filer}}",
    "kind": {
      "archive": "Arkiverede batches fra auditloggen",
      "branding": "Arbejdsområdets logo",
      "export": "Filer fra dataeksporter",
      "import": "Uploadede CSV-filer og deres fejlrapporter",
      "schema": "Importerede skemafiler",
      "upload": "Filer vedhæftet poster"
    },
    "list": {
      "subtitle": "Nye filer havner i standarddestinationen. Eksisterende filer bliver, hvor de er, indtil du flytter dem.",
      "title": "Destinationer"
    },
    "loadFailed": {
      "forbidden": "At ændre hvor filer gemmes kræver tilladelsen “Administrer lagring”. Bed en administrator om at give den til en af dine roller.",
      "title": "Destinationerne kunne ikke indlæses"
    },
    "localDisk": "Denne servers disk",
    "move": {
      "from": "Fra",
      "kinds": "Begræns til",
      "kindsHelp": "Lad alt være uafkrydset for at flytte dem alle. Uploads er de filer, folk vedhæfter; resten er artefakter, Adminium selv har lavet.",
      "open": "Flyt filer…",
      "start": "Start flytningen",
      "startedBody": "Den kører i baggrunden som job {jobId} og fortsætter, selvom du forlader siden. Tallene nedenfor ændrer sig, efterhånden som filerne ankommer — genindlæs for at se dem.",
      "startedTitle": "Flytningen er gået i gang",
      "subtitle": "Kopierer hver fil fra én destination til en anden og glemmer så den gamle kopi. Downloads virker hele vejen igennem.",
      "title": "Flyt filer",
      "to": "Til"
    },
    "preset": {
      "aws": "AWS S3",
      "b2": "Backblaze B2",
      "minio": "MinIO eller en anden S3-kompatibel server",
      "r2": "Cloudflare R2",
      "spaces": "DigitalOcean Spaces",
      "tigris": "Tigris",
      "wasabi": "Wasabi"
    },
    "save": "Gem destination",
    "secret": {
      "partialBody": "Udfyld begge felter for at erstatte de gemte loginoplysninger, eller ryd begge for at beholde dem. Gemmer du kun det ene, bliver de gamle stiltiende stående.",
      "partialTitle": "Halve loginoplysninger duer ikke"
    },
    "setDefault": "Gør til standard",
    "status": {
      "error": "Kan ikke nås",
      "ok": "Kan nås",
      "untested": "Ikke testet"
    },
    "subtitle": "Hvor denne instans opbevarer uploadede filer, eksporter og andre gemte bytes.",
    "test": {
      "button": "Test",
      "failed": "Denne destination kunne ikke nås",
      "ok": "Nået på {ms} ms",
      "unreachable": "Testen kunne ikke køres"
    },
    "title": "Lagring",
    "usedBytes": "{size} brugt"
  },
  "tables": {
    "emptyBody": "Denne database har endnu ingen tabeller. Du kan stadig fortsætte — når du har oprettet tabeller, kan du hente dem ind med \"Introspicer igen\" på denne forbindelse.",
    "emptyFileBody": "Denne skemafil definerer ingen tabeller. Gå tilbage og upload en anden fil, eller fortsæt alligevel.",
    "emptyFilter": "Ingen tabeller matcher dit filter.",
    "emptyTitle": "Ingen tabeller fundet",
    "highVolume": "stor volumen",
    "highVolumeNote": "Tabeller med over 100.000 rækker starter fravalgt — driftstabeller hører sjældent hjemme i et dashboard.",
    "importNoCounts": "Skemafiler indeholder ingen rækkeantal — kolonnen viser —, indtil en live database er forbundet.",
    "joinHidden": "{count} join-/systemtabeller er skjult på forhånd — de driver stadig mange-til-mange-relationer.",
    "listLabel": "Tabeller der kan medtages",
    "pii": "PII",
    "search": "Filtrér tabeller…",
    "subtitle": "Vælg hvilke der skal med. Du kan altid ændre det.",
    "title": "Vælg dine tabeller"
  },
  "test": {
    "errorTitle": "Forbindelsen mislykkedes",
    "hint": {
      "auth": "Godkendelse mislykkedes — tjek brugernavn og adgangskode i din DSN.",
      "hostUnreachable": "Vært utilgængelig — tjek værtsnavn og port, og at databasen accepterer forbindelser fra denne maskine (tilføj vores IP'er til tilladelseslisten).",
      "metaPlacement": "Denne kilde kan ikke huse Adminiums metatabeller — fortsæt med en separat metadatabase.",
      "permission": "Rollen fik forbindelse, men mangler skema-læserettigheder — giv USAGE på skemaet til din introspektionsrolle.",
      "timeout": "Databasen svarede ikke i tide — tjek netværkssti og belastning, og prøv igen.",
      "tls": "TLS-forhandling mislykkedes — prøv sslmode=require, eller upload det CA-certifikat din server forventer.",
      "unknown": "Forbindelsen mislykkedes — kontrollér DSN'en og prøv igen."
    },
    "log": {
      "connectFailed": "Forbindelsen mislykkedes.",
      "connected": "Forbundet ({latency} ms) · skrivebeskyttet introspektion",
      "connecting": "Etablerer sikker forbindelse…",
      "detected": "Registrerede {tables} tabeller · {columns} kolonner",
      "found": "Fandt {tables} tabeller · {columns} kolonner",
      "jobFailed": "Introspektion mislykkedes.",
      "mapping": "Kortlægger kolonnetyper → inputwidgets",
      "moreWarnings": "+{count} flere parser-advarsler",
      "networkFailed": "Anmodningen mislykkedes — tjek din forbindelse og prøv igen.",
      "parsingFile": "Fortolker {file}…",
      "piiDone": "PII-scanning fuldført — {count} kolonner maskeret som standard",
      "piiDoneUnknown": "PII-scanning fuldført",
      "piiScan": "Scanner efter PII-kolonner…",
      "readingFile": "Læser den uploadede skemafil…",
      "readingSchema": "Læser skema: public",
      "ready": "Klar",
      "relations": "Registrerer relationer…"
    },
    "logLabel": "Introspektionslog",
    "retry": "Prøv igen",
    "subtitle": "Introspekterer tabeller, kolonner og relationer. Det tager et par sekunder.",
    "title": "Analyserer dit skema",
    "trust": "Vi læser kun dit skema og dine data. Intet ændres."
  },
  "title": "Studio",
  "wizard": {
    "back": "Tilbage",
    "bridgeAppliedBody": "Overdraget fra adminium.dev af din browser — den gik direkte til denne maskine og blev aldrig uploadet. Tjek den nedenfor, og fortsæt.",
    "bridgeAppliedTitle": "Forbindelsesstreng modtaget",
    "bridgeFailedBody": "Den er allerede brugt eller udløbet. Indsæt i stedet din forbindelsesstreng nedenfor.",
    "bridgeFailedTitle": "Denne overdragelse kunne ikke bruges",
    "continue": "Fortsæt",
    "persistFailed": "Dit tabelvalg kunne ikke gemmes — prøv igen.",
    "persistFailedTitle": "Kunne ikke gemme",
    "progress": "Opsætningsforløb",
    "startOver": {
      "action": "Start forfra",
      "body": "Alt det indtastede ryddes, og guiden vender tilbage til første trin.",
      "bodyCreated": "Alt det indtastede ryddes, og guiden vender tilbage til første trin. Den forbindelse, Adminium allerede har oprettet, slettes ikke — den bliver i Dataforbindelser.",
      "confirm": "Start forfra",
      "keep": "Fortsæt",
      "title": "Start guiden forfra?"
    },
    "step": {
      "enrich": "Berig",
      "generate": "Generér",
      "intent": "Formål",
      "meta": "Metalagring",
      "source": "Kilde",
      "tables": "Tabeller",
      "test": "Analysér",
      "finish": "Afslut"
    },
    "title": "Ny forbindelse"
  },
  "lists": {
    "addValue": "Tilføj værdi",
    "andMore": "og {count} mere",
    "builtin": "Indbygget",
    "builtinCount": "{count} værdier",
    "builtinSubtitle": "En liste, Adminium leverer. Den er den samme i alle arbejdsområder, og navnene vises på hver enkelt persons eget sprog.",
    "cancel": "Annuller",
    "close": "Luk",
    "copiedFrom": "en kopi af {key}",
    "copyTitle": "En kopi af {name}",
    "create": "Opret liste",
    "delete": "Slet",
    "deleteBody": "Listen forsvinder. De værdier, der allerede er gemt i dine rækker, bliver præcis som de er — en liste siger, hvad en formular tilbyder, ikke hvad en kolonne indeholder.",
    "deleteTitle": "Slet {name}?",
    "edit": "Rediger",
    "editSubtitle": "De svar, en kolonne med denne liste accepterer, i den rækkefølge en formular tilbyder dem.",
    "editTitle": "Rediger {name}",
    "emptyBody": "En liste er de svar, en kolonne accepterer.",
    "emptyTitle": "Ingen lister endnu",
    "errorUnknown": "Det virkede ikke. Prøv igen.",
    "inUseBody": "Fjern den først fra {columns}.",
    "inUseNone": "Fjern den først fra de kolonner, der bruger den.",
    "inUseTitle": "{name} bruges af en kolonne",
    "issueBlank": "En af værdierne er tom. Udfyld den, eller fjern rækken.",
    "issueDuplicate": "“{value}” står to gange på listen.",
    "issueEmpty": "En liste skal have mindst én værdi.",
    "issueName": "Giv listen et navn.",
    "key": "Nøgle",
    "keyFixed": "Regler kalder denne liste",
    "keyHelper": "Det navn, regler og projektfiler bruger om denne liste. Det kan ikke ændres senere.",
    "labelAt": "Etiket {n}",
    "labelPlaceholder": "Det, folk læser",
    "makeCopy": "Lav en kopi, jeg kan redigere",
    "moveDown": "Flyt {value} ned",
    "moveUp": "Flyt {value} op",
    "name": "Navn",
    "namePlaceholder": "Afdelinger",
    "new": "Ny liste",
    "removeValue": "Fjern {value}",
    "save": "Gem ændringer",
    "storeLabel": "Gem etiketten i stedet",
    "storeLabelHelp": "En kopi gemmer koden, f.eks. DE. “Gem etiketten i stedet” gemmer det, den hedder her, f.eks. Tyskland — på dette arbejdsområdes sprog, fra nu af.",
    "subtitle": "De svar, en kolonne accepterer — navngivet én gang og brugt overalt.",
    "title": "Lister",
    "valueAt": "Værdi {n}",
    "valueCount": "{count} værdier",
    "values": "Værdier",
    "view": "Se"
  },
  "apiKeys": {
    "banner": {
      "bodyOnce": "Kopiér den nu — du kan ikke se den igen. Begrænset til {summary}.",
      "bodyRevealable": "Kopiér den nu — du kan vise den igen fra listen nedenfor. Begrænset til {summary}.",
      "copied": "Kopieret",
      "copy": "Kopiér",
      "titleNamed": "{name} er oprettet"
    },
    "builder": {
      "auth": {
        "anon": "Anon",
        "authenticated": "Godkendt",
        "label": "Krav til godkendelse",
        "service": "Servicerolle"
      },
      "cancel": "Annuller",
      "columns": {
        "all": "Alle",
        "label": "Eksponerede kolonner",
        "none": "Ingen"
      },
      "create": "Opret endpoint",
      "delete": "Slet endpoint",
      "deleteRefused": "{count, plural, one {# nøgle bruger} other {# nøgler bruger}} stadig dette endpoint: {names}.",
      "filters": {
        "add": "Tilføj",
        "empty": "Ingen filtre — alle rækker i kilden kan nås.",
        "label": "Standardfiltre",
        "remove": "Fjern filter",
        "value": "værdi"
      },
      "footer": {
        "applyFirst": "Anvend eller fortryd den redigerede definition først."
      },
      "methodUnsupported": "Denne kilde kan ikke understøtte {method}: den har ingen primærnøgle.",
      "methods": "Metoder",
      "op": {
        "between": "mellem",
        "eq": "er lig med",
        "gt": "større end",
        "gte": "mindst",
        "ilike": "indeholder (uanset store/små bogstaver)",
        "in": "i listen",
        "is_null": "er tom",
        "like": "indeholder",
        "lt": "mindre end",
        "lte": "højst",
        "neq": "er ikke lig med",
        "not_null": "er ikke tom",
        "today": "er i dag",
        "fromToday": "fra i dag"
      },
      "paging": {
        "asc": "Stigende",
        "defaultLimit": "Standardgrænse",
        "desc": "Faldende",
        "label": "Sideinddeling og sortering",
        "maxLimit": "Maks. grænse",
        "orderBy": "Sortér efter"
      },
      "pane": {
        "apply": "Anvend på formularen",
        "dirty": "redigeret — ikke anvendt",
        "format": "Formatér",
        "label": "Rutedefinition, JSON",
        "more": "{first} (+{n} mere)",
        "revert": "Fortryd",
        "synced": "synkroniseret med formularen",
        "title": "Rutedefinition"
      },
      "rate": {
        "hour": "time",
        "label": "Forespørgselsgrænse og svar",
        "minute": "minut",
        "per": "Pr.",
        "requests": "Forespørgsler",
        "second": "sekund"
      },
      "refused": {
        "keys": "Hvis du gemmer dette, holder {count, plural, one {# nøgle} other {# nøgler}} op med at virke: {names}."
      },
      "route": "Rute",
      "routePlaceholder": "customers",
      "routeRename": "Kaldere skal skifte til den nye sti.",
      "save": "Gem ændringer",
      "shape": {
        "array": "Rent array",
        "label": "Svarets form",
        "single": "Enkelt objekt",
        "wrapped": "Pakket ind i '{' data '}'"
      },
      "source": "Kildetabel eller -visning",
      "subtitle": "Konfigurér det visuelt — Adminium skriver rutedefinitionen for dig",
      "titleEdit": "Redigér endpoint",
      "titleNew": "Nyt endpoint"
    },
    "connection": {
      "label": "Forbindelse"
    },
    "create": "Opret nøgle",
    "endpoints": {
      "col": {
        "auth": "Godkendelse",
        "methods": "Metoder",
        "rate": "Forespørgselsgrænse",
        "route": "Rute"
      },
      "custom": "TILPASSET",
      "edit": "Redigér endpoint",
      "explore": "Udforsk API",
      "new": "Nyt endpoint",
      "subtitle": "Genereret ud fra dit skema. Nøgler begrænses til disse.",
      "title": "Endpoints",
      "unavailable": "IKKE TILGÆNGELIG"
    },
    "keys": {
      "col": {
        "access": "Adgang",
        "actions": "Handlinger",
        "key": "Nøgle",
        "lastUsed": "Sidst brugt",
        "name": "Navn"
      },
      "count": "{n, plural, one {# nøgle} other {# nøgler}}",
      "empty": "Ingen aktive nøgler. Opret en for at komme i gang.",
      "hide": "Skjul nøgle",
      "kind": {
        "browser": "BROWSER",
        "server": "SERVER"
      },
      "never": "Aldrig",
      "reveal": "Vis nøgle",
      "revoke": "Tilbagekald",
      "revokeConfirm": {
        "body": "Alt, der bruger denne nøgle, holder op med at virke med det samme. Det kan ikke fortrydes.",
        "confirm": "Tilbagekald nøgle",
        "prompt": "Skriv „{name}“ for at bekræfte",
        "title": "Tilbagekald {name}?"
      },
      "revokeFailed": "Nøglen kunne ikke tilbagekaldes. Den er stadig aktiv.",
      "title": "Aktive nøgler",
      "untitled": "Unavngivet nøgle",
      "staffOnly": "Kun personaleskærm",
      "staffOnlyHint": "Svarer kun på en skærm, hvor en medarbejder med {role} er logget ind."
    },
    "method": {
      "BATCH": {
        "desc": "Masseindsættelse eller upsert, op til 500 rækker",
        "title": "Batch"
      },
      "DELETE": {
        "desc": "Fjern en række ud fra primærnøglen",
        "title": "Slet"
      },
      "GET": {
        "desc": "Vis rækker, og hent en enkelt post",
        "title": "Læs"
      },
      "PATCH": {
        "desc": "Delvis opdatering af en række ud fra primærnøglen",
        "title": "Opdatér"
      },
      "POST": {
        "desc": "Indsæt en ny række",
        "title": "Opret"
      },
      "PUT": {
        "desc": "Erstat en hel række ud fra primærnøglen",
        "title": "Erstat"
      }
    },
    "note": {
      "notRegistered": "Det offentlige API er ikke slået til på denne server. Sæt ADMINIUM_PUBLIC_API_ORIGINS, og genstart — nøgler oprettet her virker fra da af.",
      "off": "Det offentlige API er slået fra, så ingen nøgle virker lige nu.",
      "offLink": "Åbn arbejdsområdeindstillinger"
    },
    "quick": {
      "body": "Godkend forespørgsler med din nøgle i Authorization-headeren.",
      "title": "Kom hurtigt i gang"
    },
    "sheet": {
      "allMethods": "Vælg alle metoder",
      "app": {
        "label": "App",
        "none": "Ingen"
      },
      "cancel": "Annuller",
      "clear": "Ryd",
      "close": "Luk",
      "count": "{permissions, plural, one {tilladelse} other {tilladelser}} på {endpoints, plural, one {# endpoint} other {# endpoints}}",
      "deselectAll": "Fravælg alle",
      "edit": "Redigér endpoint",
      "expires": {
        "d30": "30 dage",
        "d90": "90 dage",
        "label": "Udløber",
        "never": "Aldrig"
      },
      "filter": "Filtrér endpoints",
      "focusMeta": "{source} · {rows} rækker · grænse {limit}, sortering {order}",
      "focusMetaNoRows": "{source} · grænse {limit}, sortering {order}",
      "footer": {
        "empty": "Vælg mindst én metode for at oprette en nøgle.",
        "more": "+{n} mere",
        "refused": "Nøglen kan ikke oprettes endnu: {issue}",
        "summary": "Nøglen vil kunne kalde {paths}"
      },
      "kind": {
        "browser": "Browser",
        "label": "Bruges fra",
        "server": "Server"
      },
      "layout": {
        "label": "Layout",
        "list": "Liste",
        "panes": "Ruder"
      },
      "name": {
        "label": "Nøglens navn",
        "placeholder": "f.eks. Worker til ordresynkronisering"
      },
      "newEndpoint": "Nyt endpoint",
      "readOnly": "Forvalg: kun læsning",
      "rowMeta": "{source} · {rows} rækker",
      "rowMetaNoRows": "{source}",
      "selectAll": "Vælg alle",
      "selectAllShort": "Vælg alle",
      "submit": "Opret nøgle",
      "subtitle": "Vælg de endpoints og metoder, denne nøgle må kalde",
      "title": "Opret API-nøgle",
      "toggleAll": "Slå alle metoder til/fra",
      "unsupported": "{count, plural, one {{methods} er ikke eksponeret på denne rute. Redigér endpointet for at slå den til.} other {{methods} er ikke eksponeret på denne rute. Redigér endpointet for at slå dem til.}}"
    },
    "stats": {
      "endpoints": "Endpoints",
      "keys": "Aktive nøgler",
      "requests": "Forespørgsler · 24 t"
    },
    "subtitle": "Administrér programmatisk adgang til dit arbejdsområde",
    "summary": "{endpoints, plural, one {# endpoint} other {# endpoints}} · {methods, plural, one {# metode} other {# metoder}}",
    "title": "API-nøgler og tokens"
  },
  "surfacePages": {
    "guest": {
      "title": "{app} er ikke tilgængelig lige nu.",
      "body": "Prøv igen senere."
    },
    "staff": {
      "appOff": "{app} er slået fra indtil videre.",
      "sideOff": "Personaleskærmene i {app} er slået fra.",
      "advice": "Bed din leder om at slå det til under {app} → Indstillinger.",
      "signOut": "Log ud",
      "noAccess": "Denne konto kan ikke åbne {app}.",
      "noAccessAdvice": "Bed din leder om en rolle, der åbner {app}."
    },
    "notFound": {
      "title": "Siden blev ikke fundet",
      "body": "Der er intet på denne adresse. Tjek linket, og prøv igen."
    }
  },
  "appSettings": {
    "notInstalled": "Denne app er ikke installeret",
    "backToApps": "Tilbage til apps",
    "statusDisabled": "Slået fra",
    "statusUpdate": "Opdatering tilgængelig · {version}",
    "statusActive": "Aktiv",
    "version": "Version {version} · af {publisher}",
    "open": "Åbn appen",
    "upToDate": "Opdateret",
    "update": "Opdater",
    "saveFailed": "Ændringen blev ikke gemt",
    "screens": "Skærmsæt",
    "sideStaff": "Personaleskærme",
    "sideCustomer": "Kundeskærme",
    "sideAppOff": "Hele appen er slået fra.",
    "staffOnHelp": "Dit team logger ind her med deres egne konti.",
    "customerOnHelp": "Kunder bruger disse sider. De er offentlige.",
    "staffOffHelp": "Disse skærme vises ikke. Intet er slettet.",
    "customerOffHelp": "Kunder ser “ikke tilgængelig”. Intet er slettet.",
    "sideSwitch": "{side}, til eller fra",
    "on": "Til",
    "off": "Fra",
    "whereItLives": "Hvor den ligger",
    "ownAddress": "På sin egen adresse",
    "insideDashboard": "I dashboardet",
    "copyAddress": "Kopiér adresse",
    "copied": "Kopieret",
    "copy": "Kopiér",
    "addDomain": "Tilføj et domæne",
    "preview": "Forhåndsvis",
    "domainField": "Domæne",
    "addDomainSave": "Tilføj",
    "data": "Data",
    "noTables": "Denne app bruger ingen tabeller.",
    "rows": "{count, plural, one {# række} other {# rækker}}",
    "activity": {
      "staged": "Uploadet af {actor}",
      "installed": "Installeret af {actor}",
      "updated": "Opdateret af {actor}",
      "disabled": "Slået fra af {actor}",
      "enabled": "Slået til af {actor}",
      "settings": "Indstillinger ændret af {actor}",
      "domains": "Domæner ændret af {actor}",
      "instances": "Instanser ændret af {actor}",
      "renamed": "Tabeller omdøbt af {actor}",
      "title": "Aktivitet",
      "none": "Intet endnu.",
      "sampleAdded": "Eksempeldata tilføjet af {actor}",
      "sampleRemoved": "Eksempeldata fjernet af {actor}"
    },
    "danger": "Farezone",
    "disabledNote": "Appen er slået fra. Aktivér bringer præcis det tilbage, der var.",
    "disableNote": "Skjuler appen overalt og stopper dens endpoints. Intet slettes.",
    "enable": "Aktivér",
    "disable": "Deaktivér",
    "uninstallNote": "Fjerner appens filer og sider. Beholder tabellerne og dataene.",
    "uninstall": "Afinstaller",
    "disableTitle": "Deaktivér {app}?",
    "close": "Luk",
    "nothingDeleted": "Intet slettes.",
    "enableBrings": "Aktivér bringer præcis det tilbage, der var.",
    "cancel": "Annuller",
    "disableLine1": "Dens sektion skjules for alle.",
    "disableLine2": "Dens skærme og egne endpoints holder op med at svare.",
    "disableLine3": "Tabellerne, posterne og indstillingerne forbliver, som de er.",
    "crumb": "Apps",
    "sampleLedger": "Adminiums liste over eksempelposter"
  },
  "uninstall": {
    "files": "Appens filer",
    "pages": "{count, plural, one {# side} other {# sider}}",
    "keys": "{count, plural, one {Dens browsernøgle} other {Dens # browsernøgler}}",
    "settings": "Dens indstillinger",
    "hosts": "{count, plural, one {Dens domæne} other {Dens # domæner}}",
    "tables": "{count, plural, one {# tabel og alle dens poster} other {# tabeller og alle deres poster}}",
    "editedPages": "Sider, du har redigeret, bliver som almindelige sider",
    "audit": "Dens poster i revisionsloggen",
    "title": "Afinstaller {app}?",
    "close": "Luk",
    "planFailed": "Det, der ville blive fjernet, kunne ikke læses",
    "removed": "Fjernet",
    "kept": "Beholdt",
    "roleCascade": "Fjernes denne rolle, mister {members, plural, one {# person} other {# personer}} den, og {keys, plural, one {# tilknyttet API-nøgle} other {# tilknyttede API-nøgler}} slettes. De nøgler holder op med at virke med det samme.",
    "dropTitle": "Slet også dens tabeller og data",
    "dropBody": "{count, plural, one {Sletter den # tabel, den lavede, og alle dens poster.} other {Sletter de # tabeller, den lavede, og alle deres poster.}} Det kan ikke fortrydes.",
    "typeKey": "Skriv appens nøgle {key} for at bekræfte.",
    "failed": "Appen blev ikke afinstalleret",
    "cancel": "Annuller",
    "confirmDrop": "Afinstaller og slet data",
    "confirm": "Afinstaller",
    "rules": "{count, plural, one {Dens kolonneregel} other {Dens # kolonneregler}}"
  },
  "sampleData": {
    "title": "Eksempeldata",
    "add": "Tilføj eksempeldata",
    "installNote": "nogle få eksempelposter i appens tabeller, så der er noget at prøve den med. Du kan fjerne dem med ét klik.",
    "remove": "Fjern eksempeldata",
    "keptNotice": "{count, plural, one {# eksempelpost bliver: dine egne poster bruger den, eller du har ændret den.} other {# eksempelposter bliver: dine egne poster bruger dem, eller du har ændret dem.}}",
    "notLoaded": "Ikke indlæst",
    "loadedCount": "Indlæst · {count, plural, one {# post} other {# poster}}",
    "loaded": "Indlæst · {count, plural, one {# post} other {# poster}} · {date}",
    "addSubtitle": "I {connection}",
    "close": "Luk",
    "addBodyNoConnection": "Nogle få eksempelposter i appens tabeller. Intet andet røres.",
    "addBody": "Nogle få eksempelposter i appens tabeller. Intet andet i {connection} røres.",
    "images": "Billeder, lagt i Filer",
    "total": "I alt",
    "records": "{count, plural, one {# post} other {# poster}}",
    "none": "Denne app har ingen eksempeldata med",
    "adding": "Tilføjer eksempeldata",
    "addFailed": "Eksempeldataene blev ikke tilføjet",
    "addFailedBody": "Eksempeldataene blev ikke tilføjet. Intet blev skrevet.",
    "cancel": "Annuller",
    "removeSubtitle": "{count, plural, one {# post tilføjet {date}} other {# poster tilføjet {date}}}",
    "removeBody": "Adminium har ført en liste over hver post, det tilføjede, så det fjerner præcis dem.",
    "planFailed": "Det, der ville blive fjernet, kunne ikke læses",
    "removes": "Fjernes",
    "kept": "Beholdes",
    "usedBy": "{count, plural, one {bruges af # af dine egne poster} other {bruges af # af dine egne poster}}",
    "keepChanged": "Behold dem, jeg har ændret",
    "changedList": "{count, plural, one {# eksempelpost, du har redigeret: {names}.} other {# eksempelposter, du har redigeret: {names}.}}",
    "removeFailed": "Eksempeldataene blev ikke fjernet",
    "removeConfirm": "Fjern",
    "banner": "Eksempeldata er indlæst",
    "bannerRemove": "Fjern dem"
  },
  "appPublicAccess": {
    "title": "Offentlig adgang",
    "intro": "Appens kundeskærme skal kunne:",
    "availability": "Læse ledige eller optagne tider i {table}",
    "claim": "Slå deres egne {table} op via {fields}",
    "create": "Tilføje til {table}",
    "update": "Ændre {table}",
    "read": "Læse {table}",
    "later": "kommer i en senere version",
    "allow": "Tillad denne offentlige adgang",
    "helper": "Du kan begrænse den senere på siden API-nøgler.",
    "cannotGrant": "Kun en, der må administrere API-nøgler, kan tillade den, så appen installeres uden.",
    "warning": {
      "apiOff": "Den offentlige API er slået fra, så intet af dette svarer, før den er slået til.",
      "originSelf": "De tilladte oprindelser omfatter ikke “self”, så appens egne sider på denne server kan ikke kalde den.",
      "timeZone": "Denne database har ingen tidszone, som den offentlige API skal bruge til datoer og tidspunkter.",
      "noEmail": "E-mail er ikke sat op, så gæster får ingen bekræftelse."
    },
    "createConfirmed": "Tilføje til {table} og få en bekræftelsesmail"
  },
  "addOnNeeded": {
    "appDisabled": "Slået fra – den har stadig brug for den",
    "appInstalling": "Installationen er ikke færdig – den har stadig brug for den",
    "close": "Luk",
    "confirm": {
      "switchOff": "Slå den fra alligevel",
      "uninstall": "Afinstallér alligevel"
    },
    "lead": {
      "feature": "{features} i {app} slås fra.",
      "switchOff": "{addOn} kan ikke slås fra for {app}. {app} har brug for den.",
      "uninstall": "{addOn} kan ikke afinstalleres. {count, plural, one {{apps} har brug for den.} other {{apps} har brug for den.}}"
    },
    "note": {
      "feature": "Resten af {apps} virker uden den.",
      "switchOff": "Afinstallér {app} først for at slå den fra.",
      "uninstall": "Afinstallér {apps} først for at afinstallere den."
    },
    "openApp": "Åbn {app}",
    "subtitle": "v{version}",
    "subtitleNamed": "{addOn} · v{version}",
    "title": {
      "switchOff": "Slå fra for {app}",
      "switchOffAsk": "Slå fra for {app}?",
      "uninstall": "Afinstallér {addOn}",
      "uninstallAsk": "Afinstallér {addOn}?"
    },
    "useFeature": "{app} (Kræves til: {features})",
    "useRequired": "{app} (Påkrævet)",
    "useSuggested": "{app} (Foreslået)",
    "usedBy": "Bruges af",
    "usedByLine": "Bruges af {apps}"
  },
  "appAddOns": {
    "alsoUsedBy": "Bruges også af {apps}",
    "block": {
      "download": "Download {addOn} først: den findes i tilføjelseskataloget, men ikke på denne server endnu.",
      "noVersion": "{app} har brug for {addOn} {version}, og ingen sådan version er tilgængelig her.",
      "problem": "{addOn} kan ikke installeres sammen med {app}. Dens række siger hvorfor.",
      "tooOld": "{app} har brug for {addOn} {version}.",
      "unavailable": "{app} har brug for {addOn}, som ikke er tilgængelig her.",
      "untick": "{addOn} kan ikke bruges med {app} her. Fjern fluebenet for at installere {app} uden den."
    },
    "card": {
      "connect": "Forbind",
      "connected": "{addOn} forbundet til {app}",
      "consentConnect": "Den bliver forbundet til {app}.",
      "featureOff": "{features} er slået fra: siderne er ikke i sidepanelet, før {addOn} er installeret og forbundet.",
      "install": "Installér",
      "installed": "{addOn} installeret og forbundet til {app}",
      "metaAbsent": "Ikke installeret · v{version} · {source}",
      "metaInstalled": "Installeret · v{version} · {source}",
      "metaOld": "Installeret · v{version}",
      "metaUnavailable": "Ikke installeret · {source}",
      "notConnected": "Ikke forbundet til {app}",
      "openSettings": "Åbn dens indstillinger"
    },
    "done": {
      "installed": "Også installeret: {names}. {count, plural, one {Dens indstillinger findes} other {Deres indstillinger findes}} under {addOns}.",
      "updated": "Også opdateret: {names}. {count, plural, one {Dens indstillinger findes} other {Deres indstillinger findes}} under {addOns}."
    },
    "download": "Download den",
    "downloading": "Downloader … {pct} %",
    "grant": "{roles} kan ændre dens indstillinger, som deles af alle de apps, den betjener.",
    "howTo": "Sådan tilføjer du en tilføjelse",
    "intro": "{app} fungerer med {count, plural, one {denne tilføjelse} other {disse tilføjelser}}.",
    "meta": "v{version} · {source}",
    "needsFloor": "{app} kræver {version} eller nyere",
    "needsRange": "{app} kræver {range}",
    "orLater": "{version} eller nyere",
    "pill": {
      "feature": "Kræves til: {features}",
      "required": "Påkrævet",
      "suggested": "Foreslået"
    },
    "plan": {
      "creates": "Opretter {count, plural, one {# tabel} other {# tabeller}} i {connection}: {tables}"
    },
    "running": {
      "attach": "Forbinder {addOn}",
      "connected": "forbundet",
      "install": "Installerer {addOn}",
      "update": "Opdaterer {addOn}"
    },
    "shared": "Tilføjelser deles. Alle andre apps, du installerer, kan også bruge dem.",
    "source": {
      "bundled": "Følger med Adminium",
      "catalog": "Fra tilføjelseskataloget",
      "none": "Følger ikke med denne Adminium, og tilføjelseskataloget har ingen version, den kan bruge",
      "off": "Følger ikke med denne Adminium, og tilføjelseskataloget er slået fra",
      "upload": "Uploadet til denne Adminium"
    },
    "status": {
      "attached": "Allerede forbundet til {app}",
      "downloadFirst": "Installeres, når den er downloadet fra tilføjelseskataloget",
      "tooOld": "Installeret v{installed} – {need}",
      "unavailable": "{addOn} er ikke tilgængelig i denne Adminium",
      "willConnect": "Installeret · v{version} · bliver forbundet til {app}",
      "willInstall": "Bliver installeret",
      "wontConnect": "Installeret · v{version} · bliver ikke forbundet"
    },
    "stopped": {
      "atAddOns": "Installationen af de tilføjelser, den har brug for, mislykkedes, så intet efter det blev kørt."
    },
    "title": "Tilføjelser",
    "uninstall": {
      "kept": "{addOn} forbliver installeret. Afinstallér den under Tilføjelser, hvis intet andet bruger den.",
      "link": "Dens forbindelse til {addOn}"
    },
    "updateToo": "Opdatér den også"
  },
  "featurePage": {
    "ask": "En person, der administrerer apps, kan installere den.",
    "body": "Denne side virker kun med {count, plural, one {en tilføjelse} other {tilføjelser}}, som appen ikke har her endnu, så den er ikke i sidepanelet. Den kommer tilbage, når {count, plural, one {den} other {de}} er installeret og forbundet til appen.",
    "open": "Åbn appens indstillinger",
    "title": "{page} kræver en tilføjelse"
  }
} as const;
