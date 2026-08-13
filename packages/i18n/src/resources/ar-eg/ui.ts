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
    "hide": "إخفاء",
    "clearSearch": "مسح البحث"
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
    "kpi": {
      "statCard": {
        "description": "بطاقة المقياس الأساسية: قيمة مجمّعة رئيسية مع شارة اتجاه ورسم بياني مصغّر اختياريين."
      },
      "usageMeter": {
        "description": "استهلاك الحصة مقابل حد أقصى؛ يتحوّل الشريط إلى البرتقالي ثم الأحمر بعد تجاوز عتباتك.",
        "usageLabel": "الاستخدام",
        "ofLabel": "من"
      },
      "statTileCompact": {
        "description": "مربع مقياس نحيف بعنوان مصغّر وشارة اتجاه ورسم من 6 أعمدة — لصفوف كثيفة من 4 إلى 6."
      },
      "metricHero": {
        "description": "مقياس واحد بحجم كبير يتصاعد عند التحميل، مع شارة اتجاه ورسم مصغّر وتقدّم نحو الهدف.",
        "goalLabel": "الهدف"
      },
      "statPairCard": {
        "description": "مقياسان جنبًا إلى جنب؛ يمكن اشتقاق الثاني من الأول."
      },
      "gaugeRing": {
        "description": "مؤشر حلقي لدرجة أو نسبة مئوية، ملوّن حسب النطاق الذي تقع فيه القيمة."
      },
      "gaugeArc": {
        "description": "قوس عدّاد بنطاقات وصفية ومؤشر؛ ويعرض أيضًا شبكة من المؤشرات.",
        "emptyTitle": "لا توجد مؤشرات للعرض",
        "emptyBody": "تظهر الخدمات هنا كمؤشرات بمجرد توفّر قراءة لها."
      },
      "periodComparison": {
        "description": "هذه الفترة مقابل السابقة في شريطين، مع حساب الفارق أسفلهما.",
        "higherLabel": "أعلى",
        "lowerLabel": "أقل",
        "flatLabel": "دون تغيير",
        "periodALabel": "هذه الفترة",
        "periodBLabel": "الفترة السابقة"
      },
      "microKpiSubtitle": {
        "description": "إحصاء من سطر واحد في الترويسة، مبني على قالب ويُعاد حسابه من الحالة الحيّة."
      },
      "autoInsights": {
        "description": "ملاحظات مرتّبة حسب الأهمية — رقم رئيسي وجملة ورسم مصغّر — مع تدوير عند التحديث.",
        "emptyTitle": "لا توجد ملاحظات بعد",
        "emptyBody": "تظهر الملاحظات بمجرد توفّر بيانات كافية لرصد نمط.",
        "refreshLabel": "تحديث"
      }
    },
    "charts": {
      "boxplot": {
        "description": "ملخّص صندوقي لتوزّع عمود رقمي حسب الفئة — الأدنى والأرباع والوسيط والأعلى.",
        "emptyTitle": "لا يوجد توزيع للعرض",
        "emptyBody": "لا توجد صفوف مطابقة للمرشّحات لعرضها كمخططات صندوقية.",
        "chartLabel": "مخطط صندوقي"
      },
      "violin": {
        "description": "منحنيات كثافة متماثلة تقارن توزّع عمود رقمي عبر المجموعات.",
        "emptyTitle": "لا يوجد توزيع للعرض",
        "emptyBody": "لا توجد صفوف مطابقة للمرشّحات لبناء ملامح الكثافة.",
        "chartLabel": "مخطط كماني"
      },
      "ridgeline": {
        "description": "حِيود كثافة متداخلة تقارن عمودًا رقميًا عبر مجموعات مرتّبة.",
        "emptyTitle": "لا توجد حِيود للعرض",
        "emptyBody": "لا توجد صفوف مطابقة للمرشّحات لبناء ملامح الكثافة.",
        "chartLabel": "مخطط حِيود"
      },
      "scatterBubble": {
        "description": "عمودان رقميان كنقاط، مع حجم فقاعة اختياري وخط اتجاه.",
        "emptyTitle": "لا توجد نقاط للعرض",
        "emptyBody": "لا توجد صفوف مطابقة للمرشّحات للأعمدة المحددة.",
        "chartLabel": "مخطط انتشار"
      },
      "hexbin": {
        "description": "كثافة سداسية لعمودين رقميين، مُلوّنة حسب عدد الصفوف في كل خلية.",
        "emptyTitle": "لا توجد كثافة للعرض",
        "emptyBody": "لا توجد صفوف مطابقة للمرشّحات للتجميع.",
        "chartLabel": "كثافة سداسية"
      },
      "correlationMatrix": {
        "description": "ارتباط بيرسون بين الأعمدة الرقمية المحددة، من موجب قوي إلى سالب قوي.",
        "emptyTitle": "لا شيء لحساب ارتباطه",
        "emptyBody": "اختر عمودين رقميين على الأقل بصفوف متطابقة.",
        "chartLabel": "مصفوفة ارتباط"
      },
      "parallelCoordinates": {
        "description": "كل سجل كخط عبر عدّة محاور رقمية مُطبّعة، مُلوّن حسب الفئة.",
        "emptyTitle": "لا توجد سجلات للعرض",
        "emptyBody": "لا توجد صفوف مطابقة للمرشّحات عبر المحاور المحددة.",
        "chartLabel": "إحداثيات متوازية"
      },
      "unexpectedShape": "شكل بيانات غير متوقّع.",
      "lineArea": {
        "chartLabel": "مخطط خطي",
        "description": "مقياس عبر الزمن كخط مع تعبئة خفيفة للمساحة، مع مقارنة اختيارية متقطّعة بالفترة السابقة."
      },
      "bar": {
        "chartLabel": "مخطط أعمدة",
        "description": "قيم حسب الفئة أو حسب فترات زمنية كأعمدة رأسية، مع إبراز اختياري لأكبر عمود أو للعمود الحالي."
      },
      "donut": {
        "chartLabel": "مخطط حلقي",
        "otherLabel": "أخرى",
        "description": "حصص الفئات كشرائح حلقية مع مفتاح توضيحي وإجمالي في المنتصف، مع ضمّ الشرائح الصغيرة في فئة «أخرى»."
      },
      "bullet": {
        "chartLabel": "مخطط رصاصي",
        "description": "التقدّم نحو هدف كشريط قياس فوق نطاقات وصفية، مع علامة هدف لكل صف.",
        "emptyTitle": "لا توجد أهداف للتتبّع",
        "emptyBody": "أضف مقاييس لها أهداف للمقارنة بها."
      },
      "rankingBars": {
        "chartLabel": "الترتيب",
        "description": "ترتيب لأعلى العناصر كأشرطة أفقية — المتصدّر بلون كامل والبقية باهتة — مع القيم إلى جانبها.",
        "emptyTitle": "لا يوجد ما يُرتَّب",
        "emptyBody": "لا توجد سجلات مطابقة لهذا التفصيل بعد."
      },
      "pareto": {
        "chartLabel": "مخطط باريتو",
        "description": "أعمدة فئات مرتّبة تحت خط النسبة التراكمية، مع خط قطع اختياري عند 80%.",
        "emptyTitle": "لا توجد فئات للرسم",
        "emptyBody": "لم تُعَد أي أعداد مجمَّعة لهذا النطاق."
      },
      "waterfall": {
        "chartLabel": "مخطط شلالي",
        "description": "جسر من أعمدة عائمة يبدأ من إجمالي أولي ويمرّ بخطوات موجبة وسالبة حتى الإجمالي الصافي.",
        "emptyTitle": "لا توجد حركة للربط",
        "emptyBody": "لم يُعثر على خطوات بداية أو تغيّر أو إجمالي."
      },
      "marimekko": {
        "chartLabel": "مخطط ماريميكو",
        "description": "مزيج من مستويين كأعمدة مكدَّسة متغيّرة العرض — العرض للحصة الخارجية والأجزاء للتقسيم الداخلي.",
        "emptyTitle": "لا يوجد مزيج للتفصيل",
        "emptyBody": "لم يُعَد أي تفصيل من مستويين لهذا النطاق."
      },
      "stackedBar100": {
        "chartLabel": "شريط مكدَّس 100%",
        "description": "شريط واحد بنسبة 100% مقسَّم إلى أجزاء متناسبة مع مفتاح توضيحي، لمقارنة الحصص من الكل.",
        "emptyTitle": "لا توجد حصص للتقسيم",
        "emptyBody": "لم تُعَد أي أجزاء لهذا التفصيل."
      },
      "slope": {
        "chartLabel": "مخطط ميل",
        "description": "فترتان يربط بينهما خط لكل سجل، ملوَّن حسب ارتفاع القيمة أو انخفاضها.",
        "emptyTitle": "لا يوجد تغيّر بين الفترتين للعرض",
        "emptyBody": "لم تُعَد قيم قبل/بعد للمقارنة."
      },
      "multiline": {
        "chartLabel": "مخطط متعدد الخطوط",
        "description": "عدّة سلاسل كخطوط متراكبة مع تسميات في نهاياتها، لمقارنة الاتجاهات خلال المدى الزمني نفسه.",
        "emptyTitle": "لا توجد سلاسل للرسم",
        "emptyBody": "لا توجد سلاسل زمنية مطابقة للمرشّحات في هذا النطاق."
      },
      "stream": {
        "chartLabel": "مخطط تدفّق",
        "description": "نطاقات مكدَّسة تتدفّق حول خط مركزي، تُظهر كيف يتغيّر تكوين الإجمالي عبر الزمن.",
        "emptyTitle": "لا يوجد تدفّق للرسم",
        "emptyBody": "لم تُعَد أي سلاسل مكدَّسة لهذا النطاق."
      },
      "forecast": {
        "chartLabel": "مخطط تنبّؤ",
        "nowLabel": "الآن",
        "forecastLabel": "التنبّؤ",
        "actualLabel": "الفعلي",
        "description": "خط تاريخي يمتد بإسقاط متقطّع داخل نطاق ثقة يتّسع تدريجيًا، يفصله فاصل عند اللحظة الحالية.",
        "emptyTitle": "لا يوجد تاريخ للإسقاط",
        "emptyBody": "لم تُعَد أي نقاط سابقة للتنبّؤ منها."
      },
      "anomaly": {
        "chartLabel": "مخطط الشذوذ",
        "description": "خط القيمة فوق نطاقها المتوقَّع، مع تمييز النقاط الخارجة عنه بنقاط محاطة بهالة.",
        "emptyTitle": "لا توجد إشارة للفحص",
        "emptyBody": "لم تُعَد أي نقاط لفحص الشذوذ فيها."
      },
      "candlestick": {
        "chartLabel": "مخطط شموع",
        "livePillLabel": "مباشر",
        "description": "شموع الافتتاح والأعلى والأدنى والإغلاق ملوَّنة حسب الاتجاه، مع خط متقطّع لآخر سعر وشارة «مباشر» اختيارية.",
        "emptyTitle": "لا توجد شموع للرسم",
        "emptyBody": "لا توجد صفوف افتتاح وأعلى وأدنى وإغلاق مطابقة لهذا النطاق."
      },
      "bump": {
        "chartLabel": "مخطط تبدّل المراكز",
        "description": "خطوط ترتيب عبر الزمن تُظهر كيف يتبادل المتنافسون المراكز بين الفترات.",
        "emptyTitle": "لا توجد مراتب للتتبّع",
        "emptyBody": "لم تُعَد أي ترتيبات من فترة إلى أخرى."
      },
      "timelineLanes": {
        "chartLabel": "مسارات زمنية",
        "laneLabel": "الأحداث",
        "description": "أحداث مؤرَّخة كشرائح على مسارات أفقية تتشارك محورًا زمنيًا واحدًا.",
        "emptyTitle": "لا توجد أحداث للعرض",
        "emptyBody": "لا توجد أحداث مطابقة للمرشّحات في هذا النطاق."
      },
      "treemap": {
        "chartLabel": "خريطة شجرية",
        "otherLabel": "أخرى",
        "description": "تفصيل الجزء من الكل كمربعات يتناسب حجمها مع القيمة، مع ضمّ الشرائح الصغيرة في مربّع «أخرى».",
        "emptyTitle": "لا توجد شرائح للعرض",
        "emptyBody": "لم تُعَد أي فئات لهذا التفصيل."
      },
      "sunburst": {
        "chartLabel": "مخطط شعاعي",
        "description": "تسلسل هرمي من مستويين كحلقات متداخلة — الآباء في الداخل والأبناء في الخارج — مع مفتاح توضيحي للآباء.",
        "emptyTitle": "لا توجد حلقات للرسم",
        "emptyBody": "لم تُعَد أي فئات مجمَّعة للتداخل."
      },
      "funnel": {
        "chartLabel": "قمع",
        "description": "مراحل مرتّبة تتناقص تدريجيًا مع معدّل الاستمرار لكل خطوة وتذييل بإجمالي التحويل.",
        "emptyTitle": "لا توجد مراحل للقمع",
        "emptyBody": "لم تُعَد أي أعداد خطوات لهذا النطاق."
      },
      "radialBar": {
        "chartLabel": "أشرطة دائرية",
        "description": "حتى أربع نسب مئوية كحلقات تقدّم متحدة المركز مع مفتاح توضيحي بالنقاط.",
        "emptyTitle": "لا توجد حلقات للتعبئة",
        "emptyBody": "لا توجد فئات مطابقة لهذا التفصيل بعد."
      },
      "radar": {
        "chartLabel": "رادار",
        "description": "عدّة محاور مسمّاة على مضلّع مع شكل معبّأ لكل سلسلة، مقابل طبقة هدف اختيارية.",
        "emptyTitle": "لا توجد محاور للمقارنة",
        "emptyBody": "لم تُعَد أي مصفوفة من السلاسل والمحاور."
      },
      "chord": {
        "chartLabel": "مخطط وتري",
        "description": "تدفّقات ثنائية كأشرطة بين عُقد على حلقة، وتزداد عتامة الشريط بحجم التدفّق.",
        "emptyTitle": "لا توجد تدفّقات للربط",
        "emptyBody": "لم تُعَد أي صلات بين المجموعات."
      },
      "wordcloud": {
        "chartLabel": "سحابة كلمات",
        "description": "مصطلحات يتناسب حجمها مع تكرارها ومرتّبة في صفوف، لعرض سريع لما يتصدّر.",
        "emptyTitle": "لا توجد مصطلحات للعرض",
        "emptyBody": "لا توجد مصطلحات موزونة مطابقة للمرشّحات."
      },
      "cohortMatrix": {
        "chartLabel": "احتفاظ الأفواج",
        "description": "صفوف الأفواج مقابل أعمدة الفترات، وتُظلَّل كل خلية حسب الاحتفاظ أو الإيراد."
      },
      "heatmapCalendar": {
        "chartLabel": "تقويم النشاط",
        "legendLessLabel": "أقل",
        "legendMoreLabel": "أكثر",
        "description": "سنة من النشاط اليومي كشبكة أسابيع وأيام مظلَّلة حسب الكثافة."
      },
      "heatMonth": {
        "chartLabel": "النشاط الشهري",
        "description": "شهر تقويمي واحد كشبكة أيام مظلَّلة حسب قيمة كل يوم."
      },
      "choroplethGrid": {
        "chartLabel": "التفصيل حسب المنطقة",
        "legendLowLabel": "منخفض",
        "legendHighLabel": "مرتفع",
        "description": "قيم المناطق كخريطة مربّعات ملوَّنة للولايات المتحدة أو كشبكة مدمجة، مع قائمة ترتيب اختيارية لأعلى العناصر."
      },
      "sankey": {
        "chartLabel": "التدفّق",
        "description": "تدفّقات متدرّجة من المصدر إلى الهدف كأشرطة يعبّر سُمكها عن الحجم."
      },
      "sparkline": {
        "description": "اتجاه مصغّر مضمَّن للقيم الأخيرة — بلا محاور أو تسميات — لبطاقات المؤشرات وخلايا الجداول وصفوف القوائم."
      }
    },
    "feeds": {
      "activityFeed": {
        "description": "سِجلّ متواصل لمن فعل ماذا في مساحة عملك، الأحدث أولًا.",
        "emptyTitle": "لا يوجد نشاط حديث",
        "emptyBody": "ستظهر الإجراءات في مساحة عملك هنا.",
        "viewAllLabel": "عرض الكل"
      },
      "notificationFeed": {
        "description": "إشعارات مجمَّعة بحالة غير مقروء ومرشِّحات وإجراءات مضمَّنة.",
        "emptyTitle": "لا توجد إشعارات",
        "emptyBody": "ستظهر الإشعارات الجديدة هنا.",
        "allLabel": "الكل",
        "unreadLabel": "غير مقروء",
        "mentionsLabel": "الإشارات",
        "filterLabel": "مرشِّح الإشعارات",
        "markAllReadLabel": "تعليم الكل كمقروء",
        "todayLabel": "اليوم",
        "yesterdayLabel": "أمس",
        "earlierLabel": "أقدم",
        "dismissLabel": "إغلاق",
        "emptyUnreadTitle": "لقد أنجزت كل شيء",
        "emptyMentionsTitle": "لا توجد إشارات"
      },
      "realtimeFeed": {
        "description": "بثّ مباشر للأحداث يضيف العناصر الجديدة في الأعلى فور وصولها.",
        "emptyTitle": "في انتظار الأحداث",
        "emptyBody": "ستظهر الأحداث المباشرة فور حدوثها.",
        "liveLabel": "مباشر",
        "pausedLabel": "متوقّف مؤقتًا",
        "pauseLabel": "إيقاف مؤقت",
        "resumeLabel": "استئناف"
      },
      "timelineVertical": {
        "description": "خطّ زمني رأسي للأحداث أو الإصدارات أو الأعطال أو خطوات التنفيذ.",
        "emptyTitle": "لا شيء هنا بعد",
        "emptyBody": "ستظهر الأحداث على هذا الخطّ الزمني فور حدوثها."
      },
      "unreadBadge": {
        "description": "شارة عدّ للعناصر غير المقروءة، متزامنة مع حالة السِّجل.",
        "unitLabel": "غير مقروء"
      },
      "loadOlderPaginator": {
        "description": "زر في التذييل يحمّل السجلات الأقدم على دفعات حتى تنفد التغذية.",
        "label": "تحميل الأقدم",
        "loadingLabel": "جارٍ التحميل…",
        "exhaustedLabel": "لا يوجد أقدم",
        "ofLabel": "من"
      },
      "toastStack": {
        "description": "مضيف التنبيهات المنبثقة: تأكيدات قصيرة مع خيار تراجع.",
        "undoLabel": "تراجع",
        "dismissLabel": "إغلاق",
        "regionLabel": "الإشعارات"
      }
    },
    "calendar": {
      "calendarMonth": {
        "description": "شبكة شهرية للأحداث المجدولة مع شارات لكل يوم وتنقل بين الأشهر.",
        "emptyTitle": "لا يوجد شيء مجدول",
        "emptyBody": "ستظهر الأحداث المجدولة في هذا التقويم.",
        "previousLabel": "الشهر السابق",
        "nextLabel": "الشهر التالي",
        "overflowLabel": "+{count} أخرى"
      },
      "dayAgenda": {
        "description": "أحداث اليوم المحدد كجدول أعمال مرتب زمنيًا.",
        "emptyTitle": "لا يوجد شيء مجدول",
        "emptyBody": "ستظهر أحداث اليوم المحدد هنا.",
        "countLabel": "{count, plural, zero {لا أحداث} one {حدث واحد} two {حدثان} few {{n} أحداث} many {{n} حدثًا} other {{n} حدث}}"
      },
      "scheduleMatrix": {
        "description": "شبكة ورديات حسب المورد واليوم مع تغطية يومية ومفتاح توضيحي.",
        "emptyTitle": "لا توجد ورديات مجدولة",
        "emptyBody": "ستظهر الورديات المخصصة في هذا الجدول.",
        "resourceLabel": "المورد",
        "coverageLabel": "التغطية",
        "hoursLabel": "{hours} س"
      },
      "capacityBoard": {
        "description": "أشرطة استخدام لكل عضو مع تفصيل المشاريع وحالة الحِمل.",
        "emptyTitle": "لا توجد بيانات عبء عمل",
        "emptyBody": "سيظهر استخدام الأعضاء هنا بمجرد وجود تخصيصات.",
        "status": {
          "overloaded": "زائد الحِمل",
          "balanced": "متوازن",
          "available": "متاح"
        },
        "utilizationLabel": "{name}: {util}%",
        "assignmentLabel": "{project} · {hours} س",
        "periodLabel": "س · {period}",
        "period": {
          "week": "أسبوعيًا",
          "month": "شهريًا"
        }
      },
      "calendarLegendFilter": {
        "description": "فئات الأحداث مع أعدادها؛ التبديل يصفّي التقويم المجاور.",
        "emptyTitle": "لا توجد فئات بعد",
        "emptyBody": "ستظهر فئات الأحداث هنا بمجرد وجود أحداث.",
        "uncategorizedLabel": "بدون فئة"
      },
      "upcomingEventsList": {
        "description": "الأحداث القادمة مرتّبة حسب التاريخ، مع المسؤول والحالة.",
        "emptyTitle": "لا يوجد شيء قادم",
        "emptyBody": "ستظهر الأحداث المجدولة هنا عند التخطيط لها."
      },
      "dateRangePicker": {
        "description": "نطاق تاريخ مع اختيارات سريعة يصفّي بقية الصفحة.",
        "previousLabel": "الشهر السابق",
        "nextLabel": "الشهر التالي",
        "summaryLabel": "تم اختيار {n} يوم",
        "presets": {
          "7d": "آخر 7 أيام",
          "30d": "آخر 30 يومًا",
          "90d": "آخر 90 يومًا",
          "mtd": "الشهر حتى تاريخه",
          "qtd": "الربع حتى تاريخه",
          "ytd": "السنة حتى تاريخها"
        }
      },
      "scheduledJobsList": {
        "description": "التقارير وعمليات التصدير المتكررة مع التكرار وموعد التشغيل التالي ومفتاح تشغيل/إيقاف.",
        "emptyTitle": "لا توجد مهام مجدولة",
        "emptyBody": "ستظهر التقارير وعمليات التصدير المتكررة هنا بمجرد جدولتها.",
        "nextRunLabel": "التشغيل التالي",
        "toggleLabel": "تفعيل الجدولة",
        "recipientsLabel": "المستلمون"
      }
    },
    "tables": {
      "masterList": {
        "description": "قائمة قابلة للتحديد من السجلات تتحكّم في لوحة التفاصيل.",
        "emptyTitle": "لا توجد عناصر",
        "emptyBody": "ستظهر العناصر هنا بمجرد وجودها.",
        "allLabel": "الكل",
        "toggleLabel": "تبديل {title}",
        "progressLabel": "تقدّم {title}"
      },
      "logTable": {
        "description": "سِجلّ أحداث بالبحث ومرشِّح الأخطاء وإجراءات الصفوف.",
        "emptyTitle": "لا توجد مُدخلات سِجل",
        "emptyBody": "ستُسجَّل الأحداث هنا فور حدوثها.",
        "liveLabel": "مباشر",
        "placeholder": "ابحث في السجلات…",
        "filterLabel": "مرشِّح السجل",
        "allLabel": "الكل",
        "errorsLabel": "الأخطاء",
        "noMatchesLabel": "لا توجد مُدخلات مطابقة",
        "todayLabel": "اليوم",
        "yesterdayLabel": "أمس",
        "action": {
          "retry": "إعادة المحاولة",
          "download": "تنزيل",
          "inspect": "فحص"
        }
      },
      "cardGallery": {
        "description": "معرض متجاوب لبطاقات الكيانات بالحالة والإجراءات السريعة.",
        "emptyTitle": "لا شيء لعرضه",
        "emptyBody": "ستظهر العناصر هنا كبطاقات."
      },
      "groupedSummaryTable": {
        "description": "صفوف مجمَّعة بأعمدة تجميعية وتفاصيل قابلة للتوسيع ومجاميع.",
        "emptyTitle": "لا توجد بيانات ملخَّصة",
        "emptyBody": "ستظهر المجاميع المجمَّعة هنا بمجرد توفّر البيانات.",
        "groupLabel": "المجموعة",
        "totalsLabel": "الإجمالي"
      },
      "schemaTree": {
        "description": "مستكشف للمخططات والجداول والأعمدة بشارات الأنواع والمفاتيح.",
        "emptyTitle": "لم يُقرأ أي مخطط",
        "emptyBody": "اربط قاعدة بيانات لاستكشاف مخططها هنا.",
        "treeLabel": "المخطط",
        "viewLabel": "عرض"
      },
      "toggleMatrix": {
        "description": "شبكة تفاعلية من المفاتيح المنطقية للأدوار أو السياسات أو القنوات.",
        "emptyTitle": "لم تُهيَّأ أي مصفوفة",
        "emptyBody": "ستظهر الصفوف والأعمدة هنا بعد التهيئة.",
        "matrixLabel": "مصفوفة الصلاحيات",
        "rowHeaderLabel": "الصلاحية"
      },
      "sparklineTable": {
        "description": "صفوف مقاييس بها رسم مصغّر والقيمة الحالية وشارة تغيّر تميّز الاتجاه الجيد من السيئ.",
        "emptyTitle": "لا توجد مقاييس",
        "emptyBody": "ستظهر المقاييس هنا بمجرد توفّر بيانات لتلخيصها."
      },
      "topMoversList": {
        "description": "المقاييس الأكثر تغيّرًا، مع تقييم الاتجاه كجيد أو سيئ لكل مقياس.",
        "emptyTitle": "لا توجد تغيّرات",
        "emptyBody": "ستظهر هنا المقاييس الأكثر تغيّرًا."
      },
      "rankedEntityList": {
        "description": "أعلى العناصر حسب مقياس، مع الترتيب وشريط متناسب.",
        "emptyTitle": "لا يوجد ترتيب بعد",
        "emptyBody": "ستظهر أعلى العناصر هنا بمجرد توفّر بيانات للترتيب."
      },
      "accordionList": {
        "description": "صفوف قابلة للتوسيع بشارة ولوحة تفاصيل، بفتح مفرد أو متعدد.",
        "emptyTitle": "لا يوجد ما يمكن توسيعه",
        "emptyBody": "ستظهر المدخلات هنا بمجرد وجودها."
      },
      "comparisonMatrix": {
        "description": "شبكة ميزات تقارن الخطط، مع إبراز أحد الأعمدة.",
        "includedLabel": "مُتضمَّن",
        "notIncludedLabel": "غير مُتضمَّن",
        "promotedLabel": "موصى به"
      },
      "chipCloud": {
        "description": "شرائح ملتفّة للجداول المكتشفة أو متغيرات الدمج أو الاقتراحات.",
        "emptyTitle": "لم يُكتشف شيء بعد",
        "emptyBody": "ستظهر الجداول والمتغيرات هنا كشرائح بمجرد اكتشافها.",
        "moreLabel": "+{n} أخرى"
      },
      "dataGrid": {
        "selectAllLabel": "تحديد كل الصفوف",
        "selectRowLabel": "تحديد الصف",
        "sortByLabel": "الترتيب حسب {column}",
        "description": "شبكة CRUD الأساسية بأعمدة قابلة للترتيب وتحديد للصفوف وخلايا تراعي نوع البيانات."
      },
      "paginationFooter": {
        "emptyLabel": "0 صف",
        "ofLabel": "من",
        "pageSizeLabel": "الصفوف",
        "a11y": {
          "pageSize": "عدد الصفوف في الصفحة"
        },
        "prevLabel": "الصفحة السابقة",
        "nextLabel": "الصفحة التالية",
        "description": "تذييل يعرض نطاق الصفوف الظاهرة والتنقّل بين الصفحات ومحدِّد عدد الصفوف في الصفحة."
      },
      "bulkActionToolbar": {
        "selectedLabel": "محدد",
        "clearLabel": "إلغاء التحديد",
        "toolbarLabel": "إجراءات جماعية",
        "description": "شريط أدوات يتتبّع التحديد ويعرض عدد العناصر المحددة والإجراءات الجماعية."
      },
      "miniTable": {
        "viewAllLabel": "عرض الكل",
        "description": "قائمة صفوف مدمجة للوحة المعلومات بأعمدة مرتبطة ورابط لعرض الكل."
      },
      "revealLabel": "كشف القيمة",
      "hideLabel": "إخفاء القيمة",
      "trueLabel": "صحيح",
      "falseLabel": "خطأ",
      "detailKeyValue": {
        "description": "حقول السجل كصفوف تسمية/قيمة مع قيم تراعي نوع البيانات."
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
      },
      "boardCard": {
        "description": "بطاقة لوحة واحدة: الوسم والعنوان والتقدّم والمسؤول وتاريخ الاستحقاق.",
        "emptyTitle": "لا توجد بطاقة",
        "emptyBody": "لم يُربط بهذه البطاقة أي سجل بعد."
      },
      "inlineComposeCard": {
        "description": "إضافة سريعة تُنشئ سجلاً جديدًا بالقيم الافتراضية للعمود.",
        "placeholder": "عنوان البطاقة…",
        "addLabel": "إضافة",
        "cancelLabel": "إلغاء",
        "openLabel": "إضافة بطاقة"
      }
    },
    "communication": {
      "conversationInbox": {
        "description": "قائمة محادثات قابلة للتحديد مع عدد الرسائل غير المقروءة والحالة ومعاينة آخر رسالة.",
        "emptyTitle": "لا توجد محادثات",
        "emptyBody": "ستظهر المحادثات هنا عند وصول الرسائل.",
        "noMatchesTitle": "لا توجد محادثات مطابقة",
        "searchLabel": "البحث في المحادثات",
        "searchPlaceholder": "ابحث في المحادثات…"
      },
      "chatThread": {
        "description": "فقاعات رسائل مجمَّعة حسب المُرسِل واليوم، مع المرفقات وحقل الكتابة.",
        "emptyTitle": "لا توجد رسائل بعد",
        "emptyBody": "ستظهر رسائل هذه المحادثة هنا.",
        "composerPlaceholder": "اكتب رسالة…",
        "sendLabel": "إرسال",
        "attachLabel": "إضافة مرفق",
        "typingLabel": "يكتب…",
        "composerLabel": "الرسالة"
      },
      "aiChatPanel": {
        "description": "لوحة مساعد لطرح الأسئلة حول مخطط قاعدة بياناتك وبياناتك.",
        "emptyTitle": "اسأل عن بياناتك",
        "emptyBody": "اطرح سؤالاً عن المخطط أو الجداول أو المقاييس للبدء.",
        "composerPlaceholder": "اطرح سؤالاً…",
        "sendLabel": "إرسال",
        "pendingLabel": "جارٍ التفكير…",
        "configureTitle": "لم يتم إعداد مزوّد ذكاء اصطناعي",
        "configureBody": "أضف مفتاح Anthropic أو OpenAI — أو وجّه Adminium إلى نقطة النهاية الخاصة بك — لطرح الأسئلة حول مخططك.",
        "configureCtaLabel": "إعداد مزوّد",
        "assistantLabel": "المساعد",
        "composerLabel": "اطرح سؤالًا"
      },
      "typingIndicator": {
        "description": "صورة رمزية وسطر مائل ”يكتب…“ مرتبط بقيمة منطقية حية لكل محادثة.",
        "label": "يكتب…",
        "emptyTitle": "لا يوجد نشاط كتابة",
        "emptyBody": "تظهر حالة الكتابة هنا بمجرد أن تصبح المحادثة نشطة."
      },
      "callWidget": {
        "description": "مكالمة واردة صوتية أو مرئية: صورة المتصل وحالة المكالمة وإجراءات القبول أو الرفض.",
        "voiceLabel": "مكالمة صوتية",
        "videoLabel": "مكالمة مرئية",
        "ringingLabel": "يرن…",
        "connectingLabel": "جارٍ الاتصال…",
        "activeLabel": "في مكالمة",
        "endedLabel": "انتهت المكالمة",
        "acceptLabel": "قبول",
        "declineLabel": "رفض",
        "endLabel": "إنهاء المكالمة",
        "emptyTitle": "لا توجد مكالمة نشطة",
        "emptyBody": "ستظهر المكالمات الواردة هنا."
      }
    },
    "geo": {
      "mapBubble": {
        "description": "خريطة بعلامات دائرية يتغيّر حجمها حسب المقياس المختار، إلى جانب قائمة مرتّبة بأهم المواقع.",
        "emptyTitle": "لا توجد مواقع",
        "emptyBody": "تظهر الصفوف التي تحتوي على خطي الطول والعرض هنا كعلامات على الخريطة.",
        "mapUnavailableLabel": "تعذّر تحميل الخريطة. تعرض القائمة المرتّبة البيانات نفسها.",
        "regionsLabel": "أبرز المناطق",
        "metricLabel": "المقياس"
      },
      "mapChoroplethGrid": {
        "description": "مربعات مناطق مُلوَّنة حسب القيمة — للجداول التي تحتوي على رموز المناطق دون إحداثيات.",
        "emptyTitle": "لا توجد مناطق",
        "emptyBody": "تظهر الصفوف التي تحتوي على رمز منطقة وقيمة رقمية هنا كمربعات ملوَّنة.",
        "legendLowLabel": "منخفض",
        "legendHighLabel": "مرتفع",
        "chartLabel": "التفصيل حسب المنطقة"
      }
    },
    "domain": {
      "orgChart": {
        "description": "شجرة التسلسل الإداري المبنية من مرجع المدير في جدول الأشخاص، مع فروع قابلة للطي.",
        "emptyTitle": "لا يوجد هيكل تنظيمي",
        "emptyBody": "يظهر الهيكل التنظيمي بمجرد أن تشير صفوف الأشخاص إلى مدير.",
        "reportsLabel": "المرؤوسون · {count}",
        "a11yLabel": "الهيكل التنظيمي"
      },
      "ganttChart": {
        "description": "أشرطة المهام على محور زمني، مجمَّعة حسب المرحلة، مع نسبة الإنجاز والمعالم وعلامة اليوم.",
        "emptyTitle": "لا توجد مهام مجدولة",
        "emptyBody": "تظهر المهام هنا بمجرد أن يكون لها تاريخا بداية ونهاية.",
        "ungroupedLabel": "المهام"
      },
      "documentCanvas": {
        "description": "لوحة مستند بمظهر ورقي — فاتورة أو تقرير أو بريد — يمكن تحديد كتلها وإعادة ترتيبها وحذفها.",
        "emptyTitle": "لا يوجد شيء في هذا المستند",
        "emptyBody": "أضف كتلة من اللوحة لبدء تكوين المستند.",
        "addBlockLabel": "إضافة كتلة",
        "removeBlockLabel": "حذف الكتلة",
        "moveUpLabel": "تحريك الكتلة لأعلى",
        "moveDownLabel": "تحريك الكتلة لأسفل",
        "blockListLabel": "كتل المستند",
        "billedToLabel": "الفاتورة إلى",
        "issuedLabel": "تاريخ الإصدار",
        "dueLabel": "تاريخ الاستحقاق",
        "noDocumentTitle": "لا يوجد مستند بعد",
        "noDocumentBody": "اختر قالبًا جاهزًا أو أضف كتلة للبدء."
      },
      "blockTotalsSummary": {
        "description": "إجماليات المستند — المجموع الفرعي والخصم والضريبة والمبلغ المستحق، محسوبة من بنود المستند.",
        "emptyTitle": "لا توجد إجماليات بعد",
        "emptyBody": "تظهر الإجماليات بمجرد أن يحتوي المستند على بنود.",
        "subtotalLabel": "المجموع الفرعي",
        "discountLabel": "الخصم",
        "taxLabel": "الضريبة",
        "totalLabel": "الإجمالي المستحق"
      },
      "blockLineItems": {
        "description": "صفوف قابلة للتحرير للوصف والكمية والسعر، تغذي إجماليات المستند.",
        "emptyTitle": "لا توجد بنود",
        "emptyBody": "أضف بندًا لتحرير فاتورة بالعمل المنجز في هذا المستند.",
        "descHeader": "الوصف",
        "qtyHeader": "الكمية",
        "rateHeader": "السعر",
        "amountHeader": "المبلغ"
      },
      "blockKpiRow": {
        "description": "صف من بطاقات المؤشرات مع تلوين التغير حسب إشارته.",
        "emptyTitle": "لا توجد مؤشرات",
        "emptyBody": "تظهر المؤشرات هنا بمجرد أن يحتوي التقرير على أرقام."
      },
      "blockBarChart": {
        "description": "رسم أعمدة مصغر بلون المستند، بحجم مناسب لكتلة مستند.",
        "emptyTitle": "لا توجد بيانات للرسم",
        "emptyBody": "تظهر الأعمدة بمجرد أن يحتوي التقرير على سلسلة بيانات.",
        "a11yLabel": "مخطط أعمدة"
      },
      "blockLineChart": {
        "description": "رسم خطي مصغر مع تعبئة اختيارية للمساحة، بحجم مناسب لكتلة مستند.",
        "emptyTitle": "لا توجد بيانات للرسم",
        "emptyBody": "يظهر الخط بمجرد أن يحتوي التقرير على سلسلة بيانات.",
        "a11yLabel": "مخطط خطي"
      },
      "blockTwoColTable": {
        "description": "جدول من عمودين بصف رأس منسق وعمود قيم بخط ثابت العرض.",
        "emptyTitle": "لا توجد صفوف",
        "emptyBody": "تظهر الصفوف هنا بمجرد أن يحتوي التقرير على قيم."
      },
      "blockTaxBreakdown": {
        "description": "صفوف ضريبية بالاسم والنسبة والمبلغ، تُطبق على المجموع الفرعي للمستند.",
        "emptyTitle": "لا توجد صفوف ضريبية",
        "emptyBody": "تظهر الصفوف الضريبية بمجرد أن يحتوي المستند على نسب."
      },
      "blockMultiCurrency": {
        "description": "إجمالي المستند محولًا لكل عملة حسب الأسعار المحددة.",
        "emptyTitle": "لا توجد تحويلات",
        "emptyBody": "تظهر التحويلات بمجرد أن يذكر المستند أسعار الصرف.",
        "footnote": "الأسعار استرشادية وقد تختلف عند التسوية."
      },
      "blockPaymentHistory": {
        "description": "المدفوعات السابقة بالتاريخ وطريقة الدفع المخفية والمبلغ وشارة الحالة.",
        "emptyTitle": "لا توجد مدفوعات بعد",
        "emptyBody": "تظهر هنا المدفوعات الخاصة بهذا المستند."
      },
      "blockDiscountCodes": {
        "description": "أكواد الخصم المطبقة مع اسمها والمبلغ المخصوم.",
        "emptyTitle": "لم تطبق أي خصومات",
        "emptyBody": "تظهر هنا أكواد الخصم المطبقة على هذا المستند."
      },
      "blockLoyaltyBanner": {
        "description": "شريط ولاء يعرض رصيد النقاط والفئة والنقاط المكتسبة من هذا الطلب.",
        "emptyTitle": "لا يوجد رصيد نقاط",
        "emptyBody": "يظهر شريط الولاء بمجرد أن يكون لدى العميل رصيد نقاط.",
        "balanceLabel": "{balance} نقطة · {tier}",
        "earnedLabel": "+{earned} مكتسبة من هذا الطلب"
      },
      "blockRecurringBanner": {
        "description": "شريط يوضح دورية الفوترة وتاريخ الاستحقاق التالي وعدد الدورات المتبقية.",
        "emptyTitle": "غير متكرر",
        "emptyBody": "يظهر هذا الشريط بمجرد أن يصبح المستند على جدول فوترة متكرر.",
        "template": "متكرر — {freq} · التالي في {next} · {count} دورات"
      },
      "blockQrPay": {
        "description": "بطاقة مسح للدفع مع نص توضيحي والمبلغ المستحق.",
        "emptyTitle": "لا شيء للدفع",
        "emptyBody": "يظهر رمز الدفع بمجرد أن يكون للمستند مبلغ مستحق.",
        "amountLabel": "المبلغ المستحق"
      },
      "blockDeliveryStepper": {
        "description": "خطوات توصيل أفقية معلَّمة كمكتملة أو حالية أو قادمة.",
        "emptyTitle": "لا توجد خطوات توصيل",
        "emptyBody": "تظهر الخطوات بمجرد أن يكون للطلب مسار توصيل."
      },
      "blockSignature": {
        "description": "أسطر توقيع للاسم والمسمى الوظيفي، مع تاريخ التوقيع.",
        "emptyTitle": "لا يوجد توقيع",
        "emptyBody": "تظهر أسطر التوقيع بمجرد أن يحدد المستند الموقِّع.",
        "namePlaceholder": "الاسم الكامل",
        "titlePlaceholder": "المسمى الوظيفي",
        "dateLabel": "التاريخ",
        "nameInputLabel": "اسم الموقِّع"
      },
      "blockTermsCheckbox": {
        "description": "مفتاح موافقة على الشروط مع نص قابل للتحرير.",
        "defaultLabel": "أوافق على الشروط والأحكام"
      },
      "blockApproval": {
        "description": "بطاقة معتمِد بشارة ملونة حسب الحالة وإجراءات اختيارية للموافقة أو الرفض.",
        "emptyTitle": "لا يوجد معتمِد",
        "emptyBody": "تظهر بطاقة الاعتماد بمجرد أن يحدد المستند معتمِدًا.",
        "approveLabel": "موافقة",
        "rejectLabel": "رفض",
        "pendingLabel": "قيد الانتظار",
        "approvedLabel": "تمت الموافقة",
        "rejectedLabel": "مرفوض"
      },
      "blockAttachments": {
        "description": "الملفات المرفقة مع أسمائها وأحجامها.",
        "emptyTitle": "لا توجد مرفقات",
        "emptyBody": "تظهر هنا الملفات المرفقة بهذا المستند."
      },
      "blockLateFees": {
        "description": "تنبيه يوضح رسوم التأخير ومهلة السماح.",
        "emptyTitle": "لا توجد رسوم تأخير",
        "emptyBody": "يظهر هذا التنبيه بمجرد أن يحدد المستند سياسة رسوم التأخير.",
        "template": "تُطبق رسوم تأخير بنسبة {rate} بعد {days} يومًا."
      },
      "blockImagePlaceholder": {
        "description": "مربع نائب بحدود متقطعة بدلًا من صورة، مع نص توضيحي.",
        "emptyTitle": "لا توجد صورة",
        "emptyBody": "يظهر المربع النائب بمجرد أن يكون للكتلة نص توضيحي."
      },
      "blockContact": {
        "description": "صفوف اتصال للاسم والبريد الإلكتروني ورقم الهاتف.",
        "emptyTitle": "لا توجد جهة اتصال",
        "emptyBody": "تظهر بيانات الاتصال بمجرد أن يحدد المستند جهة اتصال."
      },
      "blockHighlightBox": {
        "description": "مربع تمييز يجمع بين نص وقيمة كبيرة بخط ثابت العرض.",
        "emptyTitle": "لا يوجد ما يُبرز",
        "emptyBody": "يظهر المربع بمجرد أن يكون للكتلة قيمة."
      },
      "starterTemplatePicker": {
        "description": "شبكة من القوالب الجاهزة مع صور مصغّرة مولّدة؛ اختيار أحدها ينشئ مستندًا كاملًا.",
        "emptyTitle": "لا توجد قوالب",
        "emptyBody": "عرِّف القوالب في الإعدادات أو اربط جدول قوالب.",
        "blankLabel": "فارغ",
        "kicker": {
          "invoice": "فاتورة",
          "report": "تقرير",
          "email": "بريد إلكتروني"
        }
      },
      "sloMonitorCard": {
        "description": "بطاقة اتفاقية مستوى الخدمة لكل خدمة، وتضم الحالة ونسبة التوافر مقابل الهدف وشريط التوافر اليومي وميزانية الأخطاء وزمن الاستجابة p95.",
        "emptyTitle": "لا توجد مراقبة",
        "emptyBody": "اربط جدول مراقبة يحتوي على عمود للحالة وعمود للتوافر.",
        "targetLabel": "الهدف",
        "budgetLabel": "ميزانية الأخطاء",
        "latencyLabel": "زمن الاستجابة p95",
        "status": {
          "operational": "تعمل",
          "degraded": "متدهورة",
          "down": "متوقفة",
          "unknown": "غير معروف"
        }
      },
      "uptimeSegmentBar": {
        "description": "شرائط يومية على نمط صفحة الحالة، ملوَّنة حسب حالة كل يوم، مع مبدّل بين 30 و90 يومًا.",
        "emptyTitle": "لا يوجد سجل توافر",
        "emptyBody": "تظهر صفوف الحالة اليومية هنا على شكل شريط توافر.",
        "daysAgoLabel": "قبل {days} يومًا",
        "todayLabel": "اليوم",
        "uptimeLabel": "توافر",
        "period30Label": "30 يومًا",
        "period90Label": "90 يومًا",
        "status": {
          "operational": "تعمل",
          "degraded": "متدهورة",
          "down": "متوقفة",
          "unknown": "لا توجد بيانات"
        }
      },
      "experimentVariantCompare": {
        "description": "أشرطة تحويل لكل نسخة مع نسبة التحسّن مقابل النسخة الضابطة ومؤشّر للدلالة الإحصائية.",
        "emptyTitle": "لا توجد نسخ",
        "emptyBody": "اربط جدول نسخ التجربة مع أرقام التحويل.",
        "controlLabel": "الضابطة",
        "winnerLabel": "الفائزة",
        "significanceLabel": "الثقة",
        "verdictSignificantLabel": "دالّة إحصائيًا — يمكن حسم النتيجة.",
        "verdictInconclusiveLabel": "غير دالّة إحصائيًا بعد — واصل تشغيل الاختبار.",
        "countsLabel": "{users} مشارك · {conversions} تحويل"
      },
      "creditCardTile": {
        "description": "وسيلة دفع محفوظة تظهر كبطاقة بهوية الشبكة مع رقم مُقنَّع واسم حاملها وتاريخ انتهائها.",
        "emptyTitle": "لا توجد وسيلة دفع",
        "emptyBody": "أضف بطاقة لتظهر هنا.",
        "defaultLabel": "الافتراضية",
        "setDefaultLabel": "تعيين كافتراضية",
        "manageLabel": "إدارة",
        "addLabel": "إضافة وسيلة دفع",
        "expiresLabel": "ينتهي في"
      },
      "planPricingCards": {
        "description": "باقات الأسعار مع مبدّل بين الاشتراك الشهري والسنوي وقوائم المزايا وباقة مميّزة.",
        "emptyTitle": "لا توجد باقات",
        "emptyBody": "اربط جدول باقات يحتوي على اسم وسعر شهري.",
        "monthlyLabel": "شهريًا",
        "annualLabel": "سنويًا",
        "popularLabel": "الأكثر شيوعًا",
        "perMonthLabel": "/ شهريًا",
        "billedAnnuallyLabel": "تُحاسب بمبلغ {total} سنويًا",
        "currentLabel": "الباقة الحالية",
        "ctaLabel": "اختيار الباقة"
      },
      "apiKeysPanel": {
        "description": "مفاتيح واجهة البرمجة مع شارات البيئة والقيم المُقنَّعة والصلاحيات وآخر استخدام، وإجراءات النسخ والتدوير والإبطال.",
        "emptyTitle": "لا توجد مفاتيح",
        "emptyBody": "أنشئ مفتاحًا لتبدأ استدعاء واجهة البرمجة.",
        "revealedTitle": "تم إنشاء المفتاح",
        "revealedBody": "انسخه الآن — لن يُعرض مرة أخرى أبدًا.",
        "copyLabel": "نسخ",
        "copiedLabel": "تم النسخ",
        "revealLabel": "كشف المفتاح",
        "hideLabel": "إخفاء المفتاح",
        "rollLabel": "تدوير المفتاح",
        "revokeLabel": "إبطال المفتاح",
        "neverUsedLabel": "لم يُستخدم قط",
        "lastUsedLabel": "آخر استخدام {since}"
      },
      "apiPlayground": {
        "description": "محرِّر طلبات مع المعاملات ولوحة للاستجابة. يقوم بتكوين الطلب فقط ولا يرسل طلبًا حقيقيًا أبدًا.",
        "emptyTitle": "لم تُحدَّد نقطة نهاية",
        "emptyBody": "اختر نقطة نهاية لتكوين طلب موجَّه إليها.",
        "sendLabel": "إرسال",
        "requestLabel": "الطلب",
        "responseLabel": "الاستجابة",
        "paramsLabel": "المعاملات",
        "responsePlaceholder": "أرسل الطلب لعرض الاستجابة."
      },
      "codeSnippetBlock": {
        "description": "مقتطف برمجي قابل للنسخ مع شارة للغة وتبويبات اختيارية لكل لغة.",
        "emptyTitle": "لا يوجد مقتطف",
        "emptyBody": "اربط عمودًا للشيفرة أو حدِّد مقتطفًا ثابتًا في الإعدادات.",
        "copyLabel": "نسخ",
        "copiedLabel": "تم النسخ"
      },
      "webhookEndpointsList": {
        "description": "نقاط نهاية الويب هوك مع الحدث وعنوان الوجهة وآخر تشغيل ومفتاح للتفعيل.",
        "emptyTitle": "لا توجد نقاط نهاية",
        "emptyBody": "أضف نقطة نهاية ويب هوك لتستقبل أحداث الجدول.",
        "neverFiredLabel": "لم يُشغَّل قط",
        "lastFiredLabel": "آخر تشغيل {since}"
      },
      "resourceApiCard": {
        "description": "واجهة البرمجة المولَّدة لجدول: عدد الصفوف وشارة الأمان وشارات الأساليب وحجم الطلبات.",
        "emptyTitle": "لا يوجد مورد",
        "emptyBody": "اربط جدولًا لعرض واجهة البرمجة المولَّدة له.",
        "rlsLabel": "RLS",
        "publicLabel": "عام",
        "rowsLabel": "صف",
        "perDayLabel": "{count}/يوم"
      },
      "liveTimer": {
        "description": "ساعة إيقاف بزرّي تشغيل وإيقاف لمهمة؛ إيقافها يسجّل مدخل وقت.",
        "emptyTitle": "لا يوجد مؤقّت",
        "emptyBody": "اربط صف مدخل وقت يحتوي على مهمة وعمود للمدة.",
        "startLabel": "بدء",
        "stopLabel": "إيقاف",
        "taskPlaceholder": "مهمة بلا عنوان"
      },
      "syncStatusCard": {
        "description": "هوية الاتصال وزمن الاستجابة وعدد الصفوف المُزامنة وجدول المزامنة، مع إجراء للمزامنة الفورية.",
        "emptyTitle": "لا يوجد اتصال",
        "emptyBody": "اربط صف اتصال لعرض حالة مزامنته.",
        "connectedLabel": "متصل",
        "disconnectedLabel": "غير متصل",
        "rowsSyncedLabel": "الصفوف المُزامنة",
        "tablesLabel": "الجداول",
        "lastSyncLabel": "آخر مزامنة",
        "nextSyncLabel": "المزامنة التالية",
        "syncingLabel": "جارٍ المزامنة…",
        "syncActionLabel": "مزامنة الآن"
      },
      "ipAllowlistCard": {
        "description": "عناوين IP صادرة ثابتة يلزم السماح لها في الجدار الناري، ولكل منها زر نسخ.",
        "emptyTitle": "لا توجد عناوين صادرة",
        "emptyBody": "تظهر العناوين الصادرة هنا بمجرد تجهيز الاتصال.",
        "copyLabel": "نسخ",
        "copiedLabel": "تم النسخ"
      },
      "onboardingChecklist": {
        "description": "خطوات الإعداد مع الوقت المتوقَّع والإجراءات، فوق حلقة وشريط تقدُّم يُعاد حسابهما فوريًا.",
        "emptyTitle": "لا شيء للإعداد",
        "emptyBody": "أضف خطوات التعريف في الإعدادات أو اربط جدول خطوات.",
        "progressLabel": "اكتمل {done} من {total}",
        "celebrateTitle": "اكتمل كل شيء"
      },
      "testimonialCard": {
        "description": "اقتباس من عميل مع صورة رمزية ونسبة القول إلى صاحبه.",
        "emptyTitle": "لا توجد شهادة",
        "emptyBody": "اربط صف اقتباس لعرض شهادة عميل."
      },
      "trustBadges": {
        "description": "صف من إقرارات الامتثال والثقة مفصولة بنقاط.",
        "emptyTitle": "لا توجد شارات",
        "emptyBody": "أضف إقرارات الامتثال في الإعدادات أو اربط جدول شارات."
      },
      "policyList": {
        "description": "سياسات الأمان على مستوى الصفوف لكل جدول، مع الأمر والدور ومفتاح للتفعيل.",
        "emptyTitle": "لا توجد سياسات",
        "emptyBody": "لا يحتوي هذا الجدول على سياسات أمان على مستوى الصفوف بعد."
      }
    },
    "media": {
      "fileBrowser": {
        "description": "تصفّح الملفات والمجلدات كشبكة مربعات أو كقائمة، مع مسار تنقّل وأيقونات للأنواع وتمييز بالنجمة.",
        "emptyTitle": "هذا المجلد فارغ",
        "emptyBody": "ارفع ملفات أو أنشئ مجلدًا للبدء."
      },
      "uploadDropzone": {
        "description": "منطقة سحب وإفلات لرفع الملفات، مع قيود على الصيغة والحجم.",
        "dropTitle": "أفلت الملفات لرفعها",
        "browsePrefix": "أو",
        "browseLabel": "تصفّح"
      },
      "uploadProgressList": {
        "description": "صفوف لكل ملف مع شريط تقدّم وحالة؛ وتخدم أيضًا مهام قائمة التصدير.",
        "emptyTitle": "لا توجد عمليات رفع جارية",
        "emptyBody": "ستعرض الملفات التي ترفعها تقدّمها هنا."
      },
      "attachmentList": {
        "description": "الملفات المرفقة بسجل، مع أيقونات الأنواع والأحجام وإجراءات التنزيل أو الحذف.",
        "emptyTitle": "لا توجد مرفقات",
        "emptyBody": "ستظهر هنا الملفات المرفقة بهذا السجل."
      },
      "imageBoard": {
        "description": "شبكة لوحة إلهام من خانات صور مع تسميات توضيحية، للجداول التي تحتوي على روابط صور.",
        "emptyTitle": "لا توجد صور بعد",
        "emptyBody": "ستظهر الصور المرجعية على هذه اللوحة.",
        "placeholder": "أفلت صورة مرجعية"
      },
      "linkList": {
        "description": "روابط مرجعية بعناوين وروابط URL، تُفتح في تبويب جديد.",
        "emptyTitle": "لا توجد روابط بعد",
        "emptyBody": "ستظهر الروابط المرجعية هنا."
      },
      "root": "الملفات",
      "breadcrumb": "مسار التنقّل",
      "gridView": "عرض الشبكة",
      "listView": "عرض القائمة",
      "nameHeader": "الاسم",
      "sizeHeader": "الحجم",
      "modifiedHeader": "آخر تعديل",
      "star": "تمييز بنجمة",
      "items": "عنصرًا",
      "done": "تم",
      "failed": "فشل",
      "queued": "في الانتظار",
      "retry": "إعادة المحاولة",
      "download": "تنزيل",
      "cancel": "إلغاء",
      "delete": "حذف",
      "remove": "إزالة",
      "addImage": "إضافة صورة",
      "caption": "تسمية توضيحية",
      "addLink": "إضافة رابط",
      "linkTitlePlaceholder": "العنوان",
      "linkUrlPlaceholder": "https://…",
      "add": "إضافة"
    },
    "forms": {
      "modalWizard": {
        "description": "نموذج إنشاء في نافذة منبثقة مع تأكيد النجاح — التدفق القياسي لإضافة سجل جديد.",
        "trigger": "إنشاء",
        "submit": "إنشاء",
        "cancel": "إلغاء",
        "done": "تم",
        "successTitle": "تم إنشاء السجل",
        "successBody": "تم حفظ السجل.",
        "required": "هذا الحقل مطلوب.",
        "titleLabel": "إنشاء سجل",
        "closeLabel": "إغلاق"
      },
      "drawerForm": {
        "description": "نموذج جانبي لإنشاء أو تعديل السجلات ذات الحقول الكثيرة.",
        "trigger": "جديد",
        "submit": "حفظ",
        "cancel": "إلغاء",
        "titleLabel": "سجل جديد",
        "closeLabel": "إغلاق"
      },
      "stepper": {
        "description": "مؤشر خطوات يوضح مدى تقدم مسار متعدد الخطوات.",
        "a11yLabel": "التقدم"
      },
      "progressBar": {
        "description": "شريط تقدم محدد مع نسبة مئوية.",
        "label": "التقدم"
      },
      "otpInput": {
        "description": "حقل إدخال رمز لمرة واحدة.",
        "label": "رمز لمرة واحدة"
      },
      "chipInput": {
        "description": "إدخال وسوم: شرائح قابلة للإزالة مع نص حر يُعتمد بمفتاح Enter.",
        "remove": "إزالة",
        "placeholder": "اكتب ثم اضغط Enter…"
      },
      "segmentedControl": {
        "description": "عنصر تحكم أحادي الاختيار للفترات والبيئات والمرشحات.",
        "a11yLabel": "اختر خيارًا"
      },
      "filterChipBar": {
        "description": "شرائح تصفية بعدادات حية محسوبة من القائمة التي تصفّيها.",
        "all": "الكل",
        "a11yLabel": "تصفية",
        "meta": "{shown} من {total}"
      },
      "toggleSwitchList": {
        "description": "قائمة صفوف إعدادات، لكل منها مفتاح تبديل.",
        "save": "حفظ",
        "dirty": "لديك تغييرات غير محفوظة",
        "emptyTitle": "لا توجد إعدادات",
        "emptyBody": "ستظهر الإعدادات هنا بمجرد تهيئتها."
      },
      "optionCards": {
        "description": "شبكة بطاقات أحادية الاختيار للمصادر والقوالب والخطط.",
        "a11yLabel": "اختر خيارًا"
      },
      "ruleBuilder": {
        "description": "مُنشئ شروط تتحول قواعده إلى عامل تصفية — محرر الشرائح.",
        "add": "إضافة شرط",
        "remove": "إزالة الشرط",
        "all": "الكل",
        "any": "أي",
        "field": "الحقل",
        "operator": "المُعامل",
        "value": "القيمة",
        "valuePlaceholder": "القيمة…",
        "emptyBody": "لا توجد شروط بعد — أضف شرطًا لتحديد هذه الشريحة.",
        "op": {
          "eq": "يساوي",
          "neq": "لا يساوي",
          "gt": "أكبر من",
          "gte": "لا يقل عن",
          "lt": "أصغر من",
          "lte": "لا يزيد عن",
          "contains": "يحتوي على",
          "not-contains": "لا يحتوي على",
          "starts-with": "يبدأ بـ",
          "in": "أحد القيم",
          "before": "قبل",
          "after": "بعد",
          "is-null": "فارغ",
          "is-not-null": "غير فارغ"
        }
      },
      "flowBuilder": {
        "description": "لوحة سير عمل رأسية من خطوات المُشغِّل والشرط والإجراء.",
        "add": "إضافة خطوة",
        "remove": "إزالة الخطوة",
        "paletteTitle": "إضافة خطوة",
        "stats": "{runs} تشغيل · {rate}% نجاح",
        "emptyBody": "لا توجد خطوات بعد — أضف مُشغِّلًا لبدء سير العمل."
      },
      "connectionStringField": {
        "description": "حقل سلسلة اتصال يتعرف على محرك قاعدة البيانات أثناء الكتابة.",
        "label": "سلسلة الاتصال",
        "helper": "postgres://user:password@host:5432/database — كما تعمل mysql:// و sqlite:.",
        "quickFill": "تعبئة سريعة:",
        "host": "المضيف: {host}",
        "invalidScheme": "صيغة سلسلة الاتصال غير معروفة.",
        "incomplete": "أضف المضيف وقاعدة البيانات إلى سلسلة الاتصال."
      },
      "tableInclusionChecklist": {
        "description": "الجداول المراد تضمينها، مع عدد الصفوف وتنبيهات البيانات الشخصية.",
        "pii": "بيانات شخصية",
        "highVolume": "حجم كبير",
        "a11yLabel": "الجداول المراد تضمينها",
        "emptyTitle": "لم يتم العثور على جداول",
        "emptyBody": "اربط قاعدة بيانات وستظهر جداولها هنا."
      },
      "columnMappingTable": {
        "description": "يربط أعمدة الملف المرفوع بحقول الجدول.",
        "skip": "عدم الاستيراد",
        "sourceHeader": "عمود المصدر",
        "sampleHeader": "عيّنة",
        "targetHeader": "الحقل الهدف",
        "emptyTitle": "لا توجد أعمدة للربط",
        "emptyBody": "ارفع ملفًا وستظهر أعمدته هنا."
      },
      "validationIssuesList": {
        "description": "مشكلات الاستيراد والتحقق، الأخطر أولًا، مع عدد الصفوف المتأثرة.",
        "emptyTitle": "لا توجد مشكلات",
        "emptyBody": "كل شيء سليم — يمكنك بدء الاستيراد."
      },
      "exportBuilder": {
        "description": "يُنشئ تصديرًا للبيانات: الصيغة والنطاق الزمني والمحتوى.",
        "format": "الصيغة",
        "from": "من",
        "to": "إلى",
        "groupBy": "التجميع حسب",
        "includeCharts": "تضمين الرسوم البيانية",
        "email": "أرسل لي التصدير بالبريد",
        "submit": "تصدير",
        "running": "جارٍ تجهيز التصدير…",
        "done": "التصدير جاهز",
        "failed": "فشل التصدير. حاول مرة أخرى.",
        "download": "تنزيل"
      },
      "questionBuilder": {
        "description": "محرر استبيان: أضف أنواع الأسئلة وأعد ترتيبها.",
        "paletteTitle": "إضافة سؤال",
        "add": "إضافة سؤال",
        "remove": "إزالة السؤال",
        "moveUp": "تحريك لأعلى",
        "moveDown": "تحريك لأسفل",
        "required": "مطلوب",
        "questionPlaceholder": "اطرح سؤالًا…",
        "emptyTitle": "لا توجد أسئلة بعد",
        "emptyBody": "اختر نوع سؤال لبدء إنشاء استبيانك.",
        "questionLabel": "السؤال",
        "dropdownPlaceholder": "اختر…",
        "kind": {
          "single-choice": "اختيار واحد",
          "multi-choice": "اختيار متعدد",
          "dropdown": "قائمة منسدلة",
          "short-text": "نص قصير",
          "long-text": "نص طويل",
          "rating": "تقييم بالنجوم",
          "nps": "NPS من 0 إلى 10",
          "date": "تاريخ"
        }
      },
      "inlineEditableField": {
        "description": "قيمة قابلة للتحرير بنقرة داخل مستند أو لوحة.",
        "edit": "تحرير",
        "save": "حفظ",
        "cancel": "إلغاء",
        "empty": "فارغ",
        "valueLabel": "القيمة"
      },
      "passwordStrengthMeter": {
        "description": "مؤشر من أربعة أجزاء لقوة كلمة المرور.",
        "label": "قوة كلمة المرور",
        "weak": "ضعيفة",
        "fair": "متوسطة",
        "good": "جيدة",
        "strong": "قوية"
      }
    },
    "chrome": {
      "sidebarNav": {
        "description": "شريط تنقل التطبيق المُجمَّع، مع شارات عدّ حية.",
        "a11yLabel": "التنقل الرئيسي",
        "emptyTitle": "لا يوجد تنقل بعد",
        "emptyBody": "ستظهر الجداول المُضمَّنة هنا بعد توليد اتصال."
      },
      "commandPalette": {
        "description": "لوحة ⌘K: ابحث عن الإجراءات والصفحات والسجلات من أي مكان.",
        "title": "لوحة الأوامر",
        "placeholder": "ابحث عن إجراءات وصفحات وسجلات…",
        "navigate": "تنقل",
        "select": "فتح",
        "close": "إغلاق",
        "emptyTitle": "لا توجد نتائج عن «{query}»",
        "emptyBody": "ابدأ الكتابة للبحث.",
        "groupActions": "الإجراءات",
        "groupNavigate": "التنقل",
        "groupRecent": "الأخيرة",
        "groupPages": "الصفحات",
        "groupMetrics": "المقاييس",
        "groupPeople": "الأشخاص",
        "groupRecords": "السجلات"
      },
      "globalSearch": {
        "description": "بحث عبر كل الكيانات، مع تصفية حسب النوع ومقتطفات النتائج.",
        "placeholder": "ابحث في كل شيء…",
        "all": "الكل",
        "summary": "{count} نتيجة عن «{query}»",
        "emptyTitle": "لا توجد نتائج",
        "emptyBody": "جرّب مصطلح بحث آخر.",
        "searchLabel": "بحث",
        "facetRailLabel": "التصفية حسب النوع"
      },
      "breadcrumb": {
        "description": "مسار السجل أو المجلد الحالي.",
        "a11yLabel": "مسار التنقل"
      },
      "tabBar": {
        "description": "علامات تبويب تبدّل اللوحات أو تنقل، مع عدادات اختيارية.",
        "a11yLabel": "علامات التبويب"
      },
      "navCard": {
        "description": "شبكة بطاقات روابط لصفحات البداية والتصفح.",
        "emptyTitle": "لا شيء لعرضه",
        "emptyBody": "ستظهر الروابط هنا بعد توليد الصفحات."
      },
      "shortcutsPanel": {
        "description": "دليل اختصارات لوحة المفاتيح.",
        "footerHint": "اضغط ? في أي وقت",
        "then": "ثم",
        "emptyTitle": "لا توجد اختصارات مسجّلة.",
        "generalGroupLabel": "عام",
        "navigationGroupLabel": "التنقل",
        "recordsGroupLabel": "السجلات",
        "openCommandPaletteLabel": "فتح لوحة الأوامر",
        "searchLabel": "بحث",
        "showShortcutsLabel": "عرض الاختصارات",
        "goToDashboardLabel": "الانتقال إلى لوحة المعلومات",
        "goToOrdersLabel": "الانتقال إلى الطلبات",
        "newRecordLabel": "سجل جديد",
        "saveLabel": "حفظ",
        "undoLabel": "تراجع"
      },
      "avatarStack": {
        "description": "صور رمزية متداخلة مع فائض «+N» وحالة تواجد اختيارية.",
        "online": "{count} متصل",
        "a11yLabel": "الأشخاص"
      }
    },
    "system": {
      "stateHero": {
        "description": "شاشة حالة بملء الصفحة لحالات 404 و500 وعدم الاتصال ومنع الوصول والصيانة.",
        "notFoundTitle": "هذه الصفحة سلكت الطريق الخطأ",
        "notFoundBody": "الصفحة التي تبحث عنها نُقلت أو أُعيدت تسميتها أو لم توجد أصلًا.",
        "serverErrorTitle": "حدث خلل من جانبنا",
        "serverErrorBody": "تم تسجيل الخطأ وإبلاغ الفريق. غالبًا ما تنجح إعادة المحاولة.",
        "offlineTitle": "أنت غير متصل",
        "offlineBody": "تحقق من اتصالك — ستعيد لوحة المعلومات الاتصال تلقائيًا.",
        "forbiddenTitle": "ليس لديك صلاحية الوصول",
        "forbiddenBody": "اطلب من مسؤول مساحة العمل منحك صلاحية هذه الصفحة.",
        "maintenanceTitle": "إيقاف مؤقت للصيانة",
        "maintenanceBody": "نعمل على تحسين الأمور. عادةً ما يستغرق ذلك بضع دقائق.",
        "connErrorTitle": "تعذّر الوصول إلى قاعدة البيانات",
        "connErrorBody": "رُفض الاتصال أو انتهت مهلته. تحقق من إعدادات الاتصال.",
        "backToDashboard": "العودة إلى لوحة المعلومات",
        "tryAgain": "حاول مرة أخرى",
        "retry": "إعادة المحاولة",
        "testConnection": "اختبار الاتصال"
      },
      "emptyState": {
        "description": "لوحة متمركزة «لا يوجد شيء بعد» مع إجراءات اختيارية."
      },
      "statusPill": {
        "description": "شارة ملوّنة لعمود تعدادي — العارض العام للحالة."
      },
      "alertBanner": {
        "description": "تنبيه مضمّن لإشعارات الحصص والتجميد والجدولة.",
        "dismiss": "إغلاق"
      },
      "statusBannerHero": {
        "description": "لافتة حالة الخدمات، وتُشتق حالتها من أسوأ خدمة في القائمة.",
        "upTitle": "جميع الأنظمة تعمل",
        "upBody": "جميع الخدمات المراقَبة تستجيب بشكل طبيعي.",
        "degradedTitle": "أداء متدهور",
        "degradedBody": "بعض الخدمات أبطأ من المعتاد. نحن نحقق في الأمر.",
        "downTitle": "عطل كبير",
        "downBody": "خدمة واحدة أو أكثر غير متاحة. نحن نعمل على حلها."
      },
      "connectionStatus": {
        "description": "نتيجة الاتصال أو الاختبار لاتصال قاعدة بيانات.",
        "idle": "غير متصل",
        "connecting": "جارٍ الاتصال…",
        "connected": "متصل",
        "failed": "تعذّر الاتصال",
        "test": "اختبار"
      },
      "autosaveIndicator": {
        "description": "شارة «غير محفوظ ← جارٍ الحفظ ← تم الحفظ» للمستندات ذات الحفظ التلقائي.",
        "dirty": "تغييرات غير محفوظة",
        "saving": "جارٍ الحفظ…",
        "saved": "تم حفظ كل التغييرات",
        "error": "تعذّر الحفظ"
      },
      "progressLogConsole": {
        "description": "وحدة سجل متدفقة مع شريط تقدم، للمهام طويلة التنفيذ.",
        "a11yLabel": "سجل التقدم",
        "progressLabel": "التقدم",
        "emptyTitle": "لا شيء لعرضه بعد",
        "emptyBody": "ستظهر أسطر السجل هنا بمجرد بدء المهمة."
      },
      "diagnosticsReadout": {
        "description": "نتائج فحص الاتصال كصفوف مفتاح/قيمة ملوّنة مع طابع زمني.",
        "checkedAt": "آخر فحص",
        "host": "المضيف",
        "dns": "DNS",
        "tcp": "TCP",
        "tls": "TLS",
        "auth": "المصادقة",
        "latency": "زمن الاستجابة"
      },
      "widgetMissing": {
        "description": "البطاقة البديلة التي تظهر عندما تشير صفحة مخزَّنة إلى عنصر واجهة غير مثبَّت.",
        "title": "عنصر الواجهة غير متاح",
        "bodyLead": "لا يوجد عنصر واجهة مسجَّل باسم",
        "bodyTail": "قد يكون تابعًا لإصدار أحدث أو لامتداد غير مثبَّت."
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
    },
    "draggableRole": "عنصر واجهة قابل للسحب"
  },
  "templates": {
    "crud": {
      "newRow": "صف جديد",
      "exportAction": "تصدير",
      "searchPlaceholder": "ابحث في {table}…",
      "removeFilter": "إزالة تصفية {column}",
      "queryFailed": "فشل الاستعلام",
      "loadingRows": "جارٍ تحميل الصفوف",
      "noMatchesTitle": "لا توجد صفوف مطابقة",
      "emptyTitle": "{count, plural, zero {لا توجد {entity} بعد} one {لا توجد {entity} بعد} two {لا توجد {entity} بعد} few {لا توجد {entity} بعد} many {لا توجد {entity} بعد} other {لا توجد {entity} بعد}}",
      "createTitle": "إضافة {entity}",
      "createSubtitle": "يُنشئ صفًا واحدًا في {table}.",
      "createSubmit": "إضافة {entity}",
      "createSuccessTitle": "تمت إضافة {name}",
      "createSuccessBody": "يمكنك التراجع عن ذلك من الإشعار.",
      "editTitle": "تعديل {entity}",
      "saveSubmit": "حفظ التغييرات",
      "deleteTitle": "حذف {entity}",
      "deletePreflight": "جارٍ فحص المراجع…",
      "deleteNoReferences": "لا توجد مراجع واردة إلى هذا الصف.",
      "deleteConsequencesIntro": "حذف هذا الصف يؤثر أيضًا على:",
      "referenceRows": "{count, plural, zero {{n} صف} one {صف واحد} two {صفان} few {{n} صفوف} many {{n} صفًا} other {{n} صف}}",
      "confirmPrompt": "اكتب {value} للتأكيد",
      "bulkDeleteTitle": "{count, plural, zero {حذف {n} صف} one {حذف صف واحد} two {حذف صفين} few {حذف {n} صفوف} many {حذف {n} صفًا} other {حذف {n} صف}}",
      "bulkDeleteBody": "تنطبق آثار المراجع على كل صف محدد.",
      "bulkDeleteConfirm": "حذف الصفوف",
      "uniqueHelper": "يجب أن تكون القيمة فريدة في {table}.",
      "uniqueHelperCounted": "{count, plural, zero {تم التحقق مقابل {n} صف.} one {تم التحقق مقابل صف واحد.} two {تم التحقق مقابل صفين.} few {تم التحقق مقابل {n} صفوف.} many {تم التحقق مقابل {n} صفًا.} other {تم التحقق مقابل {n} صف.}}",
      "toast": {
        "created": "تم إنشاء {entity}.",
        "createFailed": "فشل الإنشاء.",
        "saved": "تم حفظ التغييرات.",
        "updateFailed": "فشل التحديث.",
        "deleted": "تم حذف {name}.",
        "deleteFailed": "فشل الحذف.",
        "bulkDeleted": "{count, plural, zero {تم حذف {n} صف.} one {تم حذف صف واحد.} two {تم حذف صفين.} few {تم حذف {n} صفوف.} many {تم حذف {n} صفًا.} other {تم حذف {n} صف.}}",
        "bulkDeleteFailed": "فشل الحذف الجماعي.",
        "undone": "تم التراجع عن التغيير.",
        "undoFailed": "فشل التراجع."
      },
      "detail": {
        "fields": "الحقول",
        "inboundReferences": "مراجع واردة",
        "relatedCount": "{count, plural, zero {{n} سجل مرتبط في {table}} one {سجل واحد مرتبط في {table}} two {سجلان مرتبطان في {table}} few {{n} سجلات مرتبطة في {table}} many {{n} سجلًا مرتبطًا في {table}} other {{n} سجل مرتبط في {table}}}",
        "loadError": "تعذّر تحميل السجل."
      }
    },
    "queue": {
      "allSegment": "الكل",
      "daysUnit": "{count, plural, zero {{count} يوم} one {يوم واحد} two {يومان} few {{count} أيام} many {{count} يومًا} other {{count} يوم}}",
      "approvedToast": "تمت الموافقة على {count}.",
      "rejectedToast": "تم رفض {count}.",
      "undoneToast": "تم التراجع عن القرار.",
      "undoFailedToast": "تعذّر التراجع عن هذا القرار.",
      "failedToast": "فشل تنفيذ القرار.",
      "invalidConfig": "الإعدادات المخزَّنة لقائمة الانتظار هذه غير صالحة. أعد توليد الصفحة لاستعادتها.",
      "queueLabel": "قائمة الانتظار",
      "statusFilterLabel": "التصفية حسب الحالة",
      "errorTitle": "تعذّر تحميل قائمة الانتظار هذه",
      "loading": "جارٍ تحميل قائمة الانتظار",
      "emptyTitle": "لا يوجد شيء في قائمة الانتظار",
      "emptyBody": "تظهر الطلبات الجديدة هنا فور وصولها.",
      "caughtUpTitle": "لقد أنجزت كل شيء",
      "caughtUpBody": "لا توجد طلبات في علامة التبويب هذه حاليًا.",
      "selectItem": "تحديد {title}",
      "selectPrompt": "اختر طلبًا",
      "selectBody": "اختر عنصرًا لمراجعة تفاصيله.",
      "rejectTitle": "رفض الطلبات",
      "rejectCount": "المحدد · {count}",
      "rejectPlaceholder": "أضف ملاحظة لمقدم الطلب…",
      "rejectReasonLabel": "سبب الرفض",
      "rejectNote": "سيتم إشعار مقدم الطلب مع ملاحظتك."
    },
    "dashboard": {
      "invalidLayout": "التخطيط المخزَّن للوحة المعلومات هذه غير صالح. أعد توليد الصفحة أو أعد تعيين تخطيطها."
    },
    "builder": {
      "publish": "نشر",
      "paletteTitle": "الكتل",
      "inspectorTitle": "الخصائص",
      "startFromTemplate": "ابدأ من قالب",
      "untitledDoc": "مستند بلا عنوان",
      "invalidConfig": "الإعدادات المخزَّنة لصفحة المنشئ هذه غير صالحة. أعد توليد الصفحة أو أعد تعيينها.",
      "starterPicker": {
        "subtitle": "سيحل الاختيار محل المسودة الحالية."
      },
      "inspector": {
        "titleLabel": "العنوان",
        "numberLabel": "الرقم",
        "currencyLabel": "العملة",
        "taxRateLabel": "نسبة الضريبة %",
        "modulesLabel": "الوحدات"
      },
      "summary": {
        "questions": "الأسئلة",
        "estLength": "المدة التقديرية",
        "estMinutes": "~{minutes} دقيقة",
        "steps": "الخطوات",
        "triggers": "المُشغِّلات",
        "conditions": "الشروط",
        "actions": "الإجراءات",
        "triggerLocked": "لا يمكن إزالة خطوة المُشغِّل."
      },
      "publishModal": {
        "confirmTitle": "نشر الاستبيان؟",
        "confirmSubtitle": "راجعه قبل أن يصبح مفعّلًا.",
        "confirmCta": "نشر الاستبيان",
        "publishedTitle": "تم نشر الاستبيان",
        "publishedSubtitle": "استبيانك مفعّل ويجمع الردود الآن."
      },
      "blocks": {
        "block-totals-summary": "ملخص الإجماليات",
        "block-line-items": "البنود",
        "block-kpi-row": "صف المؤشرات",
        "block-bar-chart": "رسم أعمدة",
        "block-line-chart": "رسم خطي",
        "block-two-col-table": "جدول من عمودين",
        "block-tax-breakdown": "تفصيل الضرائب",
        "block-multi-currency": "عملات متعددة",
        "block-payment-history": "سجل المدفوعات",
        "block-discount-codes": "أكواد الخصم",
        "block-loyalty-banner": "نقاط الولاء",
        "block-recurring-banner": "متكرر",
        "block-qr-pay": "رمز QR للدفع",
        "block-delivery-stepper": "مسار التوصيل",
        "block-signature": "التوقيع",
        "block-terms-checkbox": "الشروط",
        "block-approval": "الاعتماد",
        "block-attachments": "المرفقات",
        "block-late-fees": "رسوم التأخير",
        "block-image-placeholder": "صورة",
        "block-contact": "جهة الاتصال",
        "block-highlight-box": "مربع تمييز"
      },
      "starters": {
        "titles": {
          "st-standard": "فاتورة قياسية",
          "st-recurring": "اشتراك متكرر",
          "st-deposit": "طلب عربون",
          "st-credit-note": "إشعار دائن",
          "st-late-reminder": "تذكير بتأخر السداد",
          "st-quote": "عرض سعر / تقدير",
          "st-proforma": "فاتورة مبدئية",
          "st-receipt": "إيصال دفع",
          "st-retainer": "أتعاب مقدَّمة",
          "st-usage": "فاتورة حسب الاستخدام",
          "st-milestone": "مرحلة من المشروع",
          "st-donation": "إيصال تبرع (الرقم الضريبي)",
          "st-monthly": "ملخص شهري",
          "st-quarterly": "مراجعة ربع سنوية",
          "st-usage-report": "تفصيل الاستخدام",
          "st-exec": "ملخص تنفيذي من صفحة واحدة",
          "st-welcome": "بريد ترحيبي",
          "st-receipt-email": "إيصال الفاتورة",
          "st-digest": "ملخص أسبوعي",
          "st-dunning": "تذكير بالدفع"
        },
        "categories": {
          "billing": "الفوترة",
          "sales": "المبيعات",
          "nonProfit": "غير ربحي",
          "reports": "التقارير",
          "lifecycle": "دورة الحياة",
          "transactional": "المعاملات",
          "marketing": "التسويق"
        }
      }
    },
    "common": {
      "clearFilters": "مسح عوامل التصفية",
      "noMatchesBody": "جرّب بحثًا مختلفًا أو أزل أحد عوامل التصفية.",
      "detailLabel": "التفاصيل",
      "loadingRecord": "جارٍ تحميل السجل"
    },
    "directory": {
      "invalidConfig": "الإعدادات المخزَّنة لهذا الدليل غير صالحة. أعد توليد الصفحة لاستعادتها.",
      "searchPlaceholder": "البحث عن الأشخاص…",
      "memberCount": "{count, plural, zero {{n} شخص} one {شخص واحد} two {شخصان} few {{n} أشخاص} many {{n} شخصًا} other {{n} شخص}}",
      "errorTitle": "تعذّر تحميل هذا الدليل",
      "loading": "جارٍ تحميل الأشخاص",
      "emptyTitle": "لا يوجد أشخاص بعد",
      "emptyBody": "يظهر الأشخاص هنا كلما وصلت صفوف إلى الجدول.",
      "noMatchesTitle": "لا يوجد أشخاص مطابقون",
      "detailTitle": "الشخص"
    },
    "masterDetail": {
      "invalidConfig": "الإعدادات المخزَّنة لهذه الصفحة غير صالحة. أعد توليد الصفحة لاستعادتها.",
      "railTitle": "السجلات",
      "errorTitle": "تعذّر تحميل هذه القائمة",
      "loading": "جارٍ تحميل السجلات",
      "emptyBody": "تظهر السجلات هنا كلما وصلت صفوف إلى الجدول.",
      "noMatchesTitle": "لا توجد سجلات مطابقة",
      "noMatchesBody": "جرّب إزالة أحد عوامل التصفية.",
      "selectPrompt": "اختر سجلًا",
      "selectBody": "اختر عنصرًا من القائمة لعرض تفاصيله."
    },
    "chat": {
      "invalidLayout": "التخطيط المخزَّن لصفحة الدردشة هذه غير صالح. أعد توليد الصفحة أو أعد تعيين تخطيطها.",
      "noInboxTitle": "لا يوجد صندوق وارد في هذه الصفحة",
      "noInboxBody": "أعد توليد الصفحة.",
      "conversationsFailed": "فشل استعلام المحادثات",
      "messagesFailed": "فشل استعلام الرسائل",
      "loadingConversations": "جارٍ تحميل المحادثات",
      "loadingMessages": "جارٍ تحميل الرسائل",
      "selectTitle": "اختر محادثة",
      "selectBody": "اختر محادثة من صندوق الوارد لقراءة رسائلها."
    },
    "files": {
      "allFiles": "كل الملفات",
      "recent": "الأخيرة",
      "starred": "المميزة بنجمة",
      "invalidLayout": "التخطيط المخزَّن لصفحة الملفات هذه غير صالح. أعد توليد الصفحة أو أعد تعيين تخطيطها.",
      "missingSlotTitle": "لا يوجد متصفح ملفات في هذه الصفحة",
      "missingSlotBody": "لا يحتوي التخطيط المخزَّن على خانة للمتصفح. أعد توليد الصفحة.",
      "loadFailed": "فشل استعلام الملفات",
      "loading": "جارٍ تحميل الملفات",
      "uploadsUnavailable": "رفع الملفات غير متاح في هذه الصفحة بعد.",
      "previewTitle": "الملف",
      "kindLabel": "النوع",
      "linkLabel": "الرابط"
    },
    "logViewer": {
      "invalidLayout": "التخطيط المخزَّن لصفحة السجل هذه غير صالح. أعد توليد الصفحة أو أعد تعيين تخطيطها.",
      "levelFilterLabel": "التصفية حسب مستوى السجل",
      "timeFilterLabel": "التصفية حسب النطاق الزمني",
      "window": {
        "1h": "ساعة",
        "24h": "24 ساعة",
        "7d": "7 أيام"
      },
      "heldCount": "+{count}",
      "missingSlotTitle": "لا يوجد عنصر سجل في هذه الصفحة",
      "missingSlotBody": "لا يحتوي التخطيط المخزَّن على خانة للسجل. أعد توليد الصفحة.",
      "loadFailed": "فشل استعلام السجل",
      "loading": "جارٍ تحميل مُدخلات السجل",
      "traceTitle": "التتبّع",
      "latestTitle": "أحدث نشاط",
      "backToLatest": "العودة إلى الأحدث",
      "eventFallback": "حدث"
    },
    "calendar": {
      "eventCount": "{count, plural, zero {{n} حدث} one {حدث واحد} two {حدثان} few {{n} أحداث} many {{n} حدثًا} other {{n} حدث}}",
      "composePlaceholder": "عنوان الحدث…",
      "addEvent": "إضافة حدث",
      "dateRange": "النطاق الزمني",
      "agendaTitle": "جدول الأعمال",
      "categoriesTitle": "الفئات",
      "upcomingTitle": "القادمة",
      "invalidLayout": "التخطيط المخزَّن لهذا التقويم غير صالح. أعد توليد الصفحة أو أعد تعيين تخطيطه."
    },
    "scheduler": {
      "previousWeek": "الأسبوع السابق",
      "nextWeek": "الأسبوع التالي",
      "week": "أسبوع",
      "month": "شهر",
      "invalidLayout": "التخطيط المخزَّن لهذا الجدول غير صالح. أعد توليد الصفحة أو أعد تعيين تخطيطه.",
      "shiftCount": "{count, plural, zero {{n} وردية} one {وردية واحدة} two {ورديتان} few {{n} ورديات} many {{n} وردية} other {{n} وردية}}",
      "addShift": "إضافة وردية"
    },
    "settings": {
      "title": "إعدادات الإشعارات",
      "subtitle": "اختر ما تريد أن تصلك إشعارات بشأنه وكيف تصلك",
      "matrixLabel": "أشعرني بشأن",
      "rowHeader": "الحدث",
      "saved": "تم الحفظ",
      "unavailableTag": "غير متاح بعد",
      "loading": "جارٍ تحميل التفضيلات",
      "errorTitle": "تعذّر تحميل هذه الإعدادات",
      "emptyTitle": "لا يوجد شيء للتهيئة بعد",
      "emptyBody": "تظهر أحداث الإشعارات هنا مع إطلاق مصادرها."
    },
    "pageCrud": {
      "description": "صفحة الجدول القياسية: شبكة بيانات قابلة للبحث، ونماذج إنشاء وتعديل، وحذف آمن مع فحص المراجع، وتغييرات قابلة للتراجع."
    },
    "pageDashboard": {
      "description": "لوحة معلومات من عناصر الواجهة فوق بياناتك: بطاقات مؤشرات ورسوم بيانية وقوائم على شبكة قابلة للتحرير."
    },
    "pageBoard": {
      "description": "لوحة كانبان مجمَّعة حسب حقل الحالة — اسحب البطاقات بين الأعمدة لتحديث السجلات."
    },
    "pageCalendar": {
      "description": "تقويم شهري مع جدول أعمال ومرشِّحات للفئات وإضافة سريعة للأحداث من حقل تاريخ."
    },
    "pageScheduler": {
      "description": "مصفوفة ورديات حسب الأسبوع والمورد مع تتبّع السعة وإجماليات التغطية."
    },
    "pageDirectory": {
      "description": "دليل أشخاص مع بحث ومرشِّحات للمجموعات ولوحة جانبية للملف الشخصي."
    },
    "pageMasterDetail": {
      "description": "تخطيط قائمة بجوار التفاصيل: اختر سجلًا من القائمة وتعامل معه في لوحة التفاصيل."
    },
    "pageQueueInbox": {
      "description": "قائمة انتظار للمراجعة مع قرارات الموافقة والرفض وإجراءات جماعية وتراجع."
    },
    "pageLogViewer": {
      "description": "جدول سجل يتابع الأحداث مباشرة مع مرشِّحات للمستوى والوقت ولوحة جانبية للتتبّع."
    },
    "pageFiles": {
      "description": "متصفح ملفات مع مجلدات ذكية ورفع للملفات ولوحة جانبية للمعاينة."
    },
    "pageChat": {
      "description": "صندوق وارد للمحادثات بجوار سلسلة الرسائل، مرتبط بجداول الرسائل لديك."
    },
    "pageBuilder": {
      "description": "منشئ مستندات بالسحب والإفلات مع لوحة كتل ولوحة خصائص ومسار نشر."
    },
    "pageWizard": {
      "description": "مسار موجَّه متعدد الخطوات يرشد المستخدمين عبر عملية منظَّمة."
    },
    "pageSettings": {
      "description": "مصفوفة تفضيلات إشعارات مع مفاتيح لكل قناة وحفظ تلقائي."
    }
  },
  "frame": {
    "noResult": "لا توجد نتيجة لعنصر الواجهة",
    "emptyTitle": "لا توجد بيانات لهذا النطاق",
    "loadError": "حدث خطأ أثناء تحميل عنصر الواجهة هذا.",
    "renderError": "تعذّر عرض عنصر الواجهة هذا.",
    "refreshing": "جارٍ التحديث",
    "infoLabel": "معلومات عنصر الواجهة",
    "menuLabel": "قائمة عنصر الواجهة"
  },
  "charts": {
    "livePillLabel": "مباشر",
    "forecast": {
      "nowLabel": "الآن",
      "forecastLabel": "المتوقَّع",
      "actualLabel": "الفعلي"
    },
    "otherLabel": "أخرى",
    "heat": {
      "lessLabel": "أقل",
      "moreLabel": "أكثر"
    },
    "choropleth": {
      "lowLabel": "منخفض",
      "highLabel": "مرتفع"
    },
    "funnel": {
      "stepConversion": "{pct}% يواصلون",
      "overallConversion": "{pct}% إجمالًا"
    }
  }
} as const;
