/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/ui.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "close": "Zavřít",
    "cancel": "Zrušit",
    "confirm": "Potvrdit",
    "save": "Uložit",
    "apply": "Použít",
    "delete": "Smazat",
    "edit": "Upravit",
    "copy": "Kopírovat",
    "copied": "Zkopírováno",
    "undo": "Vrátit zpět",
    "retry": "Zkusit znovu",
    "clear": "Vymazat",
    "selectAll": "Vybrat vše",
    "clearSelection": "Zrušit výběr",
    "showPassword": "Zobrazit heslo",
    "hidePassword": "Skrýt heslo",
    "reveal": "Odkrýt",
    "hide": "Skrýt"
  },
  "state": {
    "loading": "Načítání…",
    "empty": "Zatím tu nic není",
    "noResults": "Žádné výsledky",
    "optional": "Volitelné",
    "required": "Povinné",
    "error": "Něco se pokazilo"
  },
  "pagination": {
    "previous": "Předchozí",
    "next": "Další",
    "pageOf": "Strana {page, number} z {pages, number}",
    "rowsPerPage": "Řádků na stránku",
    "range": "{from, number}–{to, number} z {total, number}"
  },
  "table": {
    "sortAscending": "Seřadit vzestupně",
    "sortDescending": "Seřadit sestupně",
    "rowActions": "Akce řádku",
    "selectRow": "Vybrat řádek",
    "selectAllRows": "Vybrat všechny řádky"
  },
  "dialog": {
    "close": "Zavřít dialog",
    "confirmTitle": "Opravdu?"
  },
  "combobox": {
    "placeholder": "Vyberte…",
    "search": "Hledat…",
    "noMatches": "Žádná shoda"
  },
  "toast": {
    "dismiss": "Zavřít oznámení"
  },
  "widgets": {
    "charts": {
      "boxplot": {
        "description": "Krabicový graf rozpětí číselného sloupce podle kategorie – minimum, kvartily, medián a maximum.",
        "emptyTitle": "Není co vykreslit",
        "emptyBody": "Filtrům neodpovídají žádné řádky pro krabicové grafy."
      },
      "violin": {
        "description": "Zrcadlené křivky hustoty porovnávající rozdělení číselného sloupce mezi skupinami.",
        "emptyTitle": "Není co vykreslit",
        "emptyBody": "Filtrům neodpovídají žádné řádky pro profily hustoty."
      },
      "ridgeline": {
        "description": "Překrývající se hřebeny hustoty porovnávající číselný sloupec napříč seřazenými skupinami.",
        "emptyTitle": "Není co vykreslit",
        "emptyBody": "Filtrům neodpovídají žádné řádky pro profily hustoty."
      },
      "scatterBubble": {
        "description": "Dva číselné sloupce jako body, s volitelnou velikostí bublin a trendovou čarou.",
        "emptyTitle": "Žádné body k vykreslení",
        "emptyBody": "Filtrům neodpovídají žádné řádky pro zvolené sloupce."
      },
      "hexbin": {
        "description": "Šestiúhelníková hustota dvou číselných sloupců, obarvená podle počtu řádků v dlaždici.",
        "emptyTitle": "Žádná hustota k vykreslení",
        "emptyBody": "Filtrům neodpovídají žádné řádky k seskupení."
      },
      "correlationMatrix": {
        "description": "Pearsonova korelace mezi zvolenými číselnými sloupci, od silně kladné po silně zápornou.",
        "emptyTitle": "Není co korelovat",
        "emptyBody": "Vyberte alespoň dva číselné sloupce s odpovídajícími řádky."
      },
      "parallelCoordinates": {
        "description": "Každý záznam jako čára přes několik normalizovaných číselných os, obarvená podle kategorie.",
        "emptyTitle": "Žádné záznamy k vykreslení",
        "emptyBody": "Filtrům neodpovídají žádné řádky napříč zvolenými osami."
      }
    },
    "feeds": {
      "activityFeed": {
        "description": "Průběžný kanál toho, kdo co ve vašem pracovním prostoru udělal, od nejnovějšího.",
        "emptyTitle": "Žádná nedávná aktivita",
        "emptyBody": "Akce ve vašem pracovním prostoru se zobrazí zde."
      },
      "notificationFeed": {
        "description": "Seskupená oznámení se stavem nepřečteno, filtry a akcemi v řádku.",
        "emptyTitle": "Žádná oznámení",
        "emptyBody": "Nová oznámení se zobrazí zde."
      },
      "realtimeFeed": {
        "description": "Živý proud událostí, který nové položky přidává na začátek.",
        "emptyTitle": "Čekání na události",
        "emptyBody": "Živé události se zobrazí, jakmile nastanou."
      },
      "timelineVertical": {
        "description": "Svislá časová osa událostí, vydání, incidentů nebo kroků běhu.",
        "emptyTitle": "Zatím tu nic není",
        "emptyBody": "Události se na této časové ose zobrazí, jakmile nastanou."
      },
      "unreadBadge": {
        "description": "Počítadlo nepřečtených položek synchronizované se stavem kanálu.",
        "unitLabel": "nepřečtené"
      }
    },
    "calendar": {
      "calendarMonth": {
        "description": "Měsíční mřížka naplánovaných událostí se štítky u dnů a navigací mezi měsíci.",
        "emptyTitle": "Nic naplánováno",
        "emptyBody": "Naplánované události se zobrazí v tomto kalendáři."
      },
      "dayAgenda": {
        "description": "Události vybraného dne jako časově seřazená agenda.",
        "emptyTitle": "Nic naplánováno",
        "emptyBody": "Události pro vybraný den se zobrazí zde."
      },
      "scheduleMatrix": {
        "description": "Mřížka směn podle zdroje a dne s denním pokrytím a legendou.",
        "emptyTitle": "Žádné naplánované směny",
        "emptyBody": "Přiřazené směny se zobrazí v tomto rozvrhu."
      },
      "capacityBoard": {
        "description": "Pruhy vytížení podle člena s rozpisem projektů a stavem zátěže.",
        "emptyTitle": "Žádná data o vytížení",
        "emptyBody": "Vytížení členů se zobrazí, jakmile budou existovat přiřazení."
      }
    },
    "tables": {
      "masterList": {
        "description": "Vybíratelný seznam záznamů, který řídí podokno s detailem.",
        "emptyTitle": "Žádné položky",
        "emptyBody": "Položky se zde zobrazí, jakmile budou existovat."
      },
      "logTable": {
        "description": "Protokol událostí s vyhledáváním, filtrem chyb a akcemi na řádku.",
        "emptyTitle": "Žádné záznamy protokolu",
        "emptyBody": "Události se zde zaznamenají, jakmile nastanou."
      },
      "cardGallery": {
        "description": "Responzivní galerie karet entit se stavem a rychlými akcemi.",
        "emptyTitle": "Není co zobrazit",
        "emptyBody": "Položky se zde zobrazí jako karty."
      },
      "groupedSummaryTable": {
        "description": "Seskupené řádky s agregačními sloupci, rozbalitelnými detaily a součty.",
        "emptyTitle": "Žádná souhrnná data",
        "emptyBody": "Seskupené součty se zde zobrazí, jakmile budou data."
      },
      "schemaTree": {
        "description": "Průzkumník schémat, tabulek a sloupců se štítky typů a klíčů.",
        "emptyTitle": "Žádné načtené schéma",
        "emptyBody": "Připojte databázi a prozkoumejte její schéma zde."
      },
      "toggleMatrix": {
        "description": "Interaktivní mřížka logických přepínačů pro role, zásady nebo kanály.",
        "emptyTitle": "Žádná matice nenakonfigurována",
        "emptyBody": "Řádky a sloupce se zde zobrazí po konfiguraci."
      }
    },
    "boards": {
      "kanbanBoard": {
        "description": "Pevné stavové sloupce s přetažitelnými kartami; přetažením karty do jiného sloupce změníte její stav.",
        "emptyTitle": "Zatím žádné karty",
        "emptyBody": "Karty se zobrazí ve svých stavových sloupcích, jakmile vzniknou záznamy."
      },
      "kanbanSwimlaneGrid": {
        "description": "Mřížka drah × sloupců; přetažení karty jí přiřadí novou dráhu i stav.",
        "emptyTitle": "Žádné dráhy k zobrazení",
        "emptyBody": "Seskupte záznamy podle pole dráhy a pole stavu, abyste sestavili mřížku."
      },
      "addCard": "Přidat kartu",
      "grip": "Přetažením přesunete kartu",
      "pointsUnit": "b.",
      "laneSummary": "Σ{points} b. · {count}",
      "a11y": {
        "grabbed": "{title} uchopeno. Pomocí šipek přesuňte, Enter pro položení, Escape pro zrušení.",
        "over": "{title} je nad {cell}.",
        "moved": "{title} přesunuto do {cell}.",
        "returned": "{title} se vrátilo na původní místo.",
        "failed": "{title} nelze přesunout; vrátilo se na původní místo."
      }
    }
  },
  "grid": {
    "dragHandle": "Přetažením přesuňte {title}",
    "resizeHandle": "Změnit velikost {title}",
    "a11y": {
      "grabbed": "{title} uchopeno. Pomocí šipek přesouvejte, podržením Shift měňte velikost, Enter uloží, Escape zruší.",
      "moved": "{title} přesunuto do sloupce {col}, řádku {row}.",
      "resized": "{title} změněno na {w} sloupců krát {h} řádků.",
      "committed": "{title} umístěno do sloupce {col}, řádku {row}.",
      "reverted": "{title} vráceno na původní pozici."
    }
  }
} as const;
