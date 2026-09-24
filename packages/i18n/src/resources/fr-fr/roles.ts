// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/roles.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "delete": "Supprimer",
    "rename": "Renommer"
  },
  "builtinLocked": "Les rôles intégrés ne peuvent pas être supprimés.",
  "category": {
    "access": "Accès",
    "data": "Données",
    "operations": "Opérations",
    "workspace": "Espace de travail",
    "records": "Pages et enregistrements",
    "apps": "Apps"
  },
  "column": {
    "actions": "Actions",
    "members": "Membres",
    "name": "Rôle"
  },
  "create": {
    "descriptionLabel": "Description",
    "description": "Un nouveau rôle démarre sans aucune permission.",
    "failed": "Impossible de créer le rôle",
    "namePlaceholder": "ex. Agent de support",
    "name": "Nom",
    "submit": "Créer le rôle",
    "title": "Nouveau rôle"
  },
  "createButton": "Nouveau rôle",
  "delete": {
    "confirm": "Supprimer le rôle",
    "description": "Le rôle et ses lignes de permissions sont supprimés.",
    "failed": "Impossible de supprimer le rôle",
    "hasMembers": "« {name} » compte encore {count, plural, one {# membre} other {# membres}}. Choisissez le rôle vers lequel les déplacer — Adminium ne laissera jamais un compte sans rôle.",
    "noMembers": "Personne ne détient « {name} », rien ne sera donc déplacé.",
    "reassignPlaceholder": "Choisissez un rôle…",
    "reassignTo": "Déplacer les membres vers",
    "title": "Supprimer le rôle"
  },
  "list": {
    "title": "Rôles"
  },
  "loadFailed": {
    "body": "La matrice ci-dessous est incomplète : l’enregistrer retirerait des permissions qui ne sont simplement pas chargées. Rechargez la page avant toute modification.",
    "title": "Certaines permissions n’ont pas pu être lues"
  },
  "matrix": {
    "discard": "Abandonner",
    "empty": {
      "body": "Cette instance n’a signalé aucune permission attribuable, ce qui ne devrait pas arriver — rechargez la page, et si le problème persiste, consultez le journal du serveur.",
      "title": "Aucune permission à afficher"
    },
    "label": "Permissions des rôles",
    "noChanges": "Aucune modification en attente",
    "pending": "{count, plural, one {# modification en attente} other {# modifications en attente}}",
    "rowHeader": "Permission",
    "title": "Permissions"
  },
  "memberCount": "{count, plural, one {# utilisateur} other {# utilisateurs}}",
  "permission": {
    "apiKeysManage": "Gérer les clés d’API",
    "auditRead": "Lire le journal d’audit",
    "connectionsManage": "Gérer les connexions aux bases de données",
    "exportsManage": "Gérer les exports de tout le monde",
    "importsManage": "Gérer les imports de tout le monde",
    "jobsManage": "Démarrer et annuler les tâches en arrière-plan",
    "manifestsManage": "Installer et gérer les applications et les modules",
    "jobsRead": "Voir toutes les tâches en arrière-plan",
    "llmRun": "Utiliser l’assistance IA",
    "pagesManage": "Créer et organiser les pages",
    "projectRead": "Lire les modifications de pages et de schéma pour une récupération de projet",
    "reportsManage": "Gérer les rapports planifiés",
    "rolesManage": "Gérer les rôles et les permissions",
    "schemaRemap": "Modifier les libellés et les remplacements du schéma",
    "schemaDdl": "Créer, modifier et supprimer des tables",
    "settingsManage": "Gérer les paramètres de l’espace de travail",
    "usersManage": "Gérer les utilisateurs",
    "filesManage": "Gérer les fichiers de tout le monde",
    "storageManage": "Gérer les destinations de stockage"
  },
  "rename": {
    "failed": "Impossible de renommer le rôle",
    "title": "Renommer le rôle"
  },
  "saveFailed": {
    "title": "Impossible d’enregistrer tous les rôles"
  },
  "subtitle": "Ce que chaque rôle est autorisé à faire. Un utilisateur cumule les permissions de tous les rôles qu’il détient.",
  "title": "Rôles et permissions",
  "data": {
    "pagesView": "Voir toutes les pages",
    "read": "Lire les enregistrements",
    "readPii": "Voir les données personnelles des enregistrements",
    "create": "Créer des enregistrements",
    "update": "Modifier les enregistrements",
    "delete": "Supprimer des enregistrements",
    "export": "Exporter des enregistrements",
    "import": "Importer des enregistrements",
    "pagesEdit": "Modifier la mise en page des pages",
    "narrow": "{count, plural, one {# autorisation} other {# autorisations}} sur une seule page ou table s’appliquent aussi, en plus des lignes ci-dessous. L’enregistrement les conserve."
  },
  "apps": {
    "every": "Ouvrir les écrans du personnel de toutes les apps",
    "one": "Ouvrir les écrans du personnel de {app}"
  }
} as const;
