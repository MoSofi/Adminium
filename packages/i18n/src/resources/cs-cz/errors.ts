/**
 * GENERATED MIRROR of ../../../locales/cs-CZ/errors.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "UNAUTHENTICATED": "Pro pokračování se musíte přihlásit.",
  "SESSION_EXPIRED": "Platnost relace vypršela. Pro pokračování se přihlaste znovu.",
  "FORBIDDEN": "K této akci nemáte oprávnění.",
  "PAGE_FORBIDDEN": "K úpravě této stránky nemáte oprávnění.",
  "NOT_FOUND": "Tento zdroj neexistuje nebo byl odstraněn.",
  "CONFLICT": "Tato změna je v konfliktu s aktuálním stavem. Obnovte stránku a zkuste to znovu.",
  "UNIQUE_VIOLATION": "Tato hodnota se již používá.",
  "VALIDATION_FAILED": "Některá pole vyžadují úpravu, než bude možné uložit.",
  "RATE_LIMITED": "Příliš mnoho požadavků — chvíli počkejte a zkuste to znovu.",
  "PAYLOAD_TOO_LARGE": "Tento požadavek je příliš velký.",
  "META_NOT_CONFIGURED": "Zatím není nakonfigurováno žádné meta úložiště.",
  "CONNECTION_FAILED": "Adminiu se nepodařilo připojit k databázi.",
  "INTERNAL": "Něco se pokazilo. Sdělte podpoře ID požadavku.",
  "OFFLINE": "Vypadá to, že jste offline. Pro pokračování se znovu připojte.",
  "LLM_JSON_PARSE": "Odpověď AI nebyla platný JSON.",
  "LLM_TRUNCATED": "Odpověď AI byla přerušena, než skončila.",
  "LLM_VERSION_MISMATCH": "Tato odpověď byla vytvořena pro nepodporovanou verzi. Vygenerujte prompt znovu v Nastavení → AI.",
  "LLM_MODEL_DECLINED": "AI odmítla vytvořit návrhy pro toto schéma.",
  "LLM_SCHEMA_INVALID": "Odpověď AI neodpovídala očekávané struktuře.",
  "LLM_LOCALE_KEYS": "V přeložené hodnotě chybí jeden z požadovaných jazyků.",
  "LLM_UNKNOWN_TABLE": "AI odkázala na tabulku, která v tomto schématu neexistuje; návrh byl zahozen.",
  "LLM_UNKNOWN_COLUMN": "AI odkázala na sloupec, který v tomto schématu neexistuje; návrh byl zahozen.",
  "LLM_BAD_DISPLAY_COLUMN": "Navržený zobrazovaný sloupec je ID, nikoli člověku čitelná hodnota.",
  "LLM_NOT_AN_ENUM": "AI považovala sloupec za seznam stavů, ačkoli jím není.",
  "LLM_ENUM_VALUES": "Navržené stavové hodnoty neodpovídají skutečným hodnotám sloupce.",
  "LLM_UNKNOWN_RELATION": "AI potvrdila vztah, který není v tomto schématu deklarován.",
  "LLM_RELATION_INVALID": "Navržený vztah je neplatný nebo duplikuje existující.",
  "LLM_UNKNOWN_TEMPLATE": "AI doporučila šablonu stránky, která není povolena.",
  "LLM_UNKNOWN_WIDGET": "AI doporučila widget dashboardu, který není povolen.",
  "LLM_WIDGET_BINDING": "Navržený widget je navázán na nevhodné sloupce; byl vyřazen.",
  "LLM_GROUP_INVALID": "Navigační skupina je neplatná — tabulka se objevuje ve více než jedné skupině.",
  "LLM_UNKNOWN_ICON": "Navržená ikona není k dispozici; místo ní byla použita výchozí.",
  "LLM_LABEL_COLLISION": "Dva návrhy sdílejí stejný název; oba by se zobrazily pod stejným nadpisem.",
  "LLM_RUN_MISMATCH": "Tato odpověď vypadá, že byla vygenerována z jiného promptu."
} as const;
