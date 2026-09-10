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
  "title": "Studio",
  "settings": {
    "title": "Nastavení",
    "workspaceSection": "Pracovní prostor",
    "globalDefaultsNav": "Globální výchozí nastavení"
  },
  "source": {
    "engine": {
      "label": "Databázový engine",
      "postgres": "PostgreSQL",
      "mysql": "MySQL / MariaDB",
      "sqlite": "SQLite"
    },
    "format": {
      "label": "Formát schématu",
      "helper": "Ponechte automatickou detekci, pokud se nemýlí.",
      "auto": "Rozpoznat automaticky",
      "sql": "SQL DDL / pg_dump",
      "prisma": "Schéma Prisma",
      "drizzle": "Drizzle ORM",
      "typeorm": "Entity TypeORM",
      "sequelize": "Modely Sequelize",
      "rails": "Rails schema.rb",
      "django": "Django models.py",
      "json": "Adminium JSON"
    },
    "sqlite": {
      "file": "Cesta k souboru databáze",
      "helper": "SQLite je soubor, ne server — zadejte absolutní cestu na stroji, kde běží Adminium."
    },
    "file": {
      "detectedAs": "Rozpoznáno: {format}",
      "moreWarnings": "+{count} dalších varování — úplný seznam se zobrazí v kroku analýzy.",
      "dropTitle": "Přetáhněte sem soubor schématu, nebo procházejte",
      "dropHint": "SQL DDL / pg_dump, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, modely Django, Adminium JSON",
      "pitch": "Není potřeba připojení k databázi — zpracujeme váš soubor schématu a postavíme stejné nástěnky.",
      "parsing": "Načítání nahraného souboru schématu…",
      "tables": "tabulek",
      "columns": "sloupců",
      "warnings": "varování",
      "errorTitle": "Soubor se nepodařilo zpracovat",
      "parseFailed": "Tento soubor se nepodařilo zpracovat. Pokud automatická detekce odhadla špatně, zvolte formát ručně a zkuste to znovu.",
      "unsupported": "Tento formát nebyl rozpoznán — podporovány jsou SQL DDL, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, modely Django a Adminium JSON. Zvolte jeden ručně a zkuste to znovu.",
      "requestFailed": "Nahrání se nezdařilo — zkontrolujte připojení a zkuste to znovu."
    },
    "title": "Připojte svou databázi",
    "subtitle": "Nasměrujte Adminium na databázi a my z jejího schématu vygenerujeme administrační nástěnku.",
    "name": "Název připojení",
    "namePlaceholder": "Produkční Postgres",
    "modeLabel": "Režim zadání zdroje",
    "mode": {
      "dsn": "Připojovací řetězec",
      "fields": "Jednotlivá pole",
      "file": "Soubor schématu"
    },
    "dsn": {
      "label": "Připojovací řetězec",
      "helper": "postgres://uzivatel:heslo@host:5432/databaze — fungují také mysql:// a sqlite:.",
      "incomplete": "Doplňte hostitele a databázi, např. postgres://user@host:5432/db",
      "invalidScheme": "Nerozpoznané schéma — očekává se postgres://, mysql://, mariadb:// nebo sqlite:",
      "quickFill": "Rychlé vyplnění:"
    },
    "fields": {
      "host": "Hostitel",
      "port": "Port",
      "database": "Databáze",
      "user": "Uživatel",
      "password": "Heslo",
      "ssl": "Režim SSL",
      "preview": "Náhled připojovacího řetězce:"
    },
    "readOnlyRole": {
      "title": "Použijte roli jen pro čtení",
      "body": "Při nastavení čte Adminium pouze metadata schématu — nikdy vaše řádky. Doporučujeme vyhrazeného uživatele s právy pouze pro SELECT; kde bude Adminium uchovávat vlastní tabulky, určíte v kroku úložiště metadat."
    }
  },
  "capability": {
    "mysqlApproxRows": "Počty řádků v MySQL jsou odhady úložného enginu (odchylka až ±40 %) — zobrazují se se znakem ≈.",
    "mysqlFkEnum": "Metadata cizích klíčů a enumů jsou v MySQL slabší: tabulky MyISAM nedeklarují cizí klíče, enumy jsou sloupcové typy enum(…) a omezení CHECK vyžadují MySQL 8.0.16+ / MariaDB 10.2+.",
    "sqliteCheckEnums": "SQLite nemá nativní typ enum — enumy se syntetizují z omezení CHECK (col IN (…)).",
    "sqliteNoComments": "SQLite nepodporuje komentáře sloupců — popisky přidejte v editoru přemapování schématu.",
    "importNoRowCounts": "Soubory se schématem neobsahují počty řádků — seznam tabulek zobrazuje — místo smyšlených čísel.",
    "importNoLiveHealth": "Bez živého databázového připojení — kontroly stavu a detekce driftu schématu nejsou pro tento zdroj dostupné.",
    "rowsUnavailable": "Soubory se schématem nemají živou databázi — počty řádků zůstanou neznámé, dokud nějakou nepřipojíte.",
    "rowsRunAnalyze": "Zatím žádný odhad — spusťte na databázi ANALYZE, aby se počty řádků doplnily.",
    "rowsNoEstimate": "Engine pro tuto tabulku nenahlásil žádný odhad.",
    "rowsApproximate": "Odhad úložného enginu — u InnoDB se může lišit až o ±40 %."
  },
  "test": {
    "log": {
      "moreWarnings": "+{count} dalších varování parseru",
      "connecting": "Navazuje se zabezpečené připojení…",
      "connected": "Připojeno ({latency} ms) · introspekce jen pro čtení",
      "connectFailed": "Připojení se nezdařilo.",
      "readingSchema": "Čtení schématu: public",
      "readingFile": "Načítání nahraného souboru schématu…",
      "parsingFile": "Zpracovává se {file}…",
      "detected": "Zjištěno {tables} tabulek · {columns} sloupců",
      "found": "Nalezeno {tables} tabulek · {columns} sloupců",
      "mapping": "Mapování typů sloupců → vstupní widgety",
      "relations": "Zjišťování vztahů…",
      "piiScan": "Vyhledávání sloupců s PII…",
      "piiDone": "Kontrola PII dokončena — {count} sloupců ve výchozím stavu maskováno",
      "piiDoneUnknown": "Kontrola PII dokončena",
      "jobFailed": "Introspekce se nezdařila.",
      "networkFailed": "Požadavek se nezdařil — zkontrolujte připojení a zkuste to znovu.",
      "ready": "Připraveno"
    },
    "title": "Analýza vašeho schématu",
    "subtitle": "Probíhá introspekce tabulek, sloupců a vztahů. Zabere to pár sekund.",
    "trust": "Vaše schéma a data pouze čteme. Nic se nemění.",
    "errorTitle": "Připojení se nezdařilo",
    "retry": "Zkusit znovu",
    "logLabel": "Protokol introspekce",
    "hint": {
      "auth": "Ověření se nezdařilo — zkontrolujte uživatelské jméno a heslo v DSN.",
      "hostUnreachable": "Hostitel je nedostupný — zkontrolujte název hostitele a port a že databáze přijímá připojení z tohoto stroje (povolte naše IP adresy).",
      "metaPlacement": "Tento zdroj nemůže hostit meta tabulky Adminia — pokračujte se samostatnou meta databází.",
      "permission": "Role se připojila, ale nemá oprávnění číst schéma — udělte introspekční roli právo USAGE na schéma.",
      "timeout": "Databáze neodpověděla včas — zkontrolujte síťovou cestu a zátěž a zkuste to znovu.",
      "tls": "Vyjednávání TLS se nezdařilo — zkuste sslmode=require, nebo nahrajte certifikát CA, který váš server očekává.",
      "unknown": "Připojení se nezdařilo — ověřte DSN a zkuste to znovu."
    }
  },
  "tables": {
    "importNoCounts": "Soubory se schématem neobsahují počty řádků — sloupec zobrazuje —, dokud nepřipojíte živou databázi.",
    "title": "Vyberte tabulky",
    "subtitle": "Zvolte, které zahrnout. Kdykoli to můžete změnit.",
    "search": "Filtrovat tabulky…",
    "listLabel": "Tabulky k zahrnutí",
    "emptyFilter": "Žádné tabulky neodpovídají filtru.",
    "pii": "PII",
    "highVolume": "velký objem",
    "highVolumeNote": "Tabulky s více než 100 000 řádky začínají odškrtnuté — provozní tabulky do nástěnky patří jen zřídka.",
    "joinHidden": "{count} spojovacích/systémových tabulek je předem skryto — vztahy M:N ale stále zajišťují."
  },
  "hub": {
    "title": "Datová připojení",
    "subtitle": "{healthy, number} z {total, plural, one {# připojení} few {# připojení} other {# připojení}} v pořádku",
    "connectNew": "Nové připojení",
    "stats": {
      "connections": "Připojení",
      "healthy": "V pořádku",
      "tables": "Zahrnuté tabulky",
      "pages": "Vygenerované stránky"
    },
    "status": {
      "connected": "Připojeno",
      "error": "Chyba",
      "unconfigured": "Koncept",
      "testing": "Testuje se…",
      "paused": "Pozastaveno"
    },
    "card": {
      "readOnly": "Jen pro čtení",
      "tables": "Tabulky",
      "pages": "Stránky",
      "latency": "Latence",
      "latencyMs": "{latency, number} ms",
      "lastIntrospected": "Poslední introspekce",
      "never": "Nikdy",
      "timezone": "Časové pásmo",
      "timezoneGuessed": "z tohoto serveru",
      "paused": "Adminium se k této databázi nepřipojuje. Její stránky se znovu načtou, jakmile ji obnovíte.",
      "pausedSince": "Pozastaveno {when} – Adminium se k této databázi nepřipojuje. Její stránky se znovu načtou, jakmile ji obnovíte."
    },
    "action": {
      "test": "Otestovat",
      "reintrospect": "Znovu introspektovat",
      "reintrospectFile": "Zdroje ze souboru se schématem nemají živou databázi — nahrajte soubor znovu.",
      "remap": "Přemapovat schéma",
      "delete": "Smazat",
      "regional": "Místní nastavení",
      "pause": "Pozastavit",
      "resume": "Obnovit",
      "pausedHint": "Toto připojení je pozastavené – obnovte ho, abyste se dostali k databázi.",
      "rename": "Přejmenovat"
    },
    "regional": {
      "title": "Místní nastavení",
      "intro": "Popisují firmu, které tato databáze patří, nikoli toho, kdo ji čte. Aplikace servírované Adminiem je čtou odsud.",
      "timezone": "Časové pásmo",
      "timezoneHelper": "Datum a čas se zobrazují v tomto pásmu. Bez něj aplikace hostované Adminiem přejdou na UTC a napíší to na obrazovku.",
      "guessedTitle": "Toto pásmo pochází ze serveru",
      "guessedBody": "Adminium je převzalo ze stroje, na kterém běží — nikdo je zde nezvolil. Uložením ho potvrdíte, nebo vyberte pásmo, ve kterém firma skutečně pracuje.",
      "timezonePlaceholder": "Oblast/Město",
      "currency": "Měna",
      "currencyHelper": "Slouží k formátování částek. Nepovinné — bez ní se změní jen formátování.",
      "currencyPlaceholder": "Kód ISO-4217",
      "notSet": "Nenastaveno",
      "noMatch": "Žádné odpovídající pásmo",
      "noMatchCurrency": "Žádná odpovídající měna",
      "save": "Uložit",
      "failed": "Místní nastavení se nepodařilo uložit",
      "saved": "Místní nastavení bylo aktualizováno"
    },
    "test": {
      "ok": "Připojení v pořádku · {latency, number} ms",
      "failed": "Test připojení selhal"
    },
    "introspect": {
      "noChanges": "Schéma beze změn — žádný nový snímek.",
      "updated": "Schéma znovu introspektováno",
      "masksProposed": "{count, plural, one {# sloupec navržen} few {# sloupce navrženy} other {# sloupců navrženo}} k maskování — zkontrolujte v editoru přemapování.",
      "failed": "Introspekce selhala. Zkuste to znovu."
    },
    "delete": {
      "title": "Smazat připojení",
      "body": "Tímto smažete „{name}“ a z něj vygenerované stránky. Vaší databáze se to nijak nedotkne.",
      "prompt": "Potvrďte zadáním {name}",
      "confirm": "Smazat připojení",
      "cancel": "Zrušit",
      "close": "Zavřít",
      "success": "Připojení „{name}“ smazáno",
      "failed": "Připojení se nepodařilo smazat. Zkuste to znovu."
    },
    "empty": {
      "title": "Zatím žádné zdroje dat",
      "body": "Připojte databázi a Adminium z jejího schématu vygeneruje váš administrační panel.",
      "cta": "Připojit databázi"
    },
    "hostedApps": "Hostované aplikace",
    "subtitlePaused": "{healthy, number} z {total, plural, one {# připojení} few {# připojení} other {# připojení}} v pořádku · {paused, number} pozastaveno",
    "pause": {
      "title": "Pozastavit toto připojení?",
      "body": "Adminium přestane otevírat jakékoli připojení k „{name}“. {pages, plural, one {# stránka} few {# stránky} many {# stránky} other {# stránek}}, naplánované reporty a hostované aplikace přestanou načítat data, dokud připojení neobnovíte.",
      "keeps": "Nic se nemaže – připojení, jeho schéma i {pages, plural, one {jeho # stránka} few {jeho # stránky} many {jeho # stránky} other {jeho # stránek}} zůstávají zachovány a jedním kliknutím je vrátíte zpět.",
      "confirm": "Pozastavit připojení",
      "pausedToast": "Připojení „{name}“ pozastaveno",
      "resumedToast": "Připojení „{name}“ obnoveno",
      "pauseFailed": "Připojení se nepodařilo pozastavit. Zkuste to znovu.",
      "resumeFailed": "Připojení se nepodařilo obnovit. Zkuste to znovu."
    },
    "rename": {
      "title": "Přejmenovat připojení",
      "label": "Název",
      "helper": "Jak se tato databáze jmenuje v celém Adminiu — karta, skupina v postranním panelu nad jejími stránkami a každý výběr, který ji nabízí. Samotná databáze se nepřejmenuje.",
      "save": "Přejmenovat",
      "saved": "Připojení přejmenováno",
      "failed": "Připojení se nepodařilo přejmenovat"
    }
  },
  "settingsHub": {
    "title": "Nastavení workspace",
    "subtitle": "Identita, zabezpečení a destruktivní akce tohoto workspace.",
    "save": "Uložit změny",
    "saved": "Nastavení workspace aktualizováno",
    "saveFailed": "Nastavení workspace se nepodařilo uložit. Zkuste to znovu.",
    "superAdminOnlyTitle": "Vyžadován super admin",
    "superAdminOnly": "Identitu a zabezpečení workspace může měnit pouze super admin.",
    "identity": {
      "heading": "Identita workspace",
      "appName": {
        "label": "Název aplikace",
        "helper": "Zobrazuje se v postranním panelu, v titulku prohlížeče a v e-mailech.",
        "error": "Zadejte název o délce nejvýše 60 znaků."
      },
      "logo": {
        "label": "Logo",
        "drop": "Přetáhněte sem obrázek",
        "helper": "PNG, JPEG, WebP, GIF nebo SVG do 1 MB. Nahradí vestavěnou značku všude.",
        "upload": "Nahrát logo",
        "replace": "Nahradit logo",
        "remove": "Odebrat",
        "uploaded": "Logo aktualizováno",
        "removed": "Logo odebráno",
        "tooLarge": "Tento obrázek je větší než 1 MB.",
        "badType": "Vyberte obrázek PNG, JPEG, WebP, GIF nebo SVG.",
        "undo": "Zpět"
      },
      "showVersion": {
        "label": "Verze v postranním panelu",
        "helper": "Číslo sestavení vedle loga. Vypnuté skryje, jakou verzi provozujete."
      }
    },
    "security": {
      "heading": "Zabezpečení",
      "require2fa": {
        "label": "Vyžadovat dvoufaktorové ověření",
        "desc": "Každý člen musí mít pro přihlášení zapnuté 2FA.",
        "note": "Jen doporučení, ne zábrana: členové bez 2FA jsou nasměrováni k jejímu nastavení a už ji nemohou vypnout, jejich přihlášení se ale nikdy neblokuje a klíčů API se to netýká."
      },
      "allowSignup": {
        "label": "Povolit samoregistraci",
        "desc": "Účet si může založit kdokoli — při vypnutí zůstává workspace jen na pozvánky."
      },
      "sessionTtl": {
        "label": "Životnost relace (hodiny)",
        "error": "Mezi {min, number} a {max, number} hodinami."
      },
      "passwordMin": {
        "label": "Minimální délka hesla",
        "error": "Mezi {min, number} a {max, number} znaky."
      }
    },
    "email": {
      "attachmentCap": {
        "error": "Mezi {min, number} a {max, number} MB.",
        "helper": "Největší velikost příloh, kterou může jedna zpráva nést.",
        "label": "Limit příloh (MB)"
      },
      "from": {
        "label": "Adresa odesílatele",
        "helper": "Samotná adresa, nebo zobrazované jméno před ní.",
        "error": "Zadejte e-mailovou adresu."
      },
      "heading": "E-mail (SMTP)",
      "host": {
        "label": "Server SMTP",
        "error": "Pouze název hostitele nebo IP adresa — bez schématu, portu a přihlašovacích údajů."
      },
      "pass": {
        "label": "Heslo",
        "helper": "Uloženo šifrovaně a už se nikdy nezobrazí. Ponechte prázdné, chcete-li zachovat stávající.",
        "error": "K tomuto uživatelskému jménu patří heslo."
      },
      "port": {
        "label": "Port",
        "error": "Mezi {min, number} a {max, number}."
      },
      "remove": "Odebrat poštovní server",
      "review": {
        "removed": "Odebráno",
        "password": "Nahrazeno"
      },
      "secure": {
        "label": "Implicitní TLS",
        "helper": "Zapnuto pro port 465. Vypnuto začíná nešifrovaně a přejde na STARTTLS, což očekává port 587."
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
        "label": "Uživatelské jméno",
        "helper": "Nechte prázdné, pokud relay nevyžaduje přihlášení."
      }
    },
    "review": {
      "title": "Uložit nastavení workspace",
      "subtitle": "Před uložením zkontrolujte změny.",
      "confirm": "Uložit změny",
      "cancel": "Zrušit",
      "close": "Zavřít",
      "on": "Zapnuto",
      "off": "Vypnuto",
      "shown": "Zobrazeno",
      "hidden": "Skryto",
      "change": "{before} → {after}"
    },
    "defaultsCard": {
      "heading": "Výchozí vzhled a jazyk",
      "body": "Motiv, akcentová barva, hustota a jazyk pro celý workspace najdete ve výchozím globálním nastavení.",
      "cta": "Otevřít globální výchozí nastavení"
    },
    "danger": {
      "heading": "Nebezpečná zóna",
      "subtitle": "Nevratné akce.",
      "empty": "Není co mazat — zatím žádná připojení.",
      "deleteDesc": "Smaže připojení a z něj vygenerované stránky. Vaší databáze se to nedotkne. Nelze vzít zpět.",
      "deleteCta": "Smazat připojení"
    },
    "aiCard": {
      "heading": "Obohacení pomocí AI",
      "body": "Nastavte poskytovatele AI (nebo okruh kopírovat-vložit) k obohacení popisků, skupin a vztahů.",
      "cta": "Otevřít nastavení AI"
    },
    "pagesCard": {
      "heading": "Stránky",
      "body": "Přidávejte, upravujte a mažte stránky, měňte jejich obsah a přeuspořádejte postranní panel.",
      "cta": "Spravovat stránky"
    },
    "translationsCard": {
      "heading": "Jazyky a překlady",
      "body": "Přeformulujte v Adminiu cokoli, vyberte, které jazyky si lidé mohou zvolit, a přidejte vlastní.",
      "cta": "Otevřít překlady"
    },
    "storageCard": {
      "heading": "Úložiště",
      "body": "Zvolte, kde žijí nahrané soubory, exporty a další uložená data — tento server, bucket, nebo váš vlastní server.",
      "cta": "Otevřít úložiště"
    },
    "addOnsCard": {
      "heading": "Doplňky",
      "body": "Procházejte, instalujte a připojujte doplňky — další bloky, datové balíčky a integrace — nebo si jeden nahrajte sami.",
      "cta": "Otevřít doplňky"
    },
    "publicApiCard": {
      "heading": "Veřejné API",
      "body": "Umožněte svým zákaznickým nebo zaměstnaneckým stránkám číst tuto databázi prostřednictvím rozsahu, který určíte.",
      "cta": "Otevřít veřejné API"
    }
  },
  "settingsAi": {
    "title": "Obohacení pomocí AI",
    "subtitle": "Připojte model, aby Adminium navrhoval popisky, skupiny, vztahy a další — vždy zkontrolováno jako rozdíl, než se cokoli použije.",
    "saved": "Poskytovatel AI uložen",
    "saveFailed": "Poskytovatele AI se nepodařilo uložit. Zkuste to znovu.",
    "save": "Uložit poskytovatele",
    "test": "Otestovat připojení",
    "testHintDirty": "Před testem uložte změny.",
    "testing": "Kontaktuji poskytovatele…",
    "testError": "Test selhal",
    "testErrorBody": "Poskytovatele se nepodařilo kontaktovat. Zkontrolujte klíč a základní URL.",
    "testOk": "Připojeno k {model} za {latency} ms",
    "testUnknownModel": "poskytovateli",
    "provider": {
      "heading": "Poskytovatel AI",
      "subtitle": "Vyberte, jak Adminium osloví model pro obohacení vašeho schématu. Klíče se ukládají zašifrované a už se nikdy nezobrazí.",
      "active": "Aktivní",
      "anthropic": {
        "label": "Anthropic",
        "desc": "Modely Claude přes API Anthropic."
      },
      "openai": {
        "label": "OpenAI",
        "desc": "Modely GPT přes API OpenAI."
      },
      "openaiCompatible": {
        "label": "Kompatibilní s OpenAI",
        "desc": "Jakýkoli koncový bod ve formátu OpenAI — Groq, Together, vLLM, LM Studio."
      },
      "ollama": {
        "label": "Ollama (lokálně)",
        "desc": "Modely běžící lokálně přes Ollama — bez klíče, bez cloudu."
      },
      "requiresNetwork": "Vyžaduje internet a API klíč",
      "networkDisabledTitle": "Přímí AI poskytovatelé jsou v této instalaci vypnuti",
      "networkDisabledBody": "Toto Adminium je nastaveno bez odchozího přístupu k internetu, takže nemůže oslovit API poskytovatele. Použijte níže kolečko kopírovat-vložit — nepotřebuje klíč ani síť."
    },
    "configure": {
      "heading": "Nastavit {provider}"
    },
    "field": {
      "baseUrl": "Základní URL",
      "baseUrlOptional": "Ponechte beze změny, pokud Ollama neběží na jiném hostiteli.",
      "baseUrlHelper": "Kořen koncového bodu, který obsluhuje /chat/completions.",
      "model": "Model",
      "modelFreeText": "Zadejte přesné ID modelu, který váš koncový bod obsluhuje.",
      "modelLive": "Načteno živě od poskytovatele.",
      "modelStatic": "Ověřený seznam; po uložení zadejte vlastní ID pro obnovení.",
      "modelLoading": "Načítání…",
      "modelPlaceholder": "Vyberte model…",
      "key": "Klíč API",
      "keyStored": "Uloženo zašifrované. Nahraďte jej, chcete-li použít jiný klíč.",
      "keyMask": "sk-…{last4}",
      "keyReplace": "Nahradit klíč",
      "keyOptional": "Volitelné — některé koncové body žádný klíč nepotřebují.",
      "keyWriteOnly": "Pouze pro zápis: po uložení se už nikdy nezobrazí.",
      "noKeyTitle": "Klíč API není potřeba",
      "noKeyBody": "Ollama běží lokálně, takže nic neopouští tento počítač."
    },
    "runStatus": {
      "draft": "Koncept",
      "running": "Probíhá",
      "awaitingResponse": "Čeká na odpověď",
      "validated": "Ověřeno",
      "applied": "Použito",
      "partiallyApplied": "Částečně použito",
      "failed": "Selhalo",
      "discarded": "Zahozeno"
    },
    "byo": {
      "heading": "Bez klíče? Použijte svůj vlastní nástroj AI",
      "subtitle": "Okruh kopírovat-vložit — nic neopouští tento počítač.",
      "body": "Studio umí z vašeho schématu vygenerovat samostatný prompt. Spusťte jej v Claude Code, ChatGPT nebo libovolném nástroji a vrácené JSON vložte zpět do průvodce připojením. Stejná validace, stejná kontrola, stejný výsledek jako přímá cesta.",
      "guaranteeTitle": "Záruka bez telemetrie",
      "guarantee1": "Prompt nese jen vaše schéma a agregované statistiky — ve výchozím stavu nikdy data řádků.",
      "guarantee2": "Nejsou vloženy žádné přihlašovací údaje, URL instance ani identifikátory.",
      "guarantee3": "Běhy BYO nedělají žádné síťové volání.",
      "promptVersion": "Prompt {version}",
      "schemaVersion": "Schéma {version}",
      "headingRecommended": "Použijte vlastní AI nástroj — klíč není potřeba",
      "recommended": "Doporučeno"
    },
    "history": {
      "heading": "Historie běhů",
      "subtitle": "Předchozí běhy obohacení. Otevřete některý pro kontrolu jeho návrhů.",
      "tableLabel": "Běhy obohacení",
      "colDate": "Datum",
      "colSource": "Zdroj",
      "colStatus": "Stav",
      "colChunks": "Bloky",
      "openReview": "Otevřít kontrolu běhu z {date}",
      "connection": "Připojení",
      "empty": "Zatím žádné běhy obohacení. Obohaťte schéma z průvodce připojením a historie se zobrazí zde.",
      "errorTitle": "Běhy se nepodařilo načíst",
      "errorBody": "Zkuste to znovu obnovením stránky.",
      "noConnections": "Nejprve připojte databázi — běhy obohacení se zaznamenávají u každého připojení.",
      "byo": "BYO",
      "directPath": "Přímá"
    }
  },
  "enrich": {
    "title": "Obohatit pomocí AI",
    "subtitle": "Volitelně vylepšete vygenerované popisky, skupiny, výčty a nástěnky pomocí LLM. Heuristický základ funguje i bez toho — toto pouze přidává návrhy, které před použitím zkontrolujete.",
    "intentLabel": "Jak chcete obohatit?",
    "sectionsLegend": "O čem má AI rozhodovat?",
    "localesLegend": "Přeložit popisky do",
    "localeLocked": "(povinné)",
    "samplingTitle": "Zahrnout ukázkové hodnoty",
    "samplingHint": "Do promptu zahrne až 20 skutečných hodnot na sloupec bez PII.",
    "samplingPreviewTitle": "Co opouští tento počítač",
    "samplingPreviewBody": "Až 20 nejčastějších hodnot na sloupec bez PII, plus min/max u číselných a datumových sloupců. Sloupce označené jako PII se nikdy nevzorkují. Vše ostatní zůstává pouze agregované. Před kopírováním (BYO) zkontrolujte přesný prompt — bez vaší akce se nic neodešle.",
    "noSections": "Vyberte alespoň jednu skupinu rozhodnutí k obohacení.",
    "generatePrompt": "Vygenerovat prompt",
    "startProvider": "Spustit obohacení",
    "startOver": "Začít znovu",
    "copied": "Zkopírováno",
    "createFailed": "Prompt pro obohacení se nepodařilo sestavit — zkuste to znovu.",
    "createFailedTitle": "Nelze spustit",
    "providerFallback": "váš poskytovatel AI",
    "fileTitle": "Obohacení pomocí AI vyžaduje živou databázi",
    "fileBody": "Zdroje ze souboru se schématem zatím nemají snímek k obohacení. Připojte živou databázi pro obohacení pomocí AI, nebo pokračujte — heuristický základ i tak vygeneruje kompletní aplikaci.",
    "section": {
      "labels": "Popisky a popisy",
      "groups": "Navigační skupiny",
      "enums": "Sémantika výčtů",
      "relations": "Vztahy",
      "keys": "Klíčové sloupce",
      "templates": "Šablony stránek",
      "widgets": "Widgety nástěnky",
      "pii": "PII a maskování",
      "icons": "Ikony",
      "microcopy": "Mikrotexty"
    },
    "provider": {
      "title": "Použít mého poskytovatele AI",
      "description": "Spusťte obohacení nyní s nakonfigurovaným poskytovatelem. Každý návrh zkontrolujete jako rozdíl.",
      "unconfigured": "Zatím není nakonfigurován žádný poskytovatel AI — zkopírujte prompt do vlastního nástroje níže, nebo nejprve nakonfigurujte poskytovatele.",
      "settingsHint": "Chcete jej spustit přímo?",
      "settingsLink": "Nakonfigurujte poskytovatele v Nastavení → AI",
      "networkDisabled": "Toto Adminium nemá odchozí přístup k internetu, takže nemůže oslovit API poskytovatele. Použijte místo toho kolečko kopírovat-vložit — stejný prompt, stejná kontrola."
    },
    "byo": {
      "cardTitle": "Zkopírovat prompt do vlastního nástroje AI",
      "cardDescription": "Zkopírujte samostatný prompt do Claude Code, ChatGPT, čehokoli — a poté vložte JSON zpět. Není potřeba klíč, nic tento počítač automaticky neopouští.",
      "guidance": "Spusťte to v jakémkoli nástroji AI — Claude Code, ChatGPT, cokoli. Vložte vrácený JSON níže.",
      "promptLabel": "Prompt obohacení",
      "promptLabelN": "Prompt obohacení {index} z {total}",
      "tokenChip": "≈ {tokens} tokenů",
      "copyPrompt": "Kopírovat prompt",
      "copyPromptDone": "Prompt zkopírován",
      "download": "Stáhnout .md",
      "chunkTabs": "Části promptu",
      "chunkTab": "Prompt {index}",
      "chunkValid": "Část {index} ověřena",
      "pasteLabel": "Vložte odpověď JSON",
      "pastePlaceholder": "Sem vložte odpověď JSON…",
      "validate": "Ověřit",
      "valid": "Odpověď ověřena",
      "mergedTitle": "Všech {count} částí ověřeno a sloučeno",
      "mergedTitleSingle": "Odpověď ověřena",
      "mergedBody": "Návrhy jsou připraveny ke kontrole vůči heuristickému základu.",
      "errorsTitle": "Ověření našlo {count} problémů",
      "copyErrors": "Kopírovat chyby pro váš nástroj AI",
      "copyErrorsDone": "Chyby zkopírovány",
      "copyErrorsHint": "Vložte to zpět do svého nástroje AI a získejte opravenou odpověď.",
      "droppedItems": "{count} návrhů bylo při ověření vyřazeno — kontrola zobrazuje zbytek.",
      "pendingTitle": "Pokračujte ověřením každého promptu",
      "pendingBody": "Vložte odpověď JSON výše a ověřte ji, abyste mohli pokračovat ke kontrole.",
      "pendingBodyChunked": "Každá část musí být ověřena, než se návrhy sloučí. Vložte a ověřte každý prompt výše.",
      "requestFailed": "Server nebyl pro ověření dostupný — zkuste to znovu.",
      "continueReview": "Pokračovat ke kontrole",
      "wholeDocument": "celý dokument",
      "cardTitleRecommended": "Zkopírovat prompt do vlastního AI nástroje — doporučeno"
    },
    "direct": {
      "title": "Obohacování pomocí AI",
      "subtitle": "Odesílání vašeho schématu do",
      "building": "Sestavování promptu…",
      "logLabel": "Protokol obohacení",
      "cancel": "Zrušit",
      "back": "Zpět na možnosti",
      "retry": "Zkusit znovu",
      "done": "Obohacení dokončeno — zkontrolujte návrhy.",
      "continueReview": "Pokračovat ke kontrole",
      "failed": "Běh poskytovatele selhal. Zkontrolujte nastavení AI a zkuste to znovu.",
      "jobFailed": "Běh obohacení nebyl dokončen.",
      "startFailed": "Běh se nepodařilo spustit — zkuste to znovu.",
      "errorTitle": "Obohacení selhalo"
    },
    "skip": {
      "title": "Přeskočit — použít pouze heuristiku",
      "description": "Generovat z heuristického základu. Obohatit můžete později v Nastavení → AI — přeskočení není nikdy penalizováno.",
      "confirmTitle": "Pokračování s heuristikou",
      "confirmBody": "Vygenerovaná aplikace použije heuristické popisky, skupiny a nástěnky. Pokračujte v generování — obohacení pomocí AI můžete kdykoli spustit v Nastavení → AI."
    }
  },
  "review": {
    "unavailableTitle": "Obrazovka kontroly není k dispozici",
    "unavailableBody": "Tento build zatím obrazovku kontroly obohacení neobsahuje (06-T14). Přijde s tokem rozdílu a použití."
  },
  "llmRuns": {
    "review": {
      "header": {
        "title": "Zkontrolovat návrhy AI",
        "model": "Model",
        "snapshot": "Snímek",
        "byo": "BYO",
        "pathDirect": "Přímé API",
        "pathByo": "Kopírovat a vložit",
        "agree": "{n} shodných",
        "conflict": "{n} konfliktů",
        "new": "{n} nových",
        "rejects": "{n} zamítnutí",
        "countsAria": "Počty návrhů"
      },
      "bulk": {
        "thresholdLabel": "Práh spolehlivosti",
        "thresholdAria": "Práh spolehlivosti pro „Přijmout vše“",
        "acceptAll": "Přijmout vše ≥ {pct}%",
        "clear": "Zrušit výběr"
      },
      "section": {
        "selectAllAria": "Vybrat vše v {group}",
        "acceptedCount": "{n} přijato"
      },
      "group": {
        "labels": "Popisky a překlady",
        "navigation": "Navigace a domény",
        "enums": "Sémantika výčtů",
        "relations": "Vztahy",
        "keys": "Klíčové sloupce",
        "templates": "Šablony stránek",
        "dashboards": "Nástěnky a widgety",
        "pii": "Osobní údaje a maskování",
        "icons": "Ikony",
        "microcopy": "Mikrotexty"
      },
      "status": {
        "agree": "Souhlasí",
        "conflict": "Konflikt",
        "new": "Nový",
        "heuristicOnly": "Pouze heuristika",
        "rejects": "Zamítá heuristiku",
        "locked": "Uzamčeno"
      },
      "row": {
        "acceptAria": "Přijmout návrh {noun} pro {target}",
        "keptEdited": "ponecháno – upraveno vámi",
        "rejectsCallout": "AI zamítá heuristické rozhodnutí – před přijetím potvrďte.",
        "showTranslations": "Zobrazit překlady",
        "hideTranslations": "Skrýt překlady",
        "confidenceAria": "Spolehlivost {pct}%",
        "noAi": "Žádný návrh AI"
      },
      "value": {
        "none": "Žádná hodnota",
        "absent": "Žádná",
        "dash": "—",
        "display": "Zobrazení",
        "key": "Klíč",
        "rank": "pořadí {n}",
        "span": "šířka {n}",
        "tableCount": "{n} tabulek",
        "widgetCount": "{n} widgetů",
        "enumWorkflow": "Pracovní postup",
        "enumCategory": "Kategorie",
        "notPii": "Nejsou osobní údaje",
        "label": "Popisek",
        "description": "Popis",
        "subtitle": "Podtitul stránky",
        "headline": "Nadpis prázdného stavu",
        "guidance": "Pokyn prázdného stavu"
      },
      "apply": {
        "title": "Použít {n} návrhů",
        "subtitle": "Tyto změny se zapíší v jedné transakci a lze je vrátit zpět.",
        "empty": "Není vybráno nic k použití.",
        "confirm": "Použít změny"
      },
      "footer": {
        "count": "Vybráno {n} návrhů",
        "apply": "Použít {n} přijatých návrhů",
        "failed": "Použití selhalo"
      },
      "toast": {
        "applied": "Použito {n} návrhů",
        "appliedPartial": "Použito {n} návrhů (některé přeskočeny)",
        "applyFailed": "Návrhy se nepodařilo použít",
        "undoFailed": "Tuto změnu se nepodařilo vrátit zpět"
      },
      "error": {
        "title": "Tento běh se nepodařilo načíst"
      },
      "notReady": {
        "title": "Tento běh zatím nemá návrhy ke kontrole",
        "body": "Běh musí být ověřen, než bude možné jeho návrhy zkontrolovat. Nejprve vygenerujte nebo vložte odpověď."
      },
      "applied": {
        "title": "Tento běh byl použit",
        "body": "Přijaté návrhy níže jsou pouze ke čtení."
      },
      "empty": {
        "title": "Žádné návrhy",
        "body": "Tento běh nevytvořil žádné návrhy ke kontrole."
      },
      "cat": {
        "label": "popisek",
        "key": "klíčové sloupce",
        "enum": "výčet",
        "relation": "vztah",
        "pii": "osobní údaje",
        "template": "šablona stránky",
        "group": "navigační skupina",
        "dashboard": "nástěnka",
        "widget": "widget",
        "copy": "mikrotext"
      }
    }
  },
  "wizard": {
    "title": "Nové připojení",
    "back": "Zpět",
    "continue": "Pokračovat",
    "progress": "Průběh nastavení",
    "persistFailed": "Výběr tabulek se nepodařilo uložit — zkuste to znovu.",
    "persistFailedTitle": "Uložení se nezdařilo",
    "bridgeAppliedTitle": "Připojovací řetězec přijat",
    "bridgeAppliedBody": "Předán z adminium.dev vaším prohlížečem — putoval přímo do tohoto počítače a nikdy nebyl nahrán na server. Zkontrolujte jej níže a pokračujte.",
    "bridgeFailedTitle": "Toto předání se nepodařilo použít",
    "bridgeFailedBody": "Už bylo použito nebo vypršelo. Vložte svůj připojovací řetězec níže ručně.",
    "step": {
      "source": "Zdroj",
      "test": "Analyzovat",
      "tables": "Tabulky",
      "meta": "Úložiště metadat",
      "intent": "Záměr",
      "enrich": "Obohatit",
      "generate": "Generovat"
    }
  },
  "meta": {
    "title": "Kde má Adminium uchovávat své vlastní tabulky?",
    "subtitle": "Stránky, role, auditní log a nastavení žijí v tabulkách s předponou adminium_ — nikdy se nemíchají s vašimi daty.",
    "sameDb": {
      "title": "Stejná databáze",
      "description": "Tabulky adminium_* se vytvoří vedle vašich zdrojových tabulek. Nejjednodušší nastavení — vyžaduje roli s právy zápisu a CREATE TABLE.",
      "disabledReadOnly": "Vaše role je jen pro čtení — Adminium do této databáze nikdy nezapisuje. Zvolte pro vlastní tabulky Adminia samostatnou databázi.",
      "disabledNoDdl": "Tato role nemůže spouštět DDL — migrace Adminia vyžadují CREATE TABLE. Zvolte pro vlastní tabulky Adminia samostatnou databázi.",
      "disabledFile": "Soubor schématu nemá živou databázi — zvolte pro vlastní tabulky Adminia samostatnou databázi."
    },
    "separate": {
      "title": "Samostatná databáze",
      "description": "Adminium drží své tabulky v jiné databázi. Váš zdroj zůstává nedotčen — vyžadováno pro zdroje jen pro čtení.",
      "dsn": "Připojovací řetězec meta databáze",
      "helper": "Vyžaduje práva zápisu + DDL — Adminium tam spouští vlastní migrace.",
      "test": "Otestovat připojení",
      "ok": "Kompatibilní — zápis ✓ · DDL ✓",
      "insufficient": "Tato role nemůže hostit meta úložiště — Adminium tam potřebuje práva zápisu a CREATE TABLE.",
      "errorTitle": "Meta úložiště není kompatibilní"
    },
    "testFailed": "Připojení se nezdařilo.",
    "v1Note": {
      "title": "O této instalaci",
      "body": "Tento server už drží své vlastní tabulky v nakonfigurované databázi a tento krok je nepřesouvá. Ověřuje, že je vaše volba kompatibilní s tímto připojením — server vynucuje stejné pravidlo nezávisle (409 META_PLACEMENT_INVALID)."
    },
    "move": {
      "title": "Přesouvání tabulek Adminia",
      "copying": "Přesouvání tabulek Adminia…",
      "restarting": "Restartování…",
      "copyingBody": "Kopírují se všechny tabulky adminium_ do nové databáze. Vašich zdrojových dat se to nedotkne a k přepnutí dojde až po ověření kopie.",
      "restartingBody": "Kopie je hotová. Adminium se restartuje na novou databázi — tato stránka bude za pár sekund pokračovat sama.",
      "failed": "Tabulky Adminia se nepodařilo přesunout — zkuste to znovu.",
      "timeout": "Adminium své tabulky přesunulo, ale zatím se nevrátilo. Vaše data jsou v nové databázi v bezpečí — za chvíli stránku načtěte znovu."
    },
    "willMove": {
      "title": "Tento krok přesune tabulky Adminia",
      "body": "Adminium nyní používá vestavěné úložiště SQLite. Tlačítko Pokračovat zkopíruje toto úložiště do zvolené databáze a restartuje se na ni — účty, stránky i nastavení jdou s ním, takže zůstanete přihlášeni."
    }
  },
  "intent": {
    "title": "Co potřebujete?",
    "subtitle": "Záměr určuje, které stránky se vygenerují. Později ho můžete změnit — změna navrhne regeneraci, nikdy tiché přepsání.",
    "trust": "Čteme pouze vaše schéma — během nastavení nikdy vaše řádková data.",
    "fullAdmin": {
      "title": "Kompletní administrace",
      "description": "Nástěnky, CRUD stránky, vyhledávání, importy a exporty — vše, co vaše schéma podporuje."
    },
    "analytics": {
      "title": "Analytika jen pro čtení",
      "description": "Nástěnky, grafy a mřížky jen pro čtení. Žádné formuláře, žádné zápisy — každá role omezena na Prohlížejícího."
    },
    "crud": {
      "title": "CRUD tabulky",
      "description": "Jedna editační stránka na tabulku plus vyhledávání a import/export — minimální domov, žádné nástěnky."
    },
    "support": {
      "title": "Konzole podpory",
      "description": "Nejprve fronty, stránky tiketů a detailů zákazníků. Mazání ve výchozím stavu vypnuto. (Šablony front přijdou v M7 — sada stránek v1 odpovídá kompletní administraci.)"
    }
  },
  "generate": {
    "title": "Vygenerujte svou aplikaci",
    "subtitle": "Jedna stránka na zahrnutou tabulku plus nástěnky podle domény — záměr:",
    "run": "Vygenerovat nástěnku",
    "openApp": "Otevřít aplikaci",
    "logLabel": "Protokol generování",
    "log": {
      "classifying": "Klasifikace schématu…",
      "composing": "Skládání šablon…",
      "writing": "Zapisování stránek…",
      "done": "Vygenerováno {pages} stránek v {groups} navigačních skupinách"
    },
    "successTitle": "Vaše nástěnka je připravena",
    "successBody": "{pages} stránek v {groups} navigačních skupinách — vygenerováno z vašeho schématu, upravitelné ve Studiu.",
    "errorTitle": "Generování se nezdařilo",
    "failed": "Generování se nezdařilo — zkuste to znovu, nebo nejprve znovu spusťte introspekci.",
    "fileTitle": "Soubor schématu zpracován — generování vyžaduje živou databázi",
    "fileBody": "Vaše schéma se zpracovalo čistě a náhled výše je skutečný. Generování běžící aplikace přímo ze souboru schématu (se zástupnými řádky) zatím není k dispozici — připojte živou databázi a generujte hned."
  },
  "remap": {
    "column": {
      "nullable": "může být NULL",
      "labelOverride": "Zobrazovaný popisek",
      "labelHelper": "Odvozeno: {name}",
      "logicalType": "Logický typ",
      "logicalTypeHelper": "Odvozeno: {type} (z {dbType}) — mapuje adaptér; ve v1 nelze přepsat.",
      "semantic": "Sémantický typ",
      "unclassified": "Zatím neklasifikováno.",
      "semanticHelper": "Klasifikátor: {tag} · spolehlivost {confidence}% · zdroj: {source}",
      "semanticInferred": "odvozeno: {tag}",
      "currency": "Měna",
      "currencyHelper": "Kód ISO 4217 použitý při formátování peněžních částek.",
      "pii": "Ve výchozím stavu maskovat",
      "piiHelper": "Maskované hodnoty se zobrazují skryté; odmaskování vyžaduje oprávnění data.unmask_pii a zaznamenává se do auditního logu.",
      "enum": "Sémantika výčtu",
      "enumKind": "Druh výčtu",
      "enumWorkflow": "Pracovní postup",
      "enumCategory": "Kategorie",
      "enumLabelFor": "Popisek pro {value}",
      "enumToneFor": "Tón pro {value}",
      "enumToneAuto": "automaticky",
      "enumHelper": "Výčty typu pracovní postup řídí stavové štítky a sloupce kanbanu; tóny mapují hodnoty na škálu sémantických odstínů."
    },
    "diff": {
      "one": "1 změna",
      "count": "Změny: {count}",
      "saved": "Úpravy uloženy.",
      "revertOne": "Vrátit {change} zpět",
      "regenerate": "Znovu vygenerovat stránky",
      "revertAll": "Vrátit vše zpět",
      "save": "Uložit úpravy"
    },
    "table": {
      "iconPicker": "Ikona tabulky",
      "system": "Systémová",
      "labelOverride": "Zobrazovaný popisek",
      "labelHelper": "Odvozeno: {name}",
      "icon": "Ikona",
      "navGroup": "Navigační skupina",
      "navGroupHelper": "Umístění v navigaci určuje generátor — úprava table.navGroup není ve slovníku v1.",
      "include": "Zahrnout do vygenerované aplikace",
      "includeHelper": "Vyloučené tabulky nedostanou žádné stránky a zmizí z navigace.",
      "shape": "Tvar tabulky (klasifikovaný)",
      "role": "Role",
      "unclassified": "Neklasifikováno",
      "kind": "Druh",
      "hierarchy": "Hierarchie",
      "selfFk": "Odkaz na sebe přes {column}",
      "polymorphic": "Polymorfní dvojice",
      "rows": "Odhad počtu řádků",
      "shapeHelper": "Klasifikace se přepočítává při každé introspekci; úpravy se vrství navrch a přežijí regeneraci."
    },
    "relations": {
      "declared": "Deklarované cizí klíče",
      "noneDeclared": "Této tabulky se nedotýkají žádné deklarované cizí klíče.",
      "inferred": "Odvozené vztahy",
      "noneInferred": "Pro tuto tabulku nebylo nic odvozeno.",
      "confidence": "odvozeno · {pct}%",
      "accepted": "Přijato",
      "suppressed": "Potlačeno",
      "accept": "Přijmout",
      "suppress": "Potlačit",
      "overrides": "Úpravy vztahů (použité)",
      "overrideBadge": "úprava",
      "add": "Přidat virtuální vztah",
      "fromColumn": "Ze sloupce",
      "noColumns": "Žádný odpovídající sloupec",
      "fromPlaceholder": "customer_id",
      "toTable": "Do tabulky",
      "noTables": "Žádná odpovídající tabulka",
      "toColumn": "Do sloupce",
      "cardinality": "Kardinalita",
      "addButton": "Přidat vztah"
    },
    "toast": {
      "saved": "Úpravy schématu uloženy",
      "savedDetail": "Použité schéma níže odráží vaše změny.",
      "regenerated": "{created} vytvořeno · {updated} aktualizováno · {unchanged} beze změny",
      "regeneratedDetail": "Ručně upravené stránky zůstávají zachovány — na místě byly znovu vygenerovány pouze stránky s nedotčeným generated_hash.",
      "regenerateFailed": "Regenerace se nezdařila"
    },
    "title": "Schéma",
    "subtitle": "{tables} tabulek · použito {applied} úprav",
    "saveFailed": "Uložení se nezdařilo: {message}",
    "loadFailed": "Schéma pro toto připojení se nepodařilo načíst.",
    "inspector": "Inspektor",
    "empty": {
      "title": "Vyberte tabulku nebo sloupec",
      "description": "Vyberte něco ve stromu schématu a přemapujte jeho popisek, typ, vztahy nebo maskování."
    },
    "tabs": {
      "details": "Podrobnosti",
      "relations": "Vztahy"
    },
    "tree": {
      "label": "Schéma",
      "search": "Hledat tabulky a sloupce",
      "searchPlaceholder": "Hledat tabulky…",
      "noMatches": "Vašemu hledání neodpovídají žádné tabulky.",
      "collapse": "Sbalit tabulku",
      "expand": "Rozbalit tabulku",
      "unsaved": "Neuložená změna",
      "excluded": "Vyloučeno"
    },
    "badge": {
      "pk": "PK",
      "fk": "FK",
      "unique": "UNIQUE",
      "pii": "PII",
      "masked": "Maskováno"
    },
    "unavailableTitle": "Editor přemapování schématu není k dispozici",
    "unavailableBody": "Tento build zatím editor přemapování neobsahuje (09-T12). Až přibude, spusťte generování znovu a přemapujte popisky, typy a vztahy.",
    "mode": {
      "design": "Návrh",
      "remap": "Popisky a vztahy",
      "diagram": "Diagram"
    },
    "modeLabel": "Režim editoru",
    "noDesign": {
      "schemaFile": "Toto připojení vzniklo ze souboru se schématem, takže není co měnit. Popisky a vztahy fungují dál.",
      "readOnlyRole": "Toto připojení se přihlašuje rolí jen pro čtení, takže Adminium nemůže měnit jeho schéma.",
      "noPrivilege": "Role tohoto připojení nemůže vytvářet ani měnit tabulky. Udělte jí oprávnění ke schématu, nebo připojte roli, která je má.",
      "readOnlyIntent": "Toto připojení bylo nastaveno pro analytiku jen pro čtení. Chcete-li upravit jeho schéma, změňte v Nastavení jeho účel."
    }
  },
  "publicApi": {
    "error": "Něco se pokazilo",
    "scopes": {
      "deleteTitle": "Smazat tento rozsah",
      "deleteBody": "Každá stránka, která používá klíč navázaný na tento rozsah, přestane načítat data. Klíče se nemažou — pokud jste chtěli udělat tohle, nejprve je odvolejte.",
      "deletePrompt": "Pro potvrzení napište název rozsahu",
      "deleteConfirm": "Smazat rozsah",
      "issuesTitle": "Tento rozsah se nepodařilo zkompilovat",
      "title": "Rozsahy",
      "subtitle": "Rozsah je vše, k čemu klíč smí sáhnout — tabulky, přesné sloupce a filtr, který volající smí zúžit, ale nikdy odstranit.",
      "emptyTitle": "Zatím žádné rozsahy",
      "emptyBody": "Vytvořte si jeden níže. Před uložením se ověří proti vašemu živému schématu.",
      "keyCount": "{count, plural, =0 {žádné klíče} one {# klíč} few {# klíče} many {# klíče} other {# klíčů}}",
      "delete": "Smazat",
      "nameLabel": "Název",
      "connectionLabel": "ID připojení",
      "documentLabel": "Dokument rozsahu",
      "documentHint": "Při uložení se zkompiluje proti vašemu schématu. Každý sloupec, ke kterému se volající dostane, je uvedený zde a nikde jinde. Výchozí hodnotou může být '{'\"$generate\": \"uuid\"'}' nebo '{'\"$generate\": \"now\"'}' — server je při vytváření doplní sám, takže návštěvník může přidat řádek, aniž by volil jeho id.",
      "create": "Vytvořit rozsah",
      "formLabel": "Vytvoření rozsahu"
    },
    "cancel": "Zrušit",
    "close": "Zavřít",
    "title": "Veřejné API",
    "subtitle": "Umožněte svým zákaznickým nebo zaměstnaneckým stránkám číst tuto databázi prostřednictvím rozsahu, který určíte.",
    "notRegistered": {
      "title": "Na tomto serveru není zapnuto",
      "body": "Nastavte ADMINIUM_PUBLIC_API_ORIGINS na přesné adresy původu, které smějí volat, a poté restartujte. Do té doby se tyto cesty vůbec neobsluhují."
    },
    "toggle": {
      "label": "Obsluhovat veřejné API",
      "hint": "Vypnutím se okamžitě zastaví každý veřejný požadavek. Nic se nemaže — klíče, rozsahy i data zůstávají zachovány."
    },
    "origins": {
      "label": "Adresy původu, které smějí volat"
    },
    "keys": {
      "title": "Klíče",
      "subtitle": "Vkládají se do JavaScriptu vaší stránky, takže je může kdokoli přečíst. Tak to má být — klíč nikdy nezmůže víc, než co dovoluje jeho rozsah.",
      "emptyTitle": "Zatím žádné klíče",
      "emptyBody": "Nejprve vytvořte rozsah a pak pro něj vytvořte klíč.",
      "reveal": "Zobrazit klíč",
      "rotate": "Rotovat",
      "revoke": "Odvolat",
      "nameLabel": "Název",
      "scopeLabel": "Rozsah",
      "scopePlaceholder": "Vyberte rozsah",
      "create": "Vytvořit klíč",
      "formLabel": "Vytvoření klíče",
      "scopeIsAuthTitle": "Jediným oprávněním je rozsah",
      "scopeIsAuthBody": "Klíč se dostane přesně k tomu, co uvádí jeho rozsah, a k ničemu jinému. Nepoužívá role ani oprávnění k tabulkám a přes zbytek API nepřečte nic.",
      "appLabel": "Navázat na hostovanou aplikační plochu (volitelné)",
      "appHint": "Zákaznická plocha aplikace pak tento klíč obsluhuje sama — jeho rotace nevyžaduje rebuild.",
      "appNone": "Nenavázán"
    },
    "status": {
      "heading": "Stav"
    }
  },
  "hostedApps": {
    "title": "Hostované aplikace",
    "subtitle": "Aplikační plochy, které tato instance obsluhuje — kde se každá zobrazuje a které domény na ně míří.",
    "error": "Něco se pokazilo",
    "emptyTitle": "Žádné aplikační plochy se neobsluhují",
    "emptyBody": "Nasměrujte ADMINIUM_SURFACES_DIR na adresář sestavených ploch — složka pro každou aplikaci a stranu, každá se svým index.html — a restartujte. Poté se obsluhují pod /apps/ a objeví se zde.",
    "surfaces": {
      "title": "Plochy",
      "subtitle": "Plocha pro tým se může vsadit do bočního panelu tohoto dashboardu, nebo stát samostatně; zákaznická plocha je veřejná a čte přes svůj navázaný klíč.",
      "staff": "Tým",
      "customer": "Zákazník",
      "noNav": "Interní umístění není dostupné — sestavte tuto plochu znovu aktuálním toolkitem, aby vydávala surface.json.",
      "noKey": "Není navázán žádný klíč — dokud se pro tuto plochu nevytvoří, nemůže číst data.",
      "mintLink": "Vytvořit ve Veřejném API",
      "boundKey": "Obsluhuje klíč",
      "placementLabel": "Umístění",
      "placementInternal": "V bočním panelu (vsazená)",
      "placementExternal": "Externí (jen vlastní URL)",
      "connectionLabel": "Čte",
      "connectionUnset": "Kterékoli aktivní"
    },
    "domains": {
      "title": "Domény",
      "subtitle": "Nasměrujte DNS domény na svůj proxy server, předávejte hlavičku Host do Adminia a připojte ji zde — tento host pak obsluhuje plochu místo tohoto dashboardu. Certifikáty zůstávají na vašem proxy serveru.",
      "issuesTitle": "Mapa domén byla odmítnuta",
      "savedTitle": "Uloženo",
      "savedBody": "Přiřazení se projeví během několika sekund. Host odpovídá, až když jeho DNS a váš proxy server tuto instanci skutečně dosáhnou.",
      "none": "Žádné domény nejsou připojeny.",
      "hostLabel": "Host",
      "surfaceLabel": "Plocha",
      "remove": "Odebrat",
      "add": "Připojit doménu",
      "save": "Uložit domény",
      "instanceLabel": "Instance",
      "instanceOwn": "Samotná aplikace"
    },
    "instances": {
      "title": "Instance",
      "body": "Poskytujte stejnou aplikaci nad více databázemi. Každá instance je dostupná na /apps/<app>/<segment>/<side>/ a čte jen připojení, které jí dáte.",
      "appLabel": "Aplikace",
      "slugLabel": "Segment URL",
      "readsLabel": "Čte",
      "add": "Přidat instanci",
      "save": "Uložit instance",
      "remove": "Odebrat",
      "empty": "Žádné další instance.",
      "failed": "Instance se nepodařilo uložit"
    }
  },
  "addOns": {
    "plan": {
      "blocked": "This cannot be installed here",
      "needsColumns": "This add-on needs columns you do not have",
      "needsColumnsBody": "Adminium will not add columns to tables you already own. Add them yourself, then install.",
      "willCreate": "This will create tables in your database",
      "willCreateBody": "Installing creates these tables. Uninstalling later leaves them, and their data, alone.",
      "noData": "This add-on reads and writes no tables of its own.",
      "reuse": "This add-on will use tables you already have:"
    },
    "consent": {
      "title": "Install {name}",
      "subtitle": "What this add-on will do, before it can do it.",
      "close": "Close",
      "loading": "Working out what this would do…",
      "hosts": "Attach to",
      "cancel": "Cancel",
      "confirm": "Install"
    },
    "connect": {
      "apiKey": "API key",
      "submit": "Connect"
    },
    "title": "Add-ons",
    "subtitle": "Extra capabilities you can add to your apps — shipping, artwork, data. Each one says what it needs before you install it.",
    "error": "Something went wrong",
    "browse": {
      "title": "Available",
      "online": "Includes add-ons from the online catalogue. Checking for newer versions is a separate action.",
      "offline": "Showing the add-ons that came with this build. Browsing online is switched off, and nothing here has contacted the internet.",
      "refresh": "Check for newer",
      "emptyTitle": "No add-ons available",
      "emptyBody": "This build shipped none, and the online catalogue is off.",
      "bundled": "Included",
      "upgrade": "v{version} available",
      "download": "Download",
      "install": "Install",
      "discard": "Discard",
      "upgradeAction": "Upgrade",
      "toggle": "Browse the online catalogue",
      "all": "Vše",
      "categories": "Kategorie",
      "search": "Hledat doplňky",
      "noMatchTitle": "Žádná shoda",
      "noMatchBody": "Tomuto hledání a kategorii neodpovídá žádný doplněk.",
      "emptyOnlineBody": "Online katalog je zapnutý, ale poslední kontrola nic nenašla. Zkuste vyhledat novinky."
    },
    "installed": {
      "title": "Installed",
      "emptyTitle": "Nothing installed yet",
      "emptyBody": "Install an add-on above and it will appear here with its hosts and connection.",
      "connected": "Connected",
      "notConnected": "Not connected",
      "egress": "May contact: {hosts}",
      "on": "on",
      "off": "off",
      "disconnect": "Disconnect",
      "uninstall": "Uninstall"
    },
    "confirm": {
      "close": "Close",
      "disconnectTitle": "Disconnect this add-on",
      "uninstallTitle": "Uninstall this add-on",
      "discardTitle": "Discard this download",
      "disconnectBody": "Its keys are deleted and it stops making calls. Every table and every row it created stays exactly as it is, and you can reconnect at any time.",
      "uninstallBody": "Its keys are deleted and its files are removed from this server. Every table and every row it created stays exactly as it is. You can install it again later.",
      "discardBody": "The downloaded files are deleted. Nothing was installed, so nothing else changes — you can download it again whenever you like.",
      "cancel": "Cancel",
      "disconnect": "Disconnect",
      "uninstall": "Uninstall",
      "discard": "Discard"
    },
    "upgradeNote": "Upgrading keeps the hosts an add-on is attached to and the connection it already has.",
    "job": {
      "title": "Downloading",
      "body": "Fetching and verifying. Nothing is installed until you say so.",
      "failed": "The download did not finish. Nothing was installed."
    },
    "veto": {
      "title": "This deployment cannot browse online",
      "body": "The setting is saved, but network features are off for this server and that wins. Downloaded add-ons still work, and you can still upload one yourself."
    },
    "sideload": {
      "title": "Upload a package",
      "hint": "For a server with no internet. It is checked exactly as a download would be, so it needs the hash that came with it.",
      "file": "Package file (.tgz)",
      "key": "Add-on key",
      "version": "Version",
      "sha": "Integrity (sha512-…)",
      "shaHint": "The `integrity` value `npm pack --json` printed. The upload is refused if the bytes do not match.",
      "submit": "Upload"
    },
    "card": {
      "needsApiKey": "Vyžaduje API klíč",
      "needsOauth": "Připojuje se přes OAuth"
    },
    "category": {
      "artwork": "Grafika",
      "delivery": "Doprava",
      "payments": "Platby",
      "email": "E-mail",
      "data": "Data"
    },
    "settings": {
      "title": "Nastavení",
      "save": "Uložit nastavení",
      "badJson": "Toto není platný JSON, takže se nic neuložilo."
    }
  },
  "pages": {
    "title": "Stránky",
    "subtitle": "Přidávejte, upravujte a uspořádejte stránky své aplikace i jejich pořadí v postranním panelu.",
    "createButton": "Nová stránka",
    "loadFailed": {
      "title": "Stránky se nepodařilo načíst",
      "body": "Správa stránek vyžaduje oprávnění „Spravovat stránky“. Požádejte správce, aby ho přidal některé z vašich rolí."
    },
    "tab": {
      "pages": "Všechny stránky",
      "sidebar": "Pořadí v panelu"
    },
    "list": {
      "title": "Stránky",
      "count": "{count, plural, one {# stránka} few {# stránky} many {# stránky} other {# stránek}}"
    },
    "empty": {
      "title": "Zatím žádné stránky",
      "body": "Připojte databázi a stránky se vygenerují automaticky, nebo si jednu vytvořte ručně."
    },
    "status": {
      "live": "Aktivní",
      "hidden": "Skrytá"
    },
    "origin": {
      "generated": "Vygenerovaná",
      "manifest": "Doplněk",
      "llm": "Asistent",
      "system": "Systémová",
      "user": "Vlastní"
    },
    "row": {
      "menu": "Akce pro {title}"
    },
    "action": {
      "edit": "Upravit stránku",
      "duplicate": "Duplikovat",
      "hide": "Skrýt z postranního panelu",
      "show": "Zobrazit v postranním panelu",
      "delete": "Smazat stránku"
    },
    "create": {
      "title": "Nová stránka",
      "failed": "Stránku se nepodařilo vytvořit",
      "submit": "Vytvořit stránku",
      "subtitle": "Vyberte, co stránka zobrazuje a jak vypadá. Náhled sleduje vaše volby."
    },
    "duplicate": {
      "title": "Duplikovat stránku",
      "failed": "Stránku se nepodařilo duplikovat",
      "submit": "Duplikovat"
    },
    "delete": {
      "title": "Smazat tuto stránku?",
      "body": "Tuto akci nelze vrátit zpět. Uložená zobrazení i osobní rozvržení této stránky budou smazána všem.",
      "bodyGenerated": "Tato stránka vznikla generováním ze schématu, takže se při dalším generování vrátí. Uložená zobrazení a osobní rozvržení budou smazána všem.",
      "prompt": "Pro potvrzení napište {slug}",
      "confirm": "Smazat stránku"
    },
    "field": {
      "title": "Název",
      "titleHint": "Zobrazuje se v postranním panelu a v hlavičce stránky.",
      "newRowLabel": "Tlačítko pro přidání",
      "newRowLabelHint": "Co je napsáno na tlačítku, které přidává záznam. Ponechte prázdné pro výchozí popisek, který je přeložený.",
      "slug": "Adresa stránky",
      "slugHint": "Malá písmena, číslice a pomlčky. Jen poslední část – zbytek adresy doplníme za vás.",
      "slugTaken": "Tuto adresu už používá jiná stránka.",
      "slugWarning": "Změna adresy rozbije stávající odkazy a záložky na tuto stránku.",
      "template": "Šablona",
      "templateHint": "Určuje, co stránka může obsahovat. Lze změnit později.",
      "group": "Skupina v panelu",
      "groupHint": "Ve které části postranního panelu se objeví.",
      "icon": "Ikona",
      "iconHint": "Zobrazuje se vedle názvu stránky v postranním panelu.",
      "visible": "Zobrazit v postranním panelu",
      "visibleHint": "Skrytá stránka zůstává dostupná na své URL každému, kdo má odkaz.",
      "table": "Tabulka",
      "tableCreateHint": "Tabulka, ze které stránka čte. Vyberte ji hned a stránka bude rovnou použitelná; bez výběru ji můžete připojit později.",
      "tableNone": "Nepřipojeno",
      "tableNeedsConnection": "Nejprve vyberte zdroj dat.",
      "connection": "Zdroj dat",
      "connectionNone": "Žádný",
      "iconPick": "Vyberte ikonu stránky",
      "padding": "Okraje stránky",
      "width": "Šířka obsahu",
      "widthHint": "Jak široký může být sloupec s obsahem stránky na velké obrazovce."
    },
    "editor": {
      "title": "Upravit stránku",
      "save": "Uložit změny",
      "saveFailed": "Změny se nepodařilo uložit",
      "openPage": "Otevřít stránku",
      "generated": {
        "title": "Tato stránka byla vygenerována z vašeho schématu",
        "body": "Vaše změny při dalším generování zůstanou – stránka se označí jako upravená a nechá se být. Smazání ale vydrží jen do chvíle, než ji další generování znovu vytvoří."
      },
      "contentUnavailable": "Obsah stránky se nepodařilo načíst",
      "contentUnavailableBody": "Údaje výše lze i tak uložit.",
      "contentInvalid": "Konfiguraci této stránky nelze přečíst",
      "contentInvalidBody": "Pochází z novější verze, nebo je poškozená. Vygenerujte stránku znovu, nebo ji smažte.",
      "data": "Data",
      "schemaFailed": "Tabulky se nepodařilo načíst",
      "schemaFailedBody": "Toto připojení možná ještě nebylo analyzováno. Spusťte introspekci ve Studiu → Datová připojení.",
      "notBindable": "Tato šablona není vázaná na jednu tabulku",
      "notBindableBody": "Její obsah se skládá z widgetů. Otevřete stránku a přidejte je tlačítkem „Upravit“.",
      "recompose": "Tato stránka bude znovu sestavena",
      "recomposeBody": "Uložení nahradí její obsah novým rozvržením pro šablonu a tabulku výše. Úpravy sloupců a widgetů na této stránce budou ztraceny.",
      "missing": "Tato stránka už neexistuje",
      "missingBody": "Mohla být smazána nebo odstraněna generováním.",
      "details": "Podrobnosti",
      "itemsPending": "Nejprve uložte změnu výše – obsah stránky se znovu sestaví z nové šablony a tabulky.",
      "columns": "Sloupce",
      "appearance": "Vzhled",
      "derived": "Odvozená čísla",
      "attachments": "Přílohy"
    },
    "sidebar": {
      "help": "Změňte pořadí stránek uvnitř skupiny, nebo některou přesuňte do jiné skupiny. Změny platí pro všechny.",
      "discard": "Zahodit",
      "save": "Uložit pořadí",
      "saveFailed": "Nové pořadí se nepodařilo uložit",
      "emptyGroup": "V této skupině nejsou žádné stránky.",
      "moveUp": "Posunout {title} nahoru",
      "moveDown": "Posunout {title} dolů",
      "moveTo": "Přesunout {title} do skupiny",
      "ungrouped": {
        "title": "Některé stránky nepatří do žádné skupiny",
        "body": "Tyto stránky na své URL fungují, ale v postranním panelu se nikde neobjeví. Otevřete každou z nich a vyberte skupinu."
      }
    },
    "columns": {
      "help": "Přetažením změňte pořadí sloupců, přejmenujte jejich záhlaví a vyberte, které se v tabulce zobrazí.",
      "empty": "Zatím žádné sloupce — přidejte je níže.",
      "pk": "Klíč",
      "masked": "Maskováno",
      "header": "Záhlaví pro {name}",
      "shown": "Zobrazeno",
      "mask": "Maskovat",
      "maskToggle": "Skrýt {name} za tlačítko pro zobrazení",
      "avatar": "Avatar",
      "avatarToggle": "Zobrazit monogram vedle {name}",
      "maskHelp": "Maskování skryje hodnotu za tlačítko pro zobrazení těm, kdo ji smí vidět. To, zda data vůbec opustí databázi, se nastavuje u připojení, ne zde.",
      "toggle": "Zobrazit {name} v tabulce",
      "dragHandle": "Přesunout {name}",
      "remove": "Odebrat {name}",
      "addOpen": "Přidat sloupec",
      "addTitle": "Přidat sloupec",
      "addSearch": "Hledat sloupce…",
      "addFromTable": "Z tabulky {table}",
      "addFromLinked": "Z propojených tabulek",
      "addLinkedHelp": "Zobrazí hodnotu z tabulky, na kterou odkazuje propojovací sloupec.",
      "addVia": "přes {column}",
      "addNoMatches": "Dotazu „{query}“ neodpovídají žádné sloupce.",
      "followColumn": "Sledovat {name}",
      "addLinkedFrom": "Tabulky, které sem odkazují",
      "addLinkedFromHelp": "Spočítejte řádky odkazující na každý záznam nebo sečtěte jedno z jejich čísel.",
      "countBadge": "Počet",
      "lookupBadge": "Propojený",
      "lookupBack": "Zpět",
      "lookupBrowse": "Vyberte, co zobrazit z tabulky {table}",
      "lookupBroken": "Toto propojení už nelze vyhodnotit",
      "lookupBrokenBody": "Schéma se mezitím změnilo. Začněte propojení znovu.",
      "schemaUnavailable": "Sloupce databáze se nepodařilo načíst, takže zde nelze sloupce přidat.",
      "none": {
        "title": "Tato stránka zatím nemá sloupce",
        "body": "Sloupce se při generování stránky načtou z tabulky. Připojte tuto stránku k tabulce a vygenerujte ji znovu."
      },
      "foldLabel": "Agregace",
      "foldAdd": "Přidat",
      "fold": {
        "sum": "Součet",
        "avg": "Průměr",
        "min": "Min",
        "max": "Max"
      },
      "file": {
        "ref": {
          "url": "Odkaz na soubor",
          "id": "ID souboru v Adminiu",
          "key": "Klíč v cíli úložiště"
        },
        "type": {
          "pdf": "PDF",
          "png": "PNG",
          "jpeg": "JPEG",
          "gif": "GIF",
          "webp": "WebP",
          "heic": "HEIC",
          "svg": "SVG",
          "zip": "ZIP",
          "office": "Dokumenty Office",
          "mp4": "Video MP4",
          "mp3": "Zvuk MP3",
          "wav": "Zvuk WAV",
          "webm": "WebM",
          "ogg": "Ogg",
          "csv": "CSV",
          "text": "Prostý text",
          "markdown": "Markdown",
          "json": "JSON"
        },
        "badge": "Soubor",
        "switch": "Soubor",
        "switchToggle": "{name} ukládá soubor",
        "refLabel": "Uložená hodnota",
        "refHelp": "Co se do tohoto sloupce zapíše při nahrání souboru. Už uložené hodnoty fungují dál — mění se jen ta příští.",
        "refTooNarrow": "Tento sloupec je příliš krátký, než aby takovou hodnotu pojal. Vyberte takovou, kterou pojme, nebo sloupec v databázi rozšiřte.",
        "refWidth": "{shape} — potřebuje {needs} znaků, tento sloupec pojme {holds}",
        "destinationLabel": "Cíl úložiště",
        "destinationHelp": "Kam se ukládají data nahraná přes tento sloupec.",
        "destinationDefault": "Výchozí cíl úložiště",
        "acceptLabel": "Povolené typy",
        "acceptHelp": "Nechte všechny typy vypnuté a sloupec přijme vše, co přijímá tento workspace. Výběrem typů lze seznam jen zúžit — sloupec nikdy nepřijme typ, který workspace odmítá.",
        "maxLabel": "Největší soubor (MB)",
        "maxHelp": "Nechte prázdné a použije se limit workspace. Sloupec může chtít jen méně.",
        "maxToggle": "Největší soubor, který {name} přijme, v MB",
        "inlineLabel": "Zobrazit v tabulce",
        "inlineHelp": "V buňce se vykreslí jen obrázky. Vše ostatní zůstane štítkem s názvem a velikostí, ať je toto nastaveno jakkoli.",
        "maxCountHelp": "Nechte prázdné, aby se přijalo tolik souborů, kolik záznam potřebuje.",
        "maxCountLabel": "Nejvíce souborů na záznam",
        "maxCountToggle": "Nejvíce souborů pro {name}",
        "multipleHelp": "Sloupec ukládá seznam souborů místo jednoho. Stávající jednotlivé hodnoty fungují dál — čtou se jako seznam s jednou položkou.",
        "multipleLabel": "Pojmout více souborů"
      }
    },
    "icon": {
      "none": "Vyberte ikonu",
      "search": "Hledat ikony",
      "noMatches": "Tomuto hledání neodpovídají žádné ikony."
    },
    "preview": {
      "untitled": "Nepojmenovaná stránka",
      "note": "Nákres rozvržení, nikoli vašich dat. Skutečná stránka se naplní po uložení."
    },
    "padding": {
      "default": "Výchozí pro tuto šablonu",
      "none": "Žádné",
      "standard": "Standardní (28 × 24)",
      "custom": "Vlastní…",
      "x": "Po stranách (px)",
      "y": "Nahoře a dole (px)"
    },
    "width": {
      "default": "Výchozí pro tuto šablonu",
      "narrow": "Úzká (720 px)",
      "content": "Obsah (900 px)",
      "page": "Stránka (1080 px)",
      "dash": "Dashboard (1320 px)",
      "wide": "Široká (1800 px)",
      "full": "Celá šířka (bez omezení)"
    },
    "derived": {
      "help": "Vypočítejte čísla ze souhrnů výše a z vlastních sloupců tohoto záznamu. Počítají se při načtení stránky a nelze je řadit.",
      "foldBadge": "Souhrn",
      "fieldBadge": "Vypočteno",
      "remove": "Odebrat {name}",
      "emptyTitle": "Zatím žádná vypočtená čísla",
      "emptyBody": "Nejdřív shrňte propojenou tabulku v kartě Sloupce — pravidla zde se staví z těchto čísel.",
      "label": "Záhlaví sloupce",
      "operandA": "Číslo",
      "operandB": "Číslo",
      "operator": "Operátor",
      "minus": "minus",
      "plus": "plus",
      "percentOf": "procent z tohoto záznamu",
      "atLeast": "je alespoň",
      "thenShow": "pak zobrazit",
      "otherwise": "jinak",
      "numberHelp": "Čísla jsou prostá desetinná — 500 nebo 12.50, nikdy 1,000 nebo 5e3.",
      "add": "Přidat sloupec",
      "cancel": "Zrušit",
      "previewTitle": "Náhled",
      "previewHelp": "Ukázkové hodnoty, spočítané stejným kódem, jaký používá stránka.",
      "preset": {
        "combine": "Sečíst nebo odečíst dvě čísla",
        "percent": "Procento z čísla",
        "rule": "Pravidlo s prahem"
      }
    },
    "attachments": {
      "type": {
        "office": "Dokumenty Office",
        "text": "Prostý text"
      },
      "destinationIsDefault": "{name} (výchozí)",
      "enable": "Povolit přílohy u záznamů této tabulky",
      "enableHint": "Soubory se propojují na straně Adminia, takže tato tabulka nepotřebuje nový sloupec — funguje to i na připojení jen pro čtení a na tabulce, kterou raději neměníte.",
      "destination": "Kam soubory míří",
      "destinationHint": "Ponechte výchozí, pokud soubory této tabulky nepatří jinam.",
      "destinationDefault": "Výchozí cíl úložiště",
      "destinationLocal": "Disk tohoto serveru",
      "accept": "Povolené typy souborů",
      "acceptHint": "Když nevyberete žádný, přijme se vše, co tento workspace povoluje. Volba zde může seznam jen zúžit, nikdy rozšířit.",
      "maxBytes": "Největší soubor (MB)",
      "maxBytesHint": "Nechte prázdné a bude se řídit limitem workspace. Číslo zde ho může jen snížit.",
      "maxCount": "Nejvíc souborů na záznam",
      "maxCountHint": "Nechte prázdné a přijme se jich tolik, kolik záznam potřebuje.",
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
      "enableHintColumn": "Soubory se ukládají do jednoho sloupce této tabulky, takže se objeví v dialozích Nový a Upravit i u každého záznamu.",
      "enableHintSidecar": "Soubory se místo toho propojí na straně Adminia. Objeví se na stránce každého záznamu, ne v dialogu Nový.",
      "sidecar": {
        "readOnlyIntent": "Toto připojení je nastavené jen pro čtení a analýzu, takže do něj Adminium nemůže přidat sloupec.",
        "readOnlyRole": "Toto připojení se přihlašuje rolí jen pro čtení, takže do něj Adminium nemůže přidat sloupec.",
        "schemaFile": "Toto připojení vzniklo ze souboru se schématem, takže do něj Adminium nemůže přidat sloupec.",
        "noPrivilege": "Role tohoto připojení nemůže měnit tabulky, takže do něj Adminium nemůže přidat sloupec."
      }
    }
  },
  "design": {
    "apply": "Použít",
    "column": {
      "key": "Klíč",
      "length": "Délka",
      "name": "Název",
      "precision": "Přesnost",
      "remove": "Odebrat {name}",
      "required": "Povinné",
      "type": "Typ",
      "unique": "Jedinečné",
      "primaryKey": "Primární klíč",
      "help": "Co tato nastavení znamenají?",
      "link": "Odkazuje na",
      "linkHelp": "Propojte to s řádkem v jiné tabulce.",
      "noLink": "Nic",
      "onDelete": "Když je propojený řádek smazán",
      "linkTypeNote": "Typ odpovídá klíči propojené tabulky.",
      "namePlaceholder": "client_id"
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
    "empty": {
      "body": "Vytvořte tabulku nebo vyberte jednu k úpravě. Do vaší databáze se nic nedostane, dokud si příkazy neprohlédnete a nepoužijete je.",
      "title": "Navrhněte své schéma"
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
    "newTable": "Nová tabulka",
    "plan": "Zkontrolovat změny",
    "result": {
      "applied": "Použito. Adminium znovu načetlo vaše schéma.",
      "partial": "Částečně použito: proběhlo {done} z {total} kroků. Opětovné použití stejných změn je dokončí.",
      "repaired": "Přejmenování se promítlo do {pages, plural, one {# stránky} few {# stránek} many {# stránky} other {# stránek}}, {grants, plural, one {# oprávnění role} few {# oprávnění rolí} many {# oprávnění role} other {# oprávnění rolí}} a {overrides, plural, one {# přepisu schématu} few {# přepisů schématu} many {# přepisu schématu} other {# přepisů schématu}}.",
      "failed": "Nic nebylo použito — vaše databáze je beze změny. {error}"
    },
    "review": {
      "noChanges": "Zatím žádné změny schématu.",
      "pending": "Zkontrolujte své změny a uvidíte přesné příkazy, které Adminium spustí.",
      "steps": "Plánované kroky",
      "superAdmin": "Super administrátor",
      "unfinished": "Předchozí použití na tomto připojení nikdy neohlásilo výsledek. Jeho schéma může být na půli cesty mezi dvěma podobami — před dalším použitím zkontrolujte historii změn."
    },
    "table": {
      "addColumn": "Přidat sloupec",
      "columns": "Sloupce",
      "name": "Název tabulky",
      "nameHelp": "Malá písmena, číslice a podtržítka.",
      "noKey": "Tato tabulka nemá primární klíč, takže s ní Adminium bude zacházet jen pro čtení — řádky lze vypsat, ale ne upravovat.",
      "renameHelp": "Změna přejmenuje tabulku ve vaší databázi.",
      "uuidKeyUnavailable": "Na tomto enginu musí být klíč generované celé číslo: uuid generované databází nelze po vložení přečíst zpět.",
      "drop": "Smazat tuto tabulku",
      "dropHelp": "Tabulka i všechny její řádky budou zničeny. Než se cokoli spustí, uvidíte přesně, co se rozbije.",
      "namePlaceholder": "reservations"
    },
    "reviewPane": "Kontrola",
    "error": {
      "empty": "Název je povinný.",
      "identifier": "Použijte malá písmena, číslice a podtržítka, začněte písmenem.",
      "tooLong": "Příliš dlouhé — {dialect} povoluje {max} znaků.",
      "atColumn": "Sloupec {n}, {field}",
      "atTable": "Tabulka {field}"
    },
    "onDelete": {
      "restrict": "Zabránit smazání",
      "cascade": "Smazat i tento řádek",
      "setNull": "Ponechat pole prázdné"
    },
    "help": {
      "title": "Co tato pole znamenají",
      "subtitle": "Srozumitelný popis každého nastavení a toho, co mění pro lidi, kteří vaši aplikaci používají.",
      "close": "Zavřít",
      "type": {
        "term": "Typ",
        "what": "Jaký druh informace pole obsahuje — text, celá čísla, peníze, datum, odpověď ano/ne. Právě díky správné volbě umí Adminium zobrazit výběr data místo textového pole a sečíst sloupec s penězi.",
        "example": "Telefonní číslo je obvykle text, ne číslo — u čísel se ztrácejí úvodní nuly."
      },
      "required": {
        "term": "Povinné",
        "what": "Pole musí být vyplněné. Dokud je prázdné, řádek nejde uložit.",
        "example": "Objednávka potřebuje zákazníka, takže to pole je povinné. Poznámka k doručení je volitelná, takže povinná není."
      },
      "unique": {
        "term": "Jedinečné",
        "what": "Žádné dva řádky nesmějí mít stejnou hodnotu. Ten druhý databáze odmítne.",
        "example": "Dva zákazníci by neměli sdílet stejnou e-mailovou adresu — označte ji jako jedinečnou a nepůjde to."
      },
      "primaryKey": {
        "term": "Primární klíč",
        "what": "Pole, které identifikuje každý řádek — to, podle kterého Adminium rozezná jeden řádek od druhého. Každá tabulka by měla mít právě jedno a téměř vždy je to pole „id“, které za vás vzniklo.",
        "example": "Bez primárního klíče umí Adminium řádky vypsat, ale nemůže jednotlivý řádek upravit ani smazat."
      },
      "link": {
        "term": "Vazba na jinou tabulku",
        "what": "Propojí tento řádek s řádkem v jiné tabulce a nechá databázi hlídat, aby vazba držela — nemůžete ukázat na něco, co neexistuje.",
        "example": "Rezervace se váže na klienta. Adminium pak u rezervace zobrazí klienta a u klienta jeho rezervace."
      }
    },
    "unrepresentableDefaults": "Tyto sloupce si ponechávají výchozí hodnotu generovanou databází, kterou zde Adminium nemůže upravit, a zůstává beze změny: {columns}",
    "dropping": "Označeno ke smazání",
    "keepTable": "Ponechat {table}",
    "adopt": {
      "offer": "Nová tabulka nic nedělá, dokud nemá stránku. Přidat {tables} do aplikace?",
      "grants": "Žádná role nezíská přístup automaticky — udělte jej v Nastavení → Role.",
      "action": "Přidat do aplikace",
      "done": "Vytvořeno {created} stránek, aktualizováno {updated}, {unchanged} už bylo aktuálních.",
      "skippedEdited": "Ponechány beze změny, protože jste je upravili: {pages}.",
      "everything": "Toto připojení už zobrazuje všechny tabulky, nebylo tedy třeba nic zahrnout.",
      "forbidden": "Vaše role může měnit schéma, ale ne generovat stránky. Požádejte správce se správou připojení, aby tyto tabulky přidal do aplikace."
    },
    "unnamed": "Pojmenujte každou tabulku a sloupec, abyste mohli změny zkontrolovat.",
    "ceiling": {
      "prompt": "Pro autorizaci přepisu napište {table} znovu",
      "body": "{table} má přes {rows} řádků — víc, než Adminium přepisuje samo. Autorizovat to může jen Super Admin a tabulka bude po celou dobu přepisu zamčená.",
      "hint": "Napište název tabulky přesně tak, jak je uveden výše.",
      "notYours": "{table} má přes {rows} řádků. Přepis takového rozsahu může autorizovat jen Super Admin — požádejte ho, nebo změnu proveďte v servisním okně vlastními nástroji.",
      "authorise": "Autorizovat tento přepis"
    }
  },
  "diagram": {
    "ceiling": "Zobrazuje se {shown} nejvíce propojených tabulek. Dalších {omitted} je skrytých — vyhledejte je a přidejte.",
    "legendLabel": "Legenda",
    "legend": {
      "declared": "Cizí klíč",
      "inferred": "Odvozeno",
      "virtual": "Přidáno v Adminiu"
    },
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
  "storage": {
    "driver": {
      "local": "Cesta na tomto stroji",
      "s3": "Bucket kompatibilní s S3",
      "webdav": "Server WebDAV"
    },
    "preset": {
      "aws": "AWS S3",
      "spaces": "DigitalOcean Spaces",
      "r2": "Cloudflare R2",
      "tigris": "Tigris",
      "b2": "Backblaze B2",
      "wasabi": "Wasabi",
      "minio": "MinIO nebo jiný server kompatibilní s S3"
    },
    "status": {
      "ok": "Dostupný",
      "error": "Nedostupný",
      "untested": "Neotestovaný"
    },
    "title": "Úložiště",
    "subtitle": "Kam tato instance ukládá nahrané soubory, exporty a další uložená data.",
    "move": {
      "open": "Přesunout soubory…",
      "startedTitle": "Přesun byl zahájen",
      "startedBody": "Běží na pozadí jako úloha {jobId} a pokračuje, i když tuto stránku opustíte. Počty níže se s přibývajícími soubory mění — načtěte stránku znovu, abyste je viděli.",
      "title": "Přesunout soubory",
      "subtitle": "Zkopíruje každý soubor z jednoho cíle do druhého a pak na starou kopii zapomene. Stahování po celou dobu funguje dál.",
      "from": "Odkud",
      "to": "Kam",
      "start": "Spustit přesun",
      "kinds": "Omezit na",
      "kindsHelp": "Nechte vše nezaškrtnuté, chcete-li přesunout všechny. Nahrané soubory jsou ty, které lidé přikládají; zbytek jsou artefakty, které vytvořilo Adminium."
    },
    "add": "Přidat cíl úložiště",
    "loadFailed": {
      "title": "Cíle úložiště se nepodařilo načíst",
      "forbidden": "Změna místa, kam se soubory ukládají, vyžaduje oprávnění „Spravovat úložiště“. Požádejte správce, aby ho přidal některé z vašich rolí."
    },
    "actionFailed": "To se nepovedlo",
    "delete": {
      "blockedTitle": "Tento cíl stále obsahuje soubory",
      "blockedBody": "{name} stále obsahuje {count, plural, one {# soubor} few {# soubory} many {# souboru} other {# souborů}}. Nejprve je přesuňte do jiného cíle a pak ho smažte.",
      "title": "Smazat tento cíl",
      "body": "Adminium zapomene {name} i jeho přihlašovací údaje. Ničeho, co je v něm uloženo, se to nedotkne — bucket nebo server patří vám, a dokud jsou u něj evidované nějaké soubory, smazání se odmítne.",
      "confirm": "Smazat cíl"
    },
    "list": {
      "title": "Cíle úložiště",
      "subtitle": "Nové soubory míří do výchozího cíle. Stávající soubory zůstávají tam, kde jsou, dokud je nepřesunete."
    },
    "localDisk": "Disk tohoto serveru",
    "default": "Výchozí",
    "usedBytes": "{size} využito",
    "fileCount": "{count, plural, one {# soubor} few {# soubory} many {# souboru} other {# souborů}}",
    "availableOnDisk": "{size} k dispozici na tomto disku",
    "disabled": "Vypnutý",
    "test": {
      "ok": "Dostupný za {ms} ms",
      "button": "Otestovat",
      "unreachable": "Test se nepodařilo spustit",
      "failed": "Tento cíl se nepodařilo kontaktovat"
    },
    "defaultBlockedByDisabled": "Vypnutý cíl nemůže být výchozí. Nejprve ho zapněte.",
    "setDefault": "Nastavit jako výchozí",
    "enable": "Zapnout",
    "disable": "Vypnout",
    "edit": "Upravit",
    "deleteButton": "Smazat",
    "editor": {
      "createTitle": "Přidat cíl úložiště",
      "editTitle": "Upravit cíl úložiště",
      "subtitle": "Adminium přes tento cíl čte a zapisuje vaším jménem; je to infrastruktura, kterou ovládáte vy."
    },
    "field": {
      "name": "Název",
      "namePlaceholder": "Bucket pro nahrané soubory",
      "driver": "Druh",
      "driverLocked": "Změna druhu u cíle, který už obsahuje soubory, by tyto soubory znepřístupnila.",
      "root": "Adresář",
      "rootHelper": "Absolutní cesta, do které tento server smí zapisovat — připojený svazek nebo síťové sdílení. Ne výchozí adresář, ten je v seznamu už jako první položka.",
      "preset": "Poskytovatel",
      "presetHelper": "Vyplní koncový bod, region a způsob adresování. Co poskytovatel o vašem účtu vědět nemůže, zůstane prázdné, abyste to doplnili.",
      "endpoint": "Koncový bod",
      "endpointDerived": "Pro samotné AWS nechte prázdné — koncový bod vyplyne z regionu.",
      "region": "Region",
      "bucket": "Bucket",
      "pathStyle": "Adresování cestou",
      "pathStyleToggle": "Adresovat bucket cestou místo názvem hostitele",
      "url": "URL kolekce",
      "urlHelper": "Kolekce, do které Adminium zapisuje, tak jak ji publikuje váš server.",
      "prefix": "Předpona",
      "prefixHelper": "Složka uvnitř cíle. Dva cíle nad jedním bucketem, které se liší jen zde, sdílejí bucket, ale ne jmenný prostor.",
      "publicBaseUrl": "Veřejná základní URL",
      "publicBaseUrlHelper": "Nepovinné. Kde jsou tyto objekty čitelné bez Adminia — CDN před veřejným bucketem. Použije se, jen když sloupec ukládá odkaz.",
      "accessKeyId": "ID přístupového klíče",
      "secretAccessKey": "Tajný přístupový klíč",
      "secretKept": "Klíč je uložen. Chcete-li ho zachovat, nechte obě pole prázdná; chcete-li ho nahradit, vyplňte obě.",
      "username": "Uživatelské jméno",
      "password": "Heslo"
    },
    "secret": {
      "partialTitle": "Neúplné přihlašovací údaje nejsou přihlašovací údaje",
      "partialBody": "Vyplňte obě pole, chcete-li uložené přihlašovací údaje nahradit, nebo obě vymažte, chcete-li je zachovat. Uložení jen jednoho z nich by tiše ponechalo ty staré."
    },
    "save": "Uložit cíl",
    "kind": {
      "upload": "Soubory přiložené k záznamům",
      "export": "Soubory z exportů dat",
      "import": "Nahrané soubory CSV a jejich chybové reporty",
      "branding": "Logo workspace",
      "schema": "Importované soubory schématu",
      "archive": "Archivované dávky auditního logu"
    }
  },
  "documents": {
    "title": "Přiřazení dokladů",
    "intro": "Přiřazení říká, které sloupce které tabulky tvoří jeden druh dokladu, co jej vyvolá a kam jde.",
    "noProvider": "Zatím žádný nainstalovaný add-on neumí kreslit doklady. Nainstalujte jej v Add-onech a možná přiřazení se objeví zde.",
    "newFrom": "Nové přiřazení na:",
    "empty": "Zatím žádná přiřazení.",
    "name": "Pojmenovat toto přiřazení",
    "pickTable": "Vyberte tabulku…",
    "delete": "Smazat",
    "disabled": "vypnuto",
    "save": "Uložit přiřazení",
    "cancel": "Zrušit",
    "prefix": "Předčíslí",
    "unbound": "Ještě vyplnit: {slots}",
    "step": {
      "kind": "Druh",
      "table": "Připojení a tabulka",
      "mapping": "Co plní každé pole",
      "trigger": "Co jej vyvolá",
      "delivery": "Kam jde",
      "mappingHelp": "Každé pole čte sloupec — nebo bere hodnotu, kterou zde zadáte.",
      "render": "Vyzkoušet na řádku"
    },
    "trigger": {
      "manual": "Jen na vyžádání",
      "manualShort": "na vyžádání",
      "created": "Když přibude řádek",
      "updated": "Když se řádek změní",
      "noteTitle": "Co se počítá jako změna",
      "note": "Řádky z importu nebo zapsané rovnou do databáze nic nevyvolají — jen zápisy přes Adminium."
    },
    "delivery": {
      "stored": "Zůstává vždy u záznamu.",
      "email": "Odeslat na",
      "noEmail": "Nikomu — jen ponechat u záznamu",
      "noEmailSlot": "Tento druh dokladu nemá pole s adresou, a nelze jej tedy odeslat.",
      "noSmtp": "Toto Adminium zatím nemá nastavený e-mailový server, takže nelze nic odeslat. Nastavte jej v Studio → Nastavení → E-mail."
    },
    "grants": {
      "title": "Nesmíte číst všechno z toho",
      "refused": "Toto přiřazení čte {tables}, což nesmíte číst. Doklady z něj vám budou selhávat."
    },
    "slot": {
      "unmapped": "Nevyplněno",
      "byDefault": "Vyplní Adminium",
      "pii": "skrytá data",
      "typed": "Hodnota, kterou zadám",
      "typedValue": "Hodnota pro {slot}",
      "typedHint": "Zadáno zde, nečte se z vašich dat — každý doklad z tohoto přiřazení dostane stejnou hodnotu.",
      "noLines": "Žádné položky",
      "looksLikeLines": "vypadá jako položky",
      "noChildren": "Nic ve vaší databázi neukazuje na tuto tabulku, takže není co kreslit jako položky. Doklad potřebuje podřízenou tabulku s cizím klíčem zpět na tuto.",
      "lineColumns": "Co vyplňuje každý sloupec položky",
      "lineColumnOf": "{column} každé položky"
    },
    "edit": "Upravit",
    "render": {
      "saveFirst": "Nejprve přiřazení uložte. Doklad se kreslí z uloženého, takže uvidíte, co udělá, dřív než kdokoli jiný.",
      "intro": "Nakreslete jeden teď, z řádku, který si vyberete. Nic se nikam neposílá — zůstane u záznamu jako každý jiný.",
      "search": "Hledat v řádcích",
      "noRows": "Zatím žádné řádky, ze kterých kreslit.",
      "pick": "Nakreslit tento",
      "pending": "Kreslí se…",
      "ready": "Nakresleno.",
      "failedRow": "Nic se nenakreslilo: {reason}",
      "open": "Otevřít",
      "slowTitle": "Stále nic",
      "slow": "Zatím se neobjevil žádný doklad. Možná ještě čeká, nebo tato instalace neběží s úlohami na pozadí — dokud neběží, nic se nenakreslí."
    },
    "connectionLabel": "Připojení",
    "tableLabel": "Tabulka"
  }
} as const;
