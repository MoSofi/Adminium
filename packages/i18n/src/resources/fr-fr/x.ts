// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/x.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "language": {
    "menu": "Langue",
    "button": "Langue : {name}"
  },
  "footer": {
    "questions": "Des questions ? Écrivez à",
    "privacyNotice": "Avis de confidentialité"
  },
  "required": "Obligatoire",
  "optional": "Facultatif",
  "send": "Envoyer",
  "sendAnswers": "Envoyer les réponses",
  "sending": "Envoi…",
  "preview": "Rien n’est envoyé depuis cette page.",
  "keeps": "{business} conserve ce que vous envoyez pour vous répondre.",
  "summary": "Vérifiez les réponses signalées ci-dessous.",
  "proofFailed": "La vérification que vous êtes une personne a échoué. Réessayez.",
  "honeypot": "Laissez ce champ vide",
  "anonymous": "Vos réponses ne sont pas liées à votre nom.",
  "surveyAbout": "Concerne : {record}.",
  "error": {
    "required": "Répondez à cette question.",
    "name": "Saisissez votre nom",
    "tooLong": "{max, plural, one {# caractère} other {# caractères}} au maximum.",
    "email": "Saisissez une adresse e-mail comme name@company.com",
    "phone": "Saisissez un numéro de téléphone de 6 à 15 chiffres.",
    "choice": "Choisissez l’une des réponses.",
    "tooFew": "Choisissez-en au moins {min}.",
    "tooMany": "Choisissez-en au plus {max}.",
    "date": "Saisissez un jour.",
    "fromToday": "Choisissez un jour à partir d’aujourd’hui",
    "fromTomorrow": "Choisissez un jour à partir de demain",
    "number": "Saisissez un nombre.",
    "whole": "Saisissez un nombre sans décimales.",
    "tooSmall": "Saisissez {min} ou plus.",
    "tooLarge": "Saisissez {max} ou moins.",
    "score": "Choisissez une note de 0 à 10.",
    "stars": "Choisissez de 1 à 5 étoiles.",
    "file": "Ce fichier ne peut pas être accepté.",
    "tick": "Cochez la case ou laissez-la vide.",
    "answer": "Une partie des réponses n’a pas été acceptée. Vérifiez-les et envoyez à nouveau."
  },
  "file": {
    "chooseOne": "Choisir un fichier",
    "chooseMany": "Choisir des fichiers",
    "hint": "{kinds}, jusqu’à {mb} Mo",
    "kind": {
      "pdf": "PDF",
      "jpg": "JPG",
      "png": "PNG",
      "text": "texte brut"
    }
  },
  "files": {
    "remove": "Retirer {file}",
    "added": "{file} ajouté.",
    "removed": "{file} retiré.",
    "refused": "{file} n’a pas été ajouté.",
    "tooBig": "Ce fichier fait {size}. La limite est de {mb} Mo.",
    "kind": "Ce type de fichier n’est pas accepté. Utilisez {kinds}.",
    "quota": "Les fichiers ne peuvent pas être acceptés pour le moment. Réessayez plus tard.",
    "cap": "Trop de fichiers envoyés depuis cet appareil aujourd’hui. Réessayez demain.",
    "count": "Vous pouvez ajouter jusqu’à {max, plural, one {# fichier} other {# fichiers}}.",
    "failed": "Ce fichier n’a pas pu être envoyé. Réessayez."
  },
  "score": {
    "low": "Peu probable",
    "high": "Très probable",
    "ends": "0 signifie peu probable, 10 très probable."
  },
  "stars": {
    "of": "{n} sur 5",
    "star": "{n, plural, one {# étoile} other {# étoiles}}"
  },
  "ending": {
    "thanksName": "Merci, {name}.",
    "thanks": "Merci.",
    "confirmNewsletter": "Encore une étape pour la newsletter : ouvrez votre e-mail et appuyez sur « Confirmer ».",
    "confirmSurveys": "Encore une étape pour les questionnaires : ouvrez votre e-mail et appuyez sur « Confirmer ».",
    "surveyThanksName": "Merci, {name}.",
    "surveyHelps": "Vos réponses nous aident.",
    "already": "Vous avez déjà répondu à ce questionnaire. Merci.",
    "dead": "Ce lien ne fonctionne pas.",
    "write": "Écrivez à {email}.",
    "closed": "Ce formulaire est fermé.",
    "tooMany": "Trop d’envois depuis cet appareil. Réessayez {when} ou écrivez à {email}.",
    "tooManyPlain": "Trop d’envois depuis cet appareil. Réessayez {when}.",
    "unavailable": "Cette page n’est pas disponible.",
    "noScript": "Ce formulaire a besoin de JavaScript.",
    "noScriptWrite": "Vous pouvez aussi écrire à {email}.",
    "offline": "Cette page n’a pas pu être atteinte.",
    "offlineBody": "Vérifiez votre connexion et réessayez.",
    "retry": "Réessayer",
    "continue": "Continuer"
  },
  "chat": {
    "noScript": "Cette discussion a besoin de JavaScript.",
    "asked": "Vous avez demandé à parler à une personne.",
    "automatic": "Réponse automatique",
    "automaticIn": "Réponse automatique · en {language}",
    "away": {
      "again": "Écrivez-nous à nouveau à ce moment-là.",
      "later": "Écrivez-nous à nouveau plus tard.",
      "leave": "Laissez votre question et votre e-mail, et nous vous répondrons par e-mail.",
      "now": "Nous sommes absents pour le moment.",
      "sent": "{day, select, today {Merci. Nous répondrons à {email} après {time}.} tomorrow {Merci. Nous répondrons à {email} après {time}.} date {Merci. Nous répondrons à {email} le {date} après {time}.} other {Merci. Nous répondrons à {email} {weekday} après {time}.}}",
      "sentNone": "Merci. Nous répondrons à {email}.",
      "until": "{day, select, today {Nous sommes absents jusqu’à {time} aujourd’hui.} tomorrow {Nous sommes absents jusqu’à demain {time}.} date {Nous sommes absents jusqu’au {date} à {time}.} other {Nous sommes absents jusqu’à {weekday} {time}.}}"
    },
    "card": {
      "badEmail": "Saisissez un e-mail comme name@company.example",
      "badName": "Écrivez votre nom sans adresse web.",
      "change": "Modifier",
      "email": "Votre e-mail",
      "emailOptional": "Votre e-mail (facultatif)",
      "helper": "Pour pouvoir vous répondre si vous fermez cette page.",
      "name": "Votre nom (facultatif)",
      "needEmail": "Saisissez votre e-mail pour que nous puissions vous répondre.",
      "needOne": "Ajoutez d’abord votre nom ou votre e-mail.",
      "needQuestion": "Écrivez d’abord votre question.",
      "question": "Votre question",
      "save": "Enregistrer",
      "send": "Envoyer"
    },
    "close": "Fermer la discussion",
    "closed": "Cette discussion a été fermée · {time}",
    "closedBy": "{name} a fermé cette discussion · {time}",
    "done": {
      "leave": "Si vous partez, nous répondrons à {email}.",
      "named": "Merci, {name}.",
      "stay": "Gardez cette page ouverte pour voir la réponse.",
      "thanks": "Merci."
    },
    "first": {
      "automatic": "Certaines réponses ici sont automatiques, choisies parmi des réponses rédigées par {business}. Une personne peut prendre le relais à tout moment. Vos messages sont lus par un service d’IA ({service}).",
      "drafts": "Une personne répond ici. L’équipe peut utiliser un service d’IA ({service}) pour l’aider à rédiger les réponses.",
      "person": "Une personne répond ici."
    },
    "from": "{name} de {business}",
    "hand": {
      "info": "Une personne va vous répondre ici. Gardez cette page ouverte pour voir la réponse.",
      "text": "Une personne va vous répondre ici."
    },
    "hide": "Masquer la discussion",
    "hours": {
      "openUntil": "Ouvert aujourd’hui jusqu’à {time}",
      "opens": "{day, select, today {Ouvre aujourd’hui à {time}} tomorrow {Ouvre demain à {time}} date {Ouvre le {date} à {time}} other {Ouvre {weekday} à {time}}}"
    },
    "hoursEnded": {
      "next": "{day, select, today {Les horaires de {business} se sont terminés à {closing}. Une personne peut encore répondre ; sinon, nous répondrons aujourd’hui après {time}.} tomorrow {Les horaires de {business} se sont terminés à {closing}. Une personne peut encore répondre ; sinon, nous répondrons demain après {time}.} date {Les horaires de {business} se sont terminés à {closing}. Une personne peut encore répondre ; sinon, nous répondrons le {date} après {time}.} other {Les horaires de {business} se sont terminés à {closing}. Une personne peut encore répondre ; sinon, nous répondrons {weekday} après {time}.}}",
      "none": "Les horaires de {business} se sont terminés à {closing}. Une personne peut encore répondre."
    },
    "language": "Langue",
    "languageOf": "Langue : {name}",
    "log": "Messages",
    "lost": "Nous n’avons pas retrouvé votre discussion précédente. Commencez-en une nouvelle ci-dessous.",
    "newChat": "Commencer une nouvelle discussion",
    "newMessages": "{count, plural, one {{n} nouveau message de {business}} other {{n} nouveaux messages de {business}}}",
    "newTab": "(s’ouvre dans un nouvel onglet)",
    "offline": "Impossible de joindre {business}. Nouvel essai en cours…",
    "privacy": "Avis de confidentialité.",
    "rate": {
      "chat": "Vous avez envoyé beaucoup de messages dans cette discussion.",
      "minute": "Vous avez envoyé beaucoup de messages. Attendez une minute, puis réessayez.",
      "wait": "Vous avez envoyé beaucoup de messages. Attendez {minutes, plural, one {{n} minute} other {{n} minutes}}, puis réessayez."
    },
    "reopened": "Cette discussion a été rouverte · {time}",
    "reopenedBy": "{name} a rouvert cette discussion · {time}",
    "resumed": "Votre discussion de {time}",
    "send": "Envoyer",
    "status": {
      "checking": "Vérification que vous êtes une personne…",
      "failed": "Nous n’avons pas pu vérifier que vous êtes une personne.",
      "notSent": "Non envoyé.",
      "queued": "En attente d’envoi",
      "retry": "Réessayer"
    },
    "talk": "Parler à une personne",
    "waiting": "Toujours en attente de quelqu’un chez {business}.",
    "waitingMail": "Toujours en attente de quelqu’un chez {business}. Vous pouvez laisser votre e-mail et fermer cette page.",
    "with": "Discuter avec {business}",
    "withNew": "Discuter avec {business}, {count, plural, one {{n} nouveau message} other {{n} nouveaux messages}}",
    "write": "Écrire un message…"
  }
} as const;
