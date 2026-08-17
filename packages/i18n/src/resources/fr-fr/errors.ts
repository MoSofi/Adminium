// SPDX-License-Identifier: AGPL-3.0-only
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
  "PAGE_FORBIDDEN": "Vous n’avez pas la permission de modifier cette page.",
  "NOT_FOUND": "Cette ressource n’existe pas ou a été supprimée.",
  "CONFLICT": "Cette modification entre en conflit avec l’état actuel. Actualisez et réessayez.",
  "UNIQUE_VIOLATION": "Cette valeur est déjà utilisée.",
  "VALIDATION_FAILED": "Certains champs demandent votre attention avant l’enregistrement.",
  "RATE_LIMITED": "Trop de requêtes — patientez un instant et réessayez.",
  "PAYLOAD_TOO_LARGE": "Cette requête est trop volumineuse.",
  "META_NOT_CONFIGURED": "Aucun méta-store n’est encore configuré.",
  "CONNECTION_FAILED": "Adminium n’a pas pu joindre la base de données.",
  "INTERNAL": "Une erreur s’est produite. Communiquez l’identifiant de requête au support.",
  "OFFLINE": "Vous semblez être hors ligne. Reconnectez-vous pour continuer.",
  "LLM_JSON_PARSE": "La réponse de l’IA n’était pas un JSON valide.",
  "LLM_TRUNCATED": "La réponse de l’IA a été coupée avant la fin.",
  "LLM_VERSION_MISMATCH": "Cette réponse a été produite pour une version non prise en charge. Régénérez l’invite dans Paramètres → IA.",
  "LLM_MODEL_DECLINED": "L’IA a refusé de produire des suggestions pour ce schéma.",
  "LLM_SCHEMA_INVALID": "La réponse de l’IA ne correspondait pas à la structure attendue.",
  "LLM_LOCALE_KEYS": "Une valeur traduite ne contient pas l’une des langues demandées.",
  "LLM_UNKNOWN_TABLE": "L’IA a fait référence à une table absente de ce schéma ; la suggestion a été écartée.",
  "LLM_UNKNOWN_COLUMN": "L’IA a fait référence à une colonne absente de ce schéma ; la suggestion a été écartée.",
  "LLM_BAD_DISPLAY_COLUMN": "La colonne d’affichage suggérée est un identifiant, pas une valeur lisible.",
  "LLM_NOT_AN_ENUM": "L’IA a traité une colonne comme une liste de statuts alors qu’elle n’en est pas une.",
  "LLM_ENUM_VALUES": "Les valeurs de statut suggérées ne correspondent pas aux valeurs réelles de la colonne.",
  "LLM_UNKNOWN_RELATION": "L’IA a confirmé une relation qui n’est pas déclarée dans ce schéma.",
  "LLM_RELATION_INVALID": "La relation suggérée est invalide ou fait doublon avec une relation existante.",
  "LLM_UNKNOWN_TEMPLATE": "L’IA a recommandé un modèle de page qui n’est pas autorisé.",
  "LLM_UNKNOWN_WIDGET": "L’IA a recommandé un widget de tableau de bord qui n’est pas autorisé.",
  "LLM_WIDGET_BINDING": "Un widget suggéré est lié à des colonnes inadaptées ; il a été écarté.",
  "LLM_GROUP_INVALID": "Un groupe de navigation est invalide — une table apparaît dans plusieurs groupes.",
  "LLM_UNKNOWN_ICON": "L’icône suggérée n’est pas disponible ; une icône par défaut a été utilisée.",
  "LLM_LABEL_COLLISION": "Deux suggestions portent le même nom ; toutes deux apparaîtraient sous le même titre.",
  "LLM_RUN_MISMATCH": "Cette réponse semble avoir été générée à partir d’une autre invite."
} as const;
