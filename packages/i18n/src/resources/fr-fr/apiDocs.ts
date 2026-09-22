// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/apiDocs.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "badge": {
    "anon": "Lecture publique",
    "authenticated": "Connexion requise",
    "public": "Public",
    "service": "Rôle de service"
  },
  "code": {
    "copied": "Copié",
    "copy": "Copier",
    "curl": "cURL",
    "js": "JavaScript",
    "languages": "Langage de l’exemple de code",
    "python": "Python"
  },
  "copyBase": "Copier l’URL de base",
  "crumb": "API",
  "empty": {
    "body": "Ce déploiement n’a publié aucun point de terminaison.",
    "title": "Aucun point de terminaison pour l’instant"
  },
  "ep": {
    "batch": {
      "desc": "Insertion ou upsert en masse, jusqu’à 500 lignes.",
      "title": "Créer plusieurs {ref}"
    },
    "create": {
      "desc": "Insérer une ligne. Renvoie l’enregistrement créé.",
      "title": "{article, select, other {}}Créer : {singular}"
    },
    "delete": {
      "desc": "Supprimer la ligne ayant cette clé primaire.",
      "title": "{article, select, other {}}Supprimer : {singular}"
    },
    "list": {
      "desc": "Renvoyer un ensemble de lignes filtré, trié et paginé.",
      "title": "Lister {ref}"
    },
    "one": {
      "desc": "Récupérer une seule ligne par sa clé primaire.",
      "title": "{article, select, other {}}Récupérer : {singular}"
    },
    "replace": {
      "desc": "Remplacer une ligne entière par sa clé primaire.",
      "title": "{article, select, other {}}Remplacer : {singular}"
    },
    "rowWord": "ligne",
    "update": {
      "desc": "Modifier des colonnes de la ligne ayant cette clé primaire.",
      "title": "{article, select, other {}}Mettre à jour : {singular}"
    }
  },
  "meta": "{endpoints, plural, one {# point de terminaison} other {# points de terminaison}} · limite {limit}, tri {order}",
  "pg": {
    "auth": "Autorisation",
    "authHelper": "Une clé navigateur. Elle reste dans cet onglet et disparaît lorsque vous rechargez la page.",
    "authPlaceholder": "Collez une clé",
    "body": "Corps de la requête",
    "needKey": "Collez d’abord une clé",
    "send": "Envoyer la requête",
    "sending": "Envoi…",
    "title": "Console de test"
  },
  "rail": {
    "empty": "Rien ne correspond à ce filtre.",
    "filter": "Filtrer les tables…",
    "heading": "Ressources",
    "reference": "Référence de l’API"
  },
  "res": {
    "idle": "Envoyez une requête pour voir la réponse.",
    "ms": "{ms} ms",
    "network": "La requête n’a pas atteint le serveur.",
    "noBody": "204 No Content — ligne supprimée",
    "title": "Réponse"
  },
  "schema": {
    "body": "Schéma du corps",
    "response": "Colonnes de la réponse"
  },
  "status": {
    "live": "API active",
    "off": "Désactivée"
  },
  "tag": {
    "fk": "FK",
    "pk": "PK",
    "unique": "UNIQUE"
  }
} as const;
