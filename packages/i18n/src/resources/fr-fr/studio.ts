// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/studio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "title": "Studio",
  "settings": {
    "title": "Paramètres",
    "workspaceSection": "Espace de travail",
    "globalDefaultsNav": "Valeurs par défaut globales"
  },
  "source": {
    "engine": {
      "label": "Moteur de base de données",
      "postgres": "PostgreSQL",
      "mysql": "MySQL / MariaDB",
      "sqlite": "SQLite"
    },
    "format": {
      "label": "Format du schéma",
      "helper": "Laissez la détection automatique, sauf si elle se trompe.",
      "auto": "Détection automatique",
      "sql": "DDL SQL / pg_dump",
      "prisma": "Schéma Prisma",
      "drizzle": "Drizzle ORM",
      "typeorm": "Entités TypeORM",
      "sequelize": "Modèles Sequelize",
      "rails": "schema.rb Rails",
      "django": "models.py Django",
      "json": "JSON Adminium"
    },
    "sqlite": {
      "file": "Chemin du fichier de base de données",
      "helper": "SQLite est un fichier, pas un serveur — indiquez le chemin absolu sur la machine qui exécute Adminium."
    },
    "file": {
      "detectedAs": "Détecté : {format}",
      "moreWarnings": "+{count} avertissements supplémentaires — la liste complète apparaît à l’étape d’analyse.",
      "dropTitle": "Déposez votre fichier de schéma ici, ou parcourez",
      "dropHint": "SQL DDL / pg_dump, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, modèles Django, Adminium JSON",
      "pitch": "Aucune connexion à la base requise — nous analysons votre fichier de schéma et construisons les mêmes tableaux de bord.",
      "parsing": "Lecture du fichier de schéma téléversé…",
      "tables": "tables",
      "columns": "colonnes",
      "warnings": "avertissements",
      "errorTitle": "Impossible d’analyser le fichier",
      "parseFailed": "Nous n’avons pas pu analyser ce fichier. Si la détection automatique s’est trompée, choisissez le format explicitement et réessayez.",
      "unsupported": "Format non reconnu — SQL DDL, Prisma, Drizzle, TypeORM, Sequelize, Rails schema.rb, modèles Django et Adminium JSON sont pris en charge. Choisissez-en un explicitement et réessayez.",
      "requestFailed": "Échec du téléversement — vérifiez votre connexion et réessayez."
    },
    "title": "Connectez votre base de données",
    "subtitle": "Pointez Adminium vers une base de données et nous générerons un tableau de bord d’administration à partir de son schéma.",
    "name": "Nom de la connexion",
    "namePlaceholder": "Postgres de production",
    "modeLabel": "Mode de saisie de la source",
    "mode": {
      "dsn": "Chaîne de connexion",
      "fields": "Champs individuels",
      "file": "Fichier de schéma"
    },
    "dsn": {
      "label": "Chaîne de connexion",
      "helper": "postgres://utilisateur:motdepasse@hote:5432/base — mysql:// et sqlite: fonctionnent aussi.",
      "incomplete": "Ajoutez l’hôte et la base, p. ex. postgres://user@host:5432/db",
      "invalidScheme": "Schéma non reconnu — attendu : postgres://, mysql://, mariadb:// ou sqlite:",
      "quickFill": "Remplissage rapide :"
    },
    "fields": {
      "host": "Hôte",
      "port": "Port",
      "database": "Base de données",
      "user": "Utilisateur",
      "password": "Mot de passe",
      "ssl": "Mode SSL",
      "preview": "Aperçu de la chaîne de connexion :"
    },
    "readOnlyRole": {
      "title": "Utilisez un rôle en lecture seule",
      "body": "Adminium n’écrit jamais dans votre base — la configuration n’utilise que les métadonnées du schéma. Nous recommandons un utilisateur dédié avec des droits SELECT uniquement ; vous choisirez où Adminium range ses propres tables à l’étape du stockage méta."
    }
  },
  "capability": {
    "mysqlApproxRows": "Les nombres de lignes MySQL sont des estimations du moteur de stockage (dérive possible jusqu’à ±40 %) — affichés avec ≈.",
    "mysqlFkEnum": "Les métadonnées FK/enum de MySQL sont plus limitées : les tables MyISAM ne déclarent pas de clés étrangères, les enums sont des types enum(…) par colonne et les contraintes CHECK requièrent MySQL 8.0.16+ / MariaDB 10.2+.",
    "sqliteCheckEnums": "SQLite n’a pas de type enum natif — les enums sont synthétisés à partir des contraintes CHECK (col IN (…)).",
    "sqliteNoComments": "SQLite n’a pas de commentaires de colonne — utilisez l’éditeur de remappage du schéma pour ajouter des libellés.",
    "importNoRowCounts": "Les fichiers de schéma ne contiennent pas de nombres de lignes — la liste des tables affiche — plutôt que des chiffres inventés.",
    "importNoLiveHealth": "Pas de connexion à une base de données réelle — les contrôles de santé et la détection de dérive du schéma sont indisponibles pour cette source.",
    "rowsUnavailable": "Les fichiers de schéma n’ont pas de base de données réelle — les nombres de lignes restent inconnus tant que vous n’en connectez pas une.",
    "rowsRunAnalyze": "Pas encore d’estimation — exécutez ANALYZE sur la base pour obtenir les nombres de lignes.",
    "rowsNoEstimate": "Le moteur n’a communiqué aucune estimation pour cette table.",
    "rowsApproximate": "Estimation du moteur de stockage — dérive possible jusqu’à ±40 % avec InnoDB."
  },
  "test": {
    "log": {
      "moreWarnings": "+{count} avertissements du parseur supplémentaires",
      "connecting": "Établissement d’une connexion sécurisée…",
      "connected": "Connecté ({latency} ms) · introspection en lecture seule",
      "connectFailed": "Échec de la connexion.",
      "readingSchema": "Lecture du schéma : public",
      "readingFile": "Lecture du fichier de schéma téléversé…",
      "parsingFile": "Analyse de {file}…",
      "detected": "{tables} tables · {columns} colonnes détectées",
      "found": "{tables} tables · {columns} colonnes trouvées",
      "mapping": "Correspondance des types de colonnes → widgets de saisie",
      "relations": "Détection des relations…",
      "piiScan": "Recherche de colonnes PII…",
      "piiDone": "Analyse PII terminée — {count} colonnes masquées par défaut",
      "piiDoneUnknown": "Analyse PII terminée",
      "jobFailed": "Échec de l’introspection.",
      "networkFailed": "Échec de la requête — vérifiez votre connexion et réessayez.",
      "ready": "Prêt"
    },
    "title": "Analyse de votre schéma",
    "subtitle": "Introspection des tables, colonnes et relations. Cela prend quelques secondes.",
    "trust": "Nous ne faisons que lire votre schéma et vos données. Rien n’est modifié.",
    "errorTitle": "Échec de la connexion",
    "retry": "Réessayer",
    "logLabel": "Journal d’introspection",
    "hint": {
      "auth": "Échec de l’authentification — vérifiez le nom d’utilisateur et le mot de passe dans votre DSN.",
      "hostUnreachable": "Hôte injoignable — vérifiez le nom d’hôte et le port, et que la base accepte les connexions depuis cette machine (ajoutez nos IP à la liste d’autorisation).",
      "metaPlacement": "Cette source ne peut pas héberger les tables méta d’Adminium — continuez avec une base méta séparée.",
      "permission": "Le rôle s’est connecté mais n’a pas les droits de lecture du schéma — accordez USAGE sur le schéma à votre rôle d’introspection.",
      "timeout": "La base n’a pas répondu à temps — vérifiez le chemin réseau et la charge, puis réessayez.",
      "tls": "Échec de la négociation TLS — essayez sslmode=require, ou téléversez le certificat CA attendu par votre serveur.",
      "unknown": "Échec de la connexion — vérifiez la DSN et réessayez."
    }
  },
  "tables": {
    "importNoCounts": "Les fichiers de schéma ne contiennent pas de nombres de lignes — la colonne affiche — tant qu’aucune base réelle n’est connectée.",
    "title": "Choisissez vos tables",
    "subtitle": "Choisissez lesquelles inclure. Vous pourrez en changer à tout moment.",
    "search": "Filtrer les tables…",
    "listLabel": "Tables incluables",
    "emptyFilter": "Aucune table ne correspond à votre filtre.",
    "pii": "PII",
    "highVolume": "gros volume",
    "highVolumeNote": "Les tables de plus de 100 000 lignes démarrent décochées — les tables techniques ont rarement leur place dans un tableau de bord.",
    "joinHidden": "{count} tables de jointure/système sont masquées d’avance — elles alimentent toujours les relations plusieurs-à-plusieurs."
  },
  "hub": {
    "title": "Connexions de données",
    "subtitle": "{healthy, number} sur {total, plural, one {# connexion} other {# connexions}} en bonne santé",
    "connectNew": "Nouvelle connexion",
    "stats": {
      "connections": "Connexions",
      "healthy": "En bonne santé",
      "tables": "Tables incluses",
      "pages": "Pages générées"
    },
    "status": {
      "connected": "Connectée",
      "error": "Erreur",
      "unconfigured": "Brouillon",
      "testing": "Test en cours…",
      "paused": "En pause"
    },
    "card": {
      "readOnly": "Lecture seule",
      "tables": "Tables",
      "pages": "Pages",
      "latency": "Latence",
      "latencyMs": "{latency, number} ms",
      "lastIntrospected": "Dernière introspection",
      "never": "Jamais",
      "timezone": "Fuseau horaire",
      "timezoneGuessed": "depuis ce serveur",
      "paused": "Adminium ne se connecte pas à cette base de données. Ses pages se chargeront de nouveau dès que vous la reprendrez.",
      "pausedSince": "En pause {when} — Adminium ne se connecte pas à cette base de données. Ses pages se chargeront de nouveau dès que vous la reprendrez."
    },
    "action": {
      "test": "Tester",
      "reintrospect": "Réintrospecter",
      "reintrospectFile": "Les sources de type fichier de schéma n’ont pas de base de données active — téléversez à nouveau le fichier.",
      "remap": "Remapper le schéma",
      "delete": "Supprimer",
      "regional": "Paramètres régionaux",
      "pause": "Mettre en pause",
      "resume": "Reprendre",
      "pausedHint": "Cette connexion est en pause — reprenez-la pour atteindre la base de données.",
      "rename": "Renommer"
    },
    "regional": {
      "title": "Paramètres régionaux",
      "intro": "Ils décrivent l'entreprise à laquelle appartient cette base de données, et non la personne qui la consulte. Les applications servies par Adminium les lisent ici.",
      "timezone": "Fuseau horaire",
      "timezoneHelper": "Les dates et heures s'affichent dans ce fuseau. Sans fuseau, les applications hébergées par Adminium basculent en UTC et l'indiquent à l'écran.",
      "guessedTitle": "Ce fuseau vient du serveur",
      "guessedBody": "Adminium l'a repris de la machine sur laquelle il tourne ; personne ne l'a choisi ici. Enregistrez pour le confirmer, ou choisissez le fuseau dans lequel cette entreprise travaille réellement.",
      "timezonePlaceholder": "Région/Ville",
      "currency": "Devise",
      "currencyHelper": "Sert à formater les montants. Facultatif : ne pas la définir n'affecte que le formatage.",
      "currencyPlaceholder": "Code ISO-4217",
      "notSet": "Non défini",
      "noMatch": "Aucun fuseau correspondant",
      "noMatchCurrency": "Aucune devise correspondante",
      "save": "Enregistrer",
      "failed": "Impossible d'enregistrer les paramètres régionaux",
      "saved": "Paramètres régionaux mis à jour"
    },
    "test": {
      "ok": "Connexion en bonne santé · {latency, number} ms",
      "failed": "Échec du test de connexion"
    },
    "introspect": {
      "noChanges": "Schéma inchangé — aucun nouvel instantané.",
      "updated": "Schéma réintrospecté",
      "masksProposed": "{count, plural, one {# colonne proposée} other {# colonnes proposées}} au masquage — à vérifier dans l’éditeur de remappage.",
      "failed": "Échec de l’introspection. Réessayez."
    },
    "delete": {
      "title": "Supprimer la connexion",
      "body": "Cette action supprime « {name} » et les pages générées. Votre base de données n’est jamais touchée.",
      "prompt": "Saisissez {name} pour confirmer",
      "confirm": "Supprimer la connexion",
      "cancel": "Annuler",
      "close": "Fermer",
      "success": "Connexion « {name} » supprimée",
      "failed": "Impossible de supprimer la connexion. Réessayez."
    },
    "empty": {
      "title": "Aucune source de données",
      "body": "Connectez une base de données : Adminium génère votre panneau d’administration à partir de son schéma.",
      "cta": "Connecter une base de données"
    },
    "hostedApps": "Apps hébergées",
    "subtitlePaused": "{healthy, number} sur {total, plural, one {# connexion} other {# connexions}} en bonne santé · {paused, number} en pause",
    "pause": {
      "title": "Mettre cette connexion en pause ?",
      "body": "Adminium n’ouvre plus aucune connexion vers « {name} ». Ses {pages, plural, one {# page} other {# pages}}, ses rapports planifiés et ses applications hébergées cessent de charger des données jusqu’à ce que vous la repreniez.",
      "keeps": "Rien n’est supprimé — la connexion, son schéma et ses {pages, plural, one {# page} other {# pages}} sont conservés, et un clic les ramène.",
      "confirm": "Mettre la connexion en pause",
      "pausedToast": "Connexion « {name} » mise en pause",
      "resumedToast": "Connexion « {name} » reprise",
      "pauseFailed": "Impossible de mettre la connexion en pause. Réessayez.",
      "resumeFailed": "Impossible de reprendre la connexion. Réessayez."
    },
    "rename": {
      "title": "Renommer la connexion",
      "label": "Nom",
      "helper": "Le nom de cette base partout dans Adminium — la carte, le groupe de la barre latérale au-dessus de ses pages, et chaque sélecteur qui la propose. La base elle-même n'est pas renommée.",
      "save": "Renommer",
      "saved": "Connexion renommée",
      "failed": "La connexion n'a pas pu être renommée"
    }
  },
  "settingsHub": {
    "title": "Paramètres de l’espace de travail",
    "subtitle": "Identité, sécurité et actions destructrices pour cet espace de travail.",
    "save": "Enregistrer les modifications",
    "saved": "Paramètres de l’espace de travail mis à jour",
    "saveFailed": "Impossible d’enregistrer les paramètres de l’espace de travail. Réessayez.",
    "superAdminOnlyTitle": "Super administrateur requis",
    "superAdminOnly": "Seul un super administrateur peut modifier l’identité et les paramètres de sécurité de l’espace de travail.",
    "identity": {
      "heading": "Identité de l’espace de travail",
      "appName": {
        "label": "Nom de l’application",
        "helper": "Affiché dans la barre latérale, le titre du navigateur et les e-mails.",
        "error": "Saisissez un nom de 60 caractères maximum."
      },
      "logo": {
        "label": "Logo",
        "drop": "Déposez une image ici",
        "helper": "PNG, JPEG, WebP, GIF ou SVG, jusqu’à 1 Mo. Remplace la marque intégrée partout.",
        "upload": "Importer un logo",
        "replace": "Remplacer le logo",
        "remove": "Supprimer",
        "uploaded": "Logo mis à jour",
        "removed": "Logo supprimé",
        "tooLarge": "Cette image dépasse 1 Mo.",
        "badType": "Choisissez une image PNG, JPEG, WebP, GIF ou SVG.",
        "undo": "Annuler"
      },
      "showVersion": {
        "label": "Version dans la barre latérale",
        "helper": "Le numéro de build à côté du logo. Désactivé, il masque votre version."
      }
    },
    "security": {
      "heading": "Sécurité",
      "require2fa": {
        "label": "Exiger l’authentification à deux facteurs",
        "desc": "Chaque membre doit activer la 2FA pour se connecter.",
        "note": "Indicatif, pas bloquant : les membres sans 2FA sont dirigés vers sa configuration et ne peuvent plus la désactiver, mais leur connexion n’est jamais bloquée, et les clés API ne sont pas concernées."
      },
      "allowSignup": {
        "label": "Autoriser l’auto-inscription",
        "desc": "N’importe qui peut créer un compte — désactivé, l’espace de travail reste sur invitation uniquement."
      },
      "sessionTtl": {
        "label": "Durée de session (heures)",
        "error": "Entre {min, number} et {max, number} heures."
      },
      "passwordMin": {
        "label": "Longueur minimale du mot de passe",
        "error": "Entre {min, number} et {max, number} caractères."
      }
    },
    "email": {
      "heading": "E-mail (SMTP)",
      "unconfigured": "Aucun serveur de messagerie n’est configuré, donc Adminium ne peut envoyer ni réinitialisation de mot de passe, ni invitation, ni rapport planifié.",
      "host": {
        "label": "Hôte SMTP",
        "error": "Un nom d’hôte ou une adresse IP uniquement — sans schéma, port ni identifiants."
      },
      "port": {
        "label": "Port",
        "error": "Entre {min, number} et {max, number}."
      },
      "user": {
        "label": "Nom d’utilisateur",
        "helper": "Laissez vide si le relais ne demande pas d’authentification."
      },
      "pass": {
        "label": "Mot de passe",
        "helper": "Chiffré au stockage et jamais réaffiché. Laissez vide pour conserver l’actuel.",
        "error": "Ce nom d’utilisateur exige un mot de passe."
      },
      "from": {
        "label": "Adresse d’expéditeur",
        "helper": "Une adresse seule, ou un nom d’affichage devant.",
        "error": "Saisissez une adresse e-mail."
      },
      "secure": {
        "label": "TLS implicite",
        "helper": "Activé pour le port 465. Désactivé démarre en clair puis passe à STARTTLS, ce qu’attend le port 587."
      },
      "remove": "Supprimer le serveur de messagerie",
      "review": {
        "removed": "Supprimé",
        "password": "Remplacé"
      }
    },
    "review": {
      "title": "Enregistrer les paramètres de l’espace de travail",
      "subtitle": "Vérifiez vos modifications avant d’enregistrer.",
      "confirm": "Enregistrer les modifications",
      "cancel": "Annuler",
      "close": "Fermer",
      "on": "Activé",
      "off": "Désactivé",
      "shown": "Affiché",
      "hidden": "Masqué",
      "change": "{before} → {after}"
    },
    "defaultsCard": {
      "heading": "Valeurs par défaut d’apparence et de langue",
      "body": "Le thème, la couleur d’accent, la densité et la langue de tout l’espace de travail se trouvent dans les valeurs par défaut globales.",
      "cta": "Ouvrir les valeurs par défaut globales"
    },
    "danger": {
      "heading": "Zone de danger",
      "subtitle": "Actions irréversibles.",
      "empty": "Rien à supprimer — aucune connexion pour l’instant.",
      "deleteDesc": "Supprime la connexion et les pages générées. Votre base de données n’est pas touchée. Irréversible.",
      "deleteCta": "Supprimer la connexion"
    },
    "aiCard": {
      "heading": "Enrichissement par IA",
      "body": "Configurez un fournisseur IA (ou l’aller-retour copier-coller) pour enrichir libellés, groupes et relations.",
      "cta": "Ouvrir les réglages IA"
    },
    "pagesCard": {
      "heading": "Pages",
      "body": "Ajoutez, modifiez et supprimez des pages, changez leur contenu et réordonnez la barre latérale.",
      "cta": "Gérer les pages"
    },
    "translationsCard": {
      "heading": "Langues et traductions",
      "body": "Reformulez n’importe quel texte d’Adminium, choisissez les langues proposées et ajoutez les vôtres.",
      "cta": "Ouvrir les traductions"
    }
  },
  "settingsAi": {
    "title": "Enrichissement par IA",
    "subtitle": "Connectez un modèle pour qu’Adminium suggère des libellés, des groupes, des relations et plus encore — toujours revus sous forme de diff avant toute application.",
    "saved": "Fournisseur IA enregistré",
    "saveFailed": "Impossible d’enregistrer le fournisseur IA. Réessayez.",
    "save": "Enregistrer le fournisseur",
    "test": "Tester la connexion",
    "testHintDirty": "Enregistrez vos modifications avant de tester.",
    "testing": "Test du fournisseur en cours…",
    "testError": "Échec du test",
    "testErrorBody": "Impossible de joindre le fournisseur. Vérifiez la clé et l’URL de base.",
    "testOk": "Connecté à {model} en {latency} ms",
    "testUnknownModel": "le fournisseur",
    "provider": {
      "heading": "Fournisseur IA",
      "subtitle": "Choisissez comment Adminium atteint un modèle pour enrichir votre schéma. Les clés sont stockées chiffrées et ne sont jamais réaffichées.",
      "active": "Actif",
      "anthropic": {
        "label": "Anthropic",
        "desc": "Modèles Claude via l’API Anthropic."
      },
      "openai": {
        "label": "OpenAI",
        "desc": "Modèles GPT via l’API OpenAI."
      },
      "openaiCompatible": {
        "label": "Compatible OpenAI",
        "desc": "Tout point de terminaison au format OpenAI — Groq, Together, vLLM, LM Studio."
      },
      "ollama": {
        "label": "Ollama (local)",
        "desc": "Modèles exécutés localement via Ollama — sans clé, sans cloud."
      },
      "requiresNetwork": "Nécessite Internet et une clé API",
      "networkDisabledTitle": "Les fournisseurs IA directs sont désactivés sur cette installation",
      "networkDisabledBody": "Cet Adminium est configuré sans accès Internet sortant : il ne peut joindre aucune API de fournisseur. Utilisez l'aller-retour copier-coller ci-dessous — ni clé ni réseau requis."
    },
    "configure": {
      "heading": "Configurer {provider}"
    },
    "field": {
      "baseUrl": "URL de base",
      "baseUrlOptional": "Laissez tel quel, sauf si Ollama tourne sur un autre hôte.",
      "baseUrlHelper": "La racine du point de terminaison qui sert /chat/completions.",
      "model": "Modèle",
      "modelFreeText": "Saisissez l’identifiant exact du modèle servi par votre point de terminaison.",
      "modelLive": "Chargé en direct depuis le fournisseur.",
      "modelStatic": "Une liste éprouvée ; saisissez un identifiant personnalisé après l’enregistrement pour l’actualiser.",
      "modelLoading": "Chargement…",
      "modelPlaceholder": "Sélectionner un modèle…",
      "key": "Clé API",
      "keyStored": "Stockée chiffrée. Remplacez-la pour utiliser une autre clé.",
      "keyMask": "sk-…{last4}",
      "keyReplace": "Remplacer la clé",
      "keyOptional": "Facultatif — certains points de terminaison n’exigent aucune clé.",
      "keyWriteOnly": "En écriture seule : une fois enregistrée, elle n’est jamais réaffichée.",
      "noKeyTitle": "Aucune clé API requise",
      "noKeyBody": "Ollama tourne localement, donc rien ne quitte cette machine."
    },
    "runStatus": {
      "draft": "Brouillon",
      "running": "En cours",
      "awaitingResponse": "En attente de réponse",
      "validated": "Validé",
      "applied": "Appliqué",
      "partiallyApplied": "Partiellement appliqué",
      "failed": "Échoué",
      "discarded": "Abandonné"
    },
    "byo": {
      "heading": "Pas de clé ? Utilisez votre propre outil IA",
      "subtitle": "L’aller-retour copier-coller — rien ne quitte cette machine.",
      "body": "Studio peut générer un prompt autonome à partir de votre schéma. Exécutez-le dans Claude Code, ChatGPT ou l’outil de votre choix, puis collez le JSON renvoyé dans l’assistant de connexion. Même validation, même revue, même résultat que la voie directe.",
      "guaranteeTitle": "Garantie sans télémétrie",
      "guarantee1": "Le prompt ne contient que votre schéma et des statistiques agrégées — jamais de données de lignes par défaut.",
      "guarantee2": "Aucun identifiant, URL d’instance ni justificatif n’y est intégré.",
      "guarantee3": "Les exécutions BYO ne font aucun appel réseau.",
      "promptVersion": "Prompt {version}",
      "schemaVersion": "Schéma {version}",
      "headingRecommended": "Utilisez votre propre outil IA — aucune clé requise",
      "recommended": "Recommandé"
    },
    "history": {
      "heading": "Historique des exécutions",
      "subtitle": "Exécutions d’enrichissement passées. Ouvrez-en une pour revoir ses suggestions.",
      "tableLabel": "Exécutions d’enrichissement",
      "colDate": "Date",
      "colSource": "Source",
      "colStatus": "Statut",
      "colChunks": "Blocs",
      "openReview": "Ouvrir la revue de l’exécution du {date}",
      "connection": "Connexion",
      "empty": "Aucune exécution d’enrichissement pour l’instant. Enrichissez un schéma depuis l’assistant de connexion pour voir l’historique ici.",
      "errorTitle": "Impossible de charger les exécutions",
      "errorBody": "Rechargez la page pour réessayer.",
      "noConnections": "Connectez d’abord une base de données — les exécutions d’enrichissement sont enregistrées par connexion.",
      "byo": "BYO",
      "directPath": "Directe"
    }
  },
  "enrich": {
    "title": "Enrichir avec l’IA",
    "subtitle": "Affinez éventuellement les libellés, groupes, énumérations et tableaux de bord générés à l’aide d’un LLM. La base heuristique fonctionne sans cela — ceci ajoute seulement des suggestions que vous vérifiez avant toute application.",
    "intentLabel": "Comment souhaitez-vous enrichir ?",
    "sectionsLegend": "Que doit décider l’IA ?",
    "localesLegend": "Traduire les libellés en",
    "localeLocked": "(requis)",
    "samplingTitle": "Inclure des valeurs d’exemple",
    "samplingHint": "Inclut jusqu’à 20 valeurs réelles par colonne non-PII dans l’invite.",
    "samplingPreviewTitle": "Ce qui quitte cette machine",
    "samplingPreviewBody": "Jusqu’à 20 valeurs les plus fréquentes par colonne non-PII, plus min/max pour les colonnes numériques et de date. Les colonnes marquées PII ne sont jamais échantillonnées. Tout le reste demeure purement agrégé. Vérifiez l’invite exacte avant de copier (BYO) — rien n’est envoyé sans votre action.",
    "noSections": "Sélectionnez au moins un groupe de décisions à enrichir.",
    "generatePrompt": "Générer l’invite",
    "startProvider": "Démarrer l’enrichissement",
    "startOver": "Recommencer",
    "copied": "Copié",
    "createFailed": "Impossible de construire l’invite d’enrichissement — réessayez.",
    "createFailedTitle": "Impossible de démarrer",
    "providerFallback": "votre fournisseur d’IA",
    "fileTitle": "L’enrichissement par IA nécessite une base de données active",
    "fileBody": "Les sources de type fichier de schéma n’ont pas encore d’instantané à enrichir. Connectez une base de données active pour utiliser l’enrichissement par IA, ou continuez — la base heuristique génère tout de même une application complète.",
    "section": {
      "labels": "Libellés et descriptions",
      "groups": "Groupes de navigation",
      "enums": "Sémantique des énumérations",
      "relations": "Relations",
      "keys": "Colonnes clés",
      "templates": "Modèles de page",
      "widgets": "Widgets de tableau de bord",
      "pii": "PII et masquage",
      "icons": "Icônes",
      "microcopy": "Microcopie"
    },
    "provider": {
      "title": "Utiliser mon fournisseur d’IA",
      "description": "Lancez l’enrichissement maintenant avec votre fournisseur configuré. Vous vérifiez chaque suggestion sous forme de diff.",
      "unconfigured": "Aucun fournisseur d’IA n’est encore configuré — copiez une invite dans votre propre outil ci-dessous, ou configurez d’abord un fournisseur.",
      "settingsHint": "Vous voulez le lancer directement ?",
      "settingsLink": "Configurer un fournisseur dans Paramètres → IA",
      "networkDisabled": "Cet Adminium n'a pas d'accès Internet sortant : il ne peut joindre aucune API de fournisseur. Utilisez plutôt l'aller-retour copier-coller — même invite, même revue."
    },
    "byo": {
      "cardTitle": "Copier une invite vers mon propre outil d’IA",
      "cardDescription": "Copiez une invite autonome dans Claude Code, ChatGPT, n’importe quoi — puis recollez le JSON. Aucune clé nécessaire, rien ne quitte cette machine automatiquement.",
      "guidance": "Exécutez ceci dans n’importe quel outil d’IA — Claude Code, ChatGPT, peu importe. Collez le JSON renvoyé ci-dessous.",
      "promptLabel": "Invite d’enrichissement",
      "promptLabelN": "Invite d’enrichissement {index} sur {total}",
      "tokenChip": "≈ {tokens} jetons",
      "copyPrompt": "Copier l’invite",
      "copyPromptDone": "Invite copiée",
      "download": "Télécharger .md",
      "chunkTabs": "Segments d’invite",
      "chunkTab": "Invite {index}",
      "chunkValid": "Segment {index} validé",
      "pasteLabel": "Collez la réponse JSON",
      "pastePlaceholder": "Collez la réponse JSON ici…",
      "validate": "Valider",
      "valid": "Réponse validée",
      "mergedTitle": "Les {count} segments sont validés et fusionnés",
      "mergedTitleSingle": "Réponse validée",
      "mergedBody": "Les suggestions sont prêtes à être vérifiées par rapport à la base heuristique.",
      "errorsTitle": "La validation a trouvé {count} problèmes",
      "copyErrors": "Copier les erreurs pour votre outil d’IA",
      "copyErrorsDone": "Erreurs copiées",
      "copyErrorsHint": "Recollez ceci dans votre outil d’IA pour obtenir une réponse corrigée.",
      "droppedItems": "{count} suggestions ont été écartées lors de la validation — la vérification montre le reste.",
      "pendingTitle": "Validez chaque invite pour continuer",
      "pendingBody": "Collez la réponse JSON ci-dessus et validez-la pour passer à la vérification.",
      "pendingBodyChunked": "Chaque segment doit être validé avant la fusion des suggestions. Collez et validez chaque invite ci-dessus.",
      "requestFailed": "Impossible de joindre le serveur pour valider — réessayez.",
      "continueReview": "Continuer vers la vérification",
      "wholeDocument": "document entier",
      "cardTitleRecommended": "Copier une invite vers mon propre outil IA — recommandé"
    },
    "direct": {
      "title": "Enrichissement par IA",
      "subtitle": "Envoi de votre schéma à",
      "building": "Construction de l’invite…",
      "logLabel": "Journal d’enrichissement",
      "cancel": "Annuler",
      "back": "Retour aux options",
      "retry": "Réessayer",
      "done": "Enrichissement terminé — vérifiez les suggestions.",
      "continueReview": "Continuer vers la vérification",
      "failed": "L’exécution du fournisseur a échoué. Vérifiez vos paramètres d’IA et réessayez.",
      "jobFailed": "L’exécution de l’enrichissement ne s’est pas terminée.",
      "startFailed": "Impossible de démarrer l’exécution — réessayez.",
      "errorTitle": "Échec de l’enrichissement"
    },
    "skip": {
      "title": "Ignorer — utiliser uniquement l’heuristique",
      "description": "Générer à partir de la base heuristique. Vous pourrez enrichir plus tard depuis Paramètres → IA — ignorer n’est jamais pénalisé.",
      "confirmTitle": "Poursuite avec l’heuristique",
      "confirmBody": "L’application générée utilisera les libellés, groupes et tableaux de bord heuristiques. Continuez la génération — vous pouvez lancer l’enrichissement par IA à tout moment depuis Paramètres → IA."
    }
  },
  "review": {
    "unavailableTitle": "Écran de revue indisponible",
    "unavailableBody": "Cette version n’inclut pas encore l’écran de revue d’enrichissement (06-T14). Il arrive avec le flux diff-et-application."
  },
  "llmRuns": {
    "review": {
      "header": {
        "title": "Examiner les suggestions de l’IA",
        "model": "Modèle",
        "snapshot": "Instantané",
        "byo": "BYO",
        "pathDirect": "API directe",
        "pathByo": "Copier-coller",
        "agree": "{n} d’accord",
        "conflict": "{n} en conflit",
        "new": "{n} nouvelles",
        "rejects": "{n} rejets",
        "countsAria": "Nombre de suggestions"
      },
      "bulk": {
        "thresholdLabel": "Seuil de confiance",
        "thresholdAria": "Seuil de confiance pour « Tout accepter »",
        "acceptAll": "Tout accepter ≥ {pct}%",
        "clear": "Effacer la sélection"
      },
      "section": {
        "selectAllAria": "Tout sélectionner dans {group}",
        "acceptedCount": "{n} acceptées"
      },
      "group": {
        "labels": "Libellés et traductions",
        "navigation": "Navigation et domaines",
        "enums": "Sémantique des énumérations",
        "relations": "Relations",
        "keys": "Colonnes clés",
        "templates": "Modèles de page",
        "dashboards": "Tableaux de bord et widgets",
        "pii": "DCP et masquage",
        "icons": "Icônes",
        "microcopy": "Microcopie"
      },
      "status": {
        "agree": "Concorde",
        "conflict": "Conflit",
        "new": "Nouveau",
        "heuristicOnly": "Heuristique seule",
        "rejects": "Rejette l’heuristique",
        "locked": "Verrouillé"
      },
      "row": {
        "acceptAria": "Accepter la suggestion {noun} pour {target}",
        "keptEdited": "conservé — modifié par vous",
        "rejectsCallout": "L’IA rejette une décision heuristique — confirmez avant d’accepter.",
        "showTranslations": "Afficher les traductions",
        "hideTranslations": "Masquer les traductions",
        "confidenceAria": "Confiance {pct}%",
        "noAi": "Aucune suggestion de l’IA"
      },
      "value": {
        "none": "Aucune valeur",
        "absent": "Aucun",
        "dash": "—",
        "display": "Affichage",
        "key": "Clé",
        "rank": "rang {n}",
        "span": "largeur {n}",
        "tableCount": "{n} tables",
        "widgetCount": "{n} widgets",
        "enumWorkflow": "Flux",
        "enumCategory": "Catégorie",
        "notPii": "Pas de DCP",
        "label": "Libellé",
        "description": "Description",
        "subtitle": "Sous-titre de page",
        "headline": "Titre de l’état vide",
        "guidance": "Conseil de l’état vide"
      },
      "apply": {
        "title": "Appliquer {n} suggestions",
        "subtitle": "Ces modifications sont écrites en une seule transaction et peuvent être annulées.",
        "empty": "Rien à appliquer.",
        "confirm": "Appliquer les modifications"
      },
      "footer": {
        "count": "{n} suggestions sélectionnées",
        "apply": "Appliquer {n} suggestions acceptées",
        "failed": "Échec de l’application"
      },
      "toast": {
        "applied": "{n} suggestions appliquées",
        "appliedPartial": "{n} suggestions appliquées (certaines ignorées)",
        "applyFailed": "Impossible d’appliquer les suggestions",
        "undoFailed": "Impossible d’annuler cette modification"
      },
      "error": {
        "title": "Impossible de charger cette exécution"
      },
      "notReady": {
        "title": "Cette exécution n’a pas encore de suggestions à examiner",
        "body": "Une exécution doit être validée avant que ses suggestions puissent être examinées. Générez ou collez d’abord une réponse."
      },
      "applied": {
        "title": "Cette exécution a été appliquée",
        "body": "Les suggestions acceptées ci-dessous sont en lecture seule."
      },
      "empty": {
        "title": "Aucune suggestion",
        "body": "Cette exécution n’a produit aucune suggestion à examiner."
      },
      "cat": {
        "label": "libellé",
        "key": "colonnes clés",
        "enum": "énumération",
        "relation": "relation",
        "pii": "DCP",
        "template": "modèle de page",
        "group": "groupe de navigation",
        "dashboard": "tableau de bord",
        "widget": "widget",
        "copy": "microcopie"
      }
    }
  },
  "wizard": {
    "title": "Nouvelle connexion",
    "back": "Retour",
    "continue": "Continuer",
    "progress": "Progression de la configuration",
    "persistFailed": "Impossible d’enregistrer votre sélection de tables — réessayez.",
    "persistFailedTitle": "Échec de l’enregistrement",
    "bridgeAppliedTitle": "Chaîne de connexion reçue",
    "bridgeAppliedBody": "Transmise depuis adminium.dev par votre navigateur — elle est allée directement à cette machine et n’a jamais été téléversée. Vérifiez-la ci-dessous, puis continuez.",
    "bridgeFailedTitle": "Ce transfert n’a pas pu être utilisé",
    "bridgeFailedBody": "Il a déjà été utilisé ou a expiré. Collez plutôt votre chaîne de connexion ci-dessous.",
    "step": {
      "source": "Source",
      "test": "Analyser",
      "tables": "Tables",
      "meta": "Stockage méta",
      "intent": "Intention",
      "enrich": "Enrichir",
      "generate": "Générer"
    }
  },
  "meta": {
    "title": "Où Adminium doit-il ranger ses propres tables ?",
    "subtitle": "Pages, rôles, journal d’audit et paramètres vivent dans des tables préfixées adminium_ — jamais mêlés à vos données.",
    "sameDb": {
      "title": "Même base de données",
      "description": "Les tables adminium_* sont créées à côté de vos tables sources. La configuration la plus simple — nécessite un rôle avec droits d’écriture et CREATE TABLE.",
      "disabledReadOnly": "Votre rôle est en lecture seule — Adminium n’écrit jamais dans cette base. Choisissez une base séparée pour les tables d’Adminium.",
      "disabledNoDdl": "Ce rôle ne peut pas exécuter de DDL — les migrations d’Adminium exigent CREATE TABLE. Choisissez une base séparée pour les tables d’Adminium.",
      "disabledFile": "Un fichier de schéma n’a pas de base active — choisissez une base séparée pour les tables d’Adminium."
    },
    "separate": {
      "title": "Base de données séparée",
      "description": "Adminium garde ses tables dans une autre base. Votre source reste intacte — requis pour les sources en lecture seule.",
      "dsn": "Chaîne de connexion de la base méta",
      "helper": "Nécessite des droits d’écriture + DDL — Adminium y exécute ses propres migrations.",
      "test": "Tester la connexion",
      "ok": "Compatible — écriture ✓ · DDL ✓",
      "insufficient": "Ce rôle ne peut pas héberger le magasin méta — Adminium y a besoin des droits d’écriture et CREATE TABLE.",
      "errorTitle": "Magasin méta incompatible"
    },
    "testFailed": "Échec de la connexion.",
    "v1Note": {
      "title": "À propos de cette installation",
      "body": "Ce serveur garde déjà ses propres tables dans une base configurée, et cette étape ne les déplace pas. Elle vérifie que votre choix est compatible avec cette connexion — le serveur applique la même règle indépendamment (409 META_PLACEMENT_INVALID)."
    },
    "move": {
      "title": "Déplacement des tables d’Adminium",
      "copying": "Déplacement des tables d’Adminium…",
      "restarting": "Redémarrage…",
      "copyingBody": "Copie de chaque table adminium_ vers la nouvelle base. Vos données sources ne sont pas touchées, et rien n’est basculé tant que la copie n’est pas vérifiée.",
      "restartingBody": "La copie est terminée. Adminium redémarre sur la nouvelle base — cette page continuera d’elle-même dans quelques secondes.",
      "failed": "Impossible de déplacer les tables d’Adminium — réessayez.",
      "timeout": "Adminium a déplacé ses tables mais n’est pas encore revenu. Vos données sont en sécurité dans la nouvelle base — rechargez cette page dans un instant."
    },
    "willMove": {
      "title": "Cette étape va déplacer les tables d’Adminium",
      "body": "Adminium utilise actuellement son magasin SQLite intégré. « Continuer » copie ce magasin dans la base choisie et redémarre dessus — comptes, pages et paramètres suivent, vous restez connecté."
    }
  },
  "intent": {
    "title": "De quoi avez-vous besoin ?",
    "subtitle": "L’intention détermine quelles pages sont générées. Vous pourrez la changer plus tard — la changer propose une régénération, jamais une réécriture silencieuse.",
    "trust": "Nous ne lisons que votre schéma — jamais vos données de lignes pendant la configuration.",
    "fullAdmin": {
      "title": "Panneau d’administration complet",
      "description": "Tableaux de bord, pages CRUD, recherche, imports et exports — tout ce que votre schéma permet."
    },
    "analytics": {
      "title": "Analytique en lecture seule",
      "description": "Tableaux de bord, graphiques et grilles en lecture seule. Pas de formulaires, pas d’écritures — chaque rôle plafonné à Lecteur."
    },
    "crud": {
      "title": "Tables CRUD",
      "description": "Une page d’édition par table plus recherche et import/export — un accueil minimal, sans tableaux de bord."
    },
    "support": {
      "title": "Console de support",
      "description": "Files d’attente, pages de tickets et de fiches clients d’abord. Suppressions désactivées par défaut. (Les modèles de files arrivent en M7 — l’ensemble de pages v1 correspond à l’admin complet.)"
    }
  },
  "generate": {
    "title": "Générez votre application",
    "subtitle": "Une page par table incluse plus des tableaux de bord par domaine — intention :",
    "run": "Générer le tableau de bord",
    "openApp": "Ouvrir votre application",
    "logLabel": "Journal de génération",
    "log": {
      "classifying": "Classification du schéma…",
      "composing": "Composition des modèles…",
      "writing": "Écriture des pages…",
      "done": "{pages} pages générées dans {groups} groupes de navigation"
    },
    "successTitle": "Votre tableau de bord est prêt",
    "successBody": "{pages} pages dans {groups} groupes de navigation — générées depuis votre schéma, modifiables dans le Studio.",
    "errorTitle": "Échec de la génération",
    "failed": "Échec de la génération — réessayez, ou relancez d’abord l’introspection.",
    "fileTitle": "Fichier de schéma analysé — la génération nécessite une base active",
    "fileBody": "Votre schéma a été analysé proprement et l’aperçu ci-dessus est réel. Générer une application fonctionnelle directement depuis un fichier de schéma (avec des lignes fictives) n’est pas encore disponible — connectez une base active pour générer dès aujourd’hui."
  },
  "remap": {
    "column": {
      "nullable": "nullable",
      "labelOverride": "Libellé d’affichage",
      "labelHelper": "Inféré : {name}",
      "logicalType": "Type logique",
      "logicalTypeHelper": "Inféré : {type} (depuis {dbType}) — mappé par l’adaptateur ; non remplaçable en v1.",
      "semantic": "Type sémantique",
      "unclassified": "Pas encore classifié.",
      "semanticHelper": "Classificateur : {tag} · confiance {confidence}% · source : {source}",
      "semanticInferred": "inféré : {tag}",
      "currency": "Devise",
      "currencyHelper": "Code ISO 4217 appliqué au formatage monétaire.",
      "pii": "Masquer par défaut",
      "piiHelper": "Les valeurs masquées s’affichent caviardées ; le démasquage requiert la permission data.unmask_pii et est consigné dans le journal d’audit.",
      "enum": "Sémantique de l’énumération",
      "enumKind": "Nature de l’énumération",
      "enumWorkflow": "Flux",
      "enumCategory": "Catégorie",
      "enumLabelFor": "Libellé pour {value}",
      "enumToneFor": "Tonalité pour {value}",
      "enumToneAuto": "auto",
      "enumHelper": "Les énumérations de flux pilotent les pastilles de statut et les colonnes de tableau ; les tonalités associent les valeurs à l’échelle de teintes sémantiques."
    },
    "diff": {
      "one": "1 modification",
      "count": "{count} modifications",
      "saved": "Remplacements enregistrés.",
      "revertOne": "Annuler {change}",
      "regenerate": "Régénérer les pages",
      "revertAll": "Tout annuler",
      "save": "Enregistrer les remplacements"
    },
    "table": {
      "iconPicker": "Icône de la table",
      "system": "Système",
      "labelOverride": "Libellé d’affichage",
      "labelHelper": "Inféré : {name}",
      "icon": "Icône",
      "navGroup": "Groupe de navigation",
      "navGroupHelper": "Le placement dans la navigation est décidé par le générateur — un remplacement table.navGroup ne fait pas partie du vocabulaire v1.",
      "include": "Inclure dans l’application générée",
      "includeHelper": "Les tables exclues n’ont aucune page et disparaissent de la navigation.",
      "shape": "Forme de la table (classifiée)",
      "role": "Rôle",
      "unclassified": "Non classifiée",
      "kind": "Nature",
      "hierarchy": "Hiérarchie",
      "selfFk": "Auto-référence via {column}",
      "polymorphic": "Paires polymorphes",
      "rows": "Estimation du nombre de lignes",
      "shapeHelper": "La classification est recalculée à chaque introspection ; les remplacements se superposent et survivent à la régénération."
    },
    "relations": {
      "declared": "Clés étrangères déclarées",
      "noneDeclared": "Aucune clé étrangère déclarée ne touche cette table.",
      "inferred": "Relations inférées",
      "noneInferred": "Rien d’inféré pour cette table.",
      "confidence": "inférée · {pct}%",
      "accepted": "Acceptée",
      "suppressed": "Écartée",
      "accept": "Accepter",
      "suppress": "Écarter",
      "overrides": "Relations de remplacement (appliquées)",
      "overrideBadge": "remplacement",
      "add": "Ajouter une relation virtuelle",
      "fromColumn": "Colonne source",
      "noColumns": "Aucune colonne correspondante",
      "fromPlaceholder": "customer_id",
      "toTable": "Table cible",
      "noTables": "Aucune table correspondante",
      "toColumn": "Colonne cible",
      "cardinality": "Cardinalité",
      "addButton": "Ajouter la relation"
    },
    "toast": {
      "saved": "Remplacements de schéma enregistrés",
      "savedDetail": "Le schéma appliqué ci-dessous reflète vos modifications.",
      "regenerated": "{created} créées · {updated} mises à jour · {unchanged} inchangées",
      "regeneratedDetail": "Les pages que vous avez modifiées à la main sont préservées — seules les pages dont le generated_hash est intact ont été régénérées sur place.",
      "regenerateFailed": "Échec de la régénération"
    },
    "title": "Remappage du schéma",
    "subtitle": "{tables} tables · {applied} remplacements appliqués",
    "saveFailed": "Échec de l’enregistrement : {message}",
    "loadFailed": "Impossible de charger le schéma de cette connexion.",
    "inspector": "Inspecteur",
    "empty": {
      "title": "Choisissez une table ou une colonne",
      "description": "Sélectionnez un élément dans l’arborescence du schéma pour remapper son libellé, son type, ses relations ou son masquage."
    },
    "tabs": {
      "details": "Détails",
      "relations": "Relations"
    },
    "tree": {
      "label": "Schéma",
      "search": "Rechercher des tables et des colonnes",
      "searchPlaceholder": "Rechercher des tables…",
      "noMatches": "Aucune table ne correspond à votre recherche.",
      "collapse": "Replier la table",
      "expand": "Déplier la table",
      "unsaved": "Modification non enregistrée",
      "excluded": "Exclue"
    },
    "badge": {
      "pk": "PK",
      "fk": "FK",
      "unique": "UNIQUE",
      "pii": "PII",
      "masked": "Masquée"
    },
    "unavailableTitle": "Éditeur de remappage du schéma indisponible",
    "unavailableBody": "Cette version n’inclut pas encore l’éditeur de remappage (09-T12). Relancez la génération une fois qu’il sera disponible pour remapper les libellés, les types et les relations."
  },
  "publicApi": {
    "error": "Something went wrong",
    "scopes": {
      "deleteTitle": "Delete this scope",
      "deleteBody": "Any page using a key bound to this scope stops loading data. Keys are not deleted — revoke them first if that is what you meant.",
      "deletePrompt": "Type the scope name to confirm",
      "deleteConfirm": "Delete scope",
      "issuesTitle": "This scope did not compile",
      "title": "Scopes",
      "subtitle": "A scope is the whole of what a key may reach — the tables, the exact columns, and a filter the caller can narrow but never remove.",
      "emptyTitle": "No scopes yet",
      "emptyBody": "Create one below. It is checked against your live schema before it is saved.",
      "keyCount": "{count, plural, =0 {no keys} one {# key} other {# keys}}",
      "delete": "Delete",
      "nameLabel": "Name",
      "connectionLabel": "Connection ID",
      "documentLabel": "Scope document",
      "documentHint": "Compiled against your schema when you save. Every column a caller can reach is listed here and nowhere else.",
      "create": "Create scope",
      "formLabel": "Create a scope"
    },
    "cancel": "Cancel",
    "close": "Close",
    "title": "Public API",
    "subtitle": "Let your own customer- or staff-facing pages read this database, through a scope you define.",
    "notRegistered": {
      "title": "Not enabled on this server",
      "body": "Set ADMINIUM_PUBLIC_API_ORIGINS to the exact origins allowed to call it, then restart. Until then these routes are not served at all."
    },
    "toggle": {
      "label": "Serve the public API",
      "hint": "Turning this off stops every public request immediately. Nothing is deleted — keys, scopes and data all survive."
    },
    "origins": {
      "label": "Origins allowed to call it"
    },
    "keys": {
      "title": "Keys",
      "subtitle": "These go in your page’s JavaScript, so anyone can read them. That is expected — a key can only ever do what its scope allows.",
      "emptyTitle": "No keys yet",
      "emptyBody": "Create a scope first, then mint a key for it.",
      "reveal": "Show key",
      "rotate": "Rotate",
      "revoke": "Revoke",
      "nameLabel": "Name",
      "scopeLabel": "Scope",
      "scopePlaceholder": "Choose a scope",
      "create": "Create key",
      "formLabel": "Create a key",
      "scopeIsAuthTitle": "The scope is the only permission",
      "scopeIsAuthBody": "A key can reach exactly what its scope lists and nothing else. It does not use roles or table permissions, and it cannot read anything through the rest of the API.",
      "appLabel": "Lier à une surface d’app hébergée (facultatif)",
      "appHint": "La surface client de l’app sert alors cette clé elle-même — la faire tourner n’exige aucune recompilation.",
      "appNone": "Non liée"
    },
    "status": {
      "heading": "Status"
    }
  },
  "hostedApps": {
    "title": "Apps hébergées",
    "subtitle": "Les surfaces d’app que cette instance sert — où chacune apparaît, et les domaines qui pointent vers elles.",
    "error": "Un problème est survenu",
    "emptyTitle": "Aucune surface d’app n’est servie",
    "emptyBody": "Pointez ADMINIUM_SURFACES_DIR vers un répertoire de surfaces compilées — un dossier par app et par côté, chacun avec son index.html — puis redémarrez. Elles sont alors servies sous /apps/ et apparaissent ici.",
    "surfaces": {
      "title": "Surfaces",
      "subtitle": "Une surface équipe peut se fondre dans la barre latérale de ce tableau de bord ou rester autonome ; une surface client est publique et lit via sa clé liée.",
      "staff": "Équipe",
      "customer": "Client",
      "noNav": "Placement interne indisponible — recompilez cette surface avec le toolkit actuel pour qu’elle émette surface.json.",
      "noKey": "Aucune clé liée — cette surface ne peut pas lire de données tant qu’une clé n’est pas créée pour elle.",
      "mintLink": "En créer une sous API publique",
      "boundKey": "Sert la clé",
      "placementLabel": "Placement",
      "placementInternal": "Dans la barre latérale (fondue)",
      "placementExternal": "Externe (URL propre uniquement)",
      "connectionLabel": "Lit",
      "connectionUnset": "Celle qui est active"
    },
    "domains": {
      "title": "Domaines",
      "subtitle": "Pointez le DNS d’un domaine vers votre proxy, transmettez l’en-tête Host à Adminium, puis attachez-le ici — cet hôte sert alors la surface au lieu de ce tableau de bord. Les certificats restent sur votre proxy.",
      "issuesTitle": "La carte des domaines a été refusée",
      "savedTitle": "Enregistré",
      "savedBody": "Les attributions prennent effet en quelques secondes. Un hôte ne répond que lorsque son DNS et votre proxy atteignent réellement cette instance.",
      "none": "Aucun domaine attaché.",
      "hostLabel": "Hôte",
      "surfaceLabel": "Surface",
      "remove": "Retirer",
      "add": "Attacher un domaine",
      "save": "Enregistrer les domaines",
      "instanceLabel": "Instance",
      "instanceOwn": "L'application elle-même"
    },
    "instances": {
      "title": "Instances",
      "body": "Servir la même application sur plusieurs bases. Chaque instance est accessible à /apps/<app>/<segment>/<côté>/ et ne lit que la connexion que vous lui donnez.",
      "appLabel": "Application",
      "slugLabel": "Segment d'URL",
      "readsLabel": "Lit",
      "add": "Ajouter une instance",
      "save": "Enregistrer les instances",
      "remove": "Retirer",
      "empty": "Aucune instance supplémentaire.",
      "failed": "Les instances n'ont pas été enregistrées"
    }
  },
  "addOns": {
    "plan": {
      "blocked": "Impossible d’installer ici",
      "needsColumns": "Ce module a besoin de colonnes que vous n’avez pas",
      "needsColumnsBody": "Adminium n’ajoute pas de colonnes aux tables qui vous appartiennent déjà. Ajoutez-les vous-même, puis installez.",
      "willCreate": "Cela créera des tables dans votre base de données",
      "willCreateBody": "L’installation crée ces tables. Une désinstallation ultérieure les laisse intactes, ainsi que leurs données.",
      "noData": "Ce module ne lit ni n’écrit de tables qui lui soient propres.",
      "reuse": "Ce module utilisera des tables que vous avez déjà :"
    },
    "consent": {
      "title": "Installer {name}",
      "subtitle": "Ce que ce module fera, avant qu’il puisse le faire.",
      "close": "Fermer",
      "loading": "Analyse de ce que cela ferait…",
      "hosts": "Attacher à",
      "cancel": "Annuler",
      "confirm": "Installer"
    },
    "connect": {
      "apiKey": "Clé API",
      "submit": "Connecter"
    },
    "title": "Modules",
    "subtitle": "Des capacités supplémentaires pour vos applications — expédition, graphisme, données. Chacune indique ce dont elle a besoin avant l’installation.",
    "error": "Une erreur est survenue",
    "browse": {
      "title": "Disponibles",
      "online": "Inclut les modules du catalogue en ligne. Rechercher des versions plus récentes est une action distincte.",
      "offline": "Affiche les modules livrés avec cette version. La navigation en ligne est désactivée et rien ici n’a contacté Internet.",
      "refresh": "Rechercher des nouveautés",
      "emptyTitle": "Aucun module disponible",
      "emptyBody": "Cette version n’en contient aucun et le catalogue en ligne est désactivé.",
      "bundled": "Inclus",
      "upgrade": "v{version} disponible",
      "download": "Télécharger",
      "install": "Installer",
      "discard": "Supprimer",
      "upgradeAction": "Mettre à jour",
      "toggle": "Parcourir le catalogue en ligne"
    },
    "installed": {
      "title": "Installés",
      "emptyTitle": "Rien d’installé pour l’instant",
      "emptyBody": "Installez un module ci-dessus et il apparaîtra ici avec ses hôtes et sa connexion.",
      "connected": "Connecté",
      "notConnected": "Non connecté",
      "egress": "Peut contacter : {hosts}",
      "on": "activé",
      "off": "désactivé",
      "disconnect": "Déconnecter",
      "uninstall": "Désinstaller"
    },
    "confirm": {
      "close": "Fermer",
      "disconnectTitle": "Déconnecter ce module",
      "uninstallTitle": "Désinstaller ce module",
      "discardTitle": "Supprimer ce téléchargement",
      "disconnectBody": "Ses clés sont supprimées et il cesse ses appels. Chaque table et chaque ligne qu’il a créées restent telles quelles, et vous pouvez le reconnecter à tout moment.",
      "uninstallBody": "Ses clés sont supprimées et ses fichiers retirés de ce serveur. Chaque table et chaque ligne qu’il a créées restent telles quelles. Vous pourrez le réinstaller plus tard.",
      "discardBody": "Les fichiers téléchargés sont supprimés. Rien n’a été installé, donc rien d’autre ne change — vous pouvez le retélécharger quand vous voulez.",
      "cancel": "Annuler",
      "disconnect": "Déconnecter",
      "uninstall": "Désinstaller",
      "discard": "Supprimer"
    },
    "upgradeNote": "La mise à jour conserve les hôtes auxquels un module est attaché ainsi que sa connexion existante.",
    "job": {
      "title": "Téléchargement",
      "body": "Récupération et vérification. Rien n’est installé sans votre accord.",
      "failed": "Le téléchargement ne s’est pas terminé. Rien n’a été installé."
    },
    "veto": {
      "title": "Ce déploiement ne peut pas consulter le catalogue en ligne",
      "body": "Le réglage est enregistré, mais les fonctions réseau sont coupées sur ce serveur et cela prime. Les modules déjà téléchargés fonctionnent, et vous pouvez en téléverser un."
    },
    "sideload": {
      "title": "Téléverser un paquet",
      "hint": "Pour un serveur sans internet. Vérifié exactement comme un téléchargement, il lui faut donc l’empreinte fournie.",
      "file": "Fichier du paquet (.tgz)",
      "key": "Clé du module",
      "version": "Version",
      "sha": "Intégrité (sha512-…)",
      "shaHint": "La valeur `integrity` affichée par `npm pack --json`. Refusé si les octets n’y correspondent pas.",
      "submit": "Téléverser"
    }
  },
  "pages": {
    "title": "Pages",
    "subtitle": "Ajoutez, modifiez et organisez les pages de votre application, ainsi que leur ordre dans la barre latérale.",
    "createButton": "Nouvelle page",
    "loadFailed": {
      "title": "Impossible de charger les pages",
      "body": "La gestion des pages requiert l’autorisation « Gérer les pages ». Demandez à un administrateur de l’attribuer à l’un de vos rôles."
    },
    "tab": {
      "pages": "Toutes les pages",
      "sidebar": "Ordre de la barre latérale"
    },
    "list": {
      "title": "Pages",
      "count": "{count, plural, one {# page} other {# pages}}"
    },
    "empty": {
      "title": "Aucune page pour l’instant",
      "body": "Connectez une base de données pour générer des pages automatiquement, ou créez-en une à la main."
    },
    "status": {
      "live": "Active",
      "hidden": "Masquée"
    },
    "origin": {
      "generated": "Générée",
      "manifest": "Extension",
      "llm": "Assistant",
      "system": "Système",
      "user": "Personnalisée"
    },
    "row": {
      "menu": "Actions pour {title}"
    },
    "action": {
      "edit": "Modifier la page",
      "duplicate": "Dupliquer",
      "hide": "Masquer dans la barre latérale",
      "show": "Afficher dans la barre latérale",
      "delete": "Supprimer la page"
    },
    "create": {
      "title": "Nouvelle page",
      "failed": "Impossible de créer la page",
      "submit": "Créer la page",
      "subtitle": "Choisissez ce que cette page affiche et son apparence. L’aperçu suit vos choix."
    },
    "duplicate": {
      "title": "Dupliquer la page",
      "failed": "Impossible de dupliquer la page",
      "submit": "Dupliquer"
    },
    "delete": {
      "title": "Supprimer cette page ?",
      "body": "Cette action est irréversible. Les vues enregistrées et les dispositions personnelles de cette page sont supprimées pour tout le monde.",
      "bodyGenerated": "Cette page provient de la génération du schéma : elle réapparaîtra à la prochaine génération. Les vues enregistrées et les dispositions personnelles sont supprimées pour tout le monde.",
      "prompt": "Saisissez {slug} pour confirmer",
      "confirm": "Supprimer la page"
    },
    "field": {
      "title": "Titre",
      "titleHint": "Affiché dans la barre latérale et dans l’en-tête de la page.",
      "slug": "Adresse de la page",
      "slugHint": "Minuscules, chiffres et tirets. Seulement la dernière partie — le reste de l’adresse est ajouté pour vous.",
      "slugTaken": "Une autre page utilise déjà cette adresse.",
      "slugWarning": "Modifier l’adresse casse les liens et les favoris existants vers cette page.",
      "template": "Modèle",
      "templateHint": "Détermine ce que la page peut contenir. Modifiable par la suite.",
      "group": "Groupe de la barre latérale",
      "groupHint": "La section de la barre latérale où elle apparaît.",
      "icon": "Icône",
      "iconHint": "Affichée à côté du nom de la page dans la barre latérale.",
      "visible": "Afficher dans la barre latérale",
      "visibleHint": "Une page masquée reste accessible à son URL pour qui possède le lien.",
      "table": "Table",
      "tableCreateHint": "La table que cette page lit. Choisissez-en une maintenant et la page est prête à l’emploi ; laissez vide pour la lier plus tard.",
      "tableNone": "Non liée",
      "tableNeedsConnection": "Choisissez d’abord une source de données.",
      "connection": "Source de données",
      "connectionNone": "Aucune",
      "iconPick": "Choisir l’icône de la page",
      "padding": "Marge de la page",
      "width": "Largeur du contenu",
      "widthHint": "Largeur maximale de la colonne de contenu de la page sur un grand écran."
    },
    "editor": {
      "title": "Modifier la page",
      "save": "Enregistrer les modifications",
      "saveFailed": "Impossible d’enregistrer les modifications",
      "openPage": "Ouvrir la page",
      "generated": {
        "title": "Cette page a été générée à partir de votre schéma",
        "body": "Vos modifications sont conservées lors d’une nouvelle génération : la page est marquée comme modifiée et laissée intacte. En revanche, une suppression ne tient que jusqu’à ce que la génération suivante la recrée."
      },
      "contentUnavailable": "Impossible de charger le contenu de la page",
      "contentUnavailableBody": "Les informations ci-dessus peuvent tout de même être enregistrées.",
      "contentInvalid": "La configuration de cette page est illisible",
      "contentInvalidBody": "Elle provient d’une version plus récente, ou elle est corrompue. Régénérez la page ou supprimez-la.",
      "data": "Données",
      "schemaFailed": "Impossible de lister les tables",
      "schemaFailedBody": "Cette connexion n’a peut-être pas encore été analysée. Lancez l’introspection depuis Studio → Connexions de données.",
      "notBindable": "Ce modèle n’est pas lié à une seule table",
      "notBindableBody": "Son contenu se construit widget par widget. Ouvrez la page et utilisez « Modifier » pour les ajouter.",
      "recompose": "Cette page va être reconstruite",
      "recomposeBody": "L’enregistrement remplace son contenu par une nouvelle disposition pour le modèle et la table ci-dessus. Les ajustements de colonnes et les modifications de widgets de cette page seront perdus.",
      "missing": "Cette page n’existe plus",
      "missingBody": "Elle a peut-être été supprimée, ou retirée par une génération.",
      "details": "Détails",
      "itemsPending": "Enregistrez d’abord la modification ci-dessus — le contenu de la page est reconstruit à partir du nouveau modèle et de la nouvelle table.",
      "columns": "Colonnes",
      "appearance": "Apparence"
    },
    "sidebar": {
      "help": "Réordonnez les pages au sein d’un groupe, ou déplacez-en une vers un autre groupe. Les changements s’appliquent à tout le monde.",
      "discard": "Abandonner",
      "save": "Enregistrer l’ordre",
      "saveFailed": "Impossible d’enregistrer le nouvel ordre",
      "emptyGroup": "Aucune page dans ce groupe.",
      "moveUp": "Monter {title}",
      "moveDown": "Descendre {title}",
      "moveTo": "Déplacer {title} vers un groupe",
      "ungrouped": {
        "title": "Certaines pages n’appartiennent à aucun groupe",
        "body": "Ces pages fonctionnent à leur URL mais n’apparaissent nulle part dans la barre latérale. Ouvrez chacune d’elles et choisissez un groupe."
      }
    },
    "columns": {
      "help": "Glissez pour réordonner les colonnes, renommez leurs en-têtes et choisissez celles qui apparaissent dans le tableau.",
      "empty": "Pas encore de colonnes — ajoutez-en ci-dessous.",
      "pk": "Clé",
      "pii": "PII",
      "header": "En-tête de {name}",
      "shown": "Affichée",
      "toggle": "Afficher {name} dans le tableau",
      "dragHandle": "Réordonner {name}",
      "remove": "Retirer {name}",
      "addOpen": "Ajouter une colonne",
      "addTitle": "Ajouter une colonne",
      "addSearch": "Rechercher des colonnes…",
      "addFromTable": "Depuis {table}",
      "addFromLinked": "Depuis les tables liées",
      "addLinkedHelp": "Affiche une valeur de la table vers laquelle pointe une colonne de liaison.",
      "addVia": "via {column}",
      "addNoMatches": "Aucune colonne ne correspond à « {query} ».",
      "followColumn": "Suivre {name}",
      "addLinkedFrom": "Tables qui pointent ici",
      "addLinkedFromHelp": "Ajoute le nombre de lignes qui pointent vers chaque enregistrement.",
      "countBadge": "Nombre",
      "lookupBadge": "Liée",
      "lookupBack": "Retour",
      "lookupBrowse": "Choisissez quoi afficher depuis {table}",
      "lookupBroken": "Ce lien ne se résout plus",
      "lookupBrokenBody": "Le schéma a changé pendant votre navigation. Recommencez le lien.",
      "schemaUnavailable": "Les colonnes de la base n’ont pas pu être listées ; impossible d’ajouter des colonnes ici.",
      "none": {
        "title": "Cette page n’a pas encore de colonnes",
        "body": "Les colonnes sont lues dans la table lors de la génération de la page. Liez cette page à une table puis régénérez pour les renseigner."
      }
    },
    "icon": {
      "none": "Choisir une icône",
      "search": "Rechercher des icônes",
      "noMatches": "Aucune icône ne correspond à cette recherche."
    },
    "preview": {
      "untitled": "Page sans titre",
      "note": "Une illustration de la disposition, pas de vos données. La vraie page se remplit une fois enregistrée."
    },
    "padding": {
      "default": "Par défaut pour ce modèle",
      "none": "Aucune",
      "standard": "Standard (28 × 24)",
      "custom": "Personnalisée…",
      "x": "Côtés (px)",
      "y": "Haut et bas (px)"
    },
    "width": {
      "default": "Valeur par défaut de ce modèle",
      "narrow": "Étroite (720 px)",
      "content": "Contenu (900 px)",
      "page": "Page (1080 px)",
      "dash": "Tableau de bord (1320 px)",
      "wide": "Large (1800 px)",
      "full": "Pleine largeur (sans limite)"
    }
  }
} as const;
