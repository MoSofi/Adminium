// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/files.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
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
  "subtitle": "Tout ce qui a été téléversé dans cet espace de travail, et où sont stockés les octets.",
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
    "body": "Les fichiers apparaissent ici dès que quelqu’un en joint un à un enregistrement ou remplit un champ de type fichier."
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
    "unattached": "Non joints",
    "trash": "Corbeille",
    "recent": "Récents"
  },
  "column": {
    "name": "Fichier",
    "size": "Taille",
    "attachedTo": "Joint à",
    "destination": "Destination",
    "added": "Ajouté le",
    "actions": "Actions"
  },
  "row": {
    "unattached": "Non joint",
    "localDestination": "Le disque de ce serveur",
    "noRecord": "Rattaché à aucun enregistrement"
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
    "attachedTo": "Joint à",
    "uploadedBy": "Téléversé par",
    "added": "Ajouté le",
    "attachedAt": "Joint le",
    "trashedAt": "Déplacé dans la corbeille",
    "id": "Identifiant du fichier",
    "checksum": "Somme de contrôle"
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
    "completeBody": "Ces fichiers sont maintenant dans cet espace de travail et pourront être rattachés à un enregistrement plus tard.",
    "send": "{count, plural, one {Téléverser # fichier} other {Téléverser # fichiers}}",
    "done": "Terminé",
    "failed": "Échec",
    "cancelled": "Annulé"
  }
} as const;
