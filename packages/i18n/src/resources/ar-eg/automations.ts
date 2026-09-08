// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/ar-EG/automations.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "rules": {
    "title": "قواعد الأتمتة",
    "subtitle": "شغّل سير العمل تلقائيًا عندما يحدث شيء ما.",
    "new": "قاعدة جديدة",
    "empty": {
      "title": "لا توجد قواعد بعد",
      "body": "أنشئ قاعدة لتشغيل الخطوات تلقائيًا عندما يحدث شيء ما."
    },
    "none": "اختر قاعدة لعرض مسارها"
  },
  "kpi": {
    "activeRules": "القواعد النشطة",
    "runsToday": "عمليات التشغيل اليوم",
    "successRate": "معدّل النجاح",
    "timeSaved": "الوقت الموفَّر (شهريًا)"
  },
  "filter": {
    "all": "الكل",
    "active": "نشطة",
    "paused": "متوقفة مؤقتًا"
  },
  "card": {
    "runs": "تشغيل",
    "success": "نجاح",
    "never": "لم تُشغَّل قط",
    "toggle": "تبديل"
  },
  "status": {
    "active": "نشطة",
    "paused": "متوقفة مؤقتًا"
  },
  "flow": {
    "steps": "{count, plural, zero {# خطوة} one {خطوة واحدة} two {خطوتان} few {# خطوات} many {# خطوة} other {# خطوة}}",
    "saves": "توفّر {time} لكل تشغيل",
    "runs30d": "تشغيل خلال ٣٠ يومًا",
    "success": "نجاح",
    "test": "اختبار",
    "running": "قيد التشغيل",
    "noSample": "لا يوجد سجل للاختبار — أضف واحدًا أولًا",
    "menu": "إجراءات القاعدة"
  },
  "menu": {
    "rename": "إعادة تسمية",
    "duplicate": "تكرار",
    "delete": "حذف"
  },
  "delete": {
    "title": "حذف {name}؟",
    "body": "سيُحذف سجل عمليات التشغيل معها، ولا يمكن التراجع عن ذلك.",
    "confirm": "حذف",
    "cancel": "إلغاء"
  },
  "save": {
    "unsaved": "تغييرات غير محفوظة",
    "saving": "جارٍ الحفظ…",
    "saved": "تم حفظ كل التغييرات",
    "action": "حفظ"
  },
  "guard": {
    "title": "المغادرة دون حفظ؟",
    "body": "ستفقد تغييراتك على هذه القاعدة.",
    "stay": "متابعة التحرير",
    "leave": "مغادرة"
  },
  "toast": {
    "saved": "تم حفظ القاعدة",
    "enabled": "{name} مفعَّلة",
    "paused": "{name} متوقفة مؤقتًا",
    "incomplete": "أكمل «{step}» قبل تفعيل هذه القاعدة",
    "duplicated": "تم تكرار {name}",
    "deleted": "تم حذف {name}",
    "failed": "لم يتم الحفظ — {reason}"
  },
  "canvas": {
    "insert": "أدرج خطوة هنا",
    "addStep": "إضافة خطوة",
    "remove": "إزالة الخطوة"
  },
  "kind": {
    "trigger": "مُشغِّل",
    "condition": "مرشّح",
    "branch": "إذا / وإلا",
    "wait": "تأخير",
    "action": "إجراء"
  },
  "branch": {
    "ifMatches": "إذا تطابق",
    "otherwise": "وإلا"
  },
  "picker": {
    "title": "إضافة خطوة",
    "before": "قبل · {title}",
    "end": "في نهاية المسار",
    "inBranch": "داخل الفرع · {label}",
    "actions": "الإجراءات",
    "logic": "المنطق",
    "close": "إغلاق"
  },
  "pick": {
    "email": "إرسال بريد إلكتروني",
    "emailDesc": "من قالب محفوظ",
    "notification": "إرسال إشعار",
    "notificationDesc": "إبلاغ أشخاص في مساحة العمل هذه",
    "create": "إنشاء سجل",
    "createDesc": "إضافة صف إلى جدول",
    "update": "تحديث حقل",
    "updateDesc": "الكتابة مرة أخرى في سجل",
    "webhook": "استدعاء Webhook",
    "webhookDesc": "إرسال البيانات إلى أي مكان",
    "slack": "رسالة Slack",
    "slackDesc": "النشر في قناة",
    "branch": "تفرّع إذا / وإلا",
    "branchDesc": "التقسيم إلى مسارين",
    "filter": "المتابعة فقط إذا",
    "filterDesc": "التوقف عند عدم التطابق",
    "wait": "انتظار / تأخير",
    "waitDesc": "التوقف قبل الخطوة التالية",
    "stop": "إيقاف سير العمل",
    "stopDesc": "إنهاء هذا التشغيل هنا"
  },
  "node": {
    "email": {
      "sub": "القالب · اختر واحدًا",
      "summary": "القالب · {template} ← {to}"
    },
    "notification": {
      "sub": "اختر مَن تُبلغه",
      "summary": "إلى · {who}"
    },
    "create": {
      "sub": "الجدول · اختر واحدًا",
      "summary": "{table} · {count} قيمة"
    },
    "update": {
      "sub": "تعيين قيمة",
      "summary": "{pairs}"
    },
    "webhook": {
      "sub": "POST · حمولة JSON",
      "summary": "{method} {host}"
    },
    "slack": {
      "sub": "القناة · أضف عنوان Webhook",
      "summary": "Slack · {host}"
    },
    "wait": {
      "title": "انتظار / تأخير",
      "sub": "توقّف لمدة {duration}"
    },
    "stop": {
      "title": "إيقاف سير العمل",
      "sub": "ينهي التشغيل"
    },
    "condition": {
      "empty": "حدّد شرطًا"
    },
    "trigger": {
      "record": "عند {event} سجل في {table}",
      "interval": "كل {minutes} دقيقة",
      "daily": "يوميًا في {time}",
      "weekly": "أسبوعيًا يوم {day} في {time}",
      "monthly": "شهريًا في اليوم {day} الساعة {time}",
      "sub": "المُشغِّل · {event}"
    }
  },
  "event": {
    "created": "إنشاء",
    "updated": "تحديث",
    "deleted": "حذف"
  },
  "insp": {
    "stepName": "اسم الخطوة",
    "description": "الوصف",
    "condition": "الشرط",
    "lookAt": "انظر إلى",
    "thisRecord": "هذا السجل",
    "related": "السجلات المرتبطة",
    "field": "الحقل",
    "value": "القيمة",
    "countOf": "عدد",
    "where": "حيث",
    "isThisRecords": "يساوي حقل هذا السجل",
    "andWhere": "وحيث",
    "branchLabels": "تسميات الفروع",
    "onError": "المتابعة عند الخطأ",
    "onErrorBody": "تشغيل الخطوات اللاحقة حتى لو فشلت هذه الخطوة",
    "moveUp": "تحريك لأعلى",
    "moveDown": "تحريك لأسفل",
    "duplicate": "تكرار",
    "delete": "حذف",
    "close": "إغلاق",
    "settings": "الإعدادات"
  },
  "op": {
    "is": "يساوي",
    "isNot": "لا يساوي",
    "contains": "يحتوي على",
    "gt": "أكبر من",
    "lt": "أصغر من",
    "isEmpty": "فارغ",
    "notEmpty": "غير فارغ",
    "withinNext": "خلال الـ",
    "withinLast": "خلال آخر",
    "moreThanAgo": "كان قبل أكثر من …",
    "moreThanAhead": "بعد أكثر من …"
  },
  "unit": {
    "minutes": "{count, plural, zero {دقيقة} one {دقيقة} two {دقيقتان} few {دقائق} many {دقيقة} other {دقيقة}}",
    "hours": "{count, plural, zero {ساعة} one {ساعة} two {ساعتان} few {ساعات} many {ساعة} other {ساعة}}",
    "days": "{count, plural, zero {يوم} one {يوم} two {يومان} few {أيام} many {يومًا} other {يوم}}"
  },
  "trig": {
    "title": "المُشغِّل",
    "kind": "متى",
    "record": "يتم {event} سجل",
    "schedule": "وفق جدول زمني",
    "table": "الجدول",
    "changed": "فقط عند تغيّر هذا العمود",
    "anyColumn": "أي عمود",
    "watch": {
      "on": "يراقب أيضًا الصفوف المكتوبة خارج Adminium · كل دقيقة · عبر {column}",
      "off": "المراقبة متوقفة: لا يحتوي هذا الجدول على عمود من نوع «{shape}» ولا على مفتاح تصاعدي، لذا لا تُشغِّل القاعدة إلا عمليات الكتابة عبر Adminium",
      "deleted": "لا يمكن مراقبة الصفوف المحذوفة؛ لا تُشغِّل القاعدة إلا عمليات الحذف عبر Adminium",
      "fromNow": "الصفوف من الآن فصاعدًا"
    },
    "when": "فقط عندما",
    "every": "كل",
    "at": "في",
    "timezone": "المنطقة الزمنية",
    "forEach": "لكل سجل في",
    "forEachWhere": "حيث",
    "once": "مرة واحدة لكل سجل",
    "onceBody": "السجل الذي تطابق سابقًا لا يُشغَّل مرة أخرى",
    "timeSaved": "الوقت الموفَّر لكل تشغيل",
    "timeSavedBody": "الدقائق التي كان سيقضيها شخص — تظهر بوصفها «توفّر» على القاعدة",
    "addCondition": "إضافة شرط",
    "connection": "الاتصال"
  },
  "sched": {
    "interval": "فاصل زمني",
    "daily": "يوميًا",
    "weekly": "أسبوعيًا",
    "monthly": "شهريًا"
  },
  "email": {
    "template": "القالب",
    "to": "إلى",
    "toField": "البريد الإلكتروني لهذا السجل",
    "toFixed": "العناوين",
    "column": "العمود",
    "addresses": "أضف عنوانًا…"
  },
  "notif": {
    "to": "إرسال إلى",
    "roles": "كل من لديه دور",
    "users": "أشخاص محددون",
    "title": "العنوان",
    "body": "الرسالة"
  },
  "rec": {
    "table": "الجدول",
    "values": "القيم",
    "addValue": "إضافة قيمة",
    "column": "العمود",
    "value": "القيمة",
    "now": "الآن",
    "remove": "إزالة هذه القيمة",
    "tokenHint": "استخدم {token} لأخذ القيمة من السجل"
  },
  "hook": {
    "url": "العنوان",
    "method": "الطريقة",
    "body": "المحتوى",
    "bodyJson": "JSON (الحدث، القاعدة، السجل)",
    "bodyText": "نص مخصّص",
    "header": "الترويسة",
    "headerName": "الاسم",
    "headerValue": "القيمة",
    "slackUrl": "عنوان Webhook الخاص بـ Slack",
    "slackText": "الرسالة"
  },
  "wait": {
    "for": "انتظر",
    "max": "حتى ٣٠ يومًا",
    "amount": "المقدار",
    "unit": "الوحدة"
  },
  "modal": {
    "title": "قاعدة جديدة",
    "subtitle": "شغّل سير العمل تلقائيًا عندما يحدث شيء ما.",
    "name": "اسم القاعدة",
    "namePlaceholder": "مثال: الترحيب بالمشتركين الجدد",
    "when": "عندما (المُشغِّل)",
    "then": "عندها (الإجراء)",
    "enable": "تفعيل فورًا",
    "enableBody": "تبدأ بالعمل فور إنشاء القاعدة",
    "cancel": "إلغاء",
    "create": "إنشاء القاعدة",
    "doneTitle": "تم إنشاء القاعدة",
    "doneBody": "قاعدتك مفعَّلة وستعمل في المرة القادمة التي تُشغَّل فيها.",
    "savedTitle": "تم حفظ القاعدة",
    "savedBody": "أكمل خطواتها ثم فعّلها.",
    "done": "تم",
    "trigger": {
      "created": "يتم إنشاء سجل في {table}",
      "updated": "يتم تحديث سجل في {table}",
      "deleted": "يتم حذف سجل في {table}",
      "schedule": "وفق جدول زمني"
    },
    "connection": "{connection} · {table}"
  },
  "logs": {
    "title": "سجلات سير العمل",
    "subtitle": "سجل تنفيذ عمليات الأتمتة لديك.",
    "refresh": "تحديث",
    "kpi": {
      "runsToday": "عمليات التشغيل اليوم",
      "success": "معدّل النجاح",
      "failed": "فاشلة",
      "avgDuration": "متوسط المدة"
    },
    "filter": {
      "all": "الكل",
      "success": "ناجحة",
      "failed": "فاشلة",
      "running": "قيد التشغيل"
    },
    "status": {
      "success": "ناجحة",
      "failed": "فاشلة",
      "running": "قيد التشغيل",
      "pending": "تبدأ {when}",
      "waiting": "في الانتظار · تستأنف {when}",
      "skipped": "متخطّاة",
      "cancelled": "ملغاة"
    },
    "trigger": "المُشغِّل",
    "duration": "المدة",
    "started": "بدأت",
    "trace": "أثر التنفيذ",
    "loadOlder": "تحميل الأقدم",
    "empty": {
      "title": "لا توجد عمليات تشغيل بعد",
      "filtered": "لا توجد عمليات تشغيل «{status}» خلال آخر ٧ أيام"
    },
    "select": "اختر عملية تشغيل لعرض أثرها",
    "justNow": "الآن"
  },
  "trace": {
    "trigger": "السجل = {label} · {summary}",
    "scheduleTick": "نبضة · {stamp}",
    "evaluated": "التقييم ← {result}",
    "stopped": "التقييم ← false · توقّف",
    "branch": "سلك «{label}»",
    "wait": "يستأنف {stamp}",
    "wouldWait": "سينتظر {duration}",
    "email": {
      "ok": "{smtp} · تم التسليم إلى {to}",
      "fail": "خطأ · {reason}",
      "would": "سيرسل «{subject}» إلى {to}",
      "noSmtp": "لم يتم إعداد SMTP — الإعدادات ← البريد الإلكتروني",
      "noRecipient": "لا يوجد مستلم: {column} فارغ"
    },
    "notif": {
      "ok": "تم إشعار {count, plural, zero {# شخص} one {شخص واحد} two {شخصان} few {# أشخاص} many {# شخصًا} other {# شخص}}"
    },
    "create": {
      "ok": "تم إنشاء {label}"
    },
    "update": {
      "ok": "تم تعيين {pairs}"
    },
    "write": {
      "would": "سيعيّن {pairs}"
    },
    "hook": {
      "ok": "{method} {path} ← {status} · {ms} م.ث",
      "fail": "{method} {path} ← {status}",
      "would": "سينفّذ {method} {url}"
    },
    "stop": "توقّف هنا",
    "undone": "تم التراجع عنه قبل تشغيله",
    "gone": "لم يعد السجل موجودًا",
    "ruleOff": "أُوقفت القاعدة أثناء الانتظار",
    "skipped": "—"
  },
  "dur": {
    "ms": "{ms} م.ث",
    "s": "{s} ث",
    "none": "—"
  },
  "saved": {
    "h": "{h} س",
    "m": "{m} د"
  }
} as const;
