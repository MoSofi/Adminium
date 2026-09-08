// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/email.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "title": "E-mailové šablony",
  "subtitle": "Navrhujte opakovaně použitelné e-maily a kampaně, které z nich rozesíláte.",
  "loadFailed": "E-mailové šablony se nepodařilo načíst",
  "needsTranslation": "Vyžaduje překlad",
  "actions": {
    "menu": "Další akce",
    "eyebrow": "Akce",
    "import": "Importovat šablonu",
    "senders": "Spravovat odesílatele",
    "exportAll": "Exportovat vše",
    "settings": "Nastavení e-mailu",
    "archived": "Archivované"
  },
  "new": {
    "template": "Nová šablona",
    "campaign": "Nová kampaň",
    "subtitle": "Začněte s prázdným e-mailem nebo s hotovým návrhem.",
    "blank": "Prázdný e-mail",
    "blankHint": "Začít od nuly",
    "yourTemplates": "Vaše šablony",
    "failed": "Nepodařilo se vytvořit",
    "startersFailed": "Výchozí návrhy se nepodařilo načíst. Začněte s prázdným e-mailem nebo to zkuste znovu."
  },
  "tabs": {
    "label": "Druh",
    "templates": "Šablony",
    "campaigns": "Kampaně"
  },
  "groupBy": {
    "label": "Seskupit podle",
    "none": "Nic",
    "topic": "Téma",
    "language": "Jazyk"
  },
  "search": {
    "templates": "Hledat šablony…",
    "campaigns": "Hledat kampaně…",
    "clear": "Vymazat hledání"
  },
  "layout": {
    "label": "Zobrazení",
    "gallery": "Galerie",
    "list": "Seznam"
  },
  "archivedChip": {
    "field": "Zobrazeno",
    "value": "Archivované",
    "leave": "Opustit archiv"
  },
  "empty": {
    "templates": {
      "title": "Zatím žádné šablony",
      "body": "Navrhněte opakovaně použitelný e-mail, ze kterého může váš tým odesílat."
    },
    "campaigns": {
      "title": "Zatím žádné kampaně",
      "body": "Vytvořte kampaň ze šablony nebo z prázdného plátna."
    },
    "noMatch": {
      "templates": "Žádné šablony neodpovídají",
      "campaigns": "Žádné kampaně neodpovídají",
      "body": "Zkuste jiný hledaný výraz."
    },
    "archived": {
      "templates": "Žádné archivované šablony",
      "campaigns": "Žádné archivované kampaně",
      "body": "Vše, co smažete, skončí tady a dá se obnovit."
    }
  },
  "status": {
    "draft": "Koncept",
    "live": "Aktivní",
    "scheduled": "Načasováno",
    "sending": "Odesílá se",
    "sent": "Odesláno",
    "failed": "Selhalo"
  },
  "category": {
    "transactional": "Transakční",
    "lifecycle": "Životní cyklus",
    "marketing": "Marketing"
  },
  "run": {
    "counts": "{sent} odesláno · {failed} selhalo",
    "sending": "Odesílá se · {pct} %"
  },
  "group": {
    "languages": "{count, plural, one {# jazyk} few {# jazyky} many {# jazyka} other {# jazyků}}",
    "emails": "{count, plural, one {# e-mail} few {# e-maily} many {# e-mailu} other {# e-mailů}}",
    "needsTranslation": "{count} vyžaduje překlad"
  },
  "card": {
    "edit": "Upravit",
    "duplicate": "Duplikovat",
    "rename": "Přejmenovat",
    "renameLabel": "Nový název",
    "delete": "Smazat",
    "restore": "Obnovit",
    "deleteForGood": "Smazat trvale",
    "reset": "Vrátit vestavěnou verzi"
  },
  "list": {
    "name": "Název",
    "lang": "Jazyk",
    "status": "Stav",
    "updated": "Aktualizováno",
    "actions": "Akce"
  },
  "delete": {
    "title": "Smazat {name}?",
    "archiveBody": "Přesune se do archivu, kde ji můžete obnovit nebo trvale smazat.",
    "confirm": "Smazat",
    "forGoodTitle": "Trvale smazat {name}?",
    "forGoodBody": {
      "template": "Tohle nejde vrátit zpět. Šablona bude trvale odstraněna.",
      "campaign": "Tohle nejde vrátit zpět. Kampaň bude trvale odstraněna."
    },
    "forGood": "Smazat trvale",
    "resetTitle": "Vrátit {name} na vestavěnou verzi?",
    "resetBody": "Vaše úpravy v tomto jazyce nahradí dodávaná verze.",
    "reset": "Vrátit"
  },
  "toast": {
    "duplicated": {
      "template": "Šablona duplikována",
      "campaign": "Kampaň duplikována"
    },
    "duplicateFailed": "Nepodařilo se duplikovat",
    "deleted": {
      "template": "Šablona smazána",
      "campaign": "Kampaň smazána"
    },
    "deleteFailed": "Nepodařilo se smazat",
    "restored": {
      "template": "Šablona obnovena",
      "campaign": "Kampaň obnovena"
    },
    "restoreFailed": "Nepodařilo se obnovit",
    "deletedForGood": {
      "template": "Šablona trvale smazána",
      "campaign": "Kampaň trvale smazána"
    },
    "reset": "Vrácena vestavěná verze",
    "renameFailed": "Nepodařilo se přejmenovat"
  },
  "import": {
    "title": "Importovat šablonu",
    "subtitle": "Balíček exportovaný z Adminia.",
    "choose": "Vybrat balíček",
    "hint": "adminium-email-templates-<date>.json",
    "invalid": "Tento soubor není e-mailový balíček Adminia.",
    "summary": "{templates, plural, one {# šablona} few {# šablony} many {# šablony} other {# šablon}} a {campaigns, plural, one {# kampaň} few {# kampaně} many {# kampaně} other {# kampaní}} · {duplicates} už existuje",
    "modeLabel": "Existující dokumenty",
    "skip": "Přeskočit existující",
    "replace": "Nahradit existující",
    "confirm": "Importovat",
    "failed": "Import selhal.",
    "done": "{created} importováno · {replaced} nahrazeno · {skipped} přeskočeno",
    "errors": "{count, plural, one {# dokument se nepodařilo importovat} few {# dokumenty se nepodařilo importovat} many {# dokumentu se nepodařilo importovat} other {# dokumentů se nepodařilo importovat}}"
  },
  "editor": {
    "kind": {
      "template": "Šablona",
      "campaign": "Kampaň"
    },
    "nameLabel": "Název",
    "undo": "Zpět",
    "redo": "Znovu",
    "test": "Test",
    "save": "Uložit",
    "saveTemplate": "Uložit šablonu",
    "sendCampaign": "Odeslat kampaň",
    "shortcutSave": "Uložit e-mail",
    "saveState": {
      "saving": "Ukládá se…",
      "saved": "Všechny změny uloženy",
      "dirty": "Neuložené změny",
      "error": "Uložení selhalo"
    },
    "languages": {
      "title": "Jazykové varianty",
      "current": "Právě upravujete",
      "translated": "Přeloženo",
      "needsTranslation": "Vyžaduje překlad",
      "missing": "Zatím nevytvořeno",
      "created": "Varianta {language} vytvořena",
      "createdNeedsTranslation": "Varianta {language} vytvořena — vyžaduje překlad",
      "addFailed": "Tento jazyk se nepodařilo přidat"
    },
    "discard": {
      "title": "Zahodit neuložené změny?",
      "body": "Vaše úpravy {name} budou ztraceny.",
      "keep": "Pokračovat v úpravách",
      "confirm": "Zahodit"
    },
    "saveFailed": "Nepodařilo se uložit",
    "saved": "Změny uloženy",
    "loadFailed": "Tento e-mail se nepodařilo načíst"
  },
  "canvas": {
    "livePreview": "Živý náhled · klikněte na libovolnou část e-mailu a upravte ji",
    "device": "Šířka náhledu",
    "desktop": "Počítač",
    "mobile": "Mobil",
    "subject": "Předmět",
    "preheader": "Text náhledu",
    "preheaderPlaceholder": "Text náhledu…",
    "select": "Upravit {label}",
    "insertAbove": "Vložit sekci nad {label}",
    "add": "Přidat",
    "addSection": "Přidat sekci",
    "defaultSender": "Výchozí odesílatel",
    "now": "nyní",
    "attachments": "{count, plural, one {# příloha} few {# přílohy} many {# přílohy} other {# příloh}}",
    "fileMissing": "Soubor chybí",
    "variables": "Proměnné",
    "imagePlaceholder": "Zástupný obrázek",
    "htmlNote": "Při odeslání e-mailu se vykreslí jako čisté HTML.",
    "recurring": "Opakovaně — {freq}",
    "nextOn": "Příště {next} · {note}",
    "loyaltyBalance": "Věrnostní zůstatek",
    "loyaltyLine": "{balance} b. · {level}",
    "sections": {
      "branding": "Značka a odesílatel",
      "subject": "Předmět a text náhledu",
      "footer": "Zápatí",
      "attachments": "Přílohy"
    },
    "blockAdded": "{label} přidáno"
  },
  "blocks": {
    "heading": {
      "label": "Nadpis",
      "hint": "Titulek sekce"
    },
    "text": {
      "label": "Textový blok",
      "hint": "Jeden nebo více odstavců"
    },
    "button": {
      "label": "Tlačítko",
      "hint": "Hlavní výzva k akci"
    },
    "divider": {
      "label": "Oddělovač / mezera",
      "hint": "Linka nebo prázdné místo"
    },
    "spacer": {
      "label": "Mezera",
      "hint": "Prázdné místo"
    },
    "footer": {
      "label": "Text zápatí",
      "hint": "Starší blok zápatí"
    },
    "image": {
      "label": "Zástupný obrázek",
      "hint": "Grafiku doplníte později"
    },
    "two-col": {
      "label": "Text ve dvou sloupcích",
      "hint": "Text vedle sebe"
    },
    "list": {
      "label": "Odrážkový seznam",
      "hint": "Krátké body"
    },
    "quote": {
      "label": "Citace",
      "hint": "Reference s uvedením autora"
    },
    "social": {
      "label": "Odkazy na sítě",
      "hint": "Odkazové štítky v zápatí"
    },
    "html": {
      "label": "Vlastní HTML",
      "hint": "Vložte vlastní kód"
    },
    "box": {
      "label": "Zvýrazněný box",
      "hint": "Popisek a velká hodnota"
    },
    "stats": {
      "label": "Řádek statistik",
      "hint": "Dvě až čtyři čísla"
    },
    "product": {
      "label": "Řádek produktu",
      "hint": "Položky s cenami"
    },
    "multi-currency": {
      "label": "Více měn",
      "hint": "Součty v dalších měnách"
    },
    "tax-breakdown": {
      "label": "Rozpis daní",
      "hint": "Složky daně"
    },
    "discount-codes": {
      "label": "Slevové kódy",
      "hint": "Uplatněné kódy"
    },
    "payment-history": {
      "label": "Historie plateb",
      "hint": "Dřívější platby"
    },
    "recurring": {
      "label": "Opakovaný cyklus",
      "hint": "Rytmus doručování"
    },
    "loyalty": {
      "label": "Věrnostní body",
      "hint": "Zůstatek odměn"
    },
    "delivery": {
      "label": "Průběh doručení",
      "hint": "Stav vyřízení"
    },
    "po-terms": {
      "label": "Podmínky objednávky",
      "hint": "Podmínky nákupní objednávky"
    },
    "legal": {
      "label": "Právní zápatí",
      "hint": "Drobné písmo"
    },
    "refund-policy": {
      "label": "Pravidla vracení",
      "hint": "Vrácení a refundace"
    },
    "contact": {
      "label": "Kontaktní blok",
      "hint": "Údaje na podporu"
    },
    "unknown": {
      "label": "Sekce"
    }
  },
  "picker": {
    "title": "Přidat sekci",
    "above": "Vloženo nad {label}",
    "atEnd": "Přidáno na konec e-mailu",
    "groups": {
      "content": "Obsah",
      "commerce": "Obchod a data",
      "legal": "Právní a podpora",
      "saved": "Uložené bloky"
    },
    "savedHint": "Uloženo: {label}"
  },
  "mirror": {
    "title": "Použít i v ostatních jazycích?",
    "body": "{label} lze zrcadlit do {count, plural, one {# další jazykové varianty} few {# dalších jazykových variant} many {# další jazykové varianty} other {# dalších jazykových variant}} tématu {topic}. Text se při uložení přenese nepřeložený.",
    "onlyThis": "Jen {native}",
    "applyAll": "Použít ve všech {count}",
    "queued": "Zařazeno do {count, plural, one {# dalšího jazyka} few {# dalších jazyků} many {# dalšího jazyka} other {# dalších jazyků}} — použije se při uložení"
  },
  "inspector": {
    "tabs": "Inspektor",
    "sections": "Sekce",
    "design": "Vzhled",
    "backToSections": "Zpět na sekce",
    "fixed": "Pevné",
    "bodySections": "Sekce těla · přetažením změníte pořadí",
    "dragToReorder": "Přetažením změníte pořadí",
    "moveUp": "Posunout nahoru",
    "moveDown": "Posunout dolů",
    "duplicateSection": "Duplikovat {label}",
    "removeSection": "Odebrat {label}",
    "savedBlocks": "Uložené bloky",
    "savedBlocksHint": "Uložte libovolnou sekci na kartě Vzhled a použijte ji znovu v dalších šablonách.",
    "titles": {
      "subject": "Předmět"
    },
    "hints": {
      "branding": "Logo, odesílatel, barva, stav",
      "subject": "Předmět a text náhledu",
      "attachments": "Pevné a generované soubory",
      "footer": "Právní text a odhlášení",
      "gone": "Sekce odebrána"
    },
    "subjectLine": "Řádek předmětu",
    "preheader": "Preheader / text náhledu",
    "insertVariable": "Vložit proměnnou",
    "insertHint": "Klikněte do pole a pak na proměnnou, kterou chcete vložit.",
    "footerText": "Text zápatí",
    "footerHint": "Právní text, adresa a odhlášení. Zobrazí se na konci každého odeslaného e-mailu.",
    "attachedToEverySend": "Přiloženo ke každému odeslání",
    "attachmentsEmpty": "Zatím nic nepřiloženo. Přidejte pevný soubor, který odejde s každým odesláním, nebo generovaný soubor, který se doplní u každého příjemce.",
    "generatedLabel": "Popisek",
    "generatedToken": "Token",
    "resolvedPerRecipient": "Doplní se u každého příjemce při odeslání.",
    "removeAttachment": "Odebrat přílohu",
    "addGeneratedFile": "Přidat generovaný soubor",
    "workspaceDocuments": "Dokumenty pracovního prostoru",
    "chooseImage": "Vybrat obrázek",
    "addRow": "Přidat {noun}",
    "duplicateRow": "Duplikovat {noun}",
    "removeRow": "Odebrat {noun}",
    "saveAsReusable": "Uložit jako opakovaně použitelný blok",
    "blockName": "Název bloku",
    "myBlock": "Můj blok",
    "save": "Uložit",
    "duplicate": "Duplikovat",
    "remove": "Odebrat",
    "savedToBlocks": "Uloženo mezi vaše bloky",
    "saveBlockFailed": "Blok se nepodařilo uložit",
    "sectionDuplicated": "Sekce duplikována",
    "sectionRemoved": "Sekce odebrána",
    "sectionsReordered": "Pořadí sekcí změněno",
    "noDocuments": "V knihovně zatím nejsou žádné dokumenty. Nahrajte nějaký v části Soubory.",
    "attached": "{name} přiloženo"
  },
  "style": {
    "title": "Styl bloku",
    "alignment": "Zarovnání",
    "align": {
      "start": "Vlevo",
      "center": "Na střed",
      "end": "Vpravo"
    },
    "background": "Pozadí",
    "bg": {
      "none": "Žádné",
      "soft": "Šedé",
      "tint": "Odstín značky",
      "accent": "Značka",
      "dark": "Tmavé"
    },
    "textColour": "Barva textu",
    "fg": {
      "auto": "Základní",
      "strong": "Výrazná",
      "muted": "Tlumená",
      "accent": "Značka",
      "white": "Bílá"
    },
    "spacing": "Odsazení",
    "pad": {
      "none": "Žádné"
    },
    "textSize": "Velikost textu",
    "size": {
      "s": "Malé",
      "m": "Střední",
      "l": "Velké"
    },
    "border": "Ohraničení",
    "borderKind": {
      "none": "Žádné",
      "thin": "Plné",
      "dashed": "Čárkované"
    },
    "radius": "Zaoblení rohů",
    "radiusKind": {
      "none": "Hranaté",
      "md": "Zaoblené",
      "lg": "Výrazně zaoblené"
    },
    "fullWidth": "Na celou šířku",
    "fullWidthHint": "Až k okrajům e-mailu"
  },
  "branding": {
    "brandName": "Název značky",
    "logoMark": "Symbol loga",
    "yourLogo": "Vaše logo",
    "fromName": "Jméno odesílatele",
    "fromEmail": "E-mail odesílatele",
    "notConfigured": "Není nastavený odesílatel.",
    "manageSenders": "Spravovat odesílatele",
    "noSenders": "Zatím žádní nastavení odesílatelé — použije se výchozí odesílatel.",
    "defaultSenderOption": "Výchozí odesílatel",
    "brandColour": "Barva značky",
    "category": "Kategorie",
    "status": "Stav",
    "languageVariations": "Jazykové varianty",
    "languageHint": "Přidáním jazyka vznikne propojená kopie. Varianty zůstávají seskupené pod tématem {topic}.",
    "tagCurrent": "Aktuální",
    "tagEdit": "Upravit",
    "tagAdd": "Přidat",
    "noMatch": "Žádný odesílatel neodpovídá"
  },
  "fields": {
    "heading": "Nadpis",
    "buttonText": "Text tlačítka",
    "linkUrl": "URL odkazu",
    "height": "Výška (px)",
    "footer": "Zápatí",
    "placeholderLabel": "Popisek zástupce",
    "imageUrl": "URL obrázku",
    "leftColumn": "Levý sloupec",
    "rightColumn": "Pravý sloupec",
    "quote": "Citace",
    "attribution": "Autor",
    "html": "HTML",
    "label": "Popisek",
    "value": "Hodnota",
    "sectionLabel": "Popisek sekce",
    "baseAmount": "Základní částka",
    "frequency": "Frekvence",
    "nextIssueDate": "Datum příštího vydání",
    "scheduleNote": "Poznámka k cyklu",
    "balance": "Zůstatek",
    "earned": "Získáno",
    "level": "Úroveň",
    "body": "Text",
    "finePrint": "Drobné písmo",
    "contactName": "Jméno kontaktu",
    "email": "E-mail",
    "phone": "Telefon"
  },
  "rows": {
    "paragraphs": "Odstavce",
    "listItems": "Položky seznamu",
    "links": "Odkazy",
    "stats": "Statistiky",
    "lineItems": "Položky",
    "currencies": "Měny a kurzy",
    "taxComponents": "Složky daně",
    "codes": "Kódy",
    "payments": "Platby",
    "steps": "Kroky"
  },
  "nouns": {
    "paragraph": "odstavec",
    "item": "položku",
    "link": "odkaz",
    "stat": "statistiku",
    "currency": "měnu",
    "taxLine": "daňový řádek",
    "code": "kód",
    "payment": "platbu",
    "step": "krok"
  },
  "placeholders": {
    "paragraphText": "Text odstavce",
    "listItem": "Položka seznamu",
    "label": "Popisek",
    "iconName": "Název ikony",
    "url": "URL",
    "itemName": "Název položky",
    "variant": "Varianta / SKU",
    "stepName": "Název kroku",
    "description": "Popis"
  },
  "cycle": {
    "done": "Hotovo",
    "current": "Probíhá",
    "todo": "Čeká"
  },
  "testSend": {
    "title": "Odeslat testovací e-mail",
    "to": "Odeslat na",
    "placeholder": "jmeno@firma.cz, …",
    "removeRecipient": "Odebrat {email}",
    "quickAdd": "Rychle přidat kolegy",
    "note": "Proměnné jako {token} se v testovacích e-mailech vyplní ukázkovými daty.",
    "noteNoVars": "Testovací e-maily odejdou přesně tak, jak je vidíte.",
    "count": "{count, plural, one {# příjemce} few {# příjemci} many {# příjemce} other {# příjemců}}",
    "send": "Odeslat test",
    "sending": "Odesílá se…",
    "failed": "Test se nepodařilo odeslat.",
    "sentTitle": "Test odeslán!",
    "sentBody": "Váš test {name} je na cestě k {count, plural, one {# příjemci} few {# příjemcům} many {# příjemce} other {# příjemcům}}.",
    "sendAnother": "Odeslat další",
    "done": "Hotovo",
    "queued": "Testovací e-mail odeslán {count, plural, one {# příjemci} few {# příjemcům} many {# příjemce} other {# příjemcům}}"
  },
  "imagePicker": {
    "title": "Vybrat obrázek",
    "subtitle": "Vyberte ze souborů pracovního prostoru, nahrajte nový nebo vložte URL.",
    "source": "Zdroj",
    "workspaceFiles": "Soubory pracovního prostoru",
    "upload": "Nahrát",
    "noImages": "V knihovně zatím nejsou žádné obrázky — nahrajte nějaký.",
    "connection": "Nahrát do",
    "noConnection": "Před nahráváním připojte zdroj dat.",
    "drop": "Přetáhněte sem obrázek",
    "formats": "PNG, JPG, GIF nebo SVG",
    "browse": "Procházet soubory",
    "url": "URL obrázku",
    "urlPlaceholder": "…nebo vložte URL obrázku",
    "useUrl": "Použít URL",
    "selected": "{name} vybráno",
    "uploaded": "{name} nahráno"
  },
  "campaign": {
    "title": "Odeslat kampaň",
    "sendTo": "Odeslat na",
    "workspaceUsers": "Uživatelé pracovního prostoru",
    "rolesHint": "Všichni, nebo jen držitelé vybraných rolí.",
    "when": "Kdy",
    "now": "Teď",
    "schedule": "Načasovat",
    "scheduleAt": "Odeslat v",
    "pastTime": "Zvolte čas v budoucnosti.",
    "counting": "Počítají se příjemci…",
    "countFailed": "Příjemce se nepodařilo spočítat",
    "count": "{total, plural, one {# příjemce} few {# příjemci} many {# příjemce} other {# příjemců}}",
    "optedOut": "{skipped} odhlášeno",
    "note": "Proměnné se vyplní u každého příjemce — z {token} se stane jméno dané osoby.",
    "send": "Odeslat kampaň",
    "scheduleAction": "Načasovat kampaň",
    "sending": "Odesílá se…",
    "failed": "Kampaň se nepodařilo odeslat.",
    "sentTitle": "Kampaň odeslána!",
    "sentBody": "{name} je na cestě k {count, plural, one {# příjemci} few {# příjemcům} many {# příjemce} other {# příjemcům}}.",
    "scheduledTitle": "Kampaň načasována!",
    "scheduledBody": "{name} odejde {when}.",
    "done": "Hotovo",
    "chipScheduled": "Načasováno · {when}",
    "chipSending": "Odesílá se · {pct} %",
    "cancelSchedule": "Zrušit načasování",
    "cancelSending": "Zrušit odesílání",
    "cancelled": "Načasování zrušeno",
    "sendingCancelled": "Odesílání zrušeno",
    "cancelFailed": "Nepodařilo se zrušit"
  }
} as const;
