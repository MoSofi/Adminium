// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/reportBuilder.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "block": {
    "approval": {
      "approved": "Approuvé",
      "label": "Approbation",
      "pending": "En attente",
      "rejected": "Refusé"
    },
    "attachments": {
      "label": "Pièces jointes"
    },
    "bar": {
      "label": "Graphique à barres"
    },
    "contact": {
      "label": "Contact"
    },
    "delivery": {
      "current": "En cours",
      "done": "Terminé",
      "label": "Chronologie de livraison",
      "todo": "En attente"
    },
    "discount": {
      "label": "Codes de remise"
    },
    "divider": {
      "label": "Séparateur"
    },
    "heading": {
      "label": "Titre"
    },
    "image": {
      "label": "Image"
    },
    "kpi": {
      "label": "Ligne de KPI"
    },
    "latefees": {
      "label": "Pénalités de retard",
      "sentence": "Des pénalités de {rate} par mois s’appliquent aux soldes impayés depuis plus de {days, plural, one {# jour} other {# jours}}.",
      "title": "Pénalité de retard"
    },
    "legal": {
      "label": "Mentions légales"
    },
    "line": {
      "label": "Graphique linéaire"
    },
    "loyalty": {
      "balance": "{balance} pts · {level}",
      "earned": "+{earned}",
      "eyebrow": "Solde de fidélité",
      "label": "Points de fidélité"
    },
    "multicurrency": {
      "label": "Multidevise"
    },
    "payhistory": {
      "failed": "Échoué",
      "label": "Historique des paiements",
      "paid": "Payé",
      "pending": "En attente"
    },
    "poterms": {
      "label": "Conditions de commande"
    },
    "qr": {
      "hint": "Pointez votre caméra pour ouvrir la version en ligne.",
      "label": "QR de paiement"
    },
    "recurring": {
      "freq": {
        "annually": "Annuel",
        "monthly": "Mensuel",
        "quarterly": "Trimestriel",
        "weekly": "Hebdomadaire"
      },
      "label": "Récurrent",
      "sub": "Prochain le {next} · {count}",
      "title": "Récurrent — {freq}"
    },
    "refund": {
      "label": "Politique de remboursement"
    },
    "signature": {
      "dateSigned": "Date de signature",
      "label": "Signature"
    },
    "table": {
      "label": "Tableau"
    },
    "taxbreak": {
      "label": "Détail des taxes"
    },
    "terms": {
      "label": "Conditions"
    },
    "text": {
      "label": "Texte"
    }
  },
  "canvas": {
    "blockTitle": "Titre du bloc",
    "deleteBlock": "Supprimer le bloc",
    "drag": "Faire glisser pour réorganiser",
    "empty": "Ajoutez un bloc depuis la gauche pour commencer.",
    "kicker": "Surtitre",
    "moveDown": "Descendre",
    "moveUp": "Monter",
    "selectBlock": "Modifier {label}",
    "selectHeader": "Modifier l’en-tête du rapport",
    "subtitle": "Sous-titre",
    "title": "Titre du rapport"
  },
  "card": {
    "delete": "Supprimer",
    "duplicate": "Dupliquer",
    "edit": "Modifier",
    "meta": {
      "blocks": "{count, plural, one {# bloc} other {# blocs}}",
      "kickerBlocks": "{kicker} · {blocks}"
    },
    "rename": "Renommer",
    "renameLabel": "Nouveau nom",
    "sub": "{title} · {blocks}"
  },
  "category": {
    "engineering": "Ingénierie",
    "finance": "Finance",
    "growth": "Croissance",
    "leadership": "Direction",
    "operations": "Opérations",
    "product": "Produit",
    "revenue": "Revenus",
    "success": "Réussite client"
  },
  "delete": {
    "body": {
      "report": "Cette action est irréversible. Le rapport sera définitivement supprimé.",
      "template": "Cette action est irréversible. Le modèle sera définitivement supprimé."
    },
    "confirm": "Supprimer",
    "title": "Supprimer {name} ?"
  },
  "editor": {
    "delete": "Supprimer",
    "discard": {
      "body": "Vos modifications sur {name} seront perdues.",
      "leave": "Abandonner",
      "stay": "Continuer à modifier",
      "title": "Abandonner les modifications non enregistrées ?"
    },
    "duplicate": "Dupliquer",
    "kind": {
      "report": "Rapport",
      "template": "Modèle"
    },
    "loadFailed": "Impossible de charger ce document",
    "nameLabel": "Nom",
    "primary": {
      "report": "Publier",
      "template": "Enregistrer le modèle"
    },
    "redo": "Rétablir",
    "saveState": {
      "dirty": "Modifications non enregistrées",
      "error": "Échec de l’enregistrement",
      "saved": "Toutes les modifications sont enregistrées",
      "saving": "Enregistrement…"
    },
    "shortcutSave": "Enregistrer le document",
    "undo": "Annuler"
  },
  "empty": {
    "noMatch": {
      "body": "Essayez un autre terme de recherche.",
      "reports": "Aucun rapport correspondant",
      "templates": "Aucun modèle correspondant"
    },
    "reports": {
      "body": "Créez votre premier rapport à partir d’un modèle ou d’une page vierge.",
      "title": "Aucun rapport pour l’instant"
    },
    "templates": {
      "body": "Créez une mise en page de rapport réutilisable pour votre équipe.",
      "title": "Aucun modèle pour l’instant"
    }
  },
  "inspector": {
    "accent": "Couleur d’accent",
    "addCode": "Ajouter un code",
    "addCurrency": "Ajouter une devise",
    "addFile": "Ajouter un fichier",
    "addMetric": "Ajouter une mesure",
    "addPayment": "Ajouter un paiement",
    "addPoint": "Ajouter un point",
    "addRow": "Ajouter une ligne",
    "addStep": "Ajouter une étape",
    "addTaxLine": "Ajouter une ligne de taxe",
    "amount": "Montant",
    "approverName": "Nom de l’approbateur",
    "approverTitle": "Rôle / fonction",
    "background": "Image de fond",
    "backgroundHint": "Ajoute un fond pleine page derrière tout le rapport — parfait pour un papier à en-tête ou un filigrane.",
    "backgroundOverlay": "Superposition {pct} %",
    "backgroundRemove": "Supprimer",
    "backgroundReplace": "Remplacer",
    "backgroundTooLarge": "Choisissez une image de moins de {max}.",
    "backgroundUpload": "Importer un fond",
    "baseAmount": "Montant de base",
    "block": {
      "hint": "Contenu et réglages du bloc"
    },
    "blockImage": "Image",
    "blockImageUpload": "Importer une image",
    "blockTitle": "Titre du bloc",
    "caption": "Légende",
    "checkboxLabel": "Libellé de la case à cocher",
    "code": "CODE",
    "contactName": "Nom du contact",
    "currencies": "Devises et taux",
    "dataPoints": "Points de données",
    "date": "Date",
    "deleteBlock": "Supprimer le bloc",
    "description": "Description",
    "discountCodes": "Codes de remise",
    "email": "E-mail",
    "fileName": "Nom du fichier {n}",
    "fileSize": "Taille du fichier {n}",
    "files": "Fichiers",
    "frequency": "Fréquence",
    "fxCode": "Code de devise {n}",
    "fxRate": "Taux {n}",
    "fxSymbol": "Symbole de devise {n}",
    "gracePeriod": "Délai de grâce",
    "gracePeriodUnit": "jours",
    "header": {
      "hint": "Titre, surtitre et thème",
      "title": "En-tête du rapport"
    },
    "kicker": "Surtitre",
    "lateRate": "Taux de pénalité",
    "lateRateUnit": "% par mois",
    "legalFooter": "Mentions légales",
    "level": "Niveau",
    "method": "Moyen de paiement",
    "metric": {
      "delta": "Variation",
      "label": "Libellé",
      "value": "Valeur"
    },
    "metrics": "Mesures",
    "nextDate": "Prochaine date",
    "none": {
      "body": "Cliquez sur un bloc de la page pour en modifier le contenu et les réglages ici.",
      "select": "Sélectionner un bloc",
      "title": "Rien de sélectionné"
    },
    "payments": "Paiements",
    "phone": "Téléphone",
    "placeholderCaption": "Légende de l’espace réservé",
    "poTerms": "Conditions de la commande",
    "pointsBalance": "Solde de points",
    "pointsEarned": "Points gagnés",
    "prechecked": "Pré-cochée",
    "precheckedHint": "Afficher la case déjà cochée",
    "refundPolicy": "Politique de remboursement",
    "remove": "Supprimer {noun} {n}",
    "reportTitle": "Titre du rapport",
    "rowCellA": "Ligne {n}, première colonne",
    "rowCellB": "Ligne {n}, deuxième colonne",
    "rowField": "{label} {n}",
    "rows": "Lignes",
    "scheduleNote": "Note sur la planification",
    "show": "Afficher dans l’export",
    "showHint": "Inclure lors de la publication",
    "signatoryName": "Nom du signataire",
    "signatoryTitle": "Titre / fonction",
    "status": "Statut",
    "stepLabel": "Étape {n}",
    "steps": "Étapes",
    "subtitle": "Sous-titre",
    "taxComponents": "Composantes de taxe",
    "taxLabel": "Libellé de taxe {n}",
    "text": "Texte",
    "width": "Largeur",
    "widthFull": "Pleine",
    "widthHalf": "Demi"
  },
  "list": {
    "actions": "Actions",
    "name": "Nom",
    "status": "Statut",
    "updated": "Mis à jour"
  },
  "manager": {
    "layout": {
      "gallery": "Galerie",
      "label": "Disposition",
      "list": "Liste"
    },
    "loadFailed": "Impossible de charger les rapports",
    "search": {
      "clear": "Effacer la recherche",
      "reports": "Rechercher des rapports…",
      "templates": "Rechercher des modèles…"
    },
    "subtitle": "Des mises en page de rapport réutilisables et les rapports que vous en tirez.",
    "tabs": {
      "label": "Type",
      "reports": "Rapports",
      "templates": "Modèles"
    },
    "title": "Rapports",
    "untitled": "Sans titre"
  },
  "new": {
    "blank": {
      "body": "Partir de zéro",
      "title": "Rapport vierge"
    },
    "report": "Nouveau rapport",
    "starterMeta": "{category} · {blocks}",
    "startersFailed": "Impossible de charger les modèles. Commencez à vide ou réessayez.",
    "subtitle": "Partez d’une page vierge ou d’une mise en page de rapport prête à l’emploi.",
    "template": "Nouveau modèle",
    "title": {
      "report": "Nouveau rapport",
      "template": "Nouveau modèle"
    },
    "yourTemplates": "Vos modèles"
  },
  "palette": {
    "add": "Ajouter {label}",
    "title": "Ajouter un bloc"
  },
  "seed": {
    "apprTitle": "Responsable du rapport",
    "contactName": "Orchard Lane Studio",
    "discountLabel": "10 % de crédit de bienvenue",
    "heading": "Nouveau titre",
    "imageCaption": "espace réservé à l’image",
    "legalText": "Ce rapport est fourni à titre informatif. Les chiffres ne sont pas audités et peuvent être révisés.",
    "loyLevel": "Or",
    "metric": "Mesure",
    "new": "Nouveau",
    "newCode": "NOUVEAUCODE",
    "newDiscount": "Nouvelle remise",
    "newFile": "Nouveau fichier.pdf",
    "newStep": "Nouvelle étape",
    "newTax": "Nouvelle taxe",
    "paragraph": "Nouveau paragraphe — cliquez pour modifier ce texte.",
    "poTerms": "Ce rapport est publié dans le cadre de l’accord de reporting standard. Les chiffres sont provisoires jusqu’à finalisation.",
    "qrCaption": "Scannez pour ouvrir le rapport en ligne",
    "refText": "Un remboursement intégral est possible dans les 30 jours suivant l’achat. Contactez le support pour lancer un retour.",
    "sigTitle": "Préparé par",
    "step": {
      "delivered": "Livré",
      "ordered": "Commandé",
      "processing": "En préparation",
      "shipped": "Expédié"
    },
    "table": {
      "column": "Colonne",
      "row": "Ligne {n}",
      "value": "Valeur"
    },
    "taxCity": "Taxe municipale (2 %)",
    "taxState": "Taxe régionale (6 %)",
    "termsLabel": "J’approuve ce rapport et son contenu."
  },
  "starter": {
    "board": "Présentation au conseil",
    "campaign": "Bilan de campagne",
    "exec": "Synthèse de direction",
    "finance": "État financier",
    "health": "Santé client",
    "incident": "Post-mortem d’incident",
    "marketing": "Rapport marketing",
    "mbr": "Revue mensuelle d’activité",
    "product": "Analytique produit",
    "sales": "Rapport commercial",
    "scorecard": "Tableau de bord KPI",
    "weekly": "Résumé hebdomadaire"
  },
  "status": {
    "draft": "Brouillon",
    "live": "En ligne",
    "sent": "Publié"
  },
  "toast": {
    "createFailed": "Impossible de créer le document",
    "deleteFailed": "Suppression impossible",
    "duplicateFailed": "Duplication impossible",
    "duplicated": "{name} dupliqué",
    "imageUnreadable": "Impossible de lire ce fichier",
    "notAnImage": "Ce fichier n’est pas une image",
    "published": "{name} publié",
    "renameFailed": "Renommage impossible",
    "saveFailed": "Impossible d’enregistrer {name}",
    "undo": "Annuler"
  }
} as const;
