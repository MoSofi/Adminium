// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/automations.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "rules": {
    "title": "Pravidla automatizace",
    "subtitle": "Spouštějte pracovní postupy automaticky, když se něco stane.",
    "new": "Nové pravidlo",
    "empty": {
      "title": "Zatím žádná pravidla",
      "body": "Vytvořte pravidlo, aby se kroky spouštěly automaticky, když se něco stane."
    },
    "none": "Vyberte pravidlo a uvidíte jeho postup"
  },
  "kpi": {
    "activeRules": "Aktivní pravidla",
    "runsToday": "Dnešní běhy",
    "successRate": "Úspěšnost",
    "timeSaved": "Ušetřený čas (měs.)"
  },
  "filter": {
    "all": "Vše",
    "active": "Aktivní",
    "paused": "Pozastavená"
  },
  "card": {
    "runs": "běhů",
    "success": "úspěšnost",
    "never": "Nikdy neběželo",
    "toggle": "Přepnout"
  },
  "status": {
    "active": "Aktivní",
    "paused": "Pozastaveno"
  },
  "flow": {
    "steps": "{count, plural, one {# krok} few {# kroky} many {# kroku} other {# kroků}}",
    "saves": "ušetří {time} / běh",
    "runs30d": "běhů za 30 d",
    "success": "úspěšnost",
    "test": "Otestovat",
    "running": "Běží",
    "noSample": "Není na čem testovat — nejdřív přidejte záznam",
    "menu": "Akce pravidla"
  },
  "menu": {
    "rename": "Přejmenovat",
    "duplicate": "Duplikovat",
    "delete": "Smazat"
  },
  "delete": {
    "title": "Smazat {name}?",
    "body": "Historie běhů zmizí s ním. Tuto akci nelze vrátit zpět.",
    "confirm": "Smazat",
    "cancel": "Zrušit"
  },
  "save": {
    "unsaved": "Neuložené změny",
    "saving": "Ukládání…",
    "saved": "Vše uloženo",
    "action": "Uložit"
  },
  "guard": {
    "title": "Odejít bez uložení?",
    "body": "Vaše změny tohoto pravidla se ztratí.",
    "stay": "Pokračovat v úpravách",
    "leave": "Odejít"
  },
  "toast": {
    "saved": "Pravidlo uloženo",
    "enabled": "{name} je zapnuté",
    "paused": "{name} je pozastavené",
    "incomplete": "Nejdřív dokončete „{step}“, pak pravidlo zapněte",
    "duplicated": "{name} duplikováno",
    "deleted": "{name} smazáno",
    "failed": "Neuložilo se — {reason}"
  },
  "canvas": {
    "insert": "Vložit krok sem",
    "addStep": "Přidat krok",
    "remove": "Odebrat krok"
  },
  "kind": {
    "trigger": "SPOUŠTĚČ",
    "condition": "FILTR",
    "branch": "KDYŽ / JINAK",
    "wait": "PRODLEVA",
    "action": "AKCE"
  },
  "branch": {
    "ifMatches": "Když odpovídá",
    "otherwise": "Jinak"
  },
  "picker": {
    "title": "Přidat krok",
    "before": "Před · {title}",
    "end": "Na konec postupu",
    "inBranch": "Do větve · {label}",
    "actions": "Akce",
    "logic": "Logika",
    "close": "Zavřít"
  },
  "pick": {
    "email": "Odeslat e-mail",
    "emailDesc": "Z uložené šablony",
    "notification": "Odeslat oznámení",
    "notificationDesc": "Dát vědět lidem v tomto prostoru",
    "create": "Vytvořit záznam",
    "createDesc": "Přidat řádek do tabulky",
    "update": "Aktualizovat pole",
    "updateDesc": "Zapsat zpět do záznamu",
    "webhook": "Zavolat webhook",
    "webhookDesc": "Odeslat data kamkoli",
    "slack": "Zpráva do Slacku",
    "slackDesc": "Publikovat do kanálu",
    "branch": "Větev když / jinak",
    "branchDesc": "Rozdělit na dvě cesty",
    "filter": "Pokračovat jen když",
    "filterDesc": "Zastavit, když neodpovídá",
    "wait": "Počkat / prodleva",
    "waitDesc": "Pozastavit před dalším krokem",
    "stop": "Zastavit postup",
    "stopDesc": "Ukončit tento běh zde"
  },
  "node": {
    "email": {
      "sub": "Šablona · vyberte",
      "summary": "Šablona · {template} → {to}"
    },
    "notification": {
      "sub": "Vyberte, komu dát vědět",
      "summary": "Komu · {who}"
    },
    "create": {
      "sub": "Tabulka · vyberte",
      "summary": "{table} · {count} hodnot"
    },
    "update": {
      "sub": "Nastavit hodnotu",
      "summary": "{pairs}"
    },
    "webhook": {
      "sub": "POST · JSON payload",
      "summary": "{method} {host}"
    },
    "slack": {
      "sub": "Kanál · přidejte URL webhooku",
      "summary": "Slack · {host}"
    },
    "wait": {
      "title": "Počkat / prodleva",
      "sub": "Pauza {duration}"
    },
    "stop": {
      "title": "Zastavit postup",
      "sub": "Ukončí běh"
    },
    "condition": {
      "empty": "Nastavte podmínku"
    },
    "trigger": {
      "record": "Když je záznam v {table} {event}",
      "interval": "Každých {minutes} minut",
      "daily": "Denně v {time}",
      "weekly": "Týdně v {day} v {time}",
      "monthly": "Měsíčně {day}. dne v {time}",
      "sub": "Spouštěč · {event}"
    }
  },
  "event": {
    "created": "vytvořen",
    "updated": "aktualizován",
    "deleted": "smazán"
  },
  "insp": {
    "stepName": "Název kroku",
    "description": "Popis",
    "condition": "Podmínka",
    "lookAt": "Zaměřit na",
    "thisRecord": "Tento záznam",
    "related": "Související záznamy",
    "field": "Pole",
    "value": "Hodnota",
    "countOf": "Počet z",
    "where": "kde",
    "isThisRecords": "se rovná poli tohoto záznamu",
    "andWhere": "a kde",
    "branchLabels": "Popisky větví",
    "onError": "Pokračovat při chybě",
    "onErrorBody": "Spustit další kroky, i když tento selže",
    "moveUp": "Nahoru",
    "moveDown": "Dolů",
    "duplicate": "Duplikovat",
    "delete": "Smazat",
    "close": "Zavřít",
    "settings": "Nastavení"
  },
  "op": {
    "is": "je",
    "isNot": "není",
    "contains": "obsahuje",
    "gt": "je větší než",
    "lt": "je menší než",
    "isEmpty": "je prázdné",
    "notEmpty": "není prázdné",
    "withinNext": "je během následujících",
    "withinLast": "je během posledních",
    "moreThanAgo": "bylo před více než …",
    "moreThanAhead": "je za více než …"
  },
  "unit": {
    "minutes": "{count, plural, one {minuta} few {minuty} many {minuty} other {minut}}",
    "hours": "{count, plural, one {hodina} few {hodiny} many {hodiny} other {hodin}}",
    "days": "{count, plural, one {den} few {dny} many {dne} other {dnů}}"
  },
  "trig": {
    "title": "Spouštěč",
    "kind": "Kdy",
    "record": "Záznam je {event}",
    "schedule": "Podle plánu",
    "table": "Tabulka",
    "changed": "Jen když se změní tento sloupec",
    "anyColumn": "Kterýkoli sloupec",
    "watch": {
      "on": "Sleduje i řádky zapsané mimo Adminium · každou minutu · přes {column}",
      "off": "Sledování je vypnuté: tabulka nemá sloupec typu „{shape}“ ani rostoucí klíč, takže pravidlo spustí jen zápisy přes Adminium",
      "deleted": "Smazané řádky nelze sledovat; pravidlo spustí jen mazání přes Adminium",
      "fromNow": "Řádky od této chvíle"
    },
    "when": "Jen když",
    "every": "Každých",
    "at": "V",
    "timezone": "Časové pásmo",
    "forEach": "Pro každý záznam z",
    "forEachWhere": "kde",
    "noTable": "Žádná tabulka — jedno spuštění na tik",
    "once": "Jednou na záznam",
    "onceBody": "Záznam, který už odpovídal, se znovu nespustí",
    "timeSaved": "Ušetřený čas na běh",
    "timeSavedBody": "Minuty, které by člověk strávil — u pravidla se zobrazí jako „ušetří“",
    "addCondition": "Přidat podmínku",
    "connection": "Připojení"
  },
  "sched": {
    "interval": "Interval",
    "daily": "Denně",
    "weekly": "Týdně",
    "monthly": "Měsíčně"
  },
  "email": {
    "template": "Šablona",
    "to": "Komu",
    "toField": "E-mail tohoto záznamu",
    "toFixed": "Adresy",
    "column": "Sloupec",
    "addresses": "Přidat adresu…"
  },
  "notif": {
    "to": "Odeslat komu",
    "roles": "Všem s rolí",
    "users": "Konkrétním lidem",
    "title": "Nadpis",
    "body": "Zpráva"
  },
  "rec": {
    "table": "Tabulka",
    "values": "Hodnoty",
    "addValue": "Přidat hodnotu",
    "column": "Sloupec",
    "value": "Hodnota",
    "now": "Teď",
    "remove": "Odebrat tuto hodnotu",
    "tokenHint": "Použijte {token} pro převzetí hodnoty ze záznamu"
  },
  "hook": {
    "url": "URL",
    "method": "Metoda",
    "body": "Tělo",
    "bodyJson": "JSON (událost, pravidlo, záznam)",
    "bodyText": "Vlastní text",
    "header": "Hlavička",
    "headerName": "Název",
    "headerValue": "Hodnota",
    "slackUrl": "URL webhooku Slacku",
    "slackText": "Zpráva"
  },
  "wait": {
    "for": "Počkat",
    "max": "Až 30 dnů",
    "amount": "Počet",
    "unit": "Jednotka"
  },
  "modal": {
    "title": "Nové pravidlo",
    "subtitle": "Spouštějte pracovní postupy automaticky, když se něco stane.",
    "name": "Název pravidla",
    "namePlaceholder": "např. Přivítat nové registrace",
    "when": "Když (spouštěč)",
    "then": "Pak (akce)",
    "enable": "Ihned zapnout",
    "enableBody": "Začne běžet hned po vytvoření pravidla",
    "cancel": "Zrušit",
    "create": "Vytvořit pravidlo",
    "doneTitle": "Pravidlo vytvořeno",
    "doneBody": "Vaše pravidlo je aktivní a spustí se, až bude příště vyvoláno.",
    "savedTitle": "Pravidlo uloženo",
    "savedBody": "Dokončete jeho kroky a pak ho zapněte.",
    "done": "Hotovo",
    "trigger": {
      "recordCreated": "Záznam je vytvořen",
      "recordUpdated": "Záznam je aktualizován",
      "recordDeleted": "Záznam je smazán",
      "schedule": "Podle plánu"
    },
    "connection": "{connection} · {table}",
    "tablePlaceholder": "Hledat tabulky…",
    "tableEmpty": "Žádná odpovídající tabulka"
  },
  "logs": {
    "title": "Protokoly postupů",
    "subtitle": "Historie spuštění vašich automatizací.",
    "refresh": "Obnovit",
    "kpi": {
      "runsToday": "Dnešní běhy",
      "success": "Úspěšnost",
      "failed": "Selhalo",
      "avgDuration": "Prům. trvání"
    },
    "filter": {
      "all": "Vše",
      "success": "Úspěšné",
      "failed": "Selhané",
      "running": "Běžící"
    },
    "status": {
      "success": "Úspěch",
      "failed": "Selhalo",
      "running": "Běží",
      "pending": "Začne {when}",
      "waiting": "Čeká · pokračuje {when}",
      "skipped": "Přeskočeno",
      "cancelled": "Zrušeno"
    },
    "trigger": "Spouštěč",
    "duration": "Trvání",
    "started": "Začátek",
    "trace": "Průběh spuštění",
    "loadOlder": "Načíst starší",
    "empty": {
      "title": "Zatím žádné běhy",
      "filtered": "Za posledních 7 dnů žádné běhy „{status}“"
    },
    "select": "Vyberte běh a uvidíte jeho průběh",
    "justNow": "právě teď"
  },
  "trace": {
    "trigger": "záznam = {label} · {summary}",
    "scheduleTick": "tik · {stamp}",
    "evaluated": "vyhodnoceno → {result}",
    "stopped": "vyhodnoceno → false · zastaveno",
    "branch": "zvolena větev „{label}“",
    "wait": "pokračuje {stamp}",
    "wouldWait": "Čekalo by {duration}",
    "email": {
      "ok": "{smtp} · doručeno na {to}",
      "fail": "CHYBA · {reason}",
      "would": "Odeslalo by „{subject}“ na {to}",
      "noSmtp": "SMTP není nastaveno — Nastavení → E-mail",
      "noRecipient": "Bez příjemce: {column} je prázdné"
    },
    "notif": {
      "ok": "upozorněno {count, plural, one {# člověk} few {# lidé} many {# lidí} other {# lidí}}"
    },
    "create": {
      "ok": "vytvořeno {label}"
    },
    "update": {
      "ok": "nastaveno {pairs}"
    },
    "write": {
      "would": "Nastavilo by {pairs}"
    },
    "hook": {
      "ok": "{method} {path} → {status} · {ms} ms",
      "fail": "{method} {path} → {status}",
      "would": "Provedlo by {method} {url}"
    },
    "stop": "Zastaveno zde",
    "undone": "Vráceno zpět, než se spustilo",
    "gone": "Záznam už neexistuje",
    "ruleOff": "Pravidlo bylo během čekání vypnuto",
    "skipped": "—",
    "document": {
      "ok": "doklad nakreslen · {number}",
      "skipped": "žádný doklad nenakreslen · {reason}",
      "would": "Nakreslil by {kind} · {name}",
      "off": "přiřazení je vypnuté · {name}"
    }
  },
  "dur": {
    "ms": "{ms} ms",
    "s": "{s} s",
    "none": "—"
  },
  "saved": {
    "h": "{h} h",
    "m": "{m} min"
  }
} as const;
