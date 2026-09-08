// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/automations.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "rules": {
    "title": "Règles d'automatisation",
    "subtitle": "Déclenchez des flux automatiquement quand quelque chose se produit.",
    "new": "Nouvelle règle",
    "empty": {
      "title": "Aucune règle pour l'instant",
      "body": "Créez une règle pour exécuter des étapes automatiquement quand quelque chose se produit."
    },
    "none": "Sélectionnez une règle pour voir son flux"
  },
  "kpi": {
    "activeRules": "Règles actives",
    "runsToday": "Exécutions aujourd'hui",
    "successRate": "Taux de réussite",
    "timeSaved": "Temps gagné (mois)"
  },
  "filter": {
    "all": "Toutes",
    "active": "Actives",
    "paused": "En pause"
  },
  "card": {
    "runs": "exécutions",
    "success": "réussite",
    "never": "Jamais exécutée",
    "toggle": "Activer/désactiver"
  },
  "status": {
    "active": "Active",
    "paused": "En pause"
  },
  "flow": {
    "steps": "{count, plural, one {# étape} other {# étapes}}",
    "saves": "gagne {time} / exécution",
    "runs30d": "exéc. 30 j",
    "success": "réussite",
    "test": "Tester",
    "running": "En cours",
    "noSample": "Aucun enregistrement pour tester — ajoutez-en un d'abord",
    "menu": "Actions sur la règle"
  },
  "menu": {
    "rename": "Renommer",
    "duplicate": "Dupliquer",
    "delete": "Supprimer"
  },
  "delete": {
    "title": "Supprimer {name} ?",
    "body": "Son historique d'exécutions part avec elle. Cette action est irréversible.",
    "confirm": "Supprimer",
    "cancel": "Annuler"
  },
  "save": {
    "unsaved": "Modifications non enregistrées",
    "saving": "Enregistrement…",
    "saved": "Tout est enregistré",
    "action": "Enregistrer"
  },
  "guard": {
    "title": "Quitter sans enregistrer ?",
    "body": "Vos modifications sur cette règle seront perdues.",
    "stay": "Continuer l'édition",
    "leave": "Quitter"
  },
  "toast": {
    "saved": "Règle enregistrée",
    "enabled": "{name} est activée",
    "paused": "{name} est en pause",
    "incomplete": "Terminez « {step} » avant d'activer cette règle",
    "duplicated": "{name} dupliquée",
    "deleted": "{name} supprimée",
    "failed": "Cela n'a pas été enregistré — {reason}"
  },
  "canvas": {
    "insert": "Insérer une étape ici",
    "addStep": "Ajouter une étape",
    "remove": "Supprimer l'étape"
  },
  "kind": {
    "trigger": "DÉCLENCHEUR",
    "condition": "FILTRE",
    "branch": "SI / SINON",
    "wait": "DÉLAI",
    "action": "ACTION"
  },
  "branch": {
    "ifMatches": "Si ça correspond",
    "otherwise": "Sinon"
  },
  "picker": {
    "title": "Ajouter une étape",
    "before": "Avant · {title}",
    "end": "À la fin du flux",
    "inBranch": "Dans la branche · {label}",
    "actions": "Actions",
    "logic": "Logique",
    "close": "Fermer"
  },
  "pick": {
    "email": "Envoyer un e-mail",
    "emailDesc": "Depuis un modèle enregistré",
    "notification": "Envoyer une notification",
    "notificationDesc": "Prévenir des personnes de cet espace",
    "create": "Créer un enregistrement",
    "createDesc": "Ajouter une ligne à une table",
    "update": "Mettre à jour un champ",
    "updateDesc": "Réécrire dans un enregistrement",
    "webhook": "Appeler un webhook",
    "webhookDesc": "Envoyer des données n'importe où",
    "slack": "Message Slack",
    "slackDesc": "Publier dans un canal",
    "branch": "Branche si / sinon",
    "branchDesc": "Séparer en deux chemins",
    "filter": "Continuer seulement si",
    "filterDesc": "S'arrêter si ça ne correspond pas",
    "wait": "Attendre / temporiser",
    "waitDesc": "Patienter avant l'étape suivante",
    "stop": "Arrêter le flux",
    "stopDesc": "Interrompre cette exécution ici"
  },
  "node": {
    "email": {
      "sub": "Modèle · à choisir",
      "summary": "Modèle · {template} → {to}"
    },
    "notification": {
      "sub": "Choisissez qui prévenir",
      "summary": "À · {who}"
    },
    "create": {
      "sub": "Table · à choisir",
      "summary": "{table} · {count} valeurs"
    },
    "update": {
      "sub": "Définir une valeur",
      "summary": "{pairs}"
    },
    "webhook": {
      "sub": "POST · charge JSON",
      "summary": "{method} {host}"
    },
    "slack": {
      "sub": "Canal · ajoutez une URL de webhook",
      "summary": "Slack · {host}"
    },
    "wait": {
      "title": "Attendre / temporiser",
      "sub": "Pause de {duration}"
    },
    "stop": {
      "title": "Arrêter le flux",
      "sub": "Met fin à l'exécution"
    },
    "condition": {
      "empty": "Définir une condition"
    },
    "trigger": {
      "record": "Quand un enregistrement est {event} dans {table}",
      "interval": "Toutes les {minutes} minutes",
      "daily": "Chaque jour à {time}",
      "weekly": "Chaque semaine le {day} à {time}",
      "monthly": "Chaque mois le {day} à {time}",
      "sub": "Déclencheur · {event}"
    }
  },
  "event": {
    "created": "créé",
    "updated": "mis à jour",
    "deleted": "supprimé"
  },
  "insp": {
    "stepName": "Nom de l'étape",
    "description": "Description",
    "condition": "Condition",
    "lookAt": "Regarder",
    "thisRecord": "Cet enregistrement",
    "related": "Enregistrements liés",
    "field": "Champ",
    "value": "Valeur",
    "countOf": "Nombre de",
    "where": "où",
    "isThisRecords": "est égal au champ de cet enregistrement",
    "andWhere": "et où",
    "branchLabels": "Libellés des branches",
    "onError": "Continuer en cas d'erreur",
    "onErrorBody": "Exécuter les étapes suivantes même si celle-ci échoue",
    "moveUp": "Monter",
    "moveDown": "Descendre",
    "duplicate": "Dupliquer",
    "delete": "Supprimer",
    "close": "Fermer",
    "settings": "Réglages"
  },
  "op": {
    "is": "est",
    "isNot": "n'est pas",
    "contains": "contient",
    "gt": "est supérieur à",
    "lt": "est inférieur à",
    "isEmpty": "est vide",
    "notEmpty": "n'est pas vide",
    "withinNext": "est dans les prochaines",
    "withinLast": "est dans les dernières",
    "moreThanAgo": "était il y a plus de …",
    "moreThanAhead": "est dans plus de …"
  },
  "unit": {
    "minutes": "{count, plural, one {minute} other {minutes}}",
    "hours": "{count, plural, one {heure} other {heures}}",
    "days": "{count, plural, one {jour} other {jours}}"
  },
  "trig": {
    "title": "Déclencheur",
    "kind": "Quand",
    "record": "Un enregistrement est {event}",
    "schedule": "Selon un calendrier",
    "table": "Table",
    "changed": "Seulement quand cette colonne change",
    "anyColumn": "N'importe quelle colonne",
    "watch": {
      "on": "Surveille aussi les lignes écrites hors d'Adminium · chaque minute · via {column}",
      "off": "Surveillance désactivée : cette table n'a ni colonne de type « {shape} » ni clé croissante, donc seules les écritures faites via Adminium déclenchent cette règle",
      "deleted": "Les lignes supprimées ne peuvent pas être surveillées ; seules les suppressions faites via Adminium déclenchent cette règle",
      "fromNow": "Les lignes à partir de maintenant"
    },
    "when": "Seulement si",
    "every": "Toutes les",
    "at": "À",
    "timezone": "Fuseau horaire",
    "forEach": "Pour chaque enregistrement de",
    "forEachWhere": "où",
    "once": "Une fois par enregistrement",
    "onceBody": "Un enregistrement déjà traité ne l'est pas de nouveau",
    "timeSaved": "Temps gagné par exécution",
    "timeSavedBody": "Minutes qu'une personne aurait passées — affiché comme « gagne » sur la règle",
    "addCondition": "Ajouter une condition",
    "connection": "Connexion"
  },
  "sched": {
    "interval": "Intervalle",
    "daily": "Quotidien",
    "weekly": "Hebdomadaire",
    "monthly": "Mensuel"
  },
  "email": {
    "template": "Modèle",
    "to": "À",
    "toField": "L'e-mail de cet enregistrement",
    "toFixed": "Adresses",
    "column": "Colonne",
    "addresses": "Ajouter une adresse…"
  },
  "notif": {
    "to": "Envoyer à",
    "roles": "Toutes les personnes ayant un rôle",
    "users": "Des personnes précises",
    "title": "Titre",
    "body": "Message"
  },
  "rec": {
    "table": "Table",
    "values": "Valeurs",
    "addValue": "Ajouter une valeur",
    "column": "Colonne",
    "value": "Valeur",
    "now": "Maintenant",
    "remove": "Supprimer cette valeur",
    "tokenHint": "Utilisez {token} pour reprendre la valeur de l'enregistrement"
  },
  "hook": {
    "url": "URL",
    "method": "Méthode",
    "body": "Corps",
    "bodyJson": "JSON (événement, règle, enregistrement)",
    "bodyText": "Texte personnalisé",
    "header": "En-tête",
    "headerName": "Nom",
    "headerValue": "Valeur",
    "slackUrl": "URL du webhook Slack",
    "slackText": "Message"
  },
  "wait": {
    "for": "Attendre",
    "max": "Jusqu'à 30 jours",
    "amount": "Quantité",
    "unit": "Unité"
  },
  "modal": {
    "title": "Nouvelle règle",
    "subtitle": "Déclenchez des flux automatiquement quand quelque chose se produit.",
    "name": "Nom de la règle",
    "namePlaceholder": "ex. Accueillir les nouvelles inscriptions",
    "when": "Quand (déclencheur)",
    "then": "Alors (action)",
    "enable": "Activer immédiatement",
    "enableBody": "Commence à s'exécuter dès la création de la règle",
    "cancel": "Annuler",
    "create": "Créer la règle",
    "doneTitle": "Règle créée",
    "doneBody": "Votre règle est active et s'exécutera au prochain déclenchement.",
    "savedTitle": "Règle enregistrée",
    "savedBody": "Terminez ses étapes, puis activez-la.",
    "done": "Terminé",
    "trigger": {
      "created": "Un enregistrement est créé dans {table}",
      "updated": "Un enregistrement est mis à jour dans {table}",
      "deleted": "Un enregistrement est supprimé dans {table}",
      "schedule": "Selon un calendrier"
    },
    "connection": "{connection} · {table}"
  },
  "logs": {
    "title": "Journaux des flux",
    "subtitle": "Historique d'exécution de vos automatisations.",
    "refresh": "Actualiser",
    "kpi": {
      "runsToday": "Exécutions aujourd'hui",
      "success": "Taux de réussite",
      "failed": "Échecs",
      "avgDuration": "Durée moy."
    },
    "filter": {
      "all": "Toutes",
      "success": "Réussies",
      "failed": "Échouées",
      "running": "En cours"
    },
    "status": {
      "success": "Réussie",
      "failed": "Échouée",
      "running": "En cours",
      "pending": "Démarre {when}",
      "waiting": "En attente · reprend {when}",
      "skipped": "Ignorée",
      "cancelled": "Annulée"
    },
    "trigger": "Déclencheur",
    "duration": "Durée",
    "started": "Démarrée",
    "trace": "Trace d'exécution",
    "loadOlder": "Charger plus anciennes",
    "empty": {
      "title": "Aucune exécution",
      "filtered": "Aucune exécution « {status} » ces 7 derniers jours"
    },
    "select": "Sélectionnez une exécution pour voir sa trace",
    "justNow": "à l'instant"
  },
  "trace": {
    "trigger": "enregistrement = {label} · {summary}",
    "scheduleTick": "top · {stamp}",
    "evaluated": "évalué → {result}",
    "stopped": "évalué → false · arrêté",
    "branch": "a pris « {label} »",
    "wait": "reprend {stamp}",
    "wouldWait": "Attendrait {duration}",
    "email": {
      "ok": "{smtp} · remis à {to}",
      "fail": "ERREUR · {reason}",
      "would": "Enverrait « {subject} » à {to}",
      "noSmtp": "SMTP n'est pas configuré — Réglages → E-mail",
      "noRecipient": "Aucun destinataire : {column} est vide"
    },
    "notif": {
      "ok": "{count, plural, one {# personne} other {# personnes}} prévenue(s)"
    },
    "create": {
      "ok": "{label} créé"
    },
    "update": {
      "ok": "{pairs} défini"
    },
    "write": {
      "would": "Définirait {pairs}"
    },
    "hook": {
      "ok": "{method} {path} → {status} · {ms} ms",
      "fail": "{method} {path} → {status}",
      "would": "Ferait {method} {url}"
    },
    "stop": "Arrêté ici",
    "undone": "Annulé avant son exécution",
    "gone": "L'enregistrement n'existe plus",
    "ruleOff": "La règle a été désactivée pendant l'attente",
    "skipped": "—"
  },
  "dur": {
    "ms": "{ms} ms",
    "s": "{s} s",
    "none": "—"
  },
  "saved": {
    "h": "{h} h",
    "m": "{m} min"
  }
} as const;
