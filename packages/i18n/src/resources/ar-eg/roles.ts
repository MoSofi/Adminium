// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/ar-EG/roles.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "delete": "حذف",
    "rename": "إعادة تسمية"
  },
  "builtinLocked": "لا يمكن حذف الأدوار المدمجة.",
  "category": {
    "access": "الوصول",
    "data": "البيانات",
    "operations": "العمليات",
    "workspace": "مساحة العمل",
    "records": "الصفحات والسجلات",
    "apps": "التطبيقات"
  },
  "column": {
    "actions": "الإجراءات",
    "members": "الأعضاء",
    "name": "الدور"
  },
  "create": {
    "descriptionLabel": "الوصف",
    "description": "يبدأ الدور الجديد بلا أي صلاحيات على الإطلاق.",
    "failed": "تعذّر إنشاء الدور",
    "namePlaceholder": "مثال: موظف دعم",
    "name": "الاسم",
    "submit": "إنشاء الدور",
    "title": "دور جديد"
  },
  "createButton": "دور جديد",
  "delete": {
    "confirm": "حذف الدور",
    "description": "يُحذف الدور وصفوف صلاحياته.",
    "failed": "تعذّر حذف الدور",
    "hasMembers": "ما زال «{name}» لديه {count, plural, zero {لا أعضاء} one {عضو واحد} two {عضوان} few {# أعضاء} many {# عضوًا} other {# عضو}}. اختر الدور الذي سينتقلون إليه — لن يترك Adminium أي حساب بلا دور.",
    "noMembers": "لا أحد يحمل «{name}»، لذا لن ينتقل أحد.",
    "reassignPlaceholder": "اختر دورًا…",
    "reassignTo": "نقل الأعضاء إلى",
    "title": "حذف الدور"
  },
  "list": {
    "title": "الأدوار"
  },
  "loadFailed": {
    "body": "المصفوفة أدناه غير مكتملة، لذا فإن حفظها سيمسح صلاحيات لم تُحمَّل فحسب. أعد التحميل قبل إجراء أي تغييرات.",
    "title": "تعذّرت قراءة بعض الصلاحيات"
  },
  "matrix": {
    "discard": "تجاهل",
    "empty": {
      "body": "أبلغت هذه النسخة عن عدم وجود أي صلاحيات قابلة للمنح على الإطلاق، وهو ما لا ينبغي أن يحدث — أعد التحميل، وإذا استمر الأمر فراجع سجل الخادم.",
      "title": "لا توجد صلاحيات لعرضها"
    },
    "label": "صلاحيات الدور",
    "noChanges": "لا تغييرات معلّقة",
    "pending": "{count, plural, zero {لا تغييرات معلّقة} one {تغيير واحد معلّق} two {تغييران معلّقان} few {# تغييرات معلّقة} many {# تغييرًا معلّقًا} other {# تغيير معلّق}}",
    "rowHeader": "الصلاحية",
    "title": "الصلاحيات"
  },
  "memberCount": "{count, plural, zero {لا مستخدمين} one {مستخدم واحد} two {مستخدمان} few {# مستخدمين} many {# مستخدمًا} other {# مستخدم}}",
  "permission": {
    "apiKeysManage": "إدارة مفاتيح API",
    "auditRead": "قراءة سجل التدقيق",
    "connectionsManage": "إدارة اتصالات قواعد البيانات",
    "exportsManage": "إدارة عمليات التصدير لدى الجميع",
    "importsManage": "إدارة عمليات الاستيراد لدى الجميع",
    "jobsManage": "بدء المهام الخلفية وإلغاؤها",
    "manifestsManage": "تثبيت التطبيقات والإضافات وإدارتها",
    "jobsRead": "الاطلاع على كل المهام الخلفية",
    "llmRun": "تشغيل المساعدة بالذكاء الاصطناعي",
    "pagesManage": "إنشاء الصفحات وتنظيمها",
    "projectRead": "قراءة تغييرات الصفحات والمخطط لسحبها إلى مشروع",
    "reportsManage": "إدارة التقارير المجدولة",
    "rolesManage": "إدارة الأدوار والصلاحيات",
    "schemaRemap": "تعديل تسميات المخطط وتجاوزاته",
    "schemaDdl": "إنشاء الجداول وتعديلها وحذفها",
    "settingsManage": "إدارة إعدادات مساحة العمل",
    "usersManage": "إدارة المستخدمين",
    "filesManage": "إدارة ملفات الجميع",
    "storageManage": "إدارة وجهات التخزين",
    "designerUse": "إنشاء تطبيقات باستخدام Adminium Designer"
  },
  "rename": {
    "failed": "تعذّرت إعادة تسمية الدور",
    "title": "إعادة تسمية الدور"
  },
  "saveFailed": {
    "title": "تعذّر حفظ كل الأدوار"
  },
  "subtitle": "ما الذي يمكن لكل دور فعله. يحصل المستخدم على اتحاد كل الأدوار التي يحملها.",
  "title": "الأدوار والصلاحيات",
  "data": {
    "pagesView": "عرض كل الصفحات",
    "read": "قراءة السجلات",
    "readPii": "عرض البيانات الشخصية في السجلات",
    "create": "إنشاء السجلات",
    "update": "تعديل السجلات",
    "delete": "حذف السجلات",
    "export": "تصدير السجلات",
    "import": "استيراد السجلات",
    "pagesEdit": "تغيير تخطيطات الصفحات",
    "narrow": "{count, plural, one {منحة واحدة} other {# منح}} على صفحة أو جدول واحد تسري أيضًا، إضافةً إلى الصفوف أدناه. يحتفظ الحفظ بها."
  },
  "apps": {
    "every": "فتح شاشات الموظفين لكل التطبيقات",
    "one": "فتح شاشات الموظفين في {app}"
  },
  "rows": {
    "locked": "المشرف العام يصل إلى كل الصفوف.",
    "saveFirst": "احفظ تغييرات الصلاحيات أو تجاهلها أولاً.",
    "action": "الصفوف",
    "actionLabel": {
      "read": "قراءة",
      "update": "تغيير",
      "delete": "حذف"
    },
    "way": {
      "person": "الشخص المذكور في {column}",
      "listingDated": "أي شخص مُدرج له في {table} في ذلك اليوم",
      "listing": "أي شخص مُدرج له في {table}",
      "parent": "كل من يصل إلى {table} الخاص به"
    },
    "follows": "يتبع: {table}",
    "belongs": "الصف يخص {ways}.",
    "sentence": {
      "all": "يصل إلى كل الصفوف.",
      "allWhile": "كل الصفوف",
      "team": "فقط الصفوف التي تخص هذا الشخص أو شخصًا في فريق يقوده",
      "own": "فقط الصفوف التي تخص هذا الشخص",
      "unowned": "والصفوف التي لا يملكها أحد بعد",
      "while": "فقط ما دام {column} يساوي {values}",
      "by": "وفقط تلك التي يذكرهم فيها {column}"
    },
    "title": "الصفوف التي يصل إليها «{role}»",
    "intro": "يصل الدور إلى كل صفوف الجدول الذي يُسمح له بفتحه، ما لم يُقيَّد هنا. ولا يسري القيد على شخص إلا إذا كان كل دور يمنحه الجدول مقيَّدًا.",
    "loadFailed": "تعذّرت قراءة الجداول.",
    "empty": {
      "title": "لا شيء لتقييده",
      "body": "لا يوجد جدول يمكن لهذا الدور فتحه يحدد لمن تعود صفوفه."
    },
    "tryAs": "جرّب بصفة",
    "tryAsNone": "لا أحد",
    "samplePerson": "{name} (تجريبي)",
    "failed": "تعذّر حفظ قيود الصفوف",
    "private": "يقرؤه الأشخاص الذين يخصهم كل صف، ولا أحد غيرهم. لا يوجد ما يُختار هنا.",
    "reachLabel": "{action}: أي صفوف",
    "reach": {
      "all": "كل الصفوف",
      "own": "صفوفه فقط",
      "team": "صفوفه وصفوف فريقه",
      "allWhile": "كل الصفوف، فقط ما دام…"
    },
    "unowned": "والصفوف التي لا يملكها أحد بعد",
    "widened": "يفتح هذا الدور الجدول عبر صلاحية أوسع. عند حفظ قيد يُمنح الدور هذا الجدول بالاسم أيضًا.",
    "count": "{name} سيرى {reached} من {total}.",
    "capped": "يقود هذا الشخص عددًا من الأشخاص يفوق ما يسعه نطاق واحد، لذا لم يُحتسب فريقه كله.",
    "lifted": "{name} لديه أيضًا {roles}، وهو يمنح كل الصفوف. هذا القيد لا يسري عليه."
  },
  "partsOff": "جزؤه من التطبيق متوقف: لا يمنح شيئًا حتى يُشغَّل ذلك الجزء."
} as const;
