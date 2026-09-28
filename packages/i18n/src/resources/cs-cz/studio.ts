// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/studio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "addOns": {
    "browse": {
      "all": "Vše",
      "bundled": "Included",
      "categories": "Kategorie",
      "discard": "Discard",
      "download": "Download",
      "emptyBody": "This build shipped none, and the online catalogue is off.",
      "emptyOnlineBody": "Online katalog je zapnutý, ale poslední kontrola nic nenašla. Zkuste vyhledat novinky.",
      "emptyTitle": "No add-ons available",
      "install": "Install",
      "missing": "Chybí",
      "missingBody": "Jeho soubory na tomto serveru nejsou, takže se z něj nenačte nic.",
      "needsNewer": "Vyžaduje Adminium {version} nebo novější",
      "noMatchBody": "Tomuto hledání a kategorii neodpovídá žádný doplněk.",
      "noMatchTitle": "Žádná shoda",
      "offline": "Showing the add-ons that came with this build. Browsing online is switched off, and nothing here has contacted the internet.",
      "online": "Includes add-ons from the online catalogue. Checking for newer versions is a separate action.",
      "refresh": "Check for newer",
      "search": "Hledat doplňky",
      "title": "Available",
      "toggle": "Browse the online catalogue",
      "upgrade": "v{version} available",
      "upgradeAction": "Upgrade"
    },
    "card": {
      "needsApiKey": "Vyžaduje API klíč",
      "needsOauth": "Připojuje se přes OAuth"
    },
    "category": {
      "artwork": "Grafika",
      "data": "Data",
      "delivery": "Doprava",
      "email": "E-mail",
      "payments": "Platby"
    },
    "confirm": {
      "cancel": "Cancel",
      "close": "Close",
      "discard": "Discard",
      "discardBody": "The downloaded files are deleted. Nothing was installed, so nothing else changes — you can download it again whenever you like.",
      "discardTitle": "Discard this download",
      "disconnect": "Disconnect",
      "disconnectBody": "Its keys are deleted and it stops making calls. Every table and every row it created stays exactly as it is, and you can reconnect at any time.",
      "disconnectTitle": "Disconnect this add-on",
      "uninstall": "Uninstall",
      "uninstallBody": "Its keys are deleted and its files are removed from this server. Every table and every row it created stays exactly as it is. You can install it again later.",
      "uninstallTitle": "Uninstall this add-on"
    },
    "connect": {
      "apiKey": "API key",
      "submit": "Connect"
    },
    "consent": {
      "cancel": "Cancel",
      "close": "Close",
      "confirm": "Install",
      "hosts": "Attach to",
      "loading": "Working out what this would do…",
      "subtitle": "What this add-on will do, before it can do it.",
      "title": "Install {name}"
    },
    "error": "Something went wrong",
    "installed": {
      "connected": "Connected",
      "disconnect": "Disconnect",
      "egress": "May contact: {hosts}",
      "emptyBody": "Install an add-on above and it will appear here with its hosts and connection.",
      "emptyTitle": "Nothing installed yet",
      "missing": "Chybí",
      "missingBody": "Jeho soubory na tomto serveru nejsou, takže se z něj nenačte nic. Nainstalujte jej znovu, nebo jej odeberte.",
      "notConnected": "Not connected",
      "off": "off",
      "on": "on",
      "title": "Installed",
      "uninstall": "Uninstall"
    },
    "job": {
      "body": "Fetching and verifying. Nothing is installed until you say so.",
      "failed": "The download did not finish. Nothing was installed.",
      "title": "Downloading"
    },
    "plan": {
      "blocked": "This cannot be installed here",
      "needsColumns": "This add-on needs columns you do not have",
      "needsColumnsBody": "Adminium will not add columns to tables you already own. Add them yourself, then install.",
      "noData": "This add-on reads and writes no tables of its own.",
      "reuse": "This add-on will use tables you already have:",
      "willCreate": "This will create tables in your database",
      "willCreateBody": "Installing creates these tables. Uninstalling later leaves them, and their data, alone."
    },
    "settings": {
      "badJson": "Toto není platný JSON, takže se nic neuložilo.",
      "save": "Uložit nastavení",
      "title": "Nastavení"
    },
    "sideload": {
      "file": "Package file (.tgz)",
      "hint": "For a server with no internet. It is checked exactly as a download would be, so it needs the hash that came with it.",
      "sha": "Integrity (sha512-…)",
      "shaHint": "The sha512- fingerprint published with the release, shown beside its Download link on adminium.dev/marketplace. The upload is refused if the bytes do not match.",
      "submit": "Upload",
      "title": "Upload a package",
      "uploaded": {
        "title": "Nahráno: {name} {version}",
        "body": "Nainstalujte ho ze seznamu výše."
      }
    },
    "subtitle": "Extra capabilities you can add to your apps — shipping, artwork, data. Each one says what it needs before you install it.",
    "title": "Add-ons",
    "upgradeNote": "Upgrading keeps the hosts an add-on is attached to and the connection it already has.",
    "veto": {
      "body": "The setting is saved, but network features are off for this server and that wins. Downloaded add-ons still work, and you can still upload one yourself.",
      "title": "This deployment cannot browse online"
    }
  },
  "capability": {
    "importNoLiveHealth": "Bez živého databázového připojení — kontroly stavu a detekce driftu schématu nejsou pro tento zdroj dostupné.",
    "importNoRowCounts": "Soubory se schématem neobsahují počty řádků — seznam tabulek zobrazuje — místo smyšlených čísel.",
    "mysqlApproxRows": "Počty řádků v MySQL jsou odhady úložného enginu (odchylka až ±40 %) — zobrazují se se znakem ≈.",
    "mysqlFkEnum": "Metadata cizích klíčů a enumů jsou v MySQL slabší: tabulky MyISAM nedeklarují cizí klíče, enumy jsou sloupcové typy enum(…) a omezení CHECK vyžadují MySQL 8.0.16+ / MariaDB 10.2+.",
    "rowsApproximate": "Odhad úložného enginu — u InnoDB se může lišit až o ±40 %.",
    "rowsNoEstimate": "Engine pro tuto tabulku nenahlásil žádný odhad.",
    "rowsRunAnalyze": "Zatím žádný odhad — spusťte na databázi ANALYZE, aby se počty řádků doplnily.",
    "rowsUnavailable": "Soubory se schématem nemají živou databázi — počty řádků zůstanou neznámé, dokud nějakou nepřipojíte.",
    "sqliteCheckEnums": "SQLite nemá nativní typ enum — enumy se syntetizují z omezení CHECK (col IN (…)).",
    "sqliteNoComments": "SQLite nepodporuje komentáře sloupců — popisky přidejte v editoru přemapování schématu."
  },
  "design": {
    "adopt": {
      "action": "Přidat do aplikace",
      "done": "Vytvořeno {created} stránek, aktualizováno {updated}, {unchanged} už bylo aktuálních.",
      "everything": "Toto připojení už zobrazuje všechny tabulky, nebylo tedy třeba nic zahrnout.",
      "forbidden": "Vaše role může měnit schéma, ale ne generovat stránky. Požádejte správce se správou připojení, aby tyto tabulky přidal do aplikace.",
      "grants": "Žádná role nezíská přístup automaticky — udělte jej v Nastavení → Role.",
      "offer": "Nová tabulka nic nedělá, dokud nemá stránku. Přidat {tables} do aplikace?",
      "skippedEdited": "Ponechány beze změny, protože jste je upravili: {pages}."
    },
    "apply": "Použít",
    "brokenEnumValues": "Každá povolená hodnota u {columns} musí být vyplněná a odlišná od ostatních.",
    "ceiling": {
      "authorise": "Autorizovat tento přepis",
      "body": "{table} má přes {rows} řádků — víc, než Adminium přepisuje samo. Autorizovat to může jen Super Admin a tabulka bude po celou dobu přepisu zamčená.",
      "hint": "Napište název tabulky přesně tak, jak je uveden výše.",
      "notYours": "{table} má přes {rows} řádků. Přepis takového rozsahu může autorizovat jen Super Admin — požádejte ho, nebo změnu proveďte v servisním okně vlastními nástroji.",
      "prompt": "Pro autorizaci přepisu napište {table} znovu"
    },
    "column": {
      "default": "Výchozí hodnota",
      "defaultValue": "Hodnota",
      "help": "Co tato nastavení znamenají?",
      "length": "Délka",
      "link": "Odkazuje na",
      "linkHelp": "Propojte to s řádkem v jiné tabulce.",
      "linkTypeNote": "Typ odpovídá klíči propojené tabulky.",
      "name": "Název",
      "namePlaceholder": "client_id",
      "noLink": "Nic",
      "onDelete": "Když je propojený řádek smazán",
      "precision": "Přesnost",
      "primaryKey": "Primární klíč",
      "remove": "Odebrat {name}",
      "required": "Povinné",
      "type": "Typ",
      "unique": "Jedinečné"
    },
    "confirm": {
      "body": "Tato změna zahodí data nebo odstraní objekt. Adminium ji nedokáže vrátit zpět.",
      "cancel": "Zrušit",
      "close": "Zavřít",
      "confirm": "Použít změny",
      "prompt": "Pro potvrzení napište {word}",
      "title": "Použít destruktivní změnu"
    },
    "default": {
      "autoincrement": "Číslovat dál od posledního řádku",
      "false": "Ne",
      "literal": "Určitá hodnota",
      "none": "Nic",
      "now": "Aktuální datum a čas",
      "true": "Ano",
      "uuid": "Nové jedinečné id"
    },
    "designer": "Návrhář tabulek",
    "discard": "Zahodit změny",
    "discardTable": "Zahodit tuto novou tabulku",
    "dropping": "Označeno ke smazání",
    "empty": {
      "body": "Vytvořte tabulku nebo vyberte jednu k úpravě. Do vaší databáze se nic nedostane, dokud si příkazy neprohlédnete a nepoužijete je.",
      "title": "Navrhněte své schéma"
    },
    "error": {
      "atColumn": "Sloupec {n}, {field}",
      "atTable": "Tabulka {field}",
      "empty": "Název je povinný.",
      "identifier": "Použijte malá písmena, číslice a podtržítka, začněte písmenem.",
      "tooLong": "Příliš dlouhé — {dialect} povoluje {max} znaků."
    },
    "existing": "Existující tabulky",
    "hazard": {
      "irreversible": "Nelze vrátit zpět",
      "locking": "Drží zámek",
      "lossy": "Zahodí data",
      "refused": "Odmítnuto",
      "rewrite": "Přepíše tabulku",
      "safe": "Bezpečné"
    },
    "help": {
      "close": "Zavřít",
      "default": {
        "example": "Pole „vytvořeno“, které začíná aktuálním datem a časem, nikdo nemusí psát a nemůže být špatně.",
        "term": "Výchozí hodnota",
        "what": "Co je v poli, když ho nikdo nevyplní. Hodnotu tam vloží sama databáze, tedy i u řádků vzniklých mimo Adminium."
      },
      "keyGeneration": {
        "example": "Jedinečné id umí vygenerovat a hned vrátit jen PostgreSQL, na ostatních databázích se klíč čísluje.",
        "term": "Jak se vyplní klíč",
        "what": "Odkud se bere id každého řádku. Číslování od posledního řádku dá 1, 2, 3 a vyhovuje většině tabulek; jedinečné id je dlouhé a náhodné — hůř se hádá a hůř se předčítá."
      },
      "link": {
        "example": "Rezervace se váže na klienta. Adminium pak u rezervace zobrazí klienta a u klienta jeho rezervace.",
        "term": "Vazba na jinou tabulku",
        "what": "Propojí tento řádek s řádkem v jiné tabulce a nechá databázi hlídat, aby vazba držela — nemůžete ukázat na něco, co neexistuje."
      },
      "primaryKey": {
        "example": "Bez primárního klíče umí Adminium řádky vypsat, ale nemůže jednotlivý řádek upravit ani smazat.",
        "term": "Primární klíč",
        "what": "Pole, které identifikuje každý řádek — to, podle kterého Adminium rozezná jeden řádek od druhého. Každá tabulka by měla mít právě jedno a téměř vždy je to pole „id“, které za vás vzniklo."
      },
      "required": {
        "example": "Objednávka potřebuje zákazníka, takže to pole je povinné. Poznámka k doručení je volitelná, takže povinná není.",
        "term": "Povinné",
        "what": "Pole musí být vyplněné. Dokud je prázdné, řádek nejde uložit."
      },
      "subtitle": "Srozumitelný popis každého nastavení a toho, co mění pro lidi, kteří vaši aplikaci používají.",
      "title": "Co tato pole znamenají",
      "type": {
        "example": "Telefonní číslo je obvykle text, ne číslo — u čísel se ztrácejí úvodní nuly.",
        "term": "Typ",
        "what": "Jaký druh informace pole obsahuje — text, celá čísla, peníze, datum, odpověď ano/ne. Právě díky správné volbě umí Adminium zobrazit výběr data místo textového pole a sečíst sloupec s penězi."
      },
      "unique": {
        "example": "Dva zákazníci by neměli sdílet stejnou e-mailovou adresu — označte ji jako jedinečnou a nepůjde to.",
        "term": "Jedinečné",
        "what": "Žádné dva řádky nesmějí mít stejnou hodnotu. Ten druhý databáze odmítne."
      },
      "values": {
        "example": "Stav: nový, probíhá nebo hotovo. Nikdo nemůže napsat „probíhaá“ a omylem vytvořit čtvrtý stav.",
        "term": "Povolené hodnoty",
        "what": "Úplný seznam odpovědí, které pole přijme. Cokoli jiného databáze odmítne a Adminium seznam zobrazí jako tlačítka nebo nabídku místo textového pole."
      }
    },
    "keepTable": "Ponechat {table}",
    "newTable": "Nová tabulka",
    "onDelete": {
      "cascade": "Smazat i tento řádek",
      "restrict": "Zabránit smazání",
      "setNull": "Ponechat pole prázdné"
    },
    "plan": "Zkontrolovat změny",
    "result": {
      "applied": "Použito. Adminium znovu načetlo vaše schéma.",
      "failed": "Nic nebylo použito — vaše databáze je beze změny. {error}",
      "partial": "Částečně použito: proběhlo {done} z {total} kroků. Opětovné použití stejných změn je dokončí.",
      "repaired": "Přejmenování se promítlo do {pages, plural, one {# stránky} few {# stránek} many {# stránky} other {# stránek}}, {grants, plural, one {# oprávnění role} few {# oprávnění rolí} many {# oprávnění role} other {# oprávnění rolí}} a {overrides, plural, one {# přepisu schématu} few {# přepisů schématu} many {# přepisu schématu} other {# přepisů schématu}}."
    },
    "review": {
      "noChanges": "Zatím žádné změny schématu.",
      "pending": "Zkontrolujte své změny a uvidíte přesné příkazy, které Adminium spustí.",
      "steps": "Plánované kroky",
      "superAdmin": "Super administrátor",
      "unfinished": "Předchozí použití na tomto připojení nikdy neohlásilo výsledek. Jeho schéma může být na půli cesty mezi dvěma podobami — před dalším použitím zkontrolujte historii změn."
    },
    "reviewPane": "Kontrola",
    "table": {
      "addColumn": "Přidat sloupec",
      "columns": "Sloupce",
      "drop": "Smazat tuto tabulku",
      "dropHelp": "Tabulka i všechny její řádky budou zničeny. Než se cokoli spustí, uvidíte přesně, co se rozbije.",
      "keyCounted": "Číslovat dál od posledního řádku",
      "keyGeneration": "Jak se vyplní klíč",
      "keyGenerationHelp": "Adminium podle tohoto klíče načte nový řádek po každém vložení.",
      "keyGenerationOne": "V {dialect} musí být klíč počítané celé číslo: id vygenerované databází nelze po vložení načíst zpět.",
      "keyUnique": "Nové jedinečné id",
      "name": "Název tabulky",
      "nameHelp": "Malá písmena, číslice a podtržítka.",
      "namePlaceholder": "reservations",
      "noKey": "Tato tabulka nemá primární klíč, takže s ní Adminium bude zacházet jen pro čtení — řádky lze vypsat, ale ne upravovat.",
      "renameHelp": "Změna přejmenuje tabulku ve vaší databázi."
    },
    "unnamed": "Pojmenujte každou tabulku a sloupec, abyste mohli změny zkontrolovat.",
    "unrepresentableDefaults": "Tyto sloupce si ponechávají výchozí hodnotu generovanou databází, kterou zde Adminium nemůže upravit, a zůstává beze změny: {columns}",
    "valuelessEnum": "Přidejte {columns} alespoň jednu povolenou hodnotu, abyste mohli změny zkontrolovat.",
    "values": {
      "add": "Přidat hodnotu",
      "addOnly": "Tento seznam je typ ve vaší databázi a Postgres už existující hodnotu neumí odebrat ani přejmenovat. Přidávat další můžete.",
      "down": "Posunout {value} dolů",
      "empty": "Sloupec s výběrem potřebuje alespoň jednu hodnotu, než půjde změnu zkontrolovat.",
      "label": "Povolené hodnoty",
      "placeholder": "in_progress",
      "remove": "Odebrat {value}",
      "up": "Posunout {value} nahoru",
      "value": "Hodnota {n}"
    }
  },
  "diagram": {
    "ceiling": "Zobrazuje se {shown} nejvíce propojených tabulek. Dalších {omitted} je skrytých — vyhledejte je a přidejte.",
    "legend": {
      "declared": "Cizí klíč",
      "inferred": "Odvozeno",
      "virtual": "Přidáno v Adminiu"
    },
    "legendLabel": "Legenda",
    "node": {
      "foreignKey": "Cizí klíč",
      "more": "+{count} dalších",
      "primaryKey": "Primární klíč"
    },
    "outline": {
      "intro": "{tables} tabulek a {relations} vztahů jako seznam.",
      "more": " a {count} dalších",
      "referencedBy": "Odkazuje sem: {list}",
      "references": "Odkazuje na: {list}"
    },
    "saveLayout": "Uložit rozvržení",
    "search": "Najít tabulku nebo sloupec",
    "showDiagram": "Zobrazit diagram",
    "showList": "Zobrazit jako seznam"
  },
  "documents": {
    "cancel": "Zrušit",
    "connectionLabel": "Připojení",
    "delete": "Smazat",
    "delivery": {
      "email": "Odeslat na",
      "noEmail": "Nikomu — jen ponechat u záznamu",
      "noEmailSlot": "Tento druh dokladu nemá pole s adresou, a nelze jej tedy odeslat.",
      "noSmtp": "Toto Adminium zatím nemá nastavený e-mailový server, takže nelze nic odeslat. Nastavte jej v Studio → Nastavení → E-mail.",
      "stored": "Zůstává vždy u záznamu."
    },
    "disabled": "vypnuto",
    "edit": "Upravit",
    "empty": "Zatím žádná přiřazení.",
    "grants": {
      "refused": "Toto přiřazení čte {tables}, což nesmíte číst. Doklady z něj vám budou selhávat.",
      "title": "Nesmíte číst všechno z toho"
    },
    "intro": "Přiřazení říká, které sloupce které tabulky tvoří jeden druh dokladu, co jej vyvolá a kam jde.",
    "name": "Pojmenovat toto přiřazení",
    "newFrom": "Nové přiřazení na:",
    "noProvider": "Zatím žádný nainstalovaný add-on neumí kreslit doklady. Nainstalujte jej v Add-onech a možná přiřazení se objeví zde.",
    "pickTable": "Vyberte tabulku…",
    "prefix": "Předčíslí",
    "render": {
      "failedRow": "Nic se nenakreslilo: {reason}",
      "intro": "Nakreslete jeden teď, z řádku, který si vyberete. Nic se nikam neposílá — zůstane u záznamu jako každý jiný.",
      "noRows": "Zatím žádné řádky, ze kterých kreslit.",
      "open": "Otevřít",
      "pending": "Kreslí se…",
      "pick": "Nakreslit tento",
      "ready": "Nakresleno.",
      "saveFirst": "Nejprve přiřazení uložte. Doklad se kreslí z uloženého, takže uvidíte, co udělá, dřív než kdokoli jiný.",
      "search": "Hledat v řádcích",
      "slow": "Zatím se neobjevil žádný doklad. Možná ještě čeká, nebo tato instalace neběží s úlohami na pozadí — dokud neběží, nic se nenakreslí.",
      "slowTitle": "Stále nic"
    },
    "save": "Uložit přiřazení",
    "slot": {
      "byDefault": "Vyplní Adminium",
      "lineColumnOf": "{column} každé položky",
      "lineColumns": "Co vyplňuje každý sloupec položky",
      "looksLikeLines": "vypadá jako položky",
      "noChildren": "Nic ve vaší databázi neukazuje na tuto tabulku, takže není co kreslit jako položky. Doklad potřebuje podřízenou tabulku s cizím klíčem zpět na tuto.",
      "noLines": "Žádné položky",
      "pii": "skrytá data",
      "typed": "Hodnota, kterou zadám",
      "typedHint": "Zadáno zde, nečte se z vašich dat — každý doklad z tohoto přiřazení dostane stejnou hodnotu.",
      "typedValue": "Hodnota pro {slot}",
      "unmapped": "Nevyplněno"
    },
    "step": {
      "delivery": "Kam jde",
      "kind": "Druh",
      "mapping": "Co plní každé pole",
      "mappingHelp": "Každé pole čte sloupec — nebo bere hodnotu, kterou zde zadáte.",
      "render": "Vyzkoušet na řádku",
      "table": "Připojení a tabulka",
      "trigger": "Co jej vyvolá"
    },
    "tableLabel": "Tabulka",
    "title": "Přiřazení dokladů",
    "trigger": {
      "created": "Když přibude řádek",
      "manual": "Jen na vyžádání",
      "manualShort": "na vyžádání",
      "note": "Řádky z importu nebo zapsané rovnou do databáze nic nevyvolají — jen zápisy přes Adminium.",
      "noteTitle": "Co se počítá jako změna",
      "updated": "Když se řádek změní"
    },
    "unbound": "Ještě vyplnit: {slots}",
    "deleteConfirm": {
      "title": "Smazat toto mapování?",
      "body": "Smaže se i pravidlo, které ho spouští, a dokumenty z něj již vytvořené ztratí zpětný odkaz. Tuto akci nelze vrátit.",
      "prompt": "Pro potvrzení napište {name}",
      "confirm": "Smazat mapování"
    },
    "deleteFailed": "Mapování nebylo smazáno",
    "loadFailed": "Mapování se nepodařilo načíst"
  },
  "enrich": {
    "byo": {
      "cardDescription": "Zkopírujte samostatný prompt do Claude Code, ChatGPT, čehokoli — a poté vložte JSON zpět. Není potřeba klíč, nic tento počítač automaticky neopouští.",
      "cardTitle": "Zkopírovat prompt do vlastního nástroje AI",
      "cardTitleRecommended": "Zkopírovat prompt do vlastního AI nástroje — doporučeno",
      "chunkTab": "Prompt {index}",
      "chunkTabs": "Části promptu",
      "chunkValid": "Část {index} ověřena",
      "continueReview": "Pokračovat ke kontrole",
      "copyErrors": "Kopírovat chyby pro váš nástroj AI",
      "copyErrorsDone": "Chyby zkopírovány",
      "copyErrorsHint": "Vložte to zpět do svého nástroje AI a získejte opravenou odpověď.",
      "copyPrompt": "Kopírovat prompt",
      "copyPromptDone": "Prompt zkopírován",
      "download": "Stáhnout .md",
      "droppedItems": "{count} návrhů bylo při ověření vyřazeno — kontrola zobrazuje zbytek.",
      "errorsTitle": "Ověření našlo {count} problémů",
      "guidance": "Spusťte to v jakémkoli nástroji AI — Claude Code, ChatGPT, cokoli. Vložte vrácený JSON níže.",
      "mergedBody": "Návrhy jsou připraveny ke kontrole vůči heuristickému základu.",
      "mergedTitle": "Všech {count} částí ověřeno a sloučeno",
      "mergedTitleSingle": "Odpověď ověřena",
      "pasteLabel": "Vložte odpověď JSON",
      "pastePlaceholder": "Sem vložte odpověď JSON…",
      "pendingBody": "Vložte odpověď JSON výše a ověřte ji, abyste mohli pokračovat ke kontrole.",
      "pendingBodyChunked": "Každá část musí být ověřena, než se návrhy sloučí. Vložte a ověřte každý prompt výše.",
      "pendingTitle": "Pokračujte ověřením každého promptu",
      "promptLabel": "Prompt obohacení",
      "promptLabelN": "Prompt obohacení {index} z {total}",
      "requestFailed": "Server nebyl pro ověření dostupný — zkuste to znovu.",
      "tokenChip": "≈ {tokens} tokenů",
      "valid": "Odpověď ověřena",
      "validate": "Ověřit",
      "wholeDocument": "celý dokument"
    },
    "copied": "Zkopírováno",
    "createFailed": "Prompt pro obohacení se nepodařilo sestavit — zkuste to znovu.",
    "createFailedTitle": "Nelze spustit",
    "direct": {
      "back": "Zpět na možnosti",
      "building": "Sestavování promptu…",
      "cancel": "Zrušit",
      "continueReview": "Pokračovat ke kontrole",
      "done": "Obohacení dokončeno — zkontrolujte návrhy.",
      "errorTitle": "Obohacení selhalo",
      "failed": "Běh poskytovatele selhal. Zkontrolujte nastavení AI a zkuste to znovu.",
      "jobFailed": "Běh obohacení nebyl dokončen.",
      "logLabel": "Protokol obohacení",
      "retry": "Zkusit znovu",
      "startFailed": "Běh se nepodařilo spustit — zkuste to znovu.",
      "subtitle": "Odesílání vašeho schématu do",
      "title": "Obohacování pomocí AI"
    },
    "fileBody": "Zdroje ze souboru se schématem zatím nemají snímek k obohacení. Připojte živou databázi pro obohacení pomocí AI, nebo pokračujte — heuristický základ i tak vygeneruje kompletní aplikaci.",
    "fileTitle": "Obohacení pomocí AI vyžaduje živou databázi",
    "noTablesBody": "Tato databáze zatím nemá žádné tabulky, takže AI nemá co popsat ani seskupit. Pokračujte — jakmile tabulky budou existovat, můžete obohacení pomocí AI kdykoli spustit v Nastavení → AI.",
    "noTablesTitle": "Žádné tabulky k obohacení",
    "generatePrompt": "Vygenerovat prompt",
    "intentLabel": "Jak chcete obohatit?",
    "localeLocked": "(povinné)",
    "localesLegend": "Přeložit popisky do",
    "noSections": "Vyberte alespoň jednu skupinu rozhodnutí k obohacení.",
    "provider": {
      "configError": "Nastavení poskytovatele se nepodařilo načíst — nakonfigurujte ho v Nastavení → AI a vraťte se k tomuto kroku.",
      "description": "Spusťte obohacení nyní s nakonfigurovaným poskytovatelem. Každý návrh zkontrolujete jako rozdíl.",
      "networkDisabled": "Toto Adminium nemá odchozí přístup k internetu, takže nemůže oslovit API poskytovatele. Použijte místo toho kolečko kopírovat-vložit — stejný prompt, stejná kontrola.",
      "readyBody": "Vyberte výše „Použít mého poskytovatele AI“ a spusťte obohacení tohoto připojení hned teď.",
      "readyTitle": "Poskytovatel AI nakonfigurován",
      "setUpHere": "Nastavit poskytovatele zde",
      "setUpHide": "Skrýt nastavení poskytovatele",
      "settingsHint": "Chcete jej spustit přímo?",
      "settingsLink": "Nakonfigurujte poskytovatele v Nastavení → AI",
      "title": "Použít mého poskytovatele AI",
      "unconfigured": "Zatím není nakonfigurován žádný poskytovatel AI — nastavte ho níže, nebo zkopírujte prompt do vlastního AI nástroje."
    },
    "providerFallback": "váš poskytovatel AI",
    "samplingHint": "Do promptu zahrne až 20 skutečných hodnot na sloupec bez PII.",
    "samplingPreviewBody": "Až 20 nejčastějších hodnot na sloupec bez PII, plus min/max u číselných a datumových sloupců. Sloupce označené jako PII se nikdy nevzorkují. Vše ostatní zůstává pouze agregované. Před kopírováním (BYO) zkontrolujte přesný prompt — bez vaší akce se nic neodešle.",
    "samplingPreviewTitle": "Co opouští tento počítač",
    "samplingTitle": "Zahrnout ukázkové hodnoty",
    "section": {
      "enums": "Sémantika výčtů",
      "groups": "Navigační skupiny",
      "icons": "Ikony",
      "keys": "Klíčové sloupce",
      "labels": "Popisky a popisy",
      "microcopy": "Mikrotexty",
      "pii": "PII a maskování",
      "relations": "Vztahy",
      "templates": "Šablony stránek",
      "widgets": "Widgety nástěnky"
    },
    "sectionsLegend": "O čem má AI rozhodovat?",
    "skip": {
      "confirmBody": "Vygenerovaná aplikace použije heuristické popisky, skupiny a nástěnky. Pokračujte v generování — obohacení pomocí AI můžete kdykoli spustit v Nastavení → AI.",
      "confirmTitle": "Pokračování s heuristikou",
      "description": "Generovat z heuristického základu. Obohatit můžete později v Nastavení → AI — přeskočení není nikdy penalizováno.",
      "title": "Přeskočit — použít pouze heuristiku"
    },
    "startOver": "Začít znovu",
    "startProvider": "Spustit obohacení",
    "subtitle": "Volitelně vylepšete vygenerované popisky, skupiny, výčty a nástěnky pomocí LLM. Heuristický základ funguje i bez toho — toto pouze přidává návrhy, které před použitím zkontrolujete.",
    "title": "Obohatit pomocí AI"
  },
  "generate": {
    "errorTitle": "Generování se nezdařilo",
    "failed": "Generování se nezdařilo — zkuste to znovu, nebo nejprve znovu spusťte introspekci.",
    "fileBody": "Vaše schéma se zpracovalo čistě a náhled výše je skutečný. Generování běžící aplikace přímo ze souboru schématu (se zástupnými řádky) zatím není k dispozici — připojte živou databázi a generujte hned.",
    "fileTitle": "Soubor schématu zpracován — generování vyžaduje živou databázi",
    "log": {
      "classifying": "Klasifikace schématu…",
      "composing": "Skládání šablon…",
      "done": "Vygenerováno {pages} stránek v {groups} navigačních skupinách",
      "writing": "Zapisování stránek…"
    },
    "logLabel": "Protokol generování",
    "openApp": "Otevřít aplikaci",
    "run": "Vygenerovat nástěnku",
    "subtitle": "Jedna stránka na zahrnutou tabulku plus nástěnky podle domény — záměr:",
    "successBody": "{pages} stránek v {groups} navigačních skupinách — vygenerováno z vašeho schématu, upravitelné ve Studiu.",
    "successTitle": "Vaše nástěnka je připravena",
    "title": "Vygenerujte svou aplikaci",
    "blankBody": "Nic se nevygenerovalo, přesně jak jste chtěli. První stránku z tohoto připojení vytvořte, až budete připraveni.",
    "blankTitle": "Vaše připojení je připraveno",
    "createPage": "Vytvořit stránku"
  },
  "hostedApps": {
    "browse": {
      "title": "Aplikace k instalaci",
      "subtitle": "Hotové aplikace dodané s tímto buildem. Instalace vytvoří potřebné tabulky a začne servírovat obrazovky — dokud plán nepotvrdíte, nic se nestane.",
      "search": "Hledat aplikace…",
      "clear": "Vymazat hledání",
      "all": "Vše",
      "by": "od {publisher}",
      "install": "Nainstalovat",
      "installed": "Nainstalováno",
      "missing": "Chybí",
      "noMatch": "Hledání neodpovídá žádná aplikace",
      "noMatchBody": "Zkuste jiný výraz nebo jinou kategorii.",
      "emptyTitle": "Není k dispozici žádná aplikace",
      "emptyBody": "Aplikace dodané s tímto buildem se objeví zde. Nasměrujte ADMINIUM_BUNDLED_APPS na adresář s balíčky, nebo nějaký nahrajte.",
      "unreadable": "Manifest tohoto balíčku nelze přečíst. Nelze jej nainstalovat — níže jej zahoďte.",
      "subtitleOnline": "Aplikace dodané s tímto buildem a k tomu ty z online katalogu. Instalace aplikaci v případě potřeby stáhne a vytvoří potřebné tabulky — dokud plán nepotvrdíte, nic se nestane.",
      "neverChecked": "Online katalog je zapnutý, ale ještě nebyl zkontrolován. Vyhledejte novinky a zobrazí se jeho aplikace.",
      "refresh": "Vyhledat novinky",
      "toggle": "Procházet online katalog aplikací",
      "emptyOnlineBody": "Online katalog je zapnutý, ale zatím v něm nic není. Vyhledejte novinky a načtěte ho.",
      "fromCatalog": "Online",
      "needsNewer": "Vyžaduje Adminium {version} nebo novější"
    },
    "domains": {
      "add": "Připojit doménu",
      "docsLink": "Jak nastavit doménu",
      "hostLabel": "Host",
      "instanceLabel": "Instance",
      "instanceOwn": "Samotná aplikace",
      "issuesTitle": "Mapa domén byla odmítnuta",
      "none": "Žádné domény nejsou připojeny.",
      "remove": "Odebrat",
      "save": "Uložit domény",
      "savedBody": "Přiřazení se projeví během několika sekund. Host odpovídá, až když jeho DNS a váš proxy server tuto instanci skutečně dosáhnou.",
      "savedTitle": "Uloženo",
      "stepDns": "Nasměrujte hosta na tento server ve svém DNS — stejný typ záznamu a cíl jako u adresy, přes kterou otevíráte tento přehled.",
      "stepProxy": "Dejte hostovi vlastní blok webu na reverzním proxy serveru, který beze změny předá hlavičku Host — a proxy poté znovu načtěte. Úprava konfiguračního souboru neovlivní už běžící proces.",
      "stepSignIn": "Personální plochy vyžadují nové přihlášení: cookies relace patří jedinému hostovi, takže přiřazený host vás nejdřív pošle na svou vlastní přihlašovací stránku.",
      "subtitle": "Nasměrujte DNS domény na svůj proxy server, předávejte hlavičku Host do Adminia a připojte ji zde — tento host pak obsluhuje plochu místo tohoto dashboardu. Certifikáty zůstávají na vašem proxy serveru.",
      "surfaceLabel": "Plocha",
      "title": "Domény"
    },
    "emptyBody": "Nasměrujte ADMINIUM_SURFACES_DIR na adresář sestavených ploch — složka pro každou aplikaci a stranu, každá se svým index.html — a restartujte. Poté se obsluhují pod /apps/ a objeví se zde.",
    "emptyTitle": "Žádné aplikační plochy se neobsluhují",
    "error": "Něco se pokazilo",
    "install": {
      "steps": {
        "bundle": "Balíček",
        "database": "Databáze",
        "plan": "Plán schématu",
        "done": "Hotovo"
      },
      "progress": "Průběh instalace",
      "failed": "Instalace selhala",
      "bundle": {
        "title": "Nahrát balíček aplikace",
        "hint": "Soubor vydání aplikace (.tgz) — obsahuje manifest.json a složku staff/ nebo customer/.",
        "file": "Soubor balíčku (.tgz)",
        "fileHint": "Dokud nepotvrdíte krok s plánem schématu, nic se nevytvoří.",
        "integrity": "Kontrolní součet (volitelné)",
        "integrityHint": "Vložte kontrolní součet sha512- zveřejněný s vydáním, aby server ověřil právě tyto bajty. Necháte-li pole prázdné, spočítá se zde."
      },
      "database": {
        "title": "Do které databáze instalovat?",
        "hint": "Vyberte zapisovatelné připojení. Tam se vytvoří tabulky a odtud aplikace následně čte.",
        "tables": "Tabulky: {count}",
        "readOnly": "Jen pro čtení",
        "writable": "Zapisovatelné",
        "noWritable": "Žádné zapisovatelné připojení",
        "allReadOnly": "Všechna zdejší připojení používají roli jen pro čtení, takže žádná aplikace nemůže vytvořit své tabulky. Připojte nejdřív takové, které smí spouštět DDL."
      },
      "plan": {
        "title": "Zkontrolujte plán schématu",
        "hint": "Přesně to, co se ve vaší databázi vytvoří. Zatím se nic nezapsalo.",
        "refused": "Tuto aplikaci sem nelze nainstalovat",
        "create": "Vytvořit",
        "reuse": "Použít stávající",
        "toggleDdl": "Zobrazit náhled DDL",
        "ddl": "Náhled DDL",
        "ddlNote": "Orientační. Server vytvoří přesný příkaz pro váš stroj včetně cizích klíčů.",
        "summary": "{created} vytvořeno · {reused} znovu použito",
        "ruleWarnings": "Některá pravidla této aplikace by ukázala, co vaše tabulka skrývá, a proto se vynechají",
        "pageWarnings": "Některé stránky této aplikace dorazí bez tabulky",
        "installedElsewhere": "Aplikace {app} je už nainstalovaná na připojení {connection}. Aplikace běží na jednom připojení: aktualizujte ji tam, nebo ji tam odinstalujte, než ji nainstalujete na jiné."
      },
      "done": {
        "body": "{key} se už servíruje. Níže vyberte, kde se má objevit její část pro personál.",
        "titleApp": "{app} je nainstalována",
        "tablesCreated": "Tabulky vytvořené v {connection}",
        "tablesKept": "Tabulky použité tak, jak byly",
        "pages": "Vygenerované stránky",
        "sampleNotAdded": "nepřidána",
        "sampleAdding": "přidávají se…",
        "sampleAdded": "přidána",
        "sampleLater": "Můžete je přidat později na stránce aplikace."
      },
      "cancel": "Zrušit",
      "back": "Zpět",
      "upload": "Nahrát",
      "continue": "Pokračovat",
      "confirm": "Nainstalovat",
      "finish": "Spravovat aplikace",
      "staged": "Rozbalené soubory: {files}",
      "footerStep": "Krok {n} z {total}",
      "footerStepApp": "Krok {n} z {total} · {app}",
      "chosen": {
        "title": "Nainstalovat {app}",
        "hint": "Tato aplikace přišla s vaším buildem a už je na disku. Dokud nepotvrdíte plán schématu, nic se nevytvoří."
      },
      "downloaded": {
        "hint": "Staženo z online katalogu aplikací a ověřeno podle zveřejněného otisku. Dokud nepotvrdíte plán schématu, nic se nevytvoří."
      },
      "uploaded": {
        "hint": "Načteno ze souboru manifest.json v balíčku, který jste nahráli. Dokud nepotvrdíte plán schématu, nic se nevytvoří.",
        "replace": "Nahrát jiný balíček"
      },
      "check": {
        "title": "Zkontrolujte tabulky",
        "hint": "{app} je vytvoří v {connection}. Dokud nestisknete Instalovat, nic se nezmění.",
        "summaryNew": "Nové: {count}",
        "summaryEarlier": "Z vaší dřívější instalace: {count}",
        "summaryShared": "Sdílené s jinou aplikací: {count}",
        "summaryTaken": "{count, plural, one {# obsazený název} few {# obsazené názvy} many {# obsazeného názvu} other {# obsazených názvů}}",
        "altPrefixInUse": "Zkontrolováno s předponou {prefix}.",
        "usualPrefix": "Použít obvyklou předponu",
        "badgeNew": "Nová",
        "badgeEarlier": "Vaše z dřívější instalace",
        "badgeShared": "Sdílená s {app}",
        "badgeTaken": "Název obsazen",
        "columns": "{count, plural, one {# sloupec} few {# sloupce} many {# sloupce} other {# sloupců}}",
        "keep": "Použít ji a ponechat její data",
        "sharedNote": "Tuto tabulku používá i {app}. Obě aplikace dál čtou a zapisují stejné řádky.",
        "earlierNote": "Adminium tuto tabulku vytvořil při dřívější instalaci {app}.",
        "createPreview": "Náhled vytvoření",
        "addsColumns": "{count, plural, one {Přidá # sloupec:} few {Přidá # sloupce:} many {Přidá # sloupce:} other {Přidá # sloupců:}}",
        "widens": "Rozšíří {column} z {from} na {to}.",
        "setIdentity": "{column} čísluje nové řádky sám.",
        "enumValues": "{column} přijímá také {values}.",
        "addUnique": "{column} už nesmí obsahovat stejnou hodnotu dvakrát.",
        "addUniqueWith": "{column} už nesmí obsahovat stejnou hodnotu dvakrát pro jeden {with}.",
        "noLoss": "Žádný sloupec se neodstraní a žádná data se neztratí.",
        "reuseNote": "Aplikace čte a zapisuje řádky, které tam už jsou.",
        "renameTitle": "Přejmenovat stávající tabulku, aby uvolnila místo",
        "renameNote": "Pro aplikaci se vytvoří nová {table}.",
        "renameField": "Nový název stávající tabulky",
        "renameFieldNote": "Adminium opraví své vlastní stránky a pravidla, která odkazovala na starý název.",
        "prefixTitle": "Použít pro tuto aplikaci jinou předponu",
        "prefixNote": "Platí pro všechny tabulky aplikace najednou.",
        "prefixField": "Předpona",
        "prefixFieldNote": "{count, plural, one {Tabulka bude znovu zkontrolována.} few {Všechny # tabulky budou znovu zkontrolovány.} many {Všech # tabulky bude znovu zkontrolováno.} other {Všech # tabulek bude znovu zkontrolováno.}}",
        "takenIntro": "{table} už existuje a byla vytvořena ručně. Vyberte, co s ní udělat.",
        "takenIntroShort": "Co udělat s {table}",
        "pickFirst": "Před instalací vyberte, co udělat s {table}.",
        "checkFirst": "Před instalací tabulky zkontrolujte znovu.",
        "nothingYet": "Dokud nestisknete Instalovat, nic se nezmění.",
        "again": "Zkontrolovat znovu",
        "adoptedNote": "Dřívější instalace {app} použila tuto tabulku tak, jak ji našla."
      },
      "running": {
        "title": "Instaluje se {app}",
        "hint": "Zapisuje se do {connection}.",
        "tables": "Tabulky",
        "pages": "Stránky"
      },
      "stopped": {
        "failed": "selhalo",
        "notStarted": "nezahájeno",
        "atTables": "Vytvoření tabulek selhalo, takže nic dalšího neproběhlo.",
        "atIntrospect": "Tabulky byly vytvořeny. Jejich zpětné načtení selhalo, takže nic dalšího neproběhlo.",
        "atPages": "Tabulky byly vytvořeny. Vytvoření stránek selhalo, takže nic dalšího neproběhlo.",
        "atFinish": "Tabulky i stránky byly vytvořeny. Dokončení instalace selhalo.",
        "title": "Instalace se zastavila v půlce",
        "created": "Vytvořeno: {count}",
        "made": "vytvořeno",
        "said": "Co odpověděla databáze",
        "saidAbout": "Co databáze odpověděla k {table}",
        "resume": "Nic nebylo odstraněno. Nový pokus pokračuje tam, kde se zastavila.",
        "retry": "Zkusit znovu",
        "back": "Zpět na plán schématu"
      }
    },
    "installed": {
      "title": "Nainstalované aplikace",
      "install": "Nainstalovat aplikaci",
      "emptyTitle": "Zatím není nainstalována žádná aplikace",
      "emptyBody": "Nahrajte sestavený balíček rozhraní a nainstalujte ji. Aplikace nainstalované zde se servírují okamžitě — bez restartu, na rozdíl od adresáře.",
      "uninstall": "Odinstalovat",
      "stagedTitle": "Nahráno, ale nenainstalováno",
      "stagedHint": "Zahoďte ten, který jste zavrhli, nebo nahrajte stejný klíč znovu a nahraďte jej.",
      "discard": "Zahodit",
      "installedAt": "nainstalováno {when}",
      "updatesAvailable": "{count, plural, one {# dostupná aktualizace} few {# dostupné aktualizace} many {# dostupné aktualizace} other {# dostupných aktualizací}}",
      "updateTo": "Aktualizovat na v{version}",
      "needsNewer": "v{version} vyžaduje Adminium {minimum} nebo novější",
      "cannotUpdate": "v{version} nemůže tuto verzi aktualizovat na místě. Nejprve ji odinstalujte a poté nainstalujte v{version}.",
      "missing": "Chybí",
      "missingBody": "Její soubory na tomto serveru nejsou, takže se neservíruje. Nainstalujte stejnou verzi znovu, nebo ji odinstalujte.",
      "update": "Aktualizovat",
      "discardFailed": "Nahraný soubor nebyl zahozen",
      "renamed": "Tabulky přejmenovány na {prefix}…",
      "oldNames": "Tato instalace používá staré názvy tabulek.",
      "oldNamesWhy": "Vznikly před zavedením předpon.",
      "renameTo": "Přejmenovat na {prefix}…"
    },
    "instances": {
      "add": "Přidat instanci",
      "appLabel": "Aplikace",
      "body": "Poskytujte stejnou aplikaci nad více databázemi. Každá instance je dostupná na /apps/<app>/<segment>/<side>/ a čte jen připojení, které jí dáte.",
      "empty": "Žádné další instance.",
      "failed": "Instance se nepodařilo uložit",
      "readsLabel": "Čte",
      "remove": "Odebrat",
      "save": "Uložit instance",
      "slugLabel": "Segment URL",
      "title": "Instance"
    },
    "job": {
      "refreshTitle": "Kontrola online katalogu aplikací",
      "downloadTitle": "Stahuje se {app}",
      "body": "Stahování a ověřování. Nic se nenainstaluje ani nezmění, dokud to neschválíte.",
      "failed": "Úloha nebyla dokončena. Nic se nenainstalovalo ani nezměnilo."
    },
    "names": {
      "label": "Název pro {app}",
      "save": "Uložit název",
      "subtitle": "Jak se která aplikace jmenuje — na svých vlastních obrazovkách i v postranním panelu tohoto přehledu. Nechte prázdné, chcete-li použít název, se kterým byla aplikace sestavena.",
      "title": "Názvy aplikací"
    },
    "subtitle": "Aplikační plochy, které tato instance obsluhuje — kde se každá zobrazuje a které domény na ně míří.",
    "surfaces": {
      "boundKey": "Obsluhuje klíč",
      "connectionLabel": "Čte",
      "connectionUnset": "Kterékoli aktivní",
      "customer": "Zákazník",
      "mintLink": "Vytvořit ve Veřejném API",
      "noKey": "Není navázán žádný klíč — dokud se pro tuto plochu nevytvoří, nemůže číst data.",
      "noNav": "Interní umístění není dostupné — sestavte tuto plochu znovu aktuálním toolkitem, aby vydávala surface.json.",
      "placementExternal": "Externí (jen vlastní URL)",
      "placementInternal": "V bočním panelu (vsazená)",
      "placementLabel": "Umístění",
      "staff": "Tým",
      "subtitle": "Plocha pro tým se může vsadit do bočního panelu tohoto dashboardu, nebo stát samostatně; zákaznická plocha je veřejná a čte přes svůj navázaný klíč.",
      "title": "Plochy"
    },
    "title": "Hostované aplikace",
    "update": {
      "title": "Aktualizovat {app} na v{version}",
      "subtitle": "Tato verze potřebuje tabulky, které nainstalovaná verze neměla.",
      "body": "Vytvoří se v databázi, kterou tato aplikace už používá. Existující tabulky se nemění.",
      "cancel": "Zrušit",
      "confirm": "Aktualizovat",
      "close": "Zavřít",
      "done": "{app} aktualizováno na v{version}",
      "missingColumns": "Chybí: {tables}.",
      "accessSubtitle": "Zkontrolujte, co tato verze umožní zákazníkům aplikace.",
      "checkSubtitle": "Zkontrolujte tabulky, které tato verze používá.",
      "pickFirst": "Před aktualizací vyberte, co udělat s {table}.",
      "checkFirst": "Před aktualizací tabulky zkontrolujte znovu.",
      "nothingYet": "Dokud nestisknete Aktualizovat, nic se nezmění."
    },
    "veto": {
      "title": "Toto nasazení nemůže procházet online",
      "body": "Nastavení je uložené, ale síťové funkce jsou na tomto serveru vypnuté a to má přednost. Nainstalované aplikace dál fungují a stále můžete aplikaci nahrát sami."
    },
    "columns": {
      "title": "Aktualizovat {app} na v{version}",
      "subtitle": "Tato verze potřebuje sloupce, které tabulky ve vaší databázi zatím nemají.",
      "body": "Adminium je může přidat za vás. Než se cokoli spustí, uvidíte přesný příkaz, nic se neodstraní a aplikace se aktualizuje až poté, co sloupce existují.",
      "alsoCreates": "Aktualizace také vytvoří tyto tabulky:",
      "noDdl": "Adminium zde tyto sloupce nemůže přidat",
      "failed": "Sloupce se nepodařilo přidat",
      "valuesFailed": "Sloupce byly přidány, ale jejich povolené hodnoty se nepodařilo uložit",
      "confirm": "Přidat sloupce a aktualizovat"
    },
    "rename": {
      "title": "Přejmenovat tabulky na {prefix}…",
      "subtitle": "{count, plural, one {# tabulka v {connection}} few {# tabulky v {connection}} many {# tabulky v {connection}} other {# tabulek v {connection}}}",
      "close": "Zavřít",
      "body": "Tato instalace vznikla před zavedením předpon. Přejmenování dá každé tabulce předponu aplikace, aby {app} poznala své vlastní tabulky.",
      "planFailed": "Přejmenování se nepodařilo naplánovat",
      "refused": "Tyto tabulky zde nelze přejmenovat",
      "failed": "Tabulky nebyly přejmenovány",
      "repair": "Adminium také aktualizuje své vlastní stránky a pravidla, která odkazují na staré názvy.",
      "cancel": "Zrušit",
      "confirm": "Přejmenovat tabulky"
    }
  },
  "hub": {
    "action": {
      "delete": "Smazat",
      "pause": "Pozastavit",
      "pausedHint": "Toto připojení je pozastavené – obnovte ho, abyste se dostali k databázi.",
      "regional": "Místní nastavení",
      "reintrospect": "Znovu introspektovat",
      "reintrospectFile": "Zdroje ze souboru se schématem nemají živou databázi — nahrajte soubor znovu.",
      "remap": "Přemapovat schéma",
      "rename": "Přejmenovat",
      "resume": "Obnovit",
      "test": "Otestovat"
    },
    "card": {
      "lastIntrospected": "Poslední introspekce",
      "latency": "Latence",
      "latencyMs": "{latency, number} ms",
      "never": "Nikdy",
      "pages": "Stránky",
      "paused": "Adminium se k této databázi nepřipojuje. Její stránky se znovu načtou, jakmile ji obnovíte.",
      "pausedSince": "Pozastaveno {when} – Adminium se k této databázi nepřipojuje. Její stránky se znovu načtou, jakmile ji obnovíte.",
      "readOnly": "Jen pro čtení",
      "tables": "Tabulky",
      "timezone": "Časové pásmo",
      "timezoneGuessed": "z tohoto serveru",
      "timezoneNone": "nenastaveno — data se zobrazují v {zone}, což je pásmo tohoto serveru"
    },
    "connectNew": "Nové připojení",
    "delete": {
      "body": "Tímto smažete „{name}“ a z něj vygenerované stránky. Vaší databáze se to nijak nedotkne.",
      "cancel": "Zrušit",
      "close": "Zavřít",
      "confirm": "Smazat připojení",
      "failed": "Připojení se nepodařilo smazat. Zkuste to znovu.",
      "prompt": "Potvrďte zadáním {name}",
      "success": "Připojení „{name}“ smazáno",
      "title": "Smazat připojení",
      "forbidden": "Vaše role nezahrnuje správu připojení, proto toto připojení nebylo smazáno.",
      "liveKeys": {
        "body": "Stránky postavené na těchto klíčích by přestaly fungovat. Nejprve je zrušte na stránce Veřejné API a potom připojení smažte.",
        "title": "Toto připojení stále používají publikovatelné klíče"
      }
    },
    "empty": {
      "body": "Připojte databázi a Adminium z jejího schématu vygeneruje váš administrační panel.",
      "cta": "Připojit databázi",
      "title": "Zatím žádné zdroje dat"
    },
    "hostedApps": "Hostované aplikace",
    "introspect": {
      "failed": "Introspekce selhala. Zkuste to znovu.",
      "masksProposed": "{count, plural, one {# sloupec navržen} few {# sloupce navrženy} other {# sloupců navrženo}} k maskování — zkontrolujte v editoru přemapování.",
      "noChanges": "Schéma beze změn — žádný nový snímek.",
      "updated": "Schéma znovu introspektováno"
    },
    "pause": {
      "body": "Adminium přestane otevírat jakékoli připojení k „{name}“. {pages, plural, one {# stránka} few {# stránky} many {# stránky} other {# stránek}}, naplánované reporty a hostované aplikace přestanou načítat data, dokud připojení neobnovíte.",
      "confirm": "Pozastavit připojení",
      "keeps": "Nic se nemaže – připojení, jeho schéma i {pages, plural, one {jeho # stránka} few {jeho # stránky} many {jeho # stránky} other {jeho # stránek}} zůstávají zachovány a jedním kliknutím je vrátíte zpět.",
      "pauseFailed": "Připojení se nepodařilo pozastavit. Zkuste to znovu.",
      "pausedToast": "Připojení „{name}“ pozastaveno",
      "resumeFailed": "Připojení se nepodařilo obnovit. Zkuste to znovu.",
      "resumedToast": "Připojení „{name}“ obnoveno",
      "title": "Pozastavit toto připojení?"
    },
    "regional": {
      "currency": "Měna",
      "currencyHelper": "Slouží k formátování částek. Nepovinné — bez ní se změní jen formátování.",
      "currencyPlaceholder": "Kód ISO-4217",
      "failed": "Místní nastavení se nepodařilo uložit",
      "guessedBody": "Adminium je převzalo ze stroje, na kterém běží — nikdo je zde nezvolil. Uložením ho potvrdíte, nebo vyberte pásmo, ve kterém firma skutečně pracuje.",
      "guessedTitle": "Toto pásmo pochází ze serveru",
      "intro": "Popisují firmu, které tato databáze patří, nikoli toho, kdo ji čte. Aplikace servírované Adminiem je čtou odsud.",
      "noMatch": "Žádné odpovídající pásmo",
      "noMatchCurrency": "Žádná odpovídající měna",
      "notSet": "Nenastaveno",
      "save": "Uložit",
      "saved": "Místní nastavení bylo aktualizováno",
      "timezone": "Časové pásmo",
      "timezoneHelper": "Datum a čas se zobrazují v tomto pásmu. Bez něj aplikace hostované Adminiem přejdou na UTC a napíší to na obrazovku.",
      "timezonePlaceholder": "Oblast/Město",
      "title": "Místní nastavení"
    },
    "rename": {
      "failed": "Připojení se nepodařilo přejmenovat",
      "helper": "Jak se tato databáze jmenuje v celém Adminiu — karta, skupina v postranním panelu nad jejími stránkami a každý výběr, který ji nabízí. Samotná databáze se nepřejmenuje.",
      "label": "Název",
      "save": "Přejmenovat",
      "saved": "Připojení přejmenováno",
      "title": "Přejmenovat připojení"
    },
    "stats": {
      "connections": "Připojení",
      "healthy": "V pořádku",
      "pages": "Vygenerované stránky",
      "tables": "Zahrnuté tabulky"
    },
    "status": {
      "connected": "Připojeno",
      "error": "Chyba",
      "paused": "Pozastaveno",
      "testing": "Testuje se…",
      "unconfigured": "Koncept"
    },
    "subtitle": "{healthy, number} z {total, plural, one {# připojení} few {# připojení} other {# připojení}} v pořádku",
    "subtitlePaused": "{healthy, number} z {total, plural, one {# připojení} few {# připojení} other {# připojení}} v pořádku · {paused, number} pozastaveno",
    "test": {
      "failed": "Test připojení selhal",
      "ok": "Připojení v pořádku · {latency, number} ms"
    },
    "title": "Datová připojení"
  },
  "intent": {
    "analytics": {
      "description": "Nástěnky, grafy a mřížky jen pro čtení. Žádné formuláře, žádné zápisy — každá role omezena na Prohlížejícího.",
      "title": "Analytika jen pro čtení"
    },
    "crud": {
      "description": "Jedna editační stránka na tabulku plus vyhledávání a import/export — minimální domov, žádné nástěnky.",
      "title": "CRUD tabulky"
    },
    "fullAdmin": {
      "description": "Nástěnky, CRUD stránky, vyhledávání, importy a exporty — vše, co vaše schéma podporuje.",
      "title": "Kompletní administrace"
    },
    "subtitle": "Záměr určuje, které stránky se vygenerují. Později ho můžete změnit — změna navrhne regeneraci, nikdy tiché přepsání.",
    "support": {
      "description": "Nejprve fronty, stránky tiketů a detailů zákazníků. Mazání ve výchozím stavu vypnuto. (Šablony front přijdou v M7 — sada stránek v1 odpovídá kompletní administraci.)",
      "title": "Konzole podpory"
    },
    "title": "Co potřebujete?",
    "trust": "Čteme pouze vaše schéma — během nastavení nikdy vaše řádková data.",
    "blank": {
      "description": "Negenerovat nic. Připojte databázi a stavte stránky, které chcete, jednu po druhé.",
      "title": "Prázdné plátno"
    }
  },
  "llmRuns": {
    "review": {
      "applied": {
        "body": "Přijaté návrhy níže jsou pouze ke čtení.",
        "title": "Tento běh byl použit"
      },
      "apply": {
        "confirm": "Použít změny",
        "empty": "Není vybráno nic k použití.",
        "subtitle": "Tyto změny se zapíší v jedné transakci a lze je vrátit zpět.",
        "title": "Použít {n} návrhů"
      },
      "applyFailed": "Nic nebylo použito",
      "applyUnknown": "Server neuvedl proč.",
      "bulk": {
        "acceptAll": "Přijmout vše ≥ {pct}%",
        "clear": "Zrušit výběr",
        "thresholdAria": "Práh spolehlivosti pro „Přijmout vše“",
        "thresholdLabel": "Práh spolehlivosti"
      },
      "cat": {
        "copy": "mikrotext",
        "dashboard": "nástěnka",
        "enum": "výčet",
        "group": "navigační skupina",
        "key": "klíčové sloupce",
        "label": "popisek",
        "pii": "osobní údaje",
        "relation": "vztah",
        "template": "šablona stránky",
        "widget": "widget"
      },
      "empty": {
        "body": "Tento běh nevytvořil žádné návrhy ke kontrole.",
        "title": "Žádné návrhy"
      },
      "error": {
        "title": "Tento běh se nepodařilo načíst"
      },
      "footer": {
        "apply": "Použít {n} přijatých návrhů",
        "count": "Vybráno {n} návrhů",
        "failed": "Použití selhalo"
      },
      "group": {
        "dashboards": "Nástěnky a widgety",
        "enums": "Sémantika výčtů",
        "icons": "Ikony",
        "keys": "Klíčové sloupce",
        "labels": "Popisky a překlady",
        "microcopy": "Mikrotexty",
        "navigation": "Navigace a domény",
        "pii": "Osobní údaje a maskování",
        "relations": "Vztahy",
        "templates": "Šablony stránek"
      },
      "header": {
        "agree": "{n} shodných",
        "byo": "BYO",
        "conflict": "{n} konfliktů",
        "countsAria": "Počty návrhů",
        "model": "Model",
        "new": "{n} nových",
        "pathByo": "Kopírovat a vložit",
        "pathDirect": "Přímé API",
        "rejects": "{n} zamítnutí",
        "snapshot": "Snímek",
        "title": "Zkontrolovat návrhy AI"
      },
      "notReady": {
        "body": "Běh musí být ověřen, než bude možné jeho návrhy zkontrolovat. Nejprve vygenerujte nebo vložte odpověď.",
        "title": "Tento běh zatím nemá návrhy ke kontrole"
      },
      "row": {
        "acceptAria": "Přijmout návrh {noun} pro {target}",
        "confidenceAria": "Spolehlivost {pct}%",
        "hideTranslations": "Skrýt překlady",
        "keptEdited": "ponecháno – upraveno vámi",
        "noAi": "Žádný návrh AI",
        "rejectsCallout": "AI zamítá heuristické rozhodnutí – před přijetím potvrďte.",
        "showTranslations": "Zobrazit překlady"
      },
      "section": {
        "acceptedCount": "{n} přijato",
        "selectAllAria": "Vybrat vše v {group}"
      },
      "status": {
        "agree": "Souhlasí",
        "conflict": "Konflikt",
        "heuristicOnly": "Pouze heuristika",
        "locked": "Uzamčeno",
        "new": "Nový",
        "rejects": "Zamítá heuristiku"
      },
      "toast": {
        "applied": "Použito {n} návrhů",
        "appliedPartial": "Použito {n} návrhů (některé přeskočeny)",
        "applyFailed": "Návrhy se nepodařilo použít",
        "undoFailed": "Tuto změnu se nepodařilo vrátit zpět"
      },
      "value": {
        "absent": "Žádná",
        "dash": "—",
        "description": "Popis",
        "display": "Zobrazení",
        "enumCategory": "Kategorie",
        "enumWorkflow": "Pracovní postup",
        "guidance": "Pokyn prázdného stavu",
        "headline": "Nadpis prázdného stavu",
        "key": "Klíč",
        "label": "Popisek",
        "none": "Žádná hodnota",
        "notPii": "Nejsou osobní údaje",
        "rank": "pořadí {n}",
        "span": "šířka {n}",
        "subtitle": "Podtitul stránky",
        "tableCount": "{n} tabulek",
        "widgetCount": "{n} widgetů"
      }
    }
  },
  "meta": {
    "move": {
      "copying": "Přesouvání tabulek Adminia…",
      "copyingBody": "Kopírují se všechny tabulky adminium_ do nové databáze. Vašich zdrojových dat se to nedotkne a k přepnutí dojde až po ověření kopie.",
      "failed": "Tabulky Adminia se nepodařilo přesunout — zkuste to znovu.",
      "restarting": "Restartování…",
      "restartingBody": "Kopie je hotová. Adminium se restartuje na novou databázi — tato stránka bude za pár sekund pokračovat sama.",
      "timeout": "Adminium své tabulky přesunulo, ale zatím se nevrátilo. Vaše data jsou v nové databázi v bezpečí — za chvíli stránku načtěte znovu.",
      "title": "Přesouvání tabulek Adminia"
    },
    "sameDb": {
      "description": "Tabulky adminium_* se vytvoří vedle vašich zdrojových tabulek. Nejjednodušší nastavení — vyžaduje roli s právy zápisu a CREATE TABLE.",
      "disabledFile": "Soubor schématu nemá živou databázi — zvolte pro vlastní tabulky Adminia samostatnou databázi.",
      "disabledNoDdl": "Tato role nemůže spouštět DDL — migrace Adminia vyžadují CREATE TABLE. Zvolte pro vlastní tabulky Adminia samostatnou databázi.",
      "disabledReadOnly": "Vaše role je jen pro čtení — Adminium do této databáze nikdy nezapisuje. Zvolte pro vlastní tabulky Adminia samostatnou databázi.",
      "title": "Stejná databáze"
    },
    "separate": {
      "description": "Adminium drží své tabulky v jiné databázi. Váš zdroj zůstává nedotčen — vyžadováno pro zdroje jen pro čtení.",
      "dsn": "Připojovací řetězec meta databáze",
      "errorTitle": "Meta úložiště není kompatibilní",
      "helper": "Vyžaduje práva zápisu + DDL — Adminium tam spouští vlastní migrace.",
      "insufficient": "Tato role nemůže hostit meta úložiště — Adminium tam potřebuje práva zápisu a CREATE TABLE.",
      "ok": "Kompatibilní — zápis ✓ · DDL ✓",
      "test": "Otestovat připojení",
      "title": "Samostatná databáze"
    },
    "subtitle": "Stránky, role, auditní log a nastavení žijí v tabulkách s předponou adminium_ — nikdy se nemíchají s vašimi daty.",
    "testFailed": "Připojení se nezdařilo.",
    "title": "Kde má Adminium uchovávat své vlastní tabulky?",
    "v1Note": {
      "body": "Tento server už drží své vlastní tabulky v nakonfigurované databázi a tento krok je nepřesouvá. Ověřuje, že je vaše volba kompatibilní s tímto připojením — server vynucuje stejné pravidlo nezávisle (409 META_PLACEMENT_INVALID).",
      "title": "O této instalaci"
    },
    "willMove": {
      "body": "Adminium nyní používá vestavěné úložiště SQLite. Tlačítko Pokračovat zkopíruje toto úložiště do zvolené databáze a restartuje se na ni — účty, stránky i nastavení jdou s ním, takže zůstanete přihlášeni.",
      "title": "Tento krok přesune tabulky Adminia"
    }
  },
  "pages": {
    "action": {
      "delete": "Smazat stránku",
      "duplicate": "Duplikovat",
      "edit": "Upravit stránku",
      "hide": "Skrýt z postranního panelu",
      "show": "Zobrazit v postranním panelu"
    },
    "attachments": {
      "accept": "Povolené typy souborů",
      "acceptHint": "Když nevyberete žádný, přijme se vše, co tento workspace povoluje. Volba zde může seznam jen zúžit, nikdy rozšířit.",
      "column": {
        "adoptHint": "Tato tabulka už tento sloupec má, takže se nic nevytváří — použije se tak, jak je.",
        "bound": "Soubory jsou uloženy ve sloupci {column} této tabulky.",
        "boundHint": "Pozdější vypnutí příloh odpojí jen tuto stránku. Sloupec a soubory v něm zůstanou nedotčené.",
        "confirm": "Spustit",
        "create": "Vytvořit sloupec",
        "createHint": "Adminium přidá do této tabulky jeden textový sloupec. Přesný příkaz uvidíte dřív, než se cokoli spustí.",
        "createdHint": "Sloupec teď existuje. Uložte tuto stránku a propojení bude hotové.",
        "failed": "Tohle nevyšlo",
        "invalid": "Název sloupce musí začínat písmenem a smí obsahovat jen malá písmena, číslice a podtržítka.",
        "label": "Sloupec, který obsahuje soubory",
        "required": "Pojmenujte sloupec.",
        "tooLong": "Tento název je pro sloupec příliš dlouhý.",
        "use": "Použít tento sloupec",
        "wrongType": "Tato tabulka už sloupec s tímto názvem má a nemůže obsahovat odkaz na soubor. Zvolte jiný název."
      },
      "destination": "Kam soubory míří",
      "destinationDefault": "Výchozí cíl úložiště",
      "destinationHint": "Ponechte výchozí, pokud soubory této tabulky nepatří jinam.",
      "destinationIsDefault": "{name} (výchozí)",
      "destinationLocal": "Disk tohoto serveru",
      "enable": "Povolit přílohy u záznamů této tabulky",
      "enableHint": "Soubory se propojují na straně Adminia, takže tato tabulka nepotřebuje nový sloupec — funguje to i na připojení jen pro čtení a na tabulce, kterou raději neměníte.",
      "enableHintColumn": "Soubory se ukládají do jednoho sloupce této tabulky, takže se objeví v dialozích Nový a Upravit i u každého záznamu.",
      "enableHintSidecar": "Soubory se místo toho propojí na straně Adminia. Objeví se na stránce každého záznamu, ne v dialogu Nový.",
      "maxBytes": "Největší soubor (MB)",
      "maxBytesHint": "Nechte prázdné a bude se řídit limitem workspace. Číslo zde ho může jen snížit.",
      "maxCount": "Nejvíc souborů na záznam",
      "maxCountHint": "Nechte prázdné a přijme se jich tolik, kolik záznam potřebuje.",
      "sidecar": {
        "noPrivilege": "Role tohoto připojení nemůže měnit tabulky, takže do něj Adminium nemůže přidat sloupec.",
        "readOnlyIntent": "Toto připojení je nastavené jen pro čtení a analýzu, takže do něj Adminium nemůže přidat sloupec.",
        "readOnlyRole": "Toto připojení se přihlašuje rolí jen pro čtení, takže do něj Adminium nemůže přidat sloupec.",
        "schemaFile": "Toto připojení vzniklo ze souboru se schématem, takže do něj Adminium nemůže přidat sloupec."
      },
      "type": {
        "office": "Dokumenty Office",
        "text": "Prostý text"
      }
    },
    "columns": {
      "addFromLinked": "Z propojených tabulek",
      "addFromTable": "Z tabulky {table}",
      "addLinkedFrom": "Tabulky, které sem odkazují",
      "addLinkedFromHelp": "Spočítejte řádky odkazující na každý záznam nebo sečtěte jedno z jejich čísel.",
      "addLinkedHelp": "Zobrazí hodnotu z tabulky, na kterou odkazuje propojovací sloupec.",
      "addNoMatches": "Dotazu „{query}“ neodpovídají žádné sloupce.",
      "addOpen": "Přidat sloupec",
      "addSearch": "Hledat sloupce…",
      "addTitle": "Přidat sloupec",
      "addVia": "přes {column}",
      "avatar": "Avatar",
      "avatarToggle": "Zobrazit monogram vedle {name}",
      "countBadge": "Počet",
      "dragHandle": "Přesunout {name}",
      "empty": "Zatím žádné sloupce — přidejte je níže.",
      "file": {
        "acceptHelp": "Nechte všechny typy vypnuté a sloupec přijme vše, co přijímá tento workspace. Výběrem typů lze seznam jen zúžit — sloupec nikdy nepřijme typ, který workspace odmítá.",
        "acceptLabel": "Povolené typy",
        "badge": "Soubor",
        "destinationDefault": "Výchozí cíl úložiště",
        "destinationHelp": "Kam se ukládají data nahraná přes tento sloupec.",
        "destinationLabel": "Cíl úložiště",
        "inlineHelp": "V buňce se vykreslí jen obrázky. Vše ostatní zůstane štítkem s názvem a velikostí, ať je toto nastaveno jakkoli.",
        "inlineLabel": "Zobrazit v tabulce",
        "maxCountHelp": "Nechte prázdné, aby se přijalo tolik souborů, kolik záznam potřebuje.",
        "maxCountLabel": "Nejvíce souborů na záznam",
        "maxCountToggle": "Nejvíce souborů pro {name}",
        "maxHelp": "Nechte prázdné a použije se limit workspace. Sloupec může chtít jen méně.",
        "maxLabel": "Největší soubor (MB)",
        "maxToggle": "Největší soubor, který {name} přijme, v MB",
        "multipleHelp": "Sloupec ukládá seznam souborů místo jednoho. Stávající jednotlivé hodnoty fungují dál — čtou se jako seznam s jednou položkou.",
        "multipleLabel": "Pojmout více souborů",
        "ref": {
          "id": "ID souboru v Adminiu",
          "key": "Klíč v cíli úložiště",
          "url": "Odkaz na soubor"
        },
        "refHelp": "Co se do tohoto sloupce zapíše při nahrání souboru. Už uložené hodnoty fungují dál — mění se jen ta příští.",
        "refLabel": "Uložená hodnota",
        "refTooNarrow": "Tento sloupec je příliš krátký, než aby takovou hodnotu pojal. Vyberte takovou, kterou pojme, nebo sloupec v databázi rozšiřte.",
        "refWidth": "{shape} — potřebuje {needs} znaků, tento sloupec pojme {holds}",
        "switch": "Soubor",
        "switchToggle": "{name} ukládá soubor",
        "type": {
          "csv": "CSV",
          "gif": "GIF",
          "heic": "HEIC",
          "jpeg": "JPEG",
          "json": "JSON",
          "markdown": "Markdown",
          "mp3": "Zvuk MP3",
          "mp4": "Video MP4",
          "office": "Dokumenty Office",
          "ogg": "Ogg",
          "pdf": "PDF",
          "png": "PNG",
          "svg": "SVG",
          "text": "Prostý text",
          "wav": "Zvuk WAV",
          "webm": "WebM",
          "webp": "WebP",
          "zip": "ZIP"
        }
      },
      "fold": {
        "avg": "Průměr",
        "max": "Max",
        "min": "Min",
        "sum": "Součet"
      },
      "foldAdd": "Přidat",
      "foldLabel": "Agregace",
      "followColumn": "Sledovat {name}",
      "header": "Záhlaví pro {name}",
      "help": "Přetažením změňte pořadí sloupců, přejmenujte jejich záhlaví a vyberte, které se v tabulce zobrazí.",
      "lookupBack": "Zpět",
      "lookupBadge": "Propojený",
      "lookupBroken": "Toto propojení už nelze vyhodnotit",
      "lookupBrokenBody": "Schéma se mezitím změnilo. Začněte propojení znovu.",
      "lookupBrowse": "Vyberte, co zobrazit z tabulky {table}",
      "mask": "Maskovat",
      "maskHelp": "Maskování skryje hodnotu za tlačítko pro zobrazení těm, kdo ji smí vidět. To, zda data vůbec opustí databázi, se nastavuje u připojení, ne zde.",
      "maskToggle": "Skrýt {name} za tlačítko pro zobrazení",
      "masked": "Maskováno",
      "none": {
        "body": "Sloupce se při generování stránky načtou z tabulky. Připojte tuto stránku k tabulce a vygenerujte ji znovu.",
        "title": "Tato stránka zatím nemá sloupce"
      },
      "pk": "Klíč",
      "remove": "Odebrat {name}",
      "schemaUnavailable": "Sloupce databáze se nepodařilo načíst, takže zde nelze sloupce přidat.",
      "shown": "Zobrazeno",
      "toggle": "Zobrazit {name} v tabulce"
    },
    "create": {
      "failed": "Stránku se nepodařilo vytvořit",
      "submit": "Vytvořit stránku",
      "subtitle": "Vyberte, co stránka zobrazuje a jak vypadá. Náhled sleduje vaše volby.",
      "title": "Nová stránka"
    },
    "createButton": "Nová stránka",
    "delete": {
      "body": "Tuto akci nelze vrátit zpět. Uložená zobrazení i osobní rozvržení této stránky budou smazána všem.",
      "bodyGenerated": "Tato stránka vznikla generováním ze schématu, takže se při dalším generování vrátí. Uložená zobrazení a osobní rozvržení budou smazána všem.",
      "confirm": "Smazat stránku",
      "prompt": "Pro potvrzení napište {slug}",
      "title": "Smazat tuto stránku?",
      "failed": "Stránka nebyla smazána"
    },
    "derived": {
      "add": "Přidat sloupec",
      "atLeast": "je alespoň",
      "cancel": "Zrušit",
      "emptyBody": "Nejdřív shrňte propojenou tabulku v kartě Sloupce — pravidla zde se staví z těchto čísel.",
      "emptyTitle": "Zatím žádná vypočtená čísla",
      "fieldBadge": "Vypočteno",
      "foldBadge": "Souhrn",
      "help": "Vypočítejte čísla ze souhrnů výše a z vlastních sloupců tohoto záznamu. Počítají se při načtení stránky a nelze je řadit.",
      "label": "Záhlaví sloupce",
      "minus": "minus",
      "numberHelp": "Čísla jsou prostá desetinná — 500 nebo 12.50, nikdy 1,000 nebo 5e3.",
      "operandA": "Číslo",
      "operandB": "Číslo",
      "operator": "Operátor",
      "otherwise": "jinak",
      "percentOf": "procent z tohoto záznamu",
      "plus": "plus",
      "preset": {
        "combine": "Sečíst nebo odečíst dvě čísla",
        "percent": "Procento z čísla",
        "rule": "Pravidlo s prahem"
      },
      "previewHelp": "Ukázkové hodnoty, spočítané stejným kódem, jaký používá stránka.",
      "previewTitle": "Náhled",
      "remove": "Odebrat {name}",
      "thenShow": "pak zobrazit"
    },
    "duplicate": {
      "failed": "Stránku se nepodařilo duplikovat",
      "submit": "Duplikovat",
      "title": "Duplikovat stránku"
    },
    "editor": {
      "appearance": "Vzhled",
      "attachments": "Přílohy",
      "columns": "Sloupce",
      "contentInvalid": "Konfiguraci této stránky nelze přečíst",
      "contentInvalidBody": "Pochází z novější verze, nebo je poškozená. Vygenerujte stránku znovu, nebo ji smažte.",
      "contentUnavailable": "Obsah stránky se nepodařilo načíst",
      "contentUnavailableBody": "Údaje výše lze i tak uložit.",
      "data": "Data",
      "derived": "Odvozená čísla",
      "details": "Podrobnosti",
      "generated": {
        "body": "Vaše změny při dalším generování zůstanou – stránka se označí jako upravená a nechá se být. Smazání ale vydrží jen do chvíle, než ji další generování znovu vytvoří.",
        "title": "Tato stránka byla vygenerována z vašeho schématu"
      },
      "itemsPending": "Nejprve uložte změnu výše – obsah stránky se znovu sestaví z nové šablony a tabulky.",
      "missing": "Tato stránka už neexistuje",
      "missingBody": "Mohla být smazána nebo odstraněna generováním.",
      "notBindable": "Tato šablona není vázaná na jednu tabulku",
      "notBindableBody": "Její obsah se skládá z widgetů. Otevřete stránku a přidejte je tlačítkem „Upravit“.",
      "openPage": "Otevřít stránku",
      "recompose": "Tato stránka bude znovu sestavena",
      "recomposeBody": "Uložení nahradí její obsah novým rozvržením pro šablonu a tabulku výše. Úpravy sloupců a widgetů na této stránce budou ztraceny.",
      "save": "Uložit změny",
      "saveFailed": "Změny se nepodařilo uložit",
      "schemaFailed": "Tabulky se nepodařilo načíst",
      "schemaFailedBody": "Toto připojení možná ještě nebylo analyzováno. Spusťte introspekci ve Studiu → Datová připojení.",
      "title": "Upravit stránku"
    },
    "empty": {
      "body": "Připojte databázi a stránky se vygenerují automaticky, nebo si jednu vytvořte ručně.",
      "title": "Zatím žádné stránky"
    },
    "field": {
      "connection": "Zdroj dat",
      "connectionNone": "Žádný",
      "group": "Skupina v panelu",
      "groupHint": "Ve které části postranního panelu se objeví.",
      "icon": "Ikona",
      "iconHint": "Zobrazuje se vedle názvu stránky v postranním panelu.",
      "iconPick": "Vyberte ikonu stránky",
      "newRowLabel": "Tlačítko pro přidání",
      "newRowLabelHint": "Co je napsáno na tlačítku, které přidává záznam. Ponechte prázdné pro výchozí popisek, který je přeložený.",
      "padding": "Okraje stránky",
      "slug": "Adresa stránky",
      "slugHint": "Malá písmena, číslice a pomlčky. Jen poslední část – zbytek adresy doplníme za vás.",
      "slugTaken": "Tuto adresu už používá jiná stránka.",
      "slugWarning": "Změna adresy rozbije stávající odkazy a záložky na tuto stránku.",
      "table": "Tabulka",
      "tableChoose": "Vyberte tabulku…",
      "tableCreateHint": "Tabulka, ze které stránka čte.",
      "tableNeedsConnection": "Nejprve vyberte zdroj dat.",
      "tableNoConnection": "Nejprve připojte databázi — tato stránka se sestavuje z jedné z jejích tabulek.",
      "tableNone": "Nepřipojeno",
      "template": "Šablona",
      "templateHint": "Určuje, co stránka může obsahovat. Lze změnit později.",
      "title": "Název",
      "titleHint": "Zobrazuje se v postranním panelu a v hlavičce stránky.",
      "visible": "Zobrazit v postranním panelu",
      "visibleHint": "Skrytá stránka zůstává dostupná na své URL každému, kdo má odkaz.",
      "width": "Šířka obsahu",
      "widthHint": "Jak široký může být sloupec s obsahem stránky na velké obrazovce.",
      "groupApp": "Ve vlastní sekci své aplikace"
    },
    "filters": {
      "add": "Přidat filtr",
      "control": "Ovládací prvek pro {column}",
      "down": "Posunout {column} dolů",
      "empty": "Tato stránka nemá žádné filtry. Přidejte jeden níže.",
      "full": "Stránka zobrazí nejvýše {max} filtrů.",
      "name": "Název pro {column}",
      "remove": "Odebrat filtr {column}",
      "reset": "Zpět k navrženým filtrům",
      "subtitle": "Otázky, které může panel nástrojů klást o této tabulce. Bez úprav sleduje tabulku.",
      "title": "Filtry",
      "up": "Posunout {column} nahoru"
    },
    "fit": {
      "alternatives": {
        "title": "Použít tabulku, která už vyhovuje",
        "help": "Do vaší databáze se nic nezapisuje — stránka se jen nasměruje na tabulku, která už má, co je potřeba.",
        "use": "Použít tuto tabulku"
      },
      "checkFailed": "Adminium nemohlo tuto tabulku zkontrolovat",
      "checkFailedBody": "Stránku můžete přesto vytvořit. Pokud ji tabulka neunese, vytvoření to oznámí.",
      "columns": {
        "title": "Přidat do této tabulky, co chybí",
        "help": "Adminium přidá do vaší tabulky tyto sloupce. Přesný příkaz uvidíte dříve, než se cokoli spustí, a nic se neodstraňuje.",
        "review": "Zobrazit změnu",
        "confirm": "Spustit",
        "failed": "To se nepovedlo",
        "partial": "Jednu věc, kterou tato stránka potřebuje, za vás přidat nelze — zůstane tedy nekompletní.",
        "cannot": "Tohle za vás Adminium přidat nemůže",
        "cannotBody": "Tato stránka potřebuje odkaz na jinou tabulku, který je třeba nastavit v Studio → Schéma.",
        "halfDone": "Sloupce byly přidány, ale Adminium nemohlo zaznamenat jejich význam",
        "halfDoneBody": "Nic není třeba spouštět znovu — sloupce existují. Nastavte jejich význam v Studio → Schéma, nebo o to požádejte správce."
      },
      "needs": "Aby šla stránka sestavit, tabulka potřebuje:",
      "noDdl": "Adminium nemůže tuto tabulku změnit za vás",
      "role": {
        "eventDate": "datum u každého řádku",
        "title": "textový sloupec, který se zobrazí jako název řádku",
        "status": "stavový sloupec, jehož hodnoty odpovídají krokům postupu",
        "personFk": "odkaz na tabulku osob",
        "shiftType": "sloupec určující, o jaký typ směny jde"
      },
      "slotOnly": "Nic v této tabulce nedokáže naplnit oblast „{slot}“.",
      "tag": {
        "title": "Použít sloupec, který už máte",
        "help": "Zaznamená se pouze význam sloupce. Vaše databáze se nemění a v Studio → Schéma to lze vrátit zpět.",
        "action": "Použít tento sloupec",
        "failed": "Tento sloupec se nepodařilo označit"
      },
      "title": "Tato tabulka zatím nemůže tuto stránku naplnit",
      "table": {
        "title": "Založit pro tuto stránku novou tabulku",
        "help": "Adminium vytvoří tabulku se vším, co tato stránka potřebuje. Než se cokoli spustí, uvidíte přesný příkaz, a vaše ostatní tabulky zůstanou beze změny.",
        "open": "Nebo pro tuto stránku založit novou tabulku",
        "name": "Název tabulky",
        "nameTaken": "Tabulka s tímto názvem už existuje.",
        "nameInvalid": "Použijte malá písmena, číslice a podtržítka a začněte písmenem.",
        "people": "Každý řádek přiřadit někomu z",
        "peopleNew": "Nové tabulky osob",
        "peopleCreated": "Vytvoří také „{table}“, malou tabulku osob, kterým se řádky přiřazují.",
        "noCompose": "Tabulka s tímto názvem by pro tuto stránku nefungovala. Zkuste jiný název.",
        "confirm": "Vytvořit tabulku",
        "noDdl": "Adminium zde nemůže vytvořit tabulku",
        "halfDone": "Tabulka byla vytvořena, ale Adminium nemohlo uložit význam jejích sloupců",
        "halfDoneBody": "Nic není třeba spouštět znovu — tabulka existuje. Nastavte význam jejích sloupců ve Studio → Schéma, nebo o to požádejte administrátora.",
        "notReread": "Tabulka byla vytvořena, ale Adminium ji zatím nemohlo znovu načíst",
        "notRereadBody": "Nic není třeba spouštět znovu. Obnovte schéma ve Studio → Datová připojení a pak zde vyberte novou tabulku."
      },
      "related": {
        "title": "Použít data propojené tabulky",
        "help": "Do vaší databáze se nic nezapisuje. Stránka se sestaví nad tabulkou propojenou s touto a každá položka zobrazí název z této tabulky.",
        "reason": "Data z „{date}“, každá s názvem „{title}“ přes „{via}“",
        "chosen": "Sestaveno nad {table}, každá položka s názvem „{title}“ z {from}",
        "undo": "Zpět na {table}"
      }
    },
    "form": {
      "addLines": "{label} jako řádky",
      "dialog": {
        "cta": "Tlačítko",
        "ctaIcon": "Ikona tlačítka",
        "iconDefault": "Výchozí",
        "subtitle": "Podtitul",
        "title": "Název dialogu",
        "titleHelp": "Prázdné použije vygenerovaná slova."
      },
      "field": {
        "availability": "Obsazeno, když",
        "availabilityAny": "Jakýkoli řádek má tento čas",
        "availabilityHelp": "Jiný řádek má stejný čas. Vyberte sloupec pro zúžení na jednu místnost, osobu či stroj. Bez něj se nic nezobrazí jako obsazené.",
        "availabilityOff": "Nekontrolovat",
        "control": "Ovládací prvek",
        "down": "Posunout {name} dolů",
        "drag": "Přeskupit {name}",
        "help": "Text nápovědy",
        "initial": "Počáteční hodnota",
        "initialHelp": "S čím začíná NOVÝ záznam. Při úpravě se nikdy nepoužije.",
        "initialLiteral": "Pevná hodnota",
        "initialNone": "Nic",
        "initialNow": "Aktuální datum a čas",
        "initialToday": "Dnes",
        "initialUser": "Kdo je přihlášen",
        "initialValue": "Hodnota",
        "label": "Popisek",
        "placeholder": "Zástupný text",
        "recap": "Shrnutí",
        "recapHelp": "Shrnující pole. Jeho text se zatím upravuje v JSON stránky.",
        "remove": "Odebrat {name}",
        "required": "Vyžádat si to",
        "requiredHelp": "Formulář bez toho neuloží. Co vyžaduje DATABÁZE, se nastavuje ve Schématu.",
        "ruleChecks": "platí další kontroly",
        "ruleDatabase": "vyplňuje to databáze",
        "ruleFilled": "vyplňuje to Adminium",
        "ruleList": "jen hodnoty ze seznamu {key}",
        "ruleRequired": "databáze to vyžaduje",
        "ruleValues": "jen pevná množina hodnot",
        "rules": "Tento sloupec: {rules}.",
        "rulesLink": "Změnit ve Schématu",
        "settings": "Nastavení pro {name}",
        "slotsEnd": "do",
        "slotsEvery": "po",
        "slotsHelp": "Nechte časy prázdné pro pouhý výběr dne.",
        "slotsStart": "Časy od",
        "span": "Šířka",
        "spanHelp": "Kolik sloupců sekce toto pole zabírá.",
        "up": "Posunout {name} nahoru"
      },
      "gallery": {
        "choice": {
          "body": "Vybíratelné karty voleb, přepínač a posuvník.",
          "title": "Karty voleb"
        },
        "multi": {
          "body": "E-maily jako štítky, výběr role, seznam oprávnění.",
          "title": "Hromadné zadání"
        },
        "quick": {
          "body": "Jedno pole s názvem a štítky v řádku. Bez členění na sekce.",
          "title": "Rychlé vytvoření"
        },
        "repeater": {
          "body": "Reference, opakovatelné položky a průběžné součty.",
          "title": "Opakovač a součty"
        },
        "sectioned": {
          "body": "Dlouhý záznam rozdělený do pojmenovaných sekcí s rolovatelným tělem.",
          "title": "Sekce"
        },
        "segmented": {
          "body": "Segmentovaná priorita, dlouhý popis, seznam příloh, přiřazená osoba.",
          "title": "Segmenty a soubory"
        },
        "split": {
          "body": "Dva panely: první sekce vedle zbytku. Určeno pro kalendář.",
          "title": "Rozdělený panel"
        },
        "upload": {
          "body": "Plocha pro média, měnová pole, štítky a přepínač publikování.",
          "title": "Nahrávání a štítky"
        },
        "wizard": {
          "body": "Průvodce krok za krokem s ukazatelem postupu a patičkou Zpět / Další.",
          "title": "Průvodce"
        }
      },
      "missing": {
        "title": "Není v tomto formuláři. Sloupec, který databáze vyžaduje, se při otevření dialogu doplní sám."
      },
      "preview": "Náhled",
      "previewEntity": "záznam",
      "reset": "Vrátit na vygenerovaný",
      "section": {
        "add": "Přidat sekci",
        "columnCount": "{count} sloupců",
        "columns": "Sloupce",
        "empty": "Zatím tu nejsou žádná pole — přesuňte sem nějaké nebo je přidejte níže.",
        "label": "Název sekce",
        "remove": "Odebrat tuto sekci",
        "unnamed": "Nepojmenovaná sekce"
      },
      "subtitle": "Co ukazují dialogy Nový a Upravit. Dokud se nezmění, řídí se tabulkou.",
      "title": "Formulář pro vytvoření"
    },
    "icon": {
      "noMatches": "Tomuto hledání neodpovídají žádné ikony.",
      "none": "Vyberte ikonu",
      "search": "Hledat ikony"
    },
    "list": {
      "count": "{count, plural, one {# stránka} few {# stránky} many {# stránky} other {# stránek}}",
      "title": "Stránky"
    },
    "loadFailed": {
      "body": "Správa stránek vyžaduje oprávnění „Spravovat stránky“. Požádejte správce, aby ho přidal některé z vašich rolí.",
      "title": "Stránky se nepodařilo načíst"
    },
    "origin": {
      "generated": "Vygenerovaná",
      "llm": "Asistent",
      "manifest": "Doplněk",
      "project": "Kód projektu",
      "system": "Systémová",
      "user": "Vlastní"
    },
    "padding": {
      "custom": "Vlastní…",
      "default": "Výchozí pro tuto šablonu",
      "none": "Žádné",
      "standard": "Standardní (28 × 24)",
      "x": "Po stranách (px)",
      "y": "Nahoře a dole (px)"
    },
    "preview": {
      "note": "Nákres rozvržení, nikoli vašich dat. Skutečná stránka se naplní po uložení.",
      "untitled": "Nepojmenovaná stránka"
    },
    "project": {
      "badge": {
        "changed": "Změněno na serveru",
        "conflict": "Konflikt",
        "outside": "Mimo projekt"
      },
      "changed": {
        "body": "Stáhněte změny do projektu a nasaďte ho, jinak zůstanou jen na tomto serveru:",
        "title": "{count, plural, one {# stránka byla změněna na tomto serveru} few {# stránky byly změněny na tomto serveru} many {# stránky bylo změněno na tomto serveru} other {# stránek bylo změněno na tomto serveru}}"
      },
      "conflicts": {
        "body": "Tento server si ponechá svou verzi, dokud jednu nevyberete.",
        "title": "{count, plural, one {# stránka byla změněna zde i v projektu} few {# stránky byly změněny zde i v projektu} many {# stránky bylo změněno zde i v projektu} other {# stránek bylo změněno zde i v projektu}}"
      },
      "fromCode": "Tato stránka pochází z {source}. Změňte ji tam.",
      "invalid": {
        "body": "Opravte tyto soubory. Do té doby zůstává v platnosti poslední platná verze.",
        "title": "{count, plural, one {# soubor projektu nebyl použit} few {# soubory projektu nebyly použity} many {# souboru projektu nebylo použito} other {# souborů projektu nebylo použito}}"
      },
      "keepServer": "Ponechat verzi serveru",
      "notConfigured": "Některé z nich patří k databázi, kterou projekt neuvádí. Přidejte ji do adminium.config.ts, aby její stránky zůstaly v projektu.",
      "outside": {
        "body": "Existují jen na tomto serveru. Stáhněte je do projektu, abyste je zachovali:",
        "title": "{count, plural, one {# stránka není v projektu} few {# stránky nejsou v projektu} many {# stránky není v projektu} other {# stránek není v projektu}}"
      },
      "resolveFailed": "Tuto změnu nelze provést.",
      "useProject": "Použít verzi projektu"
    },
    "row": {
      "menu": "Akce pro {title}"
    },
    "sidebar": {
      "discard": "Zahodit",
      "emptyGroup": "V této skupině nejsou žádné stránky.",
      "help": "Změňte pořadí stránek uvnitř skupiny, nebo některou přesuňte do jiné skupiny. Změny platí pro všechny.",
      "moveDown": "Posunout {title} dolů",
      "moveTo": "Přesunout {title} do skupiny",
      "moveUp": "Posunout {title} nahoru",
      "save": "Uložit pořadí",
      "saveFailed": "Nové pořadí se nepodařilo uložit",
      "ungrouped": {
        "body": "Tyto stránky na své URL fungují, ale v postranním panelu se nikde neobjeví. Otevřete každou z nich a vyberte skupinu.",
        "title": "Některé stránky nepatří do žádné skupiny"
      },
      "apps": {
        "title": "V sekcích nainstalovaných aplikací",
        "body": "Každá aplikace má své stránky ve vlastní sekci postranního panelu."
      }
    },
    "status": {
      "hidden": "Skrytá",
      "live": "Aktivní"
    },
    "subtitle": "Přidávejte, upravujte a uspořádejte stránky své aplikace i jejich pořadí v postranním panelu.",
    "tab": {
      "pages": "Všechny stránky",
      "sidebar": "Pořadí v panelu"
    },
    "title": "Stránky",
    "width": {
      "content": "Obsah (900 px)",
      "dash": "Dashboard (1320 px)",
      "default": "Výchozí pro tuto šablonu",
      "full": "Celá šířka (bez omezení)",
      "narrow": "Úzká (720 px)",
      "page": "Stránka (1080 px)",
      "wide": "Široká (1800 px)"
    },
    "toggleFailed": "Stránka nebyla změněna"
  },
  "project": {
    "actions": {
      "bulk": "Jeden nebo více záznamů",
      "empty": "Žádné akce. Soubor ve složce actions/ přidá k záznamům tlačítko.",
      "needs": "Vyžaduje: {permission}",
      "single": "Jeden záznam",
      "title": "Akce"
    },
    "changes": {
      "empty": "Všechny soubory stránek a schématu odpovídají tomuto serveru.",
      "open": "Vyřešit ve Stránkách",
      "title": "Změněno na tomto serveru"
    },
    "code": {
      "disabled": "Nenačteno: desktopová aplikace kód projektu nikdy nespouští",
      "label": "Kód projektu",
      "loaded": "Načteno {when}",
      "none": "Nic nenačteno"
    },
    "failures": {
      "empty": "Od spuštění serveru žádný hook neselhal.",
      "title": "Chyby hooků"
    },
    "files": {
      "count": "{count, plural, one {# soubor} few {# soubory} many {# souboru} other {# souborů}}",
      "pages": "Soubory stránek",
      "schema": "Soubory schématu",
      "title": "Soubory"
    },
    "folder": "Složka",
    "hooks": {
      "empty": "Žádné hooky. Soubor ve složce hooks/ spouští kód při změně záznamů.",
      "onImport": "Také pro importy CSV",
      "title": "Hooky"
    },
    "loadFailed": "Projekt se nepodařilo načíst",
    "mode": {
      "dev": "Vývoj: složka a Studio zůstávají v souladu",
      "label": "Běží jako",
      "server": "Server: složka se mění jen nasazením"
    },
    "none": {
      "body": "Projekt je složka vytvořená příkazem `npx @adminiumjs/adminium new`. Jeho stránky, hooky a akce se zde zobrazí, když ho server spouští.",
      "title": "Tento server nespouští žádný projekt"
    },
    "pages": {
      "empty": "Žádné stránky. Soubor .tsx ve složce pages/ přidá vlastní stránku.",
      "hidden": "Není v postranním panelu",
      "title": "Stránky"
    },
    "permission": {
      "create": "Přidat",
      "delete": "Smazat",
      "read": "Zobrazit",
      "update": "Upravit"
    },
    "problems": {
      "body": "Opravte tyto soubory. Zbytek kódu projektu běží.",
      "title": "{count, plural, one {# soubor se nenačetl} few {# soubory se nenačetly} many {# souboru se nenačetlo} other {# souborů se nenačetlo}}"
    },
    "status": {
      "changed": "Změněno na tomto serveru",
      "conflict": "Konflikt",
      "invalid": "Neplatné",
      "outside": "Mimo projekt",
      "pending": "Zatím nepoužito"
    },
    "subtitle": "Složka projektu, kterou tento server spouští, a kód, který načetl.",
    "superAdminOnly": "Projekt, který tento server spouští, může vidět jen superadministrátor.",
    "title": "Projekt",
    "version": "Adminium",
    "widgets": {
      "card": "Karta nástěnky",
      "cell": "Buňka tabulky",
      "empty": "Žádné widgety. Soubor ve složce widgets/ přidá buňku tabulky nebo kartu nástěnky.",
      "title": "Widgety"
    }
  },
  "publicApi": {
    "cancel": "Zrušit",
    "close": "Zavřít",
    "error": "Něco se pokazilo",
    "keys": {
      "appHint": "Zákaznická plocha aplikace pak tento klíč obsluhuje sama — jeho rotace nevyžaduje rebuild.",
      "appLabel": "Navázat na hostovanou aplikační plochu (volitelné)",
      "appNone": "Nenavázán",
      "create": "Vytvořit klíč",
      "emptyBody": "Nejprve vytvořte rozsah a pak pro něj vytvořte klíč.",
      "emptyTitle": "Zatím žádné klíče",
      "formLabel": "Vytvoření klíče",
      "nameLabel": "Název",
      "reveal": "Zobrazit klíč",
      "revoke": "Odvolat",
      "rotate": "Rotovat",
      "scopeIsAuthBody": "Klíč se dostane přesně k tomu, co uvádí jeho rozsah, a k ničemu jinému. Nepoužívá role ani oprávnění k tabulkám a přes zbytek API nepřečte nic.",
      "scopeIsAuthTitle": "Jediným oprávněním je rozsah",
      "scopeLabel": "Rozsah",
      "scopePlaceholder": "Vyberte rozsah",
      "subtitle": "Vkládají se do JavaScriptu vaší stránky, takže je může kdokoli přečíst. Tak to má být — klíč nikdy nezmůže víc, než co dovoluje jeho rozsah.",
      "title": "Klíče"
    },
    "notRegistered": {
      "body": "Nastavte ADMINIUM_PUBLIC_API_ORIGINS na přesné adresy původu, které smějí volat, a poté restartujte. Do té doby se tyto cesty vůbec neobsluhují.",
      "title": "Na tomto serveru není zapnuto"
    },
    "origins": {
      "label": "Adresy původu, které smějí volat"
    },
    "scopes": {
      "connectionLabel": "ID připojení",
      "create": "Vytvořit rozsah",
      "delete": "Smazat",
      "deleteConfirm": "Smazat rozsah",
      "deletePrompt": "Pro potvrzení napište název rozsahu",
      "deleteTitle": "Smazat tento rozsah",
      "documentHint": "Při uložení se zkompiluje proti vašemu schématu. Každý sloupec, ke kterému se volající dostane, je uvedený zde a nikde jinde. Výchozí hodnotou může být '{'\"$generate\": \"uuid\"'}' nebo '{'\"$generate\": \"now\"'}' — server je při vytváření doplní sám, takže návštěvník může přidat řádek, aniž by volil jeho id.",
      "documentLabel": "Dokument rozsahu",
      "emptyBody": "Vytvořte si jeden níže. Před uložením se ověří proti vašemu živému schématu.",
      "emptyTitle": "Zatím žádné rozsahy",
      "formLabel": "Vytvoření rozsahu",
      "issuesTitle": "Tento rozsah se nepodařilo zkompilovat",
      "keyCount": "{count, plural, =0 {žádné klíče} one {# klíč} few {# klíče} many {# klíče} other {# klíčů}}",
      "nameLabel": "Název",
      "subtitle": "Rozsah je vše, k čemu klíč smí sáhnout — tabulky, přesné sloupce a filtr, který volající smí zúžit, ale nikdy odstranit.",
      "title": "Rozsahy",
      "deleteBodyKeys": "Rozsah s aktivními klíči nelze smazat. Nejprve jeho klíče odvolejte. Klíče, které jsou již odvolané nebo vypršely, se smažou spolu s rozsahem.",
      "liveKeys": {
        "body": "Stránky postavené na těchto klíčích by přestaly fungovat. Nejprve je odvolejte v seznamu klíčů a potom rozsah smažte.",
        "title": "Tento rozsah stále používají publikovatelné klíče"
      }
    },
    "status": {
      "heading": "Stav"
    },
    "subtitle": "Umožněte svým zákaznickým nebo zaměstnaneckým stránkám číst tuto databázi prostřednictvím rozsahu, který určíte.",
    "title": "Veřejné API",
    "toggle": {
      "hint": "Vypnutím se okamžitě zastaví každý veřejný požadavek. Nic se nemaže — klíče, rozsahy i data zůstávají zachovány.",
      "label": "Obsluhovat veřejné API"
    }
  },
  "remap": {
    "badge": {
      "fk": "FK",
      "masked": "Maskováno",
      "pii": "PII",
      "pk": "PK",
      "unique": "UNIQUE"
    },
    "column": {
      "currency": "Měna",
      "currencyHelper": "Kód ISO 4217 použitý při formátování peněžních částek.",
      "enum": "Sémantika výčtu",
      "enumCategory": "Kategorie",
      "enumHelper": "Výčty typu pracovní postup řídí stavové štítky a sloupce kanbanu; tóny mapují hodnoty na škálu sémantických odstínů.",
      "enumKind": "Druh výčtu",
      "enumLabelFor": "Popisek pro {value}",
      "enumToneAuto": "automaticky",
      "enumToneFor": "Tón pro {value}",
      "enumWorkflow": "Pracovní postup",
      "labelHelper": "Odvozeno: {name}",
      "labelOverride": "Zobrazovaný popisek",
      "logicalType": "Logický typ",
      "logicalTypeHelper": "Odvozeno: {type} (z {dbType}) — mapuje adaptér; ve v1 nelze přepsat.",
      "nullable": "může být NULL",
      "pii": "Ve výchozím stavu maskovat",
      "piiHelper": "Maskované hodnoty se zobrazují skryté; odmaskování vyžaduje oprávnění data.unmask_pii a zaznamenává se do auditního logu.",
      "semantic": "Sémantický typ",
      "semanticHelper": "Klasifikátor: {tag} · spolehlivost {confidence}% · zdroj: {source}",
      "semanticInferred": "odvozeno: {tag}",
      "unclassified": "Zatím neklasifikováno."
    },
    "diff": {
      "count": "Změny: {count}",
      "one": "1 změna",
      "regenerate": "Znovu vygenerovat stránky",
      "revertAll": "Vrátit vše zpět",
      "revertOne": "Vrátit {change} zpět",
      "save": "Uložit úpravy",
      "saved": "Úpravy uloženy."
    },
    "empty": {
      "description": "Vyberte něco ve stromu schématu a přemapujte jeho popisek, typ, vztahy nebo maskování.",
      "title": "Vyberte tabulku nebo sloupec"
    },
    "inspector": "Inspektor",
    "loadFailed": "Schéma pro toto připojení se nepodařilo načíst.",
    "mode": {
      "design": "Návrh",
      "diagram": "Diagram",
      "remap": "Popisky a vztahy"
    },
    "modeLabel": "Režim editoru",
    "noDesign": {
      "noPrivilege": "Role tohoto připojení nemůže vytvářet ani měnit tabulky. Udělte jí oprávnění ke schématu, nebo připojte roli, která je má.",
      "readOnlyIntent": "Toto připojení bylo nastaveno pro analytiku jen pro čtení. Chcete-li upravit jeho schéma, změňte v Nastavení jeho účel.",
      "readOnlyRole": "Toto připojení se přihlašuje rolí jen pro čtení, takže Adminium nemůže měnit jeho schéma.",
      "schemaFile": "Toto připojení vzniklo ze souboru se schématem, takže není co měnit. Popisky a vztahy fungují dál."
    },
    "relations": {
      "accept": "Přijmout",
      "accepted": "Přijato",
      "add": "Přidat virtuální vztah",
      "addButton": "Přidat vztah",
      "cardinality": "Kardinalita",
      "confidence": "odvozeno · {pct}%",
      "declared": "Deklarované cizí klíče",
      "fromColumn": "Ze sloupce",
      "fromPlaceholder": "customer_id",
      "inferred": "Odvozené vztahy",
      "noColumns": "Žádný odpovídající sloupec",
      "noTables": "Žádná odpovídající tabulka",
      "noneDeclared": "Této tabulky se nedotýkají žádné deklarované cizí klíče.",
      "noneInferred": "Pro tuto tabulku nebylo nic odvozeno.",
      "overrideBadge": "úprava",
      "overrides": "Úpravy vztahů (použité)",
      "suppress": "Potlačit",
      "suppressed": "Potlačeno",
      "toColumn": "Do sloupce",
      "toTable": "Do tabulky"
    },
    "rules": {
      "fill": "Výchozí hodnota",
      "fillDb": "Vyplní to databáze (trigger)",
      "fillDefault": "Nechat na databázi",
      "fillHelp": "Co sem Adminium vloží, když to nikdo nevyplní.",
      "fillImplicit": "Adminium to vyplňuje automaticky.",
      "fillLiteral": "Pevná hodnota",
      "fillNone": "Nic — nechat prázdné",
      "fillNow": "Aktuální datum a čas",
      "fillText": "Hodnota",
      "fillUser": "Kdo je přihlášen",
      "fillUuid": "Nové jedinečné id",
      "format": "Formát",
      "formatAny": "Cokoli",
      "formatEmail": "E-mailová adresa",
      "formatPhone": "Telefonní číslo",
      "formatUrl": "Webová adresa",
      "help": "Platí všude, kde vzniká řádek — ve formulářích, importech, automatizacích i v API —, nejen v této aplikaci.",
      "max": "Největší",
      "maxLength": "Nejdelší",
      "min": "Nejmenší",
      "minLength": "Nejkratší",
      "onUpdate": "Vyplnit znovu při každé změně",
      "optionsFromDatabase": "Povolené hodnoty tohoto sloupce určuje vaše databáze. Změňte je v Návrhu.",
      "optionsHelp": "Jedna na řádek. Prázdné pole přijímá cokoli.",
      "required": "Musí být vyplněno",
      "requiredAlready": "Vaše databáze tento sloupec už vyžaduje.",
      "requiredHelp": "Formulář se na to ptá a zápis bez toho je odmítnut.",
      "title": "Pravidla",
      "optionsAnything": "Cokoli",
      "optionsInline": "Tyto hodnoty",
      "optionsList": "Seznam",
      "optionsListHelp": "Samotné seznamy upravíte ve Studiu → Seznamy.",
      "optionsListLabel": "Seznam",
      "optionsListUnavailable": "Seznamy se nepodařilo načíst.",
      "optionsMissingList": "{key} (není v tomto pracovním prostoru)",
      "optionsPickList": "Vyberte seznam…",
      "optionsSource": "Povolené hodnoty",
      "optionsSourceHelp": "Seznam se napíše jednou ve Studiu a použije jej každý sloupec, který jej pojmenuje.",
      "optionsValues": "Hodnoty",
      "decided": {
        "title": "Určuje Adminium",
        "help": "Adminium toto vyplní při každém zápisu a veřejný endpoint nikdy nedovolí návštěvníkovi to nastavit.",
        "copy": "Zkopírováno z {from} řádku, na který odkazuje {via}",
        "copyAlways": "vždy, bez ohledu na to, co zapisující zadá",
        "copyDefault": "pokud zapisující nezadá hodnotu",
        "sequence": "Další číslo v pořadí, od {start}",
        "code": "Náhodný kód jako {example}",
        "remove": "Odebrat toto pravidlo",
        "rollup": "Součet {sum} přes jeho řádky v {from}",
        "rollupTimes": "Součet {sum} × {times} přes jeho řádky v {from}",
        "stampCreate": "Při vytvoření řádku se nastaví na {what}",
        "stampChange": "Nastaví se na {what}, když {column} přejde na {values}",
        "stampNow": "čas",
        "stampUserName": "jméno toho, kdo to udělá",
        "stampUserId": "ID toho, kdo to udělá",
        "stampByOrigin": "„{public}“ z veřejné strany, „{staff}“ od personálu",
        "rollupWhere": "počítají se jen řádky, kde {column} je {value}",
        "rollupBalance": "a udržuje {balance} = {of} − {minus} − tento součet",
        "rollupCap": "Zápis, který by snížil zůstatek pod nulu, je odmítnut.",
        "stampToday": "datum",
        "stampClaim": "{column} přihlášené osoby",
        "stampAddDays": "{date} plus {days} dní",
        "stampAddDaysColumn": "{date} plus počet dní podle {column}",
        "stampHashOf": "otisk řádku",
        "stampFilled": "Nastaví se na {what}, když se {column} poprvé vyplní",
        "sequenceGapless": "Další číslo v pořadí, bez mezer a bez opakování",
        "sequenceScope": "počítá se zvlášť pro každé {scope}",
        "formula": "Vypočítá se z {columns} při každém zápisu",
        "format": "Zapisuje se jako {example} podle čísla v {from}",
        "scale": "Zaokrouhleno na {places} desetinných míst",
        "scaleCurrency": "Zaokrouhleno na desetinná místa své měny",
        "stampByOriginOwn": "„{public}“ z veřejné strany a z personálu to, co zvolí",
        "stampCopy": "hodnota {column}",
        "normalizeEmail": "Ukládá se bez okrajových mezer a malými písmeny",
        "normalizeTrim": "Ukládá se bez mezer na začátku a na konci",
        "states": "Mění se jen kroky, které jeho pravidla dovolují",
        "statesLock": "řádek je zamčený, dokud je {states}"
      },
      "venueLocal": "Čas zapsaný sem bez časového pásma je místním časem provozovny.",
      "fillFromCurrency": "Měna připojení",
      "fillFromSetting": "Nastavení: {setting}",
      "shape": {
        "setBy": "Nastaveno doplňkem {addOn}",
        "confirmTitle": "Vypnout pravidlo nastavené doplňkem {addOn}?",
        "numbers": "Čísla se mohou opakovat nebo chybět.",
        "totals": "Součty budou takové, jaké kdo napíše.",
        "edits": "Odeslané faktury bude možné upravovat.",
        "kept": "{addOn} to přestane vyplňovat.",
        "confirmHelp": "Jakmile ho změníte, pravidlo je vaše: žádná aktualizace aplikace ani doplňku ho nevrátí.",
        "keep": "Ponechat",
        "switchOff": "Vypnout"
      },
      "bounds": {
        "notAfter": "Nikdy později než dnes",
        "notBefore": "Nikdy před {column}"
      }
    },
    "saveFailed": "Uložení se nezdařilo: {message}",
    "subtitle": "{tables} tabulek · použito {applied} úprav",
    "table": {
      "hierarchy": "Hierarchie",
      "icon": "Ikona",
      "iconPicker": "Ikona tabulky",
      "include": "Zahrnout do vygenerované aplikace",
      "includeHelper": "Vyloučené tabulky nedostanou žádné stránky a zmizí z navigace.",
      "kind": "Druh",
      "labelHelper": "Odvozeno: {name}",
      "labelOverride": "Zobrazovaný popisek",
      "navGroup": "Navigační skupina",
      "navGroupHelper": "Umístění v navigaci určuje generátor — úprava table.navGroup není ve slovníku v1.",
      "polymorphic": "Polymorfní dvojice",
      "role": "Role",
      "rows": "Odhad počtu řádků",
      "selfFk": "Odkaz na sebe přes {column}",
      "shape": "Tvar tabulky (klasifikovaný)",
      "shapeHelper": "Klasifikace se přepočítává při každé introspekci; úpravy se vrství navrch a přežijí regeneraci.",
      "system": "Systémová",
      "unclassified": "Neklasifikováno"
    },
    "tabs": {
      "details": "Podrobnosti",
      "relations": "Vztahy"
    },
    "title": "Schéma",
    "toast": {
      "regenerateFailed": "Regenerace se nezdařila",
      "regenerated": "{created} vytvořeno · {updated} aktualizováno · {unchanged} beze změny",
      "regeneratedDetail": "Ručně upravené stránky zůstávají zachovány — na místě byly znovu vygenerovány pouze stránky s nedotčeným generated_hash.",
      "saved": "Úpravy schématu uloženy",
      "savedDetail": "Použité schéma níže odráží vaše změny."
    },
    "tree": {
      "collapse": "Sbalit tabulku",
      "excluded": "Vyloučeno",
      "expand": "Rozbalit tabulku",
      "label": "Schéma",
      "noMatches": "Vašemu hledání neodpovídají žádné tabulky.",
      "search": "Hledat tabulky a sloupce",
      "searchPlaceholder": "Hledat tabulky…",
      "unsaved": "Neuložená změna"
    },
    "unavailableBody": "Tento build zatím editor přemapování neobsahuje. Až přibude, spusťte generování znovu a přemapujte popisky, typy a vztahy.",
    "unavailableTitle": "Editor přemapování schématu není k dispozici"
  },
  "review": {
    "unavailableBody": "Tento build zatím obrazovku kontroly obohacení neobsahuje. Přijde s tokem rozdílu a použití.",
    "unavailableTitle": "Obrazovka kontroly není k dispozici"
  },
  "settings": {
    "globalDefaultsNav": "Globální výchozí nastavení",
    "title": "Nastavení",
    "workspaceSection": "Pracovní prostor"
  },
  "settingsAi": {
    "assistant": {
      "name": {
        "label": "Jméno asistenta",
        "hint": "Zobrazuje se na tlačítku dotazu a v okně asistenta."
      },
      "rowData": {
        "label": "Povolit {name} číst řádky tabulek",
        "hint": "Když je zapnuto, {name} smí poslat nakonfigurovanému poskytovateli řádky, které tvoje role může číst — maskované, nejvýše 50 na požadavek a vypsané pod „Přečtené zdroje“. Když je vypnuto, pracuje jen s dokumenty a schématem."
      },
      "save": "Uložit",
      "saveFailed": "Nastavení asistenta se nepodařilo uložit. Zkuste to znovu.",
      "saved": "Nastavení asistenta uloženo",
      "subtitle": "Jak se tu jmenuje a co smí číst.",
      "title": "Asistent"
    },
    "byo": {
      "body": "Studio umí z vašeho schématu vygenerovat samostatný prompt. Spusťte jej v Claude Code, ChatGPT nebo libovolném nástroji a vrácené JSON vložte zpět do průvodce připojením. Stejná validace, stejná kontrola, stejný výsledek jako přímá cesta.",
      "guarantee1": "Prompt nese jen vaše schéma a agregované statistiky — ve výchozím stavu nikdy data řádků.",
      "guarantee2": "Nejsou vloženy žádné přihlašovací údaje, URL instance ani identifikátory.",
      "guarantee3": "Běhy BYO nedělají žádné síťové volání.",
      "guaranteeTitle": "Záruka bez telemetrie",
      "heading": "Bez klíče? Použijte svůj vlastní nástroj AI",
      "headingRecommended": "Použijte vlastní AI nástroj — klíč není potřeba",
      "promptVersion": "Prompt {version}",
      "recommended": "Doporučeno",
      "schemaVersion": "Schéma {version}",
      "subtitle": "Okruh kopírovat-vložit — nic neopouští tento počítač."
    },
    "configure": {
      "heading": "Nastavit {provider}"
    },
    "field": {
      "baseUrl": "Základní URL",
      "baseUrlHelper": "Kořen koncového bodu, který obsluhuje /chat/completions.",
      "baseUrlOptional": "Ponechte beze změny, pokud Ollama neběží na jiném hostiteli.",
      "key": "Klíč API",
      "keyMask": "sk-…{last4}",
      "keyOptional": "Volitelné — některé koncové body žádný klíč nepotřebují.",
      "keyReplace": "Nahradit klíč",
      "keyStored": "Uloženo zašifrované. Nahraďte jej, chcete-li použít jiný klíč.",
      "keyWriteOnly": "Pouze pro zápis: po uložení se už nikdy nezobrazí.",
      "model": "Model",
      "modelFreeText": "Zadejte přesné ID modelu, který váš koncový bod obsluhuje.",
      "modelLive": "Načteno živě od poskytovatele.",
      "modelLoading": "Načítání…",
      "modelPlaceholder": "Vyberte model…",
      "modelStatic": "Ověřený seznam; po uložení zadejte vlastní ID pro obnovení.",
      "noKeyBody": "Ollama běží lokálně, takže nic neopouští tento počítač.",
      "noKeyTitle": "Klíč API není potřeba"
    },
    "history": {
      "byo": "BYO",
      "colChunks": "Bloky",
      "colDate": "Datum",
      "colSource": "Zdroj",
      "colStatus": "Stav",
      "connection": "Připojení",
      "directPath": "Přímá",
      "empty": "Zatím žádné běhy obohacení. Obohaťte schéma z průvodce připojením a historie se zobrazí zde.",
      "errorBody": "Zkuste to znovu obnovením stránky.",
      "errorTitle": "Běhy se nepodařilo načíst",
      "heading": "Historie běhů",
      "noConnections": "Nejprve připojte databázi — běhy obohacení se zaznamenávají u každého připojení.",
      "openReview": "Otevřít kontrolu běhu z {date}",
      "subtitle": "Předchozí běhy obohacení. Otevřete některý pro kontrolu jeho návrhů.",
      "tableLabel": "Běhy obohacení"
    },
    "provider": {
      "active": "Aktivní",
      "anthropic": {
        "desc": "Modely Claude přes API Anthropic.",
        "label": "Anthropic"
      },
      "heading": "Poskytovatel AI",
      "networkDisabledBody": "Toto Adminium je nastaveno bez odchozího přístupu k internetu, takže nemůže oslovit API poskytovatele. Použijte níže kolečko kopírovat-vložit — nepotřebuje klíč ani síť.",
      "networkDisabledTitle": "Přímí AI poskytovatelé jsou v této instalaci vypnuti",
      "ollama": {
        "desc": "Modely běžící lokálně přes Ollama — bez klíče, bez cloudu.",
        "label": "Ollama (lokálně)"
      },
      "openai": {
        "desc": "Modely GPT přes API OpenAI.",
        "label": "OpenAI"
      },
      "openaiCompatible": {
        "desc": "Jakýkoli koncový bod ve formátu OpenAI — Groq, Together, vLLM, LM Studio.",
        "label": "Kompatibilní s OpenAI"
      },
      "requiresNetwork": "Vyžaduje internet a API klíč",
      "subtitle": "Vyberte, jak Adminium osloví model pro obohacení vašeho schématu. Klíče se ukládají zašifrované a už se nikdy nezobrazí."
    },
    "runStatus": {
      "applied": "Použito",
      "awaitingResponse": "Čeká na odpověď",
      "discarded": "Zahozeno",
      "draft": "Koncept",
      "failed": "Selhalo",
      "partiallyApplied": "Částečně použito",
      "running": "Probíhá",
      "validated": "Ověřeno"
    },
    "save": "Uložit poskytovatele",
    "saveFailed": "Poskytovatele AI se nepodařilo uložit. Zkuste to znovu.",
    "saved": "Poskytovatel AI uložen",
    "subtitle": "Připojte model, aby Adminium navrhoval popisky, skupiny, vztahy a další — vždy zkontrolováno jako rozdíl, než se cokoli použije.",
    "test": "Otestovat připojení",
    "testError": "Test selhal",
    "testErrorBody": "Poskytovatele se nepodařilo kontaktovat. Zkontrolujte klíč a základní URL.",
    "testHintDirty": "Před testem uložte změny.",
    "testOk": "Připojeno k {model} za {latency} ms",
    "testUnknownModel": "poskytovateli",
    "testing": "Kontaktuji poskytovatele…",
    "title": "Obohacení pomocí AI"
  },
  "settingsHub": {
    "addOnsCard": {
      "body": "Procházejte, instalujte a připojujte doplňky — další bloky, datové balíčky a integrace — nebo si jeden nahrajte sami.",
      "cta": "Otevřít doplňky",
      "heading": "Doplňky"
    },
    "aiCard": {
      "body": "Nastavte poskytovatele AI (nebo okruh kopírovat-vložit) k obohacení popisků, skupin a vztahů.",
      "cta": "Otevřít nastavení AI",
      "heading": "Obohacení pomocí AI"
    },
    "apiCard": {
      "api": {
        "helper": "Obsluhuje koncové body, na které jsou vaše klíče omezeny. Po vypnutí přestanou okamžitě fungovat všechny klíče; nic se nemaže.",
        "label": "Veřejné API"
      },
      "docs": {
        "helper": "Veřejná stránka na /api-docs, která komukoli, kdo se dostane k tomuto serveru, vypíše koncové body, jež mohou volat vaše aktivní klíče — včetně těch na úrovni zaměstnanců — s jejich cestami, metodami a názvy sloupců. Nezobrazuje žádná data ani klíče.",
        "label": "Stránka s dokumentací API"
      },
      "failed": "Přepínač se nezměnil. Zkuste to znovu.",
      "heading": "Veřejné API",
      "notRegistered": {
        "body": "Nastavte ADMINIUM_PUBLIC_API_ORIGINS a restartujte. Do té doby tyto přepínače nic nezmění.",
        "title": "Na tomto serveru není zapnuto"
      }
    },
    "danger": {
      "deleteCta": "Smazat připojení",
      "deleteDesc": "Smaže připojení a z něj vygenerované stránky. Vaší databáze se to nedotkne. Nelze vzít zpět.",
      "empty": "Není co mazat — zatím žádná připojení.",
      "heading": "Nebezpečná zóna",
      "subtitle": "Nevratné akce."
    },
    "defaultsCard": {
      "body": "Motiv, akcentová barva, hustota a jazyk pro celý workspace najdete ve výchozím globálním nastavení.",
      "cta": "Otevřít globální výchozí nastavení",
      "heading": "Výchozí vzhled a jazyk"
    },
    "email": {
      "attachmentCap": {
        "error": "Mezi {min, number} a {max, number} MB.",
        "helper": "Největší velikost příloh, kterou může jedna zpráva nést.",
        "label": "Limit příloh (MB)"
      },
      "from": {
        "error": "Zadejte e-mailovou adresu.",
        "helper": "Samotná adresa, nebo zobrazované jméno před ní.",
        "label": "Adresa odesílatele"
      },
      "heading": "E-mail (SMTP)",
      "host": {
        "error": "Pouze název hostitele nebo IP adresa — bez schématu, portu a přihlašovacích údajů.",
        "label": "Server SMTP"
      },
      "linkOrigin": {
        "error": "Zadejte adresu jako https://admin.example.com bez cesty.",
        "helper": "Odkazy pro obnovení hesla a z pozvánek otevírají tuto adresu. Pokud je prázdná, Adminium ji převezme od dalšího správce, který se přihlásí nebo uloží změnu, pokud nepracuje přes localhost.",
        "label": "Adresa v odkazech v e-mailech"
      },
      "pass": {
        "error": "K tomuto uživatelskému jménu patří heslo.",
        "helper": "Uloženo šifrovaně a už se nikdy nezobrazí. Ponechte prázdné, chcete-li zachovat stávající.",
        "label": "Heslo"
      },
      "port": {
        "error": "Mezi {min, number} a {max, number}.",
        "label": "Port"
      },
      "remove": "Odebrat poštovní server",
      "review": {
        "password": "Nahrazeno",
        "removed": "Odebráno"
      },
      "secure": {
        "helper": "Zapnuto pro port 465. Vypnuto začíná nešifrovaně a přejde na STARTTLS, což očekává port 587.",
        "label": "Implicitní TLS"
      },
      "senders": {
        "add": "Přidat odesílatele",
        "address": "Adresa",
        "error": "Zadejte e-mailovou adresu.",
        "heading": "Odesílatelé",
        "helper": "Adresy, ze kterých lze e-mail odeslat. Adresa odesílatele SMTP je vždy k dispozici.",
        "implicit": "Adresa odesílatele SMTP",
        "name": "Zobrazované jméno",
        "remove": "Odebrat odesílatele",
        "review": "Odesílatelé"
      },
      "unconfigured": "Není nastaven žádný poštovní server, takže Adminium nemůže odesílat obnovení hesla, pozvánky ani naplánované reporty.",
      "user": {
        "helper": "Nechte prázdné, pokud relay nevyžaduje přihlášení.",
        "label": "Uživatelské jméno"
      }
    },
    "identity": {
      "appName": {
        "error": "Zadejte název o délce nejvýše 60 znaků.",
        "helper": "Zobrazuje se v postranním panelu, v titulku prohlížeče a v e-mailech.",
        "label": "Název aplikace"
      },
      "heading": "Identita workspace",
      "logo": {
        "badType": "Vyberte obrázek PNG, JPEG, WebP, GIF nebo SVG.",
        "drop": "Přetáhněte sem obrázek",
        "helper": "PNG, JPEG, WebP, GIF nebo SVG do 1 MB. Nahradí vestavěnou značku všude.",
        "label": "Logo",
        "remove": "Odebrat",
        "removed": "Logo odebráno",
        "replace": "Nahradit logo",
        "tooLarge": "Tento obrázek je větší než 1 MB.",
        "undo": "Zpět",
        "upload": "Nahrát logo",
        "uploaded": "Logo aktualizováno"
      },
      "showVersion": {
        "helper": "Číslo sestavení vedle loga. Vypnuté skryje, jakou verzi provozujete.",
        "label": "Verze v postranním panelu"
      }
    },
    "pagesCard": {
      "body": "Přidávejte, upravujte a mažte stránky, měňte jejich obsah a přeuspořádejte postranní panel.",
      "cta": "Spravovat stránky",
      "heading": "Stránky"
    },
    "projectCard": {
      "body": "Složka projektu, kterou tento server spouští: její hooky, akce a soubory stránek.",
      "cta": "Otevřít projekt",
      "heading": "Projekt"
    },
    "publicApiCard": {
      "body": "Vytvářejte koncové body a klíče, které je smějí volat.",
      "cta": "Otevřít API klíče",
      "heading": "API klíče"
    },
    "review": {
      "cancel": "Zrušit",
      "change": "{before} → {after}",
      "close": "Zavřít",
      "confirm": "Uložit změny",
      "hidden": "Skryto",
      "off": "Vypnuto",
      "on": "Zapnuto",
      "shown": "Zobrazeno",
      "subtitle": "Před uložením zkontrolujte změny.",
      "title": "Uložit nastavení workspace"
    },
    "save": "Uložit změny",
    "saveFailed": "Nastavení workspace se nepodařilo uložit. Zkuste to znovu.",
    "saved": "Nastavení workspace aktualizováno",
    "security": {
      "allowSignup": {
        "desc": "Účet si může založit kdokoli — při vypnutí zůstává workspace jen na pozvánky.",
        "label": "Povolit samoregistraci"
      },
      "heading": "Zabezpečení",
      "passwordMin": {
        "error": "Mezi {min, number} a {max, number} znaky.",
        "label": "Minimální délka hesla"
      },
      "require2fa": {
        "desc": "Každý člen musí mít pro přihlášení zapnuté 2FA.",
        "label": "Vyžadovat dvoufaktorové ověření",
        "note": "Jen doporučení, ne zábrana: členové bez 2FA jsou nasměrováni k jejímu nastavení a už ji nemohou vypnout, jejich přihlášení se ale nikdy neblokuje a klíčů API se to netýká."
      },
      "sessionTtl": {
        "error": "Mezi {min, number} a {max, number} hodinami.",
        "label": "Životnost relace (hodiny)"
      }
    },
    "storageCard": {
      "body": "Zvolte, kde žijí nahrané soubory, exporty a další uložená data — tento server, bucket, nebo váš vlastní server.",
      "cta": "Otevřít úložiště",
      "heading": "Úložiště"
    },
    "subtitle": "Identita, zabezpečení a destruktivní akce tohoto workspace.",
    "superAdminOnly": "Identitu a zabezpečení workspace může měnit pouze super admin.",
    "superAdminOnlyTitle": "Vyžadován super admin",
    "title": "Nastavení workspace",
    "translationsCard": {
      "body": "Přeformulujte v Adminiu cokoli, vyberte, které jazyky si lidé mohou zvolit, a přidejte vlastní.",
      "cta": "Otevřít překlady",
      "heading": "Jazyky a překlady"
    },
    "listsCard": {
      "body": "Odpovědi, které sloupec přijímá — země, fáze, oddělení — pojmenované jednou a použitelné odkudkoli.",
      "cta": "Otevřít seznamy",
      "heading": "Seznamy"
    }
  },
  "source": {
    "dsn": {
      "helper": "postgres://uzivatel:heslo@host:5432/databaze — fungují také mysql:// a sqlite:.",
      "incomplete": "Doplňte hostitele a databázi, např. postgres://user@host:5432/db",
      "invalidScheme": "Nerozpoznané schéma — očekává se postgres://, mysql://, mariadb:// nebo sqlite:",
      "label": "Připojovací řetězec",
      "quickFill": "Rychlé vyplnění:"
    },
    "engine": {
      "label": "Databázový engine",
      "mysql": "MySQL / MariaDB",
      "postgres": "PostgreSQL",
      "sqlite": "SQLite"
    },
    "fields": {
      "database": "Databáze",
      "host": "Hostitel",
      "password": "Heslo",
      "port": "Port",
      "preview": "Náhled připojovacího řetězce:",
      "ssl": "Režim SSL",
      "user": "Uživatel"
    },
    "file": {
      "columns": "sloupců",
      "detectedAs": "Rozpoznáno: {format}",
      "dropHint": "SQL DDL / pg_dump, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, modely Django, Adminium JSON",
      "dropTitle": "Přetáhněte sem soubor schématu, nebo procházejte",
      "errorTitle": "Soubor se nepodařilo zpracovat",
      "moreWarnings": "+{count} dalších varování — úplný seznam se zobrazí v kroku analýzy.",
      "parseFailed": "Tento soubor se nepodařilo zpracovat. Pokud automatická detekce odhadla špatně, zvolte formát ručně a zkuste to znovu.",
      "parsing": "Načítání nahraného souboru schématu…",
      "pitch": "Není potřeba připojení k databázi — zpracujeme váš soubor schématu a postavíme stejné nástěnky.",
      "requestFailed": "Nahrání se nezdařilo — zkontrolujte připojení a zkuste to znovu.",
      "tables": "tabulek",
      "unsupported": "Tento formát nebyl rozpoznán — podporovány jsou SQL DDL, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, modely Django a Adminium JSON. Zvolte jeden ručně a zkuste to znovu.",
      "warnings": "varování"
    },
    "format": {
      "auto": "Rozpoznat automaticky",
      "django": "Django models.py",
      "drizzle": "Drizzle ORM",
      "helper": "Ponechte automatickou detekci, pokud se nemýlí.",
      "json": "Adminium JSON",
      "label": "Formát schématu",
      "prisma": "Schéma Prisma",
      "rails": "Rails schema.rb",
      "sequelize": "Modely Sequelize",
      "sql": "SQL DDL / pg_dump",
      "typeorm": "Entity TypeORM"
    },
    "mode": {
      "dsn": "Připojovací řetězec",
      "fields": "Jednotlivá pole",
      "file": "Soubor schématu"
    },
    "modeLabel": "Režim zadání zdroje",
    "name": "Název připojení",
    "namePlaceholder": "Produkční Postgres",
    "readOnlyRole": {
      "body": "Při nastavení čte Adminium pouze metadata schématu — nikdy vaše řádky. Doporučujeme vyhrazeného uživatele s právy pouze pro SELECT; kde bude Adminium uchovávat vlastní tabulky, určíte v kroku úložiště metadat.",
      "title": "Použijte roli jen pro čtení"
    },
    "sqlite": {
      "file": "Cesta k souboru databáze",
      "helper": "SQLite je soubor, ne server — zadejte absolutní cestu na stroji, kde běží Adminium."
    },
    "subtitle": "Nasměrujte Adminium na databázi a my z jejího schématu vygenerujeme administrační nástěnku.",
    "title": "Připojte svou databázi"
  },
  "storage": {
    "actionFailed": "To se nepovedlo",
    "add": "Přidat cíl úložiště",
    "availableOnDisk": "{size} k dispozici na tomto disku",
    "default": "Výchozí",
    "defaultBlockedByDisabled": "Vypnutý cíl nemůže být výchozí. Nejprve ho zapněte.",
    "delete": {
      "blockedBody": "{name} stále obsahuje {count, plural, one {# soubor} few {# soubory} many {# souboru} other {# souborů}}. Nejprve je přesuňte do jiného cíle a pak ho smažte.",
      "blockedTitle": "Tento cíl stále obsahuje soubory",
      "body": "Adminium zapomene {name} i jeho přihlašovací údaje. Ničeho, co je v něm uloženo, se to nedotkne — bucket nebo server patří vám, a dokud jsou u něj evidované nějaké soubory, smazání se odmítne.",
      "confirm": "Smazat cíl",
      "title": "Smazat tento cíl"
    },
    "deleteButton": "Smazat",
    "disable": "Vypnout",
    "disabled": "Vypnutý",
    "driver": {
      "local": "Cesta na tomto stroji",
      "s3": "Bucket kompatibilní s S3",
      "webdav": "Server WebDAV"
    },
    "edit": "Upravit",
    "editor": {
      "createTitle": "Přidat cíl úložiště",
      "editTitle": "Upravit cíl úložiště",
      "subtitle": "Adminium přes tento cíl čte a zapisuje vaším jménem; je to infrastruktura, kterou ovládáte vy."
    },
    "enable": "Zapnout",
    "field": {
      "accessKeyId": "ID přístupového klíče",
      "bucket": "Bucket",
      "driver": "Druh",
      "driverLocked": "Změna druhu u cíle, který už obsahuje soubory, by tyto soubory znepřístupnila.",
      "endpoint": "Koncový bod",
      "endpointDerived": "Pro samotné AWS nechte prázdné — koncový bod vyplyne z regionu.",
      "name": "Název",
      "namePlaceholder": "Bucket pro nahrané soubory",
      "password": "Heslo",
      "pathStyle": "Adresování cestou",
      "pathStyleToggle": "Adresovat bucket cestou místo názvem hostitele",
      "prefix": "Předpona",
      "prefixHelper": "Složka uvnitř cíle. Dva cíle nad jedním bucketem, které se liší jen zde, sdílejí bucket, ale ne jmenný prostor.",
      "preset": "Poskytovatel",
      "presetHelper": "Vyplní koncový bod, region a způsob adresování. Co poskytovatel o vašem účtu vědět nemůže, zůstane prázdné, abyste to doplnili.",
      "publicBaseUrl": "Veřejná základní URL",
      "publicBaseUrlHelper": "Nepovinné. Kde jsou tyto objekty čitelné bez Adminia — CDN před veřejným bucketem. Použije se, jen když sloupec ukládá odkaz.",
      "region": "Region",
      "root": "Adresář",
      "rootHelper": "Absolutní cesta, do které tento server smí zapisovat — připojený svazek nebo síťové sdílení. Ne výchozí adresář, ten je v seznamu už jako první položka.",
      "secretAccessKey": "Tajný přístupový klíč",
      "secretKept": "Klíč je uložen. Chcete-li ho zachovat, nechte obě pole prázdná; chcete-li ho nahradit, vyplňte obě.",
      "url": "URL kolekce",
      "urlHelper": "Kolekce, do které Adminium zapisuje, tak jak ji publikuje váš server.",
      "username": "Uživatelské jméno"
    },
    "fileCount": "{count, plural, one {# soubor} few {# soubory} many {# souboru} other {# souborů}}",
    "kind": {
      "archive": "Archivované dávky auditního logu",
      "branding": "Logo workspace",
      "export": "Soubory z exportů dat",
      "import": "Nahrané soubory CSV a jejich chybové reporty",
      "schema": "Importované soubory schématu",
      "upload": "Soubory přiložené k záznamům"
    },
    "list": {
      "subtitle": "Nové soubory míří do výchozího cíle. Stávající soubory zůstávají tam, kde jsou, dokud je nepřesunete.",
      "title": "Cíle úložiště"
    },
    "loadFailed": {
      "forbidden": "Změna místa, kam se soubory ukládají, vyžaduje oprávnění „Spravovat úložiště“. Požádejte správce, aby ho přidal některé z vašich rolí.",
      "title": "Cíle úložiště se nepodařilo načíst"
    },
    "localDisk": "Disk tohoto serveru",
    "move": {
      "from": "Odkud",
      "kinds": "Omezit na",
      "kindsHelp": "Nechte vše nezaškrtnuté, chcete-li přesunout všechny. Nahrané soubory jsou ty, které lidé přikládají; zbytek jsou artefakty, které vytvořilo Adminium.",
      "open": "Přesunout soubory…",
      "start": "Spustit přesun",
      "startedBody": "Běží na pozadí jako úloha {jobId} a pokračuje, i když tuto stránku opustíte. Počty níže se s přibývajícími soubory mění — načtěte stránku znovu, abyste je viděli.",
      "startedTitle": "Přesun byl zahájen",
      "subtitle": "Zkopíruje každý soubor z jednoho cíle do druhého a pak na starou kopii zapomene. Stahování po celou dobu funguje dál.",
      "title": "Přesunout soubory",
      "to": "Kam"
    },
    "preset": {
      "aws": "AWS S3",
      "b2": "Backblaze B2",
      "minio": "MinIO nebo jiný server kompatibilní s S3",
      "r2": "Cloudflare R2",
      "spaces": "DigitalOcean Spaces",
      "tigris": "Tigris",
      "wasabi": "Wasabi"
    },
    "save": "Uložit cíl",
    "secret": {
      "partialBody": "Vyplňte obě pole, chcete-li uložené přihlašovací údaje nahradit, nebo obě vymažte, chcete-li je zachovat. Uložení jen jednoho z nich by tiše ponechalo ty staré.",
      "partialTitle": "Neúplné přihlašovací údaje nejsou přihlašovací údaje"
    },
    "setDefault": "Nastavit jako výchozí",
    "status": {
      "error": "Nedostupný",
      "ok": "Dostupný",
      "untested": "Neotestovaný"
    },
    "subtitle": "Kam tato instance ukládá nahrané soubory, exporty a další uložená data.",
    "test": {
      "button": "Otestovat",
      "failed": "Tento cíl se nepodařilo kontaktovat",
      "ok": "Dostupný za {ms} ms",
      "unreachable": "Test se nepodařilo spustit"
    },
    "title": "Úložiště",
    "usedBytes": "{size} využito"
  },
  "tables": {
    "emptyBody": "Tato databáze zatím nemá žádné tabulky. Přesto můžete pokračovat — jakmile tabulky vytvoříte, načtěte je pomocí „Znovu introspektovat“ u tohoto připojení.",
    "emptyFileBody": "Tento soubor schématu nedefinuje žádné tabulky. Vraťte se a nahrajte jiný soubor, nebo přesto pokračujte.",
    "emptyFilter": "Žádné tabulky neodpovídají filtru.",
    "emptyTitle": "Nenalezeny žádné tabulky",
    "highVolume": "velký objem",
    "highVolumeNote": "Tabulky s více než 100 000 řádky začínají odškrtnuté — provozní tabulky do nástěnky patří jen zřídka.",
    "importNoCounts": "Soubory se schématem neobsahují počty řádků — sloupec zobrazuje —, dokud nepřipojíte živou databázi.",
    "joinHidden": "{count} spojovacích/systémových tabulek je předem skryto — vztahy M:N ale stále zajišťují.",
    "listLabel": "Tabulky k zahrnutí",
    "pii": "PII",
    "search": "Filtrovat tabulky…",
    "subtitle": "Zvolte, které zahrnout. Kdykoli to můžete změnit.",
    "title": "Vyberte tabulky"
  },
  "test": {
    "errorTitle": "Připojení se nezdařilo",
    "hint": {
      "auth": "Ověření se nezdařilo — zkontrolujte uživatelské jméno a heslo v DSN.",
      "hostUnreachable": "Hostitel je nedostupný — zkontrolujte název hostitele a port a že databáze přijímá připojení z tohoto stroje (povolte naše IP adresy).",
      "metaPlacement": "Tento zdroj nemůže hostit meta tabulky Adminia — pokračujte se samostatnou meta databází.",
      "permission": "Role se připojila, ale nemá oprávnění číst schéma — udělte introspekční roli právo USAGE na schéma.",
      "timeout": "Databáze neodpověděla včas — zkontrolujte síťovou cestu a zátěž a zkuste to znovu.",
      "tls": "Vyjednávání TLS se nezdařilo — zkuste sslmode=require, nebo nahrajte certifikát CA, který váš server očekává.",
      "unknown": "Připojení se nezdařilo — ověřte DSN a zkuste to znovu."
    },
    "log": {
      "connectFailed": "Připojení se nezdařilo.",
      "connected": "Připojeno ({latency} ms) · introspekce jen pro čtení",
      "connecting": "Navazuje se zabezpečené připojení…",
      "detected": "Zjištěno {tables} tabulek · {columns} sloupců",
      "found": "Nalezeno {tables} tabulek · {columns} sloupců",
      "jobFailed": "Introspekce se nezdařila.",
      "mapping": "Mapování typů sloupců → vstupní widgety",
      "moreWarnings": "+{count} dalších varování parseru",
      "networkFailed": "Požadavek se nezdařil — zkontrolujte připojení a zkuste to znovu.",
      "parsingFile": "Zpracovává se {file}…",
      "piiDone": "Kontrola PII dokončena — {count} sloupců ve výchozím stavu maskováno",
      "piiDoneUnknown": "Kontrola PII dokončena",
      "piiScan": "Vyhledávání sloupců s PII…",
      "readingFile": "Načítání nahraného souboru schématu…",
      "readingSchema": "Čtení schématu: public",
      "ready": "Připraveno",
      "relations": "Zjišťování vztahů…"
    },
    "logLabel": "Protokol introspekce",
    "retry": "Zkusit znovu",
    "subtitle": "Probíhá introspekce tabulek, sloupců a vztahů. Zabere to pár sekund.",
    "title": "Analýza vašeho schématu",
    "trust": "Vaše schéma a data pouze čteme. Nic se nemění."
  },
  "title": "Studio",
  "wizard": {
    "back": "Zpět",
    "bridgeAppliedBody": "Předán z adminium.dev vaším prohlížečem — putoval přímo do tohoto počítače a nikdy nebyl nahrán na server. Zkontrolujte jej níže a pokračujte.",
    "bridgeAppliedTitle": "Připojovací řetězec přijat",
    "bridgeFailedBody": "Už bylo použito nebo vypršelo. Vložte svůj připojovací řetězec níže ručně.",
    "bridgeFailedTitle": "Toto předání se nepodařilo použít",
    "continue": "Pokračovat",
    "persistFailed": "Výběr tabulek se nepodařilo uložit — zkuste to znovu.",
    "persistFailedTitle": "Uložení se nezdařilo",
    "progress": "Průběh nastavení",
    "startOver": {
      "action": "Začít znovu",
      "body": "Vše zde zadané se smaže a průvodce se vrátí na první krok.",
      "bodyCreated": "Vše zde zadané se smaže a průvodce se vrátí na první krok. Připojení, které už Adminium vytvořilo, se nesmaže — zůstane v Datových připojeních.",
      "confirm": "Začít znovu",
      "keep": "Pokračovat",
      "title": "Začít tohoto průvodce znovu?"
    },
    "step": {
      "enrich": "Obohatit",
      "generate": "Generovat",
      "intent": "Záměr",
      "meta": "Úložiště metadat",
      "source": "Zdroj",
      "tables": "Tabulky",
      "test": "Analyzovat",
      "finish": "Dokončit"
    },
    "title": "Nové připojení"
  },
  "lists": {
    "addValue": "Přidat hodnotu",
    "andMore": "a dalších {count}",
    "builtin": "Vestavěný",
    "builtinCount": "{count} hodnot",
    "builtinSubtitle": "Seznam, který Adminium dodává. Je stejný v každém pracovním prostoru a jeho názvy se zobrazují v jazyce každého čtenáře.",
    "cancel": "Zrušit",
    "close": "Zavřít",
    "copiedFrom": "kopie seznamu {key}",
    "copyTitle": "Kopie seznamu {name}",
    "create": "Vytvořit seznam",
    "delete": "Smazat",
    "deleteBody": "Seznam zmizí. Hodnoty už uložené ve vašich řádcích zůstanou přesně tak, jak jsou — seznam říká, co formulář nabízí, ne co sloupec obsahuje.",
    "deleteTitle": "Smazat {name}?",
    "edit": "Upravit",
    "editSubtitle": "Odpovědi, které sloupec s tímto seznamem přijímá, v pořadí, v jakém je formulář nabízí.",
    "editTitle": "Upravit {name}",
    "emptyBody": "Seznam je sada odpovědí, které sloupec přijímá.",
    "emptyTitle": "Zatím žádné seznamy",
    "errorUnknown": "Nepovedlo se. Zkuste to znovu.",
    "inUseBody": "Nejprve jej odeberte z {columns}.",
    "inUseNone": "Nejprve jej odeberte ze sloupců, které jej používají.",
    "inUseTitle": "{name} používá jeden ze sloupců",
    "issueBlank": "Jedna z hodnot je prázdná. Vyplňte ji, nebo řádek odeberte.",
    "issueDuplicate": "„{value}“ je v seznamu dvakrát.",
    "issueEmpty": "Seznam potřebuje alespoň jednu hodnotu.",
    "issueName": "Pojmenujte seznam.",
    "key": "Klíč",
    "keyFixed": "Pravidla tento seznam nazývají",
    "keyHelper": "Jméno, kterým tento seznam nazývají pravidla a soubory projektu. Později je nelze změnit.",
    "labelAt": "Popisek {n}",
    "labelPlaceholder": "Co lidé čtou",
    "makeCopy": "Vytvořit kopii, kterou mohu upravit",
    "moveDown": "Posunout {value} dolů",
    "moveUp": "Posunout {value} nahoru",
    "name": "Název",
    "namePlaceholder": "Oddělení",
    "new": "Nový seznam",
    "removeValue": "Odebrat {value}",
    "save": "Uložit změny",
    "storeLabel": "Ukládat místo toho popisek",
    "storeLabelHelp": "Kopie ukládá kód, například DE. „Ukládat místo toho popisek“ ukládá, jak se zde jmenuje, například Německo — v jazyce tohoto pracovního prostoru, od této chvíle.",
    "subtitle": "Odpovědi, které sloupec přijímá — pojmenované jednou a použitelné odkudkoli.",
    "title": "Seznamy",
    "valueAt": "Hodnota {n}",
    "valueCount": "{count} hodnot",
    "values": "Hodnoty",
    "view": "Zobrazit"
  },
  "apiKeys": {
    "banner": {
      "bodyOnce": "Zkopírujte si ho hned — později už ho neuvidíte. Omezen na {summary}.",
      "bodyRevealable": "Zkopírujte si ho hned — znovu ho můžete zobrazit v seznamu níže. Omezen na {summary}.",
      "copied": "Zkopírováno",
      "copy": "Kopírovat",
      "titleNamed": "{name} vytvořen"
    },
    "builder": {
      "auth": {
        "anon": "Anon",
        "authenticated": "Přihlášený",
        "label": "Požadované ověření",
        "service": "Servisní role"
      },
      "cancel": "Zrušit",
      "columns": {
        "all": "Vše",
        "label": "Zpřístupněné sloupce",
        "none": "Žádné"
      },
      "create": "Vytvořit koncový bod",
      "delete": "Smazat koncový bod",
      "deleteRefused": "Tento koncový bod stále {count, plural, one {používá # klíč} few {používají # klíče} many {používá # klíče} other {používá # klíčů}}: {names}.",
      "filters": {
        "add": "Přidat",
        "empty": "Žádné filtry — dostupný je každý řádek zdroje.",
        "label": "Výchozí filtry",
        "remove": "Odebrat filtr",
        "value": "hodnota"
      },
      "footer": {
        "applyFirst": "Nejprve upravenou definici použijte, nebo vraťte zpět."
      },
      "methodUnsupported": "Tento zdroj nemůže podporovat {method}: nemá primární klíč.",
      "methods": "Metody",
      "op": {
        "between": "mezi",
        "eq": "rovná se",
        "gt": "větší než",
        "gte": "alespoň",
        "ilike": "obsahuje (bez ohledu na velikost písmen)",
        "in": "v seznamu",
        "is_null": "je prázdné",
        "like": "obsahuje",
        "lt": "menší než",
        "lte": "nejvýše",
        "neq": "nerovná se",
        "not_null": "není prázdné",
        "today": "je dnes",
        "fromToday": "od dneška"
      },
      "paging": {
        "asc": "Vzestupně",
        "defaultLimit": "Výchozí limit",
        "desc": "Sestupně",
        "label": "Stránkování a řazení",
        "maxLimit": "Maximální limit",
        "orderBy": "Řadit podle"
      },
      "pane": {
        "apply": "Použít ve formuláři",
        "dirty": "upraveno — nepoužito",
        "format": "Formátovat",
        "label": "Definice cesty, JSON",
        "more": "{first} (+{n} dalších)",
        "revert": "Vrátit zpět",
        "synced": "synchronizováno s formulářem",
        "title": "Definice cesty"
      },
      "rate": {
        "hour": "hodinu",
        "label": "Limit požadavků a odpověď",
        "minute": "minutu",
        "per": "Za",
        "requests": "Požadavky",
        "second": "sekundu"
      },
      "refused": {
        "keys": "Uložením byste znefunkčnili {count, plural, one {# klíč} few {# klíče} many {# klíče} other {# klíčů}}: {names}."
      },
      "route": "Cesta",
      "routePlaceholder": "customers",
      "routeRename": "Volající musí přejít na novou cestu.",
      "save": "Uložit změny",
      "shape": {
        "array": "Holé pole",
        "label": "Tvar odpovědi",
        "single": "Jeden objekt",
        "wrapped": "Zabaleno v '{' data '}'"
      },
      "source": "Zdrojová tabulka nebo pohled",
      "subtitle": "Nastavte ho vizuálně — definici cesty za vás napíše Adminium",
      "titleEdit": "Upravit koncový bod",
      "titleNew": "Nový koncový bod"
    },
    "connection": {
      "label": "Připojení"
    },
    "create": "Vytvořit klíč",
    "endpoints": {
      "col": {
        "auth": "Ověření",
        "methods": "Metody",
        "rate": "Limit požadavků",
        "route": "Cesta"
      },
      "custom": "VLASTNÍ",
      "edit": "Upravit koncový bod",
      "explore": "Prozkoumat API",
      "new": "Nový koncový bod",
      "subtitle": "Vygenerováno z vašeho schématu. Klíče jsou omezeny na tyto koncové body.",
      "title": "Koncové body",
      "unavailable": "NEDOSTUPNÉ"
    },
    "keys": {
      "col": {
        "access": "Přístup",
        "actions": "Akce",
        "key": "Klíč",
        "lastUsed": "Naposledy použit",
        "name": "Název"
      },
      "count": "{n, plural, one {# klíč} few {# klíče} many {# klíče} other {# klíčů}}",
      "empty": "Žádné aktivní klíče. Začněte vytvořením prvního.",
      "hide": "Skrýt klíč",
      "kind": {
        "browser": "PROHLÍŽEČ",
        "server": "SERVER"
      },
      "never": "Nikdy",
      "reveal": "Zobrazit klíč",
      "revoke": "Odvolat",
      "revokeConfirm": {
        "body": "Vše, co tento klíč používá, okamžitě přestane fungovat. Tuto akci nelze vrátit zpět.",
        "confirm": "Odvolat klíč",
        "prompt": "Pro potvrzení napište „{name}“",
        "title": "Odvolat {name}?"
      },
      "revokeFailed": "Tento klíč se nepodařilo odvolat. Je stále aktivní.",
      "title": "Aktivní klíče",
      "untitled": "Klíč bez názvu",
      "staffOnly": "Jen obrazovka personálu",
      "staffOnlyHint": "Odpovídá jen na obrazovce, kde je přihlášen zaměstnanec s rolí {role}."
    },
    "method": {
      "BATCH": {
        "desc": "Hromadné vložení nebo upsert, až 500 řádků",
        "title": "Dávka"
      },
      "DELETE": {
        "desc": "Odebrání řádku podle primárního klíče",
        "title": "Smazání"
      },
      "GET": {
        "desc": "Výpis řádků a načtení jednoho záznamu",
        "title": "Čtení"
      },
      "PATCH": {
        "desc": "Částečná úprava řádku podle primárního klíče",
        "title": "Úprava"
      },
      "POST": {
        "desc": "Vložení nového řádku",
        "title": "Vytvoření"
      },
      "PUT": {
        "desc": "Nahrazení celého řádku podle primárního klíče",
        "title": "Nahrazení"
      }
    },
    "note": {
      "notRegistered": "Veřejné API není na tomto serveru zapnuto. Nastavte ADMINIUM_PUBLIC_API_ORIGINS a restartujte — klíče vytvořené zde budou od té chvíle fungovat.",
      "off": "Veřejné API je vypnuté, takže teď nefunguje žádný klíč.",
      "offLink": "Otevřít nastavení workspace"
    },
    "quick": {
      "body": "Požadavky ověřujte klíčem v hlavičce Authorization.",
      "title": "Rychlý start"
    },
    "sheet": {
      "allMethods": "Vybrat všechny metody",
      "app": {
        "label": "Aplikace",
        "none": "Žádná"
      },
      "cancel": "Zrušit",
      "clear": "Vymazat",
      "close": "Zavřít",
      "count": "{permissions, plural, one {oprávnění} few {oprávnění} many {oprávnění} other {oprávnění}} pro {endpoints, plural, one {# koncový bod} few {# koncové body} many {# koncového bodu} other {# koncových bodů}}",
      "deselectAll": "Zrušit výběr všech",
      "edit": "Upravit koncový bod",
      "expires": {
        "d30": "30 dní",
        "d90": "90 dní",
        "label": "Platnost vyprší",
        "never": "Nikdy"
      },
      "filter": "Filtrovat koncové body",
      "focusMeta": "{source} · řádky: {rows} · limit {limit}, řazení {order}",
      "focusMetaNoRows": "{source} · limit {limit}, řazení {order}",
      "footer": {
        "empty": "Pro vytvoření klíče vyberte alespoň jednu metodu.",
        "more": "+{n} dalších",
        "refused": "Tento klíč zatím nelze vytvořit: {issue}",
        "summary": "Tento klíč bude moci volat {paths}"
      },
      "kind": {
        "browser": "Prohlížeč",
        "label": "Používán z",
        "server": "Server"
      },
      "layout": {
        "label": "Rozvržení",
        "list": "Seznam",
        "panes": "Panely"
      },
      "name": {
        "label": "Název klíče",
        "placeholder": "např. Worker pro synchronizaci objednávek"
      },
      "newEndpoint": "Nový koncový bod",
      "readOnly": "Předvolba jen pro čtení",
      "rowMeta": "{source} · řádky: {rows}",
      "rowMetaNoRows": "{source}",
      "selectAll": "Vybrat vše",
      "selectAllShort": "Vybrat vše",
      "submit": "Vytvořit klíč",
      "subtitle": "Vyberte koncové body a metody, které tento klíč smí volat",
      "title": "Vytvořit klíč API",
      "toggleAll": "Přepnout všechny metody",
      "unsupported": "{count, plural, one {{methods} není na této cestě zpřístupněna. Upravte koncový bod a povolte ji.} few {{methods} nejsou na této cestě zpřístupněny. Upravte koncový bod a povolte je.} many {{methods} nejsou na této cestě zpřístupněny. Upravte koncový bod a povolte je.} other {{methods} nejsou na této cestě zpřístupněny. Upravte koncový bod a povolte je.}}"
    },
    "stats": {
      "endpoints": "Koncové body",
      "keys": "Aktivní klíče",
      "requests": "Požadavky · 24 h"
    },
    "subtitle": "Spravujte programový přístup ke svému pracovnímu prostoru",
    "summary": "{endpoints, plural, one {# koncový bod} few {# koncové body} many {# koncového bodu} other {# koncových bodů}} · {methods, plural, one {# metoda} few {# metody} many {# metody} other {# metod}}",
    "title": "Klíče API a tokeny"
  },
  "surfacePages": {
    "guest": {
      "title": "{app} teď není k dispozici.",
      "body": "Zkuste to prosím později."
    },
    "staff": {
      "appOff": "{app} je zatím vypnutá.",
      "sideOff": "Obrazovky pro personál aplikace {app} jsou vypnuté.",
      "advice": "Požádejte vedoucího, aby ji zapnul v {app} → Nastavení.",
      "signOut": "Odhlásit se",
      "noAccess": "Tento účet nemůže otevřít {app}.",
      "noAccessAdvice": "Požádejte svého vedoucího o roli, která otevírá {app}."
    },
    "notFound": {
      "title": "Stránka nenalezena",
      "body": "Na této adrese nic není. Zkontrolujte odkaz a zkuste to znovu."
    }
  },
  "appSettings": {
    "notInstalled": "Tato aplikace není nainstalována",
    "backToApps": "Zpět na aplikace",
    "statusDisabled": "Vypnuto",
    "statusUpdate": "Dostupná aktualizace · {version}",
    "statusActive": "Aktivní",
    "version": "Verze {version} · od {publisher}",
    "open": "Otevřít aplikaci",
    "upToDate": "Aktuální",
    "update": "Aktualizovat",
    "saveFailed": "Změna nebyla uložena",
    "screens": "Sady obrazovek",
    "sideStaff": "Obrazovky pro personál",
    "sideCustomer": "Obrazovky pro zákazníky",
    "sideAppOff": "Celá aplikace je vypnutá.",
    "staffOnHelp": "Váš tým se sem přihlašuje vlastními účty.",
    "customerOnHelp": "Tyto stránky používají zákazníci. Jsou veřejné.",
    "staffOffHelp": "Tyto obrazovky se neposkytují. Nic nebylo smazáno.",
    "customerOffHelp": "Zákazníci vidí „není k dispozici“. Nic nebylo smazáno.",
    "sideSwitch": "{side}, zapnuto nebo vypnuto",
    "on": "Zapnuto",
    "off": "Vypnuto",
    "whereItLives": "Kde běží",
    "ownAddress": "Na vlastní adrese",
    "insideDashboard": "Uvnitř dashboardu",
    "copyAddress": "Kopírovat adresu",
    "copied": "Zkopírováno",
    "copy": "Kopírovat",
    "addDomain": "Přidat doménu",
    "preview": "Náhled",
    "domainField": "Doména",
    "addDomainSave": "Přidat",
    "data": "Data",
    "noTables": "Tato aplikace nepoužívá žádné tabulky.",
    "rows": "{count, plural, one {# řádek} few {# řádky} many {# řádku} other {# řádků}}",
    "activity": {
      "staged": "Nahrál(a) {actor}",
      "installed": "Nainstaloval(a) {actor}",
      "updated": "Aktualizoval(a) {actor}",
      "disabled": "Vypnul(a) {actor}",
      "enabled": "Zapnul(a) {actor}",
      "settings": "Nastavení změnil(a) {actor}",
      "domains": "Domény změnil(a) {actor}",
      "instances": "Instance změnil(a) {actor}",
      "renamed": "Tabulky přejmenoval(a) {actor}",
      "title": "Aktivita",
      "none": "Zatím nic.",
      "sampleAdded": "Ukázková data přidal(a) {actor}",
      "sampleRemoved": "Ukázková data odstranil(a) {actor}"
    },
    "danger": "Nebezpečná zóna",
    "disabledNote": "Aplikace je vypnutá. Zapnutí vrátí přesně to, co tam bylo.",
    "disableNote": "Skryje aplikaci všude a zastaví její koncové body. Nic se nesmaže.",
    "enable": "Zapnout",
    "disable": "Vypnout",
    "uninstallNote": "Odstraní soubory a stránky aplikace. Tabulky a data zůstanou.",
    "uninstall": "Odinstalovat",
    "disableTitle": "Vypnout {app}?",
    "close": "Zavřít",
    "nothingDeleted": "Nic se nesmaže.",
    "enableBrings": "Zapnutí vrátí přesně to, co tam bylo.",
    "cancel": "Zrušit",
    "disableLine1": "Její sekce se všem skryje.",
    "disableLine2": "Její obrazovky a vlastní koncové body přestanou odpovídat.",
    "disableLine3": "Tabulky, záznamy a nastavení zůstanou, jak jsou.",
    "crumb": "Aplikace",
    "sampleLedger": "Seznam ukázkových záznamů Adminia"
  },
  "uninstall": {
    "files": "Soubory aplikace",
    "pages": "{count, plural, one {# stránka} few {# stránky} many {# stránky} other {# stránek}}",
    "keys": "{count, plural, one {Její klíč prohlížeče} few {Její # klíče prohlížeče} many {Jejích # klíče prohlížeče} other {Jejích # klíčů prohlížeče}}",
    "settings": "Její nastavení",
    "hosts": "{count, plural, one {Její doména} few {Její # domény} many {Jejích # domény} other {Jejích # domén}}",
    "tables": "{count, plural, one {# tabulka a všechny její záznamy} few {# tabulky a všechny jejich záznamy} many {# tabulky a všechny jejich záznamy} other {# tabulek a všechny jejich záznamy}}",
    "editedPages": "Stránky, které jste upravili, zůstanou jako běžné stránky",
    "audit": "Její záznamy v auditním logu",
    "title": "Odinstalovat {app}?",
    "close": "Zavřít",
    "planFailed": "Co by bylo odstraněno, se nepodařilo načíst",
    "removed": "Odstraněno",
    "kept": "Ponecháno",
    "roleCascade": "Odstraněním této role ji ztratí {members, plural, one {# osoba} few {# osoby} many {# osoby} other {# osob}} a smaže se {keys, plural, one {# navázaný klíč API} few {# navázané klíče API} many {# navázaného klíče API} other {# navázaných klíčů API}}. Tyto klíče okamžitě přestanou fungovat.",
    "dropTitle": "Smazat i její tabulky a data",
    "dropBody": "{count, plural, one {Smaže # tabulku, kterou vytvořila, se všemi záznamy.} few {Smaže # tabulky, které vytvořila, se všemi záznamy.} many {Smaže # tabulky, které vytvořila, se všemi záznamy.} other {Smaže # tabulek, které vytvořila, se všemi záznamy.}} Nelze vrátit zpět.",
    "typeKey": "Pro potvrzení zadejte klíč aplikace {key}.",
    "failed": "Aplikace nebyla odinstalována",
    "cancel": "Zrušit",
    "confirmDrop": "Odinstalovat a smazat data",
    "confirm": "Odinstalovat",
    "rules": "{count, plural, one {Její pravidlo sloupce} few {Její # pravidla sloupců} many {Jejích # pravidla sloupců} other {Jejích # pravidel sloupců}}"
  },
  "sampleData": {
    "title": "Ukázková data",
    "add": "Přidat ukázková data",
    "installNote": "několik ukázkových záznamů v tabulkách aplikace, abyste ji měli na čem vyzkoušet. Odstraníte je jedním kliknutím.",
    "remove": "Odstranit ukázková data",
    "keptNotice": "{count, plural, one {# ukázkový záznam zůstává: používají ho vaše vlastní záznamy, nebo jste ho změnili.} few {# ukázkové záznamy zůstávají: používají je vaše vlastní záznamy, nebo jste je změnili.} many {# ukázkového záznamu zůstává: používají ho vaše vlastní záznamy, nebo jste ho změnili.} other {# ukázkových záznamů zůstává: používají je vaše vlastní záznamy, nebo jste je změnili.}}",
    "notLoaded": "Nenačteno",
    "loadedCount": "Načteno · {count, plural, one {# záznam} few {# záznamy} many {# záznamu} other {# záznamů}}",
    "loaded": "Načteno · {count, plural, one {# záznam} few {# záznamy} many {# záznamu} other {# záznamů}} · {date}",
    "addSubtitle": "Do {connection}",
    "close": "Zavřít",
    "addBodyNoConnection": "Několik ukázkových záznamů v tabulkách aplikace. Nic jiného se nezmění.",
    "addBody": "Několik ukázkových záznamů v tabulkách aplikace. Nic jiného v {connection} se nezmění.",
    "images": "Obrázky, přidané do Souborů",
    "total": "Celkem",
    "records": "{count, plural, one {# záznam} few {# záznamy} many {# záznamu} other {# záznamů}}",
    "none": "Tato aplikace nemá žádná ukázková data",
    "adding": "Přidávají se ukázková data",
    "addFailed": "Ukázková data nebyla přidána",
    "addFailedBody": "Ukázková data nebyla přidána. Nic nebylo zapsáno.",
    "cancel": "Zrušit",
    "removeSubtitle": "{count, plural, one {# záznam přidaný {date}} few {# záznamy přidané {date}} many {# záznamu přidaného {date}} other {# záznamů přidaných {date}}}",
    "removeBody": "Adminium si vedlo seznam všech záznamů, které přidalo, takže odstraní přesně ty.",
    "planFailed": "Nepodařilo se načíst, co by se odstranilo",
    "removes": "Odstraní se",
    "kept": "Zůstane",
    "usedBy": "{count, plural, one {používá ho # z vašich vlastních záznamů} few {používají ho # z vašich vlastních záznamů} many {používá ho # z vašich vlastních záznamů} other {používá ho # z vašich vlastních záznamů}}",
    "keepChanged": "Ponechat ty, které jsem změnil(a)",
    "changedList": "{count, plural, one {# ukázkový záznam, který jste upravili: {names}.} few {# ukázkové záznamy, které jste upravili: {names}.} many {# ukázkového záznamu, které jste upravili: {names}.} other {# ukázkových záznamů, které jste upravili: {names}.}}",
    "removeFailed": "Ukázková data nebyla odstraněna",
    "removeConfirm": "Odstranit",
    "banner": "Ukázková data jsou načtena",
    "bannerRemove": "Odstranit je"
  },
  "appPublicAccess": {
    "title": "Veřejný přístup",
    "intro": "Zákaznické obrazovky aplikace potřebují:",
    "availability": "Číst volné nebo obsazené časy v {table}",
    "claim": "Vyhledat své vlastní {table} podle {fields}",
    "claimByLink": "Vyhledat své vlastní {table} přes odkaz, který jim přijde",
    "create": "Přidávat do {table}",
    "update": "Měnit {table}",
    "read": "Číst {table}",
    "later": "přijde v pozdější verzi",
    "allow": "Povolit tento veřejný přístup",
    "helper": "Později jej můžete omezit na stránce Klíče API.",
    "cannotGrant": "Povolit jej může jen ten, kdo smí spravovat klíče API, proto se aplikace nainstaluje bez něj.",
    "opensWithoutStaff": "Umožnit komukoli s odkazem otevřít, co čte klíč {key}, bez přihlášeného pracovníka",
    "warning": {
      "apiOff": "Veřejné API je vypnuté, takže nic z toho neodpoví, dokud nebude zapnuté.",
      "originSelf": "Povolené původy neobsahují „self“, takže vlastní stránky aplikace na tomto serveru je nemohou volat.",
      "timeZone": "Tato databáze nemá nastavené časové pásmo, které veřejné API potřebuje pro data a časy.",
      "noEmail": "E-mail není nastaven, takže hosté nedostanou potvrzení.",
      "noEmailSignIn": "E-mail není nastaven, takže nikomu nelze poslat přihlašovací odkaz.",
      "noPublicAddress": "Tato aplikace nemá veřejnou adresu, takže nelze poslat přihlašovací odkaz. Přiřaďte doménu její zákaznické části, nebo nastavte veřejnou adresu serveru."
    },
    "createConfirmed": "Přidávat do {table} a dostat potvrzovací e-mail"
  },
  "addOnNeeded": {
    "appDisabled": "Vypnutá – stále ho potřebuje",
    "appInstalling": "Instalace není dokončená – stále ho potřebuje",
    "close": "Zavřít",
    "confirm": {
      "switchOff": "Přesto vypnout",
      "uninstall": "Přesto odinstalovat"
    },
    "lead": {
      "feature": "{features} v aplikaci {app} se vypne.",
      "switchOff": "{addOn} nelze pro {app} vypnout. {app} ho potřebuje.",
      "uninstall": "{addOn} nelze odinstalovat. {count, plural, one {{apps} ho potřebuje.} few {{apps} ho potřebují.} many {{apps} ho potřebují.} other {{apps} ho potřebují.}}"
    },
    "note": {
      "feature": "Zbytek aplikace {apps} funguje i bez něj.",
      "switchOff": "Chcete-li ho vypnout, nejprve odinstalujte {app}.",
      "uninstall": "Chcete-li ho odinstalovat, nejprve odinstalujte {apps}."
    },
    "openApp": "Otevřít {app}",
    "subtitle": "v{version}",
    "subtitleNamed": "{addOn} · v{version}",
    "title": {
      "switchOff": "Vypnout pro {app}",
      "switchOffAsk": "Vypnout pro {app}?",
      "uninstall": "Odinstalovat {addOn}",
      "uninstallAsk": "Odinstalovat {addOn}?"
    },
    "useFeature": "{app} (Potřebné pro: {features})",
    "useRequired": "{app} (Povinné)",
    "useSuggested": "{app} (Doporučené)",
    "usedBy": "Používá",
    "usedByLine": "Používá: {apps}"
  },
  "appAddOns": {
    "alsoUsedBy": "Používá ho také: {apps}",
    "block": {
      "download": "Nejprve stáhněte {addOn}: je v katalogu doplňků, ale na tomto serveru zatím není.",
      "noVersion": "{app} potřebuje {addOn} {version} a žádná taková verze tu není k dispozici.",
      "problem": "{addOn} nelze nainstalovat s {app}. Důvod je uveden v jeho řádku.",
      "tooOld": "{app} potřebuje {addOn} {version}.",
      "unavailable": "{app} potřebuje {addOn}, který tu není k dispozici.",
      "untick": "{addOn} tu nelze s {app} použít. Zrušte jeho zaškrtnutí a nainstalujte {app} bez něj."
    },
    "card": {
      "connect": "Připojit",
      "connected": "{addOn} připojen k {app}",
      "consentConnect": "Bude připojen k {app}.",
      "featureOff": "{features} je vypnuto: jeho stránky nejsou v postranním panelu, dokud nebude {addOn} nainstalován a připojen.",
      "install": "Nainstalovat",
      "installed": "{addOn} nainstalován a připojen k {app}",
      "metaAbsent": "Nenainstalováno · v{version} · {source}",
      "metaInstalled": "Nainstalováno · v{version} · {source}",
      "metaOld": "Nainstalováno · v{version}",
      "metaUnavailable": "Nenainstalováno · {source}",
      "notConnected": "Nepřipojeno k {app}",
      "openSettings": "Otevřít jeho nastavení"
    },
    "done": {
      "installed": "Nainstalováno také: {names}. {count, plural, one {Jeho nastavení najdete} few {Jejich nastavení najdete} many {Jejich nastavení najdete} other {Jejich nastavení najdete}} v sekci {addOns}.",
      "updated": "Aktualizováno také: {names}. {count, plural, one {Jeho nastavení najdete} few {Jejich nastavení najdete} many {Jejich nastavení najdete} other {Jejich nastavení najdete}} v sekci {addOns}."
    },
    "download": "Stáhnout",
    "downloading": "Stahování… {pct} %",
    "grant": "{roles} bude moci měnit jeho nastavení, které sdílejí všechny aplikace, jimž slouží.",
    "howTo": "Jak přidat doplněk",
    "intro": "{app} spolupracuje s {count, plural, one {tímto doplňkem} few {těmito doplňky} many {těmito doplňky} other {těmito doplňky}}.",
    "meta": "v{version} · {source}",
    "needsFloor": "{app} potřebuje verzi {version} nebo novější",
    "needsRange": "{app} potřebuje {range}",
    "orLater": "{version} nebo novější",
    "pill": {
      "feature": "Potřebné pro: {features}",
      "required": "Povinné",
      "suggested": "Doporučené"
    },
    "plan": {
      "creates": "Vytvoří {count, plural, one {# tabulku} few {# tabulky} many {# tabulky} other {# tabulek}} v {connection}: {tables}"
    },
    "running": {
      "attach": "Připojuje se {addOn}",
      "connected": "připojeno",
      "install": "Instaluje se {addOn}",
      "update": "Aktualizuje se {addOn}"
    },
    "shared": "Doplňky jsou sdílené. Může je používat i každá další aplikace, kterou nainstalujete.",
    "source": {
      "bundled": "Dodává se s Adminiem",
      "catalog": "Z katalogu doplňků",
      "none": "Nedodává se s tímto Adminiem a katalog doplňků nemá žádnou použitelnou verzi",
      "off": "Nedodává se s tímto Adminiem a katalog doplňků je vypnutý",
      "upload": "Nahráno do tohoto Adminia"
    },
    "status": {
      "attached": "Už je připojen k {app}",
      "downloadFirst": "Nainstaluje se, jakmile se stáhne z katalogu doplňků",
      "tooOld": "Nainstalováno v{installed} – {need}",
      "unavailable": "{addOn} není v tomto Adminiu k dispozici",
      "willConnect": "Nainstalováno · v{version} · bude připojen k {app}",
      "willInstall": "Bude nainstalován",
      "wontConnect": "Nainstalováno · v{version} · nebude připojen"
    },
    "stopped": {
      "atAddOns": "Instalace potřebných doplňků selhala, takže nic dalšího neproběhlo."
    },
    "title": "Doplňky",
    "uninstall": {
      "kept": "{addOn} zůstane nainstalován. Pokud ho nic jiného nepoužívá, odinstalujte ho v sekci Doplňky.",
      "link": "Jeho propojení s {addOn}"
    },
    "updateToo": "Aktualizovat také"
  },
  "featurePage": {
    "ask": "Může ho nainstalovat někdo, kdo spravuje aplikace.",
    "body": "Tato stránka funguje jen s {count, plural, one {doplňkem} few {doplňky} many {doplňky} other {doplňky}}, který tu aplikace zatím nemá, proto není v postranním panelu. Vrátí se, jakmile bude {count, plural, one {nainstalován a připojen} few {nainstalovány a připojeny} many {nainstalovány a připojeny} other {nainstalovány a připojeny}} k aplikaci.",
    "open": "Otevřít nastavení aplikace",
    "title": "{page} potřebuje doplněk"
  }
} as const;
