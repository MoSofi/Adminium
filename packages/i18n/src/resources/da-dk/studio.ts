// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/studio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "title": "Studio",
  "settings": {
    "title": "Indstillinger",
    "workspaceSection": "Arbejdsområde",
    "globalDefaultsNav": "Globale standarder"
  },
  "source": {
    "engine": {
      "label": "Databasemotor",
      "postgres": "PostgreSQL",
      "mysql": "MySQL / MariaDB",
      "sqlite": "SQLite"
    },
    "format": {
      "label": "Skemaformat",
      "helper": "Lad automatisk registrering være slået til, medmindre den tager fejl.",
      "auto": "Registrér automatisk",
      "sql": "SQL DDL / pg_dump",
      "prisma": "Prisma-skema",
      "drizzle": "Drizzle ORM",
      "typeorm": "TypeORM-entiteter",
      "sequelize": "Sequelize-modeller",
      "rails": "Rails schema.rb",
      "django": "Django models.py",
      "json": "Adminium JSON"
    },
    "sqlite": {
      "file": "Sti til databasefil",
      "helper": "SQLite er en fil, ikke en server — angiv den absolutte sti på den maskine, der kører Adminium."
    },
    "file": {
      "detectedAs": "Registreret: {format}",
      "moreWarnings": "+{count} flere advarsler — den fulde liste vises i analysetrinnet.",
      "dropTitle": "Slip din skemafil her, eller gennemse",
      "dropHint": "SQL DDL / pg_dump, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, Django-modeller, Adminium JSON",
      "pitch": "Ingen databaseforbindelse påkrævet — vi fortolker din skemafil og bygger de samme dashboards.",
      "parsing": "Læser den uploadede skemafil…",
      "tables": "tabeller",
      "columns": "kolonner",
      "warnings": "advarsler",
      "errorTitle": "Kunne ikke fortolke filen",
      "parseFailed": "Vi kunne ikke fortolke den fil. Hvis auto-genkendelsen gættede forkert, så vælg formatet eksplicit og prøv igen.",
      "unsupported": "Formatet blev ikke genkendt — SQL DDL, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, Django-modeller og Adminium JSON understøttes. Vælg ét eksplicit og prøv igen.",
      "requestFailed": "Upload mislykkedes — tjek din forbindelse og prøv igen."
    },
    "title": "Forbind din database",
    "subtitle": "Peg Adminium mod en database, så genererer vi et admin-dashboard ud fra dens skema.",
    "name": "Forbindelsesnavn",
    "namePlaceholder": "Produktions-Postgres",
    "modeLabel": "Kildeinputtilstand",
    "mode": {
      "dsn": "Forbindelsesstreng",
      "fields": "Enkelte felter",
      "file": "Skemafil"
    },
    "dsn": {
      "label": "Forbindelsesstreng",
      "helper": "postgres://bruger:kodeord@vaert:5432/database — mysql:// og sqlite: virker også.",
      "incomplete": "Tilføj vært og database, f.eks. postgres://user@host:5432/db",
      "invalidScheme": "Ukendt skema — forventede postgres://, mysql://, mariadb:// eller sqlite:",
      "quickFill": "Hurtig udfyldning:"
    },
    "fields": {
      "host": "Vært",
      "port": "Port",
      "database": "Database",
      "user": "Bruger",
      "password": "Adgangskode",
      "ssl": "SSL-tilstand",
      "preview": "Forhåndsvisning af forbindelsesstreng:"
    },
    "readOnlyRole": {
      "title": "Brug en skrivebeskyttet rolle",
      "body": "Adminium skriver aldrig til din database — opsætningen bruger kun skema-metadata. Vi anbefaler en dedikeret bruger med rene SELECT-rettigheder; hvor Adminium gemmer sine egne tabeller, beslutter du i metalagringstrinnet."
    }
  },
  "capability": {
    "mysqlApproxRows": "MySQL-rækkeantal er estimater fra lagringsmotoren (kan afvige op til ±40 %) — vises med ≈.",
    "mysqlFkEnum": "MySQL’s FK-/enum-metadata er svagere: MyISAM-tabeller deklarerer ingen fremmednøgler, enums er kolonnetyper som enum(…), og CHECK-begrænsninger kræver MySQL 8.0.16+ / MariaDB 10.2+.",
    "sqliteCheckEnums": "SQLite har ingen indbygget enum-type — enums syntetiseres fra CHECK (col IN (…))-begrænsninger.",
    "sqliteNoComments": "SQLite har ingen kolonnekommentarer — brug skema-remap-editoren til at tilføje etiketter.",
    "importNoRowCounts": "Skemafiler indeholder ingen rækkeantal — tabellisten viser — i stedet for opdigtede tal.",
    "importNoLiveHealth": "Ingen live databaseforbindelse — sundhedstjek og registrering af skemadrift er ikke tilgængelige for denne kilde.",
    "rowsUnavailable": "Skemafiler har ingen live database — rækkeantal er ukendte, indtil du forbinder en.",
    "rowsRunAnalyze": "Intet estimat endnu — kør ANALYZE på databasen for at få rækkeantal.",
    "rowsNoEstimate": "Motoren rapporterede intet estimat for denne tabel.",
    "rowsApproximate": "Estimat fra lagringsmotoren — kan afvige op til ±40 % på InnoDB."
  },
  "test": {
    "log": {
      "moreWarnings": "+{count} flere parser-advarsler",
      "connecting": "Etablerer sikker forbindelse…",
      "connected": "Forbundet ({latency} ms) · skrivebeskyttet introspektion",
      "connectFailed": "Forbindelsen mislykkedes.",
      "readingSchema": "Læser skema: public",
      "readingFile": "Læser den uploadede skemafil…",
      "parsingFile": "Fortolker {file}…",
      "detected": "Registrerede {tables} tabeller · {columns} kolonner",
      "found": "Fandt {tables} tabeller · {columns} kolonner",
      "mapping": "Kortlægger kolonnetyper → inputwidgets",
      "relations": "Registrerer relationer…",
      "piiScan": "Scanner efter PII-kolonner…",
      "piiDone": "PII-scanning fuldført — {count} kolonner maskeret som standard",
      "piiDoneUnknown": "PII-scanning fuldført",
      "jobFailed": "Introspektion mislykkedes.",
      "networkFailed": "Anmodningen mislykkedes — tjek din forbindelse og prøv igen.",
      "ready": "Klar"
    },
    "title": "Analyserer dit skema",
    "subtitle": "Introspekterer tabeller, kolonner og relationer. Det tager et par sekunder.",
    "trust": "Vi læser kun dit skema og dine data. Intet ændres.",
    "errorTitle": "Forbindelsen mislykkedes",
    "retry": "Prøv igen",
    "logLabel": "Introspektionslog",
    "hint": {
      "auth": "Godkendelse mislykkedes — tjek brugernavn og adgangskode i din DSN.",
      "hostUnreachable": "Vært utilgængelig — tjek værtsnavn og port, og at databasen accepterer forbindelser fra denne maskine (tilføj vores IP'er til tilladelseslisten).",
      "metaPlacement": "Denne kilde kan ikke huse Adminiums metatabeller — fortsæt med en separat metadatabase.",
      "permission": "Rollen fik forbindelse, men mangler skema-læserettigheder — giv USAGE på skemaet til din introspektionsrolle.",
      "timeout": "Databasen svarede ikke i tide — tjek netværkssti og belastning, og prøv igen.",
      "tls": "TLS-forhandling mislykkedes — prøv sslmode=require, eller upload det CA-certifikat din server forventer.",
      "unknown": "Forbindelsen mislykkedes — kontrollér DSN'en og prøv igen."
    }
  },
  "tables": {
    "importNoCounts": "Skemafiler indeholder ingen rækkeantal — kolonnen viser —, indtil en live database er forbundet.",
    "title": "Vælg dine tabeller",
    "subtitle": "Vælg hvilke der skal med. Du kan altid ændre det.",
    "search": "Filtrér tabeller…",
    "listLabel": "Tabeller der kan medtages",
    "emptyFilter": "Ingen tabeller matcher dit filter.",
    "pii": "PII",
    "highVolume": "stor volumen",
    "highVolumeNote": "Tabeller med over 100.000 rækker starter fravalgt — driftstabeller hører sjældent hjemme i et dashboard.",
    "joinHidden": "{count} join-/systemtabeller er skjult på forhånd — de driver stadig mange-til-mange-relationer."
  },
  "hub": {
    "title": "Dataforbindelser",
    "subtitle": "{healthy, number} af {total, plural, one {# forbindelse} other {# forbindelser}} sunde",
    "connectNew": "Ny forbindelse",
    "stats": {
      "connections": "Forbindelser",
      "healthy": "Sunde",
      "tables": "Inkluderede tabeller",
      "pages": "Genererede sider"
    },
    "status": {
      "connected": "Forbundet",
      "error": "Fejl",
      "unconfigured": "Kladde",
      "testing": "Tester…",
      "paused": "Sat på pause"
    },
    "card": {
      "readOnly": "Skrivebeskyttet",
      "tables": "Tabeller",
      "pages": "Sider",
      "latency": "Latenstid",
      "latencyMs": "{latency, number} ms",
      "lastIntrospected": "Senest introspiceret",
      "never": "Aldrig",
      "timezone": "Tidszone",
      "timezoneGuessed": "fra denne server",
      "paused": "Adminium opretter ikke forbindelse til denne database. Dens sider indlæses igen, når du genoptager den.",
      "pausedSince": "Sat på pause {when} – Adminium opretter ikke forbindelse til denne database. Dens sider indlæses igen, når du genoptager den."
    },
    "action": {
      "test": "Test",
      "reintrospect": "Introspicer igen",
      "reintrospectFile": "Skemafil-kilder har ingen aktiv database — upload filen igen i stedet.",
      "remap": "Ommap skema",
      "delete": "Slet",
      "regional": "Regionale indstillinger",
      "pause": "Sæt på pause",
      "resume": "Genoptag",
      "pausedHint": "Denne forbindelse er sat på pause – genoptag den for at nå databasen.",
      "rename": "Omdøb"
    },
    "regional": {
      "title": "Regionale indstillinger",
      "intro": "De beskriver den virksomhed, databasen tilhører — ikke den, der læser. Apps, der leveres af Adminium, henter dem her.",
      "timezone": "Tidszone",
      "timezoneHelper": "Datoer og klokkeslæt vises i denne tidszone. Uden en falder Adminium-hostede apps tilbage til UTC og skriver det på skærmen.",
      "guessedTitle": "Denne tidszone kom fra serveren",
      "guessedBody": "Adminium hentede den fra den maskine, det kører på — ingen her har valgt den. Gem for at bekræfte den, eller vælg den tidszone, virksomheden faktisk arbejder i.",
      "timezonePlaceholder": "Region/By",
      "currency": "Valuta",
      "currencyHelper": "Bruges til at formatere beløb. Valgfri — undlader du den, påvirker det kun formateringen.",
      "currencyPlaceholder": "ISO-4217-kode",
      "notSet": "Ikke angivet",
      "noMatch": "Ingen matchende zone",
      "noMatchCurrency": "Ingen matchende valuta",
      "save": "Gem",
      "failed": "De regionale indstillinger kunne ikke gemmes",
      "saved": "Regionale indstillinger opdateret"
    },
    "test": {
      "ok": "Forbindelsen er sund · {latency, number} ms",
      "failed": "Forbindelsestest mislykkedes"
    },
    "introspect": {
      "noChanges": "Skemaet er uændret — intet nyt snapshot.",
      "updated": "Skemaet er introspiceret igen",
      "masksProposed": "{count, plural, one {# kolonne} other {# kolonner}} foreslået til maskering — gennemgå i ommapnings-editoren.",
      "failed": "Introspektion mislykkedes. Prøv igen."
    },
    "delete": {
      "title": "Slet forbindelse",
      "body": "Dette sletter “{name}” og de genererede sider. Selve din database røres aldrig.",
      "prompt": "Skriv {name} for at bekræfte",
      "confirm": "Slet forbindelse",
      "cancel": "Annuller",
      "close": "Luk",
      "success": "Forbindelsen “{name}” er slettet",
      "failed": "Forbindelsen kunne ikke slettes. Prøv igen."
    },
    "empty": {
      "title": "Ingen datakilder endnu",
      "body": "Forbind en database, så genererer Adminium dit adminpanel ud fra dens skema.",
      "cta": "Forbind en database"
    },
    "hostedApps": "Hostede apps",
    "subtitlePaused": "{healthy, number} af {total, plural, one {# forbindelse} other {# forbindelser}} sunde · {paused, number} sat på pause",
    "pause": {
      "title": "Sæt denne forbindelse på pause?",
      "body": "Adminium åbner ikke længere nogen forbindelse til “{name}”. {pages, plural, one {# side} other {# sider}}, planlagte rapporter og hostede apps holder op med at indlæse data, indtil du genoptager den.",
      "keeps": "Intet slettes – forbindelsen, dens skema og {pages, plural, one {dens # side} other {dens # sider}} bevares alle, og ét klik henter dem tilbage.",
      "confirm": "Sæt forbindelsen på pause",
      "pausedToast": "Forbindelsen “{name}” er sat på pause",
      "resumedToast": "Forbindelsen “{name}” er genoptaget",
      "pauseFailed": "Forbindelsen kunne ikke sættes på pause. Prøv igen.",
      "resumeFailed": "Forbindelsen kunne ikke genoptages. Prøv igen."
    },
    "rename": {
      "title": "Omdøb forbindelse",
      "label": "Navn",
      "helper": "Hvad denne database hedder i hele Adminium — kortet, sidepanelgruppen over dens sider og hver vælger, der tilbyder den. Selve databasen omdøbes ikke.",
      "save": "Omdøb",
      "saved": "Forbindelse omdøbt",
      "failed": "Forbindelsen kunne ikke omdøbes"
    }
  },
  "settingsHub": {
    "title": "Arbejdsområdeindstillinger",
    "subtitle": "Identitet, sikkerhed og destruktive handlinger for dette arbejdsområde.",
    "save": "Gem ændringer",
    "saved": "Arbejdsområdeindstillinger opdateret",
    "saveFailed": "Arbejdsområdeindstillingerne kunne ikke gemmes. Prøv igen.",
    "superAdminOnlyTitle": "Superadmin påkrævet",
    "superAdminOnly": "Kun en superadmin kan ændre arbejdsområdets identitet og sikkerhedsindstillinger.",
    "identity": {
      "heading": "Arbejdsområdets identitet",
      "appName": {
        "label": "Applikationsnavn",
        "helper": "Vises i sidepanelet, browsertitlen og e-mails.",
        "error": "Angiv et navn på højst 60 tegn."
      },
      "logo": {
        "label": "Logo",
        "drop": "Slip et billede her",
        "helper": "PNG, JPEG, WebP, GIF eller SVG på op til 1 MB. Erstatter det indbyggede mærke overalt.",
        "upload": "Upload logo",
        "replace": "Erstat logo",
        "remove": "Fjern",
        "uploaded": "Logo opdateret",
        "removed": "Logo fjernet",
        "tooLarge": "Billedet er større end 1 MB.",
        "badType": "Vælg et PNG-, JPEG-, WebP-, GIF- eller SVG-billede.",
        "undo": "Fortryd"
      },
      "showVersion": {
        "label": "Version i sidepanelet",
        "helper": "Buildnummeret ved siden af logoet. Slået fra skjuler, hvilken version du kører."
      }
    },
    "security": {
      "heading": "Sikkerhed",
      "require2fa": {
        "label": "Kræv tofaktorgodkendelse",
        "desc": "Alle medlemmer skal aktivere 2FA for at logge ind.",
        "note": "Vejledende, ikke en spærring: medlemmer uden 2FA sendes til opsætningen og kan ikke slå den fra igen, men deres login blokeres aldrig, og API-nøgler er ikke omfattet."
      },
      "allowSignup": {
        "label": "Tillad selvregistrering",
        "desc": "Alle kan oprette en konto — slået fra er arbejdsområdet kun på invitation."
      },
      "sessionTtl": {
        "label": "Sessionslevetid (timer)",
        "error": "Mellem {min, number} og {max, number} timer."
      },
      "passwordMin": {
        "label": "Minimal adgangskodelængde",
        "error": "Mellem {min, number} og {max, number} tegn."
      }
    },
    "email": {
      "heading": "E-mail (SMTP)",
      "unconfigured": "Der er ikke opsat nogen mailserver, så Adminium kan ikke sende nulstilling af adgangskode, invitationer eller planlagte rapporter.",
      "host": {
        "label": "SMTP-vært",
        "error": "Kun et værtsnavn eller en IP-adresse — uden skema, port eller loginoplysninger."
      },
      "port": {
        "label": "Port",
        "error": "Mellem {min, number} og {max, number}."
      },
      "user": {
        "label": "Brugernavn",
        "helper": "Lad feltet stå tomt, hvis relayet ikke kræver login."
      },
      "pass": {
        "label": "Adgangskode",
        "helper": "Gemmes krypteret og vises aldrig igen. Lad feltet stå tomt for at beholde den nuværende.",
        "error": "Dette brugernavn kræver en adgangskode."
      },
      "from": {
        "label": "Afsenderadresse",
        "helper": "Kun adressen, eller et visningsnavn foran den.",
        "error": "Indtast en e-mailadresse."
      },
      "secure": {
        "label": "Implicit TLS",
        "helper": "Til på port 465. Fra starter i klartekst og skifter med STARTTLS, som port 587 forventer."
      },
      "remove": "Fjern mailserver",
      "review": {
        "removed": "Fjernet",
        "password": "Erstattet"
      }
    },
    "review": {
      "title": "Gem arbejdsområdeindstillinger",
      "subtitle": "Gennemgå dine ændringer, før du gemmer.",
      "confirm": "Gem ændringer",
      "cancel": "Annuller",
      "close": "Luk",
      "on": "Til",
      "off": "Fra",
      "shown": "Vist",
      "hidden": "Skjult",
      "change": "{before} → {after}"
    },
    "defaultsCard": {
      "heading": "Standarder for udseende og sprog",
      "body": "Tema, accentfarve, tæthed og sprog for hele arbejdsområdet findes under globale standarder.",
      "cta": "Åbn globale standarder"
    },
    "danger": {
      "heading": "Farezone",
      "subtitle": "Uigenkaldelige handlinger.",
      "empty": "Intet at slette — ingen forbindelser endnu.",
      "deleteDesc": "Sletter forbindelsen og de genererede sider. Din database røres ikke. Kan ikke fortrydes.",
      "deleteCta": "Slet forbindelse"
    },
    "aiCard": {
      "heading": "AI-berigelse",
      "body": "Konfigurér en AI-udbyder (eller kopiér-indsæt-turen) for at berige etiketter, grupper og relationer.",
      "cta": "Åbn AI-indstillinger"
    },
    "pagesCard": {
      "heading": "Sider",
      "body": "Tilføj, rediger og slet sider, skift hvad hver enkelt viser, og omarranger sidepanelet.",
      "cta": "Administrer sider"
    },
    "translationsCard": {
      "heading": "Sprog og oversættelser",
      "body": "Omformulér hvad som helst i Adminium, vælg hvilke sprog folk kan vælge, og tilføj dine egne.",
      "cta": "Åbn oversættelser"
    }
  },
  "settingsAi": {
    "title": "AI-berigelse",
    "subtitle": "Forbind en model, så Adminium kan foreslå etiketter, grupper, relationer og mere — altid gennemgået som en diff, før noget anvendes.",
    "saved": "AI-udbyder gemt",
    "saveFailed": "AI-udbyderen kunne ikke gemmes. Prøv igen.",
    "save": "Gem udbyder",
    "test": "Test forbindelse",
    "testHintDirty": "Gem dine ændringer, før du tester.",
    "testing": "Kontakter udbyderen…",
    "testError": "Testen mislykkedes",
    "testErrorBody": "Kunne ikke nå udbyderen. Tjek nøglen og basis-URL.",
    "testOk": "Forbundet til {model} på {latency} ms",
    "testUnknownModel": "udbyderen",
    "provider": {
      "heading": "AI-udbyder",
      "subtitle": "Vælg, hvordan Adminium når en model til at berige dit skema. Nøgler gemmes krypteret og vises aldrig igen.",
      "active": "Aktiv",
      "anthropic": {
        "label": "Anthropic",
        "desc": "Claude-modeller via Anthropic-API’en."
      },
      "openai": {
        "label": "OpenAI",
        "desc": "GPT-modeller via OpenAI-API’en."
      },
      "openaiCompatible": {
        "label": "OpenAI-kompatibel",
        "desc": "Ethvert endpoint, der taler OpenAI-formatet — Groq, Together, vLLM, LM Studio."
      },
      "ollama": {
        "label": "Ollama (lokal)",
        "desc": "Modeller kører lokalt via Ollama — ingen nøgle, ingen sky."
      },
      "requiresNetwork": "Kræver internet og en API-nøgle",
      "networkDisabledTitle": "Direkte AI-udbydere er slået fra i denne installation",
      "networkDisabledBody": "Dette Adminium er konfigureret uden udgående internetadgang og kan ikke nå en udbyder-API. Brug kopier-indsæt-turen nedenfor — den kræver hverken nøgle eller netværk."
    },
    "configure": {
      "heading": "Konfigurér {provider}"
    },
    "field": {
      "baseUrl": "Basis-URL",
      "baseUrlOptional": "Lad stå, medmindre Ollama kører på en anden vært.",
      "baseUrlHelper": "Endpoint-roden, der leverer /chat/completions.",
      "model": "Model",
      "modelFreeText": "Indtast det præcise model-id, dit endpoint leverer.",
      "modelLive": "Indlæst live fra udbyderen.",
      "modelStatic": "En gennemprøvet liste; skriv et brugerdefineret id efter at have gemt for at opdatere den.",
      "modelLoading": "Indlæser…",
      "modelPlaceholder": "Vælg en model…",
      "key": "API-nøgle",
      "keyStored": "Gemt krypteret. Erstat den for at bruge en anden nøgle.",
      "keyMask": "sk-…{last4}",
      "keyReplace": "Erstat nøgle",
      "keyOptional": "Valgfri — nogle endpoints kræver ingen nøgle.",
      "keyWriteOnly": "Kun skrivning: når den er gemt, vises den aldrig igen.",
      "noKeyTitle": "Ingen API-nøgle nødvendig",
      "noKeyBody": "Ollama kører lokalt, så intet forlader denne maskine."
    },
    "runStatus": {
      "draft": "Kladde",
      "running": "Kører",
      "awaitingResponse": "Afventer svar",
      "validated": "Valideret",
      "applied": "Anvendt",
      "partiallyApplied": "Delvist anvendt",
      "failed": "Mislykkedes",
      "discarded": "Kasseret"
    },
    "byo": {
      "heading": "Ingen nøgle? Brug dit eget AI-værktøj",
      "subtitle": "Kopiér-indsæt-turen — intet forlader denne maskine.",
      "body": "Studio kan generere en selvstændig prompt ud fra dit skema. Kør den i Claude Code, ChatGPT eller et hvilket som helst værktøj, og indsæt derefter den returnerede JSON tilbage i forbindelsesguiden. Samme validering, samme gennemgang, samme resultat som den direkte vej.",
      "guaranteeTitle": "Telemetrifri garanti",
      "guarantee1": "Prompten indeholder kun dit skema og aggregeret statistik — aldrig rækkedata som standard.",
      "guarantee2": "Ingen legitimationsoplysninger, instans-URL eller identifikatorer er indlejret.",
      "guarantee3": "BYO-kørsler foretager ingen netværkskald.",
      "promptVersion": "Prompt {version}",
      "schemaVersion": "Skema {version}",
      "headingRecommended": "Brug dit eget AI-værktøj — ingen nøgle nødvendig",
      "recommended": "Anbefalet"
    },
    "history": {
      "heading": "Kørselshistorik",
      "subtitle": "Tidligere berigelseskørsler. Åbn en for at gennemgå dens forslag.",
      "tableLabel": "Berigelseskørsler",
      "colDate": "Dato",
      "colSource": "Kilde",
      "colStatus": "Status",
      "colChunks": "Blokke",
      "openReview": "Åbn gennemgang for kørslen fra {date}",
      "connection": "Forbindelse",
      "empty": "Ingen berigelseskørsler endnu. Berig et skema fra forbindelsesguiden for at se historik her.",
      "errorTitle": "Kunne ikke indlæse kørsler",
      "errorBody": "Genindlæs siden for at prøve igen.",
      "noConnections": "Forbind først en database — berigelseskørsler registreres pr. forbindelse.",
      "byo": "BYO",
      "directPath": "Direkte"
    }
  },
  "enrich": {
    "title": "Berig med AI",
    "subtitle": "Forfin eventuelt de genererede etiketter, grupper, enums og dashboards med en LLM. Det heuristiske grundlag fungerer uden — dette tilføjer kun forslag, som du gennemgår, før noget anvendes.",
    "intentLabel": "Hvordan vil du berige?",
    "sectionsLegend": "Hvad skal AI’en beslutte?",
    "localesLegend": "Oversæt etiketter til",
    "localeLocked": "(påkrævet)",
    "samplingTitle": "Inkludér eksempelværdier",
    "samplingHint": "Inkluderer op til 20 rigtige værdier pr. ikke-PII-kolonne i prompten.",
    "samplingPreviewTitle": "Hvad forlader denne maskine",
    "samplingPreviewBody": "Op til 20 hyppigste værdier pr. ikke-PII-kolonne, plus min/maks for numeriske og datokolonner. PII-markerede kolonner udtages aldrig. Alt andet forbliver kun aggregeret. Gennemgå den præcise prompt før kopiering (BYO) — intet sendes uden din handling.",
    "noSections": "Vælg mindst én beslutningsgruppe at berige.",
    "generatePrompt": "Generér prompt",
    "startProvider": "Start berigelse",
    "startOver": "Start forfra",
    "copied": "Kopieret",
    "createFailed": "Berigelsesprompten kunne ikke bygges — prøv igen.",
    "createFailedTitle": "Kunne ikke starte",
    "providerFallback": "din AI-udbyder",
    "fileTitle": "AI-berigelse kræver en live-database",
    "fileBody": "Skemafil-kilder har endnu ikke et snapshot at berige. Forbind en live-database for at bruge AI-berigelse, eller fortsæt — det heuristiske grundlag genererer stadig en komplet app.",
    "section": {
      "labels": "Etiketter og beskrivelser",
      "groups": "Navigationsgrupper",
      "enums": "Enum-semantik",
      "relations": "Relationer",
      "keys": "Nøglekolonner",
      "templates": "Sideskabeloner",
      "widgets": "Dashboard-widgets",
      "pii": "PII og maskering",
      "icons": "Ikoner",
      "microcopy": "Mikrotekst"
    },
    "provider": {
      "title": "Brug min AI-udbyder",
      "description": "Kør berigelsen nu mod din konfigurerede udbyder. Du gennemgår hvert forslag som en diff.",
      "unconfigured": "Der er endnu ikke konfigureret nogen AI-udbyder — kopiér en prompt til dit eget værktøj nedenfor, eller konfigurér først en udbyder.",
      "settingsHint": "Vil du køre den direkte?",
      "settingsLink": "Konfigurér en udbyder i Indstillinger → AI",
      "networkDisabled": "Dette Adminium har ingen udgående internetadgang og kan ikke nå en udbyder-API. Brug kopier-indsæt-turen i stedet — samme prompt, samme gennemgang."
    },
    "byo": {
      "cardTitle": "Kopiér en prompt til mit eget AI-værktøj",
      "cardDescription": "Kopiér en selvstændig prompt ind i Claude Code, ChatGPT, hvad som helst — og indsæt så JSON’en tilbage. Ingen nøgle nødvendig, intet forlader denne maskine automatisk.",
      "guidance": "Kør dette i et hvilket som helst AI-værktøj — Claude Code, ChatGPT, hvad som helst. Indsæt den returnerede JSON nedenfor.",
      "promptLabel": "Berigelsesprompt",
      "promptLabelN": "Berigelsesprompt {index} af {total}",
      "tokenChip": "≈ {tokens} tokens",
      "copyPrompt": "Kopiér prompt",
      "copyPromptDone": "Prompt kopieret",
      "download": "Download .md",
      "chunkTabs": "Prompt-dele",
      "chunkTab": "Prompt {index}",
      "chunkValid": "Del {index} valideret",
      "pasteLabel": "Indsæt JSON-svaret",
      "pastePlaceholder": "Indsæt JSON-svaret her…",
      "validate": "Validér",
      "valid": "Svar valideret",
      "mergedTitle": "Alle {count} dele valideret og flettet",
      "mergedTitleSingle": "Svar valideret",
      "mergedBody": "Forslagene er klar til gennemgang mod det heuristiske grundlag.",
      "errorsTitle": "Valideringen fandt {count} problemer",
      "copyErrors": "Kopiér fejl til dit AI-værktøj",
      "copyErrorsDone": "Fejl kopieret",
      "copyErrorsHint": "Indsæt dette tilbage i dit AI-værktøj for at få et rettet svar.",
      "droppedItems": "{count} forslag blev frasorteret under valideringen — gennemgangen viser resten.",
      "pendingTitle": "Validér hver prompt for at fortsætte",
      "pendingBody": "Indsæt JSON-svaret ovenfor og validér det for at fortsætte til gennemgang.",
      "pendingBodyChunked": "Hver del skal valideres, før forslagene flettes. Indsæt og validér hver prompt ovenfor.",
      "requestFailed": "Kunne ikke nå serveren for at validere — prøv igen.",
      "continueReview": "Fortsæt til gennemgang",
      "wholeDocument": "hele dokumentet",
      "cardTitleRecommended": "Kopiér en prompt til mit eget AI-værktøj — anbefalet"
    },
    "direct": {
      "title": "Beriger med AI",
      "subtitle": "Sender dit skema til",
      "building": "Bygger prompt…",
      "logLabel": "Berigelseslog",
      "cancel": "Annullér",
      "back": "Tilbage til valg",
      "retry": "Prøv igen",
      "done": "Berigelse fuldført — gennemgå forslagene.",
      "continueReview": "Fortsæt til gennemgang",
      "failed": "Udbyderkørslen mislykkedes. Tjek dine AI-indstillinger, og prøv igen.",
      "jobFailed": "Berigelseskørslen blev ikke fuldført.",
      "startFailed": "Kunne ikke starte kørslen — prøv igen.",
      "errorTitle": "Berigelse mislykkedes"
    },
    "skip": {
      "title": "Spring over — brug kun heuristik",
      "description": "Generér fra det heuristiske grundlag. Du kan berige senere fra Indstillinger → AI — at springe over straffes aldrig.",
      "confirmTitle": "Fortsætter med heuristik",
      "confirmBody": "Den genererede app vil bruge de heuristiske etiketter, grupper og dashboards. Fortsæt for at generere — du kan køre AI-berigelse når som helst fra Indstillinger → AI."
    }
  },
  "review": {
    "unavailableTitle": "Gennemgangsskærm ikke tilgængelig",
    "unavailableBody": "Denne build indeholder endnu ikke berigelsens gennemgangsskærm (06-T14). Den kommer med diff-og-anvend-flowet."
  },
  "llmRuns": {
    "review": {
      "header": {
        "title": "Gennemgå AI-forslag",
        "model": "Model",
        "snapshot": "Øjebliksbillede",
        "byo": "BYO",
        "pathDirect": "Direkte API",
        "pathByo": "Kopiér-indsæt",
        "agree": "{n} enige",
        "conflict": "{n} konflikt",
        "new": "{n} nye",
        "rejects": "{n} afvisninger",
        "countsAria": "Antal forslag"
      },
      "bulk": {
        "thresholdLabel": "Tillidstærskel",
        "thresholdAria": "Tillidstærskel for “Accepter alle”",
        "acceptAll": "Accepter alle ≥ {pct}%",
        "clear": "Ryd markering"
      },
      "section": {
        "selectAllAria": "Vælg alle i {group}",
        "acceptedCount": "{n} accepteret"
      },
      "group": {
        "labels": "Etiketter og oversættelser",
        "navigation": "Navigation og domæner",
        "enums": "Enum-semantik",
        "relations": "Relationer",
        "keys": "Nøglekolonner",
        "templates": "Sideskabeloner",
        "dashboards": "Dashboards og widgets",
        "pii": "Personoplysninger og maskering",
        "icons": "Ikoner",
        "microcopy": "Mikrotekst"
      },
      "status": {
        "agree": "Stemmer overens",
        "conflict": "Konflikt",
        "new": "Ny",
        "heuristicOnly": "Kun heuristik",
        "rejects": "Afviser heuristik",
        "locked": "Låst"
      },
      "row": {
        "acceptAria": "Accepter {noun}-forslag for {target}",
        "keptEdited": "bevaret – redigeret af dig",
        "rejectsCallout": "AI’en afviser en heuristisk beslutning – bekræft før accept.",
        "showTranslations": "Vis oversættelser",
        "hideTranslations": "Skjul oversættelser",
        "confidenceAria": "Tillid {pct}%",
        "noAi": "Intet AI-forslag"
      },
      "value": {
        "none": "Ingen værdi",
        "absent": "Ingen",
        "dash": "—",
        "display": "Visning",
        "key": "Nøgle",
        "rank": "rang {n}",
        "span": "bredde {n}",
        "tableCount": "{n} tabeller",
        "widgetCount": "{n} widgets",
        "enumWorkflow": "Arbejdsgang",
        "enumCategory": "Kategori",
        "notPii": "Ikke personoplysninger",
        "label": "Etiket",
        "description": "Beskrivelse",
        "subtitle": "Sideundertekst",
        "headline": "Overskrift for tom tilstand",
        "guidance": "Vejledning for tom tilstand"
      },
      "apply": {
        "title": "Anvend {n} forslag",
        "subtitle": "Disse ændringer skrives i én transaktion og kan fortrydes.",
        "empty": "Intet valgt at anvende.",
        "confirm": "Anvend ændringer"
      },
      "footer": {
        "count": "{n} forslag valgt",
        "apply": "Anvend {n} accepterede forslag",
        "failed": "Anvendelse mislykkedes"
      },
      "toast": {
        "applied": "Anvendte {n} forslag",
        "appliedPartial": "Anvendte {n} forslag (nogle sprunget over)",
        "applyFailed": "Kunne ikke anvende forslag",
        "undoFailed": "Kunne ikke fortryde denne ændring"
      },
      "error": {
        "title": "Kunne ikke indlæse denne kørsel"
      },
      "notReady": {
        "title": "Denne kørsel har endnu ingen forslag til gennemgang",
        "body": "En kørsel skal være valideret, før dens forslag kan gennemgås. Generér eller indsæt et svar først."
      },
      "applied": {
        "title": "Denne kørsel er blevet anvendt",
        "body": "De accepterede forslag nedenfor er skrivebeskyttede."
      },
      "empty": {
        "title": "Ingen forslag",
        "body": "Denne kørsel gav ingen forslag til gennemgang."
      },
      "cat": {
        "label": "etiket",
        "key": "nøglekolonner",
        "enum": "enum",
        "relation": "relation",
        "pii": "personoplysninger",
        "template": "sideskabelon",
        "group": "navigationsgruppe",
        "dashboard": "dashboard",
        "widget": "widget",
        "copy": "mikrotekst"
      }
    }
  },
  "wizard": {
    "title": "Ny forbindelse",
    "back": "Tilbage",
    "continue": "Fortsæt",
    "progress": "Opsætningsforløb",
    "persistFailed": "Dit tabelvalg kunne ikke gemmes — prøv igen.",
    "persistFailedTitle": "Kunne ikke gemme",
    "bridgeAppliedTitle": "Forbindelsesstreng modtaget",
    "bridgeAppliedBody": "Overdraget fra adminium.dev af din browser — den gik direkte til denne maskine og blev aldrig uploadet. Tjek den nedenfor, og fortsæt.",
    "bridgeFailedTitle": "Denne overdragelse kunne ikke bruges",
    "bridgeFailedBody": "Den er allerede brugt eller udløbet. Indsæt i stedet din forbindelsesstreng nedenfor.",
    "step": {
      "source": "Kilde",
      "test": "Analysér",
      "tables": "Tabeller",
      "meta": "Metalagring",
      "intent": "Formål",
      "enrich": "Berig",
      "generate": "Generér"
    }
  },
  "meta": {
    "title": "Hvor skal Adminium gemme sine egne tabeller?",
    "subtitle": "Sider, roller, auditlog og indstillinger bor i tabeller med adminium_-præfiks — aldrig blandet med dine data.",
    "sameDb": {
      "title": "Samme database",
      "description": "adminium_*-tabeller oprettes ved siden af dine kildetabeller. Enkleste opsætning — kræver en rolle med skrive- og CREATE TABLE-rettigheder.",
      "disabledReadOnly": "Din rolle er skrivebeskyttet — Adminium skriver aldrig til denne database. Vælg en separat database til Adminiums egne tabeller.",
      "disabledNoDdl": "Denne rolle kan ikke køre DDL — Adminium-migreringer kræver CREATE TABLE. Vælg en separat database til Adminiums egne tabeller.",
      "disabledFile": "En skemafil har ingen live database — vælg en separat database til Adminiums egne tabeller."
    },
    "separate": {
      "title": "Separat database",
      "description": "Adminium holder sine tabeller i en anden database. Din kilde forbliver urørt — påkrævet for skrivebeskyttede kilder.",
      "dsn": "Forbindelsesstreng til metadatabasen",
      "helper": "Kræver skrive- + DDL-rettigheder — Adminium kører sine egne migreringer dér.",
      "test": "Test forbindelse",
      "ok": "Kompatibel — skrivning ✓ · DDL ✓",
      "insufficient": "Denne rolle kan ikke huse metalageret — Adminium behøver skrive- og CREATE TABLE-rettigheder dér.",
      "errorTitle": "Metalager ikke kompatibelt"
    },
    "testFailed": "Forbindelsen mislykkedes.",
    "v1Note": {
      "title": "Om denne installation",
      "body": "Denne server gemmer allerede sine egne tabeller i en konfigureret database, og dette trin flytter dem ikke. Det validerer, at dit valg er kompatibelt med denne forbindelse — serveren håndhæver den samme regel uafhængigt (409 META_PLACEMENT_INVALID)."
    },
    "move": {
      "title": "Flytter Adminiums tabeller",
      "copying": "Flytter Adminiums tabeller …",
      "restarting": "Genstarter …",
      "copyingBody": "Kopierer hver adminium_-tabel til den nye database. Dine kildedata røres ikke, og der skiftes først over, når kopien er verificeret.",
      "restartingBody": "Kopien er færdig. Adminium genstarter på den nye database — denne side fortsætter af sig selv om få sekunder.",
      "failed": "Kunne ikke flytte Adminiums tabeller — prøv igen.",
      "timeout": "Adminium flyttede sine tabeller, men er ikke kommet tilbage endnu. Dine data er sikre i den nye database — genindlæs siden om et øjeblik."
    },
    "willMove": {
      "title": "Dette flytter Adminiums tabeller",
      "body": "Adminium bruger i øjeblikket sit indbyggede SQLite-lager. Fortsæt kopierer det lager til den valgte database og genstarter på den — konti, sider og indstillinger følger med, så du forbliver logget ind."
    }
  },
  "intent": {
    "title": "Hvad har du brug for?",
    "subtitle": "Formålet afgør, hvilke sider der genereres. Du kan ændre det senere — en ændring foreslår en regenerering, aldrig en stille omskrivning.",
    "trust": "Vi læser kun dit skema — aldrig dine rækkedata under opsætningen.",
    "fullAdmin": {
      "title": "Fuldt adminpanel",
      "description": "Dashboards, CRUD-sider, søgning, import og eksport — alt hvad dit skema understøtter."
    },
    "analytics": {
      "title": "Skrivebeskyttet analyse",
      "description": "Dashboards, diagrammer og skrivebeskyttede tabeller. Ingen formularer, ingen skrivninger — hver rolle begrænset til Fremviser."
    },
    "crud": {
      "title": "CRUD-tabeller",
      "description": "Én redigeringsside pr. tabel plus søgning og import/eksport — et minimalt hjem, ingen dashboards."
    },
    "support": {
      "title": "Supportkonsol",
      "description": "Køer, ticket- og kundedetaljesider først. Sletning slået fra som standard. (Kø-skabeloner lander i M7 — v1-sidesættet svarer til fuldt admin.)"
    }
  },
  "generate": {
    "title": "Generér din app",
    "subtitle": "Én side pr. medtaget tabel plus dashboards pr. domæne — formål:",
    "run": "Generér dashboard",
    "openApp": "Åbn din app",
    "logLabel": "Genereringslog",
    "log": {
      "classifying": "Klassificerer skema…",
      "composing": "Sammensætter skabeloner…",
      "writing": "Skriver sider…",
      "done": "{pages} sider genereret på tværs af {groups} navigationsgrupper"
    },
    "successTitle": "Dit dashboard er klar",
    "successBody": "{pages} sider i {groups} navigationsgrupper — genereret fra dit skema, redigerbare i Studio.",
    "errorTitle": "Generering mislykkedes",
    "failed": "Generering mislykkedes — prøv igen, eller kør introspektionen igen først.",
    "fileTitle": "Skemafil fortolket — generering kræver en live database",
    "fileBody": "Dit skema blev fortolket rent, og forhåndsvisningen ovenfor er ægte. Generering af en kørende app direkte fra en skemafil (med pladsholderrækker) er ikke tilgængelig endnu — forbind en live database for at generere i dag."
  },
  "remap": {
    "column": {
      "nullable": "kan være NULL",
      "labelOverride": "Visningsetiket",
      "labelHelper": "Udledt: {name}",
      "logicalType": "Logisk type",
      "logicalTypeHelper": "Udledt: {type} (fra {dbType}) — kortlagt af adapteren; kan ikke tilsidesættes i v1.",
      "semantic": "Semantisk type",
      "unclassified": "Endnu ikke klassificeret.",
      "semanticHelper": "Klassifikator: {tag} · {confidence}% tillid · kilde: {source}",
      "semanticInferred": "udledt: {tag}",
      "currency": "Valuta",
      "currencyHelper": "ISO 4217-kode anvendt på beløbsformatering.",
      "pii": "Maskér som standard",
      "piiHelper": "Maskerede værdier vises slørede; afmaskering kræver tilladelsen data.unmask_pii og logges i auditloggen.",
      "enum": "Enum-semantik",
      "enumKind": "Enum-art",
      "enumWorkflow": "Arbejdsgang",
      "enumCategory": "Kategori",
      "enumLabelFor": "Etiket for {value}",
      "enumToneFor": "Tone for {value}",
      "enumToneAuto": "auto",
      "enumHelper": "Arbejdsgangs-enums driver statusmærker og tavlekolonner; toner knytter værdierne til den semantiske farvetoneskala."
    },
    "diff": {
      "one": "1 ændring",
      "count": "{count} ændringer",
      "saved": "Tilsidesættelser gemt.",
      "revertOne": "Fortryd {change}",
      "regenerate": "Regenerér sider",
      "revertAll": "Fortryd alle",
      "save": "Gem tilsidesættelser"
    },
    "table": {
      "iconPicker": "Tabelikon",
      "system": "System",
      "labelOverride": "Visningsetiket",
      "labelHelper": "Udledt: {name}",
      "icon": "Ikon",
      "navGroup": "Navigationsgruppe",
      "navGroupHelper": "Navigationsplaceringen bestemmes af generatoren — en table.navGroup-tilsidesættelse er ikke en del af v1-vokabularet.",
      "include": "Medtag i den genererede app",
      "includeHelper": "Udeladte tabeller får ingen sider og forsvinder fra navigationen.",
      "shape": "Tabelform (klassificeret)",
      "role": "Rolle",
      "unclassified": "Ikke klassificeret",
      "kind": "Art",
      "hierarchy": "Hierarki",
      "selfFk": "Selvreference via {column}",
      "polymorphic": "Polymorfe par",
      "rows": "Rækkeestimat",
      "shapeHelper": "Klassificeringen genberegnes ved hver introspektion; tilsidesættelser lægges ovenpå og overlever regenerering."
    },
    "relations": {
      "declared": "Deklarerede fremmednøgler",
      "noneDeclared": "Ingen deklarerede fremmednøgler berører denne tabel.",
      "inferred": "Udledte relationer",
      "noneInferred": "Intet udledt for denne tabel.",
      "confidence": "udledt · {pct}%",
      "accepted": "Accepteret",
      "suppressed": "Undertrykt",
      "accept": "Accepter",
      "suppress": "Undertryk",
      "overrides": "Relationer fra tilsidesættelser (anvendt)",
      "overrideBadge": "tilsidesættelse",
      "add": "Tilføj virtuel relation",
      "fromColumn": "Fra kolonne",
      "noColumns": "Ingen matchende kolonne",
      "fromPlaceholder": "customer_id",
      "toTable": "Til tabel",
      "noTables": "Ingen matchende tabel",
      "toColumn": "Til kolonne",
      "cardinality": "Kardinalitet",
      "addButton": "Tilføj relation"
    },
    "toast": {
      "saved": "Skema-tilsidesættelser gemt",
      "savedDetail": "Det anvendte skema nedenfor afspejler dine ændringer.",
      "regenerated": "{created} oprettet · {updated} opdateret · {unchanged} uændret",
      "regeneratedDetail": "Sider, du har redigeret i hånden, bevares — kun sider med en urørt generated_hash blev regenereret på stedet.",
      "regenerateFailed": "Regenerering mislykkedes"
    },
    "title": "Skema-ommapning",
    "subtitle": "{tables} tabeller · {applied} tilsidesættelser anvendt",
    "saveFailed": "Lagring mislykkedes: {message}",
    "loadFailed": "Kunne ikke indlæse skemaet for denne forbindelse.",
    "inspector": "Inspektør",
    "empty": {
      "title": "Vælg en tabel eller kolonne",
      "description": "Vælg noget i skematræet for at ommappe dets etiket, type, relationer eller maskering."
    },
    "tabs": {
      "details": "Detaljer",
      "relations": "Relationer"
    },
    "tree": {
      "label": "Skema",
      "search": "Søg i tabeller og kolonner",
      "searchPlaceholder": "Søg i tabeller…",
      "noMatches": "Ingen tabeller matcher din søgning.",
      "collapse": "Fold tabel sammen",
      "expand": "Fold tabel ud",
      "unsaved": "Ugemt ændring",
      "excluded": "Udeladt"
    },
    "badge": {
      "pk": "PK",
      "fk": "FK",
      "unique": "UNIK",
      "pii": "PII",
      "masked": "Maskeret"
    },
    "unavailableTitle": "Editor til skema-ommapning ikke tilgængelig",
    "unavailableBody": "Dette build indeholder endnu ikke ommapnings-editoren (09-T12). Kør genereringen igen, når den er kommet, for at ommappe etiketter, typer og relationer."
  },
  "publicApi": {
    "error": "Something went wrong",
    "scopes": {
      "deleteTitle": "Delete this scope",
      "deleteBody": "Any page using a key bound to this scope stops loading data. Keys are not deleted — revoke them first if that is what you meant.",
      "deletePrompt": "Type the scope name to confirm",
      "deleteConfirm": "Delete scope",
      "issuesTitle": "This scope did not compile",
      "title": "Scopes",
      "subtitle": "A scope is the whole of what a key may reach — the tables, the exact columns, and a filter the caller can narrow but never remove.",
      "emptyTitle": "No scopes yet",
      "emptyBody": "Create one below. It is checked against your live schema before it is saved.",
      "keyCount": "{count, plural, =0 {no keys} one {# key} other {# keys}}",
      "delete": "Delete",
      "nameLabel": "Name",
      "connectionLabel": "Connection ID",
      "documentLabel": "Scope document",
      "documentHint": "Compiled against your schema when you save. Every column a caller can reach is listed here and nowhere else.",
      "create": "Create scope",
      "formLabel": "Create a scope"
    },
    "cancel": "Cancel",
    "close": "Close",
    "title": "Public API",
    "subtitle": "Let your own customer- or staff-facing pages read this database, through a scope you define.",
    "notRegistered": {
      "title": "Not enabled on this server",
      "body": "Set ADMINIUM_PUBLIC_API_ORIGINS to the exact origins allowed to call it, then restart. Until then these routes are not served at all."
    },
    "toggle": {
      "label": "Serve the public API",
      "hint": "Turning this off stops every public request immediately. Nothing is deleted — keys, scopes and data all survive."
    },
    "origins": {
      "label": "Origins allowed to call it"
    },
    "keys": {
      "title": "Keys",
      "subtitle": "These go in your page’s JavaScript, so anyone can read them. That is expected — a key can only ever do what its scope allows.",
      "emptyTitle": "No keys yet",
      "emptyBody": "Create a scope first, then mint a key for it.",
      "reveal": "Show key",
      "rotate": "Rotate",
      "revoke": "Revoke",
      "nameLabel": "Name",
      "scopeLabel": "Scope",
      "scopePlaceholder": "Choose a scope",
      "create": "Create key",
      "formLabel": "Create a key",
      "scopeIsAuthTitle": "The scope is the only permission",
      "scopeIsAuthBody": "A key can reach exactly what its scope lists and nothing else. It does not use roles or table permissions, and it cannot read anything through the rest of the API.",
      "appLabel": "Tilknyt en hostet app-flade (valgfrit)",
      "appHint": "Appens kundeflade serverer så selv denne nøgle — rotation kræver ingen ny build.",
      "appNone": "Ikke tilknyttet"
    },
    "status": {
      "heading": "Status"
    }
  },
  "hostedApps": {
    "title": "Hostede apps",
    "subtitle": "De app-flader denne instans serverer — hvor hver enkelt vises, og hvilke domæner der peger på dem.",
    "error": "Noget gik galt",
    "emptyTitle": "Der serveres ingen app-flader",
    "emptyBody": "Peg ADMINIUM_SURFACES_DIR på en mappe med byggede flader — én mappe pr. app og side, hver med sin index.html — og genstart. De serveres derefter under /apps/ og vises her.",
    "surfaces": {
      "title": "Flader",
      "subtitle": "En medarbejderflade kan glide ind i dette dashboards sidepanel eller stå for sig selv; en kundeflade er offentlig og læser gennem sin tilknyttede nøgle.",
      "staff": "Medarbejder",
      "customer": "Kunde",
      "noNav": "Intern placering utilgængelig — byg denne flade igen med det aktuelle toolkit, så den udsender surface.json.",
      "noKey": "Ingen nøgle tilknyttet — denne flade kan ikke læse data, før der oprettes en til den.",
      "mintLink": "Opret en under Offentligt API",
      "boundKey": "Serverer nøgle",
      "placementLabel": "Placering",
      "placementInternal": "I sidepanelet (indlejret)",
      "placementExternal": "Ekstern (kun egen URL)",
      "connectionLabel": "Læser",
      "connectionUnset": "Den der kører"
    },
    "domains": {
      "title": "Domæner",
      "subtitle": "Peg et domænes DNS på din proxy, send Host-headeren videre til Adminium, og tilknyt det her — værten serverer så fladen i stedet for dette dashboard. Certifikater bliver på din proxy.",
      "issuesTitle": "Domænekortet blev afvist",
      "savedTitle": "Gemt",
      "savedBody": "Tilknytninger træder i kraft inden for få sekunder. En vært svarer først, når dens DNS og din proxy faktisk når denne instans.",
      "none": "Ingen domæner er tilknyttet.",
      "hostLabel": "Vært",
      "surfaceLabel": "Flade",
      "remove": "Fjern",
      "add": "Tilknyt et domæne",
      "save": "Gem domæner",
      "instanceLabel": "Instans",
      "instanceOwn": "Appens egen"
    },
    "instances": {
      "title": "Instanser",
      "body": "Server den samme app over flere databaser. Hver instans er tilgængelig på /apps/<app>/<segment>/<side>/ og læser kun den forbindelse, du giver den.",
      "appLabel": "App",
      "slugLabel": "URL-segment",
      "readsLabel": "Læser",
      "add": "Tilføj en instans",
      "save": "Gem instanser",
      "remove": "Fjern",
      "empty": "Ingen ekstra instanser.",
      "failed": "Instanserne blev ikke gemt"
    }
  },
  "addOns": {
    "plan": {
      "blocked": "This cannot be installed here",
      "needsColumns": "This add-on needs columns you do not have",
      "needsColumnsBody": "Adminium will not add columns to tables you already own. Add them yourself, then install.",
      "willCreate": "This will create tables in your database",
      "willCreateBody": "Installing creates these tables. Uninstalling later leaves them, and their data, alone.",
      "noData": "This add-on reads and writes no tables of its own.",
      "reuse": "This add-on will use tables you already have:"
    },
    "consent": {
      "title": "Install {name}",
      "subtitle": "What this add-on will do, before it can do it.",
      "close": "Close",
      "loading": "Working out what this would do…",
      "hosts": "Attach to",
      "cancel": "Cancel",
      "confirm": "Install"
    },
    "connect": {
      "apiKey": "API key",
      "submit": "Connect"
    },
    "title": "Add-ons",
    "subtitle": "Extra capabilities you can add to your apps — shipping, artwork, data. Each one says what it needs before you install it.",
    "error": "Something went wrong",
    "browse": {
      "title": "Available",
      "online": "Includes add-ons from the online catalogue. Checking for newer versions is a separate action.",
      "offline": "Showing the add-ons that came with this build. Browsing online is switched off, and nothing here has contacted the internet.",
      "refresh": "Check for newer",
      "emptyTitle": "No add-ons available",
      "emptyBody": "This build shipped none, and the online catalogue is off.",
      "bundled": "Included",
      "upgrade": "v{version} available",
      "download": "Download",
      "install": "Install",
      "discard": "Discard",
      "upgradeAction": "Upgrade",
      "toggle": "Browse the online catalogue"
    },
    "installed": {
      "title": "Installed",
      "emptyTitle": "Nothing installed yet",
      "emptyBody": "Install an add-on above and it will appear here with its hosts and connection.",
      "connected": "Connected",
      "notConnected": "Not connected",
      "egress": "May contact: {hosts}",
      "on": "on",
      "off": "off",
      "disconnect": "Disconnect",
      "uninstall": "Uninstall"
    },
    "confirm": {
      "close": "Close",
      "disconnectTitle": "Disconnect this add-on",
      "uninstallTitle": "Uninstall this add-on",
      "discardTitle": "Discard this download",
      "disconnectBody": "Its keys are deleted and it stops making calls. Every table and every row it created stays exactly as it is, and you can reconnect at any time.",
      "uninstallBody": "Its keys are deleted and its files are removed from this server. Every table and every row it created stays exactly as it is. You can install it again later.",
      "discardBody": "The downloaded files are deleted. Nothing was installed, so nothing else changes — you can download it again whenever you like.",
      "cancel": "Cancel",
      "disconnect": "Disconnect",
      "uninstall": "Uninstall",
      "discard": "Discard"
    },
    "upgradeNote": "Upgrading keeps the hosts an add-on is attached to and the connection it already has.",
    "job": {
      "title": "Downloading",
      "body": "Fetching and verifying. Nothing is installed until you say so.",
      "failed": "The download did not finish. Nothing was installed."
    },
    "veto": {
      "title": "This deployment cannot browse online",
      "body": "The setting is saved, but network features are off for this server and that wins. Downloaded add-ons still work, and you can still upload one yourself."
    },
    "sideload": {
      "title": "Upload a package",
      "hint": "For a server with no internet. It is checked exactly as a download would be, so it needs the hash that came with it.",
      "file": "Package file (.tgz)",
      "key": "Add-on key",
      "version": "Version",
      "sha": "Integrity (sha512-…)",
      "shaHint": "The `integrity` value `npm pack --json` printed. The upload is refused if the bytes do not match.",
      "submit": "Upload"
    }
  },
  "pages": {
    "title": "Sider",
    "subtitle": "Tilføj, rediger og organiser din apps sider — og den rækkefølge de vises i sidepanelet.",
    "createButton": "Ny side",
    "loadFailed": {
      "title": "Siderne kunne ikke indlæses",
      "body": "Sidestyring kræver tilladelsen “Administrer sider”. Bed en administrator om at give den til en af dine roller."
    },
    "tab": {
      "pages": "Alle sider",
      "sidebar": "Rækkefølge i sidepanelet"
    },
    "list": {
      "title": "Sider",
      "count": "{count, plural, one {# side} other {# sider}}"
    },
    "empty": {
      "title": "Ingen sider endnu",
      "body": "Forbind en database for at generere sider automatisk, eller opret en i hånden."
    },
    "status": {
      "live": "Aktiv",
      "hidden": "Skjult"
    },
    "origin": {
      "generated": "Genereret",
      "manifest": "Tilføjelse",
      "llm": "Assistent",
      "system": "System",
      "user": "Egen"
    },
    "row": {
      "menu": "Handlinger for {title}"
    },
    "action": {
      "edit": "Rediger side",
      "duplicate": "Dupliker",
      "hide": "Skjul fra sidepanelet",
      "show": "Vis i sidepanelet",
      "delete": "Slet side"
    },
    "create": {
      "title": "Ny side",
      "failed": "Siden kunne ikke oprettes",
      "submit": "Opret side",
      "subtitle": "Vælg hvad siden viser, og hvordan den ser ud. Forhåndsvisningen følger dine valg."
    },
    "duplicate": {
      "title": "Dupliker side",
      "failed": "Siden kunne ikke duplikeres",
      "submit": "Dupliker"
    },
    "delete": {
      "title": "Slet denne side?",
      "body": "Dette kan ikke fortrydes. Gemte visninger og personlige layouts på denne side slettes for alle.",
      "bodyGenerated": "Denne side stammer fra skemagenerering, så den kommer igen næste gang du genererer. Gemte visninger og personlige layouts slettes for alle.",
      "prompt": "Skriv {slug} for at bekræfte",
      "confirm": "Slet side"
    },
    "field": {
      "title": "Titel",
      "titleHint": "Vises i sidepanelet og i sidens overskrift.",
      "slug": "Sideadresse",
      "slugHint": "Små bogstaver, tal og bindestreger. Kun den sidste del — resten af adressen tilføjer vi.",
      "slugTaken": "En anden side bruger allerede denne adresse.",
      "slugWarning": "Ændrer du adressen, går eksisterende links og bogmærker til siden i stykker.",
      "template": "Skabelon",
      "templateHint": "Afgør hvad siden kan indeholde. Kan ændres senere.",
      "group": "Gruppe i sidepanelet",
      "groupHint": "Hvilken del af sidepanelet den vises i.",
      "icon": "Ikon",
      "iconHint": "Vises ved siden af sidens navn i sidepanelet.",
      "visible": "Vis i sidepanelet",
      "visibleHint": "En skjult side kan stadig tilgås på sin URL af alle med linket.",
      "table": "Tabel",
      "tableCreateHint": "Tabellen som denne side læser fra. Vælg en nu, så er siden klar til brug; lad den stå tom, og du kan knytte den senere.",
      "tableNone": "Ikke knyttet",
      "tableNeedsConnection": "Vælg en datakilde først.",
      "connection": "Datakilde",
      "connectionNone": "Ingen",
      "iconPick": "Vælg sidens ikon",
      "padding": "Sidemargen",
      "width": "Indholdsbredde",
      "widthHint": "Hvor bred sidens indholdskolonne må blive på en stor skærm."
    },
    "editor": {
      "title": "Rediger side",
      "save": "Gem ændringer",
      "saveFailed": "Ændringerne kunne ikke gemmes",
      "openPage": "Åbn side",
      "generated": {
        "title": "Denne side blev genereret ud fra dit skema",
        "body": "Dine ændringer bevares, når du genererer igen — siden markeres som redigeret og røres ikke. En sletning holder derimod kun, indtil næste generering opretter den på ny."
      },
      "contentUnavailable": "Sidens indhold kunne ikke indlæses",
      "contentUnavailableBody": "Oplysningerne ovenfor kan stadig gemmes.",
      "contentInvalid": "Denne sides konfiguration kan ikke læses",
      "contentInvalidBody": "Den er skrevet af en nyere version, eller den er ugyldig. Generer siden igen, eller slet den.",
      "data": "Data",
      "schemaFailed": "Tabellerne kunne ikke vises",
      "schemaFailedBody": "Denne forbindelse er måske ikke analyseret endnu. Kør introspektion fra Studio → Dataforbindelser.",
      "notBindable": "Denne skabelon er ikke knyttet til én tabel",
      "notBindableBody": "Dens indhold bygges widget for widget i stedet. Åbn siden, og brug “Rediger” til at tilføje dem.",
      "recompose": "Denne side bliver bygget om",
      "recomposeBody": "Når du gemmer, erstattes indholdet af et nyt layout for skabelonen og tabellen ovenfor. Kolonnetilpasninger og widget-ændringer på siden går tabt.",
      "missing": "Denne side findes ikke længere",
      "missingBody": "Den er måske slettet eller fjernet af en generering.",
      "details": "Detaljer",
      "itemsPending": "Gem først ændringen ovenfor — sidens indhold bygges op igen ud fra den nye skabelon og tabel.",
      "columns": "Kolonner",
      "appearance": "Udseende"
    },
    "sidebar": {
      "help": "Omarranger sider inden for en gruppe, eller flyt en til en anden gruppe. Ændringerne gælder for alle.",
      "discard": "Kassér",
      "save": "Gem rækkefølge",
      "saveFailed": "Den nye rækkefølge kunne ikke gemmes",
      "emptyGroup": "Ingen sider i denne gruppe.",
      "moveUp": "Flyt {title} op",
      "moveDown": "Flyt {title} ned",
      "moveTo": "Flyt {title} til en gruppe",
      "ungrouped": {
        "title": "Nogle sider hører ikke til nogen gruppe",
        "body": "Siderne virker på deres URL, men vises ingen steder i sidepanelet. Åbn hver enkelt og vælg en gruppe."
      }
    },
    "columns": {
      "help": "Træk for at omarrangere kolonner, omdøb deres overskrifter, og vælg hvilke der vises i tabellen.",
      "empty": "Ingen kolonner endnu — tilføj dem nedenfor.",
      "pk": "Nøgle",
      "pii": "PII",
      "header": "Overskrift for {name}",
      "shown": "Vist",
      "toggle": "Vis {name} i tabellen",
      "dragHandle": "Flyt {name}",
      "remove": "Fjern {name}",
      "addOpen": "Tilføj kolonne",
      "addTitle": "Tilføj en kolonne",
      "addSearch": "Søg i kolonner…",
      "addFromTable": "Fra {table}",
      "addFromLinked": "Fra linkede tabeller",
      "addLinkedHelp": "Vis en værdi fra den tabel, som en linkkolonne peger på.",
      "addVia": "via {column}",
      "addNoMatches": "Ingen kolonner matcher “{query}”.",
      "followColumn": "Følg {name}",
      "addLinkedFrom": "Tabeller, der linker hertil",
      "addLinkedFromHelp": "Tilføj et antal af de rækker, der peger på hver post.",
      "countBadge": "Antal",
      "lookupBadge": "Sammenkædet",
      "lookupBack": "Tilbage",
      "lookupBrowse": "Vælg hvad der skal vises fra {table}",
      "lookupBroken": "Kæden kan ikke længere følges",
      "lookupBrokenBody": "Skemaet ændrede sig undervejs. Start kæden forfra.",
      "schemaUnavailable": "Databasens kolonner kunne ikke hentes, så kolonner kan ikke tilføjes her.",
      "none": {
        "title": "Denne side har ingen kolonner endnu",
        "body": "Kolonner læses fra tabellen, når siden genereres. Knyt siden til en tabel og generer igen for at udfylde dem."
      }
    },
    "icon": {
      "none": "Vælg et ikon",
      "search": "Søg efter ikoner",
      "noMatches": "Ingen ikoner matcher den søgning."
    },
    "preview": {
      "untitled": "Side uden titel",
      "note": "En illustration af layoutet, ikke dine data. Den rigtige side fyldes ud, når den er gemt."
    },
    "padding": {
      "default": "Standard for denne skabelon",
      "none": "Ingen",
      "standard": "Standard (28 × 24)",
      "custom": "Tilpasset…",
      "x": "Sider (px)",
      "y": "Top og bund (px)"
    },
    "width": {
      "default": "Standard for denne skabelon",
      "narrow": "Smal (720 px)",
      "content": "Indhold (900 px)",
      "page": "Side (1080 px)",
      "dash": "Dashboard (1320 px)",
      "wide": "Bred (1800 px)",
      "full": "Fuld bredde (ingen grænse)"
    }
  }
} as const;
