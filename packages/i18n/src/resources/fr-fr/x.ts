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
  }
} as const;
