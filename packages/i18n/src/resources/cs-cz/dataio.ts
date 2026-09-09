// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/dataio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "back": "Zpět",
  "import": {
    "stepUpload": "Nahrát",
    "stepMap": "Namapovat sloupce",
    "stepValidate": "Ověřit",
    "stepRun": "Importovat a zkontrolovat",
    "targetLabel": "Cílová tabulka",
    "targetPlaceholder": "Vyberte stránku tabulky…",
    "notATable": "Tato stránka není tabulka — vyberte stránku tabulky, do které se má importovat.",
    "dropTitle": "Přetáhněte sem soubor CSV k importu",
    "dropHint": "CSV do 32 MB — první řádek musí být hlavička",
    "skipTarget": "Neimportovat",
    "mapHint": "{count} datových řádků v {file} — vyberte cíl pro každý sloupec.",
    "validating": "Ověřování…",
    "toValidate": "Ověřit",
    "validateFailed": "Ověření se nezdařilo.",
    "validationSummary": "{valid} z {total} řádků připraveno k importu — {invalid} bude přeskočeno.",
    "allValid": "Všechny řádky prošly ověřením",
    "run": "Spustit import",
    "runSkipping": "Importovat {valid} řádků (přeskočit {invalid})",
    "progressLabel": "Průběh importu",
    "running": "Importuje se…",
    "kpiTotal": "Řádků v souboru",
    "kpiCreated": "Vytvořeno",
    "kpiUpdated": "Aktualizováno",
    "kpiSkipped": "Přeskočeno",
    "inconsistent": "Čísla importu nesedí — celkem se musí rovnat vytvořeno + aktualizováno + přeskočeno.",
    "downloadErrors": "Stáhnout report přeskočených řádků (CSV)",
    "runFailed": "Import se nezdařil."
  },
  "exports": {
    "tableLabel": "Tabulka",
    "tablePlaceholder": "Vyberte tabulku…",
    "notATable": "Tato stránka není tabulka — vyberte stránku tabulky k exportu.",
    "formatLabel": "Formát",
    "create": "Exportovat",
    "createFailed": "Export se nepodařilo vyžádat.",
    "retention": "Exporty se uchovávají 30 dní, poté vyprší.",
    "statusProcessing": "Zpracovává se…",
    "statusReady": "Hotovo — {rows} řádků · stáhnete klepnutím",
    "statusFailed": "Nezdařilo se — {error}",
    "statusCancelled": "Zrušeno",
    "statusExpired": "Vypršelo",
    "emptyTitle": "Zatím žádné exporty",
    "emptyBody": "Vyžádejte si jeden výše — artefakty se zde objeví se svým stavem.",
    "new": "Nový export"
  },
  "builder": {
    "title": "Nový export",
    "subtitle": "Vyberte tabulku, zvolte sloupce, zkontrolujte soubor, exportujte.",
    "cancel": "Zrušit",
    "backToExports": "Zpět na Exporty dat",
    "basedOn": "Podle {name}",
    "noAccess": {
      "title": "Zatím není co exportovat",
      "body": "Nemáte právo exportu k žádné tabulce tohoto připojení. Požádejte správce, aby ho udělil v sekci {link}.",
      "link": "Role a přístup"
    },
    "step": "Krok {n} ze 3",
    "steps": {
      "source": "Zdroj",
      "columns": "Sloupce",
      "preview": "Náhled"
    },
    "continue": "Pokračovat",
    "export": "Exportovat",
    "back": "Zpět",
    "hint": {
      "chooseTable": "Pro pokračování vyberte tabulku.",
      "fromAll": "Začíná se všemi sloupci tabulky {table}.",
      "fromPage": "Začíná se stránkou vázanou na {table}.",
      "noColumns": "Pro pokračování přidejte alespoň jeden sloupec.",
      "dupes": "Dva sloupce mají stejné záhlaví. Pro pokračování jeden přejmenujte.",
      "order": "{n} sloupců bude zapsáno v tomto pořadí.",
      "readSample": "Před exportem si přečtěte ukázku.",
      "downloads": "Soubor se stáhne z Exportů dat, jakmile bude hotový."
    },
    "source": {
      "title": "Která tabulka?",
      "search": "Hledat tabulky…",
      "meta": "{rows} řádků · {cols} sloupců",
      "metaNoRows": "{cols} sloupců",
      "usedBy": "Používá {n, plural, one {# stránka} few {# stránky} other {# stránek}}",
      "locked": "Bez práva exportu",
      "lockedToast": "Nemáte právo exportu k tabulce {table}"
    },
    "startFrom": {
      "title": "Začít od",
      "body": "Zvolte, kde seznam sloupců začíná. V dalším kroku můžete vše změnit.",
      "all": "Všechny sloupce tabulky {table}",
      "page": "Sloupce stránky — {page}",
      "pageMeta": "{page} · {n} sloupců · {linked} propojených · {totals, plural, one {# součet} few {# součty} other {# součtů}}",
      "none": "Na tuto tabulku není vázána žádná stránka"
    },
    "columns": {
      "title": "Co bude v souboru.",
      "add": "Přidat sloupce",
      "inFile": "Ve vašem souboru",
      "summary": "{n} sloupců · {linked} propojených · {totals, plural, one {# součet} few {# součty} other {# součtů}}",
      "reset": "Obnovit sloupce tabulky",
      "removeAll": "Odebrat vše",
      "empty": {
        "title": "Zatím žádné sloupce",
        "body": "Přidejte sloupce z panelu, nebo obnovte vlastní sloupce tabulky."
      },
      "dragTitle": "Přetáhněte pro změnu pořadí, nebo použijte šipky",
      "reorder": "Přesunout {header}",
      "headerLabel": "Záhlaví v souboru",
      "masked": "Exportuje se jako •••••, pokud nemáte právo odkrytí",
      "dupe": "Toto záhlaví používá jiný sloupec",
      "removeTitle": "Odebrat ze souboru",
      "remove": "Odebrat {header}"
    },
    "browser": {
      "search": "Hledat sloupce…",
      "broken": "Tento odkaz už nelze přeložit — začněte znovu.",
      "brokenBack": "Zpět na všechny tabulky",
      "suggested": "Doporučeno",
      "fromTable": "Z tabulky {table}",
      "fromTheTable": "Z tabulky",
      "readOnly": "Sloupec jen pro čtení",
      "noMatch": "Hledání neodpovídá žádný sloupec.",
      "allIn": "Všechny sloupce této tabulky už jsou ve vašem souboru.",
      "linked": "Z propojených tabulek",
      "budget": "{used} z {max}",
      "inbound": "Tabulky, které sem odkazují",
      "via": "přes {column}",
      "count": "Počet",
      "aggregate": "Agregace",
      "add": "Přidat",
      "singleNote": "Min a Max berou jeden sloupec.",
      "limit": "Limit dosažen — odeberte jeden, abyste mohli přidat další",
      "fourMax": "Nejvýše čtyři sloupce",
      "pickNumeric": "Nejprve vyberte číselný sloupec",
      "already": "{header} už je ve vašem souboru",
      "added": "{header} přidáno",
      "calculated": "Vypočítané",
      "hop": "Přidejte sloupec, nebo sledujte další odkaz dál.",
      "hopLimit": "Tři skoky jsou limit. Přidejte sloupec zde, nebo se vraťte.",
      "addName": "Přidat {name}",
      "noRead": "Bez práva čtení"
    },
    "calc": {
      "arith": "Sečíst nebo odečíst dva sloupce",
      "first": "První sloupec",
      "op": "Operátor",
      "second": "Druhý sloupec",
      "pct": "Procento z jednoho sloupce",
      "pctLabel": "Procento",
      "pctOf": "% z",
      "column": "Sloupec",
      "rule": "Pravidlo s prahem",
      "if": "Pokud",
      "isOver": "je nad",
      "then": "pak",
      "else": "jinak",
      "threshold": "Práh",
      "whenOver": "Hodnota při překročení",
      "otherwise": "Hodnota jinak",
      "needTwo": "Nejprve přidejte dva číselné sloupce",
      "needOne": "Nejprve přidejte číselný sloupec"
    },
    "gen": {
      "count": "Počet {table}",
      "countSrc": "počet {table} přes {column}",
      "foldSrc": "{fn} z {table}.{cols}",
      "linkedSrc": "{table}.{column} přes {path}",
      "arithHeader": "{a} {op} {b}",
      "pctHeader": "{pct}% z {a}",
      "ruleHeader": "{then} nebo {else}",
      "ruleSrc": "pokud {a} je nad {threshold}, pak {then}, jinak {else}",
      "sumOf": "Součet",
      "average": "Průměr",
      "min": "Min",
      "max": "Max"
    },
    "badge": {
      "key": "Klíč",
      "linked": "Propojeno",
      "count": "Počet",
      "sum": "Součet",
      "avg": "Průměr",
      "min": "Min",
      "max": "Max",
      "calculated": "Vypočítané",
      "masked": "Maskováno"
    },
    "fold": {
      "sum": "Součet",
      "avg": "Průměr",
      "min": "Min",
      "max": "Max"
    },
    "preview": {
      "title": "Zkontrolujte soubor a pak exportujte.",
      "fileName": "Název souboru",
      "format": "Formát",
      "csv": "CSV",
      "jsonl": "JSON Lines",
      "rows": "Řádky",
      "allRows": "Všechny řádky · {n}",
      "allRowsUnknown": "Všechny řádky",
      "viewRows": "Řádky uloženého pohledu",
      "savedView": "Uložený pohled",
      "viewLabel": "{name} · {filters} filtrů · {rows} řádků",
      "viewLabelNoRows": "{name} · {filters} filtrů",
      "headerRow": "Řádek záhlaví",
      "tabTable": "Tabulka",
      "tabRaw": "Surový soubor",
      "sample": "Ukázka {n} řádků · obnoveno {when}",
      "justNow": "právě teď",
      "minutesAgo": "{n, plural, one {před # minutou} few {před # minutami} other {před # minutami}}",
      "refresh": "Obnovit",
      "failed": "Ukázku se nepodařilo načíst.",
      "failedTimeout": "Připojení odpovídalo příliš pomalu. Samotný export neproběhl.",
      "retry": "Zkusit znovu",
      "headerOnly": "Soubor bude obsahovat jen řádek záhlaví."
    },
    "summary": {
      "title": "Soubor",
      "columns": "Sloupce",
      "rows": "Řádky",
      "size": "Odhadovaná velikost",
      "retention": "Uchování",
      "kept": "Uchováno 30 dní",
      "fileName": "Název souboru"
    },
    "warn": {
      "title": "Dobré vědět",
      "masked": "{n, plural, one {# sloupec se exportuje} few {# sloupce se exportují} other {# sloupců se exportuje}} maskovaně",
      "search": "Tento pohled má hledaný výraz, který export nemůže přenést",
      "noRows": "Tato tabulka teď nemá žádné řádky"
    },
    "started": {
      "preparing": "Připravuje se {file} · {rows} řádků",
      "ready": "Hotovo · {rows} řádků",
      "noteBusy": "Objeví se v Exportech dat a odtud půjde stáhnout, jakmile bude hotový.",
      "noteReady": "Hotovo. Najdete ho i v Exportech dat, pokud se k němu chcete vrátit později.",
      "download": "Stáhnout {format}",
      "busy": "Připravuje se soubor…",
      "another": "Exportovat další",
      "failed": "Export selhal."
    },
    "toast": {
      "started": "Export spuštěn"
    }
  }
} as const;
