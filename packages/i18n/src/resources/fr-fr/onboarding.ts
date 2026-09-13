// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/onboarding.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "account": {
    "body": "Le premier administrateur. Cela n’arrive qu’une fois, et vous restez connecté ensuite.",
    "confirm": "Confirmer le mot de passe",
    "email": "E-mail",
    "hidePassword": "Masquer le mot de passe",
    "label": "Votre compte",
    "name": "Votre nom",
    "password": "Mot de passe",
    "passwordHelper": "Au moins {min} caractères.",
    "showPassword": "Afficher le mot de passe",
    "strength": "Robustesse du mot de passe",
    "strengthLevels": {
      "fair": "Correct",
      "good": "Bon",
      "strong": "Robuste",
      "weak": "Faible"
    },
    "sub": "Identifiants",
    "submit": "Créer le compte",
    "title": "Créez votre compte"
  },
  "back": "Retour",
  "connect": {
    "body": "Indiquez une source de données à Adminium. Nous lisons le schéma et n’y écrivons jamais, sauf si vous le demandez.",
    "bridge": {
      "body": "Elle a été transmise depuis adminium.dev. Créez votre compte et nous l’ouvrirons dans l’assistant de connexion, où vous pourrez la lire avant que quoi que ce soit ne l’utilise.",
      "title": "Une chaîne de connexion attend cette instance"
    },
    "dsn": {
      "checking": "Vérification de cette base…",
      "helper": "Rien ne quitte ce navigateur tant que votre compte n’existe pas — nous la testerons ensuite.",
      "incomplete": "Ajoutez l’hôte et la base, par ex. postgres://user@host:5432/db",
      "invalidScheme": "Schéma non reconnu — attendu : postgres://, mysql://, mariadb:// ou sqlite:",
      "label": "Chaîne de connexion"
    },
    "engine": {
      "mysql": "MySQL / MariaDB",
      "postgres": "PostgreSQL",
      "sqlite": "SQLite"
    },
    "engineLabel": "Moteur de base de données",
    "existing": {
      "adopt": "L’utiliser et se connecter",
      "adopting": "Orientation de cette instance vers elle…",
      "body": "Elle contient {count, plural, one {# table Adminium} other {# tables Adminium}} avec des données. Deux possibilités :",
      "failed": "Impossible d’orienter cette instance vers cette base.",
      "otherSecret": "Elle a été configurée avec un autre ADMINIUM_SECRET : la connexion fonctionnerait, mais cette instance ne peut pas déchiffrer ses chaînes de connexion enregistrées.",
      "park": "Les garder et repartir de zéro",
      "parked": {
        "body": "Elles sont renommées et mises de côté — chaque ligne survit — et Adminium repart avec des tables neuves à côté. Rien ne se passe tant que vous ne placez pas les données d’Adminium dans cette base.",
        "title": "Les tables présentes seront conservées"
      },
      "restarting": "Redémarrage sur elle…",
      "timeout": "Adminium est orienté vers cette base mais n’est pas encore revenu — rechargez cette page dans un instant.",
      "title": "Cette base fait déjà tourner un Adminium"
    },
    "label": "Connecter les données",
    "sub": "Relier une base",
    "title": "Connectez votre base de données"
  },
  "continue": "Continuer",
  "done": {
    "connected": {
      "reading": "Connecté — Adminium lit votre schéma.",
      "tables": "Connecté · {count, plural, one {# table trouvée} other {# tables trouvées}}."
    },
    "invited": "{count, plural, one {# invitation créée} other {# invitations créées}}.",
    "label": "Tout est prêt",
    "next": {
      "blank": "Votre espace est prêt. Ajoutez une page quand vous voulez — rien n’a été généré, exactement comme demandé.",
      "generate": "Votre espace est prêt. Nous allons maintenant choisir les tables à inclure et générer vos pages."
    },
    "storage": {
      "local": "Adminium conserve ses propres données dans un fichier sur cette machine.",
      "sameDb": "Adminium conserve ses propres données dans la base que vous avez connectée.",
      "separate": "Adminium conserve ses propres données dans la base que vous lui avez donnée."
    },
    "sub": "Commencer",
    "title": "Tout est prêt ! 🎉"
  },
  "error": {
    "alreadyCompleted": "Cette instance est déjà configurée. Connectez-vous avec le compte administrateur existant.",
    "connectionFailed": "Votre compte a été créé et vous êtes connecté — mais cette base est injoignable : {detail}",
    "connectionUnknown": "la base n’a pas répondu",
    "failed": "La configuration a échoué. Vérifiez votre connexion et réessayez.",
    "rejected": "Le serveur a refusé ces informations. Vérifiez l’e-mail et le mot de passe, puis réessayez."
  },
  "finish": "Aller au tableau de bord",
  "kicker": "Étape {n} sur {total}",
  "meta": {
    "body": "Votre connexion, les pages générées et vos réglages enregistrés. C’est distinct de la base que vous venez de connecter, qu’Adminium se contente de lire.",
    "label": "Les données d’Adminium",
    "local": {
      "body": "Rien à configurer. Idéal pour essayer Adminium, ou pour une instance unique.",
      "title": "Dans un fichier sur cette machine"
    },
    "moving": {
      "copying": "Copie des données d’Adminium…",
      "failed": "Impossible de déplacer les données d’Adminium — réessayez.",
      "restarting": "Redémarrage sur la nouvelle base…",
      "timeout": "Adminium a déplacé ses données mais n’est pas encore revenu. Elles sont en sécurité dans la nouvelle base — rechargez cette page dans un instant."
    },
    "pinned": {
      "body": "Cette instance a démarré avec son magasin méta déjà configuré : il n’y a rien à déplacer. Vous pourrez le changer plus tard depuis les réglages du Studio.",
      "title": "Les données d’Adminium ont déjà un logement"
    },
    "sameDb": {
      "alreadyAdminium": "Cette base contient déjà une instance Adminium. Revenez à l’étape précédente pour conserver ses tables et repartir à côté, ou connectez-vous à elle.",
      "body": "Adminium ajoute ses propres tables `adminium_` à côté des vôtres. Une seule base à sauvegarder.",
      "disabledFile": "Un fichier SQLite n’est pas un serveur auquel Adminium peut ajouter ses propres tables.",
      "disabledNoDdl": "Ce rôle ne peut pas exécuter CREATE TABLE, dont les migrations d’Adminium ont besoin.",
      "disabledReadOnly": "Ce rôle est en lecture seule — Adminium n’écrit jamais dans votre base. Gardez ses données dans un fichier, ou donnez-lui une base à lui.",
      "noSource": "Vous n’avez pas encore connecté de base — connectez-en une d’abord, ou gardez les données d’Adminium dans un fichier.",
      "parked": "Les tables Adminium déjà présentes sont d’abord renommées et mises de côté — chaque ligne survit — et Adminium repart avec des tables neuves à côté.",
      "title": "Dans la base que vous venez de connecter"
    },
    "separate": {
      "body": "Une base PostgreSQL ou MySQL que vous fournissez. Idéal en production, ou pour plusieurs instances.",
      "failed": "Cette base n’a pas répondu.",
      "incomplete": "Ajoutez l’hôte et la base, par ex. postgres://user@host:5432/adminium",
      "insufficient": "Ce rôle ne peut pas exécuter CREATE TABLE — les migrations d’Adminium en ont besoin.",
      "invalidScheme": "Schéma non reconnu — attendu : postgres://, mysql:// ou mariadb://",
      "label": "Chaîne de connexion pour Adminium",
      "ok": "Joignable, et capable de créer des tables.",
      "test": "Tester cette base",
      "title": "Dans une base qui lui est propre"
    },
    "sub": "Où elles vivent",
    "title": "Où Adminium conserve ses propres données"
  },
  "progressComplete": "{percent} % effectué",
  "progressLabel": "Progression de la configuration",
  "skip": "Passer",
  "start": {
    "body": "Cela ne détermine que les pages que nous générons pour vous. Vous pourrez tout changer plus tard, ou partir de rien.",
    "label": "Point de départ",
    "options": {
      "analytics": {
        "body": "Graphiques et tableaux à lire. Rien n’est réécrit.",
        "title": "Analyses en lecture seule"
      },
      "blank": {
        "body": "Ne rien générer. Connectez une base et construisez les pages que vous voulez, une par une.",
        "title": "Page blanche"
      },
      "crud": {
        "body": "Tables et formulaires, sans les tableaux de bord.",
        "title": "Tables CRUD"
      },
      "fullAdmin": {
        "body": "Une page par table, avec création, modification et suppression.",
        "title": "Panneau d’administration complet"
      },
      "support": {
        "body": "D’abord les files d’attente et les fiches clients, suppression désactivée.",
        "title": "Console de support"
      }
    },
    "sub": "Choisir une forme",
    "title": "Qu’allez-vous construire en premier ?"
  },
  "team": {
    "body": "Invitez les personnes avec qui vous travaillez. Vous pourrez toujours en ajouter plus tard.",
    "copied": "Copié",
    "copyLink": "Copier le lien",
    "duplicate": "Cette personne a déjà été invitée.",
    "emailLabel": "E-mail de votre collègue",
    "emailed": "Invitation envoyée par e-mail",
    "failed": "Cette invitation n’a pas pu être créée.",
    "invalidEmail": "Saisissez une adresse e-mail valide.",
    "invite": "Inviter",
    "label": "Votre équipe",
    "note": "Les invitations sans e-mail affichent un lien que vous envoyez vous-même. Il n’est montré qu’une fois — Adminium n’en garde qu’une empreinte.",
    "placeholder": "collegue@entreprise.com",
    "sub": "Ajouter des personnes",
    "title": "Faites venir votre équipe"
  }
} as const;
