// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/ar-EG/addOns.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "notInstalled": {
    "title": "هذا الـ Add-on غير مثبت",
    "body": "الصفحة التي فتحتها تخص Add-on غير مثبت على هذا الخادم، أو تم إيقافه. يمكن للمسؤول تثبيته من الاستوديو."
  },
  "unknown": {
    "title": "لا توجد صفحة بهذا العنوان",
    "body": "هذا الـ Add-on مثبت، لكن ليست لديه صفحة على هذا العنوان."
  },
  "retry": "حاول مرة أخرى",
  "noBundle": {
    "title": "تعذّر تحميل هذه الصفحة",
    "body": "يعلن الـ Add-on عن هذه الصفحة لكنه لا يتضمن الملف الذي تشير إليه. إعادة التثبيت أو الترقية إلى إصدار أحدث تحل المشكلة."
  },
  "failed": {
    "title": "تعذّر تحميل هذه الصفحة",
    "body": "تعذّر جلب كود الـ Add-on، أو أنه لم يطابق البصمة المسجلة عند التثبيت. ولم يُنفَّذ أي جزء منه."
  },
  "refused": {
    "body": "تم تحميل شيفرة الصفحة، لكن الخادم رفض طلبًا منها: {reason}"
  },
  "crashed": {
    "body": "تم تحميل شيفرة الصفحة، لكنها توقفت بسبب خطأ: {reason}"
  },
  "listFailed": {
    "body": "تعذّرت قراءة قائمة الـ Add-ons المثبتة، لذلك لا يمكن تحديد الملف الذي ينبغي لهذه الصفحة تحميله."
  },
  "tooOld": {
    "title": "هذه الصفحة تحتاج إلى إصدار أحدث من Adminium",
    "body": "صُممت صفحة هذه الإضافة لإصدار من Adminium أحدث من هذا الإصدار. تحديث Adminium هو ما يفتحها؛ ولم يُشغَّل أي شيء من الصفحة."
  },
  "accounts": {
    "notice": {
      "connectedTitle": "ربط {person} حسابًا",
      "connectedBody": "أصبح {person} مربوطًا بخدمة {provider} بالحساب {account}.",
      "refusedTitle": "رفض {provider} تطبيق هذا الخادم",
      "refusedBody": "تحقق من معرّف العميل والسر المحفوظين لخدمة {provider}. لا يحتاج أحد إلى إعادة الربط: ستُستأنف الاتصالات بمجرد قبول التطبيق.",
      "clashTitle": "لدى {person} تعارض في التقويم",
      "clashBody": "يتداخل وقت مشغول في تقويم {person} الآن مع حجز. افتح الحجز لنقله أو الإبقاء عليه.",
      "staleTitle": "أُزيلت أوقات {person} المشغولة",
      "staleBody": "لم يُعد {person} الاتصال منذ 7 أيام، لذا لم يعد تقويمه يحجب الأوقات.",
      "removedTitle": "حذف {person} تقويم {calendar}",
      "removedBody": "حُذف مرتين خلال أسبوع، لذا لن تصل الحجوزات إلى تقويم {person} حتى يعيد تشغيلها.",
      "remadeTitle": "أُعيد إنشاء تقويم {calendar}",
      "remadeBody": "حُذف من حساب {person}، لذا أُعيد إنشاؤه مع الحجوزات القادمة.",
      "silentTitle": "تصل تغييرات تقويم {person} متأخرة",
      "silentBody": "توقفت التحديثات الفورية، لذا تصل التغييرات مع الفحص الدوري خلال نحو 12 دقيقة.",
      "secretEndingTitle": "ينتهي سر عميل {provider} في {date}",
      "secretEndingBody": "أنشئ سر عميل جديدًا والصقه في دليل الإعداد قبل ذلك اليوم، وإلا ستتوقف كل اتصالات {provider}. لا يحتاج أحد إلى إعادة الربط.",
      "unreadableTitle": "لم يعد من الممكن قراءة أحد تقويمات {person}",
      "unreadableBody": "حُذف أو لم يعد مشتركًا، لذا أُزيل من التقويمات المحسوبة كمشغولة ولم يعد يحجب مواعيد {person}. أما التقويمات الأخرى فما زالت تحجبها.",
      "namesLeftTitle": "قد يظل تقويم {person} يعرض اسم أحد العملاء",
      "namesLeftBody": "تعذّرت إزالة بعض الأحداث من تقويم {calendar} قبل انتهاء هذا الاتصال. اطلب من {person} حذفها من هناك."
    }
  }
} as const;
