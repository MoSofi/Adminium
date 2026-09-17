// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/dataio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "back": "Retour",
  "import": {
    "stepUpload": "Téléverser",
    "stepMap": "Mapper les colonnes",
    "stepValidate": "Valider",
    "stepRun": "Importer et vérifier",
    "targetLabel": "Table cible",
    "targetPlaceholder": "Choisissez une page de table…",
    "notATable": "Cette page n’est pas une table — choisissez une page de table pour l’import.",
    "dropTitle": "Déposez un fichier CSV à importer",
    "dropHint": "CSV jusqu’à 32 Mo — la première ligne doit être l’en-tête",
    "skipTarget": "Ne pas importer",
    "mapHint": "{count} lignes de données dans {file} — choisissez une cible pour chaque colonne.",
    "validating": "Validation…",
    "toValidate": "Valider",
    "validateFailed": "Échec de la validation.",
    "validationSummary": "{valid} lignes sur {total} prêtes à l’import — {invalid} seront ignorées.",
    "allValid": "Toutes les lignes ont passé la validation",
    "run": "Lancer l’import",
    "runSkipping": "Importer {valid} lignes (ignorer {invalid})",
    "progressLabel": "Progression de l’import",
    "running": "Import en cours…",
    "kpiTotal": "Lignes dans le fichier",
    "kpiCreated": "Créées",
    "kpiUpdated": "Mises à jour",
    "kpiSkipped": "Ignorées",
    "inconsistent": "Les totaux de l’import sont incohérents — le total doit égaler créées + mises à jour + ignorées.",
    "downloadErrors": "Télécharger le rapport des lignes ignorées (CSV)",
    "runFailed": "L’import a échoué."
  },
  "exports": {
    "tableLabel": "Table",
    "tablePlaceholder": "Choisissez une table…",
    "notATable": "Cette page n’est pas une table — choisissez une page de table à exporter.",
    "formatLabel": "Format",
    "create": "Exporter",
    "createFailed": "Impossible de demander l’export.",
    "retention": "Les exports sont conservés 30 jours, puis expirent.",
    "statusProcessing": "Traitement…",
    "statusReady": "Prêt — {rows} lignes · cliquez pour télécharger",
    "statusFailed": "Échec — {error}",
    "statusCancelled": "Annulé",
    "statusExpired": "Expiré",
    "emptyTitle": "Aucun export pour l’instant",
    "emptyBody": "Demandez-en un ci-dessus — les artefacts apparaissent ici avec leur statut.",
    "new": "Nouvel export"
  },
  "builder": {
    "title": "Nouvel export",
    "subtitle": "Choisissez une table, sélectionnez les colonnes, vérifiez le fichier, exportez.",
    "cancel": "Annuler",
    "backToExports": "Retour aux exports de données",
    "basedOn": "Basé sur {name}",
    "noAccess": {
      "title": "Rien à exporter pour l’instant",
      "body": "Vous n’avez le droit d’export sur aucune table de cette connexion. Demandez à un administrateur de l’accorder dans {link}.",
      "link": "Rôles et accès"
    },
    "step": "Étape {n} sur 3",
    "steps": {
      "source": "Source",
      "columns": "Colonnes",
      "preview": "Aperçu"
    },
    "continue": "Continuer",
    "export": "Exporter",
    "back": "Retour",
    "hint": {
      "chooseTable": "Choisissez une table pour continuer.",
      "fromAll": "À partir de toutes les colonnes de {table}.",
      "fromPage": "À partir d’une page liée à {table}.",
      "noColumns": "Ajoutez au moins une colonne pour continuer.",
      "dupes": "Deux colonnes ont le même en-tête. Renommez-en une pour continuer.",
      "order": "{n} colonnes seront écrites dans cet ordre.",
      "readSample": "Lisez l’échantillon avant d’exporter.",
      "downloads": "Le fichier se télécharge depuis Exports de données une fois prêt."
    },
    "source": {
      "title": "Quelle table ?",
      "search": "Rechercher des tables…",
      "meta": "{rows} lignes · {cols} colonnes",
      "metaNoRows": "{cols} colonnes",
      "usedBy": "Utilisée par {n, plural, one {# page} other {# pages}}",
      "locked": "Pas de droit d’export",
      "lockedToast": "Vous n’avez pas le droit d’exporter {table}"
    },
    "startFrom": {
      "title": "Partir de",
      "body": "Choisissez où commence la liste des colonnes. Vous pourrez tout modifier à l’étape suivante.",
      "all": "Toutes les colonnes de {table}",
      "page": "Les colonnes d’une page — {page}",
      "pageMeta": "{page} · {n} colonnes · {linked} liées · {totals, plural, one {# total} other {# totaux}}",
      "none": "Aucune page n’est liée à cette table"
    },
    "columns": {
      "title": "Ce qui va dans le fichier.",
      "add": "Ajouter des colonnes",
      "inFile": "Dans votre fichier",
      "summary": "{n} colonnes · {linked} liées · {totals, plural, one {# total} other {# totaux}}",
      "reset": "Revenir aux colonnes de la table",
      "removeAll": "Tout retirer",
      "empty": {
        "title": "Pas encore de colonnes",
        "body": "Ajoutez des colonnes depuis le panneau, ou revenez aux colonnes de la table."
      },
      "dragTitle": "Glissez pour réordonner, ou utilisez les flèches",
      "reorder": "Réordonner {header}",
      "headerLabel": "En-tête dans le fichier",
      "masked": "Exporté en ••••• sauf si vous avez le droit de révélation",
      "dupe": "Une autre colonne utilise cet en-tête",
      "removeTitle": "Retirer du fichier",
      "remove": "Retirer {header}"
    },
    "browser": {
      "search": "Rechercher des colonnes…",
      "broken": "Ce lien ne se résout plus — recommencez-le.",
      "brokenBack": "Retour à toutes les tables",
      "suggested": "Suggestions",
      "fromTable": "Depuis {table}",
      "fromTheTable": "Depuis la table",
      "readOnly": "Colonne en lecture seule",
      "noMatch": "Aucune colonne ne correspond à cette recherche.",
      "allIn": "Toutes les colonnes de cette table sont déjà dans votre fichier.",
      "linked": "Depuis les tables liées",
      "budget": "{used} sur {max}",
      "inbound": "Tables qui pointent ici",
      "via": "via {column}",
      "count": "Nombre",
      "aggregate": "Agrégat",
      "add": "Ajouter",
      "singleNote": "Min et Max prennent une seule colonne.",
      "limit": "Limite atteinte — retirez-en une pour en ajouter une autre",
      "fourMax": "Jusqu’à quatre colonnes",
      "pickNumeric": "Choisissez d’abord une colonne numérique",
      "already": "{header} est déjà dans votre fichier",
      "added": "{header} ajouté",
      "calculated": "Calculé",
      "hop": "Ajoutez une colonne, ou suivez un autre lien.",
      "hopLimit": "Trois sauts est la limite. Ajoutez une colonne ici, ou revenez en arrière.",
      "addName": "Ajouter {name}",
      "noRead": "Pas de droit de lecture"
    },
    "calc": {
      "arith": "Additionner ou soustraire deux colonnes",
      "first": "Première colonne",
      "op": "Opérateur",
      "second": "Seconde colonne",
      "pct": "Un pourcentage d’une colonne",
      "pctLabel": "Pourcentage",
      "pctOf": "% de",
      "column": "Colonne",
      "rule": "Une règle avec un seuil",
      "if": "Si",
      "isOver": "dépasse",
      "then": "alors",
      "else": "sinon",
      "threshold": "Seuil",
      "whenOver": "Valeur si dépassé",
      "otherwise": "Valeur sinon",
      "needTwo": "Ajoutez d’abord deux colonnes numériques",
      "needOne": "Ajoutez d’abord une colonne numérique"
    },
    "gen": {
      "count": "Nombre de {table}",
      "countSrc": "nombre de {table} via {column}",
      "foldSrc": "{fn} de {table}.{cols}",
      "linkedSrc": "{table}.{column} via {path}",
      "arithHeader": "{a} {op} {b}",
      "pctHeader": "{pct}% de {a}",
      "ruleHeader": "{then} ou {else}",
      "ruleSrc": "si {a} dépasse {threshold} alors {then}, sinon {else}",
      "sumOf": "Somme de",
      "average": "Moyenne",
      "min": "Min",
      "max": "Max"
    },
    "badge": {
      "key": "Clé",
      "linked": "Lié",
      "count": "Nombre",
      "sum": "Somme",
      "avg": "Moyenne",
      "min": "Min",
      "max": "Max",
      "calculated": "Calculé",
      "masked": "Masqué"
    },
    "fold": {
      "sum": "Somme",
      "avg": "Moyenne",
      "min": "Min",
      "max": "Max"
    },
    "preview": {
      "title": "Vérifiez le fichier, puis exportez.",
      "fileName": "Nom du fichier",
      "format": "Format",
      "csv": "CSV",
      "jsonl": "JSON Lines",
      "rows": "Lignes",
      "allRows": "Toutes les lignes · {n}",
      "allRowsUnknown": "Toutes les lignes",
      "viewRows": "Lignes d’une vue enregistrée",
      "savedView": "Vue enregistrée",
      "viewLabel": "{name} · {filters} filtres · {rows} lignes",
      "viewLabelNoRows": "{name} · {filters} filtres",
      "headerRow": "Ligne d’en-tête",
      "tabTable": "Tableau",
      "tabRaw": "Fichier brut",
      "sample": "Échantillon de {n} lignes · actualisé {when}",
      "justNow": "à l’instant",
      "minutesAgo": "{n, plural, one {il y a # minute} other {il y a # minutes}}",
      "refresh": "Actualiser",
      "failed": "L’échantillon n’a pas pu être lu.",
      "failedTimeout": "La connexion a répondu trop lentement. L’export lui-même n’a pas été lancé.",
      "retry": "Réessayer",
      "headerOnly": "Le fichier ne contiendra que la ligne d’en-tête."
    },
    "summary": {
      "title": "Le fichier",
      "columns": "Colonnes",
      "rows": "Lignes",
      "size": "Taille estimée",
      "retention": "Conservation",
      "kept": "Conservé 30 jours",
      "fileName": "Nom du fichier"
    },
    "warn": {
      "title": "Bon à savoir",
      "masked": "{n, plural, one {# colonne s’exporte} other {# colonnes s’exportent}} masquée(s)",
      "search": "Cette vue a un terme de recherche qu’un export ne peut pas reprendre",
      "noRows": "Cette table n’a aucune ligne pour le moment"
    },
    "started": {
      "preparing": "Préparation de {file} · {rows} lignes",
      "ready": "Prêt · {rows} lignes",
      "noteBusy": "Il apparaîtra dans Exports de données et s’y téléchargera une fois prêt.",
      "noteReady": "Prêt. Il est aussi dans Exports de données si vous préférez y revenir plus tard.",
      "download": "Télécharger {format}",
      "busy": "Préparation du fichier…",
      "another": "Faire un autre export",
      "failed": "L’export a échoué."
    },
    "toast": {
      "started": "Export lancé"
    }
  }
} as const;
