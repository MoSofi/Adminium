// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/payments.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "panel": {
    "balanceDue": "待付餘額",
    "paid": "已付",
    "paidInFull": "已全額付清",
    "copyLink": "複製付款連結",
    "emailLink": "以電子郵件傳送付款連結",
    "record": "記錄一筆付款",
    "revoke": "撤銷",
    "test": "測試",
    "refunded": "已退款",
    "linkLine": "付款連結建立於 {made} · 有效至 {until}",
    "waitingWith": "透過 {way} 的付款開始於 {date} · 等待銀行確認",
    "waitingPlain": "一筆線上付款開始於 {date} · 等待銀行確認",
    "recordedBy": "由 {name} 記錄",
    "online": "線上付款（{service}）",
    "refundedInline": "已退款 {amount}",
    "listLabel": "此筆記錄的付款",
    "notice": {
      "draft": "請先寄出發票。只有已寄出的發票才能記錄付款。",
      "private": "客戶無法連到此伺服器，因此付款連結已關閉。您仍可記錄付款。",
      "update": "此發票資料表需要其應用程式的更新才能接受線上付款。",
      "voided": "此發票已作廢，無法收款。",
      "noCurrency": "此筆記錄沒有幣別，因此無法記錄付款。",
      "unclear": "此筆記錄的金額在其幣別中不精確，因此無法記錄付款。",
      "notPayable": "此筆記錄目前無法接受付款。"
    },
    "by": {
      "bank-transfer": "透過銀行轉帳",
      "cash": "現金",
      "card": "透過我們自己的刷卡機",
      "cheque": "透過支票",
      "other": "其他方式",
      "online": "線上"
    },
    "toast": {
      "copied": "已複製付款連結。",
      "replaced": "新的付款連結已取代 {date} 建立的連結。",
      "revoked": "已撤銷付款連結。舊網址已失效。",
      "recorded": "已記錄 {amount} 的付款。",
      "copyFailed": "付款連結已建立，但此瀏覽器未能複製：{url}",
      "failed": "操作未成功：{message}",
      "emailed": "付款連結正在寄往 {to}。",
      "refundRequested": "已申請退款 {amount}。",
      "refundFailed": "退款 {amount} 失敗：{reason}"
    },
    "moreFor": "{ref} 的更多操作",
    "menu": {
      "refund": "退款…"
    },
    "why": {
      "pending": "這筆付款仍在等待銀行處理。",
      "full": "這筆付款已全額退款。",
      "offline": "這種付款方式無法線上退款。請自行退款給客戶。",
      "disputed": "這筆付款有爭議。請先在 {service} 主控台中回覆爭議。",
      "notTaken": "這筆付款沒有扣到款項。"
    },
    "disputed": "有爭議",
    "disputeLine": "有爭議 — 請在 {service} 主控台中回覆",
    "disputeNote": "若爭議敗訴，款項會退還給客戶。發票不會因此自動變更。",
    "disputeClosed": "爭議已結束。結果請在 {service} 主控台中查看。",
    "refundRequested": "已申請退款 {amount}",
    "refundWaitingCustomer": "退款 {amount} 正在等待客戶",
    "refundFailed": "退款 {amount} 失敗：{reason}。請聯絡客戶，並記錄你們商定的結果。",
    "refundFailedPlain": "退款 {amount} 失敗。請聯絡客戶，並記錄你們商定的結果。",
    "refundCancelled": "退款 {amount} 已取消。",
    "refundedOnInline": "已於 {date} 退款 {amount}",
    "refundedThere": "已於 {date} 在 {service} 主控台中退款 {amount} · 已記錄",
    "needsLook": "需要查看",
    "demoService": "示範服務"
  },
  "record": {
    "title": "記錄一筆付款",
    "amount": "金額",
    "way": "付款方式",
    "wayPh": "選擇付款方式",
    "ways": {
      "bank-transfer": "銀行轉帳",
      "cash": "現金",
      "card": "我們自己的刷卡機",
      "cheque": "支票",
      "other": "其他"
    },
    "date": "日期",
    "note": "備註",
    "notePh": "選填",
    "approval": "授權碼",
    "approvalHelp": "最多 12 個字母和數字。",
    "approvalErr": "只能使用字母和數字，最多 12 個。",
    "last4": "卡號末四碼",
    "last4Err": "只輸入卡號末四碼。",
    "cardNumber": "這看起來像完整的卡號。請勿在此填寫卡號。",
    "amountErr": "請輸入大於零的金額。",
    "overDue": "這超過了待付的 {amount}。",
    "dateErr": "付款日期不能在未來。",
    "pendingWarn": "有一筆線上付款正在等待銀行確認。再記錄一筆可能會重複收款。",
    "cancel": "取消",
    "submit": "記錄付款",
    "close": "關閉",
    "failed": "付款未記錄：{message}"
  },
  "notice": {
    "landed": {
      "title": "已收到付款",
      "body": "{label} 的 {amount}",
      "bodyWith": "{label} 的 {amount}，透過 {paidWith}"
    },
    "look": {
      "title": "有一筆付款需要查看",
      "notRecorded": "已在 {provider} 付款，未記錄：{label}",
      "notYet": "已在 {provider} 付款，尚未記錄：{label}",
      "amount": "已在 {provider} 付款，但金額與要求不符：{label}",
      "voided": "作廢後在 {provider} 付款：{label}",
      "mode": "在 {provider} 以另一種模式付款，未獲認可：{label}",
      "twice": "在 {provider} 付款了兩次：{label}",
      "missing": "已記錄的付款已不存在：{label}",
      "refundedThere": "已在 {provider} 主控台中退款：{label} 的 {amount}。已記錄。"
    },
    "key": {
      "title": "{provider} 拒絕了金鑰",
      "body": "在儲存可用的金鑰之前，付款已暫停。"
    },
    "webhook": {
      "title": "{provider} 的 webhook 沒有訊息",
      "body": "自 {date} 起沒有事件。將透過查詢找到付款，速度較慢。",
      "bodyNever": "尚未收到任何正式事件。將透過查詢找到付款，速度較慢。"
    },
    "reads": {
      "title": "Adminium 向 {provider} 查詢的頻率降低",
      "body": "本月 {provider} 允許的查詢次數已用掉一半。"
    },
    "keysRemoved": {
      "title": "{provider} 的金鑰已刪除",
      "body": "由 {by} 刪除。在儲存新金鑰之前，不會透過 {provider} 開始任何付款。"
    },
    "redirect": {
      "account": "某個付款金鑰現在屬於另一個帳戶",
      "bank": "銀行轉帳的銀行資料已變更",
      "payAddress": "付款地址已變更",
      "body": "原為 {from} · 現為 {to} · 由 {by} 變更",
      "byTo": "現為 {to} · 由 {by} 變更",
      "byOnly": "由 {by} 變更"
    },
    "refundFailed": {
      "title": "退款失敗",
      "body": "{amount} 退至 {paidWith}"
    },
    "dispute": {
      "title": "已提出爭議",
      "body": "{label} · 請在 {date} 前回覆",
      "bodyNoDate": "{label} · 請在 {provider} 主控台中回覆"
    }
  },
  "refund": {
    "step1": "第 1 步，共 2 步",
    "step2": "第 2 步，共 2 步",
    "title": "退款",
    "close": "關閉",
    "amount": "金額",
    "full": "全額",
    "part": "部分",
    "upTo": "最多可退款 {amount}",
    "reason": "原因",
    "reasons": {
      "requested_by_customer": "客戶要求",
      "duplicate": "重複付款",
      "fraudulent": "詐欺",
      "other": "其他"
    },
    "note": "備註",
    "notePh": "選填",
    "goesBack": "退回至 {paidWith}。通常需要 5–10 天。",
    "goesBackPlain": "依原付款方式退回。通常需要 5–10 天。",
    "cancel": "取消",
    "continue": "繼續",
    "question": "要退款 {amount} 至 {paidWith} 嗎？",
    "questionPlain": "要退款 {amount} 嗎？",
    "cantUndo": "此操作無法復原。",
    "back": "返回",
    "submit": "退款",
    "failed": "未能申請退款：{message}",
    "lost": "沒有收到回覆。請再次點擊「退款」：這會請求同一筆退款，絕不會退第二次。"
  }
} as const;
