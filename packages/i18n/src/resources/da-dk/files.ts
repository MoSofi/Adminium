// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/files.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "toast": {
    "restored": "{name} er gendannet",
    "restoreFailed": "Denne fil kunne ikke gendannes",
    "trashed": "{name} er flyttet til papirkurven",
    "trashFailed": "Denne fil kunne ikke flyttes til papirkurven"
  },
  "title": "Filer",
  "subtitle": "Alt, hvad der er uploadet gennem dette arbejdsområde, og hvor dets bytes er gemt.",
  "search": "Søg efter filnavn",
  "trash": {
    "notice": {
      "title": "Papirkurven tømmer sig selv",
      "body": "En fil i papirkurven fjernes helt, data og det hele, når denne servers opbevaringsperiode er udløbet. Gendan det, du stadig skal bruge, inden da."
    }
  },
  "listFailed": {
    "title": "Disse filer kunne ikke indlæses"
  },
  "empty": {
    "filtered": {
      "title": "Intet her",
      "body": "Ryd søgningen, eller vælg en anden genvej i sidepanelet."
    },
    "title": "Ingen filer endnu",
    "body": "Filer lander her, når nogen vedhæfter en til en post eller udfylder et filfelt."
  },
  "loadMore": "Indlæs flere filer",
  "usage": {
    "label": "Lagerplads i brug",
    "used": "{size} brugt",
    "count": "{count, plural, one {# fil} other {# filer}}",
    "diskLabel": "Brugt plads",
    "ofDisk": "{used} af {size} på denne disk"
  },
  "rail": {
    "label": "Filgenveje",
    "byTable": "Efter tabel",
    "byDestination": "Efter destination",
    "byConnection": "Efter forbindelse"
  },
  "preset": {
    "all": "Alle filer",
    "unattached": "Ikke vedhæftet",
    "trash": "Papirkurv",
    "recent": "Seneste"
  },
  "column": {
    "name": "Fil",
    "size": "Størrelse",
    "attachedTo": "Vedhæftet til",
    "destination": "Destination",
    "added": "Tilføjet",
    "actions": "Handlinger"
  },
  "row": {
    "unattached": "Ikke vedhæftet",
    "localDestination": "Denne servers disk",
    "noRecord": "Ikke knyttet til en post"
  },
  "action": {
    "restore": "Gendan",
    "download": "Download",
    "deleteNamed": "Slet {name}",
    "delete": "Slet"
  },
  "drawer": {
    "none": "Ingen",
    "subtitle": "{size} · {type}",
    "destination": "Destination",
    "attachedTo": "Vedhæftet til",
    "uploadedBy": "Uploadet af",
    "added": "Tilføjet",
    "attachedAt": "Vedhæftet",
    "trashedAt": "Flyttet til papirkurven",
    "id": "Fil-id",
    "checksum": "Checksum"
  },
  "view": {
    "label": "Hvordan filer vises",
    "grid": "Gitter",
    "list": "Liste"
  },
  "upload": {
    "open": "Upload",
    "title": "Upload filer",
    "subtitle": "Føj filer til dette arbejdsområde.",
    "connection": "Hvilken forbindelse de hører til",
    "drop": "Træk filer hertil",
    "browse": "Gennemse din computer",
    "sending": "Uploader",
    "cancelOne": "Annullér {name}",
    "removeOne": "Fjern {name}",
    "complete": "Upload fuldført",
    "completeBody": "Filerne er nu i dette arbejdsområde og kan knyttes til en post senere.",
    "send": "{count, plural, one {Upload # fil} other {Upload # filer}}",
    "done": "Færdig",
    "failed": "Mislykkedes",
    "cancelled": "Annulleret"
  }
} as const;
