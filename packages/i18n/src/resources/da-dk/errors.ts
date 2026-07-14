/**
 * GENERATED MIRROR of ../../../locales/da-DK/errors.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "UNAUTHENTICATED": "Du skal logge ind for at fortsætte.",
  "SESSION_EXPIRED": "Din session er udløbet. Log ind igen for at fortsætte.",
  "FORBIDDEN": "Du har ikke tilladelse til det.",
  "NOT_FOUND": "Ressourcen findes ikke eller er blevet fjernet.",
  "CONFLICT": "Ændringen er i konflikt med den aktuelle tilstand. Genindlæs, og prøv igen.",
  "UNIQUE_VIOLATION": "Værdien er allerede i brug.",
  "VALIDATION_FAILED": "Nogle felter kræver opmærksomhed, før dette kan gemmes.",
  "RATE_LIMITED": "For mange anmodninger — vent et øjeblik, og prøv igen.",
  "PAYLOAD_TOO_LARGE": "Anmodningen er for stor.",
  "META_NOT_CONFIGURED": "Der er endnu ikke konfigureret et metalager.",
  "CONNECTION_FAILED": "Adminium kunne ikke nå databasen.",
  "INTERNAL": "Noget gik galt. Del anmodnings-id'et med support.",
  "OFFLINE": "Du ser ud til at være offline. Opret forbindelse igen for at fortsætte.",
  "LLM_JSON_PARSE": "AI-svaret var ikke gyldig JSON.",
  "LLM_TRUNCATED": "AI-svaret blev afbrudt, før det var færdigt.",
  "LLM_VERSION_MISMATCH": "Dette svar blev lavet til en version, der ikke understøttes. Generér prompten igen under Indstillinger → AI.",
  "LLM_MODEL_DECLINED": "AI’en afviste at lave forslag til dette skema.",
  "LLM_SCHEMA_INVALID": "AI-svaret matchede ikke den forventede struktur.",
  "LLM_LOCALE_KEYS": "En oversat værdi mangler et af de ønskede sprog.",
  "LLM_UNKNOWN_TABLE": "AI’en henviste til en tabel, der ikke findes i dette skema; forslaget blev kasseret.",
  "LLM_UNKNOWN_COLUMN": "AI’en henviste til en kolonne, der ikke findes i dette skema; forslaget blev kasseret.",
  "LLM_BAD_DISPLAY_COLUMN": "Den foreslåede visningskolonne er et id, ikke en læsbar værdi.",
  "LLM_NOT_AN_ENUM": "AI’en behandlede en kolonne som en statusliste, selvom den ikke er det.",
  "LLM_ENUM_VALUES": "De foreslåede statusværdier matcher ikke kolonnens faktiske værdier.",
  "LLM_UNKNOWN_RELATION": "AI’en bekræftede en relation, der ikke er erklæret i dette skema.",
  "LLM_RELATION_INVALID": "Den foreslåede relation er ugyldig eller er en dublet af en eksisterende.",
  "LLM_UNKNOWN_TEMPLATE": "AI’en anbefalede en sideskabelon, der ikke er tilladt.",
  "LLM_UNKNOWN_WIDGET": "AI’en anbefalede en dashboard-widget, der ikke er tilladt.",
  "LLM_WIDGET_BINDING": "En foreslået widget er bundet til kolonner, der ikke passer; den blev fjernet.",
  "LLM_GROUP_INVALID": "En navigationsgruppe er ugyldig — en tabel optræder i mere end én gruppe.",
  "LLM_UNKNOWN_ICON": "Det foreslåede ikon er ikke tilgængeligt; et standardikon blev brugt i stedet.",
  "LLM_RUN_MISMATCH": "Dette svar ser ud til at være genereret ud fra en anden prompt."
} as const;
