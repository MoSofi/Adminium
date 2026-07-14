/**
 * GENERATED MIRROR of ../../../locales/de-DE/errors.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "UNAUTHENTICATED": "Sie müssen sich anmelden, um fortzufahren.",
  "SESSION_EXPIRED": "Ihre Sitzung ist abgelaufen. Melden Sie sich erneut an, um fortzufahren.",
  "FORBIDDEN": "Sie haben dafür keine Berechtigung.",
  "NOT_FOUND": "Diese Ressource existiert nicht oder wurde entfernt.",
  "CONFLICT": "Diese Änderung steht im Konflikt mit dem aktuellen Stand. Aktualisieren Sie die Ansicht und versuchen Sie es erneut.",
  "UNIQUE_VIOLATION": "Dieser Wert wird bereits verwendet.",
  "VALIDATION_FAILED": "Einige Felder benötigen noch Korrekturen, bevor gespeichert werden kann.",
  "RATE_LIMITED": "Zu viele Anfragen — warten Sie einen Moment und versuchen Sie es erneut.",
  "PAYLOAD_TOO_LARGE": "Diese Anfrage ist zu groß.",
  "META_NOT_CONFIGURED": "Es ist noch kein Meta-Store konfiguriert.",
  "CONNECTION_FAILED": "Adminium konnte die Datenbank nicht erreichen.",
  "INTERNAL": "Etwas ist schiefgelaufen. Teilen Sie die Anfrage-ID mit dem Support.",
  "OFFLINE": "Sie scheinen offline zu sein. Stellen Sie die Verbindung wieder her, um fortzufahren."
} as const;
