// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/x.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "language": {
    "menu": "語言",
    "button": "語言：{name}"
  },
  "footer": {
    "questions": "有疑問？請寫信至",
    "privacyNotice": "隱私聲明"
  },
  "required": "必填",
  "optional": "選填",
  "send": "傳送",
  "sendAnswers": "送出回答",
  "sending": "正在傳送…",
  "preview": "此處不會送出任何內容。",
  "keeps": "{business} 會保留您傳送的內容，以便回覆您。",
  "summary": "請檢查下方標出的回答。",
  "proofFailed": "未能確認您是真人。請重試。",
  "honeypot": "此欄請留空",
  "anonymous": "您的回答不會與您的姓名連結。",
  "surveyAbout": "關於{record}。",
  "error": {
    "required": "請回答此問題。",
    "name": "請輸入您的姓名",
    "tooLong": "{max, plural, other {最多 # 個字元。}}",
    "email": "請輸入電郵地址，例如 name@company.com",
    "phone": "請輸入 6 到 15 位數字的電話號碼。",
    "choice": "請選擇其中一項。",
    "tooFew": "請至少選擇 {min} 項。",
    "tooMany": "請最多選擇 {max} 項。",
    "date": "請輸入日期。",
    "fromToday": "請選擇今天或之後的日期",
    "fromTomorrow": "請選擇明天或之後的日期",
    "number": "請輸入數字。",
    "whole": "請輸入整數。",
    "tooSmall": "請輸入 {min} 或更大的數。",
    "tooLarge": "請輸入 {max} 或更小的數。",
    "score": "請選擇 0 到 10 的分數。",
    "stars": "請選擇 1 到 5 顆星。",
    "file": "無法接收此檔案。",
    "tick": "請勾選此框，或留空。",
    "answer": "部分回答未被接收。請檢查後重新傳送。"
  },
  "file": {
    "chooseOne": "選擇檔案",
    "chooseMany": "選擇檔案",
    "hint": "{kinds}，最大 {mb} MB",
    "kind": {
      "pdf": "PDF",
      "jpg": "JPG",
      "png": "PNG",
      "text": "純文字"
    }
  },
  "files": {
    "remove": "移除 {file}",
    "added": "已新增 {file}。",
    "removed": "已移除 {file}。",
    "refused": "未新增 {file}。",
    "tooBig": "此檔案大小為 {size}。上限為 {mb} MB。",
    "kind": "不接受此類檔案。請使用 {kinds}。",
    "quota": "目前無法接收檔案。請稍後再試。",
    "cap": "今天從此處傳送的檔案過多。請明天再試。",
    "count": "最多可新增 {max, plural, other {# 個檔案}}。",
    "failed": "無法傳送此檔案。請重試。"
  },
  "score": {
    "low": "不太可能",
    "high": "非常可能",
    "ends": "0 表示不太可能，10 表示非常可能。"
  },
  "stars": {
    "of": "{n} / 5",
    "star": "{n, plural, other {# 星}}"
  },
  "ending": {
    "thanksName": "謝謝，{name}。",
    "thanks": "謝謝。",
    "confirmNewsletter": "電子報還差一步：請查看您的電郵並按「確認」。",
    "confirmSurveys": "問卷還差一步：請查看您的電郵並按「確認」。",
    "surveyThanksName": "謝謝您，{name}。",
    "surveyHelps": "您的回答對我們很有幫助。",
    "already": "您已回答過此問卷。謝謝。",
    "dead": "此連結無效。",
    "write": "請寫信至 {email}。",
    "closed": "此表單已關閉。",
    "tooMany": "此處傳送次數過多。請{when}再試，或寫信至 {email}。",
    "tooManyPlain": "此處傳送次數過多。請{when}再試。",
    "unavailable": "此頁面無法使用。",
    "noScript": "此表單需要 JavaScript。",
    "noScriptWrite": "您也可以寫信至 {email}。",
    "offline": "無法開啟此頁面。",
    "offlineBody": "請檢查網路連線後重試。",
    "retry": "重試",
    "continue": "繼續"
  },
  "chat": {
    "noScript": "此對話需要 JavaScript。",
    "asked": "您已要求由真人回覆。",
    "automatic": "自動回答",
    "automaticIn": "自動回答 · {language}",
    "away": {
      "again": "屆時請再與我們聯絡。",
      "later": "請稍後再與我們聯絡。",
      "leave": "請留下您的問題和電郵，我們會以電郵回覆。",
      "now": "我們暫時不在。",
      "sent": "{day, select, today {謝謝。我們會在 {time} 之後回覆至 {email}。} tomorrow {謝謝。我們會在 {time} 之後回覆至 {email}。} date {謝謝。我們會在 {date} {time} 之後回覆至 {email}。} other {謝謝。我們會在{weekday} {time} 之後回覆至 {email}。}}",
      "sentNone": "謝謝。我們會回覆至 {email}。",
      "until": "{day, select, today {我們今天 {time} 回來。} tomorrow {我們明天 {time} 回來。} date {我們 {date} {time} 回來。} other {我們{weekday} {time} 回來。}}"
    },
    "card": {
      "badEmail": "請輸入電郵地址，例如 name@company.example",
      "badName": "請填寫姓名，不要包含網址。",
      "change": "修改",
      "email": "您的電郵",
      "emailOptional": "您的電郵（選填）",
      "helper": "這樣即使您關閉此頁面，我們也能回覆您。",
      "name": "您的姓名（選填）",
      "needEmail": "請輸入您的電郵，以便我們回覆。",
      "needOne": "請先填寫姓名或電郵。",
      "needQuestion": "請先寫下您的問題。",
      "question": "您的問題",
      "save": "儲存",
      "send": "傳送"
    },
    "close": "關閉對話",
    "closed": "此對話已關閉 · {time}",
    "closedBy": "{name} 關閉了此對話 · {time}",
    "done": {
      "leave": "如果您離開，我們會回覆至 {email}。",
      "named": "謝謝，{name}。",
      "stay": "請保持此頁面開啟以查看回覆。",
      "thanks": "謝謝。"
    },
    "first": {
      "automatic": "這裡的部分回答是自動的，選自 {business} 撰寫的回答。真人可隨時接手。您的訊息會由 AI 服務（{service}）讀取。",
      "drafts": "這裡由真人回答。工作人員可能會使用 AI 服務（{service}）協助撰寫回覆。",
      "person": "這裡由真人回答。"
    },
    "from": "{business} 的 {name}",
    "hand": {
      "info": "將由真人在這裡回答。請保持此頁面開啟以查看回覆。",
      "text": "將由真人在這裡回答。"
    },
    "hide": "隱藏對話",
    "hours": {
      "openUntil": "今天營業至 {time}",
      "opens": "{day, select, today {今天 {time} 開始營業} tomorrow {明天 {time} 開始營業} date {{date} {time} 開始營業} other {{weekday} {time} 開始營業}}"
    },
    "hoursEnded": {
      "next": "{day, select, today {{business} 的營業時間已於 {closing} 結束。仍可能有人回覆；否則我們會在今天 {time} 之後回覆。} tomorrow {{business} 的營業時間已於 {closing} 結束。仍可能有人回覆；否則我們會在明天 {time} 之後回覆。} date {{business} 的營業時間已於 {closing} 結束。仍可能有人回覆；否則我們會在 {date} {time} 之後回覆。} other {{business} 的營業時間已於 {closing} 結束。仍可能有人回覆；否則我們會在{weekday} {time} 之後回覆。}}",
      "none": "{business} 的營業時間已於 {closing} 結束。仍可能有人回覆。"
    },
    "language": "語言",
    "languageOf": "語言：{name}",
    "log": "訊息",
    "lost": "找不到您先前的對話。請在下方開始新的對話。",
    "newChat": "開始新對話",
    "newMessages": "{count, plural, other {來自 {business} 的 {n} 則新訊息}}",
    "newTab": "（在新分頁中開啟）",
    "offline": "無法連線至 {business}。正在重試…",
    "privacy": "隱私聲明。",
    "rate": {
      "chat": "您在此對話中傳送了太多訊息。",
      "minute": "您傳送了太多訊息。請等候一分鐘後再試。",
      "wait": "您傳送了太多訊息。請等候 {minutes, plural, other {{n} 分鐘}}後再試。"
    },
    "reopened": "此對話已重新開啟 · {time}",
    "reopenedBy": "{name} 重新開啟了此對話 · {time}",
    "resumed": "您從 {time} 開始的對話",
    "send": "傳送",
    "status": {
      "checking": "正在確認您是真人…",
      "failed": "未能確認您是真人。",
      "notSent": "未傳送。",
      "queued": "等候傳送",
      "retry": "重試"
    },
    "talk": "與真人交談",
    "waiting": "仍在等候 {business} 的工作人員。",
    "waitingMail": "仍在等候 {business} 的工作人員。您可以留下電郵後關閉此頁面。",
    "with": "與 {business} 對話",
    "withNew": "與 {business} 對話，{count, plural, other {{n} 則新訊息}}",
    "write": "寫一則訊息…"
  }
} as const;
