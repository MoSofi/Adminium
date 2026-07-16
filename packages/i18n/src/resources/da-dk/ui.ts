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
    "calendar": {
      "calendarMonth": {
        "description": "Et månedsgitter over planlagte begivenheder med chips pr. dag og månedsnavigation.",
        "emptyTitle": "Intet planlagt",
        "emptyBody": "Planlagte begivenheder vises i denne kalender."
      },
      "dayAgenda": {
        "description": "Den valgte dags begivenheder som en tidsordnet dagsorden.",
        "emptyTitle": "Intet planlagt",
        "emptyBody": "Begivenheder for den valgte dag vises her."
      },
      "scheduleMatrix": {
        "description": "Et vagtgitter efter ressource og dag med daglig dækning og en signaturforklaring.",
        "emptyTitle": "Ingen vagter planlagt",
        "emptyBody": "Tildelte vagter vises i denne plan."
      },
      "capacityBoard": {
        "description": "Udnyttelsesbjælker pr. medlem med projektopdeling og belastningsstatus.",
        "emptyTitle": "Ingen arbejdsbelastningsdata",
        "emptyBody": "Medlemmernes udnyttelse vises her, når der findes tildelinger."
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
    },
    "boards": {
      "kanbanBoard": {
        "description": "Faste statuskolonner med kort, der kan trækkes; træk et kort til en anden kolonne for at ændre dets status.",
        "emptyTitle": "Ingen kort endnu",
        "emptyBody": "Kort vises i deres statuskolonner, efterhånden som poster oprettes."
      },
      "kanbanSwimlaneGrid": {
        "description": "Et gitter af baner × kolonner; at trække et kort tildeler både dets bane og dets status på ny.",
        "emptyTitle": "Ingen baner at vise",
        "emptyBody": "Gruppér poster efter et bane-felt og et status-felt for at opbygge gitteret."
      },
      "addCard": "Tilføj kort",
      "grip": "Træk for at flytte kortet",
      "pointsUnit": "pt.",
      "laneSummary": "Σ{points} pt. · {count}",
      "a11y": {
        "grabbed": "{title} taget op. Brug piletasterne til at flytte, Enter for at slippe, Escape for at annullere.",
        "over": "{title} er over {cell}.",
        "moved": "{title} flyttet til {cell}.",
        "returned": "{title} vendte tilbage til sin oprindelige placering.",
        "failed": "{title} kunne ikke flyttes; den blev sat tilbage."
      }
    },
    "communication": {
      "conversationInbox": {
        "description": "En liste over samtaler, der kan vælges, med ulæste, tilstedeværelse og forhåndsvisning af seneste besked.",
        "emptyTitle": "Ingen samtaler",
        "emptyBody": "Samtaler vises her, efterhånden som beskeder ankommer.",
        "noMatchesTitle": "Ingen samtaler matcher",
        "searchLabel": "Søg i samtaler",
        "searchPlaceholder": "Søg i samtaler…"
      },
      "chatThread": {
        "description": "Beskedbobler grupperet efter afsender og dag, med vedhæftninger og et skrivefelt.",
        "emptyTitle": "Ingen beskeder endnu",
        "emptyBody": "Beskeder i denne samtale vises her.",
        "composerPlaceholder": "Skriv en besked…",
        "sendLabel": "Send",
        "attachLabel": "Tilføj vedhæftning",
        "typingLabel": "skriver…"
      },
      "aiChatPanel": {
        "description": "Et assistentpanel til at stille spørgsmål om dit skema og dine data.",
        "emptyTitle": "Spørg om dine data",
        "emptyBody": "Stil et spørgsmål om dit skema, dine tabeller eller metrikker for at komme i gang.",
        "composerPlaceholder": "Stil et spørgsmål…",
        "sendLabel": "Send",
        "pendingLabel": "Tænker…",
        "configureTitle": "Ingen AI-udbyder konfigureret",
        "configureBody": "Tilføj en Anthropic- eller OpenAI-nøgle — eller peg Adminium mod dit eget endpoint — for at stille spørgsmål om dit skema.",
        "configureCtaLabel": "Konfigurér en udbyder"
      }
    },
    "domain": {
      "orgChart": {
        "description": "Referencetræet bygget ud fra en persontabels lederreference, med foldbare grene.",
        "emptyTitle": "Ingen rapporteringsstruktur",
        "emptyBody": "Organisationsdiagrammet vises, når personrækker refererer til en leder.",
        "reportsLabel": "Referenter · {count}",
        "a11yLabel": "Organisationsdiagram"
      },
      "ganttChart": {
        "description": "Opgavebjælker på en tidsakse grupperet efter fase, med fremdrift, milepæle og en dags-markør.",
        "emptyTitle": "Intet planlagt",
        "emptyBody": "Opgaver vises her, når de har start- og slutdato.",
        "ungroupedLabel": "Opgaver"
      }
    },
    "media": {
      "fileBrowser": {
        "description": "Gennemse filer og mapper som et felt-gitter eller en liste – med brødkrummesti, typeikoner og stjernemarkering.",
        "emptyTitle": "Denne mappe er tom",
        "emptyBody": "Upload filer eller opret en mappe for at komme i gang."
      },
      "uploadDropzone": {
        "description": "Et træk-og-slip-mål til upload af filer, med format- og størrelsesbegrænsninger.",
        "dropTitle": "Slip filer for at uploade",
        "browsePrefix": "eller",
        "browseLabel": "gennemse"
      },
      "uploadProgressList": {
        "description": "Rækker pr. fil med statuslinje og status; driver også job i eksportkøen.",
        "emptyTitle": "Ingen uploads i gang",
        "emptyBody": "Filer, du uploader, viser deres fremdrift her."
      },
      "attachmentList": {
        "description": "Filer vedhæftet en post, med typeikoner, størrelser og handlinger til download eller sletning.",
        "emptyTitle": "Ingen vedhæftede filer",
        "emptyBody": "Filer vedhæftet denne post vises her."
      },
      "imageBoard": {
        "description": "Et moodboard-gitter af billedpladser med billedtekster, til tabeller med billed-URL'er.",
        "emptyTitle": "Ingen billeder endnu",
        "emptyBody": "Referencebilleder vises på denne tavle."
      },
      "linkList": {
        "description": "Referencelinks med titler og URL'er, der åbnes i en ny fane.",
        "emptyTitle": "Ingen links endnu",
        "emptyBody": "Referencelinks vises her."
      },
      "root": "Filer",
      "breadcrumb": "Brødkrummesti",
      "gridView": "Gittervisning",
      "listView": "Listevisning",
      "nameHeader": "Navn",
      "sizeHeader": "Størrelse",
      "modifiedHeader": "Ændret",
      "star": "Stjernemarkér",
      "items": "elementer",
      "done": "Færdig",
      "failed": "Mislykkedes",
      "queued": "I kø",
      "retry": "Prøv igen",
      "download": "Download",
      "cancel": "Annullér",
      "delete": "Slet",
      "remove": "Fjern",
      "addImage": "Tilføj billede",
      "caption": "Billedtekst",
      "addLink": "Tilføj link",
      "linkTitlePlaceholder": "Titel",
      "linkUrlPlaceholder": "https://…",
      "add": "Tilføj"
    },
    "forms": {
      "modalWizard": {
        "description": "En modal opret-formular med bekræftelse — standardflowet for “ny post”.",
        "trigger": "Opret",
        "submit": "Opret",
        "cancel": "Annuller",
        "done": "Færdig",
        "successTitle": "Post oprettet",
        "successBody": "Posten blev gemt.",
        "required": "Dette felt er påkrævet."
      },
      "drawerForm": {
        "description": "En sidepanel-formular til at oprette eller redigere poster med mange felter.",
        "trigger": "Ny",
        "submit": "Gem",
        "cancel": "Annuller"
      },
      "stepper": {
        "description": "En trinindikator, der viser hvor langt et flerdelt forløb er nået.",
        "a11yLabel": "Fremdrift"
      },
      "progressBar": {
        "description": "En fremdriftslinje med procentangivelse.",
        "label": "Fremdrift"
      },
      "otpInput": {
        "description": "Et felt til engangskoder.",
        "label": "Engangskode"
      },
      "chipInput": {
        "description": "Tag-input: chips der kan fjernes, plus fritekst der bekræftes med Enter.",
        "remove": "Fjern",
        "placeholder": "Skriv og tryk Enter…"
      },
      "segmentedControl": {
        "description": "En enkeltvalgskontrol til perioder, miljøer og filtre.",
        "a11yLabel": "Vælg en mulighed"
      },
      "filterChipBar": {
        "description": "Filterchips med live-tællere beregnet ud fra listen, de filtrerer.",
        "all": "Alle",
        "a11yLabel": "Filtrer",
        "meta": "{shown} af {total}"
      },
      "toggleSwitchList": {
        "description": "En liste med indstillinger, hver med en kontakt.",
        "save": "Gem",
        "dirty": "Du har ugemte ændringer",
        "emptyTitle": "Ingen indstillinger",
        "emptyBody": "Indstillinger vises her, når de er konfigureret."
      },
      "optionCards": {
        "description": "Et kortgitter med enkeltvalg til kilder, skabeloner og abonnementer.",
        "a11yLabel": "Vælg en mulighed"
      },
      "passwordStrengthMeter": {
        "description": "En firedelt måler for adgangskodens styrke.",
        "label": "Adgangskodens styrke",
        "weak": "Svag",
        "fair": "Middel",
        "good": "God",
        "strong": "Stærk"
      },
      "validationIssuesList": {
        "description": "Import- og valideringsproblemer, de alvorligste først, med antal berørte rækker.",
        "emptyTitle": "Ingen problemer fundet",
        "emptyBody": "Alt ser godt ud — du kan importere."
      }
    },
    "chrome": {
      "sidebarNav": {
        "description": "Appens grupperede navigationspanel med live-tællere.",
        "a11yLabel": "Hovednavigation",
        "emptyTitle": "Ingen navigation endnu",
        "emptyBody": "Inkluderede tabeller vises her, når en forbindelse er genereret."
      },
      "commandPalette": {
        "description": "⌘K-paletten: søg efter handlinger, sider og poster hvor som helst fra.",
        "title": "Kommandopalet",
        "placeholder": "Søg efter handlinger, sider og poster…",
        "navigate": "Naviger",
        "select": "Åbn",
        "close": "Luk",
        "emptyTitle": "Ingen resultater",
        "emptyBody": "Begynd at skrive for at søge.",
        "groupActions": "Handlinger",
        "groupNavigate": "Naviger",
        "groupRecent": "Seneste",
        "groupPages": "Sider",
        "groupMetrics": "Målinger",
        "groupPeople": "Personer",
        "groupRecords": "Poster"
      },
      "globalSearch": {
        "description": "Søg på tværs af alle entiteter med typefiltre og resultatuddrag.",
        "placeholder": "Søg i alt…",
        "all": "Alle",
        "summary": "{count} resultater for “{query}”",
        "emptyTitle": "Ingen resultater",
        "emptyBody": "Prøv et andet søgeord."
      },
      "breadcrumb": {
        "description": "Stien til den aktuelle post eller mappe.",
        "a11yLabel": "Brødkrummesti"
      },
      "tabBar": {
        "description": "Faner der skifter paneler eller navigerer, valgfrit med tællere.",
        "a11yLabel": "Faner"
      },
      "navCard": {
        "description": "Et gitter af linkkort til forsider og oversigtssider.",
        "emptyTitle": "Intet at vise",
        "emptyBody": "Links vises her, når siderne er genereret."
      },
      "shortcutsPanel": {
        "description": "Oversigten over tastaturgenveje.",
        "footerHint": "Tryk ? når som helst",
        "then": "derefter",
        "emptyTitle": "Ingen genveje registreret."
      },
      "avatarStack": {
        "description": "Overlappende avatarer med “+N”-overløb og valgfri tilstedeværelse.",
        "online": "{count} online"
      }
    },
    "system": {
      "stateHero": {
        "description": "En statusskærm i fuld side til 404, 500, offline, ingen adgang og vedligeholdelse.",
        "notFoundTitle": "Denne side kørte forkert",
        "notFoundBody": "Siden du leder efter blev flyttet, omdøbt, eller har aldrig eksisteret.",
        "serverErrorTitle": "Noget gik galt hos os",
        "serverErrorBody": "Fejlen blev logget og teamet underrettet. Et nyt forsøg virker ofte.",
        "offlineTitle": "Du er offline",
        "offlineBody": "Tjek din forbindelse — dashboardet forbinder automatisk igen.",
        "forbiddenTitle": "Du har ikke adgang",
        "forbiddenBody": "Bed en arbejdsområde-administrator om adgang til denne side.",
        "maintenanceTitle": "Nede til vedligeholdelse",
        "maintenanceBody": "Vi gør tingene bedre. Det tager som regel få minutter.",
        "connErrorTitle": "Kan ikke nå databasen",
        "connErrorBody": "Forbindelsen blev afvist eller fik timeout. Tjek forbindelsesindstillingerne.",
        "backToDashboard": "Tilbage til dashboard",
        "tryAgain": "Prøv igen",
        "retry": "Prøv igen",
        "testConnection": "Test forbindelse"
      },
      "emptyState": {
        "description": "Et centreret “intet her endnu”-panel med valgfrie handlinger."
      },
      "statusPill": {
        "description": "Et farvekodet badge til en enum-kolonne — den universelle statusvisning."
      },
      "alertBanner": {
        "description": "En indlejret besked om kvoter, fastfrysning og planlægning.",
        "dismiss": "Luk"
      },
      "statusBannerHero": {
        "description": "En service-sundhedsbanner, hvis tilstand udledes af den værste service på listen.",
        "upTitle": "Alle systemer kører",
        "upBody": "Alle overvågede services svarer normalt.",
        "degradedTitle": "Forringet ydeevne",
        "degradedBody": "Nogle services er langsommere end normalt. Vi undersøger det.",
        "downTitle": "Større nedbrud",
        "downBody": "En eller flere services er utilgængelige. Vi er på sagen."
      },
      "connectionStatus": {
        "description": "Forbindelses- eller testresultatet for en databaseforbindelse.",
        "idle": "Ikke forbundet",
        "connecting": "Forbinder…",
        "connected": "Forbundet",
        "failed": "Kunne ikke forbinde",
        "test": "Test"
      },
      "autosaveIndicator": {
        "description": "Mærket “ugemt → gemmer → gemt” til dokumenter med automatisk lagring.",
        "dirty": "Ugemte ændringer",
        "saving": "Gemmer…",
        "saved": "Alle ændringer gemt",
        "error": "Kunne ikke gemme"
      },
      "progressLogConsole": {
        "description": "En streamende logkonsol med fremdriftslinje til langvarige opgaver.",
        "a11yLabel": "Fremdriftslog",
        "progressLabel": "Fremdrift",
        "emptyTitle": "Intet at rapportere endnu",
        "emptyBody": "Loglinjer vises her, når opgaven starter."
      },
      "diagnosticsReadout": {
        "description": "Resultater af forbindelsestjek som farvekodede nøgle/værdi-rækker med tidsstempel.",
        "checkedAt": "Senest tjekket",
        "host": "Vært",
        "dns": "DNS",
        "tcp": "TCP",
        "tls": "TLS",
        "auth": "Godkendelse",
        "latency": "Svartid"
      }
    }
  },
  "grid": {
    "dragHandle": "Træk for at flytte {title}",
    "resizeHandle": "Tilpas størrelsen på {title}",
    "a11y": {
      "grabbed": "{title} taget. Brug piletasterne til at flytte, hold Skift for at ændre størrelse, Enter for at gemme, Escape for at annullere.",
      "moved": "{title} flyttet til kolonne {col}, række {row}.",
      "resized": "{title} ændret til {w} kolonner gange {h} rækker.",
      "committed": "{title} placeret i kolonne {col}, række {row}.",
      "reverted": "{title} sat tilbage til sin oprindelige position."
    }
  }
} as const;
