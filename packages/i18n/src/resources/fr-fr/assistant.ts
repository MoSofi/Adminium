// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/assistant.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "ask": {
    "continue": "Continuer",
    "pick": "Choisissez une option dans chaque groupe",
    "picked": "Choisi : {labels}",
    "ready": "Prêt",
    "waiting": "En attente de vous"
  },
  "audit": {
    "note": "Chaque action est consignée dans le journal d’audit"
  },
  "button": "Demander à {name}",
  "buttonTitle": "Interroger {name} sur cette page",
  "close": "Fermer",
  "composer": {
    "send": "Envoyer",
    "working": "Travail en cours…"
  },
  "confirm": {
    "cancel": "Annuler"
  },
  "details": {
    "checks": "Vérifications",
    "figures": "Chiffres",
    "figuresValue": "{blocks, plural, one {# bloc chiffré} other {# blocs chiffrés}}",
    "format": "Format",
    "formatEmailValue": "E-mail Adminium · {blocks, plural, one {# bloc} other {# blocs}}",
    "formatInvoiceValue": "Modèle de facture Adminium · {sections, plural, one {# section active} other {# sections actives}}",
    "lines": "Lignes",
    "linesValue": "{lines, plural, one {# ligne} other {# lignes}} · {total}",
    "noChecks": "aucune déclarée",
    "none": "aucune",
    "notPublished": "Non publié",
    "notPublishedValue": "enregistré comme brouillon",
    "notTouched": "Intact",
    "notTouchedValue": "aucune ligne client modifiée, aucun e-mail envoyé",
    "record": "Enregistrement",
    "recordValue": "document de facture · 1 nouvelle ligne · statut brouillon",
    "sources": "Sources lues",
    "sourcesChosen": "Sources choisies",
    "taxLines": "Lignes de TVA",
    "taxLinesValue": "{rate} %",
    "tokens": "Jetons",
    "tokensValue": "{in} en entrée · {out} en sortie",
    "variables": "Variables"
  },
  "diff": {
    "adds": "+{n}",
    "against": "Comparé à {name}",
    "dels": "−{n}",
    "new": "Nouveau {kind} — champs qui seront écrits",
    "truncated": "La comparaison a été tronquée — ouvrez le brouillon pour voir la suite."
  },
  "draft": {
    "account": "Compte",
    "draft": "brouillon",
    "due": "Échéance",
    "issued": "Émise",
    "lineCount": "{n, plural, one {# ligne} other {# lignes}}",
    "lines": "Lignes récupérées",
    "notTouched": "Aucune ligne client n’est modifiée et aucun e-mail n’est envoyé.",
    "status": "Statut",
    "template": "Modèle",
    "total": "Total"
  },
  "echo": {
    "applied": "Inséré dans l’éditeur — vérifiez les blocs mis en évidence."
  },
  "email": {
    "action1": "Envoyer un e-mail de test",
    "action2": "Ouvrir dans l’éditeur",
    "action3": "Enregistrer le modèle",
    "blurb": "Connaît cette page : {templates, plural, one {# modèle} other {# modèles}} · {campaigns, plural, one {# campagne} other {# campagnes}} · identité visuelle",
    "chip1": "Rédige une relance pour une facture impayée",
    "chip2": "Crée un rappel de rendez-vous, 3 jours avant",
    "chip3": "Traduis le modèle Bienvenue en allemand",
    "confirm": {
      "body": "{name} va créer « {title} » comme brouillon dans Modèles d’e-mail. Rien n’est envoyé aux clients tant que vous ne l’activez pas.",
      "bodyOpen": "{name} va créer « {title} » comme brouillon dans Modèles d’e-mail et l’ouvrir dans l’éditeur.",
      "button": "Enregistrer comme brouillon",
      "title": "Enregistrer comme nouveau modèle ?"
    },
    "echo": {
      "editor": "Enregistré comme modèle brouillon. Ouverture dans l’éditeur.",
      "sample": "Échantillon rendu pour {record}.",
      "saved": "Enregistré comme modèle brouillon.",
      "test": "Test envoyé à {email} avec des données d’exemple."
    },
    "greeting": "Je vois vos modèles d’e-mail — le format des blocs, votre identité visuelle et les variables que chaque modèle peut utiliser.",
    "greetingSub": "Décrivez l’e-mail qu’il vous faut : je le rédigerai au format de modèle d’Adminium, puis vous pourrez l’envoyer en test avant de l’enregistrer.",
    "language": {
      "saved": "Variante {locale} ajoutée comme brouillon."
    },
    "page": "Modèles d’e-mail",
    "placeholder": "Décrivez le modèle qu’il vous faut…",
    "readPage": "Modèles d’e-mail · {templates, plural, one {# modèle} other {# modèles}} · identité visuelle",
    "scopePrimary": "email_templates",
    "workTitle": "Nouveau modèle d’e-mail rédigé"
  },
  "error": {
    "generic": "Cela n’a pas fonctionné. Reposez la question.",
    "smtp": "L’e-mail n’est pas encore configuré. Ouvrez les paramètres d’e-mail pour ajouter un relais.",
    "tooLong": "Cette conversation est trop longue pour le modèle — démarrez une nouvelle session.",
    "tryAgain": "Réessayer"
  },
  "invoiceTemplate": {
    "action1": "Voir un autre échantillon",
    "action2": "Ouvrir dans l’éditeur",
    "action3": "Enregistrer le modèle",
    "blurb": "Connaît cette page : {templates, plural, one {# modèle} other {# modèles}} · numérotation {pattern} · {invoices, plural, one {# facture} other {# factures}}",
    "chip1": "Crée un modèle pour les clients de l’UE avec autoliquidation de la TVA",
    "chip2": "Ajoute une section de pénalités de retard à l’un de mes modèles",
    "chip3": "Aligne l’un de mes modèles sur nos couleurs de marque",
    "confirm": {
      "body": "{name} va ajouter « {title} » aux Modèles de facture comme brouillon. Les factures existantes ne changent pas.",
      "bodyOpen": "{name} va ajouter « {title} » aux Modèles de facture comme brouillon et l’ouvrir dans l’éditeur.",
      "button": "Enregistrer comme brouillon",
      "title": "Enregistrer comme nouveau modèle de facture ?"
    },
    "echo": {
      "editor": "Enregistré comme brouillon. Ouverture dans l’éditeur.",
      "noSample": "Il n’y a ici aucune facture à partir de laquelle dessiner un exemple.",
      "sample": "Échantillon rendu pour {record}.",
      "saved": "Enregistré comme modèle brouillon.",
      "test": "Test envoyé à {email}."
    },
    "greeting": "Je vois vos modèles de facture, votre schéma de numérotation et les lignes de TVA que vos modèles utilisent.",
    "greetingSub": "Dites-moi le modèle qu’il vous faut : je le construirai au format de facture d’Adminium, puis je rendrai un échantillon avec de vraies données de compte.",
    "language": {
      "saved": "Variante {locale} ajoutée comme brouillon."
    },
    "page": "Modèles de facture",
    "placeholder": "Décrivez le modèle de facture qu’il vous faut…",
    "readPage": "Modèles de facture · {templates, plural, one {# modèle} other {# modèles}} · numérotation {pattern}",
    "scopePrimary": "invoice_templates",
    "workTitle": "Nouveau modèle de facture construit"
  },
  "invoices": {
    "action1": "Ouvrir dans l’éditeur",
    "action2": "Créer une facture brouillon",
    "blurb": "Connaît cette page : {invoices, plural, one {# facture} other {# factures}} · {templates, plural, one {# modèle} other {# modèles}} · votre rôle peut {write, select, true {écrire} other {lire}}",
    "chip1": "Crée une facture pour un client pour le mois dernier",
    "chip2": "Rédige une facture à partir des entrées non facturées du mois dernier",
    "chip3": "Liste les factures dont l’échéance est dépassée",
    "confirm": {
      "body": "{name} va ajouter cette facture aux Factures comme brouillon. Aucune ligne client n’est modifiée tant que vous ne l’envoyez pas.",
      "bodyOpen": "{name} va ajouter cette facture aux Factures comme brouillon et l’ouvrir dans l’éditeur.",
      "button": "Créer le brouillon",
      "title": "Créer cette facture brouillon ?"
    },
    "echo": {
      "editor": "Créée comme brouillon. Ouverture dans l’éditeur de facture.",
      "sample": "Échantillon rendu pour {record}.",
      "saved": "Créée comme brouillon. Elle est en haut du tableau.",
      "test": "Test envoyé à {email}."
    },
    "greeting": "Je vois la table des factures, vos modèles et les endroits d’où les données de facturation peuvent venir.",
    "greetingSub": "Dites-moi qui facturer : je demanderai quel modèle utiliser et d’où tirer les lignes avant de rédiger quoi que ce soit.",
    "language": {
      "saved": "Variante {locale} ajoutée comme brouillon."
    },
    "page": "Factures",
    "placeholder": "par ex. crée une facture pour un client pour le mois dernier…",
    "readPage": "Factures · {invoices, plural, one {# enregistrement} other {# enregistrements}} · votre rôle peut {write, select, true {écrire} other {lire}}",
    "scopePrimary": "invoices",
    "workTitle": "Facture rédigée"
  },
  "readOnly": {
    "enable": "Activer les actions",
    "lockedTitle": "Activez les actions pour que {name} puisse le faire",
    "noWrite": "Votre rôle peut consulter, rédiger et prévisualiser ici, mais pas enregistrer.",
    "noWriteTitle": "Votre rôle ne peut pas faire cela ici",
    "note": "{name} est en lecture seule pour l’instant — il peut consulter, rédiger et prévisualiser, mais pas enregistrer, envoyer ni créer."
  },
  "report": {
    "action1": "Lancer l’aperçu complet",
    "action2": "Ouvrir dans le générateur",
    "action3": "Enregistrer le rapport",
    "blurb": "Connaît cette page : {reports, plural, one {# rapport} other {# rapports}} · {connection} · {tables, plural, one {# table lisible} other {# tables lisibles}}",
    "chip1": "Quels clients demandent le plus de temps de support ? À vous de choisir les sources",
    "chip2": "Construis un rapport de rétention à partir des clients et des commandes",
    "chip3": "Crée un modèle de revue opérationnelle mensuelle",
    "confirm": {
      "body": "{name} va ajouter « {title} » aux Rapports. Il s’exécute à la demande — sans planification tant que vous n’en définissez pas une.",
      "bodyOpen": "{name} va ajouter « {title} » aux Rapports et l’ouvrir dans le générateur.",
      "button": "Enregistrer le rapport",
      "title": "Enregistrer ce rapport ?"
    },
    "echo": {
      "editor": "Enregistré dans Rapports. Ouverture dans le générateur.",
      "resampled": "Sources ré-exécutées — {n, plural, one {# chiffre mis à jour} other {# chiffres mis à jour}}.",
      "resampledRefused": "Sources ré-exécutées — {n, plural, one {# chiffre mis à jour} other {# chiffres mis à jour}} ; {refused, plural, one {# source illisible} other {# sources illisibles}}.",
      "sample": "Requête complète exécutée pour {record}.",
      "saved": "Enregistré dans Rapports. Ajoutez une planification depuis l’en-tête du rapport.",
      "test": "Test envoyé à {email}."
    },
    "greeting": "Je vois votre bibliothèque de rapports et les {tables, plural, one {# table} other {# tables}} que votre rôle peut lire dans {connection}.",
    "greetingSub": "Nommez les tables et la mise en page, ou dites-moi simplement la question : je choisirai les sources et vous montrerai pourquoi.",
    "language": {
      "saved": "Variante {locale} ajoutée comme brouillon."
    },
    "page": "Générateur de rapports",
    "placeholder": "Demandez un rapport, ou nommez les tables à utiliser…",
    "readPage": "Générateur de rapports · {reports, plural, one {# rapport} other {# rapports}} · {tables, plural, one {# table lisible} other {# tables lisibles}}",
    "scopePrimary": "reports",
    "workTitle": "Rapport construit"
  },
  "scope": {
    "connection": "{connection} · {n, plural, one {# table} other {# tables}}",
    "extra": "+{n}",
    "title": "Données que cette session peut lire"
  },
  "steps": {
    "done": "terminé",
    "failed": "échec",
    "note": {
      "ready": "prêt",
      "warning": "{n, plural, one {# avertissement} other {# avertissements}}"
    },
    "readPage": "Page lue",
    "step": "étape {n}",
    "working": "Au travail"
  },
  "tabs": {
    "details": "Détails",
    "diff": "Diff",
    "preview": "Aperçu"
  },
  "tokens": {
    "hint": "~{n} jetons",
    "title": "Jetons utilisés dans cette session",
    "value": "{n} jetons"
  },
  "try": "Essayer",
  "unavailable": {
    "askAdmin": "Demandez à un administrateur d’en configurer un.",
    "forbidden": "Vous n’avez pas la permission d’utiliser {name}.",
    "network": "Les fonctions réseau sortantes sont désactivées sur cette instance.",
    "noProvider": "Aucun fournisseur d’IA n’est encore configuré.",
    "settings": "Ouvrir Paramètres → IA"
  }
} as const;
