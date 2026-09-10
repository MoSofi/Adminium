// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/ar-EG/onboarding.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "account": {
    "body": "أول مسؤول. يحدث هذا مرة واحدة فقط، وتظل مسجَّل الدخول بعده.",
    "confirm": "تأكيد كلمة المرور",
    "email": "البريد الإلكتروني",
    "label": "حسابك",
    "name": "اسمك",
    "password": "كلمة المرور",
    "passwordHelper": "‏{min} حرفًا على الأقل.",
    "strength": "قوة كلمة المرور",
    "strengthLevels": {
      "fair": "مقبولة",
      "good": "جيدة",
      "strong": "قوية",
      "weak": "ضعيفة"
    },
    "sub": "بيانات الدخول",
    "submit": "إنشاء الحساب",
    "title": "أنشئ حسابك"
  },
  "back": "رجوع",
  "connect": {
    "body": "وجِّه Adminium إلى مصدر بيانات. نقرأ المخطط ولا نكتب فيه أبدًا ما لم تطلب ذلك.",
    "bridge": {
      "body": "تم تسليمه من adminium.dev. أنشئ حسابك وسنفتحه في معالج الاتصال، حيث يمكنك قراءته قبل أن يستخدمه أي شيء.",
      "title": "هناك نص اتصال في انتظار هذه النسخة"
    },
    "dsn": {
      "helper": "لا شيء يغادر هذا المتصفح قبل أن يوجد حسابك — عندها نختبره.",
      "incomplete": "أضف المضيف واسم قاعدة البيانات، مثل postgres://user@host:5432/db",
      "invalidScheme": "بروتوكول غير معروف — المتوقع postgres:// أو mysql:// أو mariadb:// أو sqlite:",
      "label": "نص الاتصال"
    },
    "engine": {
      "mysql": "MySQL / MariaDB",
      "postgres": "PostgreSQL",
      "sqlite": "SQLite"
    },
    "engineLabel": "محرك قاعدة البيانات",
    "label": "توصيل البيانات",
    "sub": "اربط قاعدة بيانات",
    "title": "اربط قاعدة بياناتك"
  },
  "continue": "متابعة",
  "done": {
    "connected": {
      "reading": "تم الاتصال — يقرأ Adminium مخططك الآن.",
      "tables": "تم الاتصال · {count, plural, zero {لم يتم العثور على أي جدول} one {تم العثور على جدول واحد} two {تم العثور على جدولين} few {تم العثور على # جداول} many {تم العثور على # جدولًا} other {تم العثور على # جدول}}."
    },
    "invited": "{count, plural, zero {لم يتم إنشاء أي دعوة} one {تم إنشاء دعوة واحدة} two {تم إنشاء دعوتين} few {تم إنشاء # دعوات} many {تم إنشاء # دعوة} other {تم إنشاء # دعوة}}.",
    "label": "كل شيء جاهز",
    "next": {
      "blank": "مساحة عملك جاهزة. أضف صفحة متى شئت — لم يتم توليد أي شيء، تمامًا كما طلبت.",
      "generate": "مساحة عملك جاهزة. سنختار بعد ذلك الجداول التي ستُضمَّن ثم نولِّد صفحاتك."
    },
    "storage": {
      "local": "يحتفظ Adminium ببياناته الخاصة في ملف على هذا الجهاز.",
      "sameDb": "يحتفظ Adminium ببياناته الخاصة في قاعدة البيانات التي ربطتها.",
      "separate": "يحتفظ Adminium ببياناته الخاصة في قاعدة البيانات التي أعطيتها له."
    },
    "sub": "ابدأ البناء",
    "title": "كل شيء جاهز! 🎉"
  },
  "error": {
    "alreadyCompleted": "تم إعداد هذه النسخة بالفعل. سجّل الدخول بحساب المسؤول الموجود.",
    "connectionFailed": "تم إنشاء حسابك وأنت مسجَّل الدخول — لكن تعذّر الوصول إلى قاعدة البيانات تلك: {detail}",
    "connectionUnknown": "لم تستجب قاعدة البيانات",
    "failed": "فشل الإعداد. تحقق من اتصالك وحاول مرة أخرى.",
    "rejected": "رفض الخادم هذه البيانات. تحقق من البريد الإلكتروني وكلمة المرور وحاول مرة أخرى."
  },
  "finish": "الانتقال إلى لوحة المعلومات",
  "kicker": "الخطوة {n} من {total}",
  "meta": {
    "body": "تسجيل دخولك، والصفحات التي تولّدها، وإعداداتك المحفوظة. هذا منفصل عن قاعدة البيانات التي ربطتها للتو، والتي يقرأها Adminium فقط.",
    "label": "بيانات Adminium",
    "local": {
      "body": "لا شيء لإعداده. مناسب لتجربة Adminium أو لنسخة واحدة.",
      "title": "في ملف على هذا الجهاز"
    },
    "moving": {
      "copying": "جارٍ نسخ بيانات Adminium…",
      "failed": "تعذّر نقل بيانات Adminium — أعد المحاولة.",
      "restarting": "جارٍ إعادة التشغيل على قاعدة البيانات الجديدة…",
      "timeout": "نقل Adminium بياناته لكنه لم يعد بعد. البيانات آمنة في قاعدة البيانات الجديدة — أعد تحميل هذه الصفحة بعد لحظات."
    },
    "pinned": {
      "body": "بدأت هذه النسخة ومخزن البيانات الوصفية مضبوط بالفعل، فلا شيء لنقله. يمكنك تغييره لاحقًا من إعدادات الاستوديو.",
      "title": "بيانات Adminium لها موضع بالفعل"
    },
    "sameDb": {
      "body": "يضيف Adminium جداوله الخاصة `adminium_` بجوار جداولك. قاعدة بيانات واحدة تحتاج إلى نسخ احتياطي.",
      "disabledFile": "ملف SQLite ليس خادمًا يستطيع Adminium إضافة جداوله الخاصة إليه.",
      "disabledNoDdl": "لا يستطيع هذا الدور تنفيذ CREATE TABLE، وهو ما تحتاجه ترحيلات Adminium.",
      "disabledReadOnly": "هذا الدور للقراءة فقط — لا يكتب Adminium في قاعدة بياناتك أبدًا. أبقِ بياناته في ملف، أو امنحه قاعدة بيانات خاصة به.",
      "noSource": "لم تربط قاعدة بيانات بعد — اربط واحدة أولًا، أو أبقِ بيانات Adminium في ملف.",
      "title": "في قاعدة البيانات التي ربطتها للتو"
    },
    "separate": {
      "body": "قاعدة بيانات PostgreSQL أو MySQL توفّرها أنت. مناسبة للإنتاج أو لعدة نسخ.",
      "failed": "لم تستجب قاعدة البيانات تلك.",
      "incomplete": "أضف المضيف واسم قاعدة البيانات، مثل postgres://user@host:5432/adminium",
      "insufficient": "لا يستطيع هذا الدور تنفيذ CREATE TABLE — ترحيلات Adminium تحتاجه.",
      "invalidScheme": "بروتوكول غير معروف — المتوقع postgres:// أو mysql:// أو mariadb://",
      "label": "نص الاتصال الخاص بـ Adminium",
      "ok": "يمكن الوصول إليها، وتستطيع إنشاء الجداول.",
      "test": "اختبر قاعدة البيانات هذه",
      "title": "في قاعدة بيانات خاصة به"
    },
    "sub": "أين تُحفظ",
    "title": "أين يحتفظ Adminium ببياناته الخاصة"
  },
  "progressComplete": "اكتمل {percent}%",
  "progressLabel": "تقدّم الإعداد",
  "skip": "تخطٍّ",
  "start": {
    "body": "هذا يحدد فقط الصفحات التي نولّدها لك. يمكنك تغيير أي شيء لاحقًا، أو البدء من لا شيء.",
    "label": "نقطة البداية",
    "options": {
      "analytics": {
        "body": "رسوم بيانية وجداول للقراءة. لا شيء يُكتب مرة أخرى.",
        "title": "تحليلات للقراءة فقط"
      },
      "blank": {
        "body": "لا تولّد شيئًا. اربط قاعدة بيانات وابنِ الصفحات التي تريدها، واحدة تلو الأخرى.",
        "title": "لوحة فارغة"
      },
      "crud": {
        "body": "جداول ونماذج، بدون لوحات المعلومات.",
        "title": "جداول CRUD"
      },
      "fullAdmin": {
        "body": "صفحة لكل جدول، مع الإنشاء والتعديل والحذف.",
        "title": "لوحة إدارة كاملة"
      },
      "support": {
        "body": "قوائم الانتظار وصفحات تفاصيل العملاء أولًا، مع تعطيل الحذف.",
        "title": "وحدة تحكم الدعم"
      }
    },
    "sub": "اختر الشكل",
    "title": "ما الذي ستبنيه أولًا؟"
  },
  "team": {
    "body": "ادعُ من تعمل معهم. يمكنك دائمًا إضافة المزيد لاحقًا.",
    "copied": "تم النسخ",
    "copyLink": "نسخ الرابط",
    "duplicate": "تمت دعوة هذا الشخص بالفعل.",
    "emailLabel": "البريد الإلكتروني للزميل",
    "emailed": "أُرسلت الدعوة بالبريد الإلكتروني",
    "failed": "تعذّر إنشاء هذه الدعوة.",
    "invalidEmail": "أدخل عنوان بريد إلكتروني صالحًا.",
    "invite": "دعوة",
    "label": "فريقك",
    "note": "الدعوات بدون بريد إلكتروني تعرض رابطًا ترسله بنفسك. يظهر مرة واحدة فقط — لا يحتفظ Adminium إلا ببصمته.",
    "placeholder": "zameel@sharika.com",
    "sub": "أضف أشخاصًا",
    "title": "أحضِر فريقك"
  }
} as const;
