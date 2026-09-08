// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/invoices.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "add": {
    "allOn": "Tous les blocs standard figurent déjà sur cette facture.",
    "custom": "Créer la vôtre",
    "standard": "Blocs standard",
    "subtitle": "Créez la vôtre, ou activez l’un des blocs standard.",
    "title": "Ajouter une section"
  },
  "canvas": {
    "addSection": "Ajouter une section",
    "approval": {
      "approved": "Approuvé",
      "pending": "En attente",
      "rejected": "Refusé",
      "title": "Approbation"
    },
    "attachments": "Pièces jointes",
    "blocks": {
      "parties": "Émetteur et destinataire",
      "paynotes": "Paiement et notes"
    },
    "brandName": "Nom de la marque",
    "brandingHint": "Identité visuelle · cliquez pour modifier",
    "contact": "Des questions ? Contactez-nous",
    "custom": {
      "addRow": "Ajouter une ligne",
      "body": "Corps de la section",
      "caption": "Légende",
      "clearImage": "Supprimer l’image",
      "clearSlot": "Supprimer",
      "clearSlotOf": "Supprimer l’image {n}",
      "remove": "Supprimer la section",
      "removeOf": "Supprimer la section : {title}",
      "removeRow": "Supprimer la ligne",
      "removeRowOf": "Supprimer la ligne {n}",
      "rowLabel": "Étiquette de la ligne {n}",
      "rowValue": "Valeur de la ligne {n}",
      "titleLabel": "Titre de la section",
      "upload": "Cliquez pour téléverser une image",
      "uploadSlot": "Téléverser l’image {n}"
    },
    "customerName": "Nom du client",
    "dateSigned": "Date de signature",
    "delivery": {
      "title": "Suivi de livraison"
    },
    "discount": {
      "title": "Codes de remise"
    },
    "due": "Échéance",
    "from": "Émetteur",
    "insertAbove": "Ajouter une section au-dessus de {label}",
    "insertHere": "Ajouter une section ici",
    "invoiceTo": "Facturer à",
    "issued": "Émission",
    "items": {
      "add": "Ajouter une ligne",
      "amount": "Montant",
      "description": "Description",
      "descriptionOf": "Description de la ligne {n}",
      "qty": "Qté",
      "qtyOf": "Quantité de la ligne {n}",
      "rate": "P.U.",
      "rateOf": "Prix unitaire de la ligne {n}",
      "remove": "Supprimer la ligne : {name}",
      "reorder": "Faites glisser pour réorganiser",
      "reorderOf": "Faites glisser pour réorganiser : {name}",
      "row": "Ligne de facture {n}"
    },
    "latefees": {
      "sentence": "Des pénalités de retard de {rate} % par mois s’appliquent aux soldes impayés plus de {days} jours après la date d’échéance.",
      "title": "Pénalités de retard"
    },
    "legal": "Mentions légales",
    "lines": {
      "customer": "Ligne client {n}",
      "from": "Ligne émetteur {n}",
      "payment": "Ligne paiement {n}",
      "ship": "Ligne livraison {n}"
    },
    "loyalty": {
      "balance": "{balance} pts · {level}",
      "title": "Solde de fidélité"
    },
    "multicurrency": {
      "note": "Converti depuis {total} à des taux indicatifs.",
      "title": "Également payable en"
    },
    "notes": "Notes",
    "payhistory": {
      "title": "Historique des paiements"
    },
    "payment": "Paiement",
    "poNumber": "N° de bon de commande",
    "poTerms": "Conditions du bon de commande",
    "qr": {
      "due": "Montant dû · {total}",
      "title": "Payer par QR"
    },
    "recurring": {
      "next": "Prochaine le {next} · {count}",
      "title": "Récurrent — {freq}"
    },
    "refund": "Politique de remboursement",
    "reorderSection": "Faites glisser pour réorganiser la section",
    "reorderSectionOf": "Faites glisser pour réorganiser la section : {label}",
    "select": "Modifier {label}",
    "shipName": "Nom du destinataire",
    "shipTo": "Livrer à",
    "sigName": "Nom du signataire",
    "sigTitle": "Fonction du signataire",
    "signature": "Signature",
    "taxbreak": {
      "title": "Détail des taxes"
    },
    "terms": "Conditions",
    "termsAccepted": "Conditions acceptées",
    "termsLabel": "Libellé des conditions",
    "totals": {
      "discount": "Remise ({rate})",
      "subtotal": "Sous-total",
      "tax": "Taxe ({rate})",
      "total": "Total"
    }
  },
  "card": {
    "delete": "Supprimer",
    "duplicate": "Dupliquer",
    "edit": "Modifier",
    "rename": "Renommer",
    "renameLabel": "Nouveau nom",
    "total": "TOTAL"
  },
  "custom": {
    "gallery": {
      "hint": "Deux ou trois images côte à côte",
      "label": "Rangée d’images"
    },
    "image": {
      "hint": "Téléversez une photo, un dessin ou un certificat",
      "label": "Bloc image"
    },
    "kv": {
      "hint": "Paires étiquette / valeur",
      "label": "Lignes de détail"
    },
    "text": {
      "hint": "Votre propre texte — notes, périmètre, conditions",
      "label": "Section de texte"
    }
  },
  "delete": {
    "body": {
      "invoice": "Cette action est irréversible. La facture sera définitivement supprimée.",
      "template": "Cette action est irréversible. Le modèle sera définitivement supprimé."
    },
    "confirm": "Supprimer",
    "title": "Supprimer {name} ?"
  },
  "editor": {
    "delete": "Supprimer",
    "discard": {
      "body": "Vos modifications de {name} seront perdues.",
      "confirm": "Abandonner",
      "keep": "Continuer l’édition",
      "title": "Abandonner les modifications non enregistrées ?"
    },
    "duplicate": "Dupliquer",
    "images": "Images",
    "kind": {
      "invoice": "Facture",
      "template": "Modèle"
    },
    "loadFailed": "Impossible de charger ce document",
    "nameLabel": "Nom",
    "redo": "Rétablir",
    "saveFailed": "Enregistrement impossible",
    "saveInvoice": "Enregistrer la facture",
    "saveState": {
      "dirty": "Modifications non enregistrées",
      "error": "Enregistrement impossible",
      "saved": "Toutes les modifications sont enregistrées",
      "saving": "Enregistrement…"
    },
    "saveTemplate": "Enregistrer le modèle",
    "sendInvoice": "Envoyer la facture",
    "shortcutSave": "Enregistrer le document",
    "undo": "Annuler"
  },
  "empty": {
    "invoices": {
      "body": "Composez votre première facture à partir d’un modèle ou d’une page vierge.",
      "title": "Aucune facture pour l’instant"
    },
    "noMatch": {
      "body": "Essayez un autre terme de recherche.",
      "invoices": "Aucune facture ne correspond",
      "templates": "Aucun modèle ne correspond"
    },
    "templates": {
      "body": "Créez un modèle de facture réutilisable à partir duquel votre équipe peut travailler.",
      "title": "Aucun modèle pour l’instant"
    }
  },
  "inspector": {
    "addLine": "Ajouter une ligne",
    "approval": {
      "name": "Nom de l’approbateur",
      "status": {
        "approved": "Approuvé",
        "pending": "En attente",
        "rejected": "Refusé"
      },
      "statusLabel": "Statut",
      "title": "Rôle / fonction"
    },
    "attachments": {
      "add": "Ajouter un fichier",
      "files": "Fichiers",
      "name": "Nom du fichier {n}",
      "removeRow": "Supprimer le fichier {n}",
      "seedName": "Nouveau fichier.pdf",
      "size": "Taille du fichier {n}"
    },
    "branding": {
      "accentHintAfter": "et thème.",
      "accentHintBefore": "Modifiez la couleur d’accentuation dans la section",
      "accentHintBold": "Titre",
      "brandName": "Nom de la marque",
      "logoImage": "Image du logo",
      "logoMark": "Monogramme",
      "logoNoteAfter": "dans la barre d’outils.",
      "logoNoteBefore": "Un logo téléversé remplace le monogramme ci-dessus. Toutes les images fixes se trouvent sous",
      "logoNoteBold": "Images",
      "removeLogo": "Supprimer",
      "uploadLogo": "Téléverser un logo"
    },
    "contact": {
      "email": "E-mail",
      "name": "Nom du contact",
      "phone": "Téléphone"
    },
    "custom": {
      "addRow": "Ajouter une ligne",
      "body": "Corps du texte",
      "caption": "Légende",
      "galleryHint": "Cliquez sur chaque emplacement de la facture pour téléverser une image.",
      "height": "Hauteur",
      "image": "Image",
      "remove": "Supprimer la section",
      "title": "Titre de la section",
      "upload": "Téléverser / remplacer"
    },
    "customer": {
      "addressContact": "Adresse et contact",
      "clientName": "Nom du client"
    },
    "delivery": {
      "add": "Ajouter une étape",
      "cycle": "Statut de l’étape {n} : {status}",
      "label": "Étape {n}",
      "note": "Appuyez sur le statut pour faire défiler En attente → En cours → Terminé.",
      "removeRow": "Supprimer l’étape {n}",
      "seedLabel": "Nouvelle étape",
      "status": {
        "current": "En cours",
        "done": "Terminé",
        "todo": "En attente"
      },
      "steps": "Étapes"
    },
    "discount": {
      "add": "Ajouter un code",
      "amount": "Montant du code {n}",
      "code": "Code {n}",
      "codePlaceholder": "CODE",
      "codes": "Codes de remise",
      "label": "Description du code {n}",
      "labelPlaceholder": "Description",
      "removeRow": "Supprimer le code {n}",
      "seedLabel": "Nouvelle remise"
    },
    "fallback": {
      "title": "Modifier"
    },
    "from": {
      "companyDetails": "Coordonnées de l’entreprise"
    },
    "images": {
      "addSection": "Ajouter une section image",
      "background": "Fond",
      "backgroundHint": "Filigrane derrière la facture",
      "intro": "Des images fixes qui accompagnent la facture. Téléversez-les une fois et tous les documents issus de ce modèle les conservent.",
      "logo": "Logo",
      "logoHint": "Remplace le monogramme",
      "qr": "Code QR",
      "qrHint": "Affiché dans le bloc QR de paiement",
      "remove": "Supprimer",
      "replace": "Remplacer",
      "signature": "Signature",
      "signatureHint": "Image de signature numérisée",
      "stamp": "Tampon / sceau",
      "stampHint": "Tampon de paiement ou d’approbation",
      "upload": "Téléverser",
      "uploadSlot": "Téléverser {label}"
    },
    "items": {
      "add": "Ajouter une ligne",
      "count": "Lignes de facture",
      "hint": "Modifiez n’importe quelle cellule directement sur la facture, ou faites glisser la poignée pour réorganiser.",
      "subtotal": "Sous-total"
    },
    "latefees": {
      "grace": "Délai de grâce",
      "graceUnit": "jours",
      "rate": "Taux de pénalité",
      "rateUnit": "% par mois"
    },
    "legal": {
      "footer": "Mentions légales"
    },
    "line": "{label} {n}",
    "loyalty": {
      "balance": "Solde de points",
      "earned": "Points gagnés",
      "level": "Niveau"
    },
    "meta": {
      "due": "Date d’échéance",
      "issued": "Date d’émission",
      "number": "Numéro de facture",
      "poNumber": "N° de bon de commande",
      "terms": "Conditions de paiement"
    },
    "multicurrency": {
      "add": "Ajouter une devise",
      "code": "Code de la devise {n}",
      "note": "Le taux est multiplié par le total de la facture. Code, symbole, puis taux.",
      "rate": "Taux de la devise {n}",
      "rates": "Devises et taux",
      "removeRow": "Supprimer la devise {n}",
      "symbol": "Symbole de la devise {n}"
    },
    "notes": {
      "footerNotes": "Notes de bas de page",
      "hint": "Affichées en bas de la facture — conditions, remerciements ou mentions légales."
    },
    "payhistory": {
      "add": "Ajouter un paiement",
      "amount": "Montant du paiement {n}",
      "amountPlaceholder": "Montant",
      "date": "Date du paiement {n}",
      "datePlaceholder": "Date",
      "method": "Moyen du paiement {n}",
      "methodPlaceholder": "Moyen",
      "payments": "Paiements",
      "removeRow": "Supprimer le paiement {n}"
    },
    "payment": {
      "instructions": "Instructions de paiement"
    },
    "poterms": {
      "terms": "Conditions du bon de commande"
    },
    "qr": {
      "caption": "Légende",
      "hint": "Encode Montant dû · {total}. Le code affiché est l’image que vous téléversez sous Images."
    },
    "recurring": {
      "annually": "Chaque année",
      "frequency": "Fréquence",
      "monthly": "Chaque mois",
      "next": "Prochaine émission",
      "note": "Note de récurrence",
      "quarterly": "Chaque trimestre",
      "weekly": "Chaque semaine"
    },
    "refund": {
      "policy": "Politique de remboursement"
    },
    "removeLine": "Supprimer {label} {n}",
    "removeSection": "Supprimer la section",
    "shipto": {
      "addressLines": "Lignes d’adresse",
      "name": "Nom du destinataire"
    },
    "signature": {
      "hint": "Une ligne de signature et un champ de date apparaissent sur la facture pour une signature manuscrite.",
      "name": "Nom du signataire",
      "title": "Fonction / rôle"
    },
    "tax": {
      "discount": "Remise",
      "discountRow": "Remise",
      "subtotal": "Sous-total",
      "tax": "Taxe",
      "taxRate": "Taux de taxe",
      "total": "Total"
    },
    "taxbreak": {
      "add": "Ajouter une ligne de taxe",
      "components": "Composantes de la taxe",
      "label": "Libellé de la ligne de taxe {n}",
      "note": "Chaque taux s’applique au sous-total, après remise éventuelle.",
      "rate": "Taux de la ligne de taxe {n}",
      "removeRow": "Supprimer la ligne de taxe {n}",
      "seedLabel": "Nouvelle taxe"
    },
    "terms": {
      "checkboxLabel": "Libellé de la case",
      "preChecked": "Cochée par défaut",
      "preCheckedHint": "Afficher la case déjà cochée"
    },
    "theme": {
      "accentColour": "Couleur d’accentuation",
      "backgroundHint": "Ajoute une image pleine page derrière toute la facture — idéale pour un papier à en-tête ou un filigrane.",
      "backgroundImage": "Image de fond",
      "currency": "Devise",
      "documentTitle": "Titre du document",
      "language": "Langue",
      "languageNote": "Utilisez le bouton de langue de la barre d’outils pour créer une variante liée, au lieu de changer la langue de ce document.",
      "overlay": "Voile {pct} %",
      "overlayLabel": "Voile",
      "removeBackground": "Supprimer",
      "replaceBackground": "Remplacer",
      "showDecimals": "Afficher les décimales",
      "showDecimalsHint": "p. ex. 290,00 $ contre 290 $",
      "status": {
        "draft": "Brouillon",
        "live": "En ligne",
        "overdue": "En retard",
        "paid": "Payée",
        "sent": "Envoyée"
      },
      "statusLabel": "Statut",
      "topic": {
        "logistics": "Expédition et logistique",
        "other": "Sans catégorie",
        "receipts": "Reçus et remboursements",
        "recurring": "Récurrent",
        "sales": "Ventes et devis",
        "services": "Services professionnels"
      },
      "topicLabel": "Sujet",
      "uploadBackground": "Téléverser un fond"
    }
  },
  "languages": {
    "de": "Allemand",
    "en": "Anglais",
    "es": "Espagnol",
    "footnote": "Créer une langue génère une copie liée, regroupée sous le même sujet.",
    "fr": "Français",
    "ja": "Japonais",
    "pt": "Portugais",
    "state": {
      "create": "Créer",
      "editing": "En cours d’édition",
      "open": "Ouvrir"
    },
    "title": "Variantes linguistiques"
  },
  "list": {
    "actions": "Actions",
    "name": "Nom",
    "status": "Statut",
    "updated": "Mis à jour"
  },
  "manager": {
    "group": {
      "documents": "{count, plural, one {# document} other {# documents}}",
      "label": "Grouper par",
      "language": "Langue",
      "languages": "{count, plural, one {# langue} other {# langues}}",
      "none": "Aucun",
      "topic": "Sujet"
    },
    "layout": {
      "gallery": "Galerie",
      "label": "Affichage",
      "list": "Liste"
    },
    "loadFailed": "Impossible de charger les factures",
    "search": {
      "clear": "Effacer la recherche",
      "invoices": "Rechercher des factures…",
      "templates": "Rechercher des modèles…"
    },
    "subtitle": "Des modèles réutilisables et les factures que vous créez à partir de ceux-ci.",
    "tabs": {
      "invoices": "Factures",
      "label": "Type",
      "templates": "Modèles"
    },
    "title": "Factures",
    "untitled": "Sans titre"
  },
  "new": {
    "blank": "Facture vierge",
    "blankHint": "Partir de zéro",
    "category": {
      "adjustments": "Ajustements",
      "business": "Entreprise",
      "nonprofit": "Associations",
      "payments": "Paiements",
      "projects": "Projets",
      "recurring": "Récurrent",
      "sales": "Ventes",
      "services": "Services",
      "shipping": "Expédition"
    },
    "failed": "Création impossible",
    "invoice": "Nouvelle facture",
    "startersFailed": "Les modèles de départ n’ont pas pu être chargés. Partez de zéro ou réessayez.",
    "subtitle": "Partez d’une page vierge ou d’un modèle prêt à l’emploi.",
    "template": "Nouveau modèle",
    "yourTemplates": "Vos modèles"
  },
  "optional": {
    "approvalShow": "Approbation",
    "attachShow": "Pièces jointes",
    "conShow": "Contact",
    "delShow": "Suivi de livraison",
    "discShow": "Codes de remise",
    "lateShow": "Pénalités de retard",
    "legalShow": "Mentions légales",
    "loyShow": "Points de fidélité",
    "mcShow": "Multidevise",
    "payhShow": "Historique des paiements",
    "poShow": "Conditions de commande",
    "qrShow": "QR de paiement",
    "recurShow": "Récurrent",
    "refShow": "Politique de remboursement",
    "shipShow": "Livrer à",
    "sigShow": "Signature",
    "taxbShow": "Détail des taxes",
    "termsShow": "Acceptation des conditions"
  },
  "section": {
    "approval": {
      "hint": "État de la validation",
      "title": "Approbation"
    },
    "attachments": {
      "hint": "Fichiers joints",
      "title": "Pièces jointes"
    },
    "branding": {
      "hint": "Logo et nom de marque",
      "title": "Identité visuelle"
    },
    "contact": {
      "hint": "Coordonnées d’assistance",
      "title": "Contact"
    },
    "custom": {
      "hint": "Votre propre section",
      "title": "Section personnalisée"
    },
    "customer": {
      "hint": "Coordonnées du client",
      "title": "Facturer à"
    },
    "delivery": {
      "hint": "État de la préparation",
      "title": "Suivi de livraison"
    },
    "discount": {
      "hint": "Codes promo appliqués",
      "title": "Codes de remise"
    },
    "from": {
      "hint": "Les coordonnées de votre entreprise",
      "title": "Émetteur"
    },
    "images": {
      "hint": "Logo, fond, QR et photos",
      "title": "Images"
    },
    "items": {
      "hint": "Produits et services",
      "title": "Lignes de facture"
    },
    "latefees": {
      "hint": "Pénalité de retard",
      "title": "Pénalités de retard"
    },
    "legal": {
      "hint": "Petits caractères",
      "title": "Mentions légales"
    },
    "loyalty": {
      "hint": "Solde de récompenses",
      "title": "Points de fidélité"
    },
    "meta": {
      "hint": "Numéro, dates, commande et conditions",
      "title": "Détails de la facture"
    },
    "multicurrency": {
      "hint": "Totaux dans d’autres devises",
      "title": "Multidevise"
    },
    "notes": {
      "hint": "Texte de bas de page",
      "title": "Notes"
    },
    "payhistory": {
      "hint": "Paiements passés",
      "title": "Historique des paiements"
    },
    "payment": {
      "hint": "Comment payer",
      "title": "Paiement"
    },
    "poterms": {
      "hint": "Conditions du bon de commande",
      "title": "Conditions de commande"
    },
    "qr": {
      "hint": "Code à scanner pour payer",
      "title": "QR de paiement"
    },
    "recurring": {
      "hint": "Rythme des prélèvements",
      "title": "Récurrent"
    },
    "refund": {
      "hint": "Retours et remboursements",
      "title": "Politique de remboursement"
    },
    "shipto": {
      "hint": "Adresse de livraison",
      "title": "Livrer à"
    },
    "signature": {
      "hint": "Validation autorisée",
      "title": "Signature"
    },
    "tax": {
      "hint": "Taux et remises",
      "title": "Taxes et totaux"
    },
    "taxbreak": {
      "hint": "Composantes de la taxe",
      "title": "Détail des taxes"
    },
    "terms": {
      "hint": "Case d’acceptation",
      "title": "Conditions"
    },
    "theme": {
      "hint": "Couleur, devise, statut",
      "title": "Titre et thème"
    }
  },
  "seed": {
    "gallery": {
      "title": "Images"
    },
    "image": {
      "caption": "Ajoutez une légende",
      "title": "Image"
    },
    "item": "Nouvel article",
    "kv": {
      "label": "Étiquette",
      "row1k": "Centre de coûts",
      "row2k": "Contrat",
      "title": "Informations de référence",
      "value": "Valeur"
    },
    "text": {
      "body": "Ajoutez ici votre propre texte — périmètre, notes de livraison, conditions ou un message au client.",
      "title": "Notes complémentaires"
    }
  },
  "status": {
    "draft": "Brouillon",
    "live": "En ligne",
    "overdue": "En retard",
    "paid": "Payée",
    "sent": "Envoyée"
  },
  "toast": {
    "deleteFailed": "Suppression impossible",
    "duplicateFailed": "Duplication impossible",
    "duplicated": {
      "invoice": "Facture dupliquée",
      "template": "Modèle dupliqué"
    },
    "imageTooLarge": "Image trop volumineuse (max. {max})",
    "imageUnreadable": "Impossible de lire ce fichier",
    "languageFailed": "Impossible d’ajouter cette langue",
    "notAnImage": "Ce fichier n’est pas une image",
    "renameFailed": "Renommage impossible"
  },
  "topic": {
    "logistics": "Expédition et logistique",
    "other": "Sans catégorie",
    "receipts": "Reçus et remboursements",
    "recurring": "Récurrent",
    "sales": "Ventes et devis",
    "services": "Services professionnels"
  }
} as const;
