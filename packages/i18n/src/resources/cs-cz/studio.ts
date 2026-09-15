// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/studio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
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
    "ceiling": {
      "authorise": "Autorizovat tento přepis",
      "body": "{table} má přes {rows} řádků — víc, než Adminium přepisuje samo. Autorizovat to může jen Super Admin a tabulka bude po celou dobu přepisu zamčená.",
      "hint": "Napište název tabulky přesně tak, jak je uveden výše.",
      "notYours": "{table} má přes {rows} řádků. Přepis takového rozsahu může autorizovat jen Super Admin — požádejte ho, nebo změnu proveďte v servisním okně vlastními nástroji.",
      "prompt": "Pro autorizaci přepisu napište {table} znovu"
    },
    "column": {
      "help": "Co tato nastavení znamenají?",
      "key": "Klíč",
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
    "designer": "Návrhář tabulek",
    "discard": "Zahodit změny",
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
      "name": "Název tabulky",
      "nameHelp": "Malá písmena, číslice a podtržítka.",
      "namePlaceholder": "reservations",
      "noKey": "Tato tabulka nemá primární klíč, takže s ní Adminium bude zacházet jen pro čtení — řádky lze vypsat, ale ne upravovat.",
      "renameHelp": "Změna přejmenuje tabulku ve vaší databázi.",
      "uuidKeyUnavailable": "Na tomto enginu musí být klíč generované celé číslo: uuid generované databází nelze po vložení přečíst zpět."
    },
    "unnamed": "Pojmenujte každou tabulku a sloupec, abyste mohli změny zkontrolovat.",
    "unrepresentableDefaults": "Tyto sloupce si ponechávají výchozí hodnotu generovanou databází, kterou zde Adminium nemůže upravit, a zůstává beze změny: {columns}"
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
    "unbound": "Ještě vyplnit: {slots}"
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
    "title": "Vygenerujte svou aplikaci"
  },
  "hostedApps": {
    "domains": {
      "add": "Připojit doménu",
      "hostLabel": "Host",
      "instanceLabel": "Instance",
      "instanceOwn": "Samotná aplikace",
      "issuesTitle": "Mapa domén byla odmítnuta",
      "none": "Žádné domény nejsou připojeny.",
      "remove": "Odebrat",
      "save": "Uložit domény",
      "savedBody": "Přiřazení se projeví během několika sekund. Host odpovídá, až když jeho DNS a váš proxy server tuto instanci skutečně dosáhnou.",
      "savedTitle": "Uloženo",
      "subtitle": "Nasměrujte DNS domény na svůj proxy server, předávejte hlavičku Host do Adminia a připojte ji zde — tento host pak obsluhuje plochu místo tohoto dashboardu. Certifikáty zůstávají na vašem proxy serveru.",
      "surfaceLabel": "Plocha",
      "title": "Domény"
    },
    "emptyBody": "Nasměrujte ADMINIUM_SURFACES_DIR na adresář sestavených ploch — složka pro každou aplikaci a stranu, každá se svým index.html — a restartujte. Poté se obsluhují pod /apps/ a objeví se zde.",
    "emptyTitle": "Žádné aplikační plochy se neobsluhují",
    "error": "Něco se pokazilo",
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
        "summary": "{created} vytvořeno · {reused} znovu použito"
      },
      "done": {
        "title": "Nainstalováno",
        "body": "{key} se už servíruje. Níže vyberte, kde se má objevit její část pro personál.",
        "schema": "Vytvořené tabulky: {created} · znovu použité: {reused}"
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
      "uploaded": {
        "hint": "Načteno ze souboru manifest.json v balíčku, který jste nahráli. Dokud nepotvrdíte plán schématu, nic se nevytvoří.",
        "replace": "Nahrát jiný balíček"
      }
    },
    "installed": {
      "title": "Nainstalované aplikace",
      "install": "Nainstalovat aplikaci",
      "emptyTitle": "Zatím není nainstalována žádná aplikace",
      "emptyBody": "Nahrajte sestavený balíček rozhraní a nainstalujte ji. Aplikace nainstalované zde se servírují okamžitě — bez restartu, na rozdíl od adresáře.",
      "uninstall": "Odinstalovat",
      "confirmTitle": "Odinstalovat tuto aplikaci?",
      "confirmBody": "Její rozhraní se přestanou servírovat a balíček se smaže. Tabulky, které vytvořila ve vaší databázi, zůstanou nedotčené.",
      "confirmPrompt": "Pro potvrzení napište {key}",
      "confirmCancel": "Zrušit",
      "confirmClose": "Zavřít",
      "stagedTitle": "Nahráno, ale nenainstalováno",
      "stagedHint": "Zahoďte ten, který jste zavrhli, nebo nahrajte stejný klíč znovu a nahraďte jej.",
      "discard": "Zahodit",
      "installedAt": "nainstalováno {when}"
    },
    "browse": {
      "title": "Aplikace k instalaci",
      "subtitle": "Hotové aplikace dodané s tímto buildem. Instalace vytvoří potřebné tabulky a začne servírovat obrazovky — dokud plán nepotvrdíte, nic se nestane.",
      "search": "Hledat aplikace…",
      "clear": "Vymazat hledání",
      "all": "Vše",
      "by": "od {publisher}",
      "install": "Nainstalovat",
      "installed": "Nainstalováno",
      "noMatch": "Hledání neodpovídá žádná aplikace",
      "noMatchBody": "Zkuste jiný výraz nebo jinou kategorii.",
      "emptyTitle": "Není k dispozici žádná aplikace",
      "emptyBody": "Aplikace dodané s tímto buildem se objeví zde. Nasměrujte ADMINIUM_BUNDLED_APPS na adresář s balíčky, nebo nějaký nahrajte.",
      "unreadable": "Manifest tohoto balíčku nelze přečíst. Nelze jej nainstalovat — níže jej zahoďte."
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
      "timezoneGuessed": "z tohoto serveru"
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
      "title": "Smazat připojení"
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
    "trust": "Čteme pouze vaše schéma — během nastavení nikdy vaše řádková data."
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
      "title": "Smazat tuto stránku?"
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
      "tableCreateHint": "Tabulka, ze které stránka čte. Vyberte ji hned a stránka bude rovnou použitelná; bez výběru ji můžete připojit později.",
      "tableNeedsConnection": "Nejprve vyberte zdroj dat.",
      "tableNone": "Nepřipojeno",
      "template": "Šablona",
      "templateHint": "Určuje, co stránka může obsahovat. Lze změnit později.",
      "title": "Název",
      "titleHint": "Zobrazuje se v postranním panelu a v hlavičce stránky.",
      "visible": "Zobrazit v postranním panelu",
      "visibleHint": "Skrytá stránka zůstává dostupná na své URL každému, kdo má odkaz.",
      "width": "Šířka obsahu",
      "widthHint": "Jak široký může být sloupec s obsahem stránky na velké obrazovce."
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
      "deleteBody": "Každá stránka, která používá klíč navázaný na tento rozsah, přestane načítat data. Klíče se nemažou — pokud jste chtěli udělat tohle, nejprve je odvolejte.",
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
      "title": "Rozsahy"
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
    "unavailableBody": "Tento build zatím editor přemapování neobsahuje (09-T12). Až přibude, spusťte generování znovu a přemapujte popisky, typy a vztahy.",
    "unavailableTitle": "Editor přemapování schématu není k dispozici"
  },
  "review": {
    "unavailableBody": "Tento build zatím obrazovku kontroly obohacení neobsahuje (06-T14). Přijde s tokem rozdílu a použití.",
    "unavailableTitle": "Obrazovka kontroly není k dispozici"
  },
  "settings": {
    "globalDefaultsNav": "Globální výchozí nastavení",
    "title": "Nastavení",
    "workspaceSection": "Pracovní prostor"
  },
  "settingsAi": {
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
    "publicApiCard": {
      "body": "Umožněte svým zákaznickým nebo zaměstnaneckým stránkám číst tuto databázi prostřednictvím rozsahu, který určíte.",
      "cta": "Otevřít veřejné API",
      "heading": "Veřejné API"
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
    "emptyFilter": "Žádné tabulky neodpovídají filtru.",
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
    "step": {
      "enrich": "Obohatit",
      "generate": "Generovat",
      "intent": "Záměr",
      "meta": "Úložiště metadat",
      "source": "Zdroj",
      "tables": "Tabulky",
      "test": "Analyzovat"
    },
    "title": "Nové připojení"
  }
} as const;
