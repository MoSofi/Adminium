// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/onboarding.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "account": {
    "body": "První správce. Stane se to jen jednou a poté zůstanete přihlášeni.",
    "confirm": "Potvrzení hesla",
    "email": "E-mail",
    "hidePassword": "Skrýt heslo",
    "label": "Váš účet",
    "name": "Vaše jméno",
    "password": "Heslo",
    "passwordHelper": "Alespoň {min} znaků.",
    "showPassword": "Zobrazit heslo",
    "strength": "Síla hesla",
    "strengthLevels": {
      "fair": "Ucházející",
      "good": "Dobré",
      "strong": "Silné",
      "weak": "Slabé"
    },
    "sub": "Přihlašovací údaje",
    "submit": "Vytvořit účet",
    "title": "Vytvořte si účet"
  },
  "back": "Zpět",
  "connect": {
    "body": "Nasměrujte Adminium na zdroj dat. Přečteme schéma a nikdy do něj nezapisujeme, pokud o to nepožádáte.",
    "bridge": {
      "body": "Byl předán z adminium.dev. Vytvořte si účet a my ho otevřeme v průvodci připojením, kde si ho můžete přečíst dřív, než ho cokoli použije.",
      "title": "Na tuto instanci čeká připojovací řetězec"
    },
    "dsn": {
      "checking": "Kontroluji tuto databázi…",
      "helper": "Nic neopustí tento prohlížeč, dokud nebude existovat váš účet — pak ho otestujeme.",
      "incomplete": "Doplňte hostitele a databázi, např. postgres://user@host:5432/db",
      "invalidScheme": "Neznámé schéma — očekává se postgres://, mysql://, mariadb:// nebo sqlite:",
      "label": "Připojovací řetězec"
    },
    "engine": {
      "mysql": "MySQL / MariaDB",
      "postgres": "PostgreSQL",
      "sqlite": "SQLite"
    },
    "engineLabel": "Databázový engine",
    "existing": {
      "adopt": "Použít ji a přihlásit se",
      "adopting": "Nasměrování této instance na ni…",
      "body": "Obsahuje {count, plural, one {# tabulku Adminia} few {# tabulky Adminia} other {# tabulek Adminia}} s daty. Dvě možnosti:",
      "failed": "Tuto instanci se nepodařilo nasměrovat na tuto databázi.",
      "otherSecret": "Byla nastavena s jiným ADMINIUM_SECRET: přihlášení by fungovalo, ale uložené připojovací řetězce tato instance nedokáže dešifrovat.",
      "park": "Ponechat je a začít znovu",
      "parked": {
        "body": "Budou přejmenovány a odsunuty stranou — každý řádek zůstane — a Adminium začne vedle nich s novými. Nic se nestane, dokud do této databáze nedáte vlastní data Adminia.",
        "title": "Stávající tabulky zůstanou zachovány"
      },
      "restarting": "Restart na ni…",
      "timeout": "Adminium je nasměrováno na tuto databázi, ale ještě se nevrátilo — za chvíli tuto stránku načtěte znovu.",
      "title": "V této databázi už běží Adminium"
    },
    "label": "Připojit data",
    "sub": "Propojit databázi",
    "title": "Připojte svou databázi"
  },
  "continue": "Pokračovat",
  "done": {
    "connected": {
      "reading": "Připojeno — Adminium právě čte vaše schéma.",
      "tables": "Připojeno · nalezeno {count, plural, one {# tabulka} few {# tabulky} other {# tabulek}}."
    },
    "invited": "Vytvořeno {count, plural, one {# pozvání} few {# pozvání} other {# pozvání}}.",
    "label": "Hotovo",
    "next": {
      "blank": "Váš pracovní prostor je připraven. Přidejte stránku, až budete chtít — nic jsme nevygenerovali, přesně jak jste si přáli.",
      "generate": "Váš pracovní prostor je připraven. Teď vybereme tabulky a vygenerujeme vaše stránky."
    },
    "storage": {
      "local": "Adminium ukládá svá vlastní data do souboru na tomto počítači.",
      "sameDb": "Adminium ukládá svá vlastní data do databáze, kterou jste připojili.",
      "separate": "Adminium ukládá svá vlastní data do databáze, kterou jste mu dali."
    },
    "sub": "Začněte tvořit",
    "title": "Vše je připraveno! 🎉"
  },
  "error": {
    "alreadyCompleted": "Tato instance už byla nastavena. Přihlaste se stávajícím účtem správce.",
    "connectionFailed": "Váš účet byl vytvořen a jste přihlášeni — ale tato databáze nebyla dostupná: {detail}",
    "connectionUnknown": "databáze neodpověděla",
    "failed": "Nastavení selhalo. Zkontrolujte připojení a zkuste to znovu.",
    "rejected": "Server tyto údaje odmítl. Zkontrolujte e-mail a heslo a zkuste to znovu."
  },
  "finish": "Přejít na dashboard",
  "kicker": "Krok {n} z {total}",
  "meta": {
    "body": "Vaše přihlášení, vygenerované stránky a uložená nastavení. To je odděleno od databáze, kterou jste právě připojili a kterou Adminium pouze čte.",
    "label": "Data Adminia",
    "local": {
      "body": "Není co nastavovat. Vhodné pro vyzkoušení Adminia nebo pro jedinou instanci.",
      "title": "V souboru na tomto počítači"
    },
    "moving": {
      "copying": "Kopírování dat Adminia…",
      "failed": "Data Adminia se nepodařilo přesunout — zkuste to znovu.",
      "restarting": "Restart na novou databázi…",
      "timeout": "Adminium svá data přesunulo, ale ještě se nevrátilo. Jsou v bezpečí v nové databázi — za chvíli tuto stránku načtěte znovu."
    },
    "pinned": {
      "body": "Tato instance byla spuštěna s nakonfigurovaným meta úložištěm, takže není co přesouvat. Změnit to můžete později v nastavení Studia.",
      "title": "Data Adminia už mají svůj domov"
    },
    "sameDb": {
      "alreadyAdminium": "Tato databáze už obsahuje instanci Adminia. Vraťte se o krok zpět, ponechte její tabulky a začněte vedle nich — nebo se do ní místo toho přihlaste.",
      "body": "Adminium přidá vedle vašich tabulek své vlastní s prefixem `adminium_`. Jedna databáze k zálohování.",
      "disabledFile": "Soubor SQLite není server, do kterého by Adminium mohlo přidat vlastní tabulky.",
      "disabledNoDdl": "Tato role nemůže spustit CREATE TABLE, který vlastní migrace Adminia potřebují.",
      "disabledReadOnly": "Tato role je jen pro čtení — Adminium do vaší databáze nikdy nezapisuje. Ponechte jeho data v souboru, nebo mu dejte vlastní databázi.",
      "noSource": "Zatím jste nepřipojili žádnou databázi — nejprve nějakou připojte, nebo ponechte data Adminia v souboru.",
      "parked": "Tabulky Adminia, které tam už jsou, se nejprve přejmenují a odsunou stranou — každý řádek zůstane — a Adminium začne vedle nich s novými.",
      "title": "V databázi, kterou jste právě připojili"
    },
    "separate": {
      "body": "Databáze PostgreSQL nebo MySQL, kterou poskytnete. Vhodné pro produkci nebo pro více instancí.",
      "failed": "Tato databáze neodpověděla.",
      "incomplete": "Doplňte hostitele a databázi, např. postgres://user@host:5432/adminium",
      "insufficient": "Tato role nemůže spustit CREATE TABLE — vlastní migrace Adminia ho potřebují.",
      "invalidScheme": "Neznámé schéma — očekává se postgres://, mysql:// nebo mariadb://",
      "label": "Připojovací řetězec pro Adminium",
      "ok": "Dostupná a umí vytvářet tabulky.",
      "test": "Otestovat tuto databázi",
      "title": "Ve vlastní databázi"
    },
    "sub": "Kde jsou uložena",
    "title": "Kde Adminium ukládá svá vlastní data"
  },
  "progressComplete": "Hotovo {percent} %",
  "progressLabel": "Průběh nastavení",
  "skip": "Přeskočit",
  "start": {
    "body": "Určuje to jen, jaké stránky pro vás vygenerujeme. Cokoli z toho můžete později změnit, nebo začít úplně od nuly.",
    "label": "Výchozí bod",
    "options": {
      "analytics": {
        "body": "Grafy a tabulky ke čtení. Nic se nezapisuje zpět.",
        "title": "Analytika jen pro čtení"
      },
      "blank": {
        "body": "Negenerovat nic. Připojte databázi a stavte stránky, které chcete, jednu po druhé.",
        "title": "Prázdné plátno"
      },
      "crud": {
        "body": "Tabulky a formuláře, bez dashboardů.",
        "title": "Tabulky CRUD"
      },
      "fullAdmin": {
        "body": "Stránka pro každou tabulku, s vytvářením, úpravami a mazáním.",
        "title": "Kompletní administrace"
      },
      "support": {
        "body": "Nejprve fronty a detaily zákazníků, s vypnutým mazáním.",
        "title": "Konzole podpory"
      }
    },
    "sub": "Vyberte tvar",
    "title": "Co postavíte jako první?"
  },
  "team": {
    "body": "Pozvěte lidi, se kterými pracujete. Další můžete přidat kdykoli později.",
    "copied": "Zkopírováno",
    "copyLink": "Kopírovat odkaz",
    "duplicate": "Tato osoba už byla pozvána.",
    "emailLabel": "E-mail kolegy nebo kolegyně",
    "emailed": "Pozvánka odeslána e-mailem",
    "failed": "Tuto pozvánku se nepodařilo vytvořit.",
    "invalidEmail": "Zadejte platnou e-mailovou adresu.",
    "invite": "Pozvat",
    "label": "Váš tým",
    "note": "Pozvánky bez e-mailu zobrazí odkaz, který pošlete sami. Zobrazí se jen jednou — Adminium si z něj uchová pouze otisk.",
    "placeholder": "kolega@firma.cz",
    "sub": "Přidat lidi",
    "title": "Přiveďte svůj tým"
  }
} as const;
