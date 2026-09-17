// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/onboarding.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "account": {
    "body": "Den første administrator. Det sker kun én gang, og du forbliver logget ind bagefter.",
    "confirm": "Bekræft adgangskode",
    "email": "E-mail",
    "hidePassword": "Skjul adgangskode",
    "label": "Din konto",
    "name": "Dit navn",
    "password": "Adgangskode",
    "passwordHelper": "Mindst {min} tegn.",
    "showPassword": "Vis adgangskode",
    "strength": "Adgangskodens styrke",
    "strengthLevels": {
      "fair": "Nogenlunde",
      "good": "God",
      "strong": "Stærk",
      "weak": "Svag"
    },
    "sub": "Loginoplysninger",
    "submit": "Opret konto",
    "title": "Opret din konto"
  },
  "back": "Tilbage",
  "connect": {
    "body": "Peg Adminium mod en datakilde. Vi læser skemaet og skriver aldrig til det, medmindre du beder om det.",
    "bridge": {
      "body": "Den blev overdraget fra adminium.dev. Opret din konto, så åbner vi den i forbindelsesguiden, hvor du kan læse den, før noget som helst bruger den.",
      "title": "En forbindelsesstreng venter på denne instans"
    },
    "dsn": {
      "checking": "Tjekker den database …",
      "helper": "Intet forlader denne browser, før din konto findes — så tester vi den.",
      "incomplete": "Tilføj vært og database, f.eks. postgres://user@host:5432/db",
      "invalidScheme": "Ukendt skema — forventede postgres://, mysql://, mariadb:// eller sqlite:",
      "label": "Forbindelsesstreng"
    },
    "engine": {
      "mysql": "MySQL / MariaDB",
      "postgres": "PostgreSQL",
      "sqlite": "SQLite"
    },
    "engineLabel": "Databasemotor",
    "existing": {
      "adopt": "Brug den, og log ind",
      "adopting": "Peger denne instans mod den …",
      "body": "Den indeholder {count, plural, one {# Adminium-tabel} other {# Adminium-tabeller}} med data. To muligheder:",
      "failed": "Denne instans kunne ikke pege mod den database.",
      "otherSecret": "Den blev sat op med en anden ADMINIUM_SECRET: du ville kunne logge ind, men denne instans kan ikke dekryptere dens gemte forbindelsesstrenge.",
      "park": "Behold dem, og start forfra",
      "parked": {
        "body": "De omdøbes og sættes til side — hver eneste række overlever — og Adminium starter med friske ved siden af. Der sker intet, før du lægger Adminiums egne data i denne database.",
        "title": "Tabellerne, der er der, bliver bevaret"
      },
      "restarting": "Genstarter på den …",
      "timeout": "Adminium peger mod den database, men er ikke kommet tilbage endnu — genindlæs siden om et øjeblik.",
      "title": "Den database kører allerede et Adminium"
    },
    "label": "Forbind data",
    "sub": "Tilknyt en database",
    "title": "Forbind din database"
  },
  "continue": "Fortsæt",
  "done": {
    "connected": {
      "reading": "Forbundet — Adminium læser dit skema nu.",
      "tables": "Forbundet · fandt {count, plural, one {# tabel} other {# tabeller}}."
    },
    "invited": "{count, plural, one {# invitation} other {# invitationer}} oprettet.",
    "label": "Klar",
    "next": {
      "blank": "Dit arbejdsrum er klar. Tilføj en side, når du vil — der blev ikke genereret noget, præcis som du bad om.",
      "generate": "Dit arbejdsrum er klar. Nu vælger vi tabellerne og genererer dine sider."
    },
    "storage": {
      "local": "Adminium gemmer sine egne data i en fil på denne maskine.",
      "sameDb": "Adminium gemmer sine egne data i den database, du forbandt.",
      "separate": "Adminium gemmer sine egne data i den database, du gav det."
    },
    "sub": "Kom i gang",
    "title": "Så er du klar! 🎉"
  },
  "error": {
    "alreadyCompleted": "Denne instans er allerede sat op. Log ind med den eksisterende administratorkonto.",
    "connectionFailed": "Din konto blev oprettet, og du er logget ind — men den database kunne ikke nås: {detail}",
    "connectionUnknown": "databasen svarede ikke",
    "failed": "Opsætningen mislykkedes. Tjek din forbindelse, og prøv igen.",
    "rejected": "Serveren afviste de oplysninger. Tjek e-mail og adgangskode, og prøv igen."
  },
  "finish": "Gå til dashboardet",
  "kicker": "Trin {n} af {total}",
  "meta": {
    "body": "Dit login, de sider du genererer, og dine gemte indstillinger. Det er adskilt fra den database, du lige forbandt, som Adminium kun læser.",
    "label": "Adminiums data",
    "local": {
      "body": "Intet at sætte op. Rigtigt til at prøve Adminium eller til en enkelt instans.",
      "title": "I en fil på denne maskine"
    },
    "moving": {
      "copying": "Kopierer Adminiums data …",
      "failed": "Adminiums data kunne ikke flyttes — prøv igen.",
      "restarting": "Genstarter på den nye database …",
      "timeout": "Adminium flyttede sine data, men er ikke kommet tilbage endnu. De er sikre i den nye database — genindlæs siden om et øjeblik."
    },
    "pinned": {
      "body": "Denne instans blev startet med sit metalager konfigureret, så der er intet at flytte. Du kan ændre det senere i Studio-indstillingerne.",
      "title": "Adminiums data har allerede et hjem"
    },
    "sameDb": {
      "alreadyAdminium": "Den database indeholder allerede en Adminium-instans. Gå et trin tilbage for at beholde dens tabeller og starte ved siden af — eller log ind på den i stedet.",
      "body": "Adminium tilføjer sine egne `adminium_`-tabeller ved siden af dine. Én database at sikkerhedskopiere.",
      "disabledFile": "En SQLite-fil er ikke en server, Adminium kan tilføje sine egne tabeller til.",
      "disabledNoDdl": "Den rolle kan ikke køre CREATE TABLE, som Adminiums egne migreringer har brug for.",
      "disabledReadOnly": "Den rolle er skrivebeskyttet — Adminium skriver aldrig til din database. Behold dets data i en fil, eller giv det sin egen.",
      "noSource": "Du har ikke forbundet en database endnu — forbind en først, eller behold Adminiums data i en fil.",
      "parked": "De Adminium-tabeller, der allerede er der, omdøbes først og sættes til side — hver eneste række overlever — og Adminium starter med friske ved siden af.",
      "title": "I den database, du lige forbandt"
    },
    "separate": {
      "body": "En PostgreSQL- eller MySQL-database, du stiller til rådighed. Rigtigt til produktion eller til flere instanser.",
      "failed": "Den database svarede ikke.",
      "incomplete": "Tilføj vært og database, f.eks. postgres://user@host:5432/adminium",
      "insufficient": "Den rolle kan ikke køre CREATE TABLE — Adminiums egne migreringer har brug for det.",
      "invalidScheme": "Ukendt skema — forventede postgres://, mysql:// eller mariadb://",
      "label": "Forbindelsesstreng til Adminium",
      "ok": "Kan nås, og den kan oprette tabeller.",
      "test": "Test denne database",
      "title": "I sin egen database"
    },
    "sub": "Hvor de bor",
    "title": "Hvor Adminium gemmer sine egne data"
  },
  "progressComplete": "{percent} % gennemført",
  "progressLabel": "Opsætningens forløb",
  "skip": "Spring over",
  "start": {
    "body": "Det former kun de sider, vi genererer for dig. Du kan ændre det hele senere eller starte helt forfra.",
    "label": "Udgangspunkt",
    "options": {
      "analytics": {
        "body": "Diagrammer og tabeller til at læse. Intet skrives tilbage.",
        "title": "Analyse uden skrivning"
      },
      "blank": {
        "body": "Generér ingenting. Forbind en database, og byg de sider, du vil have, én ad gangen.",
        "title": "Blankt lærred"
      },
      "crud": {
        "body": "Tabeller og formularer, uden dashboards.",
        "title": "CRUD-tabeller"
      },
      "fullAdmin": {
        "body": "En side pr. tabel, med opret, rediger og slet.",
        "title": "Fuldt administrationspanel"
      },
      "support": {
        "body": "Køer og kundedetaljesider først, med sletning slået fra.",
        "title": "Supportkonsol"
      }
    },
    "sub": "Vælg en form",
    "title": "Hvad bygger du først?"
  },
  "team": {
    "body": "Inviter dem, du arbejder sammen med. Du kan altid tilføje flere senere.",
    "copied": "Kopieret",
    "copyLink": "Kopiér link",
    "duplicate": "Den person er allerede inviteret.",
    "emailLabel": "Kollegaens e-mail",
    "emailed": "Invitation sendt på e-mail",
    "failed": "Den invitation kunne ikke oprettes.",
    "invalidEmail": "Indtast en gyldig e-mailadresse.",
    "invite": "Inviter",
    "label": "Dit team",
    "note": "Invitationer uden e-mail viser et link, du selv sender. Det vises kun én gang — Adminium gemmer kun et hash af det.",
    "placeholder": "kollega@virksomhed.dk",
    "sub": "Tilføj personer",
    "title": "Få dit team med"
  }
} as const;
