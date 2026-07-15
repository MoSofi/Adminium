/**
 * GENERATED MIRROR of ../../../locales/ar-EG/ui.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "close": "إغلاق",
    "cancel": "إلغاء",
    "confirm": "تأكيد",
    "save": "حفظ",
    "apply": "تطبيق",
    "delete": "حذف",
    "edit": "تعديل",
    "copy": "نسخ",
    "copied": "تم النسخ",
    "undo": "تراجع",
    "retry": "إعادة المحاولة",
    "clear": "مسح",
    "selectAll": "تحديد الكل",
    "clearSelection": "إلغاء التحديد",
    "showPassword": "إظهار كلمة المرور",
    "hidePassword": "إخفاء كلمة المرور",
    "reveal": "كشف",
    "hide": "إخفاء"
  },
  "state": {
    "loading": "جارٍ التحميل…",
    "empty": "لا يوجد شيء هنا بعد",
    "noResults": "لا توجد نتائج",
    "optional": "اختياري",
    "required": "مطلوب",
    "error": "حدث خطأ ما"
  },
  "pagination": {
    "previous": "السابق",
    "next": "التالي",
    "pageOf": "صفحة {page, number} من {pages, number}",
    "rowsPerPage": "عدد الصفوف في الصفحة",
    "range": "{from, number}–{to, number} من {total, number}"
  },
  "table": {
    "sortAscending": "ترتيب تصاعدي",
    "sortDescending": "ترتيب تنازلي",
    "rowActions": "إجراءات الصف",
    "selectRow": "تحديد الصف",
    "selectAllRows": "تحديد كل الصفوف"
  },
  "dialog": {
    "close": "إغلاق مربع الحوار",
    "confirmTitle": "هل أنت متأكد؟"
  },
  "combobox": {
    "placeholder": "اختر…",
    "search": "بحث…",
    "noMatches": "لا توجد مطابقات"
  },
  "toast": {
    "dismiss": "إغلاق الإشعار"
  },
  "widgets": {
    "charts": {
      "boxplot": {
        "description": "ملخّص صندوقي لتوزّع عمود رقمي حسب الفئة — الأدنى والأرباع والوسيط والأعلى.",
        "emptyTitle": "لا يوجد توزيع للعرض",
        "emptyBody": "لا توجد صفوف مطابقة للمرشّحات لعرضها كمخططات صندوقية."
      },
      "violin": {
        "description": "منحنيات كثافة متماثلة تقارن توزّع عمود رقمي عبر المجموعات.",
        "emptyTitle": "لا يوجد توزيع للعرض",
        "emptyBody": "لا توجد صفوف مطابقة للمرشّحات لبناء ملامح الكثافة."
      },
      "ridgeline": {
        "description": "حِيود كثافة متداخلة تقارن عمودًا رقميًا عبر مجموعات مرتّبة.",
        "emptyTitle": "لا توجد حِيود للعرض",
        "emptyBody": "لا توجد صفوف مطابقة للمرشّحات لبناء ملامح الكثافة."
      },
      "scatterBubble": {
        "description": "عمودان رقميان كنقاط، مع حجم فقاعة اختياري وخط اتجاه.",
        "emptyTitle": "لا توجد نقاط للعرض",
        "emptyBody": "لا توجد صفوف مطابقة للمرشّحات للأعمدة المحددة."
      },
      "hexbin": {
        "description": "كثافة سداسية لعمودين رقميين، مُلوّنة حسب عدد الصفوف في كل خلية.",
        "emptyTitle": "لا توجد كثافة للعرض",
        "emptyBody": "لا توجد صفوف مطابقة للمرشّحات للتجميع."
      },
      "correlationMatrix": {
        "description": "ارتباط بيرسون بين الأعمدة الرقمية المحددة، من موجب قوي إلى سالب قوي.",
        "emptyTitle": "لا شيء لحساب ارتباطه",
        "emptyBody": "اختر عمودين رقميين على الأقل بصفوف متطابقة."
      },
      "parallelCoordinates": {
        "description": "كل سجل كخط عبر عدّة محاور رقمية مُطبّعة، مُلوّن حسب الفئة.",
        "emptyTitle": "لا توجد سجلات للعرض",
        "emptyBody": "لا توجد صفوف مطابقة للمرشّحات عبر المحاور المحددة."
      }
    },
    "feeds": {
      "activityFeed": {
        "description": "سِجلّ متواصل لمن فعل ماذا في مساحة عملك، الأحدث أولًا.",
        "emptyTitle": "لا يوجد نشاط حديث",
        "emptyBody": "ستظهر الإجراءات في مساحة عملك هنا."
      },
      "notificationFeed": {
        "description": "إشعارات مجمَّعة بحالة غير مقروء ومرشِّحات وإجراءات مضمَّنة.",
        "emptyTitle": "لا توجد إشعارات",
        "emptyBody": "ستظهر الإشعارات الجديدة هنا."
      },
      "realtimeFeed": {
        "description": "بثّ مباشر للأحداث يضيف العناصر الجديدة في الأعلى فور وصولها.",
        "emptyTitle": "في انتظار الأحداث",
        "emptyBody": "ستظهر الأحداث المباشرة فور حدوثها."
      },
      "timelineVertical": {
        "description": "خطّ زمني رأسي للأحداث أو الإصدارات أو الأعطال أو خطوات التنفيذ.",
        "emptyTitle": "لا شيء هنا بعد",
        "emptyBody": "ستظهر الأحداث على هذا الخطّ الزمني فور حدوثها."
      },
      "unreadBadge": {
        "description": "شارة عدّ للعناصر غير المقروءة، متزامنة مع حالة السِّجل.",
        "unitLabel": "غير مقروء"
      }
    },
    "calendar": {
      "calendarMonth": {
        "description": "شبكة شهرية للأحداث المجدولة مع شارات لكل يوم وتنقل بين الأشهر.",
        "emptyTitle": "لا يوجد شيء مجدول",
        "emptyBody": "ستظهر الأحداث المجدولة في هذا التقويم."
      },
      "dayAgenda": {
        "description": "أحداث اليوم المحدد كجدول أعمال مرتب زمنيًا.",
        "emptyTitle": "لا يوجد شيء مجدول",
        "emptyBody": "ستظهر أحداث اليوم المحدد هنا."
      },
      "scheduleMatrix": {
        "description": "شبكة ورديات حسب المورد واليوم مع تغطية يومية ومفتاح توضيحي.",
        "emptyTitle": "لا توجد ورديات مجدولة",
        "emptyBody": "ستظهر الورديات المخصصة في هذا الجدول."
      },
      "capacityBoard": {
        "description": "أشرطة استخدام لكل عضو مع تفصيل المشاريع وحالة الحِمل.",
        "emptyTitle": "لا توجد بيانات عبء عمل",
        "emptyBody": "سيظهر استخدام الأعضاء هنا بمجرد وجود تخصيصات."
      }
    },
    "tables": {
      "masterList": {
        "description": "قائمة قابلة للتحديد من السجلات تتحكّم في لوحة التفاصيل.",
        "emptyTitle": "لا توجد عناصر",
        "emptyBody": "ستظهر العناصر هنا بمجرد وجودها."
      },
      "logTable": {
        "description": "سِجلّ أحداث بالبحث ومرشِّح الأخطاء وإجراءات الصفوف.",
        "emptyTitle": "لا توجد مُدخلات سِجل",
        "emptyBody": "ستُسجَّل الأحداث هنا فور حدوثها."
      },
      "cardGallery": {
        "description": "معرض متجاوب لبطاقات الكيانات بالحالة والإجراءات السريعة.",
        "emptyTitle": "لا شيء لعرضه",
        "emptyBody": "ستظهر العناصر هنا كبطاقات."
      },
      "groupedSummaryTable": {
        "description": "صفوف مجمَّعة بأعمدة تجميعية وتفاصيل قابلة للتوسيع ومجاميع.",
        "emptyTitle": "لا توجد بيانات ملخَّصة",
        "emptyBody": "ستظهر المجاميع المجمَّعة هنا بمجرد توفّر البيانات."
      },
      "schemaTree": {
        "description": "مستكشف للمخططات والجداول والأعمدة بشارات الأنواع والمفاتيح.",
        "emptyTitle": "لم يُقرأ أي مخطط",
        "emptyBody": "اربط قاعدة بيانات لاستكشاف مخططها هنا."
      },
      "toggleMatrix": {
        "description": "شبكة تفاعلية من المفاتيح المنطقية للأدوار أو السياسات أو القنوات.",
        "emptyTitle": "لم تُهيَّأ أي مصفوفة",
        "emptyBody": "ستظهر الصفوف والأعمدة هنا بعد التهيئة."
      }
    },
    "boards": {
      "kanbanBoard": {
        "description": "أعمدة حالة ثابتة تحتوي على بطاقات قابلة للسحب؛ اسحب بطاقة إلى عمود آخر لتحديث حالتها.",
        "emptyTitle": "لا توجد بطاقات بعد",
        "emptyBody": "ستظهر البطاقات في أعمدة الحالة الخاصة بها عند إنشاء السجلات."
      },
      "kanbanSwimlaneGrid": {
        "description": "شبكة مسارات × أعمدة؛ سحب بطاقة يعيد تعيين مسارها وحالتها معًا.",
        "emptyTitle": "لا توجد مسارات للعرض",
        "emptyBody": "جمّع السجلات حسب حقل المسار وحقل الحالة لبناء الشبكة."
      },
      "addCard": "إضافة بطاقة",
      "grip": "اسحب لتحريك البطاقة",
      "pointsUnit": "نقطة",
      "laneSummary": "Σ{points} نقطة · {count}",
      "a11y": {
        "grabbed": "تم التقاط {title}. استخدم مفاتيح الأسهم للتحريك، وEnter للإفلات، وEscape للإلغاء.",
        "over": "{title} فوق {cell}.",
        "moved": "تم نقل {title} إلى {cell}.",
        "returned": "عادت {title} إلى موضعها الأصلي.",
        "failed": "تعذّر نقل {title}؛ فعادت إلى موضعها الأصلي."
      }
    }
  },
  "grid": {
    "dragHandle": "اسحب لنقل {title}",
    "resizeHandle": "تغيير حجم {title}",
    "a11y": {
      "grabbed": "تم التقاط {title}. استخدم مفاتيح الأسهم للنقل، واضغط باستمرار على Shift لتغيير الحجم، وEnter للحفظ، وEscape للإلغاء.",
      "moved": "تم نقل {title} إلى العمود {col}، الصف {row}.",
      "resized": "تم تغيير حجم {title} إلى {w} أعمدة في {h} صفوف.",
      "committed": "تم وضع {title} في العمود {col}، الصف {row}.",
      "reverted": "تمت إعادة {title} إلى موضعه الأصلي."
    }
  }
} as const;
