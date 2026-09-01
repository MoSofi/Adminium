// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/common.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "common": {
    "dismiss": "Fermer",
    "notifications": "Notifications",
    "retry": "Réessayer",
    "undo": "Annuler",
    "close": "Fermer",
    "cancel": "Annuler",
    "back": "Retour",
    "loading": "Chargement",
    "clearSearch": "Effacer la recherche",
    "clear": "Effacer",
    "save": "Enregistrer"
  },
  "auth": {
    "headline": "Transformez n’importe quelle base de données en tableau de bord.",
    "description": "Connectez PostgreSQL et Adminium génère une application d’administration personnalisable et respectueuse des permissions — sans écrire une ligne de code.",
    "trust": "Cœur AGPL · Auto-hébergé · Vos données restent les vôtres",
    "signIn": {
      "title": "Bon retour",
      "subtitle": "Connectez-vous à votre espace de travail Adminium.",
      "email": "E-mail",
      "emailInvalid": "Saisissez une adresse e-mail valide.",
      "password": "Mot de passe",
      "passwordRequired": "Saisissez votre mot de passe.",
      "showPassword": "Afficher le mot de passe",
      "hidePassword": "Masquer le mot de passe",
      "remember": "Rester connecté",
      "forgot": "Oublié ?",
      "submit": "Se connecter",
      "invalid": "E-mail ou mot de passe invalide.",
      "rateLimited": "Trop de tentatives — réessayez dans une minute.",
      "failed": "Échec de la connexion. Vérifiez votre connexion et réessayez."
    },
    "forgot": {
      "title": "Réinitialiser votre mot de passe",
      "email": "E-mail",
      "emailInvalid": "Saisissez une adresse e-mail valide.",
      "submit": "Envoyer le lien de réinitialisation",
      "sentTitle": "Consultez votre boîte mail",
      "resend": "Renvoyer",
      "back": "Retour à la connexion",
      "done": "Retour à la connexion",
      "rateLimited": "Trop de demandes — réessayez plus tard.",
      "failed": "Une erreur s’est produite. Réessayez.",
      "smtpUnconfigured": "Cet Adminium n'a pas de serveur e-mail configuré : il ne peut pas envoyer de lien de réinitialisation. Demandez à un administrateur de réinitialiser votre mot de passe.",
      "subtitle": "Saisissez votre adresse e-mail et nous vous enverrons un lien de réinitialisation.",
      "sentBody": "Nous avons envoyé un lien de réinitialisation à {email}. Il expire dans 15 minutes.",
      "resendHint": "Vous ne l’avez pas reçu ?"
    },
    "reset": {
      "title": "Définir un nouveau mot de passe",
      "subtitle": "8 caractères minimum.",
      "password": "Nouveau mot de passe",
      "confirm": "Confirmer le mot de passe",
      "showPassword": "Afficher le mot de passe",
      "hidePassword": "Masquer le mot de passe",
      "strength": "Robustesse du mot de passe",
      "weak": "Faible",
      "fair": "Moyen",
      "good": "Bon",
      "strong": "Fort",
      "tooShort": "Utilisez au moins 8 caractères.",
      "submit": "Réinitialiser le mot de passe",
      "failed": "Échec de la réinitialisation. Réessayez.",
      "mismatch": "Les mots de passe ne correspondent pas."
    },
    "otp": {
      "title": "Authentification à deux facteurs",
      "subtitle": "Saisissez le code à 6 chiffres de votre application d’authentification.",
      "code": "Code à usage unique",
      "recoveryCode": "Code de récupération",
      "useRecovery": "Appareil perdu ? Utilisez un code de récupération",
      "useAuthenticator": "Utiliser plutôt votre application d’authentification",
      "submit": "Vérifier",
      "invalid": "Ce code n’a pas fonctionné. Réessayez.",
      "failed": "Échec de la vérification. Vérifiez votre connexion et réessayez."
    }
  },
  "nav": {
    "home": "Accueil",
    "primary": "Principal",
    "account": "Compte",
    "signOut": "Se déconnecter",
    "empty": "Les pages apparaîtront ici une fois une base de données connectée.",
    "connection": {
      "shared": "Partagé",
      "unnamed": "Connexion"
    },
    "imports": "Importer des données",
    "exports": "Exports de données",
    "emailTemplates": "Modèles d’e-mail",
    "notificationSettings": "Paramètres de notification",
    "scheduledReports": "Rapports planifiés",
    "group": {
      "workspace": "Espace de travail",
      "library": "Bibliothèque",
      "planning": "Planification",
      "people": "Personnes",
      "account": "Compte"
    },
    "back": "Retour",
    "team": "Équipe",
    "roles": "Rôles et permissions",
    "audit": "Journal d’audit",
    "security": "Mot de passe et sessions"
  },
  "apps": {
    "frame": {
      "noFrames": "Cette application nécessite un navigateur prenant en charge les cadres."
    }
  },
  "topbar": {
    "search": "Rechercher…",
    "notifications": "Notifications",
    "notificationsLoading": "Chargement des notifications",
    "notificationsError": "Impossible de charger les notifications.",
    "notificationsEmpty": "Vous êtes à jour.",
    "theme": "Basculer clair / sombre",
    "userMenu": "Menu du compte",
    "profile": "Profil",
    "preferences": "Préférences",
    "studio": "Studio",
    "dataConnections": "Connexions de données",
    "workspaceSettings": "Paramètres de l’espace de travail",
    "signOut": "Se déconnecter"
  },
  "palette": {
    "dialog": "Palette de commandes",
    "placeholder": "Saisissez une commande ou recherchez…",
    "navigate": "Naviguer",
    "actions": "Actions",
    "askAi": "Demander à l’IA",
    "shortcuts": "Raccourcis clavier",
    "signOut": "Se déconnecter",
    "themeDark": "Mode sombre",
    "themeLight": "Mode clair",
    "footerNavigate": "naviguer",
    "footerOpen": "sélectionner",
    "footerClose": "fermer",
    "recent": "Récents",
    "searching": "Recherche d’enregistrements…",
    "records": "Enregistrements",
    "empty": "Aucun résultat pour « {query} »"
  },
  "shortcuts": {
    "title": "Raccourcis clavier",
    "subtitle": "Travaillez plus vite dans tout Adminium",
    "close": "Fermer",
    "dismiss": "Fermer ou ignorer",
    "palette": "Ouvrir la palette de commandes",
    "panel": "Afficher le panneau des raccourcis",
    "search": "Activer la recherche",
    "sidebar": "Afficher/masquer la barre latérale",
    "studio": "Aller au Studio",
    "theme": "Basculer clair / sombre",
    "then": "puis",
    "footerPre": "Appuyez sur",
    "footerPost": "à tout moment pour ouvrir ce panneau."
  },
  "states": {
    "checked": "vérifié il y a 8 s",
    "diagnostics": "Diagnostics",
    "reference": {
      "label": "Référence",
      "copy": "Copier la référence",
      "copied": "Copié",
      "hint": "Indiquez-la lorsque vous signalez le problème — le journal de votre serveur contient le même identifiant."
    },
    "notFound": {
      "title": "Page introuvable",
      "body": "Nous n’avons pas trouvé cette page. Elle a peut-être été déplacée, ou le lien est rompu.",
      "primary": "Retour au tableau de bord",
      "secondary": "Contacter le support"
    },
    "forbidden": {
      "title": "Vous n’avez pas accès",
      "body": "Ce tableau de bord est restreint. Demandez à un administrateur de l’espace de travail de vous donner accès.",
      "primary": "Demander l’accès",
      "secondary": "Retour"
    },
    "error": {
      "title": "Une erreur est survenue",
      "body": "Adminium a rencontré une erreur inattendue en traitant cette requête. Les détails se trouvent dans le journal du serveur.",
      "primary": "Réessayer"
    },
    "dbUnreachable": {
      "title": "Base de données injoignable",
      "body": "Impossible de joindre prod-db. Vos tableaux de bord reprendront une fois la connexion rétablie.",
      "primary": "Réessayer la connexion",
      "secondary": "Modifier la connexion",
      "diag": {
        "status": "connexion expirée (10 s)",
        "hint": "autorisez 52.9.14.2, puis réessayez"
      }
    },
    "maintenance": {
      "title": "Maintenance planifiée",
      "body": "Adminium est en maintenance et sera de retour sous peu. Merci de votre patience.",
      "primary": "Voir le statut"
    },
    "rateLimited": {
      "title": "Limite de requêtes atteinte",
      "body": "Trop de requêtes en peu de temps. Patientez quelques minutes, puis réessayez.",
      "primary": "Réessayer",
      "secondary": "Retour"
    },
    "offline": {
      "title": "Vous êtes hors ligne",
      "body": "Vérifiez votre connexion Internet. Adminium se reconnectera automatiquement dès votre retour en ligne.",
      "primary": "Réessayer maintenant",
      "banner": "Hors ligne — tentative de reconnexion…"
    },
    "expiredLink": {
      "title": "Ce lien a expiré",
      "body": "Les liens de connexion magiques expirent au bout de 10 minutes. Demandez-en un nouveau pour continuer.",
      "primary": "Envoyer un nouveau lien",
      "secondary": "Retour à la connexion"
    },
    "expiredSession": {
      "title": "Votre session a expiré",
      "body": "Pour votre sécurité, vous avez été déconnecté après une période d’inactivité. Connectez-vous pour reprendre où vous en étiez.",
      "primary": "Se reconnecter"
    },
    "emptyNoSources": {
      "title": "Aucune source de données",
      "body": "Connectez une base de données PostgreSQL et Adminium générera votre premier tableau de bord d’administration.",
      "primary": "Connecter une base de données",
      "secondary": "Importer des données d’exemple"
    },
    "readOnly": {
      "title": "Mode lecture seule",
      "body": "Vous disposez d’un accès Viewer à cet espace de travail. Vous pouvez explorer les tableaux de bord, mais l’édition et les actions destructrices sont désactivées.",
      "primary": "Demander l’accès en écriture",
      "secondary": "J’ai compris"
    },
    "suspended": {
      "title": "Cet espace de travail est suspendu",
      "body": "Cet espace de travail a été suspendu par un administrateur. Vos données sont conservées — contactez le propriétaire de l’espace de travail pour rétablir l’accès.",
      "primary": "Contacter le propriétaire",
      "secondary": "Retour"
    },
    "connectionPaused": {
      "title": "Cette connexion est en pause",
      "body": "Un administrateur a mis en pause la base de données derrière cette page, qui ne charge donc aucune donnée pour le moment. Rien n’a été supprimé — tout revient dès que la connexion est reprise dans Studio → Connexions de données.",
      "secondary": "Retour"
    }
  },
  "notFound": {
    "title": "Cette page a disparu",
    "body": "La page que vous cherchez n’existe pas ou a été déplacée. Vérifiez l’URL, ou revenez à votre tableau de bord.",
    "errorLine": "Erreur 404",
    "searchPlaceholder": "Rechercher une page…",
    "matches": "Pages correspondantes",
    "popular": "Destinations populaires",
    "goBack": "Retour",
    "backToDashboard": "Retour au tableau de bord",
    "noMatches": "Aucune page ne correspond à « {query} »"
  },
  "page": {
    "invalid": {
      "title": "La configuration de cette page est invalide",
      "body": "Le document de page enregistré a échoué à la validation et ne peut pas être affiché."
    },
    "renderError": {
      "title": "Cette page n’a pas pu s’afficher"
    },
    "tooNew": {
      "title": "Cette page nécessite une version plus récente d’Adminium",
      "body": "Cette page a été enregistrée avec la version de configuration {version}, mais cette version d’Adminium ne comprend que jusqu’à la version {latest}. Mettez Adminium à jour pour l’ouvrir."
    },
    "unknownTemplate": {
      "title": "Modèle de page inconnu",
      "body": "Cette page utilise un modèle que cette version ne reconnaît pas. Il provient peut-être d’un Adminium plus récent ou d’une extension qui n’est pas installée."
    }
  },
  "mutation": {
    "created": "Enregistrement créé",
    "updated": "Enregistrement mis à jour",
    "deleted": "Enregistrement supprimé"
  },
  "undo": {
    "done": "Modification annulée",
    "failed": "Impossible d’annuler cette modification"
  },
  "prefs": {
    "theme": {
      "label": "Thème",
      "light": "Clair",
      "dark": "Sombre",
      "system": "Système"
    },
    "accent": {
      "label": "Couleur d’accent",
      "indigo": "Indigo",
      "blue": "Bleu",
      "teal": "Bleu canard",
      "violet": "Violet",
      "rose": "Rose",
      "red": "Rouge",
      "orange": "Orange",
      "black": "Noir"
    },
    "density": {
      "label": "Densité",
      "comfortable": "Confortable",
      "compact": "Compacte"
    },
    "locale": {
      "label": "Langue",
      "directionNote": "Sens du texte : de droite à gauche (défini automatiquement par la langue)",
      "communityDraft": "Cette traduction est une version communautaire : elle n’a pas encore été relue par un locuteur natif."
    }
  },
  "account": {
    "title": "Compte",
    "subtitle": "L'identité de votre session en cours. Gérez les préférences d'affichage et les paramètres de notification sur leurs pages dédiées.",
    "preferencesLink": "Préférences",
    "notificationsLink": "Paramètres de notification",
    "name": "Nom",
    "email": "E-mail",
    "roles": "Rôles",
    "twoFactor": "Double authentification",
    "on": "Activée",
    "off": "Désactivée",
    "nameRequired": "Saisissez votre nom.",
    "emailHelper": "Sert à vous connecter. La modifier requiert votre mot de passe.",
    "confirmPassword": "Mot de passe actuel",
    "confirmPasswordHelper": "Confirmez votre identité avant que votre adresse de connexion ne change.",
    "save": "Enregistrer les modifications",
    "saveFailed": "Impossible d’enregistrer votre profil",
    "saved": "Profil mis à jour",
    "savedBody": "Vos nouvelles informations s’appliquent à tout l’espace de travail. Si vous avez changé d’e-mail, connectez-vous désormais avec la nouvelle adresse.",
    "accessTitle": "Accès",
    "accessSubtitle": "Ce que ce compte peut faire, et comment il prouve son identité.",
    "rolesHelper": "Les rôles sont attribués par un administrateur et ne peuvent pas être modifiés depuis votre propre compte.",
    "manageTwoFactor": "Gérer",
    "setUpTwoFactor": "Configurer",
    "securityLink": "Mot de passe et sessions",
    "preferences": {
      "title": "Préférences",
      "subtitle": "L’apparence et la langue d’Adminium pour vous — sur cet appareil et tous ceux où vous vous connectez.",
      "workspaceDefault": "Valeur de l’espace de travail",
      "personal": "Personnel",
      "usingDefault": "Valeur par défaut de l’espace de travail utilisée ({value})",
      "reset": "Rétablir la valeur de l’espace de travail",
      "resetFailed": "Impossible de réinitialiser cette préférence. Réessayez.",
      "appliesInstantly": "Les changements s’appliquent immédiatement et sont enregistrés dans votre profil."
    }
  },
  "settings": {
    "defaults": {
      "title": "Valeurs par défaut globales",
      "subtitle": "Apparence et langue par défaut pour tout l’espace de travail.",
      "explainer": "Ces valeurs par défaut s’appliquent à tous les utilisateurs tant qu’ils ne les remplacent pas. Chacun peut définir ses propres préférences dans Profil → Préférences — les préférences personnelles l’emportent toujours pour cet utilisateur.",
      "appearanceHeading": "Apparence par défaut",
      "languageHeading": "Langue et région par défaut",
      "adoption": "{following, number} sur {total, plural, one {# utilisateur} other {# utilisateurs}} suivent cette valeur par défaut.",
      "weekStartNote": "Le premier jour de la semaine et les formats de nombres suivent la langue.",
      "save": "Enregistrer les valeurs par défaut",
      "saved": "Valeurs par défaut de l’espace de travail mises à jour",
      "saveFailed": "Impossible d’enregistrer les valeurs par défaut. Réessayez.",
      "liveNote": "L’enregistrement diffuse le changement en direct — les utilisateurs connectés qui suivent une valeur par défaut la voient s’appliquer sans recharger."
    },
    "notifications": {
      "subtitle": "Choisissez de quoi vous êtes notifié et comment",
      "matrixLabel": "Me notifier pour",
      "rowHeader": "Événement",
      "saving": "Enregistrement…",
      "saved": "Enregistré",
      "unavailable": "Pas encore disponible",
      "loading": "Chargement des préférences",
      "errorTitle": "Ces paramètres n’ont pas pu être chargés",
      "emptyTitle": "Rien à configurer pour l’instant",
      "emptyBody": "Les événements de notification apparaissent ici à mesure que leurs producteurs sont livrés.",
      "saveFailed": "Impossible d’enregistrer cette modification."
    },
    "translations": {
      "title": "Langues et traductions",
      "subtitle": "Modifiez n’importe quelle formulation d’Adminium, choisissez les langues proposées et ajoutez les vôtres.",
      "warning": "Les messages d’erreur et les textes de connexion sont modifiables eux aussi. Ce sont eux que l’on lit quand quelque chose ne va pas : modifiez-les avec précaution.",
      "editor": {
        "heading": "Modifier les traductions"
      },
      "localeLabel": "Langue",
      "groupLabel": "Section",
      "allAreas": "Toutes les sections",
      "stateLabel": "Afficher",
      "state": {
        "all": "Tout",
        "overridden": "Personnalisés uniquement",
        "untranslated": "Non traduits uniquement",
        "stale": "Anglais modifié depuis"
      },
      "searchLabel": "Rechercher",
      "searchPlaceholder": "Clé ou texte anglais",
      "loading": "Chargement des textes…",
      "noMatches": "Aucun texte ne correspond à ces filtres.",
      "count": "{total, plural, one {# texte} other {# textes}}",
      "badge": {
        "custom": "Personnalisé",
        "stale": "Anglais modifié",
        "a11y": "Nom accessible"
      },
      "sourceLabel": "Source anglaise",
      "valueLabel": "Traduction",
      "save": "Enregistrer",
      "saved": "Traduction enregistrée",
      "resetAction": "Rétablir le texte d’origine",
      "reset": "Texte d’origine rétabli",
      "locales": {
        "heading": "Langues disponibles",
        "help": "Désactivez une langue pour la retirer de tous les sélecteurs de langue. Les personnes qui l’utilisent déjà la conservent jusqu’à ce qu’elles en choisissent une autre."
      },
      "locale": {
        "builtin": "Intégrée",
        "custom": "Personnalisée",
        "overrides": "{count, plural, =0 {aucun texte personnalisé} one {# texte personnalisé} other {# textes personnalisés}}",
        "enable": "Activer",
        "disable": "Désactiver",
        "delete": "Supprimer",
        "deleted": "Langue supprimée",
        "deletedDetail": "{users, plural, one {# personne est revenue} other {# personnes sont revenues}} à la langue par défaut de l’espace de travail ; {strings, plural, one {# traduction supprimée} other {# traductions supprimées}}.",
        "deleteFailed": "Impossible de supprimer cette langue",
        "add": "Ajouter une langue",
        "added": "Langue ajoutée",
        "create": "Ajouter la langue",
        "id": "Code de langue",
        "intlTag": "Règles de format issues de",
        "native": "Nom dans la langue elle-même",
        "english": "Nom en anglais",
        "dir": "Sens du texte",
        "ltr": "De gauche à droite",
        "rtl": "De droite à gauche",
        "font": "Écriture",
        "latin": "Latine",
        "arabic": "Arabe",
        "cjk": "Chinois / japonais / coréen",
        "intlHelp": "Les règles de format déterminent le comportement des nombres, des dates et des pluriels. Choisissez la langue la plus proche qui les possède déjà — elle n’a pas à correspondre à votre code de langue."
      }
    }
  },
  "onboarding": {
    "title": "Prise en main",
    "subtitle": "Quelques étapes pour préparer votre espace de travail.",
    "loading": "Chargement de votre liste de configuration…",
    "welcome": "Bienvenue sur Adminium, {name} 👋",
    "progressBody": "Vous avez terminé {done} étapes de configuration sur {total}. Terminez les autres pour débloquer tout l’espace de travail.",
    "completeBody": "Tout est prêt — votre espace de travail est entièrement configuré.",
    "ringLabel": "{done} étapes sur {total} terminées",
    "done": "Terminé",
    "skip": "Plus tard",
    "goToWorkspace": "Aller à l’espace de travail",
    "help": {
      "title": "Besoin d’aide ?",
      "body": "Nous sommes là pour vous aider à configurer rapidement."
    },
    "steps": {
      "connectDatabase": {
        "title": "Connecter une base de données",
        "desc": "Reliez Adminium à votre base Postgres, MySQL ou SQLite — un rôle en lecture seule suffit.",
        "time": "5 min",
        "action": "Connecter"
      },
      "chooseTables": {
        "title": "Choisir vos tables",
        "desc": "Choisissez les tables qui deviennent des pages — les données personnelles sont masquées par défaut.",
        "time": "2 min",
        "action": "Choisir"
      },
      "inviteTeammates": {
        "title": "Inviter des coéquipiers",
        "desc": "Faites venir votre équipe pour explorer et collaborer.",
        "time": "2 min",
        "action": "Inviter"
      },
      "workspaceDefaults": {
        "title": "Définir les valeurs par défaut",
        "desc": "Thème, accent, densité et langue pour tout le monde.",
        "time": "1 min",
        "action": "Définir"
      }
    },
    "entry": {
      "wayBack": "Prise en main · {done}/{total}",
      "dismiss": "Masquer la liste de configuration",
      "continue": "Continuer la configuration",
      "banner": "Terminez la configuration de votre espace — {done} étapes sur {total} effectuées."
    }
  },
  "views": {
    "baseView": "Tous les enregistrements",
    "menuLabel": "Vues enregistrées",
    "saveAs": "Enregistrer la vue actuelle…",
    "updateActive": "Mettre à jour « {name} »",
    "rename": "Renommer…",
    "setDefault": "Définir par défaut",
    "delete": "Supprimer…",
    "saveTitle": "Enregistrer la vue",
    "save": "Enregistrer la vue",
    "renameTitle": "Renommer la vue",
    "saveName": "Enregistrer le nom",
    "nameLabel": "Nom de la vue",
    "namePlaceholder": "ex. Actifs ce mois-ci",
    "nameRequired": "Saisissez un nom pour cette vue.",
    "saveFailed": "Impossible d’enregistrer la vue.",
    "deleteTitle": "Supprimer la vue",
    "deleteBody": "Cela supprime la vue enregistrée. Vos données ne sont pas affectées.",
    "deletePrompt": "Saisissez le nom de la vue pour confirmer",
    "deleteConfirm": "Supprimer la vue",
    "savedToast": "Vue « {name} » enregistrée.",
    "updatedToast": "Vue « {name} » mise à jour.",
    "defaultToast": "« {name} » est désormais la vue par défaut.",
    "deletedToast": "Vue « {name} » supprimée."
  },
  "builder": {
    "view": "Aperçu",
    "edit": "Modifier",
    "done": "Terminé",
    "addWidget": "Ajouter un widget",
    "saveLayout": "Enregistrer la disposition",
    "saving": "Enregistrement…",
    "savedShort": "Enregistré",
    "options": "Options du tableau de bord",
    "resetLayout": "Réinitialiser la disposition",
    "resetTitle": "Réinitialiser à la disposition partagée ?",
    "resetBody": "Cela supprime vos modifications personnelles et restaure le tableau de bord que tout le monde voit. Vos données ne sont pas affectées.",
    "resetConfirm": "Réinitialiser la disposition",
    "resetDone": "Disposition réinitialisée sur la valeur partagée par défaut.",
    "sharedNote": "Vous modifiez le tableau de bord partagé que tout le monde voit.",
    "personalNote": "Vous modifiez votre disposition personnelle — vous seul voyez ces changements.",
    "savedShared": "Tableau de bord enregistré pour tous les utilisateurs autorisés.",
    "empty": "Ce tableau de bord ne contient encore aucun widget.",
    "emptyAction": "Ajouter un widget",
    "palette": {
      "title": "Ajouter un widget",
      "count": "{count} widgets",
      "searchLabel": "Rechercher des widgets",
      "searchPlaceholder": "Rechercher des widgets…",
      "clear": "Effacer la recherche",
      "noResults": "Aucun widget ne correspond à « {query} ».",
      "add": "Ajouter {name}",
      "added": "{name} ajouté."
    },
    "inspector": {
      "title": "Configurer le widget",
      "empty": "Ce widget n’a aucune option à configurer.",
      "locked": "Verrouillé",
      "lockedHint": "Ce champ est défini par la source et ne peut pas être modifié ici.",
      "selectPlaceholder": "Sélectionner…",
      "increment": "Augmenter",
      "decrement": "Diminuer",
      "done": "Terminé"
    },
    "item": {
      "configure": "Configurer {name}",
      "duplicate": "Dupliquer {name}",
      "remove": "Supprimer {name}",
      "removed": "{name} supprimé.",
      "duplicated": "{name} dupliqué.",
      "unboundHint": "Ce widget affiche des données d’exemple ici et sur la page en ligne. Ouvrez « Configurer » pour le connecter à une table.",
      "unbound": "Données d’exemple"
    },
    "families": {
      "kpi": "Indicateurs",
      "charts": "Graphiques",
      "tables": "Tableaux",
      "feeds": "Flux",
      "calendar": "Calendrier",
      "boards": "Tableaux Kanban",
      "geo": "Cartes",
      "media": "Médias",
      "communication": "Communication",
      "forms": "Formulaires",
      "chrome": "Navigation",
      "system": "Système",
      "domain": "Domaine"
    },
    "versions": "Versions",
    "versionsEmpty": "Aucune version enregistrée pour l’instant",
    "saveAsVersion": "Enregistrer comme version",
    "saveVersionTitle": "Enregistrer une version",
    "saveVersionBody": "Capture l’état actuel du document. Restaurez-le à tout moment depuis Versions.",
    "versionName": "Nom de la version",
    "versionNamePlaceholder": "p. ex. Avant le changement des tarifs T3",
    "discard": "Abandonner les modifications",
    "discardTitle": "Abandonner vos modifications ?",
    "discardBody": "Le tableau de bord revient à son état à l’ouverture de l’éditeur. Vos données ne sont pas affectées.",
    "discardConfirm": "Abandonner les modifications",
    "keepEditing": "Continuer l’édition",
    "discarded": "Modifications abandonnées.",
    "binding": {
      "addFilter": "Ajouter un filtre",
      "brokenBody": "Elle ne correspond plus à une requête que cette version sait comprendre : le widget affiche donc une erreur sur la page en ligne.",
      "brokenTitle": "La requête de ce widget est cassée",
      "bucketColumn": "Colonne de date",
      "bucketRequired": "Choisissez la colonne qui porte la date.",
      "bucketUnit": "Regrouper le temps par",
      "columnNone": "Aucune",
      "columnPlaceholder": "Choisissez une colonne…",
      "connect": "Connecter aux données",
      "edit": "Modifier la requête",
      "event": {
        "category": "Colonne de catégorie (facultatif)",
        "date": "Colonne de date de début",
        "end": "Colonne de date de fin (facultatif)",
        "title": "Colonne de titre"
      },
      "filterColumnRequired": "Choisissez une colonne.",
      "filterColumn": "Colonne",
      "filterListHelper": "Séparez les valeurs par des virgules.",
      "filterOp": "Condition",
      "filterValue": "Valeur",
      "fn": {
        "avg": "Moyenne",
        "countDistinct": "Nombre de valeurs distinctes",
        "count": "Nombre de lignes",
        "max": "Maximum",
        "min": "Minimum",
        "sum": "Somme"
      },
      "groupByColumns": "Colonnes",
      "groupByRequired": "Cette vue nécessite une colonne de ventilation.",
      "groupByRows": "Lignes",
      "groupBy": "Regrouper par",
      "incompleteBody": "Renseignez les champs signalés — une requête écrite à moitié échouerait sur le tableau de bord en ligne.",
      "incompleteTitle": "Cette requête n’est pas terminée",
      "limit": "Nombre maximal de lignes à récupérer",
      "loadingSchema": "Chargement des tables…",
      "lossyBody": "Certaines de ses parties — mesures supplémentaires, tris ou liens vers les filtres de page — ne sont pas affichées ici et seront supprimées si vous enregistrez.",
      "lossyTitle": "Cette requête est plus avancée que l’éditeur",
      "measureColumnRequired": "Ce calcul nécessite une colonne.",
      "measureColumn": "Sur la colonne",
      "measureFn": "Calculer",
      "noConnectionBody": "Les widgets ne peuvent être liés aux données que sur une page rattachée à une connexion.",
      "noConnectionTitle": "Cette page n’a aucune connexion à une base de données",
      "noDateColumns": "Cette table n’a aucune colonne de type date ou horodatage.",
      "noFilters": "Aucun filtre — toutes les lignes de la table sont comptées.",
      "noSnapshotBody": "Les tables et les colonnes proviennent de la dernière introspection de la connexion. Lancez une introspection dans le Studio, puis rouvrez cet éditeur.",
      "noSnapshotTitle": "Aucun instantané de schéma pour cette connexion",
      "op": {
        "between": "est compris entre",
        "ilike": "contient (casse ignorée)",
        "in": "fait partie de",
        "isNull": "est vide",
        "like": "contient",
        "notNull": "n’est pas vide"
      },
      "orderAsc": "Plus ancien / plus petit d’abord",
      "orderBy": "Trier par",
      "orderDesc": "Plus récent / plus grand d’abord",
      "orderDir": "Sens",
      "orderNone": "Ordre de la base de données",
      "pickTableFirst": "Choisissez une table pour sélectionner ses colonnes.",
      "removeFilter": "Retirer le filtre",
      "remove": "Supprimer la source de données",
      "save": "Utiliser cette requête",
      "sectionBreakdown": "Ventilation",
      "sectionColumns": "Colonnes",
      "sectionFilters": "Filtres",
      "sectionMeasure": "Mesure",
      "sectionRows": "Lignes",
      "sectionSource": "Source",
      "sectionTime": "Axe temporel",
      "sectionWindow": "Période",
      "selectColumns": "Colonnes à afficher",
      "selectRequired": "Choisissez au moins une colonne à afficher.",
      "shape": {
        "calendarEvents": "Des événements datés",
        "categorical": "Une valeur par catégorie",
        "distribution": "La répartition d’une colonne",
        "matrix": "Une grille de lignes par colonnes",
        "metricDelta": "Un nombre, comparé à la période précédente",
        "multiTimeseries": "Une courbe dans le temps par catégorie",
        "recordList": "Une liste de lignes",
        "record": "Une seule ligne",
        "singleMetric": "Un seul nombre",
        "stream": "Un flux en direct des lignes récentes",
        "timeseries": "Une valeur dans le temps",
        "tree": "Une valeur par catégorie, répartie sur deux niveaux",
        "geoPoints": "Une valeur par lieu ou région",
        "flows": "Le volume qui passe d’une catégorie à une autre",
        "ohlc": "Ouverture, plus haut, plus bas et clôture par période",
        "booleanMap": "Un indicateur activé/désactivé par clé"
      },
      "shapeHelper": "Modifier ce choix change les réglages de requête applicables.",
      "shapeLabel": "Ce que ce widget affiche",
      "summaryColumns": "{count, plural, one {# colonne} other {# colonnes}}",
      "summaryFilters": "{count, plural, one {# filtre} other {# filtres}}",
      "tableEmpty": "Aucune table correspondante.",
      "tablePlaceholder": "Rechercher des tables…",
      "tableRequired": "Choisissez une table à interroger.",
      "table": "Table ou vue",
      "title": "Source de données",
      "unbindableBody": "Il affiche une forme de données que le moteur de requêtes ne construit pas encore : il rend donc son propre contenu d’exemple.",
      "unbindableTitle": "Ce widget ne peut pas encore interroger de données",
      "unboundBody": "Il affiche des chiffres d’exemple ici ET sur la page en ligne. Connectez-le à une table pour afficher des données réelles.",
      "unboundTitle": "Non connecté à vos données",
      "unit": {
        "day": "Quotidien",
        "hour": "Horaire",
        "month": "Mensuel",
        "quarter": "Trimestriel",
        "week": "Hebdomadaire",
        "year": "Annuel"
      },
      "valueColumnRequired": "Choisissez la colonne à mesurer.",
      "valueColumn": "Colonne de valeur",
      "windowColumn": "Colonne de date",
      "windowLast": "Sur les",
      "windowNone": "Depuis le début",
      "windowRequired": "La comparaison avec la période précédente nécessite une colonne de date.",
      "windowUnit": {
        "day": "derniers jours",
        "hour": "dernières heures",
        "month": "derniers mois",
        "quarter": "derniers trimestres",
        "week": "dernières semaines",
        "year": "dernières années"
      },
      "windowUnitLabel": "Unité",
      "role": {
        "flagKey": "Colonne de clé",
        "flagValue": "Colonne activé/désactivé"
      },
      "roleColumnsRequired": "Renseignez chaque colonne obligatoire et ne laissez aucun vide avant une colonne renseignée, car les colonnes sont lues dans l’ordre."
    }
  },
  "setup": {
    "title": "Configurer Adminium",
    "subtitle": "Créez le premier administrateur. Cela n’arrive qu’une fois.",
    "progress": "Progression de la configuration",
    "steps": {
      "account": "Compte administrateur",
      "consent": "Confidentialité"
    },
    "account": {
      "name": "Votre nom",
      "email": "E-mail",
      "emailInvalid": "Saisissez une adresse e-mail valide.",
      "password": "Mot de passe",
      "passwordHelper": "Au moins {min} caractères.",
      "passwordTooShort": "Utilisez au moins {min} caractères.",
      "confirm": "Confirmer le mot de passe",
      "passwordMismatch": "Les mots de passe ne correspondent pas.",
      "continue": "Continuer",
      "strength": "Robustesse du mot de passe",
      "strengthLevels": {
        "weak": "Faible",
        "fair": "Moyen",
        "good": "Bon",
        "strong": "Fort"
      }
    },
    "consent": {
      "telemetry": {
        "title": "Partager des données d’usage anonymes",
        "description": "Nous aide à voir quels moteurs de base de données prioriser. Désactivé tant que vous ne l’activez pas."
      },
      "updates": {
        "title": "Rechercher les nouvelles versions",
        "description": "Affiche un avis lorsqu’une nouvelle version — y compris un correctif de sécurité — est disponible. Cela interroge GitHub sur la dernière version, ce qui lui révèle l’adresse IP et la version de cette instance. Rien d’autre n’est envoyé."
      },
      "sentTitle": "Exactement ce qui est envoyé :",
      "sent": {
        "instanceId": "Un identifiant d’instance aléatoire (un UUID généré ici ; non dérivé de votre nom, de votre hôte ni de votre base de données)",
        "version": "La version d’Adminium exécutée par cette instance",
        "engines": "Les types de moteurs de base de données connectés (par ex. « postgres ») — les types seulement"
      },
      "neverTitle": "Jamais envoyé :",
      "never": {
        "schema": "Votre schéma — aucun nom de table, de colonne ni d’énumération",
        "rows": "Vos données — pas une seule ligne, jamais",
        "connections": "Chaînes de connexion, noms d’hôte ou identifiants",
        "people": "E-mails, noms ou identifiants d’utilisateurs",
        "llm": "Invites d’IA ou contenus d’exécution"
      },
      "reversible": "Les deux sont désactivés par défaut et vous pourrez les modifier plus tard dans les Paramètres.",
      "back": "Retour",
      "finish": "Créer le compte administrateur"
    },
    "error": {
      "alreadyCompleted": "Cette instance a déjà été configurée. Connectez-vous avec le compte administrateur existant.",
      "rejected": "Le serveur a refusé ces informations. Vérifiez l’e-mail et le mot de passe, puis réessayez.",
      "failed": "Échec de la configuration. Vérifiez votre connexion et réessayez."
    }
  },
  "about": {
    "title": "À propos d’Adminium",
    "subtitle": "Version, licence et emplacement du code source de cette instance.",
    "version": "Version",
    "license": "Licence",
    "metaStore": "Métabase",
    "node": "Node.js",
    "engine": {
      "postgres": "PostgreSQL",
      "mysql": "MySQL / MariaDB",
      "sqlite": "SQLite"
    },
    "licenseCard": {
      "title": "Libre et open source",
      "body": "Adminium est distribué sous licence GNU Affero General Public License v3.0. Vous êtes libre de l’exécuter, de l’étudier, de le modifier et de le partager. Si vous proposez une version modifiée à d’autres via un réseau, l’AGPL vous demande de leur proposer aussi son code source."
    },
    "viewLicense": "Lire la licence",
    "viewSource": "Obtenir le code source",
    "updates": {
      "title": "Mises à jour",
      "description": "Si cette instance recherche de nouvelles versions."
    },
    "update": {
      "disabled": "La recherche de mises à jour est désactivée : cette instance ne contacte jamais GitHub. Activez-la dans les Paramètres pour être informé des nouvelles versions.",
      "current": "Vous utilisez la dernière version.",
      "available": "Adminium {version} est disponible",
      "availableBody": "Vous utilisez actuellement {version}.",
      "viewRelease": "Voir les notes de version"
    },
    "desktop": {
      "unknown": "Inconnu",
      "appVersion": "Version de l’application",
      "serverVersion": "Version du serveur",
      "migration": "Migration du méta-store",
      "electron": "Electron",
      "chromium": "Chromium",
      "runtimeNode": "Runtime Node",
      "system": {
        "title": "Système"
      },
      "dataDir": "Répertoire de données",
      "reveal": "Afficher dans le dossier",
      "secret": {
        "title": "Stockage du secret",
        "safe": "Chiffré par votre système d’exploitation",
        "plainWarning": "Cet ordinateur ne dispose d’aucun trousseau système, votre secret Adminium est donc stocké en clair sur le disque. Toute personne pouvant lire les fichiers de cette machine peut le lire. Configurez un trousseau de connexion (ou un service de secrets Linux) et redémarrez Adminium pour le protéger."
      },
      "updates": {
        "title": "Mises à jour",
        "mode": {
          "notify": "M’avertir des nouvelles versions",
          "manual": "Uniquement quand je vérifie",
          "disabled": "Désactivé (hors ligne)"
        },
        "disabledBody": "Les mises à jour automatiques sont désactivées (hors ligne). Installez les nouvelles versions manuellement.",
        "check": "Rechercher des mises à jour",
        "checking": "Vérification…",
        "lastChecked": "Dernière vérification {when}",
        "available": "La version {version} est disponible",
        "none": "Vous utilisez la dernière version.",
        "unavailable": "Les mises à jour sont désactivées dans cette installation.",
        "error": "Impossible de rechercher des mises à jour.",
        "download": "Télécharger la mise à jour",
        "downloading": "Téléchargement… {percent} %",
        "downloaded": "La version {version} est prête à être installée",
        "restart": "Redémarrer pour installer",
        "downloadError": "Le téléchargement ne s’est pas terminé. Vous pouvez réessayer.",
        "toast": {
          "available": "Une nouvelle version d’Adminium est disponible",
          "view": "Afficher",
          "downloaded": "Mise à jour prête à installer",
          "restart": "Redémarrer maintenant"
        }
      },
      "legal": {
        "title": "Licences",
        "agpl": "Adminium Desktop est un logiciel libre sous licence GNU Affero General Public License v3.0.",
        "viewLicense": "Voir la licence",
        "licenseTitle": "GNU Affero General Public License v3.0",
        "licenseUnavailable": "Le fichier de licence intégré n’est pas disponible dans cette version.",
        "viewNotices": "Licences tierces",
        "noticesTitle": "Mentions des tiers",
        "noticesUnavailable": "Les mentions des tiers sont générées lors de l’empaquetage de l’application et ne sont pas disponibles dans cette version.",
        "source": "Code source",
        "close": "Fermer"
      },
      "telemetry": {
        "title": "Données d’utilisation anonymes",
        "label": "Partager des données d’utilisation anonymes",
        "description": "Nous aide à décider quels moteurs de base de données prioriser. Désactivé sauf si vous l’activez ; aucun schéma, donnée ou information personnelle n’est jamais envoyé.",
        "saveFailed": "Impossible d’enregistrer ce paramètre. Réessayez."
      },
      "diagnostics": {
        "title": "Diagnostics",
        "description": "Détails utiles pour signaler un problème. Aucun schéma ni donnée n’est inclus.",
        "copy": "Copier les infos de diagnostic",
        "copied": "Copié",
        "showLogs": "Afficher les journaux",
        "dataSize": "Taille des données : {size}"
      }
    }
  },
  "apiKeys": {
    "title": "Clés d’API et jetons",
    "subtitle": "Gérez l’accès programmatique à votre espace de travail.",
    "createButton": "Créer une clé",
    "copy": "Copier",
    "copied": "Copié",
    "revoke": "Révoquer la clé",
    "neverUsed": "Jamais utilisée",
    "lastUsed": "Dernière utilisation {since}",
    "scopesOverflow": "+{count} de plus",
    "status": {
      "active": "Active",
      "revoked": "Révoquée",
      "expired": "Expirée"
    },
    "list": {
      "title": "Clés",
      "activeCount": "{count, plural, one {# clé active} other {# clés actives}}"
    },
    "empty": {
      "title": "Aucune clé d’API",
      "body": "Créez-en une pour appeler l’API Adminium depuis votre propre code."
    },
    "revealed": {
      "title": "Nouvelle clé créée",
      "body": "Copiez-la maintenant — vous ne pourrez plus jamais la voir."
    },
    "rolesUnavailable": {
      "title": "Les rôles ne vous sont pas visibles",
      "body": "Créer une clé, c’est choisir le rôle sous lequel elle agit, et votre compte ne peut pas lire la liste des rôles. Demandez à un administrateur la permission « Gérer les rôles »."
    },
    "quickStart": {
      "title": "Démarrage rapide",
      "body": "Authentifiez vos requêtes avec votre clé dans l’en-tête Authorization."
    },
    "create": {
      "title": "Créer une clé d’API",
      "description": "La clé agit avec les permissions du rôle que vous choisissez.",
      "name": "Nom",
      "namePlaceholder": "ex. Pipeline analytique",
      "role": "Rôle",
      "roleHelper": "Choisissez le rôle le moins privilégié qui suffise.",
      "expires": "Expire le",
      "expiresHelper": "Laissez vide pour une clé qui n’expire jamais.",
      "submit": "Créer la clé",
      "failed": "Impossible de créer la clé"
    },
    "revokeConfirm": {
      "title": "Révoquer la clé d’API",
      "body": "Tout code appelant encore l’API avec « {name} » échouera immédiatement. C’est irréversible.",
      "prompt": "Saisissez « {name} » pour confirmer",
      "confirm": "Révoquer la clé"
    }
  },
  "changelog": {
    "title": "Journal des modifications",
    "subtitle": "Nouveautés produit et versions.",
    "allReleases": "Toutes les versions",
    "tag": {
      "new": "Nouveau",
      "improved": "Amélioré",
      "fixed": "Corrigé",
      "security": "Sécurité"
    },
    "filter": {
      "all": "Tout",
      "label": "Filtrer les modifications par type"
    },
    "empty": {
      "title": "Rien sous ce filtre",
      "body": "Aucune version n’a encore comporté de modification de ce type.",
      "clear": "Afficher toutes les modifications"
    }
  },
  "kb": {
    "title": "Base de connaissances",
    "subtitle": "{count, plural, one {# guide} other {# guides}} · documentation complète sur docs.adminium.dev",
    "openDocs": "Ouvrir la documentation",
    "browse": "Parcourir par thème",
    "hero": {
      "title": "Comment pouvons-nous vous aider ?",
      "subtitle": "Cherchez dans les guides, la doc API et le dépannage.",
      "placeholder": "Rechercher dans la base de connaissances…",
      "label": "Rechercher dans la base de connaissances",
      "clear": "Effacer la recherche"
    },
    "category": {
      "start": "Premiers pas",
      "connect": "Connecter des données",
      "api": "API et développement",
      "security": "Sécurité et accès",
      "selfhost": "Auto-hébergement",
      "trouble": "Dépannage",
      "count": "{count, plural, one {# article} other {# articles}}",
      "selected": "Filtré"
    },
    "list": {
      "all": "Tous les guides",
      "clear": "Effacer le filtre"
    },
    "empty": {
      "title": "Aucun guide ne correspond à votre recherche",
      "body": "Essayez un autre mot, ou cherchez dans la documentation complète sur docs.adminium.dev.",
      "openDocs": "Ouvrir la documentation"
    },
    "article": {
      "install": {
        "title": "Installer Adminium",
        "excerpt": "Lancez depuis un dépôt source ou via docker run, et atteignez l’assistant de première exécution en une minute."
      },
      "firstAdmin": {
        "title": "Créer votre premier super-administrateur",
        "excerpt": "Ce que demande l’assistant de première exécution, et pourquoi il ne peut s’exécuter qu’une fois."
      },
      "connectDb": {
        "title": "Connecter votre première base de données",
        "excerpt": "Pointez Adminium vers PostgreSQL, MySQL ou SQLite et générez une application d’administration."
      },
      "schemaFile": {
        "title": "Générer depuis un fichier de schéma",
        "excerpt": "Importez un schéma Prisma, un models.py Django, un schema.rb Rails ou un dump .sql — sans aucune connexion."
      },
      "readOnly": {
        "title": "Utiliser un rôle en lecture seule",
        "excerpt": "L’introspection ne lit que les métadonnées du schéma. Donnez à Adminium le minimum de privilèges."
      },
      "apiKeys": {
        "title": "S’authentifier avec des clés d’API",
        "excerpt": "Créer et révoquer des clés, et pourquoi une clé ne vous est montrée qu’une seule fois."
      },
      "rest": {
        "title": "Référence de l’API REST",
        "excerpt": "Tous les points d’accès exposés par l’application générée, avec les formats de requête et de réponse."
      },
      "manifest": {
        "title": "Le manifeste de page",
        "excerpt": "Comment une page se décrit en configuration, et comment en modifier une à la main."
      },
      "roles": {
        "title": "Rôles et permissions",
        "excerpt": "Attribuez Lecteur, Éditeur et Admin, et construisez vos propres rôles depuis la matrice de permissions."
      },
      "audit": {
        "title": "Lire le journal d’audit",
        "excerpt": "Qui a changé quoi, quand, et depuis où."
      },
      "secrets": {
        "title": "Comment Adminium stocke vos secrets",
        "excerpt": "Les identifiants de connexion sont chiffrés au repos avec ADMINIUM_SECRET. Les clés d’API sont hachées."
      },
      "docker": {
        "title": "Auto-héberger avec Docker",
        "excerpt": "L’image officielle, docker-compose, et l’usage d’une base méta séparée."
      },
      "backup": {
        "title": "Sauvegarder et déplacer une instance",
        "excerpt": "export-zip regroupe votre configuration serveur ; l’import rejoue la même installation ailleurs."
      },
      "telemetry": {
        "title": "Télémétrie et vérification des mises à jour",
        "excerpt": "Les deux sont opt-in et désactivées par défaut. Ce qui est envoyé si vous les activez."
      },
      "connectionFails": {
        "title": "Une connexion à la base échoue",
        "excerpt": "Lisez la carte de diagnostic : hôte, port, TLS, et l’IP que votre base doit autoriser."
      },
      "missingTables": {
        "title": "Des tables manquent après l’introspection",
        "excerpt": "Visibilité du schéma, tables exclues, et relance de la génération."
      }
    }
  },
  "desktop": {
    "menu": {
      "file": "Fichier",
      "fileNewDatabase": "Nouvelle base de données locale…",
      "fileOpenSqlite": "Ouvrir un fichier SQLite…",
      "fileBackupNow": "Sauvegarder maintenant…",
      "fileRestore": "Restaurer depuis une sauvegarde…",
      "edit": "Édition",
      "view": "Affichage",
      "window": "Fenêtre",
      "help": "Aide",
      "helpDocs": "Documentation Adminium",
      "helpShortcuts": "Raccourcis clavier",
      "helpLogs": "Afficher les journaux",
      "helpCheckForUpdates": "Rechercher des mises à jour…",
      "helpAbout": "À propos d’Adminium"
    },
    "settings": {
      "explainer": "Ces paramètres s’appliquent uniquement à l’application Adminium sur cet ordinateur. Ils sont enregistrés sur cette machine, pas dans votre espace de travail.",
      "title": "Paramètres du bureau"
    },
    "security": {
      "heading": "Connexion"
    },
    "requireLogin": {
      "label": "Exiger une connexion sur cet appareil",
      "description": "Adminium vous connecte normalement de façon automatique sur cet ordinateur. Activez cette option pour demander votre mot de passe à chaque démarrage — utile si d’autres personnes peuvent utiliser cette machine. La modification prend effet au prochain démarrage d’Adminium.",
      "savedOn": "Connexion requise au prochain démarrage",
      "savedOff": "Adminium ignorera la connexion sur cet ordinateur",
      "saveFailed": "Impossible d’enregistrer ce paramètre. Réessayez."
    },
    "chip": {
      "local": "Local",
      "lanShare": "Local · Partagé sur le réseau",
      "remoteDb": "Local + base distante",
      "remoteDbOffline": "Base distante hors ligne",
      "remoteDbOfflineDetail": "Impossible de joindre {names}. Les pages de ces connexions affichent un état de reconnexion."
    },
    "lan": {
      "heading": "Partager sur le réseau local",
      "label": "Autoriser les autres appareils de ce réseau à utiliser Adminium",
      "description": "Les autres ordinateurs, tablettes et téléphones du même réseau peuvent ouvrir Adminium dans un navigateur et se connecter avec leur propre compte. Adminium doit rester ouvert sur cet ordinateur pour qu'ils puissent y accéder.",
      "savedOn": "Partagé sur votre réseau local",
      "savedOff": "Partage arrêté — Adminium est de nouveau limité à cet ordinateur",
      "saveFailed": "Impossible de modifier le partage réseau",
      "noUsers": "Vous êtes la seule personne à avoir un compte, donc personne d'autre ne peut encore se connecter. Le partage fonctionne quand même — il vous suffira d'inviter des personnes avant qu'elles puissent l'utiliser.",
      "usersUnknown": "Adminium n'a pas pu vérifier qui d'autre possède un compte sur cet ordinateur. Le partage fonctionne toujours et toute personne disposant d'un compte peut se connecter — seule cette vérification a échoué.",
      "acknowledge": "J'ai compris — j'inviterai des personnes ensuite",
      "port": "Port",
      "portHelper": "Par défaut {port}",
      "portInvalid": "Utilisez un nombre entre 1024 et 65535.",
      "applyPort": "Changer de port",
      "portInUse": "Le port {port} est déjà utilisé par un autre programme.",
      "portInUseHint": "Rien n'a été modifié — le partage est toujours désactivé.",
      "portInUseNoSuggestion": "Rien n'a été modifié. Essayez un autre port.",
      "tryPort": "Essayer {port}",
      "urlsHeading": "Ouvrir ceci sur un autre appareil",
      "noUrls": "Cet ordinateur n'est connecté à aucun réseau pour le moment, il n'y a donc aucune adresse à partager. Connectez-vous au Wi-Fi ou branchez un câble et cette liste se remplira.",
      "copyUrl": "Copier",
      "sessions": "{count, plural, =0 {Aucun appareil connecté depuis ce réseau} one {# appareil connecté depuis ce réseau} other {# appareils connectés depuis ce réseau}}",
      "sessionsUnknown": "Vérification des appareils connectés…",
      "pending": "Démarrage du partage…",
      "mismatch": "Adminium reste accessible sur ce réseau",
      "mismatchBody": "Le partage est désactivé, mais le serveur n'a pas encore libéré le réseau. Redémarrez Adminium pour le fermer.",
      "transportTitle": "Le trafic sur votre réseau local n'est pas chiffré.",
      "transportBody": "Ne partagez que sur des réseaux de confiance. Pour un accès à distance, utilisez Adminium self-host derrière HTTPS.",
      "firewall": "La première fois que vous partagez, votre système d'exploitation vous demandera d'autoriser les connexions entrantes — choisissez Autoriser, sinon les autres appareils ne pourront pas accéder à Adminium.",
      "manageTeam": "Gérer les utilisateurs et les rôles"
    },
    "setup": {
      "title": "Bienvenue dans Adminium",
      "subtitle": "Quatre étapes rapides et Adminium aura construit une application d’administration à partir de votre base de données. Tout reste sur cet ordinateur.",
      "progress": "Progression de la configuration",
      "back": "Retour",
      "continue": "Continuer",
      "createAccount": "Créer le compte et continuer",
      "step": {
        "location": "Bienvenue",
        "database": "Votre première base de données",
        "account": "Votre compte",
        "generate": "Générer"
      },
      "dataDir": {
        "heading": "Où Adminium doit-il conserver vos données ?",
        "description": "Vos bases de données, vos réglages et vos sauvegardes vivent tous dans ce dossier. Tout reste sur cet ordinateur — rien n’est envoyé nulle part.",
        "label": "Dossier de données",
        "loading": "Lecture de l’emplacement actuel…",
        "pending": "Adminium redémarre lorsque vous continuez, afin de basculer vers ce dossier.",
        "change": "Modifier…",
        "revert": "Annuler",
        "dialogTitle": "Choisissez où Adminium conserve vos données",
        "cloudSyncTitle": "Ce dossier est synchronisé avec le cloud",
        "cloudSyncWarning": "Adminium stocke ses données dans des fichiers SQLite. {provider} synchronise les fichiers de « {folder} » en les copiant en arrière-plan, ce qui peut corrompre une base de données ouverte — et faire perdre des données sans avertissement. Choisissez un dossier en dehors de {provider}.",
        "chooseAnother": "Choisir un autre dossier",
        "useAnyway": "L’utiliser quand même — j’accepte le risque",
        "unusableTitle": "Adminium ne peut pas utiliser ce dossier",
        "failed": "Adminium n’a pas pu utiliser ce dossier."
      },
      "source": {
        "heading": "À partir de quoi Adminium doit-il construire ?",
        "description": "Adminium lit le schéma d’une base de données et en génère une application d’administration. Vous pourrez ajouter d’autres bases plus tard.",
        "groupLabel": "Source de la base de données",
        "local": {
          "title": "Créer une base de données locale",
          "description": "Partez de zéro, ou d’un fichier de schéma que vous avez déjà. La base est créée dans votre dossier de données.",
          "name": "Nom de la base de données",
          "namePlaceholder": "Opérations",
          "nameUnusable": "Utilisez au moins une lettre ou un chiffre — le nom du fichier en est dérivé.",
          "fileHelper": "Crée {file}",
          "schemaLabel": "Partir de",
          "blank": "Vide",
          "fromFile": "Un fichier de schéma",
          "schemaFile": "Fichier de schéma",
          "schemaFileHelper": ".sql, pg_dump, Prisma, Drizzle, TypeORM, Sequelize, schema.rb, Django ou JSON Adminium. Adminium le traduit en SQLite.",
          "placeholder": "Générer automatiquement des entrées d’exemple",
          "placeholderHelper": "Vous avez importé un schéma sans lignes. Remplissez chaque table de données d’exemple réalistes pour que vos tableaux de bord et graphiques s’affichent immédiatement."
        },
        "openSqlite": {
          "title": "Ouvrir un fichier SQLite existant",
          "description": "Pointez Adminium vers un fichier .sqlite de cet ordinateur. Il est ouvert là où il se trouve — rien n’est copié ni déplacé.",
          "browse": "Choisir un fichier .sqlite…",
          "change": "Choisir un autre fichier…",
          "networkTitle": "Ce fichier se trouve sur un partage réseau",
          "networkBody": "Le verrouillage SQLite n’est pas fiable sur les partages de fichiers réseau, et une connexion interrompue en pleine écriture peut corrompre la base. Une copie sur le disque de cet ordinateur est plus sûre."
        },
        "remote": {
          "title": "Se connecter à une base de données serveur",
          "description": "PostgreSQL ou MySQL. Nécessite une base de données accessible sur le réseau ; les tables propres à Adminium restent malgré tout sur cet ordinateur.",
          "networkNote": "Nécessite une base de données accessible sur le réseau",
          "metaNote": "Les tables propres à Adminium — vos pages, vos réglages et votre connexion — restent dans le dossier de données de cet ordinateur dans tous les cas.",
          "engine": "Moteur",
          "name": "Nom de la connexion",
          "namePlaceholder": "Production",
          "dsn": "Chaîne de connexion",
          "dsnHelper": "Adminium la teste au moment de se connecter. Utilisez un rôle en lecture seule si vous ne voulez que des tableaux de bord."
        },
        "demo": {
          "title": "Explorer la base de démonstration",
          "description": "Une base d’exploitation d’équipe prête à l’emploi, pour voir ce qu’Adminium construit avant de le pointer vers vos propres données. Supprimez-la quand vous voulez.",
          "unavailable": "Cette version n’inclut pas les données de démonstration, il n’y a donc rien à charger. Choisissez l’une des options ci-dessus."
        }
      },
      "account": {
        "heading": "Créez votre compte",
        "description": "Il s’agit du compte administrateur de cette copie d’Adminium. Le mot de passe protège vos sauvegardes et toute personne avec qui vous partagez sur votre réseau — il ne vous sera pas demandé à chaque lancement.",
        "name": "Votre nom",
        "email": "E-mail",
        "password": "Mot de passe",
        "passwordHelper": "Au moins {min} caractères.",
        "confirm": "Confirmer le mot de passe",
        "strength": "Force du mot de passe",
        "strengthLevels": {
          "weak": "Faible",
          "fair": "Moyen",
          "good": "Bon",
          "strong": "Fort"
        },
        "singleUser": "Ignorer la connexion sur cet ordinateur",
        "singleUserHelper": "Adminium vous connecte automatiquement lorsque vous l’ouvrez ici. Désactivez cette option si d’autres personnes utilisent cette machine. Vous pourrez la modifier plus tard dans Réglages → Bureau.",
        "locale": "Langue",
        "theme": "Apparence",
        "alreadyExists": "Cette copie d’Adminium possède déjà un compte. Connectez-vous avec celui-ci.",
        "failed": "Adminium n’a pas pu créer ce compte."
      },
      "generate": {
        "creating": "Configuration de votre base de données…",
        "introspecting": "Lecture de votre schéma — tables, colonnes et relations…",
        "working": "En cours…",
        "offlineNote": "Tout cela se passe sur cet ordinateur.",
        "failedTitle": "Adminium n’a pas pu configurer cette base de données",
        "failedBody": "Un problème est survenu. Réessayez.",
        "retry": "Réessayer"
      }
    }
  },
  "capabilities": {
    "heading": "Autorisations des applications",
    "description": "Les applications que vous installez peuvent demander à utiliser le matériel de cet ordinateur. Vous approuvez chacune d’elles et pouvez révoquer l’accès à tout moment.",
    "grantedTo": "Autorisé pour {app}",
    "status": {
      "available": "Disponible",
      "stub": "Pas encore disponible",
      "unavailable": "Indisponible"
    },
    "allow": {
      "action": "Autoriser…"
    },
    "revoke": {
      "action": "Révoquer",
      "saved": "Accès révoqué",
      "failed": "Impossible de révoquer l’accès. Réessayez."
    },
    "grant": {
      "saved": "Accès autorisé",
      "failed": "Impossible d’autoriser l’accès. Réessayez."
    },
    "catalog": {
      "printerEscpos": {
        "name": "Imprimante de reçus (ESC/POS)",
        "scope": "Imprimer sur des imprimantes de reçus et ouvrir un tiroir-caisse connecté"
      }
    },
    "consent": {
      "title": "Autoriser {app} ?",
      "subtitle": "{app} demande à utiliser le matériel de cet ordinateur.",
      "willAllow": "Cela permettra à {app} de :",
      "revokeNote": "Vous pouvez révoquer ceci à tout moment dans Paramètres → Bureau. N’autorisez que les applications de confiance.",
      "deny": "Pas maintenant",
      "approve": "Autoriser"
    }
  },
  "emailTemplates": {
    "title": "Modèles d’e-mail",
    "subtitle": "Les e-mails transactionnels et de cycle de vie envoyés par votre espace de travail.",
    "search": "Rechercher des modèles…",
    "loadFailed": "Impossible de charger les modèles",
    "empty": "Aucun modèle d’e-mail pour l’instant",
    "emptyBody": "Les modèles apparaissent ici dès que le serveur les crée ou que vous en créez.",
    "noMatches": "Aucun modèle correspondant",
    "noMatchesBody": "Essayez une autre recherche.",
    "live": "Actif",
    "disabled": "Désactivé",
    "name": "Nom du modèle",
    "subject": "Objet",
    "enabled": "Activé"
  },
  "board": {
    "addCard": "Ajouter une carte",
    "compose": {
      "placeholder": "Titre de la carte…",
      "add": "Ajouter",
      "cancel": "Annuler"
    },
    "empty": {
      "title": "Aucune colonne de tableau",
      "body": "Ajoutez un champ de statut pour regrouper les cartes en colonnes."
    }
  },
  "calendar": {
    "dateRange": "Plage de dates",
    "compose": {
      "placeholder": "Titre de l’événement…",
      "add": "Ajouter",
      "cancel": "Annuler",
      "open": "Ajouter un événement"
    },
    "agenda": {
      "empty": "Rien de prévu"
    }
  },
  "scheduler": {
    "prevWeek": "Semaine précédente",
    "nextWeek": "Semaine suivante",
    "week": "Semaine",
    "month": "Mois",
    "resource": "Ressource",
    "coverage": "Couverture",
    "addShift": "Ajouter un créneau",
    "shiftCount": "{n} créneaux"
  },
  "planning": {
    "drawer": {
      "close": "Fermer",
      "loading": "Chargement de l’enregistrement",
      "error": "Impossible de charger cet enregistrement."
    }
  },
  "files": {
    "uploadsUnavailable": "Les téléversements ne sont pas encore disponibles sur cette page."
  },
  "chat": {
    "messageSent": "Message envoyé",
    "sendFailed": "Le message n’a pas pu être envoyé."
  },
  "templates": {
    "crud": {
      "title": "Enregistrements",
      "description": "Un tableau de lignes consultable, avec ajout, édition et suppression."
    },
    "dashboard": {
      "title": "Tableau de bord",
      "description": "Une grille de graphiques et de chiffres que vous disposez vous-même."
    },
    "board": {
      "title": "Tableau",
      "description": "Des cartes en colonnes par statut, déplaçables entre elles."
    },
    "calendar": {
      "title": "Calendrier",
      "description": "Des enregistrements placés par date sur une grille mensuelle ou hebdomadaire."
    },
    "scheduler": {
      "title": "Planning",
      "description": "Qui fait quoi, sous forme de planning par personne."
    },
    "logViewer": {
      "title": "Journaux",
      "description": "Des lignes d’événements denses et filtrables, avec une trace détaillée."
    },
    "files": {
      "title": "Fichiers",
      "description": "Fichiers et dossiers sous forme de bibliothèque navigable."
    },
    "chat": {
      "title": "Discussion",
      "description": "Des conversations en fils avec l’historique des messages."
    },
    "builder": {
      "title": "Éditeur",
      "description": "Un canevas glisser-déposer pour documents et modèles."
    },
    "wizard": {
      "title": "Assistant",
      "description": "Une séquence d’étapes guidée pour accomplir une tâche."
    },
    "settings": {
      "title": "Paramètres",
      "description": "Des lignes de préférences groupées, avec interrupteurs et champs."
    },
    "directory": {
      "title": "Annuaire",
      "searchPlaceholder": "Rechercher des personnes…",
      "allFilter": "Tous",
      "clearFilters": "Effacer les filtres",
      "detailTitle": "Personne",
      "emptyTitle": "Aucune personne pour l’instant",
      "emptyBody": "Les personnes apparaissent ici à mesure que des lignes arrivent dans la table.",
      "noMatchesTitle": "Aucune personne correspondante",
      "noMatchesBody": "Essayez une autre recherche ou retirez un filtre.",
      "errorTitle": "Cet annuaire n’a pas pu être chargé",
      "loading": "Chargement des personnes",
      "memberCount": "{count} personnes",
      "description": "Les personnes en cartes, avec un organigramme des rattachements."
    },
    "masterDetail": {
      "title": "Liste et détail",
      "allFilter": "Tous",
      "clearFilters": "Effacer les filtres",
      "emptyTitle": "Rien ici pour l’instant",
      "emptyBody": "Les enregistrements apparaissent ici à mesure que des lignes arrivent dans la table.",
      "noMatchesTitle": "Aucun enregistrement correspondant",
      "noMatchesBody": "Essayez de retirer un filtre.",
      "errorTitle": "Cette liste n’a pas pu être chargée",
      "loading": "Chargement des enregistrements",
      "selectPrompt": "Sélectionnez un enregistrement",
      "description": "Une liste à gauche, l’enregistrement sélectionné à côté."
    },
    "queueInbox": {
      "title": "File d’attente",
      "approve": "Approuver",
      "reject": "Rejeter",
      "allSegment": "Tous",
      "approvedToast": "{count} approuvés.",
      "rejectedToast": "{count} rejetés.",
      "undoneToast": "Décision annulée.",
      "failedToast": "Échec de la décision.",
      "bulkFailed": "{failed} des {total} lignes sélectionnées n’ont pas pu être mises à jour.",
      "undoFailedToast": "Impossible d’annuler cette décision.",
      "rejectTitle": "Rejeter les demandes",
      "rejectCount": "Sélection · {count}",
      "rejectNote": "Le demandeur sera notifié avec votre note.",
      "rejectPlaceholder": "Ajoutez une note pour le demandeur…",
      "rejectConfirm": "Rejeter",
      "emptyTitle": "Rien dans la file d’attente",
      "emptyBody": "Les nouvelles demandes apparaissent ici dès leur arrivée.",
      "caughtUpTitle": "Vous êtes à jour",
      "caughtUpBody": "Aucune demande dans cet onglet pour le moment.",
      "errorTitle": "Cette file d’attente n’a pas pu être chargée",
      "loading": "Chargement de la file d’attente",
      "selectPrompt": "Sélectionnez une demande",
      "daysUnit": "{count} jours",
      "description": "Une file de travail avec approuver et rejeter sur chaque élément."
    }
  },
  "dataio": {
    "back": "Retour",
    "import": {
      "title": "Importer des données",
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
      "title": "Exports de données",
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
      "emptyBody": "Demandez-en un ci-dessus — les artefacts apparaissent ici avec leur statut."
    }
  },
  "reports": {
    "title": "Rapports planifiés",
    "subtitle": "Instantanés de données récurrents d’une page, livrés sous forme de notifications dans l’application.",
    "new": "Nouveau rapport",
    "loadFailed": "Impossible de charger les rapports planifiés.",
    "saveFailed": "Impossible d’enregistrer ce rapport.",
    "nextRun": "Prochaine exécution",
    "emptyTitle": "Aucun rapport planifié pour l’instant",
    "emptyBody": "Créez-en un pour obtenir un instantané de données récurrent de n’importe quelle page de table.",
    "createTitle": "Nouveau rapport planifié",
    "editTitle": "Modifier le rapport planifié",
    "nameLabel": "Nom",
    "namePlaceholder": "p. ex. Chiffre d’affaires hebdomadaire",
    "pageLabel": "Page",
    "pagePlaceholder": "Choisissez une page…",
    "frequencyLabel": "Fréquence",
    "frequency": {
      "daily": "Quotidien",
      "weekly": "Hebdomadaire",
      "monthly": "Mensuel"
    },
    "dayOfWeekLabel": "Jour",
    "dayOfMonthLabel": "Jour du mois",
    "timeLabel": "Heure",
    "timezoneLabel": "Fuseau horaire",
    "formatLabel": "Livraison",
    "formatHint": "Instantané de données (le rendu PDF/PNG arrivera dans une version ultérieure) — chaque exécution produit un instantané CSV et une notification dans l’application.",
    "recipientsLabel": "Destinataires",
    "recipientsHint": "Enregistrés avec le rapport. La livraison par e-mail arrivera dans une version ultérieure — pour l’instant, les exécutions vous notifient dans l’application.",
    "deliveryBadge": "Instantané CSV",
    "delete": "Supprimer",
    "create": "Créer",
    "cadence": {
      "daily": "Quotidien à {time} ({zone})",
      "weekly": "Hebdomadaire · {day} à {time} ({zone})",
      "monthly": "Mensuel · le {day} à {time} ({zone})"
    }
  },
  "notifications": {
    "channel": {
      "inApp": "Dans l’application",
      "email": "E-mail",
      "push": "Push"
    },
    "event": {
      "reportReady": "Rapport planifié prêt",
      "reportFailed": "Échec du rapport planifié",
      "backupCompleted": "Sauvegarde terminée"
    }
  },
  "theme": {
    "toLight": "Mode clair",
    "toDark": "Mode sombre"
  },
  "audit": {
    "action": {
      "view": "Voir"
    },
    "actor": {
      "apiKey": "Clé d’API",
      "automation": "Automatisation",
      "system": "Système",
      "user": "Utilisateur"
    },
    "category": {
      "auth": "Authentification et comptes",
      "automation": "Automatisations",
      "connection": "Connexions de données",
      "data": "Enregistrements",
      "export": "Imports et exports",
      "llm": "Assistance IA",
      "rbac": "Rôles et permissions",
      "schema": "Schéma",
      "settings": "Paramètres",
      "system": "Système"
    },
    "column": {
      "action": "Action",
      "actor": "Auteur",
      "category": "Catégorie",
      "details": "Détails",
      "when": "Quand"
    },
    "drawer": {
      "actorId": "Identifiant de l’auteur",
      "actorKind": "Type d’auteur",
      "after": "Après",
      "before": "Avant",
      "category": "Catégorie",
      "changes": "Modifications",
      "connection": "Connexion",
      "field": "Champ",
      "ip": "Adresse IP",
      "noChanges": "Cette action n’a enregistré aucun instantané avant/après.",
      "none": "Aucun",
      "requestId": "Identifiant de requête",
      "resource": "Ressource",
      "subtitle": "{actor} · {when}",
      "truncated": "Tronqué à 16 Ko",
      "userAgent": "Agent utilisateur"
    },
    "empty": {
      "body": "Les modifications apportées aux données, au schéma, aux paramètres et aux permissions apparaissent ici au fil de l’eau.",
      "filtered": {
        "body": "Élargissez la plage de dates ou effacez le filtre de catégorie.",
        "title": "Aucun résultat pour ces filtres"
      },
      "title": "Rien n’a encore été enregistré"
    },
    "filterActor": "Identifiant de l’auteur",
    "filterCategoryAny": "Toutes les catégories",
    "filterCategory": "Filtrer par catégorie",
    "filterFrom": "Du",
    "filterTo": "Au",
    "listFailed": {
      "title": "Impossible de charger le journal d’audit"
    },
    "loadMore": "Charger les entrées plus anciennes",
    "subtitle": "Chaque modification apportée à cet espace de travail, son auteur, et ce qu’elle a changé.",
    "title": "Journal d’audit"
  },
  "roles": {
    "action": {
      "delete": "Supprimer",
      "rename": "Renommer"
    },
    "builtinLocked": "Les rôles intégrés ne peuvent pas être supprimés.",
    "category": {
      "access": "Accès",
      "data": "Données",
      "operations": "Opérations",
      "workspace": "Espace de travail"
    },
    "column": {
      "actions": "Actions",
      "members": "Membres",
      "name": "Rôle"
    },
    "create": {
      "descriptionLabel": "Description",
      "description": "Un nouveau rôle démarre sans aucune permission.",
      "failed": "Impossible de créer le rôle",
      "namePlaceholder": "ex. Agent de support",
      "name": "Nom",
      "submit": "Créer le rôle",
      "title": "Nouveau rôle"
    },
    "createButton": "Nouveau rôle",
    "delete": {
      "confirm": "Supprimer le rôle",
      "description": "Le rôle et ses lignes de permissions sont supprimés.",
      "failed": "Impossible de supprimer le rôle",
      "hasMembers": "« {name} » compte encore {count, plural, one {# membre} other {# membres}}. Choisissez le rôle vers lequel les déplacer — Adminium ne laissera jamais un compte sans rôle.",
      "noMembers": "Personne ne détient « {name} », rien ne sera donc déplacé.",
      "reassignPlaceholder": "Choisissez un rôle…",
      "reassignTo": "Déplacer les membres vers",
      "title": "Supprimer le rôle"
    },
    "list": {
      "title": "Rôles"
    },
    "loadFailed": {
      "body": "La matrice ci-dessous est incomplète : l’enregistrer retirerait des permissions qui ne sont simplement pas chargées. Rechargez la page avant toute modification.",
      "title": "Certaines permissions n’ont pas pu être lues"
    },
    "matrix": {
      "discard": "Abandonner",
      "empty": {
        "body": "Cette instance n’a signalé aucune permission attribuable, ce qui ne devrait pas arriver — rechargez la page, et si le problème persiste, consultez le journal du serveur.",
        "title": "Aucune permission à afficher"
      },
      "label": "Permissions des rôles",
      "noChanges": "Aucune modification en attente",
      "pending": "{count, plural, one {# modification en attente} other {# modifications en attente}}",
      "rowHeader": "Permission",
      "title": "Permissions"
    },
    "memberCount": "{count, plural, one {# utilisateur} other {# utilisateurs}}",
    "permission": {
      "apiKeysManage": "Gérer les clés d’API",
      "auditRead": "Lire le journal d’audit",
      "connectionsManage": "Gérer les connexions aux bases de données",
      "exportsManage": "Gérer les exports de tout le monde",
      "importsManage": "Gérer les imports de tout le monde",
      "jobsManage": "Démarrer et annuler les tâches en arrière-plan",
      "manifestsManage": "Installer et connecter des modules",
      "jobsRead": "Voir toutes les tâches en arrière-plan",
      "llmRun": "Utiliser l’assistance IA",
      "pagesManage": "Créer et organiser les pages",
      "reportsManage": "Gérer les rapports planifiés",
      "rolesManage": "Gérer les rôles et les permissions",
      "schemaRemap": "Modifier les libellés et les remplacements du schéma",
      "settingsManage": "Gérer les paramètres de l’espace de travail",
      "usersManage": "Gérer les utilisateurs"
    },
    "rename": {
      "failed": "Impossible de renommer le rôle",
      "title": "Renommer le rôle"
    },
    "saveFailed": {
      "title": "Impossible d’enregistrer tous les rôles"
    },
    "subtitle": "Ce que chaque rôle est autorisé à faire. Un utilisateur cumule les permissions de tous les rôles qu’il détient.",
    "title": "Rôles et permissions"
  },
  "security": {
    "password": {
      "changedBody": "Utilisez le nouveau mot de passe à votre prochaine connexion. Vos autres appareils restent connectés — mettez fin à ces sessions si vous souhaitez les déconnecter.",
      "changed": "Mot de passe modifié",
      "confirm": "Confirmer le nouveau mot de passe",
      "current": "Mot de passe actuel",
      "failed": "Impossible de modifier votre mot de passe",
      "helper": "Au moins 8 caractères.",
      "mismatch": "Les deux mots de passe ne correspondent pas.",
      "new": "Nouveau mot de passe",
      "submit": "Modifier le mot de passe",
      "title": "Mot de passe"
    },
    "sessions": {
      "expires": "Expire {at}",
      "failedBody": "Cette liste est le seul endroit qui indique où votre compte est connecté : si elle est vide, considérez que l’information est inconnue, et non qu’il n’y a aucune session.",
      "failed": "Impossible de lire vos sessions",
      "ip": "IP {ip}",
      "loading": "Recherche des autres appareils connectés…",
      "noIp": "Aucune IP enregistrée",
      "revokeBody": "La session prend fin immédiatement et la personne qui l’utilise devra se reconnecter.",
      "revokeFailed": "Impossible de déconnecter cet appareil",
      "revokeTitle": "Déconnecter cet appareil",
      "revoke": "Déconnecter",
      "seenUnknown": "Dernière activité : inconnue",
      "seen": "Dernière activité {since}",
      "thisDevice": "Cet appareil",
      "title": "Sessions actives",
      "unknownDevice": "Appareil non reconnu"
    },
    "subtitle": "Votre mot de passe, votre second facteur, et tous les endroits où vous êtes connecté.",
    "title": "Sécurité",
    "twoFactor": {
      "activateFailed": "Ce code n’a pas été accepté",
      "activate": "Activer la double authentification",
      "body": "Une application d’authentification génère un code à 6 chiffres qu’Adminium demande après votre mot de passe.",
      "code": "Code de votre application",
      "copyKey": "Copier la clé de configuration",
      "copyLink": "Copier le lien de configuration",
      "disableBody": "Votre compte revient au mot de passe seul, et vos codes de récupération cessent de fonctionner.",
      "disableConfirm": "Désactiver",
      "disableFailed": "Impossible de désactiver la double authentification",
      "disablePassword": "Votre mot de passe",
      "disableTitle": "Désactiver l’authentification à deux facteurs",
      "disable": "Désactiver la double authentification",
      "enrollFailed": "Impossible de démarrer la configuration",
      "enroll": "Configurer la double authentification",
      "hide": "Masquer la clé de configuration",
      "off": "Désactivée",
      "on": "Activée",
      "recovery": {
        "body": "Chaque code vous connecte une seule fois si vous perdez votre application d’authentification. Ils ne sont affichés que maintenant.",
        "copy": "Copier les codes",
        "title": "Enregistrez vos codes de récupération"
      },
      "reveal": "Afficher la clé de configuration",
      "secretHelper": "Collez le lien de configuration dans votre application d’authentification, ou saisissez la clé à la main.",
      "secret": "Clé de configuration",
      "title": "Authentification à deux facteurs"
    }
  },
  "team": {
    "action": {
      "reactivate": "Réactiver",
      "remove": "Supprimer",
      "resend": "Nouveau lien",
      "roles": "Rôles",
      "suspend": "Suspendre"
    },
    "column": {
      "actions": "Actions",
      "lastSeen": "Dernière activité",
      "person": "Personne",
      "roles": "Rôles",
      "status": "Statut"
    },
    "counts": "{active} actifs · {invited} invités · {suspended} suspendus",
    "empty": {
      "body": "Invitez un coéquipier pour lui donner son propre accès et son propre rôle.",
      "filtered": {
        "body": "Effacez les filtres pour voir tout l’annuaire.",
        "title": "Personne ne correspond à ces filtres"
      },
      "title": "Vous êtes la seule personne à avoir un compte"
    },
    "filterRoleAny": "Tous les rôles",
    "filterRole": "Filtrer par rôle",
    "filterStatusAny": "Tous les statuts",
    "filterStatus": "Filtrer par statut",
    "invite": {
      "copied": "Copié",
      "copyLink": "Copier le lien",
      "created": {
        "body": "Envoyez vous-même ce lien à {email}. Il n’est affiché qu’une seule fois — Adminium n’en stocke qu’une empreinte, donc si vous le perdez, vous devrez supprimer l’invitation et en créer une nouvelle.",
        "title": "Invitation créée"
      },
      "emailIt": "Envoyer l’invitation par e-mail",
      "expiresRelative": "Le lien expire {at} ({relative}).",
      "expires": "Le lien expire {at}.",
      "noEmail": {
        "smtp": "Aucun serveur SMTP n’est configuré sur cette instance : il n’y a donc rien pour envoyer le courrier. Partagez le lien par un canal auquel vous faites déjà confiance.",
        "title": "Adminium n’a pas envoyé ce lien par e-mail",
        "unknown": "Adminium n’a pas pu vérifier si cette instance est capable d’envoyer des e-mails. Partagez le lien par un canal auquel vous faites déjà confiance."
      }
    },
    "inviteButton": "Inviter un coéquipier",
    "inviteDialog": {
      "description": "Adminium crée le compte et vous fournit un lien d’activation à usage unique à transmettre.",
      "emailPlaceholder": "nom@exemple.com",
      "email": "E-mail",
      "failed": "Impossible de créer l’invitation",
      "namePlaceholder": "ex. Dana Osei",
      "name": "Nom",
      "rolesHelper": "Choisissez le rôle le moins privilégié qui lui permette de faire son travail. Vous pourrez le modifier plus tard.",
      "roles": "Rôles",
      "submit": "Créer l’invitation",
      "title": "Inviter un coéquipier"
    },
    "listFailed": {
      "title": "Impossible de charger l’annuaire"
    },
    "loadMore": "Charger plus",
    "neverSignedIn": "Jamais connecté",
    "noRoles": "Aucun rôle",
    "remove": {
      "body": "Cette action efface le compte de {name}, ses préférences et ses sessions de connexion, et retire son nom de l’historique des paramètres qu’il a modifiés. Suspendre le compte conserve tout cela et l’empêche seulement de se connecter. Cette action est irréversible.",
      "confirm": "Supprimer définitivement",
      "prompt": "Saisissez « {email} » pour confirmer",
      "title": "Supprimer définitivement le compte"
    },
    "roles": {
      "unavailable": "Les rôles ne sont pas visibles pour votre compte : aucun ne peut donc être attribué ici."
    },
    "rolesDialog": {
      "description": "Un utilisateur cumule les permissions de tous les rôles qu’il détient.",
      "failed": "Impossible de modifier les rôles",
      "title": "Rôles de {name}"
    },
    "rolesLocked": "Modifier les rôles requiert la permission « Gérer les rôles ».",
    "search": "Rechercher un nom ou un e-mail",
    "status": {
      "active": "Actif",
      "invited": "Invité",
      "suspended": "Suspendu"
    },
    "subtitle": "Qui possède un compte sur cet Adminium, et ce que chacun peut faire.",
    "title": "Équipe",
    "twoFactorOn": "L’authentification à deux facteurs est activée",
    "twoFactorShort": "2FA"
  },
  "email": {
    "linkFallback": "Si le bouton ne fonctionne pas, collez ce lien dans votre navigateur : {url}",
    "notification": {
      "action": "Ouvrir {appName}",
      "footer": "Vous recevez cet e-mail parce que les notifications par e-mail sont activées pour votre compte {appName}. Vous pouvez les désactiver dans vos préférences de notification.",
      "name": "Notification"
    },
    "passwordReset": {
      "action": "Choisir un nouveau mot de passe",
      "heading": "Réinitialiser votre mot de passe",
      "intro": "Bonjour {name}, nous avons reçu une demande de réinitialisation du mot de passe de {email}.",
      "name": "Réinitialisation du mot de passe",
      "notice": "Ce lien ne fonctionne qu’une seule fois et expire dans {expiresInMinutes} minutes. Si vous n’avez pas demandé la réinitialisation de votre mot de passe, vous pouvez ignorer cet e-mail — votre mot de passe actuel reste actif.",
      "subject": "Réinitialisez votre mot de passe {appName}"
    },
    "userInvite": {
      "action": "Accepter l’invitation",
      "heading": "Vous avez reçu une invitation",
      "intro": "{inviterName} vous invite à rejoindre {appName}. Acceptez l’invitation pour définir un mot de passe pour {email} et vous connecter.",
      "name": "Invitation à l’équipe",
      "notice": "Cette invitation ne fonctionne qu’une seule fois et expire dans {expiresInDays} jours. Si vous ne l’attendiez pas, vous pouvez ignorer cet e-mail.",
      "subject": "Vous avez reçu une invitation à rejoindre {appName}",
      "inviterFallback": "Un administrateur"
    }
  }
} as const;
