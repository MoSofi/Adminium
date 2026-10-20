// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/files.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "toast": {
    "restored": "{name} a été restauré",
    "restoreFailed": "Impossible de restaurer ce fichier",
    "trashed": "{name} a été déplacé dans la corbeille",
    "trashFailed": "Impossible de déplacer ce fichier dans la corbeille"
  },
  "title": "Fichiers",
  "subtitle": "Tous les fichiers de cet espace de travail : ceux des fiches et ceux de la bibliothèque. Et où chacun est conservé.",
  "search": "Rechercher par nom de fichier",
  "trash": {
    "notice": {
      "title": "La corbeille se vide toute seule",
      "body": "Un fichier dans la corbeille est supprimé, données comprises, une fois la période de conservation de ce serveur écoulée. Restaurez avant cela ce dont vous avez encore besoin."
    }
  },
  "listFailed": {
    "title": "Impossible de charger ces fichiers"
  },
  "empty": {
    "filtered": {
      "title": "Rien ici",
      "body": "Effacez la recherche, ou choisissez un autre raccourci dans le panneau latéral."
    },
    "title": "Aucun fichier pour l’instant",
    "body": "Les fichiers arrivent ici quand quelqu’un en ajoute un à une fiche ou remplit un champ de fichier.",
    "library": "Rien n’a encore été importé ici."
  },
  "loadMore": "Charger plus de fichiers",
  "usage": {
    "label": "Stockage utilisé",
    "used": "{size} utilisés",
    "count": "{count, plural, one {# fichier} other {# fichiers}}",
    "diskLabel": "Espace utilisé",
    "ofDisk": "{used} sur {size} de ce disque"
  },
  "rail": {
    "label": "Raccourcis de fichiers",
    "byTable": "Par table",
    "byDestination": "Par destination",
    "byConnection": "Par connexion"
  },
  "preset": {
    "all": "Tous les fichiers",
    "unattached": "Pas encore utilisés",
    "trash": "Corbeille",
    "recent": "Récents",
    "unattachedHelp": "Fichiers importés qu’aucune fiche n’a pris. Ils partent à la corbeille après {hours} heures.",
    "library": "Importés ici"
  },
  "column": {
    "name": "Fichier",
    "size": "Taille",
    "attachedTo": "Sur la fiche",
    "destination": "Destination",
    "added": "Ajouté le",
    "actions": "Actions"
  },
  "row": {
    "unattached": "Pas encore utilisé",
    "localDestination": "Le disque de ce serveur",
    "noRecord": "Sur aucune fiche",
    "uploadedHere": "Importé ici"
  },
  "action": {
    "restore": "Restaurer",
    "download": "Télécharger",
    "deleteNamed": "Supprimer {name}",
    "delete": "Supprimer"
  },
  "drawer": {
    "none": "Aucun",
    "subtitle": "{size} · {type}",
    "destination": "Destination",
    "attachedTo": "Sur la fiche",
    "uploadedBy": "Téléversé par",
    "added": "Ajouté le",
    "attachedAt": "Utilisé depuis",
    "trashedAt": "Déplacé dans la corbeille",
    "id": "Identifiant du fichier",
    "checksum": "Somme de contrôle",
    "previewTitle": "Aperçu de {name}",
    "previewNone": "Aucun aperçu n’est disponible pour ce type de fichier.",
    "previewTrashed": "Un fichier dans la corbeille ne peut pas être prévisualisé.",
    "previewFailed": "Ce fichier ne peut pas être affiché ici. Téléchargez-le pour l’ouvrir.",
    "previewTruncated": "Affichage des {size} premiers."
  },
  "view": {
    "label": "Affichage des fichiers",
    "grid": "Grille",
    "list": "Liste"
  },
  "upload": {
    "open": "Téléverser",
    "title": "Téléverser des fichiers",
    "subtitle": "Ajoutez des fichiers à cet espace de travail.",
    "connection": "Connexion à laquelle ils appartiennent",
    "drop": "Déposez les fichiers ici",
    "browse": "Parcourir votre ordinateur",
    "sending": "Téléversement",
    "cancelOne": "Annuler {name}",
    "removeOne": "Retirer {name}",
    "complete": "Téléversement terminé",
    "completeBody": "Ces fichiers sont maintenant dans la bibliothèque. Ajoutez-en un à une fiche avec Choisir une image existante… dans son champ. La fiche reçoit sa propre copie.",
    "send": "{count, plural, one {Téléverser # fichier} other {Téléverser # fichiers}}",
    "done": "Terminé",
    "failed": "Échec",
    "cancelled": "Annulé"
  }
} as const;
