// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/roles.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "delete": "Smazat",
    "rename": "Přejmenovat"
  },
  "builtinLocked": "Vestavěné role nelze smazat.",
  "category": {
    "access": "Přístup",
    "data": "Data",
    "operations": "Provoz",
    "workspace": "Pracovní prostor",
    "records": "Stránky a záznamy",
    "apps": "Aplikace"
  },
  "column": {
    "actions": "Akce",
    "members": "Členové",
    "name": "Role"
  },
  "create": {
    "descriptionLabel": "Popis",
    "description": "Nová role začíná zcela bez oprávnění.",
    "failed": "Roli se nepodařilo vytvořit",
    "namePlaceholder": "např. Pracovník podpory",
    "name": "Název",
    "submit": "Vytvořit roli",
    "title": "Nová role"
  },
  "createButton": "Nová role",
  "delete": {
    "confirm": "Smazat roli",
    "description": "Role i její řádky oprávnění budou odstraněny.",
    "failed": "Roli se nepodařilo smazat",
    "hasMembers": "Roli „{name}“ má stále {count, plural, one {# člen} few {# členové} many {# člena} other {# členů}}. Vyberte roli, do které se členové přesunou — Adminium nenechá žádný účet bez role.",
    "noMembers": "Roli „{name}“ nemá nikdo, takže se nic nepřesouvá.",
    "reassignPlaceholder": "Vyberte roli…",
    "reassignTo": "Přesunout členy do role",
    "title": "Smazat roli"
  },
  "list": {
    "title": "Role"
  },
  "loadFailed": {
    "body": "Matice níže je neúplná, takže by její uložení smazalo oprávnění, která se jen nenačetla. Před úpravami načtěte stránku znovu.",
    "title": "Některá oprávnění se nepodařilo přečíst"
  },
  "matrix": {
    "discard": "Zahodit",
    "empty": {
      "body": "Tato instance nehlásí vůbec žádná udělitelná oprávnění, což by se nemělo stát — načtěte stránku znovu, a pokud to přetrvá, zkontrolujte protokol serveru.",
      "title": "Žádná oprávnění k zobrazení"
    },
    "label": "Oprávnění rolí",
    "noChanges": "Žádné neuložené změny",
    "pending": "{count, plural, one {# neuložená změna} few {# neuložené změny} many {# neuložené změny} other {# neuložených změn}}",
    "rowHeader": "Oprávnění",
    "title": "Oprávnění"
  },
  "memberCount": "{count, plural, one {# uživatel} few {# uživatelé} many {# uživatele} other {# uživatelů}}",
  "permission": {
    "apiKeysManage": "Spravovat klíče API",
    "auditRead": "Číst auditní log",
    "connectionsManage": "Spravovat databázová připojení",
    "exportsManage": "Spravovat exporty všech uživatelů",
    "importsManage": "Spravovat importy všech uživatelů",
    "jobsManage": "Spouštět a rušit úlohy na pozadí",
    "manifestsManage": "Instalace a správa aplikací a doplňků",
    "jobsRead": "Vidět všechny úlohy na pozadí",
    "llmRun": "Spustit asistenta AI",
    "pagesManage": "Vytvářet a uspořádat stránky",
    "projectRead": "Číst změny stránek a schématu pro stažení do projektu",
    "reportsManage": "Spravovat naplánované sestavy",
    "rolesManage": "Spravovat role a oprávnění",
    "schemaRemap": "Upravovat popisky a úpravy schématu",
    "schemaDdl": "Vytvářet, upravovat a mazat tabulky",
    "settingsManage": "Spravovat nastavení pracovního prostoru",
    "usersManage": "Spravovat uživatele",
    "filesManage": "Spravovat soubory všech uživatelů",
    "storageManage": "Spravovat cíle úložiště",
    "designerUse": "Vytvářet aplikace v Adminium Designer"
  },
  "rename": {
    "failed": "Roli se nepodařilo přejmenovat",
    "title": "Přejmenovat roli"
  },
  "saveFailed": {
    "title": "Nepodařilo se uložit všechny role"
  },
  "subtitle": "Co smí každá role. Uživatel dostane sjednocení všech rolí, které má.",
  "title": "Role a oprávnění",
  "data": {
    "pagesView": "Vidět všechny stránky",
    "read": "Číst záznamy",
    "readPii": "Vidět osobní údaje v záznamech",
    "create": "Vytvářet záznamy",
    "update": "Upravovat záznamy",
    "delete": "Mazat záznamy",
    "export": "Exportovat záznamy",
    "import": "Importovat záznamy",
    "pagesEdit": "Měnit rozvržení stránek",
    "narrow": "{count, plural, one {# oprávnění} few {# oprávnění} other {# oprávnění}} pro jednotlivou stránku nebo tabulku platí také, navíc k řádkům níže. Uložení je zachová."
  },
  "apps": {
    "every": "Otevírat obrazovky pro personál všech aplikací",
    "one": "Otevírat obrazovky pro personál aplikace {app}"
  },
  "rows": {
    "locked": "Super Admin dosáhne na každý řádek.",
    "saveFirst": "Nejprve uložte nebo zahoďte změny oprávnění.",
    "action": "Řádky",
    "actionLabel": {
      "read": "Číst",
      "update": "Měnit",
      "delete": "Mazat"
    },
    "way": {
      "person": "osobě ve sloupci {column}",
      "listingDated": "komukoli, kdo je k němu ten den zapsán v tabulce {table}",
      "listing": "komukoli, kdo je k němu zapsán v tabulce {table}",
      "parent": "každému, kdo dosáhne na jeho záznam v tabulce {table}"
    },
    "follows": "Řídí se podle: {table}",
    "belongs": "Řádek patří {ways}.",
    "sentence": {
      "all": "Dosáhne na každý řádek.",
      "allWhile": "Každý řádek",
      "team": "Jen řádky, které patří této osobě nebo někomu z týmu, který vede",
      "own": "Jen řádky, které patří této osobě",
      "unowned": "a řádky, které zatím nikomu nepatří",
      "while": "jen dokud je {column} {values}",
      "by": "a jen ty, ve kterých je uvádí {column}"
    },
    "title": "Na které řádky dosáhne role „{role}“",
    "intro": "Role dosáhne na každý řádek tabulky, kterou smí otevřít, pokud ji tady neomezíte. Omezení pro člověka platí jen tehdy, když je omezená každá role, která mu tabulku dává.",
    "loadFailed": "Tabulky se nepodařilo načíst.",
    "empty": {
      "title": "Není co omezit",
      "body": "Žádná tabulka, kterou tato role smí otevřít, neříká, komu její řádky patří."
    },
    "tryAs": "Vyzkoušet jako",
    "tryAsNone": "Nikdo",
    "samplePerson": "{name} (ukázka)",
    "failed": "Omezení řádků se nepodařilo uložit",
    "private": "Čtou ji lidé, kterým daný řádek patří, a nikdo jiný. Není tu co volit.",
    "reachLabel": "{action}: které řádky",
    "reach": {
      "all": "Každý řádek",
      "own": "Vlastní řádky",
      "team": "Vlastní řádky a řádky týmu",
      "allWhile": "Každý řádek, jen dokud…"
    },
    "unowned": "a řádky, které zatím nikomu nepatří",
    "widened": "Tato role otevírá tabulku přes širší oprávnění. Uložením omezení dostane tabulku také jmenovitě.",
    "count": "{name} by viděl(a) {reached} z {total}.",
    "capped": "Tato osoba vede víc lidí, než kolik se do jednoho dosahu vejde, takže se nepočítá celý její tým.",
    "lifted": "{name} má také {roles}, což dává každý řádek. Toto omezení pro ni neplatí."
  },
  "partsOff": "Její část aplikace je vypnutá: dokud se nezapne, role nic neuděluje."
} as const;
