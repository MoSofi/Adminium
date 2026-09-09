// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/ar-EG/files.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "toast": {
    "restored": "تمت استعادة «{name}»",
    "restoreFailed": "تعذّرت استعادة هذا الملف",
    "trashed": "نُقل «{name}» إلى سلة المهملات",
    "trashFailed": "تعذّر نقل هذا الملف إلى سلة المهملات"
  },
  "title": "الملفات",
  "subtitle": "كل ما رُفع عبر مساحة العمل هذه، وأين تُخزَّن بياناته.",
  "search": "ابحث باسم الملف",
  "trash": {
    "notice": {
      "title": "تُفرَّغ سلة المهملات تلقائيًا",
      "body": "يُحذف الملف الموجود في سلة المهملات نهائيًا، ببياناته كاملة، بعد انقضاء مدة الاحتفاظ على هذا الخادم. استعِد ما تحتاجه قبل ذلك."
    }
  },
  "listFailed": {
    "title": "تعذّر تحميل هذه الملفات"
  },
  "empty": {
    "filtered": {
      "title": "لا يوجد شيء هنا",
      "body": "امسح البحث، أو اختر اختصارًا آخر من شريط الاختصارات."
    },
    "title": "لا توجد ملفات بعد",
    "body": "تصل الملفات إلى هنا عندما يرفق أحدهم ملفًا بسجل أو يملأ حقل ملف."
  },
  "loadMore": "تحميل مزيد من الملفات",
  "usage": {
    "label": "التخزين المستخدَم",
    "used": "{size} قيد الاستخدام",
    "count": "{count, plural, zero {لا ملفات} one {ملف واحد} two {ملفان} few {# ملفات} many {# ملفًا} other {# ملف}}",
    "diskLabel": "المساحة المستخدمة",
    "ofDisk": "{used} من {size} على هذا القرص"
  },
  "rail": {
    "label": "اختصارات الملفات",
    "byTable": "حسب الجدول",
    "byDestination": "حسب الوجهة",
    "byConnection": "حسب الاتصال"
  },
  "preset": {
    "all": "كل الملفات",
    "unattached": "غير المرفقة",
    "trash": "سلة المهملات",
    "recent": "الأحدث"
  },
  "column": {
    "name": "الملف",
    "size": "الحجم",
    "attachedTo": "مُرفق بـ",
    "destination": "الوجهة",
    "added": "تاريخ الإضافة",
    "actions": "الإجراءات"
  },
  "row": {
    "unattached": "غير مرفق",
    "localDestination": "قرص هذا الخادم",
    "noRecord": "غير مرفق بأي سجل"
  },
  "action": {
    "restore": "استعادة",
    "download": "تنزيل",
    "deleteNamed": "حذف {name}",
    "delete": "حذف"
  },
  "drawer": {
    "none": "لا شيء",
    "subtitle": "{size} · {type}",
    "destination": "الوجهة",
    "attachedTo": "مُرفق بـ",
    "uploadedBy": "رفعه",
    "added": "تاريخ الإضافة",
    "attachedAt": "تاريخ الإرفاق",
    "trashedAt": "تاريخ النقل إلى المهملات",
    "id": "معرّف الملف",
    "checksum": "المجموع الاختباري"
  },
  "view": {
    "label": "طريقة عرض الملفات",
    "grid": "شبكة",
    "list": "قائمة"
  },
  "upload": {
    "open": "رفع",
    "title": "رفع ملفات",
    "subtitle": "أضف ملفات إلى مساحة العمل هذه.",
    "connection": "الاتصال الذي تنتمي إليه",
    "drop": "اسحب الملفات إلى هنا",
    "browse": "تصفَّح جهازك",
    "sending": "جارٍ الرفع",
    "cancelOne": "إلغاء {name}",
    "removeOne": "إزالة {name}",
    "complete": "اكتمل الرفع",
    "completeBody": "هذه الملفات الآن في مساحة العمل هذه ويمكن إرفاقها بسجل لاحقًا.",
    "send": "{count, plural, zero {رفع # ملف} one {رفع ملف واحد} two {رفع ملفين} few {رفع # ملفات} many {رفع # ملفًا} other {رفع # ملف}}",
    "done": "تم",
    "failed": "فشل",
    "cancelled": "أُلغي"
  }
} as const;
