// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/apiDocs.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "badge": {
    "anon": "Veřejné čtení",
    "authenticated": "Vyžaduje přihlášení",
    "public": "Veřejné",
    "service": "Servisní role"
  },
  "code": {
    "copied": "Zkopírováno",
    "copy": "Kopírovat",
    "curl": "cURL",
    "js": "JavaScript",
    "languages": "Jazyk ukázky kódu",
    "python": "Python"
  },
  "copyBase": "Kopírovat základní URL",
  "crumb": "API",
  "empty": {
    "body": "Toto nasazení zatím nezveřejnilo žádné koncové body.",
    "title": "Zatím žádné koncové body"
  },
  "ep": {
    "batch": {
      "desc": "Hromadné vložení nebo upsert, až 500 řádků.",
      "title": "Hromadně vytvořit {ref}"
    },
    "create": {
      "desc": "Vloží jeden řádek. Vrací vytvořený záznam.",
      "title": "{article, select, other {}}Vytvořit {singular}"
    },
    "delete": {
      "desc": "Odebere řádek s tímto primárním klíčem.",
      "title": "{article, select, other {}}Smazat {singular}"
    },
    "list": {
      "desc": "Vrací filtrovanou, seřazenou a stránkovanou sadu řádků.",
      "title": "Vypsat {ref}"
    },
    "one": {
      "desc": "Načte jeden řádek podle primárního klíče.",
      "title": "{article, select, other {}}Načíst {singular}"
    },
    "replace": {
      "desc": "Nahradí celý řádek podle primárního klíče.",
      "title": "{article, select, other {}}Nahradit {singular}"
    },
    "rowWord": "řádek",
    "update": {
      "desc": "Upraví sloupce řádku s tímto primárním klíčem.",
      "title": "{article, select, other {}}Upravit {singular}"
    }
  },
  "meta": "{endpoints, plural, one {# koncový bod} few {# koncové body} many {# koncového bodu} other {# koncových bodů}} · limit {limit}, řazení {order}",
  "pg": {
    "auth": "Autorizace",
    "authHelper": "Klíč pro prohlížeč. Zůstává jen v této kartě a po opětovném načtení zmizí.",
    "authPlaceholder": "Vložte klíč",
    "body": "Tělo požadavku",
    "needKey": "Nejprve vložte klíč",
    "send": "Odeslat požadavek",
    "sending": "Odesílání…",
    "title": "Testovací konzole"
  },
  "rail": {
    "empty": "Tomuto filtru nic neodpovídá.",
    "filter": "Filtrovat tabulky…",
    "heading": "Zdroje",
    "reference": "Reference API"
  },
  "res": {
    "idle": "Odešlete požadavek a zobrazí se odpověď.",
    "ms": "{ms} ms",
    "network": "Požadavek se nedostal na server.",
    "noBody": "204 No Content — řádek smazán",
    "title": "Odpověď"
  },
  "schema": {
    "body": "Schéma těla",
    "response": "Sloupce odpovědi"
  },
  "status": {
    "live": "API v provozu",
    "off": "Vypnuto"
  },
  "tag": {
    "fk": "FK",
    "pk": "PK",
    "unique": "UNIQUE"
  }
} as const;
