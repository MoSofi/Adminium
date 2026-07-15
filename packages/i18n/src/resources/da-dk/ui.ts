/**
 * GENERATED MIRROR of ../../../locales/da-DK/ui.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "close": "Luk",
    "cancel": "Annuller",
    "confirm": "Bekræft",
    "save": "Gem",
    "apply": "Anvend",
    "delete": "Slet",
    "edit": "Rediger",
    "copy": "Kopiér",
    "copied": "Kopieret",
    "undo": "Fortryd",
    "retry": "Prøv igen",
    "clear": "Ryd",
    "selectAll": "Vælg alle",
    "clearSelection": "Ryd markering",
    "showPassword": "Vis adgangskode",
    "hidePassword": "Skjul adgangskode",
    "reveal": "Vis",
    "hide": "Skjul"
  },
  "state": {
    "loading": "Indlæser…",
    "empty": "Her er intet endnu",
    "noResults": "Ingen resultater",
    "optional": "Valgfrit",
    "required": "Påkrævet",
    "error": "Noget gik galt"
  },
  "pagination": {
    "previous": "Forrige",
    "next": "Næste",
    "pageOf": "Side {page, number} af {pages, number}",
    "rowsPerPage": "Rækker pr. side",
    "range": "{from, number}–{to, number} af {total, number}"
  },
  "table": {
    "sortAscending": "Sortér stigende",
    "sortDescending": "Sortér faldende",
    "rowActions": "Rækkehandlinger",
    "selectRow": "Vælg række",
    "selectAllRows": "Vælg alle rækker"
  },
  "dialog": {
    "close": "Luk dialog",
    "confirmTitle": "Er du sikker?"
  },
  "combobox": {
    "placeholder": "Vælg…",
    "search": "Søg…",
    "noMatches": "Ingen match"
  },
  "toast": {
    "dismiss": "Luk notifikation"
  },
  "widgets": {
    "charts": {
      "boxplot": {
        "description": "Boksplot-oversigt over en numerisk kolonnes spredning pr. kategori – min, kvartiler, median og maks.",
        "emptyTitle": "Ingen fordeling at vise",
        "emptyBody": "Ingen rækker matchede filtrene til boksplot."
      },
      "violin": {
        "description": "Spejlede tæthedskurver, der sammenligner en numerisk kolonnes fordeling på tværs af grupper.",
        "emptyTitle": "Ingen fordeling at vise",
        "emptyBody": "Ingen rækker matchede filtrene til tæthedsprofiler."
      },
      "ridgeline": {
        "description": "Overlappende tætheds-rygge, der sammenligner en numerisk kolonne på tværs af ordnede grupper.",
        "emptyTitle": "Ingen rygge at vise",
        "emptyBody": "Ingen rækker matchede filtrene til tæthedsprofiler."
      },
      "scatterBubble": {
        "description": "To numeriske kolonner som punkter, med valgfri boblestørrelse og en tendenslinje.",
        "emptyTitle": "Ingen punkter at vise",
        "emptyBody": "Ingen rækker matchede filtrene for de valgte kolonner."
      },
      "hexbin": {
        "description": "Heksbinnet tæthed af to numeriske kolonner, farvet efter antal rækker pr. felt.",
        "emptyTitle": "Ingen tæthed at vise",
        "emptyBody": "Ingen rækker matchede filtrene til binning."
      },
      "correlationMatrix": {
        "description": "Pearson-korrelation mellem valgte numeriske kolonner, fra stærkt positiv til stærkt negativ.",
        "emptyTitle": "Intet at korrelere",
        "emptyBody": "Vælg mindst to numeriske kolonner med matchende rækker."
      },
      "parallelCoordinates": {
        "description": "Hver post som en linje på tværs af flere normaliserede numeriske akser, farvet efter kategori.",
        "emptyTitle": "Ingen poster at vise",
        "emptyBody": "Ingen rækker matchede filtrene på tværs af de valgte akser."
      }
    },
    "feeds": {
      "activityFeed": {
        "description": "Et løbende feed over hvem der gjorde hvad i dit arbejdsområde, nyeste først.",
        "emptyTitle": "Ingen nylig aktivitet",
        "emptyBody": "Handlinger i dit arbejdsområde vises her."
      },
      "notificationFeed": {
        "description": "Grupperede notifikationer med ulæst-status, filtre og indlejrede handlinger.",
        "emptyTitle": "Ingen notifikationer",
        "emptyBody": "Nye notifikationer vises her."
      },
      "realtimeFeed": {
        "description": "Et live-hændelsesfeed, der føjer nye poster øverst, efterhånden som de ankommer.",
        "emptyTitle": "Venter på hændelser",
        "emptyBody": "Live-hændelser vises, efterhånden som de sker."
      },
      "timelineVertical": {
        "description": "En lodret tidslinje over hændelser, udgivelser, hændelser eller kørselstrin.",
        "emptyTitle": "Ingenting her endnu",
        "emptyBody": "Hændelser vises på denne tidslinje, efterhånden som de sker."
      },
      "unreadBadge": {
        "description": "En tællermærkat for ulæste elementer, synkroniseret med feedets tilstand.",
        "unitLabel": "ulæste"
      }
    },
    "tables": {
      "masterList": {
        "description": "En valgbar liste over poster, der styrer et detaljepanel.",
        "emptyTitle": "Ingen elementer",
        "emptyBody": "Elementer vises her, når de findes."
      },
      "logTable": {
        "description": "En hændelseslog med søgning, fejlfilter og rækkehandlinger.",
        "emptyTitle": "Ingen logposter",
        "emptyBody": "Hændelser registreres her, efterhånden som de sker."
      },
      "cardGallery": {
        "description": "Et responsivt galleri af entitetskort med status og hurtige handlinger.",
        "emptyTitle": "Intet at vise",
        "emptyBody": "Elementer vises her som kort."
      },
      "groupedSummaryTable": {
        "description": "Grupperede rækker med aggregatkolonner, foldbare detaljer og totaler.",
        "emptyTitle": "Ingen opsummeringsdata",
        "emptyBody": "Grupperede totaler vises her, når der er data."
      },
      "schemaTree": {
        "description": "En udforsker til skemaer, tabeller og kolonner med type- og nøglemærkater.",
        "emptyTitle": "Intet skema indlæst",
        "emptyBody": "Forbind en database for at udforske dens skema her."
      },
      "toggleMatrix": {
        "description": "Et interaktivt gitter af boolske kontakter til roller, politikker eller kanaler.",
        "emptyTitle": "Ingen matrix konfigureret",
        "emptyBody": "Rækker og kolonner vises her, når de er konfigureret."
      }
    }
  }
} as const;
