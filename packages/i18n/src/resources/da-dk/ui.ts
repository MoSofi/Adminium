// SPDX-License-Identifier: AGPL-3.0-only
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
    "hide": "Skjul",
    "clearSearch": "Ryd søgning"
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
    "kpi": {
      "statCard": {
        "description": "Standardkortet til nøgletal: ét hovedtal med valgfri trendplakette og mini-sparkline."
      },
      "usageMeter": {
        "description": "Kvoteforbrug op mod en grænse; bjælken skifter til gul og derefter rød ud over dine tærskler.",
        "usageLabel": "Forbrug",
        "ofLabel": "af"
      },
      "statTileCompact": {
        "description": "En smal nøgletalsflise med mikroetiket, trendchip og 6-bjælkers spark — til tætte rækker på 4 til 6."
      },
      "metricHero": {
        "description": "Ét overdimensioneret nøgletal, der tæller op ved indlæsning, med trendplakette, spark og målfremdrift.",
        "goalLabel": "Mål"
      },
      "statPairCard": {
        "description": "To nøgletal side om side; det andet kan udledes af det første."
      },
      "gaugeRing": {
        "description": "En ringmåler til en score eller procent, farvet efter det bånd, værdien falder i."
      },
      "gaugeArc": {
        "description": "En speedometerbue med kvalitative bånd og en viser; viser også et gitter af målere.",
        "emptyTitle": "Ingen målere at vise",
        "emptyBody": "Tjenester vises her som målere, når der findes en aflæsning for dem."
      },
      "periodComparison": {
        "description": "Denne periode mod den forrige som to bjælker, med forskellen beregnet nedenunder.",
        "higherLabel": "højere",
        "lowerLabel": "lavere",
        "flatLabel": "uændret",
        "periodALabel": "Denne periode",
        "periodBLabel": "Forrige periode"
      },
      "microKpiSubtitle": {
        "description": "Et enkeltlinjes nøgletal i sidehovedet, bygget ud fra en skabelon og genberegnet løbende."
      },
      "autoInsights": {
        "description": "Rangerede indsigter — et hovedtal, en sætning og et spark — med rotation ved opdatering.",
        "emptyTitle": "Ingen indsigter endnu",
        "emptyBody": "Indsigter dukker op, når der er data nok til at se et mønster.",
        "refreshLabel": "Opdatér"
      }
    },
    "charts": {
      "boxplot": {
        "description": "Boksplot-oversigt over en numerisk kolonnes spredning pr. kategori – min, kvartiler, median og maks.",
        "emptyTitle": "Ingen fordeling at vise",
        "emptyBody": "Ingen rækker matchede filtrene til boksplot.",
        "chartLabel": "Boksplot"
      },
      "violin": {
        "description": "Spejlede tæthedskurver, der sammenligner en numerisk kolonnes fordeling på tværs af grupper.",
        "emptyTitle": "Ingen fordeling at vise",
        "emptyBody": "Ingen rækker matchede filtrene til tæthedsprofiler.",
        "chartLabel": "Violinplot"
      },
      "ridgeline": {
        "description": "Overlappende tætheds-rygge, der sammenligner en numerisk kolonne på tværs af ordnede grupper.",
        "emptyTitle": "Ingen rygge at vise",
        "emptyBody": "Ingen rækker matchede filtrene til tæthedsprofiler.",
        "chartLabel": "Ridgeline-diagram"
      },
      "scatterBubble": {
        "description": "To numeriske kolonner som punkter, med valgfri boblestørrelse og en tendenslinje.",
        "emptyTitle": "Ingen punkter at vise",
        "emptyBody": "Ingen rækker matchede filtrene for de valgte kolonner.",
        "chartLabel": "Punktdiagram"
      },
      "hexbin": {
        "description": "Heksbinnet tæthed af to numeriske kolonner, farvet efter antal rækker pr. felt.",
        "emptyTitle": "Ingen tæthed at vise",
        "emptyBody": "Ingen rækker matchede filtrene til binning.",
        "chartLabel": "Heksbin-tæthed"
      },
      "correlationMatrix": {
        "description": "Pearson-korrelation mellem valgte numeriske kolonner, fra stærkt positiv til stærkt negativ.",
        "emptyTitle": "Intet at korrelere",
        "emptyBody": "Vælg mindst to numeriske kolonner med matchende rækker.",
        "chartLabel": "Korrelationsmatrix"
      },
      "parallelCoordinates": {
        "description": "Hver post som en linje på tværs af flere normaliserede numeriske akser, farvet efter kategori.",
        "emptyTitle": "Ingen poster at vise",
        "emptyBody": "Ingen rækker matchede filtrene på tværs af de valgte akser.",
        "chartLabel": "Parallelle koordinater"
      },
      "unexpectedShape": "Uventet dataform.",
      "lineArea": {
        "chartLabel": "Kurvediagram",
        "description": "En måling over tid som en kurve med et blødt udfyldt areal og en valgfri stiplet sammenligning med forrige periode."
      },
      "bar": {
        "chartLabel": "Søjlediagram",
        "description": "Kategoriske eller tidsopdelte værdier som lodrette søjler, med valgfri fremhævning af den største eller aktuelle søjle."
      },
      "donut": {
        "chartLabel": "Ringdiagram",
        "otherLabel": "Andet",
        "description": "Kategoriandele som ringudsnit med signaturforklaring og total i midten; små udsnit samles under Andet."
      },
      "bullet": {
        "chartLabel": "Bullet-diagram",
        "description": "Fremdrift mod et mål som en målebjælke over kvalitative bånd, med en målmarkering pr. række.",
        "emptyTitle": "Ingen mål at følge",
        "emptyBody": "Tilføj målinger med mål at sammenligne med."
      },
      "rankingBars": {
        "chartLabel": "Rangering",
        "description": "En top-N-rangering som vandrette bjælker — føreren i fuld styrke, resten dæmpet — med værdierne ved siden af.",
        "emptyTitle": "Intet at rangere",
        "emptyBody": "Ingen poster matchede denne opdeling endnu."
      },
      "pareto": {
        "chartLabel": "Paretodiagram",
        "description": "Sorterede kategorisøjler under en kurve med kumuleret procent, med en valgfri 80%-grænselinje.",
        "emptyTitle": "Ingen kategorier at vise",
        "emptyBody": "Der blev ikke returneret grupperede antal for dette interval."
      },
      "waterfall": {
        "chartLabel": "Vandfaldsdiagram",
        "description": "En bro af svævende søjler fra en starttotal gennem positive og negative trin til en nettototal.",
        "emptyTitle": "Ingen bevægelse at bygge bro over",
        "emptyBody": "Der blev ikke fundet nogen start-, ændrings- eller totaltrin."
      },
      "marimekko": {
        "chartLabel": "Marimekko-diagram",
        "description": "Et miks i to niveauer som stablede søjler med varierende bredde — bredden viser den ydre andel, segmenterne den indre fordeling.",
        "emptyTitle": "Intet miks at opdele",
        "emptyBody": "Der blev ikke returneret en opdeling i to niveauer for dette interval."
      },
      "stackedBar100": {
        "chartLabel": "100% stablet søjle",
        "description": "Én 100%-søjle delt i proportionale segmenter med signaturforklaring, der sammenligner andele af en helhed.",
        "emptyTitle": "Ingen andele at opdele",
        "emptyBody": "Der blev ikke returneret nogen dele for denne opdeling."
      },
      "slope": {
        "chartLabel": "Hældningsdiagram",
        "description": "To perioder forbundet med én linje pr. post, farvet efter om værdien steg eller faldt.",
        "emptyTitle": "Ingen periodeforskydning at vise",
        "emptyBody": "Der blev ikke returneret før/efter-værdier at sammenligne."
      },
      "multiline": {
        "chartLabel": "Flerkurvediagram",
        "description": "Flere serier som overlejrede kurver med etiketter i enden, der sammenligner tendenser over samme tidsrum.",
        "emptyTitle": "Ingen serier at afbilde",
        "emptyBody": "Ingen tidsserier matchede filtrene for dette interval."
      },
      "stream": {
        "chartLabel": "Strømdiagram",
        "description": "Stablede bånd, der flyder om en midterlinje og viser, hvordan en totals sammensætning ændrer sig over tid.",
        "emptyTitle": "Intet flow at vise",
        "emptyBody": "Der blev ikke returneret stablede serier for dette interval."
      },
      "forecast": {
        "chartLabel": "Prognosediagram",
        "nowLabel": "Nu",
        "forecastLabel": "Prognose",
        "actualLabel": "Faktisk",
        "description": "En historikkurve forlænget af en stiplet fremskrivning inde i et stadig bredere konfidensbånd, delt ved en nu-markør.",
        "emptyTitle": "Ingen historik at fremskrive",
        "emptyBody": "Der blev ikke returneret tidligere punkter at lave prognose ud fra."
      },
      "anomaly": {
        "chartLabel": "Afvigelsesdiagram",
        "description": "En værdikurve over sit forventede interval, hvor punkter uden for intervallet fremhæves med ringmarkerede prikker.",
        "emptyTitle": "Intet signal at scanne",
        "emptyBody": "Der blev ikke returneret punkter at tjekke for afvigelser."
      },
      "candlestick": {
        "chartLabel": "Candlestick-diagram",
        "livePillLabel": "Live",
        "description": "Candlesticks med åbn, høj, lav og luk farvet efter retning, med en stiplet linje for seneste kurs og en valgfri live-plakette.",
        "emptyTitle": "Ingen candlesticks at vise",
        "emptyBody": "Ingen rækker med åbn, høj, lav og luk matchede dette interval."
      },
      "bump": {
        "chartLabel": "Bump-diagram",
        "description": "Kurver over placering gennem tiden, der viser, hvordan konkurrenter bytter plads fra periode til periode.",
        "emptyTitle": "Ingen placeringer at følge",
        "emptyBody": "Der blev ikke returneret rangeringer fra periode til periode."
      },
      "timelineLanes": {
        "chartLabel": "Tidslinjebaner",
        "laneLabel": "Hændelser",
        "description": "Daterede hændelser som plaketter på vandrette baner med fælles tidsakse.",
        "emptyTitle": "Ingen hændelser at placere",
        "emptyBody": "Ingen hændelser matchede filtrene for dette interval."
      },
      "treemap": {
        "chartLabel": "Trækort",
        "otherLabel": "Andet",
        "description": "En del-af-helhed-opdeling som kvadratiske fliser, hvis størrelse følger værdien; små udsnit samles i en Andet-flise.",
        "emptyTitle": "Ingen udsnit at vise",
        "emptyBody": "Der blev ikke returneret kategorier for denne opdeling."
      },
      "sunburst": {
        "chartLabel": "Solstrålediagram",
        "description": "Et hierarki i to niveauer som indlejrede ringe — forældrene inderst, deres børn yderst — med signaturforklaring for forældrene.",
        "emptyTitle": "Ingen ringe at tegne",
        "emptyBody": "Der blev ikke returneret grupperede kategorier at indlejre."
      },
      "funnel": {
        "chartLabel": "Tragt",
        "description": "Ordnede trin, der bliver mindre og mindre, med videreførselsrate pr. trin og den samlede konvertering i bunden.",
        "emptyTitle": "Ingen trin i tragten",
        "emptyBody": "Der blev ikke returneret antal pr. trin for dette interval."
      },
      "radialBar": {
        "chartLabel": "Radiale søjler",
        "description": "Op til fire procenter som koncentriske fremdriftsringe med en prikbaseret signaturforklaring.",
        "emptyTitle": "Ingen ringe at fylde",
        "emptyBody": "Ingen kategorier matchede denne opdeling endnu."
      },
      "radar": {
        "chartLabel": "Radar",
        "description": "Flere navngivne akser i en polygon med én udfyldt figur pr. serie, oven på et valgfrit mållag.",
        "emptyTitle": "Ingen akser at sammenligne",
        "emptyBody": "Der blev ikke returneret en matrix af serier og akser."
      },
      "chord": {
        "chartLabel": "Akkorddiagram",
        "description": "Parvise strømme som bånd mellem knuder på en ring, hvor båndenes gennemsigtighed vægtes efter mængde.",
        "emptyTitle": "Ingen strømme at forbinde",
        "emptyBody": "Der blev ikke returneret forbindelser mellem grupper."
      },
      "wordcloud": {
        "chartLabel": "Ordsky",
        "description": "Ord i en størrelse efter hyppighed, ombrudt i rækker, så du hurtigt kan se, hvad der dominerer.",
        "emptyTitle": "Ingen ord til skyen",
        "emptyBody": "Ingen vægtede ord matchede filtrene."
      },
      "cohortMatrix": {
        "chartLabel": "Kohortefastholdelse",
        "description": "Kohorterækker mod periodekolonner, hvor hver celle tones efter fastholdelse eller omsætning.",
        "regionLabel": "Cohort matrix"
      },
      "heatmapCalendar": {
        "chartLabel": "Aktivitetskalender",
        "legendLessLabel": "Mindre",
        "legendMoreLabel": "Mere",
        "description": "Et års daglige aktivitet som et gitter af uger og dage, tonet efter intensitet.",
        "regionLabel": "Activity calendar"
      },
      "heatMonth": {
        "chartLabel": "Månedlig aktivitet",
        "description": "Én kalendermåned som et dagsgitter, tonet efter den enkelte dags værdi.",
        "regionLabel": "Monthly heat map"
      },
      "choroplethGrid": {
        "chartLabel": "Regional fordeling",
        "legendLowLabel": "Lav",
        "legendHighLabel": "Høj",
        "description": "Regionale værdier som et tonet amerikansk fliselandkort eller et kompakt gitter, med en valgfri top-N-rangliste."
      },
      "sankey": {
        "chartLabel": "Flow",
        "description": "Lagdelte strømme fra kilde til mål som bånd, hvis tykkelse angiver mængden."
      },
      "sparkline": {
        "description": "En indlejret mikrotendens over de seneste værdier — uden akser eller etiketter — til nøgletalskort, tabelceller og listerækker."
      }
    },
    "feeds": {
      "activityFeed": {
        "description": "Et løbende feed over hvem der gjorde hvad i dit arbejdsområde, nyeste først.",
        "emptyTitle": "Ingen nylig aktivitet",
        "emptyBody": "Handlinger i dit arbejdsområde vises her.",
        "viewAllLabel": "Vis alle"
      },
      "notificationFeed": {
        "description": "Grupperede notifikationer med ulæst-status, filtre og indlejrede handlinger.",
        "emptyTitle": "Ingen notifikationer",
        "emptyBody": "Nye notifikationer vises her.",
        "allLabel": "Alle",
        "unreadLabel": "Ulæste",
        "mentionsLabel": "Omtaler",
        "filterLabel": "Notifikationsfilter",
        "markAllReadLabel": "Markér alle som læst",
        "todayLabel": "I dag",
        "yesterdayLabel": "I går",
        "earlierLabel": "Tidligere",
        "dismissLabel": "Afvis",
        "emptyUnreadTitle": "Du er helt ajour",
        "emptyMentionsTitle": "Ingen omtaler"
      },
      "realtimeFeed": {
        "description": "Et live-hændelsesfeed, der føjer nye poster øverst, efterhånden som de ankommer.",
        "emptyTitle": "Venter på hændelser",
        "emptyBody": "Live-hændelser vises, efterhånden som de sker.",
        "liveLabel": "Live",
        "pausedLabel": "Sat på pause",
        "pauseLabel": "Pause",
        "resumeLabel": "Fortsæt"
      },
      "timelineVertical": {
        "description": "En lodret tidslinje over hændelser, udgivelser, hændelser eller kørselstrin.",
        "emptyTitle": "Ingenting her endnu",
        "emptyBody": "Hændelser vises på denne tidslinje, efterhånden som de sker."
      },
      "unreadBadge": {
        "description": "En tællermærkat for ulæste elementer, synkroniseret med feedets tilstand.",
        "unitLabel": "ulæste"
      },
      "loadOlderPaginator": {
        "description": "En knap i bunden, der henter ældre poster i portioner, indtil feedet er opbrugt.",
        "label": "Hent ældre",
        "loadingLabel": "Henter …",
        "exhaustedLabel": "Ikke mere",
        "ofLabel": "af"
      },
      "toastStack": {
        "description": "Overlay-værten for toasts: korte bekræftelser med valgfri fortryd.",
        "undoLabel": "Fortryd",
        "dismissLabel": "Luk",
        "regionLabel": "Notifikationer"
      }
    },
    "calendar": {
      "calendarMonth": {
        "description": "Et månedsgitter over planlagte begivenheder med chips pr. dag og månedsnavigation.",
        "emptyTitle": "Intet planlagt",
        "emptyBody": "Planlagte begivenheder vises i denne kalender.",
        "previousLabel": "Forrige måned",
        "nextLabel": "Næste måned",
        "overflowLabel": "+{count} mere"
      },
      "dayAgenda": {
        "description": "Den valgte dags begivenheder som en tidsordnet dagsorden.",
        "emptyTitle": "Intet planlagt",
        "emptyBody": "Begivenheder for den valgte dag vises her.",
        "countLabel": "{count, plural, one {{n} begivenhed} other {{n} begivenheder}}"
      },
      "scheduleMatrix": {
        "description": "Et vagtgitter efter ressource og dag med daglig dækning og en signaturforklaring.",
        "emptyTitle": "Ingen vagter planlagt",
        "emptyBody": "Tildelte vagter vises i denne plan.",
        "resourceLabel": "Ressource",
        "coverageLabel": "Dækning",
        "hoursLabel": "{hours} t"
      },
      "capacityBoard": {
        "description": "Udnyttelsesbjælker pr. medlem med projektopdeling og belastningsstatus.",
        "emptyTitle": "Ingen arbejdsbelastningsdata",
        "emptyBody": "Medlemmernes udnyttelse vises her, når der findes tildelinger.",
        "status": {
          "overloaded": "Overbelastet",
          "balanced": "Balanceret",
          "available": "Ledig"
        },
        "utilizationLabel": "{name}: {util}%",
        "assignmentLabel": "{project} · {hours} t",
        "periodLabel": "t · {period}",
        "period": {
          "week": "uge",
          "month": "måned"
        }
      },
      "calendarLegendFilter": {
        "description": "Begivenhedskategorier med antal; et klik filtrerer kalenderen ved siden af.",
        "emptyTitle": "Ingen kategorier endnu",
        "emptyBody": "Begivenhedskategorier vises her, når der er begivenheder.",
        "uncategorizedLabel": "Uden kategori",
        "listLabel": "Categories"
      },
      "upcomingEventsList": {
        "description": "De næste begivenheder i datorækkefølge, med ejer og status.",
        "emptyTitle": "Intet på vej",
        "emptyBody": "Planlagte begivenheder vises her, efterhånden som de oprettes.",
        "listLabel": "Upcoming events"
      },
      "dateRangePicker": {
        "description": "Et datointerval med hurtigvalg, der filtrerer resten af siden.",
        "previousLabel": "Forrige måned",
        "nextLabel": "Næste måned",
        "summaryLabel": "{n} dage valgt",
        "presets": {
          "7d": "Seneste 7 dage",
          "30d": "Seneste 30 dage",
          "90d": "Seneste 90 dage",
          "mtd": "Måned til dato",
          "qtd": "Kvartal til dato",
          "ytd": "År til dato"
        }
      },
      "scheduledJobsList": {
        "description": "Tilbagevendende rapporter og eksporter med kadence, næste kørsel og til/fra-knap.",
        "emptyTitle": "Ingen planlagte job",
        "emptyBody": "Tilbagevendende rapporter og eksporter vises her, når de er planlagt.",
        "nextRunLabel": "Næste kørsel",
        "toggleLabel": "Aktivér tidsplan",
        "recipientsLabel": "Modtagere",
        "listLabel": "Scheduled jobs"
      }
    },
    "tables": {
      "masterList": {
        "description": "En valgbar liste over poster, der styrer et detaljepanel.",
        "emptyTitle": "Ingen elementer",
        "emptyBody": "Elementer vises her, når de findes.",
        "allLabel": "Alle",
        "toggleLabel": "Slå {title} til/fra",
        "progressLabel": "Fremdrift for {title}"
      },
      "logTable": {
        "description": "En hændelseslog med søgning, fejlfilter og rækkehandlinger.",
        "emptyTitle": "Ingen logposter",
        "emptyBody": "Hændelser registreres her, efterhånden som de sker.",
        "liveLabel": "Live",
        "placeholder": "Søg i loggen…",
        "filterLabel": "Logfilter",
        "allLabel": "Alle",
        "errorsLabel": "Fejl",
        "noMatchesLabel": "Ingen matchende poster",
        "todayLabel": "I dag",
        "yesterdayLabel": "I går",
        "action": {
          "retry": "prøv igen",
          "download": "download",
          "inspect": "inspicér"
        }
      },
      "cardGallery": {
        "description": "Et responsivt galleri af entitetskort med status og hurtige handlinger.",
        "emptyTitle": "Intet at vise",
        "emptyBody": "Elementer vises her som kort."
      },
      "groupedSummaryTable": {
        "description": "Grupperede rækker med aggregatkolonner, foldbare detaljer og totaler.",
        "emptyTitle": "Ingen opsummeringsdata",
        "emptyBody": "Grupperede totaler vises her, når der er data.",
        "groupLabel": "Gruppe",
        "totalsLabel": "I alt"
      },
      "schemaTree": {
        "description": "En udforsker til skemaer, tabeller og kolonner med type- og nøglemærkater.",
        "emptyTitle": "Intet skema indlæst",
        "emptyBody": "Forbind en database for at udforske dens skema her.",
        "treeLabel": "Skema",
        "viewLabel": "view"
      },
      "toggleMatrix": {
        "description": "Et interaktivt gitter af boolske kontakter til roller, politikker eller kanaler.",
        "emptyTitle": "Ingen matrix konfigureret",
        "emptyBody": "Rækker og kolonner vises her, når de er konfigureret.",
        "matrixLabel": "Tilladelsesmatrix",
        "rowHeaderLabel": "Tilladelse"
      },
      "sparklineTable": {
        "description": "Målingsrækker med mini-graf, aktuel værdi og en ændringsmarkering, der skelner godt fra skidt.",
        "emptyTitle": "Ingen målinger",
        "emptyBody": "Målinger vises her, når der er data at opsummere."
      },
      "topMoversList": {
        "description": "De målinger, der har ændret sig mest — retningen vurderes som god eller dårlig pr. måling.",
        "emptyTitle": "Ingen bevægelser",
        "emptyBody": "Målinger med de største ændringer vises her."
      },
      "rankedEntityList": {
        "description": "Topemner efter en måling, hver med placering og en proportional bjælke.",
        "emptyTitle": "Ingen rangering endnu",
        "emptyBody": "Topemner vises her, når der er data at rangere."
      },
      "accordionList": {
        "description": "Udfoldelige rækker med mærkat og detaljepanel, enkelt- eller flerudfoldning.",
        "emptyTitle": "Intet at folde ud",
        "emptyBody": "Poster vises her, når der er nogen."
      },
      "comparisonMatrix": {
        "description": "Et funktionsgitter, der sammenligner abonnementer, med én fremhævet kolonne.",
        "includedLabel": "Inkluderet",
        "notIncludedLabel": "Ikke inkluderet",
        "promotedLabel": "Anbefalet"
      },
      "chipCloud": {
        "description": "Ombrydende chips til fundne tabeller, flettevariabler eller forslag.",
        "emptyTitle": "Intet fundet endnu",
        "emptyBody": "Tabeller og variabler vises her som chips, når de er fundet.",
        "moreLabel": "+{n} mere"
      },
      "dataGrid": {
        "selectAllLabel": "Vælg alle rækker",
        "selectRowLabel": "Vælg række",
        "sortByLabel": "Sortér efter {column}",
        "description": "Standardgitteret til CRUD med sorterbare kolonner, rækkemarkering og typebevidste celler.",
        "rowActionsLabel": "Rækkehandlinger"
      },
      "paginationFooter": {
        "emptyLabel": "0 rækker",
        "ofLabel": "af",
        "pageSizeLabel": "Rækker",
        "a11y": {
          "pageSize": "Rækker pr. side"
        },
        "prevLabel": "Forrige side",
        "nextLabel": "Næste side",
        "description": "En bundlinje med det viste rækkeinterval, frem og tilbage mellem sider og et valg af sidestørrelse."
      },
      "bulkActionToolbar": {
        "selectedLabel": "valgt",
        "clearLabel": "Ryd markering",
        "toolbarLabel": "Massehandlinger",
        "description": "En markeringsbevidst værktøjslinje, der viser antal valgte og massehandlinger."
      },
      "miniTable": {
        "viewAllLabel": "Vis alle",
        "description": "En kompakt rækkeliste til dashboards med tilknyttede kolonner og et link til at se alle."
      },
      "revealLabel": "Vis værdi",
      "hideLabel": "Skjul værdi",
      "trueLabel": "sand",
      "falseLabel": "falsk",
      "detailKeyValue": {
        "description": "En posts felter som etiket/værdi-rækker med typebevidste værdier."
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
      },
      "boardCard": {
        "description": "Ét tavlekort: mærkat, titel, fremdrift, ejer og forfaldsdato.",
        "emptyTitle": "Intet kort",
        "emptyBody": "Der er endnu ingen post knyttet til dette kort."
      },
      "inlineComposeCard": {
        "description": "Hurtig tilføjelse, der opretter en post med kolonnens standardværdier.",
        "placeholder": "Kortets titel…",
        "addLabel": "Tilføj",
        "cancelLabel": "Annuller",
        "openLabel": "Tilføj kort"
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
        "typingLabel": "skriver…",
        "composerLabel": "Besked",
        "transcriptLabel": "Conversation"
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
        "configureCtaLabel": "Konfigurér en udbyder",
        "assistantLabel": "Assistent",
        "composerLabel": "Stil et spørgsmål",
        "transcriptLabel": "Assistant transcript"
      },
      "typingIndicator": {
        "description": "En avatar og en kursiv “skriver…”-række, bundet til en live-boolean pr. samtale.",
        "label": "skriver…",
        "emptyTitle": "Ingen skriveaktivitet",
        "emptyBody": "Skrivestatus vises her, når samtalen er aktiv."
      },
      "callWidget": {
        "description": "Et indgående tale- eller videoopkald: opkalderens avatar, opkaldets status og handlinger til at acceptere eller afvise.",
        "voiceLabel": "Taleopkald",
        "videoLabel": "Videoopkald",
        "ringingLabel": "Ringer…",
        "connectingLabel": "Opretter forbindelse…",
        "activeLabel": "I opkald",
        "endedLabel": "Opkald afsluttet",
        "acceptLabel": "Accepter",
        "declineLabel": "Afvis",
        "endLabel": "Afslut opkald",
        "emptyTitle": "Intet aktivt opkald",
        "emptyBody": "Et indgående opkald vises her."
      }
    },
    "geo": {
      "mapBubble": {
        "description": "Et kort med cirkelmarkører, hvis størrelse følger den valgte måling, sammen med en rangliste over de største steder.",
        "emptyTitle": "Ingen lokationer",
        "emptyBody": "Rækker med bredde- og længdegrad vises her som kortmarkører.",
        "mapUnavailableLabel": "Kortet kunne ikke indlæses. Ranglisten viser de samme data.",
        "regionsLabel": "Førende regioner",
        "metricLabel": "Måling"
      },
      "mapChoroplethGrid": {
        "description": "Regionsfelter tonet efter værdi – til tabeller med regionskoder, men uden koordinater.",
        "emptyTitle": "Ingen regioner",
        "emptyBody": "Rækker med en regionskode og en talværdi vises her som tonede felter.",
        "legendLowLabel": "Lav",
        "legendHighLabel": "Høj",
        "chartLabel": "Regional fordeling"
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
      },
      "documentCanvas": {
        "description": "Et dokumentlærred i papirstil — faktura, rapport eller e-mail — hvis blokke kan vælges, omarrangeres og fjernes.",
        "emptyTitle": "Intet i dette dokument",
        "emptyBody": "Tilføj en blok fra paletten for at begynde at bygge dokumentet.",
        "addBlockLabel": "Tilføj blok",
        "removeBlockLabel": "Fjern blok",
        "moveUpLabel": "Flyt blok op",
        "moveDownLabel": "Flyt blok ned",
        "blockListLabel": "Dokumentblokke",
        "billedToLabel": "Faktureret til",
        "issuedLabel": "Udstedt",
        "dueLabel": "Forfalder",
        "noDocumentTitle": "Intet dokument endnu",
        "noDocumentBody": "Vælg en startskabelon, eller tilføj en blok for at komme i gang."
      },
      "blockTotalsSummary": {
        "description": "Dokumentets totaler — subtotal, rabat, moms og det samlede skyldige beløb, genberegnet ud fra linjerne.",
        "emptyTitle": "Ingen totaler endnu",
        "emptyBody": "Totaler vises, når dokumentet har linjer.",
        "subtotalLabel": "Subtotal",
        "discountLabel": "Rabat",
        "taxLabel": "Moms",
        "totalLabel": "I alt at betale"
      },
      "blockLineItems": {
        "description": "Redigerbare linjer med beskrivelse, antal og sats, der indgår i dokumentets totaler.",
        "emptyTitle": "Ingen linjer",
        "emptyBody": "Tilføj en linje for at fakturere arbejde på dette dokument.",
        "descHeader": "Beskrivelse",
        "qtyHeader": "Antal",
        "rateHeader": "Sats",
        "amountHeader": "Beløb"
      },
      "blockKpiRow": {
        "description": "En række nøgletalsfliser, hvor ændringen farves efter fortegn.",
        "emptyTitle": "Ingen nøgletal",
        "emptyBody": "Nøgletal vises her, når rapporten har tal at vise."
      },
      "blockBarChart": {
        "description": "Et mini-søjlediagram i dokumentets farve, tilpasset en dokumentblok.",
        "emptyTitle": "Ingen data til diagrammet",
        "emptyBody": "Søjlerne vises, når rapporten har en dataserie.",
        "a11yLabel": "Søjlediagram"
      },
      "blockLineChart": {
        "description": "Et mini-kurvediagram med valgfrit udfyldt areal, tilpasset en dokumentblok.",
        "emptyTitle": "Ingen data til diagrammet",
        "emptyBody": "Kurven vises, når rapporten har en dataserie.",
        "a11yLabel": "Kurvediagram"
      },
      "blockTwoColTable": {
        "description": "En tokolonnetabel med en formateret overskriftsrække og en værdikolonne med fast bredde.",
        "emptyTitle": "Ingen rækker",
        "emptyBody": "Rækker vises her, når rapporten har værdier at vise."
      },
      "blockTaxBreakdown": {
        "description": "Momslinjer med tekst, sats og beløb, anvendt på dokumentets subtotal.",
        "emptyTitle": "Ingen momslinjer",
        "emptyBody": "Momslinjer vises, når dokumentet har satser at anvende."
      },
      "blockMultiCurrency": {
        "description": "Dokumentets total omregnet pr. valuta til de angivne kurser.",
        "emptyTitle": "Ingen omregninger",
        "emptyBody": "Omregninger vises, når dokumentet angiver valutakurser.",
        "footnote": "Kurserne er vejledende og kan afvige ved afregning."
      },
      "blockPaymentHistory": {
        "description": "Tidligere betalinger med dato, maskeret betalingsmetode, beløb og statusmærkat.",
        "emptyTitle": "Ingen betalinger endnu",
        "emptyBody": "Betalinger på dette dokument vises her."
      },
      "blockDiscountCodes": {
        "description": "Anvendte rabatkoder med tekst og krediteret beløb.",
        "emptyTitle": "Ingen rabatter anvendt",
        "emptyBody": "Rabatkoder anvendt på dette dokument vises her."
      },
      "blockLoyaltyBanner": {
        "description": "Et loyalitetsbanner med pointsaldo, niveau og point optjent på denne ordre.",
        "emptyTitle": "Ingen pointsaldo",
        "emptyBody": "Loyalitetsbanneret vises, når kunden har en pointsaldo.",
        "balanceLabel": "{balance} point · {tier}",
        "earnedLabel": "+{earned} optjent på denne ordre"
      },
      "blockRecurringBanner": {
        "description": "Et banner med faktureringsfrekvensen, næste opkrævningsdato og de resterende cyklusser.",
        "emptyTitle": "Ikke tilbagevendende",
        "emptyBody": "Dette banner vises, når dokumentet faktureres efter en fast plan.",
        "template": "Tilbagevendende — {freq} · Næste den {next} · {count} cyklusser"
      },
      "blockQrPay": {
        "description": "En scan-og-betal-flise med billedtekst og skyldigt beløb.",
        "emptyTitle": "Intet at betale",
        "emptyBody": "Betalingskoden vises, når dokumentet har et skyldigt beløb.",
        "amountLabel": "Skyldigt beløb"
      },
      "blockDeliveryStepper": {
        "description": "Vandrette leveringstrin markeret som fuldført, aktuelt eller kommende.",
        "emptyTitle": "Ingen leveringstrin",
        "emptyBody": "Trin vises, når ordren har en leveringsrute."
      },
      "blockSignature": {
        "description": "Underskriftslinjer til navn og titel, med underskriftsdato.",
        "emptyTitle": "Ingen underskrift",
        "emptyBody": "Underskriftslinjerne vises, når dokumentet angiver en underskriver.",
        "namePlaceholder": "Fulde navn",
        "titlePlaceholder": "Titel",
        "dateLabel": "Dato",
        "nameInputLabel": "Underskrivers navn"
      },
      "blockTermsCheckbox": {
        "description": "En vilkårsafkrydsning med redigerbar tekst.",
        "defaultLabel": "Jeg accepterer vilkår og betingelser"
      },
      "blockApproval": {
        "description": "Et godkenderkort med statusfarvet mærkat og valgfrie handlinger til at godkende eller afvise.",
        "emptyTitle": "Ingen godkender",
        "emptyBody": "Godkendelseskortet vises, når dokumentet angiver en godkender.",
        "approveLabel": "Godkend",
        "rejectLabel": "Afvis",
        "pendingLabel": "Afventer",
        "approvedLabel": "Godkendt",
        "rejectedLabel": "Afvist"
      },
      "blockAttachments": {
        "description": "Vedhæftede filer med navn og størrelse.",
        "emptyTitle": "Ingen vedhæftede filer",
        "emptyBody": "Filer vedhæftet dette dokument vises her."
      },
      "blockLateFees": {
        "description": "En advarselsboks med rykkergebyret og fristen.",
        "emptyTitle": "Intet rykkergebyr",
        "emptyBody": "Denne boks vises, når dokumentet fastsætter et rykkergebyr.",
        "template": "Et rykkergebyr på {rate} pålægges efter {days} dage."
      },
      "blockImagePlaceholder": {
        "description": "En stiplet pladsholderboks i stedet for et billede, med billedtekst.",
        "emptyTitle": "Intet billede",
        "emptyBody": "Pladsholderen vises, når blokken har en billedtekst."
      },
      "blockContact": {
        "description": "Kontaktlinjer med navn, e-mailadresse og telefonnummer.",
        "emptyTitle": "Ingen kontakt",
        "emptyBody": "Kontaktoplysninger vises, når dokumentet angiver en kontakt."
      },
      "blockHighlightBox": {
        "description": "En fremhævningsboks, der parrer en tekst med en stor værdi med fast bredde.",
        "emptyTitle": "Intet at fremhæve",
        "emptyBody": "Boksen vises, når blokken har en værdi at vise."
      },
      "starterTemplatePicker": {
        "description": "Et gitter af foruddefinerede skabeloner med genererede miniaturer; vælger du en, oprettes et helt dokument.",
        "emptyTitle": "Ingen skabeloner",
        "emptyBody": "Definer skabeloner i konfigurationen, eller tilknyt en skabelontabel.",
        "blankLabel": "Tom",
        "kicker": {
          "invoice": "Faktura",
          "report": "Rapport",
          "email": "E-mail"
        }
      },
      "sloMonitorCard": {
        "description": "SLA-kort pr. tjeneste med status, tilgængelighed op mod målet, daglig oppetidsstribe, fejlbudget og p95-latenstid.",
        "emptyTitle": "Ingen overvågning",
        "emptyBody": "Tilknyt en overvågningstabel med en status- og en tilgængelighedskolonne.",
        "targetLabel": "Mål",
        "budgetLabel": "Fejlbudget",
        "latencyLabel": "p95-latenstid",
        "status": {
          "operational": "Normal drift",
          "degraded": "Forringet",
          "down": "Nede",
          "unknown": "Ukendt"
        }
      },
      "uptimeSegmentBar": {
        "description": "Dagsstriber i statusside-stil, farvet efter daglig status, med skift mellem 30 og 90 dage.",
        "emptyTitle": "Ingen oppetidshistorik",
        "emptyBody": "Daglige statusrækker vises her som en oppetidsstribe.",
        "daysAgoLabel": "For {days} dage siden",
        "todayLabel": "I dag",
        "uptimeLabel": "oppetid",
        "period30Label": "30 d",
        "period90Label": "90 d",
        "status": {
          "operational": "Normal drift",
          "degraded": "Forringet",
          "down": "Nede",
          "unknown": "Ingen data"
        }
      },
      "experimentVariantCompare": {
        "description": "Konverteringsbjælker pr. variant med løft i forhold til kontrollen og en signifikansmåler.",
        "emptyTitle": "Ingen varianter",
        "emptyBody": "Tilknyt en tabel med eksperimentvarianter og konverteringstal.",
        "controlLabel": "KONTROL",
        "winnerLabel": "VINDER",
        "significanceLabel": "Konfidens",
        "verdictSignificantLabel": "Statistisk signifikant — trygt at konkludere.",
        "verdictInconclusiveLabel": "Endnu ikke signifikant — lad testen køre videre.",
        "countsLabel": "{users} deltagere · {conversions} konverteringer"
      },
      "creditCardTile": {
        "description": "En gemt betalingsmetode som et brandet kort med maskeret nummer, indehaver og udløb.",
        "emptyTitle": "Ingen betalingsmetode",
        "emptyBody": "Tilføj et kort for at se det her.",
        "defaultLabel": "Standard",
        "setDefaultLabel": "Gør til standard",
        "manageLabel": "Administrér",
        "addLabel": "Tilføj betalingsmetode",
        "expiresLabel": "Udløber"
      },
      "planPricingCards": {
        "description": "Prisniveauer med skift mellem månedlig og årlig, funktionslister og et fremhævet abonnement.",
        "emptyTitle": "Ingen abonnementer",
        "emptyBody": "Tilknyt en abonnementstabel med navn og månedlig pris.",
        "monthlyLabel": "Månedlig",
        "annualLabel": "Årlig",
        "popularLabel": "POPULÆR",
        "perMonthLabel": "/ md.",
        "billedAnnuallyLabel": "Faktureres med {total} årligt",
        "currentLabel": "Nuværende abonnement",
        "ctaLabel": "Vælg abonnement"
      },
      "apiKeysPanel": {
        "description": "API-nøgler med miljømærker, maskerede værdier, tilladelser, seneste brug samt handlinger til at kopiere, forny og tilbagekalde.",
        "emptyTitle": "Ingen API-nøgler",
        "emptyBody": "Opret en nøgle for at begynde at kalde API'et.",
        "revealedTitle": "Nøgle oprettet",
        "revealedBody": "Kopiér den nu — den vises aldrig igen.",
        "copyLabel": "Kopiér",
        "copiedLabel": "Kopieret",
        "revealLabel": "Vis nøgle",
        "hideLabel": "Skjul nøgle",
        "rollLabel": "Udskift nøgle",
        "revokeLabel": "Tilbagekald nøgle",
        "neverUsedLabel": "Aldrig brugt",
        "lastUsedLabel": "Sidst brugt {since}"
      },
      "apiPlayground": {
        "description": "En anmodningsbygger med parametre og et svarpanel. Den sammensætter kun og sender aldrig en rigtig anmodning.",
        "emptyTitle": "Intet endepunkt valgt",
        "emptyBody": "Vælg et endepunkt for at sammensætte en anmodning mod det.",
        "sendLabel": "Send",
        "requestLabel": "Forespørgsel",
        "responseLabel": "Svar",
        "paramsLabel": "Parametre",
        "responsePlaceholder": "Send forespørgslen for at se svaret."
      },
      "codeSnippetBlock": {
        "description": "Et kodeuddrag, der kan kopieres, med et sprogmærke og valgfrie faner pr. sprog.",
        "emptyTitle": "Intet uddrag",
        "emptyBody": "Tilknyt en kodekolonne, eller angiv et statisk uddrag i konfigurationen.",
        "copyLabel": "Kopiér",
        "copiedLabel": "Kopieret"
      },
      "webhookEndpointsList": {
        "description": "Webhook-endepunkter med hændelse, mål-URL, seneste udløsning og en aktiveringskontakt.",
        "emptyTitle": "Ingen endepunkter",
        "emptyBody": "Tilføj et webhook-endepunkt for at modtage tabelhændelser.",
        "neverFiredLabel": "Aldrig udløst",
        "lastFiredLabel": "Sidst udløst {since}"
      },
      "resourceApiCard": {
        "description": "En tabels genererede API-flade: antal rækker, sikkerhedsmærke, metodemærker og anmodningsvolumen.",
        "emptyTitle": "Ingen ressource",
        "emptyBody": "Tilknyt en tabel for at vise dens genererede API-flade.",
        "rlsLabel": "RLS",
        "publicLabel": "Offentlig",
        "rowsLabel": "rækker",
        "perDayLabel": "{count}/dag"
      },
      "liveTimer": {
        "description": "Et stopur med start og stop til en opgave; når du stopper det, oprettes en tidsregistrering.",
        "emptyTitle": "Intet stopur",
        "emptyBody": "Tilknyt en tidsregistreringsrække med en opgave og en varighedskolonne.",
        "startLabel": "Start",
        "stopLabel": "Stop",
        "taskPlaceholder": "Opgave uden titel"
      },
      "syncStatusCard": {
        "description": "Forbindelsens identitet, latenstid, synkroniserede rækker og synkroniseringsplan med en handling til at synkronisere nu.",
        "emptyTitle": "Ingen forbindelse",
        "emptyBody": "Tilknyt en forbindelsesrække for at vise dens synkroniseringsstatus.",
        "connectedLabel": "Forbundet",
        "disconnectedLabel": "Afbrudt",
        "rowsSyncedLabel": "Synkroniserede rækker",
        "tablesLabel": "Tabeller",
        "lastSyncLabel": "Seneste synkronisering",
        "nextSyncLabel": "Næste synkronisering",
        "syncingLabel": "Synkroniserer…",
        "syncActionLabel": "Synkronisér nu"
      },
      "ipAllowlistCard": {
        "description": "Faste udgående IP-adresser, der skal tillades i en firewall, hver med en kopiknap.",
        "emptyTitle": "Ingen udgående IP-adresser",
        "emptyBody": "Udgående adresser vises her, når forbindelsen er klargjort.",
        "copyLabel": "Kopiér",
        "copiedLabel": "Kopieret"
      },
      "onboardingChecklist": {
        "description": "Opsætningstrin med tidsestimater og handlinger over en løbende opdateret fremdriftsring og -bjælke.",
        "emptyTitle": "Intet at sætte op",
        "emptyBody": "Tilføj onboarding-trin i konfigurationen, eller tilknyt en trintabel.",
        "progressLabel": "{done} af {total} klaret",
        "celebrateTitle": "Alt er klaret"
      },
      "testimonialCard": {
        "description": "Et kundecitat med avatar og kildeangivelse.",
        "emptyTitle": "Ingen udtalelse",
        "emptyBody": "Tilknyt en citatrække for at vise en kundeudtalelse."
      },
      "trustBadges": {
        "description": "En række af compliance- og tillidsudsagn adskilt af prikker.",
        "emptyTitle": "Ingen mærker",
        "emptyBody": "Tilføj compliance-udsagn i konfigurationen, eller tilknyt en mærketabel."
      },
      "policyList": {
        "description": "Sikkerhedspolitikker på rækkeniveau pr. tabel med kommando, rolle og en aktiveringskontakt.",
        "emptyTitle": "Ingen politikker",
        "emptyBody": "Denne tabel har endnu ingen sikkerhedspolitikker på rækkeniveau."
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
        "emptyBody": "Referencebilleder vises på denne tavle.",
        "placeholder": "Slip reference"
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
        "required": "Dette felt er påkrævet.",
        "titleLabel": "Opret post",
        "closeLabel": "Luk"
      },
      "drawerForm": {
        "description": "En sidepanel-formular til at oprette eller redigere poster med mange felter.",
        "trigger": "Ny",
        "submit": "Gem",
        "cancel": "Annuller",
        "titleLabel": "Ny post",
        "closeLabel": "Luk"
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
      "ruleBuilder": {
        "description": "En betingelsesbygger, hvis regler bliver til et filter — segmenteditoren.",
        "add": "Tilføj betingelse",
        "remove": "Fjern betingelse",
        "all": "ALLE",
        "any": "MINDST ÉN",
        "field": "Felt",
        "operator": "Operator",
        "value": "Værdi",
        "valuePlaceholder": "Værdi…",
        "emptyBody": "Ingen betingelser endnu — tilføj en for at definere dette segment.",
        "op": {
          "eq": "er",
          "neq": "er ikke",
          "gt": "er større end",
          "gte": "er mindst",
          "lt": "er mindre end",
          "lte": "er højst",
          "contains": "indeholder",
          "not-contains": "indeholder ikke",
          "starts-with": "begynder med",
          "in": "er en af",
          "before": "er før",
          "after": "er efter",
          "is-null": "er tom",
          "is-not-null": "er ikke tom"
        }
      },
      "flowBuilder": {
        "description": "Et lodret workflow-lærred af trigger-, betingelses- og handlingstrin.",
        "add": "Tilføj trin",
        "remove": "Fjern trin",
        "paletteTitle": "Tilføj et trin",
        "stats": "{runs} kørsler · {rate} % succes",
        "emptyBody": "Ingen trin endnu — tilføj en trigger for at starte dette workflow."
      },
      "connectionStringField": {
        "description": "Et forbindelsesstreng-felt, der genkender databasemotoren, mens du skriver.",
        "label": "Forbindelsesstreng",
        "helper": "postgres://bruger:adgangskode@vært:5432/database — mysql:// og sqlite: virker også.",
        "quickFill": "Hurtig udfyldning:",
        "host": "Vært: {host}",
        "invalidScheme": "Ukendt skema i forbindelsesstrengen.",
        "incomplete": "Tilføj vært og database til forbindelsesstrengen."
      },
      "tableInclusionChecklist": {
        "description": "Tabellerne der skal medtages, med rækketal og advarsler om personoplysninger.",
        "pii": "Personoplysninger",
        "highVolume": "stor mængde",
        "a11yLabel": "Tabeller der medtages",
        "emptyTitle": "Ingen tabeller fundet",
        "emptyBody": "Forbind en database, så vises dens tabeller her."
      },
      "columnMappingTable": {
        "description": "Knytter kolonnerne i en uploadet fil til felterne i en tabel.",
        "skip": "Importér ikke",
        "sourceHeader": "Kildekolonne",
        "sampleHeader": "Eksempel",
        "targetHeader": "Målfelt",
        "emptyTitle": "Ingen kolonner at knytte",
        "emptyBody": "Upload en fil, så vises dens kolonner her."
      },
      "validationIssuesList": {
        "description": "Import- og valideringsproblemer, de alvorligste først, med antal berørte rækker.",
        "emptyTitle": "Ingen problemer fundet",
        "emptyBody": "Alt ser godt ud — du kan importere."
      },
      "exportBuilder": {
        "description": "Opbygger en dataeksport: format, datointerval og indhold.",
        "format": "Format",
        "from": "Fra",
        "to": "Til",
        "groupBy": "Gruppér efter",
        "includeCharts": "Medtag diagrammer",
        "email": "Send eksporten til mig på e-mail",
        "submit": "Eksportér",
        "running": "Forbereder din eksport…",
        "done": "Eksporten er klar",
        "failed": "Eksporten mislykkedes. Prøv igen.",
        "download": "Download"
      },
      "questionBuilder": {
        "description": "En spørgeskemaeditor: tilføj spørgsmålstyper og ombyt rækkefølgen.",
        "paletteTitle": "Tilføj et spørgsmål",
        "add": "Tilføj spørgsmål",
        "remove": "Fjern spørgsmål",
        "moveUp": "Flyt op",
        "moveDown": "Flyt ned",
        "required": "Påkrævet",
        "questionPlaceholder": "Stil et spørgsmål…",
        "emptyTitle": "Ingen spørgsmål endnu",
        "emptyBody": "Vælg en spørgsmålstype for at begynde på dit spørgeskema.",
        "questionLabel": "Spørgsmål",
        "dropdownPlaceholder": "Vælg…",
        "kind": {
          "single-choice": "Enkeltvalg",
          "multi-choice": "Flervalg",
          "dropdown": "Rullemenu",
          "short-text": "Kort tekst",
          "long-text": "Lang tekst",
          "rating": "Stjernebedømmelse",
          "nps": "NPS 0–10",
          "date": "Dato"
        }
      },
      "inlineEditableField": {
        "description": "En værdi, der redigeres med et klik inde i et dokument eller lærred.",
        "edit": "Rediger",
        "save": "Gem",
        "cancel": "Annullér",
        "empty": "Tom",
        "valueLabel": "Værdi"
      },
      "passwordStrengthMeter": {
        "description": "En firedelt måler for adgangskodens styrke.",
        "label": "Adgangskodens styrke",
        "weak": "Svag",
        "fair": "Middel",
        "good": "God",
        "strong": "Stærk"
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
        "emptyTitle": "Ingen resultater for “{query}”",
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
        "emptyBody": "Prøv et andet søgeord.",
        "searchLabel": "Søg",
        "facetRailLabel": "Filtrér efter type"
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
        "emptyTitle": "Ingen genveje registreret.",
        "generalGroupLabel": "Generelt",
        "navigationGroupLabel": "Navigation",
        "recordsGroupLabel": "Poster",
        "openCommandPaletteLabel": "Åbn kommandopaletten",
        "searchLabel": "Søg",
        "showShortcutsLabel": "Vis genveje",
        "goToDashboardLabel": "Gå til dashboard",
        "goToOrdersLabel": "Gå til ordrer",
        "newRecordLabel": "Ny post",
        "saveLabel": "Gem",
        "undoLabel": "Fortryd"
      },
      "avatarStack": {
        "description": "Overlappende avatarer med “+N”-overløb og valgfri tilstedeværelse.",
        "online": "{count} online",
        "a11yLabel": "Personer"
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
      },
      "widgetMissing": {
        "description": "Reservekortet, der vises, når en gemt side henviser til en widget, som ikke er installeret.",
        "title": "Widget ikke tilgængelig",
        "bodyLead": "Ingen widget er registreret som",
        "bodyTail": "Den hører måske til en nyere version eller en afinstalleret udvidelse."
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
    },
    "draggableRole": "widget, der kan trækkes"
  },
  "templates": {
    "crud": {
      "newRow": "Ny række",
      "exportAction": "Eksportér",
      "searchPlaceholder": "Søg i {table}…",
      "removeFilter": "Fjern filteret for {column}",
      "queryFailed": "Forespørgslen mislykkedes",
      "loadingRows": "Indlæser rækker",
      "noMatchesTitle": "Ingen matchende rækker",
      "emptyTitle": "{count, plural, one {Ingen {entity} endnu} other {Ingen {entity} endnu}}",
      "createTitle": "Tilføj {entity}",
      "createSubtitle": "Opretter én række i {table}.",
      "createSubmit": "Tilføj {entity}",
      "createSuccessTitle": "{name} tilføjet",
      "createSuccessBody": "Du kan fortryde dette fra notifikationen.",
      "editTitle": "Rediger {entity}",
      "saveSubmit": "Gem ændringer",
      "deleteTitle": "Slet {entity}",
      "deletePreflight": "Tjekker referencer…",
      "deleteNoReferences": "Denne række har ingen indgående referencer.",
      "deleteConsequencesIntro": "Sletning af denne række påvirker også:",
      "referenceRows": "{count, plural, one {{n} række} other {{n} rækker}}",
      "confirmPrompt": "Skriv {value} for at bekræfte",
      "bulkDeleteTitle": "{count, plural, one {Slet {n} række} other {Slet {n} rækker}}",
      "bulkDeleteBody": "Referencekonsekvenserne gælder for hver eneste valgt række.",
      "bulkDeleteConfirm": "Slet rækker",
      "uniqueHelper": "Skal være unik i {table}.",
      "uniqueHelperCounted": "{count, plural, one {Kontrolleret mod {n} række.} other {Kontrolleret mod {n} rækker.}}",
      "toast": {
        "created": "{entity} oprettet.",
        "createFailed": "Oprettelsen mislykkedes.",
        "saved": "Ændringerne er gemt.",
        "updateFailed": "Opdateringen mislykkedes.",
        "deleted": "{name} slettet.",
        "deleteFailed": "Sletningen mislykkedes.",
        "bulkDeleted": "{count, plural, one {{n} række slettet.} other {{n} rækker slettet.}}",
        "bulkDeleteFailed": "Massesletningen mislykkedes.",
        "exportIncomplete": "Eksporterede {written, number} af {selected, number} valgte rækker — genindlæs, og prøv igen.",
        "undone": "Ændring fortrudt.",
        "undoFailed": "Fortrydelsen mislykkedes."
      },
      "detail": {
        "fields": "Felter",
        "inboundReferences": "indgående referencer",
        "relatedCount": "{count, plural, one {{n} relateret post i {table}} other {{n} relaterede poster i {table}}}",
        "loadError": "Posten kunne ikke indlæses."
      },
      "peekAction": "Forhåndsvisning",
      "openPage": "Åbn side"
    },
    "queue": {
      "allSegment": "Alle",
      "daysUnit": "{count, plural, one {{count} dag} other {{count} dage}}",
      "approvedToast": "{count} godkendt.",
      "rejectedToast": "{count} afvist.",
      "undoneToast": "Beslutningen er fortrudt.",
      "undoFailedToast": "Denne beslutning kunne ikke fortrydes.",
      "failedToast": "Beslutningen mislykkedes.",
      "invalidConfig": "Denne køs gemte konfiguration er ugyldig. Generér siden igen for at gendanne den.",
      "queueLabel": "Kø",
      "statusFilterLabel": "Statusfilter",
      "errorTitle": "Denne kø kunne ikke indlæses",
      "loading": "Indlæser kø",
      "emptyTitle": "Intet i køen",
      "emptyBody": "Nye anmodninger vises her, efterhånden som de kommer ind.",
      "caughtUpTitle": "Du er helt ajour",
      "caughtUpBody": "Ingen anmodninger i denne fane lige nu.",
      "selectItem": "Vælg {title}",
      "selectPrompt": "Vælg en anmodning",
      "selectBody": "Vælg et element for at gennemgå dets detaljer.",
      "rejectTitle": "Afvis anmodninger",
      "rejectCount": "Valgt · {count}",
      "rejectPlaceholder": "Tilføj en note til anmoderen…",
      "rejectReasonLabel": "Årsag til afvisning",
      "rejectNote": "Anmoderen får besked sammen med din note."
    },
    "dashboard": {
      "invalidLayout": "Dette dashboards gemte layout er ugyldigt. Generér siden igen, eller nulstil dens layout."
    },
    "builder": {
      "publish": "Udgiv",
      "paletteTitle": "Blokke",
      "inspectorTitle": "Inspektør",
      "startFromTemplate": "Start ud fra en skabelon",
      "untitledDoc": "Dokument uden titel",
      "invalidConfig": "Denne byggersides gemte konfiguration er ugyldig. Generér siden igen, eller nulstil den.",
      "starterPicker": {
        "subtitle": "Dit valg erstatter den nuværende kladde."
      },
      "inspector": {
        "titleLabel": "Titel",
        "numberLabel": "Nummer",
        "currencyLabel": "Valuta",
        "taxRateLabel": "Momssats %",
        "modulesLabel": "Moduler"
      },
      "summary": {
        "questions": "Spørgsmål",
        "estLength": "Anslået længde",
        "estMinutes": "~{minutes} min",
        "steps": "Trin",
        "triggers": "Udløsere",
        "conditions": "Betingelser",
        "actions": "Handlinger",
        "triggerLocked": "Udløsertrinnet kan ikke fjernes."
      },
      "publishModal": {
        "confirmTitle": "Udgiv spørgeskema?",
        "confirmSubtitle": "Gennemgå det, før det går live.",
        "confirmCta": "Udgiv spørgeskema",
        "publishedTitle": "Spørgeskema udgivet",
        "publishedSubtitle": "Dit spørgeskema er live og samler svar ind lige nu."
      },
      "blocks": {
        "block-totals-summary": "Totaloversigt",
        "block-line-items": "Linjeposter",
        "block-kpi-row": "Nøgletalsrække",
        "block-bar-chart": "Søjlediagram",
        "block-line-chart": "Kurvediagram",
        "block-two-col-table": "Tokolonnetabel",
        "block-tax-breakdown": "Momsopdeling",
        "block-multi-currency": "Flere valutaer",
        "block-payment-history": "Betalingshistorik",
        "block-discount-codes": "Rabatkoder",
        "block-loyalty-banner": "Loyalitetspoint",
        "block-recurring-banner": "Tilbagevendende",
        "block-qr-pay": "Betalings-QR",
        "block-delivery-stepper": "Leveringstidslinje",
        "block-signature": "Underskrift",
        "block-terms-checkbox": "Vilkår",
        "block-approval": "Godkendelse",
        "block-attachments": "Vedhæftede filer",
        "block-late-fees": "Rykkergebyrer",
        "block-image-placeholder": "Billede",
        "block-contact": "Kontakt",
        "block-highlight-box": "Fremhævningsboks"
      },
      "starters": {
        "titles": {
          "st-standard": "Standardfaktura",
          "st-recurring": "Løbende abonnement",
          "st-deposit": "Anmodning om depositum",
          "st-credit-note": "Kreditnota",
          "st-late-reminder": "Rykker for manglende betaling",
          "st-quote": "Tilbud / overslag",
          "st-proforma": "Proforma",
          "st-receipt": "Betalingskvittering",
          "st-retainer": "Fast honorar",
          "st-usage": "Forbrugsbaseret faktura",
          "st-milestone": "Projektmilepæl",
          "st-donation": "Donationskvittering (skattenummer)",
          "st-monthly": "Månedsoversigt",
          "st-quarterly": "Kvartalsgennemgang",
          "st-usage-report": "Forbrugsoversigt",
          "st-exec": "Ledelsesresumé på én side",
          "st-welcome": "Velkomstmail",
          "st-receipt-email": "Fakturakvittering",
          "st-digest": "Ugentligt sammendrag",
          "st-dunning": "Betalingspåmindelse"
        },
        "categories": {
          "billing": "Fakturering",
          "sales": "Salg",
          "nonProfit": "Nonprofit",
          "reports": "Rapporter",
          "lifecycle": "Livscyklus",
          "transactional": "Transaktionel",
          "marketing": "Marketing"
        }
      }
    },
    "common": {
      "clearFilters": "Ryd filtre",
      "noMatchesBody": "Prøv en anden søgning, eller fjern et filter.",
      "detailLabel": "Detaljer",
      "loadingRecord": "Indlæser post",
      "connectionPaused": "Denne forbindelse er sat på pause"
    },
    "directory": {
      "invalidConfig": "Dette kartoteks gemte konfiguration er ugyldig. Generér siden igen for at gendanne den.",
      "searchPlaceholder": "Søg efter personer…",
      "memberCount": "{count, plural, one {{n} person} other {{n} personer}}",
      "errorTitle": "Dette kartotek kunne ikke indlæses",
      "loading": "Indlæser personer",
      "emptyTitle": "Ingen personer endnu",
      "emptyBody": "Personer vises her, efterhånden som rækker lander i tabellen.",
      "noMatchesTitle": "Ingen matchende personer",
      "detailTitle": "Person"
    },
    "masterDetail": {
      "invalidConfig": "Denne sides gemte konfiguration er ugyldig. Generér siden igen for at gendanne den.",
      "railTitle": "Poster",
      "errorTitle": "Denne liste kunne ikke indlæses",
      "loading": "Indlæser poster",
      "emptyBody": "Poster vises her, efterhånden som rækker lander i tabellen.",
      "noMatchesTitle": "Ingen matchende poster",
      "noMatchesBody": "Prøv at fjerne et filter.",
      "selectPrompt": "Vælg en post",
      "selectBody": "Vælg et element på listen for at se dets detaljer."
    },
    "chat": {
      "invalidLayout": "Denne chatsides gemte layout er ugyldigt. Generér siden igen, eller nulstil dens layout.",
      "noInboxTitle": "Ingen indbakke på denne side",
      "noInboxBody": "Generér siden igen.",
      "conversationsFailed": "Forespørgslen på samtaler mislykkedes",
      "messagesFailed": "Forespørgslen på beskeder mislykkedes",
      "loadingConversations": "Indlæser samtaler",
      "loadingMessages": "Indlæser beskeder",
      "selectTitle": "Vælg en samtale",
      "selectBody": "Vælg en samtale i indbakken for at læse dens beskeder."
    },
    "files": {
      "allFiles": "Alle filer",
      "recent": "Seneste",
      "starred": "Stjernemarkerede",
      "invalidLayout": "Denne filsides gemte layout er ugyldigt. Generér siden igen, eller nulstil dens layout.",
      "missingSlotTitle": "Ingen filbrowser på denne side",
      "missingSlotBody": "Det gemte layout har ingen browserplads. Generér siden igen.",
      "loadFailed": "Forespørgslen på filer mislykkedes",
      "loading": "Indlæser filer",
      "uploadsUnavailable": "Upload er endnu ikke tilgængelig på denne side.",
      "previewTitle": "Fil",
      "kindLabel": "Type",
      "linkLabel": "Link"
    },
    "logViewer": {
      "invalidLayout": "Denne logsides gemte layout er ugyldigt. Generér siden igen, eller nulstil dens layout.",
      "levelFilterLabel": "Filter for logniveau",
      "timeFilterLabel": "Filter for tidsvindue",
      "window": {
        "1h": "1 t",
        "24h": "24 t",
        "7d": "7 d"
      },
      "heldCount": "+{count}",
      "missingSlotTitle": "Ingen log-widget på denne side",
      "missingSlotBody": "Det gemte layout har ingen logplads. Generér siden igen.",
      "loadFailed": "Logforespørgslen mislykkedes",
      "loading": "Indlæser logposter",
      "traceTitle": "Sporing",
      "latestTitle": "Seneste aktivitet",
      "backToLatest": "Tilbage til seneste",
      "eventFallback": "Hændelse"
    },
    "calendar": {
      "eventCount": "{count, plural, one {{n} begivenhed} other {{n} begivenheder}}",
      "composePlaceholder": "Titel på begivenhed…",
      "addEvent": "Tilføj begivenhed",
      "dateRange": "Datointerval",
      "agendaTitle": "Dagsorden",
      "categoriesTitle": "Kategorier",
      "upcomingTitle": "Kommende",
      "invalidLayout": "Denne kalenders gemte layout er ugyldigt. Generér siden igen, eller nulstil dens layout."
    },
    "scheduler": {
      "previousWeek": "Forrige uge",
      "nextWeek": "Næste uge",
      "week": "Uge",
      "month": "Måned",
      "invalidLayout": "Denne plans gemte layout er ugyldigt. Generér siden igen, eller nulstil dens layout.",
      "shiftCount": "{count, plural, one {{n} vagt} other {{n} vagter}}",
      "addShift": "Tilføj vagt"
    },
    "settings": {
      "title": "Notifikationsindstillinger",
      "subtitle": "Vælg, hvad du får besked om, og hvordan",
      "matrixLabel": "Giv mig besked om",
      "rowHeader": "Hændelse",
      "saved": "Gemt",
      "unavailableTag": "Ikke tilgængelig endnu",
      "loading": "Indlæser præferencer",
      "errorTitle": "Disse indstillinger kunne ikke indlæses",
      "emptyTitle": "Intet at konfigurere endnu",
      "emptyBody": "Notifikationshændelser vises her, efterhånden som producenterne udgives."
    },
    "pageCrud": {
      "description": "Den kanoniske tabelside: søgbart datagitter, opret/rediger-formularer, sikre sletninger med referencetjek og ændringer, der kan fortrydes."
    },
    "pageDashboard": {
      "description": "Et widget-dashboard over dine data: nøgletalskort, diagrammer og lister på et redigerbart gitter."
    },
    "pageBoard": {
      "description": "En kanban-tavle grupperet efter et statusfelt — træk kort mellem kolonner for at opdatere poster."
    },
    "pageCalendar": {
      "description": "En månedskalender med dagsorden, kategorifiltre og hurtig oprettelse af begivenheder ud fra et datofelt."
    },
    "pageScheduler": {
      "description": "Et vagtgitter med uge mod ressource, kapacitetsopfølgning og dækningstotaler."
    },
    "pageDirectory": {
      "description": "Et personkartotek med søgning, gruppefiltre og et profilsidepanel."
    },
    "pageMasterDetail": {
      "description": "Et layout med liste ved siden af detaljer: vælg en post til venstre, og arbejd med den til højre."
    },
    "pageQueueInbox": {
      "description": "En gennemgangskø med godkend/afvis-beslutninger, massehandlinger og fortrydelse."
    },
    "pageLogViewer": {
      "description": "En logtabel med live-visning, filtre for niveau og tid samt et sidepanel til sporing."
    },
    "pageFiles": {
      "description": "En filbrowser med smarte mapper, upload og et sidepanel til forhåndsvisning."
    },
    "pageChat": {
      "description": "En samtaleindbakke ved siden af en beskedtråd, bundet til dine beskedtabeller."
    },
    "pageBuilder": {
      "description": "En træk-og-slip-dokumentbygger med blokpalet, inspektør og udgivelsesflow."
    },
    "pageWizard": {
      "description": "Et guidet flow i flere trin, der fører brugerne gennem en struktureret proces."
    },
    "pageSettings": {
      "description": "En matrix over notifikationspræferencer med kontakter pr. kanal og automatisk lagring."
    },
    "record": {
      "relatedEmptyTitle": "Ingen relaterede poster",
      "loadError": "Posten kunne ikke indlæses.",
      "loadingActivity": "Indlæser aktivitet",
      "activityTab": "Aktivitet",
      "activityEmptyTitle": "Ingen aktivitet registreret",
      "activityEmptyBody": "Ændringer foretaget gennem Adminium vises her.",
      "activityLoadOlder": "Indlæs ældre aktivitet",
      "activity": {
        "created": "{actor} oprettede denne post",
        "updated": "{actor} opdaterede denne post",
        "deleted": "{actor} slettede denne post",
        "undone": "{actor} fortrød en ændring",
        "changedFields": "{count, plural, one {{n} felt ændret} other {{n} felter ændret}}"
      }
    },
    "pageRecord": {
      "description": "En enkelt post som en hel side: dens felter, relaterede poster med løbende antal og dens ændringsaktivitet."
    }
  },
  "frame": {
    "noResult": "Intet resultat for widget",
    "emptyTitle": "Ingen data for perioden",
    "loadError": "Noget gik galt under indlæsningen af denne widget.",
    "renderError": "Denne widget kunne ikke vises.",
    "refreshing": "Opdaterer",
    "infoLabel": "Widget-info",
    "menuLabel": "Widget-menu"
  },
  "charts": {
    "livePillLabel": "Live",
    "forecast": {
      "nowLabel": "Nu",
      "forecastLabel": "Prognose",
      "actualLabel": "Faktisk"
    },
    "otherLabel": "Andet",
    "heat": {
      "lessLabel": "Mindre",
      "moreLabel": "Mere"
    },
    "choropleth": {
      "lowLabel": "Lav",
      "highLabel": "Høj"
    },
    "funnel": {
      "stepConversion": "{pct}% fortsætter",
      "overallConversion": "{pct}% samlet"
    }
  }
} as const;
