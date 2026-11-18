// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/ar-EG/xChat.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "asked": "طلبت التحدث إلى شخص.",
  "automatic": "إجابة تلقائية",
  "automaticIn": "إجابة تلقائية · باللغة {language}",
  "away": {
    "again": "اكتب إلينا مرة أخرى حينها.",
    "later": "اكتب إلينا مرة أخرى لاحقًا.",
    "leave": "اترك سؤالك وبريدك الإلكتروني، وسنرد عليك بالبريد الإلكتروني.",
    "now": "لسنا متاحين الآن.",
    "opens": "{day, select, today {اليوم الساعة {time}} tomorrow {غدًا الساعة {time}} date {{date} الساعة {time}} other {يوم {weekday} الساعة {time}}}",
    "sent": "{day, select, today {شكرًا. سنرد على {email} بعد الساعة {time}.} tomorrow {شكرًا. سنرد على {email} بعد الساعة {time}.} date {شكرًا. سنرد على {email} في {date} بعد الساعة {time}.} other {شكرًا. سنرد على {email} يوم {weekday} بعد الساعة {time}.}}",
    "sentNone": "شكرًا. سنرد على {email}.",
    "until": "{day, select, today {لسنا متاحين حتى الساعة {time} اليوم.} tomorrow {لسنا متاحين حتى الساعة {time} غدًا.} date {لسنا متاحين حتى {date} الساعة {time}.} other {لسنا متاحين حتى يوم {weekday} الساعة {time}.}}"
  },
  "card": {
    "badEmail": "أدخل بريدًا إلكترونيًا مثل name@company.example",
    "badName": "اكتب اسمك دون عنوان ويب.",
    "change": "تغيير",
    "email": "بريدك الإلكتروني",
    "emailOptional": "بريدك الإلكتروني (اختياري)",
    "helper": "حتى نتمكن من الرد إذا أغلقت هذه الصفحة.",
    "name": "اسمك (اختياري)",
    "needEmail": "أدخل بريدك الإلكتروني حتى نتمكن من الرد.",
    "needOne": "أضف اسمك أو بريدك الإلكتروني أولًا.",
    "needQuestion": "اكتب سؤالك أولًا.",
    "question": "سؤالك",
    "save": "حفظ",
    "send": "إرسال"
  },
  "close": "إغلاق المحادثة",
  "closed": "أُغلقت هذه المحادثة · {time}",
  "closedBy": "أُغلقت هذه المحادثة بواسطة {name} · {time}",
  "done": {
    "leave": "إذا غادرت، سنرد على {email}.",
    "named": "شكرًا يا {name}.",
    "stay": "أبقِ هذه الصفحة مفتوحة لترى الرد.",
    "thanks": "شكرًا."
  },
  "first": {
    "automatic": "بعض الإجابات هنا تلقائية، مختارة من إجابات كتبتها {business}. يمكن لشخص أن يتولى المحادثة في أي وقت. تقرأ رسائلك خدمة ذكاء اصطناعي ({service}).",
    "drafts": "يرد هنا شخص. قد يستخدم الموظفون خدمة ذكاء اصطناعي ({service}) للمساعدة في كتابة الردود.",
    "person": "يرد هنا شخص."
  },
  "from": "{name} من {business}",
  "hand": {
    "info": "سيرد عليك شخص هنا. أبقِ هذه الصفحة مفتوحة لترى الرد.",
    "text": "سيرد عليك شخص هنا."
  },
  "hide": "إخفاء المحادثة",
  "hours": {
    "openUntil": "مفتوح اليوم حتى {time}",
    "opens": "{day, select, today {يفتح اليوم الساعة {time}} tomorrow {يفتح غدًا الساعة {time}} date {يفتح في {date} الساعة {time}} other {يفتح يوم {weekday} الساعة {time}}}"
  },
  "hoursEnded": {
    "next": "{day, select, today {انتهت ساعات عمل {business} الساعة {closing}. قد يرد شخص مع ذلك؛ وإلا فسنرد اليوم بعد الساعة {time}.} tomorrow {انتهت ساعات عمل {business} الساعة {closing}. قد يرد شخص مع ذلك؛ وإلا فسنرد غدًا بعد الساعة {time}.} date {انتهت ساعات عمل {business} الساعة {closing}. قد يرد شخص مع ذلك؛ وإلا فسنرد في {date} بعد الساعة {time}.} other {انتهت ساعات عمل {business} الساعة {closing}. قد يرد شخص مع ذلك؛ وإلا فسنرد يوم {weekday} بعد الساعة {time}.}}",
    "none": "انتهت ساعات عمل {business} الساعة {closing}. قد يرد شخص مع ذلك."
  },
  "language": "اللغة",
  "languageOf": "اللغة: {name}",
  "log": "الرسائل",
  "lost": "لم نعثر على محادثتك السابقة. ابدأ محادثة جديدة أدناه.",
  "newChat": "بدء محادثة جديدة",
  "newMessages": "{count, plural, zero {لا رسائل جديدة من {business}} one {رسالة جديدة واحدة من {business}} two {رسالتان جديدتان من {business}} few {{n} رسائل جديدة من {business}} many {{n} رسالة جديدة من {business}} other {{n} رسالة جديدة من {business}}}",
  "newTab": "(يفتح في علامة تبويب جديدة)",
  "offline": "تعذّر الوصول إلى {business}. نحاول مرة أخرى…",
  "privacy": "إشعار الخصوصية.",
  "rate": {
    "chat": "أرسلت رسائل كثيرة في هذه المحادثة.",
    "minute": "أرسلت رسائل كثيرة. انتظر دقيقة، ثم حاول مرة أخرى.",
    "wait": "أرسلت رسائل كثيرة. انتظر {minutes, plural, zero {{n} دقيقة} one {دقيقة واحدة} two {دقيقتين} few {{n} دقائق} many {{n} دقيقة} other {{n} دقيقة}}، ثم حاول مرة أخرى."
  },
  "reopened": "أُعيد فتح هذه المحادثة · {time}",
  "reopenedBy": "أُعيد فتح هذه المحادثة بواسطة {name} · {time}",
  "resumed": "محادثتك من {time}",
  "send": "إرسال",
  "status": {
    "checking": "نتحقق من أنك شخص…",
    "failed": "لم نتمكن من التحقق من أنك شخص.",
    "notSent": "لم تُرسل.",
    "queued": "في انتظار الإرسال",
    "retry": "حاول مرة أخرى"
  },
  "talk": "التحدث إلى شخص",
  "waiting": "ما زلنا ننتظر أحدًا من {business}.",
  "waitingMail": "ما زلنا ننتظر أحدًا من {business}. يمكنك ترك بريدك الإلكتروني وإغلاق هذه الصفحة.",
  "with": "محادثة مع {business}",
  "withNew": "محادثة مع {business}، {count, plural, zero {لا رسائل جديدة} one {رسالة جديدة واحدة} two {رسالتان جديدتان} few {{n} رسائل جديدة} many {{n} رسالة جديدة} other {{n} رسالة جديدة}}",
  "write": "اكتب رسالة…"
} as const;
