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
    },
    "communication": {
      "conversationInbox": {
        "description": "Vybíratelný seznam konverzací s počtem nepřečtených, stavem přítomnosti a náhledem poslední zprávy.",
        "emptyTitle": "Žádné konverzace",
        "emptyBody": "Konverzace se zde zobrazí, jakmile dorazí zprávy.",
        "noMatchesTitle": "Žádná konverzace neodpovídá",
        "searchLabel": "Hledat v konverzacích",
        "searchPlaceholder": "Hledat v konverzacích…"
      },
      "chatThread": {
        "description": "Bubliny zpráv seskupené podle autora a dne, s přílohami a polem pro psaní.",
        "emptyTitle": "Zatím žádné zprávy",
        "emptyBody": "Zprávy z této konverzace se zobrazí zde.",
        "composerPlaceholder": "Napište zprávu…",
        "sendLabel": "Odeslat",
        "attachLabel": "Přidat přílohu",
        "typingLabel": "píše…"
      },
      "aiChatPanel": {
        "description": "Panel asistenta pro dotazy na vaše schéma a data.",
        "emptyTitle": "Zeptejte se na svá data",
        "emptyBody": "Začněte otázkou na schéma, tabulky nebo metriky.",
        "composerPlaceholder": "Položte otázku…",
        "sendLabel": "Odeslat",
        "pendingLabel": "Přemýšlím…",
        "configureTitle": "Není nastaven žádný poskytovatel AI",
        "configureBody": "Přidejte klíč Anthropic nebo OpenAI — nebo nasměrujte Adminium na vlastní endpoint — a ptejte se na své schéma.",
        "configureCtaLabel": "Nastavit poskytovatele"
      }
    },
    "domain": {
      "orgChart": {
        "description": "Strom podřízenosti sestavený z odkazu na nadřízeného v tabulce osob, se sbalitelnými větvemi.",
        "emptyTitle": "Žádná organizační struktura",
        "emptyBody": "Organizační schéma se zobrazí, jakmile řádky osob budou odkazovat na nadřízeného.",
        "reportsLabel": "Podřízení · {count}",
        "a11yLabel": "Organizační schéma"
      },
      "ganttChart": {
        "description": "Pruhy úkolů na časové ose seskupené podle fáze, s průběhem, milníky a značkou dneška.",
        "emptyTitle": "Nic není naplánováno",
        "emptyBody": "Úkoly se zde zobrazí, jakmile budou mít datum zahájení a ukončení.",
        "ungroupedLabel": "Úkoly"
      }
    },
    "media": {
      "fileBrowser": {
        "description": "Procházejte soubory a složky jako mřížku dlaždic nebo seznam – s drobečkovou navigací, ikonami typů a hvězdičkami.",
        "emptyTitle": "Tato složka je prázdná",
        "emptyBody": "Začněte nahráním souborů nebo vytvořením složky."
      },
      "uploadDropzone": {
        "description": "Cíl pro nahrávání souborů přetažením, s omezením formátu a velikosti.",
        "dropTitle": "Přetáhněte sem soubory k nahrání",
        "browsePrefix": "nebo",
        "browseLabel": "procházet"
      },
      "uploadProgressList": {
        "description": "Řádky jednotlivých souborů s ukazatelem průběhu a stavem; obsluhuje i úlohy exportní fronty.",
        "emptyTitle": "Neprobíhá žádné nahrávání",
        "emptyBody": "Nahrávané soubory zde zobrazí svůj průběh."
      },
      "attachmentList": {
        "description": "Soubory připojené k záznamu, s ikonami typů, velikostmi a akcemi stažení či smazání.",
        "emptyTitle": "Žádné přílohy",
        "emptyBody": "Soubory připojené k tomuto záznamu se zobrazí zde."
      },
      "imageBoard": {
        "description": "Mřížka moodboardu s místy pro obrázky a popisky, pro tabulky s URL obrázků.",
        "emptyTitle": "Zatím žádné obrázky",
        "emptyBody": "Referenční obrázky se zobrazí na této nástěnce."
      },
      "linkList": {
        "description": "Referenční odkazy s názvy a adresami URL, otevírané na nové kartě.",
        "emptyTitle": "Zatím žádné odkazy",
        "emptyBody": "Referenční odkazy se zobrazí zde."
      },
      "root": "Soubory",
      "breadcrumb": "Drobečková navigace",
      "gridView": "Zobrazení mřížky",
      "listView": "Zobrazení seznamu",
      "nameHeader": "Název",
      "sizeHeader": "Velikost",
      "modifiedHeader": "Změněno",
      "star": "Hvězdička",
      "items": "položek",
      "done": "Hotovo",
      "failed": "Selhalo",
      "queued": "Ve frontě",
      "retry": "Zkusit znovu",
      "download": "Stáhnout",
      "cancel": "Zrušit",
      "delete": "Smazat",
      "remove": "Odebrat",
      "addImage": "Přidat obrázek",
      "caption": "Popisek",
      "addLink": "Přidat odkaz",
      "linkTitlePlaceholder": "Název",
      "linkUrlPlaceholder": "https://…",
      "add": "Přidat"
    },
    "forms": {
      "modalWizard": {
        "description": "Modální formulář pro vytvoření s potvrzením — standardní postup „nový záznam“.",
        "trigger": "Vytvořit",
        "submit": "Vytvořit",
        "cancel": "Zrušit",
        "done": "Hotovo",
        "successTitle": "Záznam vytvořen",
        "successBody": "Záznam byl uložen.",
        "required": "Toto pole je povinné."
      },
      "drawerForm": {
        "description": "Boční panel pro vytvoření či úpravu záznamů s větším počtem polí.",
        "trigger": "Nový",
        "submit": "Uložit",
        "cancel": "Zrušit"
      },
      "stepper": {
        "description": "Ukazatel kroků zobrazující postup vícekrokového procesu.",
        "a11yLabel": "Průběh"
      },
      "progressBar": {
        "description": "Ukazatel průběhu s procentem.",
        "label": "Průběh"
      },
      "otpInput": {
        "description": "Pole pro zadání jednorázového kódu.",
        "label": "Jednorázový kód"
      },
      "chipInput": {
        "description": "Zadávání štítků: odebíratelné čipy a volný text potvrzený klávesou Enter.",
        "remove": "Odebrat",
        "placeholder": "Napište a stiskněte Enter…"
      },
      "segmentedControl": {
        "description": "Přepínač s jedním výběrem pro období, prostředí a filtry.",
        "a11yLabel": "Vyberte možnost"
      },
      "filterChipBar": {
        "description": "Filtrovací čipy s živými počty spočítanými ze seznamu, který filtrují.",
        "all": "Vše",
        "a11yLabel": "Filtr",
        "meta": "{shown} z {total}"
      },
      "toggleSwitchList": {
        "description": "Seznam nastavení, každé s přepínačem.",
        "save": "Uložit",
        "dirty": "Máte neuložené změny",
        "emptyTitle": "Žádná nastavení",
        "emptyBody": "Nastavení se zde objeví, jakmile budou nakonfigurována."
      },
      "optionCards": {
        "description": "Mřížka karet s jedním výběrem pro zdroje, šablony a tarify.",
        "a11yLabel": "Vyberte možnost"
      },
      "passwordStrengthMeter": {
        "description": "Čtyřsegmentový ukazatel síly hesla.",
        "label": "Síla hesla",
        "weak": "Slabé",
        "fair": "Průměrné",
        "good": "Dobré",
        "strong": "Silné"
      },
      "validationIssuesList": {
        "description": "Problémy importu a validace, nejzávažnější první, s počtem dotčených řádků.",
        "emptyTitle": "Žádné problémy",
        "emptyBody": "Vše je v pořádku — můžete importovat."
      }
    },
    "chrome": {
      "sidebarNav": {
        "description": "Seskupený navigační panel aplikace s živými počty.",
        "a11yLabel": "Hlavní navigace",
        "emptyTitle": "Zatím žádná navigace",
        "emptyBody": "Zahrnuté tabulky se zde objeví po vygenerování připojení."
      },
      "commandPalette": {
        "description": "Paleta ⌘K: hledejte akce, stránky a záznamy odkudkoli.",
        "title": "Paleta příkazů",
        "placeholder": "Hledat akce, stránky a záznamy…",
        "navigate": "Navigovat",
        "select": "Otevřít",
        "close": "Zavřít",
        "emptyTitle": "Žádné výsledky",
        "emptyBody": "Začněte psát pro vyhledávání.",
        "groupActions": "Akce",
        "groupNavigate": "Navigovat",
        "groupRecent": "Nedávné",
        "groupPages": "Stránky",
        "groupMetrics": "Metriky",
        "groupPeople": "Lidé",
        "groupRecords": "Záznamy"
      },
      "globalSearch": {
        "description": "Vyhledávání napříč entitami s filtry podle typu a úryvky výsledků.",
        "placeholder": "Hledat vše…",
        "all": "Vše",
        "summary": "{count} výsledků pro „{query}“",
        "emptyTitle": "Žádné výsledky",
        "emptyBody": "Zkuste jiný výraz."
      },
      "breadcrumb": {
        "description": "Cesta k aktuálnímu záznamu nebo složce.",
        "a11yLabel": "Drobečková navigace"
      },
      "tabBar": {
        "description": "Záložky přepínající panely nebo navigující, volitelně s počty.",
        "a11yLabel": "Záložky"
      },
      "navCard": {
        "description": "Mřížka odkazových karet pro rozcestníky a úvodní stránky.",
        "emptyTitle": "Není co zobrazit",
        "emptyBody": "Odkazy se zde objeví po vygenerování stránek."
      },
      "shortcutsPanel": {
        "description": "Přehled klávesových zkratek.",
        "footerHint": "Kdykoli stiskněte ?",
        "then": "poté",
        "emptyTitle": "Nejsou registrovány žádné zkratky."
      },
      "avatarStack": {
        "description": "Překrývající se avatary s přetečením „+N“ a volitelnou přítomností.",
        "online": "{count} online"
      }
    },
    "system": {
      "stateHero": {
        "description": "Celostránková stavová obrazovka pro 404, 500, offline, zakázáno a údržbu.",
        "notFoundTitle": "Tato stránka zabloudila",
        "notFoundBody": "Hledaná stránka byla přesunuta, přejmenována, nebo nikdy neexistovala.",
        "serverErrorTitle": "Na naší straně se něco pokazilo",
        "serverErrorBody": "Chyba byla zaznamenána a tým informován. Opakování často pomůže.",
        "offlineTitle": "Jste offline",
        "offlineBody": "Zkontrolujte připojení — dashboard se připojí automaticky.",
        "forbiddenTitle": "Nemáte přístup",
        "forbiddenBody": "Požádejte správce pracovního prostoru o oprávnění k této stránce.",
        "maintenanceTitle": "Probíhá údržba",
        "maintenanceBody": "Vylepšujeme věci. Obvykle to trvá několik minut.",
        "connErrorTitle": "Databáze není dostupná",
        "connErrorBody": "Připojení bylo odmítnuto nebo vypršelo. Zkontrolujte nastavení připojení.",
        "backToDashboard": "Zpět na dashboard",
        "tryAgain": "Zkusit znovu",
        "retry": "Opakovat",
        "testConnection": "Otestovat připojení"
      },
      "emptyState": {
        "description": "Vystředěný panel „zatím nic“ s volitelnými akcemi."
      },
      "statusPill": {
        "description": "Barevný odznak pro enum sloupec — univerzální zobrazení stavu."
      },
      "alertBanner": {
        "description": "Vložené upozornění na kvóty, zmrazení a plánování.",
        "dismiss": "Zavřít"
      },
      "statusBannerHero": {
        "description": "Hlavička stavu služeb, jejíž stav se odvozuje od nejhorší služby v seznamu.",
        "upTitle": "Všechny systémy funkční",
        "upBody": "Všechny sledované služby odpovídají normálně.",
        "degradedTitle": "Snížený výkon",
        "degradedBody": "Některé služby jsou pomalejší než obvykle. Prošetřujeme to.",
        "downTitle": "Rozsáhlý výpadek",
        "downBody": "Jedna či více služeb je nedostupných. Pracujeme na tom."
      },
      "connectionStatus": {
        "description": "Výsledek připojení nebo testu databázového připojení.",
        "idle": "Nepřipojeno",
        "connecting": "Připojování…",
        "connected": "Připojeno",
        "failed": "Připojení selhalo",
        "test": "Otestovat"
      },
      "autosaveIndicator": {
        "description": "Odznak „neuloženo → ukládání → uloženo“ pro automaticky ukládané dokumenty.",
        "dirty": "Neuložené změny",
        "saving": "Ukládání…",
        "saved": "Vše uloženo",
        "error": "Uložení selhalo"
      },
      "progressLogConsole": {
        "description": "Streamovaná konzole logu s ukazatelem průběhu pro dlouho běžící úlohy.",
        "a11yLabel": "Log průběhu",
        "progressLabel": "Průběh",
        "emptyTitle": "Zatím není co hlásit",
        "emptyBody": "Řádky logu se objeví po spuštění úlohy."
      },
      "diagnosticsReadout": {
        "description": "Výsledky kontrol připojení jako barevné řádky klíč/hodnota s časovým razítkem.",
        "checkedAt": "Naposledy zkontrolováno",
        "host": "Hostitel",
        "dns": "DNS",
        "tcp": "TCP",
        "tls": "TLS",
        "auth": "Ověření",
        "latency": "Latence"
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
