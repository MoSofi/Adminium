// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/addOns.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "notInstalled": {
    "title": "Ce module n’est pas installé",
    "body": "La page que vous avez ouverte appartient à un module qui n’est pas installé sur ce serveur, ou qui a été désactivé. Un administrateur peut l’installer depuis le Studio."
  },
  "unknown": {
    "title": "Page introuvable",
    "body": "Ce module est installé, mais il n’a aucune page à cette adresse."
  },
  "retry": "Réessayer",
  "noBundle": {
    "title": "Cette page n’a pas pu être chargée",
    "body": "Le module annonce cette page mais ne fournit pas le fichier correspondant. Le réinstaller, ou passer à une version plus récente, corrige ce problème."
  },
  "failed": {
    "title": "Cette page n’a pas pu être chargée",
    "body": "Le code du module n’a pas pu être récupéré, ou il ne correspondait pas à l’empreinte enregistrée lors de l’installation. Rien n’en a été exécuté."
  },
  "refused": {
    "body": "Le code de la page s’est chargé, mais le serveur a refusé une de ses demandes : {reason}"
  },
  "crashed": {
    "body": "Le code de la page s’est chargé, puis s’est arrêté sur une erreur : {reason}"
  },
  "listFailed": {
    "body": "La liste des modules installés n’a pas pu être lue ; impossible donc de savoir quel fichier cette page doit charger."
  },
  "tooOld": {
    "title": "Cette page demande un Adminium plus récent",
    "body": "La page de ce module a été conçue pour une version d'Adminium plus récente que celle-ci. Mettre Adminium à jour l'ouvrira ; rien de cette page n'a été exécuté."
  },
  "accounts": {
    "notice": {
      "connectedTitle": "{person} a connecté un compte",
      "connectedBody": "{person} est maintenant connecté à {provider} avec le compte {account}.",
      "refusedTitle": "{provider} a refusé l’application de ce serveur",
      "refusedBody": "Vérifiez l’ID client et le secret enregistrés pour {provider}. Personne n’a besoin de se reconnecter : les connexions reprendront dès que l’application sera acceptée.",
      "clashTitle": "{person} a un conflit d’agenda",
      "clashBody": "Un créneau occupé dans l’agenda de {person} chevauche désormais une réservation. Ouvrez la réservation pour la déplacer ou la conserver.",
      "staleTitle": "Les créneaux occupés de {person} ont été retirés",
      "staleBody": "{person} ne s’est pas reconnecté depuis 7 jours : son agenda ne bloque plus de créneaux.",
      "removedTitle": "{person} a supprimé l’agenda {calendar}",
      "removedBody": "Il a été supprimé deux fois en une semaine : les réservations ne vont plus dans l’agenda de {person} tant que cette personne ne les réactive pas.",
      "remadeTitle": "L’agenda {calendar} a été recréé",
      "remadeBody": "Il a été supprimé du compte de {person} : il a donc été recréé avec ses prochaines réservations.",
      "silentTitle": "Les changements de l’agenda de {person} arrivent en retard",
      "silentBody": "Les mises à jour instantanées se sont arrêtées : les changements arrivent avec la vérification régulière, sous 12 minutes environ.",
      "secretEndingTitle": "Le secret client {provider} expire le {date}",
      "secretEndingBody": "Créez un nouveau secret client et collez-le dans le guide de configuration avant cette date, sinon toutes les connexions {provider} s’arrêteront. Personne n’aura à se reconnecter.",
      "unreadableTitle": "Un agenda de {person} ne peut plus être lu",
      "unreadableBody": "Il a été supprimé ou n’est plus partagé. Il a donc été retiré des agendas comptés comme occupés et ne bloque plus les créneaux de {person}. Les autres agendas continuent de le faire."
    }
  }
} as const;
