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
  "keeps": "{business} 會保留您傳送的內容，以便回覆您。",
  "summary": "請檢查下方標出的回答。",
  "proofFailed": "未能確認您是真人。請重試。",
  "honeypot": "此欄請留空",
  "anonymous": "您的回答不會與您的姓名連結。",
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
  }
} as const;
