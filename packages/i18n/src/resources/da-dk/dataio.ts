// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/da-DK/dataio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "back": "Tilbage",
  "import": {
    "stepUpload": "Upload",
    "stepMap": "Tilknyt kolonner",
    "stepValidate": "Validér",
    "stepRun": "Importér og gennemgå",
    "targetLabel": "Måltabel",
    "targetPlaceholder": "Vælg en tabelside…",
    "notATable": "Den side er ikke en tabel — vælg en tabelside at importere til.",
    "dropTitle": "Slip en CSV-fil for at importere",
    "dropHint": "CSV op til 32 MB — første række skal være headeren",
    "skipTarget": "Importér ikke",
    "mapHint": "{count} datarækker i {file} — vælg et mål for hver kolonne.",
    "validating": "Validerer…",
    "toValidate": "Validér",
    "validateFailed": "Validering mislykkedes.",
    "validationSummary": "{valid} af {total} rækker klar til import — {invalid} springes over.",
    "allValid": "Alle rækker bestod valideringen",
    "run": "Kør import",
    "runSkipping": "Importér {valid} rækker (spring {invalid} over)",
    "progressLabel": "Importfremdrift",
    "running": "Importerer…",
    "kpiTotal": "Rækker i filen",
    "kpiCreated": "Oprettet",
    "kpiUpdated": "Opdateret",
    "kpiSkipped": "Sprunget over",
    "inconsistent": "Importtallene stemmer ikke — total skal være lig oprettet + opdateret + sprunget over.",
    "downloadErrors": "Download rapporten over oversprungne rækker (CSV)",
    "runFailed": "Importen mislykkedes."
  },
  "exports": {
    "tableLabel": "Tabel",
    "tablePlaceholder": "Vælg en tabel…",
    "notATable": "Den side er ikke en tabel — vælg en tabelside at eksportere.",
    "formatLabel": "Format",
    "create": "Eksportér",
    "createFailed": "Eksporten kunne ikke startes.",
    "retention": "Eksporter gemmes i 30 dage og udløber derefter.",
    "statusProcessing": "Behandler…",
    "statusReady": "Klar — {rows} rækker · klik for at downloade",
    "statusFailed": "Mislykkedes — {error}",
    "statusCancelled": "Annulleret",
    "statusExpired": "Udløbet",
    "emptyTitle": "Ingen eksporter endnu",
    "emptyBody": "Anmod om en ovenfor — artefakter vises her med deres status.",
    "new": "Ny eksport"
  },
  "builder": {
    "title": "Ny eksport",
    "subtitle": "Vælg en tabel, vælg kolonnerne, tjek filen, eksportér.",
    "cancel": "Annuller",
    "backToExports": "Tilbage til Dataeksporter",
    "basedOn": "Baseret på {name}",
    "noAccess": {
      "title": "Intet at eksportere endnu",
      "body": "Du har ikke eksportadgang til nogen tabel på denne forbindelse. Bed en administrator om at give den under {link}.",
      "link": "Roller og adgang"
    },
    "step": "Trin {n} af 3",
    "steps": {
      "source": "Kilde",
      "columns": "Kolonner",
      "preview": "Forhåndsvisning"
    },
    "continue": "Fortsæt",
    "export": "Eksportér",
    "back": "Tilbage",
    "hint": {
      "chooseTable": "Vælg en tabel for at fortsætte.",
      "fromAll": "Starter fra alle kolonner i {table}.",
      "fromPage": "Starter fra en side bundet til {table}.",
      "noColumns": "Tilføj mindst én kolonne for at fortsætte.",
      "dupes": "To kolonner har samme overskrift. Omdøb den ene for at fortsætte.",
      "order": "{n} kolonner skrives i denne rækkefølge.",
      "readSample": "Læs prøven, før du eksporterer.",
      "downloads": "Filen hentes fra Dataeksporter, når den er klar."
    },
    "source": {
      "title": "Hvilken tabel?",
      "search": "Søg i tabeller…",
      "meta": "{rows} rækker · {cols} kolonner",
      "metaNoRows": "{cols} kolonner",
      "usedBy": "Bruges af {n, plural, one {# side} other {# sider}}",
      "locked": "Ingen eksportadgang",
      "lockedToast": "Du har ikke eksportadgang til {table}"
    },
    "startFrom": {
      "title": "Start fra",
      "body": "Vælg, hvor kolonnelisten begynder. Du kan ændre alt i næste trin.",
      "all": "Alle kolonner i {table}",
      "page": "Kolonnerne fra en side — {page}",
      "pageMeta": "{page} · {n} kolonner · {linked} koblede · {totals, plural, one {# total} other {# totaler}}",
      "none": "Ingen side er bundet til denne tabel"
    },
    "columns": {
      "title": "Hvad der kommer i filen.",
      "add": "Tilføj kolonner",
      "inFile": "I din fil",
      "summary": "{n} kolonner · {linked} koblede · {totals, plural, one {# total} other {# totaler}}",
      "reset": "Nulstil til tabellens kolonner",
      "removeAll": "Fjern alle",
      "empty": {
        "title": "Ingen kolonner endnu",
        "body": "Tilføj kolonner fra panelet, eller nulstil til tabellens egne kolonner."
      },
      "dragTitle": "Træk for at omarrangere, eller brug piletasterne",
      "reorder": "Omarranger {header}",
      "headerLabel": "Overskrift i filen",
      "masked": "Eksporteres som •••••, medmindre du har afsløringsrettigheden",
      "dupe": "En anden kolonne bruger denne overskrift",
      "removeTitle": "Fjern fra filen",
      "remove": "Fjern {header}"
    },
    "browser": {
      "search": "Søg i kolonner…",
      "broken": "Det link kan ikke længere slås op — start det forfra.",
      "brokenBack": "Tilbage til alle tabeller",
      "suggested": "Foreslået",
      "fromTable": "Fra {table}",
      "fromTheTable": "Fra tabellen",
      "readOnly": "Skrivebeskyttet kolonne",
      "noMatch": "Ingen kolonne matcher den søgning.",
      "allIn": "Alle kolonner i denne tabel er allerede i din fil.",
      "linked": "Fra koblede tabeller",
      "budget": "{used} af {max}",
      "inbound": "Tabeller der peger hertil",
      "via": "via {column}",
      "count": "Antal",
      "aggregate": "Aggregat",
      "add": "Tilføj",
      "singleNote": "Min og Maks tager én kolonne.",
      "limit": "Grænse nået — fjern én for at tilføje en anden",
      "fourMax": "Op til fire kolonner",
      "pickNumeric": "Vælg først en numerisk kolonne",
      "already": "{header} er allerede i din fil",
      "added": "{header} tilføjet",
      "calculated": "Beregnet",
      "hop": "Tilføj en kolonne, eller følg et andet link udad.",
      "hopLimit": "Tre hop er grænsen. Tilføj en kolonne her, eller gå tilbage.",
      "addName": "Tilføj {name}",
      "noRead": "Ingen læseadgang"
    },
    "calc": {
      "arith": "Læg to kolonner sammen eller træk fra",
      "first": "Første kolonne",
      "op": "Operator",
      "second": "Anden kolonne",
      "pct": "En procentdel af én kolonne",
      "pctLabel": "Procent",
      "pctOf": "% af",
      "column": "Kolonne",
      "rule": "En regel med en tærskel",
      "if": "Hvis",
      "isOver": "er over",
      "then": "så",
      "else": "ellers",
      "threshold": "Tærskel",
      "whenOver": "Værdi når over",
      "otherwise": "Værdi ellers",
      "needTwo": "Tilføj først to numeriske kolonner",
      "needOne": "Tilføj først en numerisk kolonne"
    },
    "gen": {
      "count": "{table} antal",
      "countSrc": "antal af {table} via {column}",
      "foldSrc": "{fn} af {table}.{cols}",
      "linkedSrc": "{table}.{column} via {path}",
      "arithHeader": "{a} {op} {b}",
      "pctHeader": "{pct}% af {a}",
      "ruleHeader": "{then} eller {else}",
      "ruleSrc": "hvis {a} er over {threshold} så {then}, ellers {else}",
      "sumOf": "Sum af",
      "average": "Gennemsnit",
      "min": "Min",
      "max": "Maks"
    },
    "badge": {
      "key": "Nøgle",
      "linked": "Koblet",
      "count": "Antal",
      "sum": "Sum",
      "avg": "Gennemsnit",
      "min": "Min",
      "max": "Maks",
      "calculated": "Beregnet",
      "masked": "Maskeret"
    },
    "fold": {
      "sum": "Sum",
      "avg": "Gennemsnit",
      "min": "Min",
      "max": "Maks"
    },
    "preview": {
      "title": "Tjek filen, og eksportér så.",
      "fileName": "Filnavn",
      "format": "Format",
      "csv": "CSV",
      "jsonl": "JSON Lines",
      "rows": "Rækker",
      "allRows": "Alle rækker · {n}",
      "allRowsUnknown": "Alle rækker",
      "viewRows": "Rækker fra en gemt visning",
      "savedView": "Gemt visning",
      "viewLabel": "{name} · {filters} filtre · {rows} rækker",
      "viewLabelNoRows": "{name} · {filters} filtre",
      "headerRow": "Overskriftsrække",
      "tabTable": "Tabel",
      "tabRaw": "Rå fil",
      "sample": "Prøve på {n} rækker · opdateret {when}",
      "justNow": "lige nu",
      "minutesAgo": "{n, plural, one {for # minut siden} other {for # minutter siden}}",
      "refresh": "Opdater",
      "failed": "Prøven kunne ikke læses.",
      "failedTimeout": "Forbindelsen svarede for langsomt. Selve eksporten er ikke kørt.",
      "retry": "Prøv igen",
      "headerOnly": "Filen vil kun indeholde overskriftsrækken."
    },
    "summary": {
      "title": "Filen",
      "columns": "Kolonner",
      "rows": "Rækker",
      "size": "Anslået størrelse",
      "retention": "Opbevaring",
      "kept": "Gemmes i 30 dage",
      "fileName": "Filnavn"
    },
    "warn": {
      "title": "Værd at vide",
      "masked": "{n, plural, one {# kolonne eksporteres} other {# kolonner eksporteres}} maskeret",
      "search": "Denne visning har et søgeord, som en eksport ikke kan tage med",
      "noRows": "Denne tabel har ingen rækker lige nu"
    },
    "started": {
      "preparing": "Forbereder {file} · {rows} rækker",
      "ready": "Klar · {rows} rækker",
      "noteBusy": "Den vises under Dataeksporter og kan hentes derfra, når den er klar.",
      "noteReady": "Klar. Den ligger også under Dataeksporter, hvis du hellere vil vende tilbage senere.",
      "download": "Hent {format}",
      "busy": "Forbereder filen…",
      "another": "Eksportér en til",
      "failed": "Eksporten mislykkedes."
    },
    "toast": {
      "started": "Eksport startet"
    }
  }
} as const;
