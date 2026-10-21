// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/ar-EG/payments.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "panel": {
    "balanceDue": "الرصيد المستحق",
    "paid": "المدفوع",
    "paidInFull": "مدفوعة بالكامل",
    "copyLink": "نسخ رابط الدفع",
    "record": "تسجيل دفعة",
    "revoke": "إلغاء",
    "test": "اختبار",
    "refunded": "مستردة",
    "linkLine": "أُنشئ رابط الدفع في {made} · يعمل حتى {until}",
    "waitingWith": "بدأت دفعة عبر {way} في {date} · في انتظار البنك",
    "waitingPlain": "بدأت دفعة عبر الإنترنت في {date} · في انتظار البنك",
    "recordedBy": "سجّلها {name}",
    "online": "دفع عبر الإنترنت ({service})",
    "refundedInline": "استُرد {amount}",
    "listLabel": "الدفعات على هذا السجل",
    "notice": {
      "draft": "أرسل الفاتورة أولًا. لا يمكن تسجيل دفعة إلا على فاتورة مُرسلة.",
      "private": "لا يستطيع العملاء الوصول إلى هذا الخادم، لذا روابط الدفع متوقفة. لا يزال بإمكانك تسجيل الدفعات.",
      "update": "يحتاج جدول الفواتير هذا إلى تحديث تطبيقه لقبول المدفوعات عبر الإنترنت.",
      "voided": "أُلغيت هذه الفاتورة. لا يمكن قبول أي دفعة.",
      "noCurrency": "لا توجد عملة لهذا السجل، لذا لا يمكن تسجيل دفعة.",
      "unclear": "مبلغ هذا السجل غير دقيق في عملته، لذا لا يمكن تسجيل دفعة.",
      "notPayable": "لا يمكن لهذا السجل قبول دفعة الآن."
    },
    "by": {
      "bank-transfer": "بتحويل بنكي",
      "cash": "نقدًا",
      "card": "ببطاقة على جهازنا الخاص",
      "cheque": "بشيك",
      "other": "بطريقة أخرى",
      "online": "عبر الإنترنت"
    },
    "toast": {
      "copied": "نُسخ رابط الدفع.",
      "replaced": "يحل رابط دفع جديد محل الرابط الذي أُنشئ في {date}.",
      "revoked": "أُلغي رابط الدفع. العنوان القديم لم يعد يعمل.",
      "recorded": "سُجّلت دفعة بقيمة {amount}.",
      "copyFailed": "أُنشئ رابط الدفع، لكن هذا المتصفح لم ينسخه: {url}",
      "failed": "لم ينجح ذلك: {message}"
    }
  },
  "record": {
    "title": "تسجيل دفعة",
    "amount": "المبلغ",
    "way": "طريقة الدفع",
    "wayPh": "اختر طريقة الدفع",
    "ways": {
      "bank-transfer": "تحويل بنكي",
      "cash": "نقدًا",
      "card": "بطاقة على جهازنا الخاص",
      "cheque": "شيك",
      "other": "أخرى"
    },
    "date": "التاريخ",
    "note": "ملاحظة",
    "notePh": "اختياري",
    "approval": "رمز الموافقة",
    "approvalHelp": "حتى 12 حرفًا ورقمًا.",
    "approvalErr": "حروف وأرقام فقط، حتى 12.",
    "last4": "آخر أربعة أرقام",
    "last4Err": "أدخل آخر أربعة أرقام فقط.",
    "cardNumber": "يبدو هذا رقم بطاقة كاملًا. لا تكتب أرقام البطاقات هنا أبدًا.",
    "amountErr": "أدخل مبلغًا أكبر من صفر.",
    "overDue": "هذا أكثر من المبلغ المستحق {amount}.",
    "dateErr": "لا يمكن أن يكون يوم الدفع في المستقبل.",
    "pendingWarn": "هناك دفعة عبر الإنترنت في انتظار البنك. قد يؤدي تسجيل دفعة أخرى إلى أخذ المال مرتين.",
    "cancel": "إلغاء",
    "submit": "تسجيل الدفعة",
    "close": "إغلاق",
    "failed": "لم تُسجّل الدفعة: {message}"
  }
} as const;
