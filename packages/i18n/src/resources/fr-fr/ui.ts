/**
 * GENERATED MIRROR of ../../../locales/fr-FR/ui.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "close": "Fermer",
    "cancel": "Annuler",
    "confirm": "Confirmer",
    "save": "Enregistrer",
    "apply": "Appliquer",
    "delete": "Supprimer",
    "edit": "Modifier",
    "copy": "Copier",
    "copied": "Copié",
    "undo": "Annuler",
    "retry": "Réessayer",
    "clear": "Effacer",
    "selectAll": "Tout sélectionner",
    "clearSelection": "Effacer la sélection",
    "showPassword": "Afficher le mot de passe",
    "hidePassword": "Masquer le mot de passe",
    "reveal": "Révéler",
    "hide": "Masquer"
  },
  "state": {
    "loading": "Chargement…",
    "empty": "Rien ici pour l’instant",
    "noResults": "Aucun résultat",
    "optional": "Facultatif",
    "required": "Obligatoire",
    "error": "Une erreur s’est produite"
  },
  "pagination": {
    "previous": "Précédent",
    "next": "Suivant",
    "pageOf": "Page {page, number} sur {pages, number}",
    "rowsPerPage": "Lignes par page",
    "range": "{from, number}–{to, number} sur {total, number}"
  },
  "table": {
    "sortAscending": "Trier par ordre croissant",
    "sortDescending": "Trier par ordre décroissant",
    "rowActions": "Actions de ligne",
    "selectRow": "Sélectionner la ligne",
    "selectAllRows": "Sélectionner toutes les lignes"
  },
  "dialog": {
    "close": "Fermer la boîte de dialogue",
    "confirmTitle": "Êtes-vous sûr ?"
  },
  "combobox": {
    "placeholder": "Sélectionner…",
    "search": "Rechercher…",
    "noMatches": "Aucune correspondance"
  },
  "toast": {
    "dismiss": "Fermer la notification"
  },
  "widgets": {
    "charts": {
      "boxplot": {
        "description": "Résumé en boîte à moustaches de la dispersion d'une colonne numérique par catégorie — min, quartiles, médiane et max.",
        "emptyTitle": "Aucune distribution à tracer",
        "emptyBody": "Aucune ligne ne correspond aux filtres pour les boîtes à moustaches."
      },
      "violin": {
        "description": "Courbes de densité en miroir comparant la distribution d'une colonne numérique entre les groupes.",
        "emptyTitle": "Aucune distribution à tracer",
        "emptyBody": "Aucune ligne ne correspond aux filtres pour les profils de densité."
      },
      "ridgeline": {
        "description": "Crêtes de densité superposées comparant une colonne numérique entre groupes ordonnés.",
        "emptyTitle": "Aucune crête à tracer",
        "emptyBody": "Aucune ligne ne correspond aux filtres pour les profils de densité."
      },
      "scatterBubble": {
        "description": "Deux colonnes numériques en points, avec une taille de bulle et une ligne de tendance en option.",
        "emptyTitle": "Aucun point à tracer",
        "emptyBody": "Aucune ligne ne correspond aux filtres pour les colonnes choisies."
      },
      "hexbin": {
        "description": "Densité hexagonale de deux colonnes numériques, teintée selon le nombre de lignes par tuile.",
        "emptyTitle": "Aucune densité à tracer",
        "emptyBody": "Aucune ligne ne correspond aux filtres à regrouper."
      },
      "correlationMatrix": {
        "description": "Corrélation de Pearson entre colonnes numériques choisies, du fortement positif au fortement négatif.",
        "emptyTitle": "Rien à corréler",
        "emptyBody": "Choisissez au moins deux colonnes numériques avec des lignes correspondantes."
      },
      "parallelCoordinates": {
        "description": "Chaque enregistrement en ligne sur plusieurs axes numériques normalisés, coloré par catégorie.",
        "emptyTitle": "Aucun enregistrement à tracer",
        "emptyBody": "Aucune ligne ne correspond aux filtres sur les axes choisis."
      }
    },
    "feeds": {
      "activityFeed": {
        "description": "Un fil continu de qui a fait quoi dans votre espace de travail, du plus récent au plus ancien.",
        "emptyTitle": "Aucune activité récente",
        "emptyBody": "Les actions de votre espace de travail apparaîtront ici."
      },
      "notificationFeed": {
        "description": "Notifications groupées avec état non lu, filtres et actions intégrées.",
        "emptyTitle": "Aucune notification",
        "emptyBody": "Les nouvelles notifications apparaîtront ici."
      },
      "realtimeFeed": {
        "description": "Un flux d’événements en direct qui ajoute les nouveaux éléments en tête.",
        "emptyTitle": "En attente d’événements",
        "emptyBody": "Les événements en direct s’afficheront au fur et à mesure."
      },
      "timelineVertical": {
        "description": "Une chronologie verticale d’événements, de versions, d’incidents ou d’étapes d’exécution.",
        "emptyTitle": "Rien pour l’instant",
        "emptyBody": "Les événements apparaîtront sur cette chronologie au fur et à mesure."
      },
      "unreadBadge": {
        "description": "Une pastille de comptage des éléments non lus, synchronisée avec le fil.",
        "unitLabel": "non lus"
      }
    },
    "calendar": {
      "calendarMonth": {
        "description": "Une grille mensuelle des événements planifiés avec des puces par jour et la navigation entre les mois.",
        "emptyTitle": "Rien de planifié",
        "emptyBody": "Les événements planifiés apparaîtront dans ce calendrier."
      },
      "dayAgenda": {
        "description": "Les événements du jour sélectionné sous forme d'agenda chronologique.",
        "emptyTitle": "Rien de planifié",
        "emptyBody": "Les événements du jour sélectionné apparaîtront ici."
      },
      "scheduleMatrix": {
        "description": "Une grille de postes par ressource et par jour avec la couverture quotidienne et une légende.",
        "emptyTitle": "Aucun poste planifié",
        "emptyBody": "Les postes attribués apparaîtront dans ce planning."
      },
      "capacityBoard": {
        "description": "Des barres d'utilisation par membre avec une répartition par projet et un statut de charge.",
        "emptyTitle": "Aucune donnée de charge",
        "emptyBody": "L'utilisation des membres apparaîtra ici une fois les affectations créées."
      }
    },
    "tables": {
      "masterList": {
        "description": "Une liste sélectionnable d’enregistrements qui pilote un volet de détail.",
        "emptyTitle": "Aucun élément",
        "emptyBody": "Les éléments apparaîtront ici une fois créés."
      },
      "logTable": {
        "description": "Un journal d’événements avec recherche, filtre d’erreurs et actions par ligne.",
        "emptyTitle": "Aucune entrée de journal",
        "emptyBody": "Les événements seront enregistrés ici au fur et à mesure."
      },
      "cardGallery": {
        "description": "Une galerie responsive de cartes d’entités avec statut et actions rapides.",
        "emptyTitle": "Rien à afficher",
        "emptyBody": "Les éléments apparaîtront ici sous forme de cartes."
      },
      "groupedSummaryTable": {
        "description": "Lignes groupées avec colonnes d’agrégats, détails dépliables et totaux.",
        "emptyTitle": "Aucune donnée de synthèse",
        "emptyBody": "Les totaux groupés apparaîtront ici dès qu’il y aura des données."
      },
      "schemaTree": {
        "description": "Un explorateur de schémas, tables et colonnes avec badges de type et de clé.",
        "emptyTitle": "Aucun schéma analysé",
        "emptyBody": "Connectez une base de données pour explorer son schéma ici."
      },
      "toggleMatrix": {
        "description": "Une grille interactive de bascules booléennes pour rôles, règles ou canaux.",
        "emptyTitle": "Aucune matrice configurée",
        "emptyBody": "Les lignes et colonnes apparaîtront ici une fois configurées."
      }
    },
    "boards": {
      "kanbanBoard": {
        "description": "Colonnes de statut fixes avec des cartes déplaçables ; faites glisser une carte vers une autre colonne pour changer son statut.",
        "emptyTitle": "Aucune carte pour l'instant",
        "emptyBody": "Les cartes apparaîtront dans leurs colonnes de statut à mesure que des enregistrements sont créés."
      },
      "kanbanSwimlaneGrid": {
        "description": "Une grille couloirs × colonnes ; déplacer une carte réaffecte à la fois son couloir et son statut.",
        "emptyTitle": "Aucun couloir à afficher",
        "emptyBody": "Regroupez les enregistrements par un champ de couloir et un champ de statut pour construire la grille."
      },
      "addCard": "Ajouter une carte",
      "grip": "Glisser pour déplacer la carte",
      "pointsUnit": "pts",
      "laneSummary": "Σ{points} pts · {count}",
      "a11y": {
        "grabbed": "{title} saisie. Utilisez les flèches pour déplacer, Entrée pour déposer, Échap pour annuler.",
        "over": "{title} est au-dessus de {cell}.",
        "moved": "{title} déplacée vers {cell}.",
        "returned": "{title} est revenue à sa position d'origine.",
        "failed": "Impossible de déplacer {title} ; elle est revenue à sa position d'origine."
      }
    }
  },
  "grid": {
    "dragHandle": "Faire glisser pour déplacer {title}",
    "resizeHandle": "Redimensionner {title}",
    "a11y": {
      "grabbed": "{title} saisi. Utilisez les touches fléchées pour déplacer, maintenez Maj pour redimensionner, Entrée pour enregistrer, Échap pour annuler.",
      "moved": "{title} déplacé vers la colonne {col}, ligne {row}.",
      "resized": "{title} redimensionné à {w} colonnes sur {h} lignes.",
      "committed": "{title} placé à la colonne {col}, ligne {row}.",
      "reverted": "{title} remis à sa position initiale."
    }
  }
} as const;
