// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/files.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "toast": {
    "restored": "Soubor „{name}“ obnoven",
    "restoreFailed": "Tento soubor se nepodařilo obnovit",
    "trashed": "Soubor „{name}“ přesunut do koše",
    "trashFailed": "Tento soubor se nepodařilo přesunout do koše"
  },
  "title": "Soubory",
  "subtitle": "Vše, co se nahrálo přes tento pracovní prostor — a kde jsou uložené jeho bajty.",
  "search": "Hledat podle názvu souboru",
  "trash": {
    "notice": {
      "title": "Koš se vyprazdňuje sám",
      "body": "Soubor v koši se po uplynutí doby uchování na tomto serveru odstraní i s daty. Co ještě potřebujete, obnovte předtím."
    }
  },
  "listFailed": {
    "title": "Tyto soubory se nepodařilo načíst"
  },
  "empty": {
    "filtered": {
      "title": "Nic tu není",
      "body": "Zrušte hledání, nebo v postranním panelu zvolte jinou zkratku."
    },
    "title": "Zatím žádné soubory",
    "body": "Soubory se sem dostanou, když je někdo přiloží k záznamu nebo vyplní pole se souborem."
  },
  "loadMore": "Načíst další soubory",
  "usage": {
    "label": "Využité úložiště",
    "used": "{size} využito",
    "count": "{count, plural, one {# soubor} few {# soubory} many {# souboru} other {# souborů}}",
    "diskLabel": "Využité místo",
    "ofDisk": "{used} z {size} na tomto disku"
  },
  "rail": {
    "label": "Zkratky souborů",
    "byTable": "Podle tabulky",
    "byDestination": "Podle cíle úložiště",
    "byConnection": "Podle připojení"
  },
  "preset": {
    "all": "Všechny soubory",
    "unattached": "Nepřiložené",
    "trash": "Koš",
    "recent": "Nedávné"
  },
  "column": {
    "name": "Soubor",
    "size": "Velikost",
    "attachedTo": "Přiloženo k",
    "destination": "Cíl úložiště",
    "added": "Přidáno",
    "actions": "Akce"
  },
  "row": {
    "unattached": "Nepřiloženo",
    "localDestination": "Disk tohoto serveru",
    "noRecord": "Nepřipojeno k žádnému záznamu"
  },
  "action": {
    "restore": "Obnovit",
    "download": "Stáhnout",
    "deleteNamed": "Smazat {name}",
    "delete": "Smazat"
  },
  "drawer": {
    "none": "Žádné",
    "subtitle": "{size} · {type}",
    "destination": "Cíl úložiště",
    "attachedTo": "Přiloženo k",
    "uploadedBy": "Nahrál(a)",
    "added": "Přidáno",
    "attachedAt": "Přiloženo",
    "trashedAt": "Přesunuto do koše",
    "id": "ID souboru",
    "checksum": "Kontrolní součet"
  },
  "view": {
    "label": "Jak se soubory zobrazují",
    "grid": "Dlaždice",
    "list": "Seznam"
  },
  "upload": {
    "open": "Nahrát",
    "title": "Nahrát soubory",
    "subtitle": "Přidejte soubory do tohoto pracovního prostoru.",
    "connection": "Ke kterému připojení patří",
    "drop": "Přetáhněte soubory sem",
    "browse": "Procházet v počítači",
    "sending": "Nahrávání",
    "cancelOne": "Zrušit {name}",
    "removeOne": "Odebrat {name}",
    "complete": "Nahrávání dokončeno",
    "completeBody": "Tyto soubory jsou nyní v tomto pracovním prostoru a lze je později připojit k záznamu.",
    "send": "{count, plural, one {Nahrát # soubor} few {Nahrát # soubory} other {Nahrát # souborů}}",
    "done": "Hotovo",
    "failed": "Selhalo",
    "cancelled": "Zrušeno"
  }
} as const;
