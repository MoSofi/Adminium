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
  "NOT_FOUND": "Tento zdroj neexistuje nebo byl odstraněn.",
  "CONFLICT": "Tato změna je v konfliktu s aktuálním stavem. Obnovte stránku a zkuste to znovu.",
  "UNIQUE_VIOLATION": "Tato hodnota se již používá.",
  "VALIDATION_FAILED": "Některá pole vyžadují úpravu, než bude možné uložit.",
  "RATE_LIMITED": "Příliš mnoho požadavků — chvíli počkejte a zkuste to znovu.",
  "PAYLOAD_TOO_LARGE": "Tento požadavek je příliš velký.",
  "META_NOT_CONFIGURED": "Zatím není nakonfigurováno žádné meta úložiště.",
  "CONNECTION_FAILED": "Adminiu se nepodařilo připojit k databázi.",
  "INTERNAL": "Něco se pokazilo. Sdělte podpoře ID požadavku.",
  "OFFLINE": "Vypadá to, že jste offline. Pro pokračování se znovu připojte."
} as const;
