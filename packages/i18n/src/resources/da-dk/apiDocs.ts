// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/apiDocs.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "badge": {
    "anon": "Offentlig læsning",
    "authenticated": "Kræver login",
    "public": "Offentlig",
    "service": "Servicerolle"
  },
  "code": {
    "copied": "Kopieret",
    "copy": "Kopiér",
    "curl": "cURL",
    "js": "JavaScript",
    "languages": "Sprog for kodeeksempel",
    "python": "Python"
  },
  "copyBase": "Kopiér basis-URL",
  "crumb": "API",
  "empty": {
    "body": "Denne installation har ikke udgivet nogen endpoints.",
    "title": "Ingen endpoints endnu"
  },
  "ep": {
    "batch": {
      "desc": "Masseindsættelse eller upsert, op til 500 rækker.",
      "title": "Opret flere {ref}"
    },
    "create": {
      "desc": "Indsæt én række. Returnerer den oprettede post.",
      "title": "{article, select, other {}}Opret {singular}"
    },
    "delete": {
      "desc": "Fjern rækken med denne primærnøgle.",
      "title": "{article, select, other {}}Slet {singular}"
    },
    "list": {
      "desc": "Returnér et filtreret, sorteret og sideinddelt sæt rækker.",
      "title": "Vis {ref}"
    },
    "one": {
      "desc": "Hent en enkelt række ud fra primærnøglen.",
      "title": "{article, select, other {}}Hent {singular}"
    },
    "replace": {
      "desc": "Erstat en hel række ud fra primærnøglen.",
      "title": "{article, select, other {}}Erstat {singular}"
    },
    "rowWord": "række",
    "update": {
      "desc": "Opdatér kolonner i rækken med denne primærnøgle.",
      "title": "{article, select, other {}}Opdatér {singular}"
    }
  },
  "meta": "{endpoints, plural, one {# endpoint} other {# endpoints}} · grænse {limit}, sortering {order}",
  "pg": {
    "auth": "Autorisation",
    "authHelper": "En browsernøgle. Den bliver kun i denne fane og forsvinder, når du genindlæser.",
    "authPlaceholder": "Indsæt en nøgle",
    "body": "Forespørgslens brødtekst",
    "needKey": "Indsæt først en nøgle",
    "send": "Send forespørgsel",
    "sending": "Sender…",
    "title": "Testkonsol"
  },
  "rail": {
    "empty": "Intet matcher det filter.",
    "filter": "Filtrér tabeller…",
    "heading": "Ressourcer",
    "reference": "API-reference"
  },
  "res": {
    "idle": "Send en forespørgsel for at se svaret.",
    "ms": "{ms} ms",
    "network": "Forespørgslen nåede ikke frem til serveren.",
    "noBody": "204 No Content — række slettet",
    "title": "Svar"
  },
  "schema": {
    "body": "Skema for brødtekst",
    "response": "Svarets kolonner"
  },
  "status": {
    "live": "API aktiv",
    "off": "Deaktiveret"
  },
  "tag": {
    "fk": "FK",
    "pk": "PK",
    "unique": "UNIQUE"
  }
} as const;
