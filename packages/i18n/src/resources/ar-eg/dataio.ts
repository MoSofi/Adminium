// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/ar-EG/dataio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "back": "رجوع",
  "import": {
    "stepUpload": "رفع",
    "stepMap": "مطابقة الأعمدة",
    "stepValidate": "التحقق",
    "stepRun": "الاستيراد والمراجعة",
    "targetLabel": "الجدول الهدف",
    "targetPlaceholder": "اختر صفحة جدول…",
    "notATable": "هذه الصفحة ليست جدولًا — اختر صفحة جدول للاستيراد إليها.",
    "dropTitle": "أسقط ملف CSV للاستيراد",
    "dropHint": "ملف CSV حتى 32 ميغابايت — يجب أن يكون الصف الأول هو صف العناوين",
    "skipTarget": "عدم الاستيراد",
    "mapHint": "{count} صفوف بيانات في {file} — اختر هدفًا لكل عمود.",
    "validating": "جارٍ التحقق…",
    "toValidate": "التحقق",
    "validateFailed": "فشل التحقق.",
    "validationSummary": "{valid} من {total} صفًا جاهزة للاستيراد — سيتم تخطي {invalid}.",
    "allValid": "اجتازت جميع الصفوف التحقق",
    "run": "تشغيل الاستيراد",
    "runSkipping": "استيراد {valid} صفًا (تخطي {invalid})",
    "progressLabel": "تقدم الاستيراد",
    "running": "جارٍ الاستيراد…",
    "kpiTotal": "صفوف الملف",
    "kpiCreated": "تم إنشاؤها",
    "kpiUpdated": "تم تحديثها",
    "kpiSkipped": "تم تخطيها",
    "inconsistent": "أرقام الاستيراد غير متسقة — يجب أن يساوي الإجمالي مجموع ما تم إنشاؤه وتحديثه وتخطيه.",
    "downloadErrors": "تنزيل تقرير الصفوف المتخطاة (CSV)",
    "runFailed": "فشل الاستيراد."
  },
  "exports": {
    "tableLabel": "الجدول",
    "tablePlaceholder": "اختر جدولًا…",
    "notATable": "هذه الصفحة ليست جدولًا — اختر صفحة جدول لتصديرها.",
    "formatLabel": "التنسيق",
    "create": "تصدير",
    "createFailed": "تعذّر طلب التصدير.",
    "retention": "تُحفظ عمليات التصدير لمدة 30 يومًا ثم تنتهي صلاحيتها.",
    "statusProcessing": "جارٍ المعالجة…",
    "statusReady": "جاهز — {rows} صفًا · انقر للتنزيل",
    "statusFailed": "فشل — {error}",
    "statusCancelled": "أُلغي",
    "statusExpired": "منتهي الصلاحية",
    "emptyTitle": "لا توجد عمليات تصدير بعد",
    "emptyBody": "اطلب واحدة أعلاه — تظهر الملفات الناتجة هنا مع حالتها.",
    "new": "تصدير جديد"
  },
  "builder": {
    "title": "تصدير جديد",
    "subtitle": "اختر جدولًا، ثم الأعمدة، ثم راجع الملف، ثم صدّر.",
    "cancel": "إلغاء",
    "backToExports": "العودة إلى تصدير البيانات",
    "basedOn": "استنادًا إلى {name}",
    "noAccess": {
      "title": "لا يوجد ما يمكن تصديره بعد",
      "body": "ليست لديك صلاحية التصدير لأي جدول في هذا الاتصال. اطلب من المسؤول منحها من {link}.",
      "link": "الأدوار والصلاحيات"
    },
    "step": "الخطوة {n} من 3",
    "steps": {
      "source": "المصدر",
      "columns": "الأعمدة",
      "preview": "المعاينة"
    },
    "continue": "متابعة",
    "export": "تصدير",
    "back": "رجوع",
    "hint": {
      "chooseTable": "اختر جدولًا للمتابعة.",
      "fromAll": "البدء من كل أعمدة {table}.",
      "fromPage": "البدء من صفحة مرتبطة بـ {table}.",
      "noColumns": "أضف عمودًا واحدًا على الأقل للمتابعة.",
      "dupes": "عمودان يحملان العنوان نفسه. أعد تسمية أحدهما للمتابعة.",
      "order": "سيُكتب {n} من الأعمدة بهذا الترتيب.",
      "readSample": "اقرأ العيّنة قبل التصدير.",
      "downloads": "يُنزَّل الملف من تصدير البيانات عندما يصبح جاهزًا."
    },
    "source": {
      "title": "أي جدول؟",
      "search": "ابحث في الجداول…",
      "meta": "{rows} صفًا · {cols} عمودًا",
      "metaNoRows": "{cols} عمودًا",
      "usedBy": "{n, plural, zero {لا تستخدمه أي صفحة} one {تستخدمه صفحة واحدة} two {تستخدمه صفحتان} few {تستخدمه # صفحات} many {تستخدمه # صفحة} other {تستخدمه # صفحة}}",
      "locked": "لا صلاحية تصدير",
      "lockedToast": "ليست لديك صلاحية تصدير {table}"
    },
    "startFrom": {
      "title": "البدء من",
      "body": "حدّد من أين تبدأ قائمة الأعمدة. يمكنك تغيير كل شيء في الخطوة التالية.",
      "all": "كل أعمدة {table}",
      "page": "أعمدة صفحة — {page}",
      "pageMeta": "{page} · {n} عمودًا · {linked} مرتبطًا · {totals, plural, zero {لا مجاميع} one {مجموع واحد} two {مجموعان} few {# مجاميع} many {# مجموعًا} other {# مجموع}}",
      "none": "لا توجد صفحة مرتبطة بهذا الجدول"
    },
    "columns": {
      "title": "ما الذي يدخل في الملف.",
      "add": "إضافة أعمدة",
      "inFile": "في ملفك",
      "summary": "{n} عمودًا · {linked} مرتبطًا · {totals, plural, zero {لا مجاميع} one {مجموع واحد} two {مجموعان} few {# مجاميع} many {# مجموعًا} other {# مجموع}}",
      "reset": "إعادة الضبط إلى أعمدة الجدول",
      "removeAll": "إزالة الكل",
      "empty": {
        "title": "لا أعمدة بعد",
        "body": "أضف أعمدة من اللوحة، أو أعد الضبط إلى أعمدة الجدول نفسه."
      },
      "dragTitle": "اسحب لإعادة الترتيب، أو استخدم مفاتيح الأسهم",
      "reorder": "إعادة ترتيب {header}",
      "headerLabel": "العنوان في الملف",
      "masked": "يُصدَّر كـ ••••• ما لم تكن لديك صلاحية الكشف",
      "dupe": "عمود آخر يستخدم هذا العنوان",
      "removeTitle": "إزالة من الملف",
      "remove": "إزالة {header}"
    },
    "browser": {
      "search": "ابحث في الأعمدة…",
      "broken": "لم يعد هذا الرابط قابلًا للحل — ابدأه من جديد.",
      "brokenBack": "العودة إلى كل الجداول",
      "suggested": "مقترح",
      "fromTable": "من {table}",
      "fromTheTable": "من الجدول",
      "readOnly": "عمود للقراءة فقط",
      "noMatch": "لا يطابق أي عمود هذا البحث.",
      "allIn": "كل أعمدة هذا الجدول موجودة في ملفك بالفعل.",
      "linked": "من الجداول المرتبطة",
      "budget": "{used} من {max}",
      "inbound": "الجداول التي ترتبط بهذا الجدول",
      "via": "عبر {column}",
      "count": "العدد",
      "aggregate": "التجميع",
      "add": "إضافة",
      "singleNote": "الحد الأدنى والأقصى يأخذان عمودًا واحدًا.",
      "limit": "بلغت الحد — أزل واحدًا لتضيف آخر",
      "fourMax": "حتى أربعة أعمدة",
      "pickNumeric": "اختر عمودًا رقميًا أولًا",
      "already": "{header} موجود في ملفك بالفعل",
      "added": "تمت إضافة {header}",
      "calculated": "محسوب",
      "hop": "أضف عمودًا، أو اتبع رابطًا آخر للخارج.",
      "hopLimit": "ثلاث قفزات هي الحد. أضف عمودًا هنا، أو ارجع خطوة.",
      "addName": "إضافة {name}",
      "noRead": "لا صلاحية قراءة"
    },
    "calc": {
      "arith": "جمع عمودين أو طرحهما",
      "first": "العمود الأول",
      "op": "العملية",
      "second": "العمود الثاني",
      "pct": "نسبة مئوية من عمود",
      "pctLabel": "النسبة المئوية",
      "pctOf": "% من",
      "column": "العمود",
      "rule": "قاعدة بحدّ",
      "if": "إذا",
      "isOver": "تجاوز",
      "then": "فـ",
      "else": "وإلا",
      "threshold": "الحد",
      "whenOver": "القيمة عند التجاوز",
      "otherwise": "القيمة وإلا",
      "needTwo": "أضف عمودين رقميين أولًا",
      "needOne": "أضف عمودًا رقميًا أولًا"
    },
    "gen": {
      "count": "عدد {table}",
      "countSrc": "عدد {table} عبر {column}",
      "foldSrc": "{fn} لـ {table}.{cols}",
      "linkedSrc": "{table}.{column} عبر {path}",
      "arithHeader": "{a} {op} {b}",
      "pctHeader": "{pct}% من {a}",
      "ruleHeader": "{then} أو {else}",
      "ruleSrc": "إذا تجاوز {a} {threshold} فـ {then}، وإلا {else}",
      "sumOf": "مجموع",
      "average": "متوسط",
      "min": "أدنى",
      "max": "أقصى"
    },
    "badge": {
      "key": "مفتاح",
      "linked": "مرتبط",
      "count": "عدد",
      "sum": "مجموع",
      "avg": "متوسط",
      "min": "أدنى",
      "max": "أقصى",
      "calculated": "محسوب",
      "masked": "مخفي"
    },
    "fold": {
      "sum": "مجموع",
      "avg": "متوسط",
      "min": "أدنى",
      "max": "أقصى"
    },
    "preview": {
      "title": "راجع الملف، ثم صدّر.",
      "fileName": "اسم الملف",
      "format": "الصيغة",
      "csv": "CSV",
      "jsonl": "JSON Lines",
      "rows": "الصفوف",
      "allRows": "كل الصفوف · {n}",
      "allRowsUnknown": "كل الصفوف",
      "viewRows": "صفوف عرض محفوظ",
      "savedView": "العرض المحفوظ",
      "viewLabel": "{name} · {filters} مرشحات · {rows} صفًا",
      "viewLabelNoRows": "{name} · {filters} مرشحات",
      "headerRow": "صف العناوين",
      "tabTable": "جدول",
      "tabRaw": "الملف الخام",
      "sample": "عيّنة من {n} صفًا · حُدّثت {when}",
      "justNow": "للتو",
      "minutesAgo": "{n, plural, zero {قبل # دقائق} one {قبل دقيقة} two {قبل دقيقتين} few {قبل # دقائق} many {قبل # دقيقة} other {قبل # دقيقة}}",
      "refresh": "تحديث",
      "failed": "تعذّر قراءة العيّنة.",
      "failedTimeout": "استجاب الاتصال ببطء شديد. لم يُنفَّذ التصدير نفسه.",
      "retry": "إعادة المحاولة",
      "headerOnly": "سيحتوي الملف على صف العناوين فقط."
    },
    "summary": {
      "title": "الملف",
      "columns": "الأعمدة",
      "rows": "الصفوف",
      "size": "الحجم التقديري",
      "retention": "الاحتفاظ",
      "kept": "يُحتفظ به 30 يومًا",
      "fileName": "اسم الملف"
    },
    "warn": {
      "title": "جدير بالمعرفة",
      "masked": "{n, plural, zero {لا يُصدَّر أي عمود مخفيًا} one {يُصدَّر عمود واحد مخفيًا} two {يُصدَّر عمودان مخفيين} few {تُصدَّر # أعمدة مخفية} many {يُصدَّر # عمودًا مخفيًا} other {يُصدَّر # عمود مخفيًا}}",
      "search": "لهذا العرض مصطلح بحث لا يمكن للتصدير حمله",
      "noRows": "ليس في هذا الجدول أي صفوف الآن"
    },
    "started": {
      "preparing": "جارٍ تجهيز {file} · {rows} صفًا",
      "ready": "جاهز · {rows} صفًا",
      "noteBusy": "سيظهر في تصدير البيانات ويُنزَّل من هناك عندما يصبح جاهزًا.",
      "noteReady": "جاهز. وهو موجود أيضًا في تصدير البيانات إن أردت العودة إليه لاحقًا.",
      "download": "تنزيل {format}",
      "busy": "جارٍ تجهيز الملف…",
      "another": "تصدير آخر",
      "failed": "فشل التصدير."
    },
    "toast": {
      "started": "بدأ التصدير"
    }
  }
} as const;
