// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/fr-FR/payments.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "panel": {
    "balanceDue": "Solde dû",
    "paid": "Payé",
    "paidInFull": "Payé en totalité",
    "copyLink": "Copier le lien de paiement",
    "emailLink": "Envoyer le lien de paiement par e-mail",
    "record": "Enregistrer un paiement",
    "revoke": "Révoquer",
    "test": "Test",
    "refunded": "Remboursé",
    "linkLine": "Lien de paiement créé le {made} · valable jusqu’au {until}",
    "waitingWith": "Paiement par {way} commencé le {date} · en attente de la banque",
    "waitingPlain": "Un paiement en ligne a commencé le {date} · en attente de la banque",
    "recordedBy": "enregistré par {name}",
    "online": "Paiement en ligne ({service})",
    "refundedInline": "{amount} remboursé",
    "listLabel": "Paiements de cet enregistrement",
    "notice": {
      "draft": "Envoyez d’abord la facture. Un paiement ne peut être enregistré que sur une facture envoyée.",
      "private": "Les clients ne peuvent pas joindre ce serveur, les liens de paiement sont donc désactivés. Vous pouvez toujours enregistrer des paiements.",
      "update": "Cette table de factures a besoin de la mise à jour de son application pour accepter les paiements en ligne.",
      "voided": "Cette facture a été annulée. Aucun paiement ne peut être accepté.",
      "noCurrency": "Cet enregistrement n’a pas de devise, aucun paiement ne peut donc être enregistré.",
      "unclear": "Le montant de cet enregistrement n’est pas exact dans sa devise, aucun paiement ne peut donc être enregistré.",
      "notPayable": "Cet enregistrement ne peut pas recevoir de paiement pour le moment."
    },
    "by": {
      "bank-transfer": "par virement bancaire",
      "cash": "en espèces",
      "card": "par carte sur notre propre terminal",
      "cheque": "par chèque",
      "other": "d’une autre façon",
      "online": "en ligne"
    },
    "toast": {
      "copied": "Lien de paiement copié.",
      "replaced": "Un nouveau lien de paiement remplace celui créé le {date}.",
      "revoked": "Lien de paiement révoqué. L’ancienne adresse ne fonctionne plus.",
      "recorded": "Paiement de {amount} enregistré.",
      "copyFailed": "Le lien de paiement est créé, mais ce navigateur ne l’a pas copié : {url}",
      "failed": "Cela n’a pas fonctionné : {message}",
      "emailed": "Le lien de paiement est en route vers {to}.",
      "refundRequested": "Remboursement de {amount} demandé.",
      "refundFailed": "Le remboursement de {amount} a échoué : {reason}"
    },
    "moreFor": "Plus pour {ref}",
    "menu": {
      "refund": "Rembourser…"
    },
    "why": {
      "pending": "Ce paiement attend encore la banque.",
      "full": "Ce paiement est entièrement remboursé.",
      "offline": "Ce moyen de paiement ne peut pas être remboursé en ligne. Remboursez le client vous-même.",
      "disputed": "Ce paiement fait l’objet d’un litige. Répondez d’abord au litige dans le tableau de bord {service}.",
      "notTaken": "Aucun argent n’a été prélevé pour ce paiement."
    },
    "disputed": "Litige",
    "disputeLine": "Litige — répondez-y dans le tableau de bord {service}",
    "disputeNote": "Si le litige est perdu, l’argent revient au client. La facture n’est pas modifiée d’elle-même.",
    "disputeClosed": "Le litige est clos. Son issue figure dans le tableau de bord {service}.",
    "refundRequested": "Remboursement de {amount} demandé",
    "refundWaitingCustomer": "Le remboursement de {amount} attend le client",
    "refundFailed": "Le remboursement de {amount} a échoué : {reason}. Contactez le client et enregistrez ce que vous convenez.",
    "refundFailedPlain": "Le remboursement de {amount} a échoué. Contactez le client et enregistrez ce que vous convenez.",
    "refundCancelled": "Le remboursement de {amount} a été annulé.",
    "refundedOnInline": "{amount} remboursé le {date}",
    "refundedThere": "Remboursement de {amount} fait dans le tableau de bord {service} le {date} · enregistré",
    "needsLook": "À vérifier"
  },
  "record": {
    "title": "Enregistrer un paiement",
    "amount": "Montant",
    "way": "Moyen de paiement",
    "wayPh": "Choisir un moyen de paiement",
    "ways": {
      "bank-transfer": "Virement bancaire",
      "cash": "Espèces",
      "card": "Carte sur notre propre terminal",
      "cheque": "Chèque",
      "other": "Autre"
    },
    "date": "Date",
    "note": "Note",
    "notePh": "Facultatif",
    "approval": "Code d’autorisation",
    "approvalHelp": "Jusqu’à 12 lettres et chiffres.",
    "approvalErr": "Lettres et chiffres uniquement, jusqu’à 12.",
    "last4": "Quatre derniers chiffres",
    "last4Err": "Saisissez uniquement les quatre derniers chiffres.",
    "cardNumber": "Cela ressemble à un numéro de carte complet. N’écrivez jamais de numéro de carte ici.",
    "amountErr": "Saisissez un montant supérieur à zéro.",
    "overDue": "C’est plus que les {amount} dus.",
    "dateErr": "Le jour du paiement ne peut pas être dans le futur.",
    "pendingWarn": "Un paiement en ligne attend la banque. En enregistrer un autre risque de prendre l’argent deux fois.",
    "cancel": "Annuler",
    "submit": "Enregistrer le paiement",
    "close": "Fermer",
    "failed": "Le paiement n’a pas été enregistré : {message}"
  },
  "notice": {
    "landed": {
      "title": "Paiement reçu",
      "body": "{amount} pour {label}",
      "bodyWith": "{amount} pour {label} par {paidWith}"
    },
    "look": {
      "title": "Un paiement demande votre attention",
      "notRecorded": "Payé sur {provider}, non enregistré : {label}",
      "notYet": "Payé sur {provider}, pas encore enregistré : {label}",
      "amount": "Payé sur {provider}, pas le montant demandé : {label}",
      "voided": "Payé sur {provider} après son annulation : {label}",
      "mode": "Payé sur {provider} dans l’autre mode, non retenu : {label}",
      "twice": "Payé deux fois sur {provider} : {label}",
      "missing": "Le paiement enregistré n’y est plus : {label}",
      "refundedThere": "Remboursé dans le tableau de bord {provider} : {amount} sur {label}. Enregistré."
    },
    "key": {
      "title": "{provider} a refusé la clé",
      "body": "Les paiements sont suspendus jusqu’à ce qu’une clé valide soit enregistrée."
    },
    "webhook": {
      "title": "Le webhook de {provider} est silencieux",
      "body": "Aucun événement depuis le {date}. Les paiements sont trouvés en interrogeant, plus lentement.",
      "bodyNever": "Aucun événement réel n’est encore arrivé. Les paiements sont trouvés en interrogeant, plus lentement."
    },
    "reads": {
      "title": "Adminium interroge {provider} moins souvent",
      "body": "La moitié des lectures que {provider} permet ce mois-ci est utilisée."
    },
    "keysRemoved": {
      "title": "Les clés {provider} ont été supprimées",
      "body": "Par {by}. Aucun paiement ne démarre avec {provider} tant que de nouvelles clés ne sont pas enregistrées."
    },
    "redirect": {
      "account": "Une clé de paiement appartient maintenant à un autre compte",
      "bank": "Les coordonnées bancaires pour les virements ont changé",
      "payAddress": "L’adresse de paiement a changé",
      "body": "Avant {from} · maintenant {to} · par {by}",
      "byTo": "Maintenant {to} · par {by}",
      "byOnly": "Par {by}"
    },
    "refundFailed": {
      "title": "Remboursement échoué",
      "body": "{amount} vers {paidWith}"
    },
    "dispute": {
      "title": "Litige ouvert",
      "body": "{label} · réponse avant le {date}",
      "bodyNoDate": "{label} · répondez-y dans le tableau de bord {provider}"
    }
  },
  "refund": {
    "step1": "Étape 1 sur 2",
    "step2": "Étape 2 sur 2",
    "title": "Rembourser un paiement",
    "close": "Fermer",
    "amount": "Montant",
    "full": "Total",
    "part": "Partiel",
    "upTo": "Jusqu’à {amount} peuvent être remboursés",
    "reason": "Motif",
    "reasons": {
      "requested_by_customer": "Demandé par le client",
      "duplicate": "Doublon",
      "fraudulent": "Frauduleux",
      "other": "Autre"
    },
    "note": "Note",
    "notePh": "Facultatif",
    "goesBack": "Retourne vers {paidWith}. En général 5 à 10 jours.",
    "goesBackPlain": "Retourne par le moyen de paiement utilisé. En général 5 à 10 jours.",
    "cancel": "Annuler",
    "continue": "Continuer",
    "question": "Rembourser {amount} vers {paidWith} ?",
    "questionPlain": "Rembourser {amount} ?",
    "cantUndo": "Cette action est irréversible.",
    "back": "Retour",
    "submit": "Rembourser",
    "failed": "Le remboursement n’a pas été demandé : {message}",
    "lost": "Aucune réponse n’est revenue. Appuyez à nouveau sur Rembourser : c’est le même remboursement qui est demandé, jamais un second."
  }
} as const;
