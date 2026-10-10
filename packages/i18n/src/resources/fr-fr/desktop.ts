// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/desktop.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "new": {
    "back": "Retour",
    "change": "Modifier…",
    "create": "Créer",
    "creating": "Préparation…",
    "failed": "Le projet n’a pas pu être créé.",
    "heading": "Créer une application",
    "help": "Adminium crée ce dossier pour vous. Tout ce qui concerne votre application s’y trouve.",
    "name": "Nom",
    "refuse": {
      "badName": "Utilisez au moins une lettre ou un chiffre dans le nom.",
      "existsWithFiles": "Un dossier portant ce nom existe déjà et contient des fichiers. Choisissez un autre nom ou un autre dossier.",
      "homeFolder": "Un projet ne peut pas être placé directement dans votre dossier personnel. Choisissez ou créez un dossier à l’intérieur.",
      "insideAProject": "Ce dossier se trouve dans un autre projet. Choisissez un dossier en dehors.",
      "insideTheApp": "Un projet ne peut pas être placé dans Adminium lui-même. Choisissez un autre dossier.",
      "notAbsolute": "Choisissez un dossier avec le bouton « Modifier… ».",
      "systemFolder": "Un projet ne peut pas être placé dans un dossier qui appartient au système. Choisissez un dossier à vous."
    },
    "step": {
      "files": "Mise en place des fichiers de votre application",
      "packages": "Récupération de ce avec quoi votre application est construite",
      "database": "Création de sa base de données",
      "opening": "Ouverture de votre application",
      "slow": "C’est l’étape longue, la première fois : quelques minutes avec une connexion lente. Les applications suivantes démarrent plus vite.",
      "label": "Ce qui est en cours"
    },
    "warn": {
      "another": "Choisir un autre dossier",
      "anyway": "L’utiliser quand même",
      "dropbox": "Ce dossier est synchronisé par Dropbox. Les projets fonctionnent mal dans les dossiers synchronisés : la synchronisation peut endommager leurs données.",
      "googledrive": "Ce dossier est synchronisé par Google Drive. Les projets fonctionnent mal dans les dossiers synchronisés : la synchronisation peut endommager leurs données.",
      "icloud": "Ce dossier est synchronisé par iCloud Drive. Les projets fonctionnent mal dans les dossiers synchronisés : la synchronisation peut endommager leurs données.",
      "noLinks": "Ce disque ne peut pas contenir les liens dont les paquets d’un projet ont besoin : leur téléchargement risque d’échouer.",
      "onedrive": "Ce dossier est synchronisé par OneDrive. Les projets fonctionnent mal dans les dossiers synchronisés : la synchronisation peut endommager leurs données."
    },
    "where": "Emplacement"
  },
  "start": {
    "choice": {
      "build": {
        "line": "Décrivez-la, et le Designer la construit sur cet ordinateur.",
        "title": "Créer une application"
      },
      "connect": {
        "line": "Utiliser un Adminium qui tourne sur un autre ordinateur.",
        "title": "Se connecter à un autre Adminium"
      },
      "db": {
        "line": "Créer des écrans pour une base de données que vous avez déjà.",
        "title": "Utiliser ma propre base de données"
      },
      "open": {
        "line": "Continuer avec une application déjà présente dans un dossier, ou qu’on vous a envoyée.",
        "title": "Ouvrir un dossier"
      }
    },
    "heading": "Que souhaitez-vous faire ?",
    "open": {
      "needsPackages": "Les paquets de ce projet ne sont pas encore sur cet ordinateur.",
      "notAProject": "Ce dossier n’est pas un projet Adminium."
    },
    "recent": {
      "alreadyListed": "Ce dossier figure déjà dans la liste.",
      "building": "En construction",
      "gone": "Ce dossier a été déplacé ou supprimé",
      "heading": "Projets récents",
      "locate": "Localiser…",
      "locateTitle": "Où se trouve {name} maintenant ?",
      "notThatProject": "Ce dossier n’est pas un projet Adminium.",
      "open": "Ouvrir {name}",
      "opened": "Ouvert {when}",
      "remove": "Retirer",
      "removed": "Retiré des projets récents",
      "shared": "Partagé"
    },
    "welcome": "Bienvenue dans Adminium."
  },
  "toast": {
    "dismiss": "Fermer",
    "region": "Notifications"
  },
  "trust": {
    "body": "L’ouvrir exécute son code sur cet ordinateur, avec votre accès à vos fichiers. N’ouvrez que des dossiers que vous avez créés ou qui viennent d’une personne de confiance.",
    "cancel": "Annuler",
    "changed": "Le code de ce dossier a changé depuis votre dernière ouverture.",
    "open": "Ouvrir",
    "title": "Ouvrir ce dossier ?"
  }
} as const;
