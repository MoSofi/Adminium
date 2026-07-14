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
  "OFFLINE": "Du ser ud til at være offline. Opret forbindelse igen for at fortsætte."
} as const;
