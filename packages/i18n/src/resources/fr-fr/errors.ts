/**
 * GENERATED MIRROR of ../../../locales/fr-FR/errors.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "UNAUTHENTICATED": "Vous devez vous connecter pour continuer.",
  "SESSION_EXPIRED": "Votre session a expiré. Reconnectez-vous pour continuer.",
  "FORBIDDEN": "Vous n’avez pas la permission de faire cela.",
  "NOT_FOUND": "Cette ressource n’existe pas ou a été supprimée.",
  "CONFLICT": "Cette modification entre en conflit avec l’état actuel. Actualisez et réessayez.",
  "UNIQUE_VIOLATION": "Cette valeur est déjà utilisée.",
  "VALIDATION_FAILED": "Certains champs demandent votre attention avant l’enregistrement.",
  "RATE_LIMITED": "Trop de requêtes — patientez un instant et réessayez.",
  "PAYLOAD_TOO_LARGE": "Cette requête est trop volumineuse.",
  "META_NOT_CONFIGURED": "Aucun méta-store n’est encore configuré.",
  "CONNECTION_FAILED": "Adminium n’a pas pu joindre la base de données.",
  "INTERNAL": "Une erreur s’est produite. Communiquez l’identifiant de requête au support.",
  "OFFLINE": "Vous semblez être hors ligne. Reconnectez-vous pour continuer."
} as const;
