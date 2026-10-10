// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/assistant.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "actions": {
    "saved": "Uloženo"
  },
  "ask": {
    "continue": "Pokračovat",
    "pick": "Vyber jednu možnost v každé skupině",
    "picked": "Vybráno: {labels}",
    "ready": "Připraveno",
    "waiting": "Čeká se na tebe"
  },
  "audit": {
    "note": "Každá akce se zapisuje do auditního logu"
  },
  "automation": {
    "action1": "Otevřít v nástroji",
    "action2": "Uložit pravidlo (vypnuté)",
    "blurb": "Zná tuhle stránku: {rules, plural, one {# pravidlo} few {# pravidla} other {# pravidel}} · {templates, plural, one {# aktivní e-mailová šablona} few {# aktivní e-mailové šablony} other {# aktivních e-mailových šablon}} · {tables, plural, one {# čitelná tabulka} few {# čitelné tabulky} other {# čitelných tabulek}}",
    "chip1": "Poslat zákazníkovi poděkování e-mailem, když je objednávka odeslána",
    "chip2": "Upozornit administrátory, když přibude nový zákazník",
    "chip3": "Každé ráno označit objednávky po požadovaném termínu",
    "confirm": {
      "body": "{name} přidá „{title}“ do Pravidel automatizace, vypnuté. Nic neběží, dokud ho nezapneš.",
      "bodyOpen": "{name} přidá „{title}“ do Pravidel automatizace, vypnuté, a otevře ho v nástroji.",
      "button": "Uložit vypnuté",
      "title": "Uložit tohle pravidlo?"
    },
    "echo": {
      "editor": "Uloženo vypnuté. Otevírá se v nástroji.",
      "saved": "Uloženo do Pravidel automatizace, vypnuté."
    },
    "greeting": "Vidím tvoje pravidla automatizace, tvoje aktivní e-mailové šablony a tabulky, které tvoje role může číst.",
    "greetingSub": "Popiš, co se má stát a kdy, a já pravidlo navrhnu. Uloží se vypnuté, dokud ho nezapneš.",
    "page": "Pravidla automatizace",
    "placeholder": "Popiš pravidlo, které potřebuješ…",
    "readPage": "Pravidla automatizace · {rules, plural, one {# pravidlo} few {# pravidla} other {# pravidel}} · {tables, plural, one {# čitelná tabulka} few {# čitelné tabulky} other {# čitelných tabulek}}",
    "scopePrimary": "automations",
    "workTitle": "Navrženo nové pravidlo"
  },
  "button": "Zeptat se {name}",
  "buttonTitle": "Zeptat se {name} na tuto stránku",
  "close": "Zavřít",
  "composer": {
    "send": "Odeslat",
    "working": "Pracuje se…"
  },
  "confirm": {
    "cancel": "Zrušit"
  },
  "details": {
    "checks": "Kontroly",
    "figures": "Čísla",
    "figuresValue": "{blocks, plural, one {# blok s čísly} few {# bloky s čísly} other {# bloků s čísly}}",
    "format": "Formát",
    "formatEmailValue": "E-mail Adminium · {blocks, plural, one {# blok} few {# bloky} other {# bloků}}",
    "formatInvoiceValue": "Šablona faktury Adminium · {sections, plural, one {# zapnutá sekce} few {# zapnuté sekce} other {# zapnutých sekcí}}",
    "lines": "Položky",
    "linesValue": "{lines, plural, one {# položka} few {# položky} other {# položek}} · {total}",
    "noChecks": "žádné uvedené",
    "none": "žádné",
    "notPublished": "Nepublikováno",
    "notPublishedValue": "uloženo jako koncept",
    "notTouched": "Nedotčeno",
    "notTouchedValue": "žádné zákaznické řádky se nemění, žádný e-mail se neodesílá",
    "record": "Záznam",
    "recordValue": "dokument faktury · 1 nový řádek · stav koncept",
    "sources": "Přečtené zdroje",
    "sourcesChosen": "Vybrané zdroje",
    "taxLines": "Daňové řádky",
    "taxLinesValue": "{rate} %",
    "tokens": "Tokeny",
    "tokensValue": "{in} dovnitř · {out} ven",
    "variables": "Proměnné"
  },
  "diff": {
    "adds": "+{n}",
    "against": "Porovnáno s {name}",
    "dels": "−{n}",
    "new": "Nový {kind} — pole, která zapíše",
    "truncated": "Porovnání bylo zkráceno — otevři koncept a uvidíš zbytek."
  },
  "draft": {
    "account": "Účet",
    "draft": "koncept",
    "due": "Splatnost",
    "issued": "Vystaveno",
    "lineCount": "{n, plural, one {# položka} few {# položky} other {# položek}}",
    "lines": "Načtené položky",
    "notTouched": "Žádné zákaznické řádky se nemění a žádný e-mail se neodesílá.",
    "status": "Stav",
    "template": "Šablona",
    "total": "Celkem"
  },
  "echo": {
    "applied": "Vloženo do editoru — zkontroluj zvýrazněné bloky."
  },
  "email": {
    "action1": "Odeslat testovací e-mail",
    "action2": "Otevřít v editoru",
    "action3": "Uložit šablonu",
    "blurb": "Zná tuhle stránku: {templates, plural, one {# šablona} few {# šablony} other {# šablon}} · {campaigns, plural, one {# kampaň} few {# kampaně} other {# kampaní}} · branding",
    "chip1": "Napiš upomínku k neuhrazené faktuře",
    "chip2": "Vytvoř připomínku schůzky 3 dny předem",
    "chip3": "Přelož uvítací šablonu do němčiny",
    "confirm": {
      "body": "{name} vytvoří „{title}“ jako koncept v E-mailových šablonách. Zákazníkům se nic neodešle, dokud ji nespustíš.",
      "bodyOpen": "{name} vytvoří „{title}“ jako koncept v E-mailových šablonách a otevře ji v editoru.",
      "button": "Uložit jako koncept",
      "title": "Uložit jako novou šablonu?"
    },
    "echo": {
      "editor": "Uloženo jako koncept šablony. Otevírá se v editoru.",
      "sample": "Vykreslena ukázka pro {record}.",
      "saved": "Uloženo jako koncept šablony.",
      "test": "Test odeslán na {email} s ukázkovými daty."
    },
    "greeting": "Vidím tvoje e-mailové šablony — formát bloků, tvůj branding a proměnné, které může každá šablona použít.",
    "greetingSub": "Popiš e-mail, který potřebuješ, a já ho navrhnu ve formátu šablon Adminia; pak ho můžeš před uložením poslat testovacím e-mailem.",
    "language": {
      "saved": "Varianta {locale} byla přidána jako koncept."
    },
    "page": "E-mailové šablony",
    "placeholder": "Popiš šablonu, kterou potřebuješ…",
    "readPage": "E-mailové šablony · {templates, plural, one {# šablona} few {# šablony} other {# šablon}} · branding",
    "scopePrimary": "email_templates",
    "workTitle": "Navržena nová e-mailová šablona"
  },
  "error": {
    "generic": "Tohle nevyšlo. Zkus se zeptat znovu.",
    "smtp": "E-mail zatím není nastavený. Otevřete nastavení e-mailu a přidejte relay.",
    "tooLong": "Tahle konverzace je pro model příliš dlouhá — začni novou relaci.",
    "tryAgain": "Zkusit znovu",
    "modelFormat": "Tento model neodpovídá tak, jak asistent {name} potřebuje. Vyberte jiný model v Nastavení → AI.",
    "modelFormatAsk": "Tento model neodpovídá tak, jak asistent {name} potřebuje. Požádejte správce, aby vybral jiný model.",
    "setup": "Tuto stránku se teď nepodařilo přečíst. Zeptejte se znovu.",
    "busy": "Na vaší poslední otázce se ještě pracuje. Počkejte na ni, nebo ji nejdřív zastavte.",
    "budget": "Zastavilo se to v půli: dnešní příděl je vyčerpán."
  },
  "invoiceTemplate": {
    "action1": "Zobrazit jinou ukázku",
    "action2": "Otevřít v editoru",
    "action3": "Uložit šablonu",
    "blurb": "Zná tuhle stránku: {templates, plural, one {# šablona} few {# šablony} other {# šablon}} · číslování {pattern} · {invoices, plural, one {# faktura} few {# faktury} other {# faktur}}",
    "chip1": "Vytvoř šablonu pro klienty z EU s přenesenou daňovou povinností",
    "chip2": "Přidej do jedné z mých šablon sekci s úroky z prodlení",
    "chip3": "Slaď jednu z mých šablon s našimi firemními barvami",
    "confirm": {
      "body": "{name} přidá „{title}“ do Šablon faktur jako koncept. Stávající faktury zůstanou beze změny.",
      "bodyOpen": "{name} přidá „{title}“ do Šablon faktur jako koncept a otevře ji v editoru.",
      "button": "Uložit jako koncept",
      "title": "Uložit jako novou šablonu faktury?"
    },
    "echo": {
      "editor": "Uloženo jako koncept. Otevírá se v editoru.",
      "noSample": "Není tu žádná faktura, ze které by šlo vykreslit ukázku.",
      "sample": "Vykreslena ukázka pro {record}.",
      "saved": "Uloženo jako koncept šablony.",
      "test": "Test odeslán na {email}."
    },
    "greeting": "Vidím tvoje šablony faktur, tvoje schéma číslování a daňové řádky, které tvoje šablony používají.",
    "greetingSub": "Řekni mi, jakou šablonu potřebuješ, a já ji postavím ve fakturačním formátu Adminia; pak vykreslím ukázku se skutečnými daty účtu.",
    "language": {
      "saved": "Varianta {locale} byla přidána jako koncept."
    },
    "page": "Šablony faktur",
    "placeholder": "Popiš šablonu faktury, kterou potřebuješ…",
    "readPage": "Fakturační šablony · {templates, plural, one {# šablona} few {# šablony} other {# šablon}} · číslování {pattern}",
    "scopePrimary": "invoice_templates",
    "workTitle": "Postavena nová šablona faktury"
  },
  "invoices": {
    "action1": "Otevřít v editoru",
    "action2": "Vytvořit koncept faktury",
    "blurb": "Zná tuhle stránku: {invoices, plural, one {# faktura} few {# faktury} other {# faktur}} · {templates, plural, one {# šablona} few {# šablony} other {# šablon}} · tvoje role může {write, select, true {zapisovat} other {číst}}",
    "chip1": "Vytvoř fakturu pro zákazníka za minulý měsíc",
    "chip2": "Navrhni fakturu z nevyfakturovaných záznamů za minulý měsíc",
    "chip3": "Vypiš faktury po splatnosti",
    "confirm": {
      "body": "{name} přidá tuhle fakturu do Faktur jako koncept. Dokud ji neodešleš, žádné zákaznické řádky se nemění.",
      "bodyOpen": "{name} přidá tuhle fakturu do Faktur jako koncept a otevře ji v editoru.",
      "button": "Vytvořit koncept",
      "title": "Vytvořit tenhle koncept faktury?"
    },
    "echo": {
      "editor": "Vytvořeno jako koncept. Otevírá se v editoru faktur.",
      "sample": "Vykreslena ukázka pro {record}.",
      "saved": "Vytvořeno jako koncept. Je nahoře v tabulce.",
      "test": "Test odeslán na {email}."
    },
    "greeting": "Vidím tabulku faktur, tvoje šablony a místa, odkud mohou fakturační data pocházet.",
    "greetingSub": "Řekni mi, komu fakturovat; zeptám se, kterou šablonu použít a odkud vzít položky, než cokoli navrhnu.",
    "language": {
      "saved": "Varianta {locale} byla přidána jako koncept."
    },
    "page": "Faktury",
    "placeholder": "např. vytvoř fakturu pro zákazníka za minulý měsíc…",
    "readPage": "Faktury · {invoices, plural, one {# záznam} few {# záznamy} other {# záznamů}} · vaše role může {write, select, true {zapisovat} other {číst}}",
    "scopePrimary": "invoices",
    "workTitle": "Navržena faktura"
  },
  "readOnly": {
    "noWrite": "Tvoje role si tu může prohlížet, navrhovat a zobrazovat náhledy, ale ne ukládat.",
    "noWriteTitle": "Tvoje role tohle tady nemůže",
    "switchedOff": "Ukládání je pro {name} v tomto pracovním prostoru vypnuté.",
    "openSettings": "Otevřít nastavení",
    "switchedOffTitle": "Ukládání je pro {name} v tomto pracovním prostoru vypnuté"
  },
  "report": {
    "action1": "Spustit plný náhled",
    "action2": "Otevřít v nástroji",
    "action3": "Uložit sestavu",
    "blurb": "Zná tuhle stránku: {reports, plural, one {# sestava} few {# sestavy} other {# sestav}} · {connection} · {tables, plural, one {# čitelná tabulka} few {# čitelné tabulky} other {# čitelných tabulek}}",
    "chip1": "Kteří zákazníci spotřebují nejvíc času podpory? Zdroje vyber ty",
    "chip2": "Postav sestavu retence ze zákazníků a objednávek",
    "chip3": "Vytvoř šablonu měsíčního provozního přehledu",
    "confirm": {
      "body": "{name} přidá „{title}“ do Sestav. Spouští se na vyžádání — bez plánu, dokud nějaký nenastavíš.",
      "bodyOpen": "{name} přidá „{title}“ do Sestav a otevře ji v nástroji.",
      "button": "Uložit sestavu",
      "title": "Uložit tuhle sestavu?"
    },
    "echo": {
      "editor": "Uloženo do Sestav. Otevírá se v nástroji.",
      "resampled": "Zdroje znovu spuštěny — aktualizováno {n, plural, one {# číslo} few {# čísla} other {# čísel}}.",
      "resampledRefused": "Zdroje znovu spuštěny — aktualizováno {n, plural, one {# číslo} few {# čísla} other {# čísel}}; {refused, plural, one {# zdroj nelze přečíst} few {# zdroje nelze přečíst} other {# zdrojů nelze přečíst}}.",
      "sample": "Spuštěn plný dotaz pro {record}.",
      "saved": "Uloženo do Sestav. Plán přidáš v záhlaví sestavy.",
      "test": "Test odeslán na {email}."
    },
    "greeting": "Vidím tvoji knihovnu sestav a {tables, plural, one {# tabulku} few {# tabulky} other {# tabulek}}, které tvoje role může číst v {connection}.",
    "greetingSub": "Jmenuj tabulky a rozvržení, nebo mi prostě řekni otázku — zdroje vyberu já a ukážu ti proč.",
    "language": {
      "saved": "Varianta {locale} byla přidána jako koncept."
    },
    "page": "Tvorba sestav",
    "placeholder": "Požádej o sestavu nebo jmenuj tabulky…",
    "readPage": "Tvůrce reportů · {reports, plural, one {# report} few {# reporty} other {# reportů}} · {tables, plural, one {# čitelná tabulka} few {# čitelné tabulky} other {# čitelných tabulek}}",
    "scopePrimary": "reports",
    "workTitle": "Postavena sestava"
  },
  "scope": {
    "connection": "{connection} · {n, plural, one {# tabulka} few {# tabulky} other {# tabulek}}",
    "extra": "+{n}",
    "title": "Data, která tato relace může číst"
  },
  "steps": {
    "done": "hotovo",
    "failed": "selhalo",
    "note": {
      "ready": "připraveno",
      "warning": "{n, plural, one {# varování} few {# varování} other {# varování}}"
    },
    "readPage": "Přečteno na této stránce",
    "step": "krok {n}",
    "working": "Pracuje na tom"
  },
  "tabs": {
    "details": "Podrobnosti",
    "diff": "Rozdíl",
    "preview": "Náhled"
  },
  "tokens": {
    "hint": "~{n} tokenů",
    "title": "Tokeny spotřebované v této relaci",
    "value": "{n} tokenů"
  },
  "try": "Vyzkoušej",
  "unavailable": {
    "askAdmin": "Požádej správce, ať nějakého nastaví.",
    "forbidden": "Nemáš oprávnění používat {name}.",
    "network": "Odchozí síťové funkce jsou na této instanci vypnuté.",
    "noProvider": "Zatím není nastavený žádný poskytovatel AI.",
    "settings": "Otevřít Nastavení → AI"
  },
  "budget": {
    "usedUp": "Dnešní příděl je vyčerpán. Znovu začne v {time}."
  },
  "data": {
    "page": "Tato stránka",
    "blurb": "Zná tuto stránku: {table} · {tables, plural, one {# čitelná tabulka} few {# čitelné tabulky} many {# čitelné tabulky} other {# čitelných tabulek}}",
    "blurbNoTable": "Zná tuto stránku · {tables, plural, one {# čitelná tabulka} few {# čitelné tabulky} many {# čitelné tabulky} other {# čitelných tabulek}}",
    "greeting": "Umím přečíst, co tato stránka zobrazuje, a další tabulky, které smí číst vaše role.",
    "greetingSub": "Zeptejte se na zdejší řádky. Odpovím slovy, s čísly, a řeknu, které tabulky jsem četl.",
    "placeholder": "Zeptejte se na tato data…",
    "chip1": "Kolik řádků se tu zobrazuje?",
    "chip2": "Shrň, co tato stránka zobrazuje",
    "chip3": "Co se změnilo naposledy?",
    "workTitle": "Data přečtena",
    "scopePrimary": "tato stránka",
    "readPage": "{page} · {table} · {tables, plural, one {# čitelná tabulka} few {# čitelné tabulky} many {# čitelné tabulky} other {# čitelných tabulek}}",
    "readPageNoTable": "{tables, plural, one {# čitelná tabulka} few {# čitelné tabulky} many {# čitelné tabulky} other {# čitelných tabulek}}",
    "confirm": {
      "title": "Tady není co uložit",
      "body": "Asistent {name} na této stránce nic nenavrhuje.",
      "button": "Zavřít"
    }
  },
  "general": {
    "page": "Tento pracovní prostor",
    "blurb": "Zná tento pracovní prostor · {tables, plural, one {# čitelná tabulka} few {# čitelné tabulky} many {# čitelné tabulky} other {# čitelných tabulek}}",
    "greeting": "Mohu číst tabulky, které smí číst vaše role, a říct vám, kde se co dělá.",
    "greetingSub": "Zeptejte se na svá data nebo na to, kde něco změnit. Odpovím slovy a přidám odkaz na dané místo.",
    "placeholder": "Zeptejte se na tento pracovní prostor…",
    "chip1": "Kde pozvu kolegu?",
    "chip2": "Co v tomto pracovním prostoru uvidím?",
    "chip3": "Která tabulka má nejvíce řádků?",
    "workTitle": "Vyhledáno",
    "scopePrimary": "pracovní prostor",
    "readPage": "{tables, plural, one {# čitelná tabulka} few {# čitelné tabulky} many {# čitelné tabulky} other {# čitelných tabulek}}"
  },
  "answer": {
    "from": "Zdroj:",
    "part": "Přečteno {returned, number} z {total, number} řádků tabulky {table}.",
    "nothingRead": "Pro tuto odpověď nebylo nic přečteno.",
    "readAgain": "Přečíst znovu",
    "readAgainAsk": "{question} Pro odpověď přečti data.",
    "forgot": "{name} už nemá na paměti {count, plural, one {první zprávu} few {první # zprávy} many {prvních # zprávy} other {prvních # zpráv}}."
  },
  "suggestion": {
    "open": "Otevřít",
    "openLabel": "Otevřít {addOn} v části Add-ons",
    "askAdmin": "Požádejte správce, aby to nainstaloval."
  },
  "panel": {
    "loading": "Načítání konverzace…",
    "recordOpen": "{page} · otevřeno: {record}",
    "rowsShown": "{page} · {rows, plural, one {zobrazen # řádek} few {zobrazeny # řádky} many {zobrazeno # řádku} other {zobrazeno # řádků}}",
    "new": "Nová konverzace",
    "earlier": "{count, plural, one {# starší zpráva není zobrazena} few {# starší zprávy nejsou zobrazeny} many {# starší zprávy není zobrazeno} other {# starších zpráv není zobrazeno}}.",
    "onPage": "na stránce {page}",
    "closedElsewhere": "Tato konverzace byla zavřena v jiném okně.",
    "stillWorking": "{name} stále pracuje na vaší poslední otázce.",
    "stop": "Zastavit",
    "pageDialog": "Chcete-li použít {name}, zavřete to, co je na stránce otevřené.",
    "aged": "Vaše dřívější konverzace byla kvůli svému stáří zavřena."
  },
  "chip": {
    "selected": "{count, plural, one {# vybraný} few {# vybrané} many {# vybraného} other {# vybraných}}",
    "record": "Otevřený záznam",
    "filtered": "{rows, plural, one {# filtrovaný řádek} few {# filtrované řádky} many {# filtrovaného řádku} other {# filtrovaných řádků}}",
    "filteredUnknown": "Filtrované řádky",
    "remove": "Zeptat se bez „{label}“"
  },
  "parked": {
    "madeOn": "Vytvořeno na stránce {page}.",
    "open": "Otevřít {page} a použít tento koncept",
    "deleted": "Dokument tohoto konceptu byl smazán."
  },
  "proposal": {
    "checking": {
      "title": "Změna k potvrzení",
      "line": "Zjišťuje se, co by se změnilo…"
    },
    "badge": {
      "replaced": "Nahrazeno",
      "expired": "Vypršelo",
      "cancelled": "Zrušeno",
      "parked": "Odloženo"
    },
    "replaced": "Potom přišel jiný dotaz. Nic se nezměnilo.",
    "expired": "Tento návrh je 30 minut starý. Zeptejte se znovu.",
    "overCap": "To je {count} změn; najednou lze potvrdit nejvýše {cap}. Pro více použijte hromadné nástroje stránky.",
    "applying": "Pracuje se…",
    "undone": "Vráceno zpět. Vše je jako předtím.",
    "undonePart": "{count, plural, one {# změna byla vzata} few {# změny byly vzaty} other {# změn bylo vzato}} zpět.",
    "undoneRest": "Zbytek zůstává změněn.",
    "interrupted": "Tohle se zastavilo v půli.",
    "group": {
      "done": "Hotovo",
      "check": "Zkontrolujte tento",
      "checkLine": "Uložení bylo přerušeno. Mohl se změnit, a nemusel.",
      "notTried": "Nezkoušeno",
      "shared": "{field} {arrow} {value} u {count, plural, one {# řádku} few {# řádků} other {# řádků}}"
    },
    "openHome": "Otevřít {page}",
    "notTried": "Nezkoušeno: příliš mnoho požadavků najednou. Zeptejte se znovu za minutu.",
    "again": "Navrhnout zbytek znovu",
    "againAsk": "Navrhni znovu změny, které nebyly provedeny:\n{rows}",
    "undo": "Vrátit zpět",
    "undoSome": "Vrátit zpět {count} z {total}",
    "undoPassed": "Čas na vrácení zpět uplynul.",
    "noUndo": "Odtud to nelze vrátit zpět.",
    "noUndoSome": "{count, plural, one {# změnu} few {# změny} other {# změn}} odtud nelze vrátit zpět.",
    "notChanged": "{count, plural, one {Tento nebyl změněn} few {Tyto # nebyly změněny} other {Těchto # nebylo změněno}}:",
    "cancelled": "Nic se nezměnilo.",
    "parked": "Chcete-li to použít, otevřete {page}.",
    "someRefused": "{refused} z {count, plural, one {# změny} few {# změn} other {# změn}} nelze provést.",
    "changedSince": "Od chvíle, kdy vám to bylo ukázáno, se to změnilo. Před potvrzením se podívejte znovu.",
    "fix": "Požádat {name}, ať to opraví",
    "fixAsk": "Část z toho nelze provést. Navrhni to znovu bez těchto:\n{reasons}",
    "send": {
      "template": "Šablona",
      "subject": "Předmět",
      "to": "Komu",
      "roles": "všichni s rolí {roles} ({count, plural, one {# člověk} few {# lidé} other {# lidí}})",
      "open": "Otevřít šablonu",
      "skipped": "{count, plural, one {# člověk se odhlásil a nedostane} few {# lidé se odhlásili a nedostanou} other {# lidí se odhlásilo a nedostane}} nic."
    },
    "more": "Dalších {count}. Otevřete velké zobrazení a uvidíte všechny.",
    "irreversible": "Tohle nelze vrátit zpět.",
    "chosen": "Vybráno {picked} z {count}",
    "large": "Otevřít velké",
    "doc": {
      "email": "e-mailová šablona",
      "report": "report",
      "rule": "pravidlo",
      "invoice": "faktura",
      "invoiceTemplate": "šablona faktury"
    },
    "ask": {
      "change": "Změnit {count, plural, one {# řádek} few {# řádky} other {# řádků}}",
      "add": "Přidat {count, plural, one {# řádek} few {# řádky} other {# řádků}}",
      "delete": "Smazat {count, plural, one {# řádek} few {# řádky} other {# řádků}}",
      "save": "Uložit jako nové: {what}",
      "saveOver": "Uložit přes „{name}“",
      "deleteDoc": "Smazat „{name}“",
      "deleteDocs": "Smazat {count, plural, one {# dokument} few {# dokumenty} other {# dokumentů}}",
      "send": "Odeslat {count, plural, one {# člověku} few {# lidem} other {# lidem}}",
      "mixed": "Provést {count, plural, one {# změnu} few {# změny} other {# změn}}"
    },
    "done": {
      "changePart": "Změněno {done} z {count, plural, one {# řádku} few {# řádků} other {# řádků}}.",
      "part": "Provedeno {done} z {count, plural, one {# změny} few {# změn} other {# změn}}.",
      "change": "{count, plural, one {Změněn # řádek} few {Změněny # řádky} other {Změněno # řádků}}.",
      "add": "{count, plural, one {Přidán # řádek} few {Přidány # řádky} other {Přidáno # řádků}}.",
      "delete": "{count, plural, one {Smazán # řádek} few {Smazány # řádky} other {Smazáno # řádků}}.",
      "save": "Uloženo.",
      "deleteDoc": "{count, plural, one {Smazán # dokument} few {Smazány # dokumenty} other {Smazáno # dokumentů}}.",
      "send": "Odesílá se {count, plural, one {# člověku} few {# lidem} other {# lidem}}.",
      "mixed": "{count, plural, one {Provedena # změna} few {Provedeny # změny} other {Provedeno # změn}}."
    },
    "refused": {
      "generic": "Server to odmítl.",
      "switchedOff": "Tohle je pro {name} v tomto pracovním prostoru vypnuté.",
      "notThisTable": "Odtud lze měnit jen tabulku stránky, na které byl dotaz položen.",
      "notData": "To není tabulka vašich dat.",
      "noChange": "Řádek už tyto hodnoty má.",
      "unsafeKey": "Toto id nelze použít.",
      "notFound": "Tohle už neexistuje.",
      "notOffered": "To odtud nelze udělat.",
      "builtIn": "Vestavěný e-mail se mění na vlastní obrazovce.",
      "notCampaign": "Lidem lze odeslat jen kampaň.",
      "noRecipients": "Tento e-mail by nikdo nedostal.",
      "notLive": "Koncept musí před odesláním zapnout člověk."
    },
    "row": {
      "untitled": "Bez názvu",
      "new": "Nový řádek",
      "switchesOff": "Uloží se vypnuté: zapněte ho znovu, až si ho prohlédnete."
    },
    "delete": {
      "reference": "{count} v {table}",
      "references": "Odkazují na to jiné řádky: {list}. Zmizí nebo se změní s ním, stejně jako při mazání na stránce."
    },
    "noneAble": "Nic z toho nelze provést",
    "checkAgain": "Zkontrolovat znovu",
    "undoFailed": "{count, plural, one {# změnu} few {# změny} other {# změn}} se nepodařilo vzít zpět. Zkuste to znovu.",
    "parkedNoHome": "Chcete-li to použít, vraťte se na {page}, kde byl dotaz položen."
  }
} as const;
