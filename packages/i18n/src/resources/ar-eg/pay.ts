// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/ar-EG/pay.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "documentTitle": "دفع {label}",
  "documentTitlePlain": "الدفع",
  "testBand": "صفحة تجريبية — لا تُنقل أي أموال.",
  "language": {
    "menu": "اللغة",
    "button": "اللغة: {name}"
  },
  "hero": {
    "due": "المبلغ المستحق",
    "paid": "مدفوع",
    "started": "بدأ الدفع",
    "partly": "تم دفع {paid} من أصل {total} بالفعل.",
    "dueBy": "تاريخ الاستحقاق: {date}"
  },
  "ways": {
    "title": "طرق الدفع",
    "stripe": "الدفع بالبطاقة وبطرق أخرى",
    "stripeSub": "البطاقة أو Apple Pay أو Google Pay وغيرها، على صفحة Stripe الآمنة",
    "paypal": "الدفع عبر PayPal",
    "demo": "الدفع عبر الخدمة التجريبية",
    "demoSub": "أموال وهمية، في وضع الاختبار فقط",
    "online": "الدفع عبر الإنترنت",
    "bank": "الدفع بتحويل بنكي",
    "cash": "الدفع عند الاستلام",
    "other": "طريقة دفع أخرى",
    "gettingReady": "جارٍ التجهيز…",
    "noteStripe": "سيتم الدفع على صفحة Stripe. لا يرى هذا المتجر بطاقتك أبدًا.",
    "notePaypal": "سيتم الدفع على صفحة PayPal. لا يرى هذا المتجر بطاقتك أبدًا.",
    "noteBoth": "سيتم الدفع على صفحة Stripe أو صفحة PayPal. لا يرى هذا المتجر بطاقتك أبدًا."
  },
  "provider": {
    "stripe": "Stripe",
    "paypal": "PayPal",
    "demo": "الخدمة التجريبية",
    "other": "خدمة الدفع"
  },
  "redirect": {
    "title": "جارٍ تحويلك إلى {provider}…",
    "link": "لم يحدث شيء؟ المتابعة إلى {provider}",
    "notArabic": "صفحة Stripe غير متاحة باللغة العربية."
  },
  "checking": {
    "title": "جارٍ التحقق مع {provider}…",
    "body": "يستغرق هذا بضع ثوانٍ. يمكنك إغلاق هذه الصفحة؛ سيتلقى المتجر دفعتك رغم ذلك.",
    "slow": "يستغرق هذا وقتًا أطول من المعتاد. يمكنك إغلاق هذه الصفحة؛ سيتلقى المتجر دفعتك رغم ذلك."
  },
  "paid": {
    "title": "شكرًا لك. وصلت دفعتك البالغة {amount}.",
    "receiptAsk": "يمكنك طلب إيصال من {shop} عند الحاجة.",
    "already": "تم دفع هذا المبلغ. شكرًا لك.",
    "receiptSent": "الإيصال في طريقه إلى بريدك الإلكتروني."
  },
  "processing": {
    "title": "بنكك يؤكد الدفعة الآن",
    "withMethod": "بدأت دفعة بقيمة {amount} عبر {method} في {date}. يؤكدها بنكك خلال بضعة أيام عمل. لا حاجة إلى الدفع مرة أخرى.",
    "plain": "بدأت دفعة بقيمة {amount} في {date}. يؤكدها بنكك خلال بضعة أيام عمل. لا حاجة إلى الدفع مرة أخرى."
  },
  "failed": {
    "title": "لم تتم عملية الدفع.",
    "body": "لم يُخصم أي مبلغ.",
    "retry": "إعادة المحاولة"
  },
  "cancelled": {
    "title": "غادرت صفحة الدفع قبل إتمام الدفع.",
    "body": "لم يُخصم أي مبلغ.",
    "stripe": "غادرت صفحة Stripe قبل إتمام الدفع.",
    "paypal": "غادرت صفحة PayPal قبل إتمام الدفع."
  },
  "shopChecks": {
    "title": "سيراجع المتجر هذه الدفعة",
    "body": "تلقّينا دفعة، لكنها لا تطابق المبلغ المستحق. سيراجعها المتجر ويراسلك."
  },
  "retryLater": "يمكنك فتح رابط الدفع مرة أخرى للمحاولة من جديد.",
  "nothingDue": {
    "title": "لا يوجد ما يُدفع هنا بعد.",
    "body": "يُرجى التواصل مع {shop}."
  },
  "voided": {
    "title": "لم يعد من الممكن دفع هذا هنا.",
    "body": "يُرجى التواصل مع {shop}."
  },
  "expired": {
    "title": "انتهت صلاحية رابط الدفع هذا.",
    "body": "يمكنك طلب رابط جديد من {shop}."
  },
  "unknown": {
    "title": "هذا الرابط لا يعمل.",
    "body": "يمكنك طلب رابط جديد من {shop}."
  },
  "locked": {
    "title": "محاولات دفع كثيرة جدًا على هذا الرابط.",
    "bodyBank": "يُرجى المحاولة مرة أخرى بعد ساعة، أو الدفع بتحويل بنكي.",
    "body": "يُرجى المحاولة مرة أخرى بعد ساعة."
  },
  "noWays": {
    "title": "لا توجد طريقة لدفع هذا المبلغ عبر الإنترنت هنا.",
    "body": "يُرجى التواصل مع {shop}."
  },
  "unavailable": {
    "title": "لا يستطيع {shop} قبول المدفوعات عبر الإنترنت حاليًا.",
    "body": "يُرجى التواصل مع المتجر."
  },
  "testStaffOnly": {
    "title": "لا يُفتح رابط الاختبار هذا إلا لفريق عمل {shop}.",
    "body": "يُرجى تسجيل الدخول إلى لوحة المعلومات في هذا المتصفح، ثم فتح الرابط مرة أخرى."
  },
  "offline": {
    "title": "تعذّر على هذه الصفحة الوصول إلى المتجر.",
    "body": "يُرجى التحقق من اتصالك والمحاولة مرة أخرى.",
    "retry": "إعادة المحاولة"
  },
  "proofFailed": "لم ينجح التحقق من أنك شخص حقيقي. يُرجى المحاولة مرة أخرى.",
  "bank": {
    "title": "تحويل بنكي",
    "holder": "صاحب الحساب",
    "iban": "IBAN",
    "bic": "BIC",
    "accountNumber": "رقم الحساب",
    "sortCode": "رمز الفرز",
    "bankName": "البنك",
    "amount": "المبلغ",
    "reference": "المرجع",
    "note": "يُرجى استخدام هذا المرجع ليتمكن المتجر من العثور على دفعتك. تظهر الدفعة كمدفوعة بعد أن يتحقق منها المتجر.",
    "copy": "نسخ",
    "copied": "تم النسخ",
    "copyLabel": "نسخ {label}",
    "copiedLive": "تم نسخ {label}.",
    "otherWays": "طرق دفع أخرى",
    "noAccount": "يُرجى طلب البيانات البنكية لهذه العملة من {shop}."
  },
  "cash": {
    "title": "الدفع عند الاستلام",
    "plain": "يُدفع المبلغ المستحق عند وصول طلبك."
  },
  "footer": {
    "questions": "هل لديك أسئلة؟ يمكنك المراسلة على"
  },
  "demo": {
    "title": "خدمة الدفع التجريبية",
    "staff": "لفريق العمل فقط. خدمة دفع وهمية: لا تُنقل أي أموال ولا حاجة إلى بطاقة.",
    "succeeds": "الدفع: تنجح البطاقة",
    "fails": "الدفع: تُرفض البطاقة",
    "needsStep": "الدفع: يطلب البنك خطوة",
    "settlesLate": "الدفع: تصل الأموال لاحقًا",
    "finishStep": "إتمام خطوة البنك",
    "leave": "المغادرة دون دفع",
    "gone": "لا يمكن متابعة هذه الدفعة التجريبية. يُرجى العودة إلى صفحة الدفع."
  },
  "lines": {
    "title": "الغرض من هذه الدفعة"
  },
  "noscript": {
    "title": "تحتاج هذه الصفحة إلى JavaScript للدفع عبر الإنترنت."
  }
} as const;
