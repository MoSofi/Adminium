// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/assistant.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "ask": {
    "continue": "繼續",
    "pick": "請在每組中各選一項",
    "picked": "已選擇：{labels}",
    "ready": "就緒",
    "waiting": "等你決定"
  },
  "audit": {
    "note": "每一次操作都會記入稽核紀錄"
  },
  "button": "詢問 {name}",
  "buttonTitle": "就此頁面詢問 {name}",
  "close": "關閉",
  "composer": {
    "send": "傳送",
    "working": "處理中…"
  },
  "confirm": {
    "cancel": "取消"
  },
  "details": {
    "checks": "檢查項",
    "figures": "數字",
    "figuresValue": "{blocks, plural, other {# 個含數字的區塊}}",
    "format": "格式",
    "formatEmailValue": "Adminium 郵件 · {blocks, plural, other {# 個區塊}}",
    "formatInvoiceValue": "Adminium 發票範本 · {sections, plural, other {已啟用 # 個區段}}",
    "lines": "明細",
    "linesValue": "{lines, plural, other {# 筆明細}} · {total}",
    "noChecks": "未宣告",
    "none": "無",
    "notPublished": "未發布",
    "notPublishedValue": "已儲存為草稿",
    "notTouched": "未更動",
    "notTouchedValue": "不會更動任何客戶資料列，也不會寄送郵件",
    "record": "紀錄",
    "recordValue": "發票文件 · 新增 1 列 · 狀態為草稿",
    "sources": "已讀取的來源",
    "sourcesChosen": "選用的來源",
    "taxLines": "稅目",
    "taxLinesValue": "{rate}%",
    "tokens": "權杖",
    "tokensValue": "輸入 {in} · 輸出 {out}",
    "variables": "變數"
  },
  "diff": {
    "adds": "+{n}",
    "against": "與 {name} 比較",
    "dels": "−{n}",
    "new": "新建 {kind} — 將寫入的欄位",
    "truncated": "比較結果已截斷 — 開啟草稿檢視其餘部分。"
  },
  "draft": {
    "account": "帳戶",
    "draft": "草稿",
    "due": "到期",
    "issued": "開立",
    "lineCount": "{n, plural, other {# 筆明細}}",
    "lines": "擷取的明細",
    "notTouched": "不會更動任何客戶資料列，也不會寄送郵件。",
    "status": "狀態",
    "template": "範本",
    "total": "合計"
  },
  "echo": {
    "applied": "已放入編輯器 — 請檢查標示的區塊。"
  },
  "email": {
    "action1": "傳送測試郵件",
    "action2": "在編輯器中開啟",
    "action3": "儲存範本",
    "blurb": "了解本頁：{templates, plural, other {# 個範本}} · {campaigns, plural, other {# 個行銷活動}} · 品牌設定",
    "chip1": "為一張未付發票草擬催款郵件",
    "chip2": "建立提前 3 天的預約提醒",
    "chip3": "將歡迎範本在地化為德文",
    "confirm": {
      "body": "{name} 會在郵件範本中建立「{title}」草稿。在你上線之前不會寄送給任何客戶。",
      "bodyOpen": "{name} 會在郵件範本中建立「{title}」草稿，並在編輯器中開啟。",
      "button": "儲存為草稿",
      "title": "儲存為新範本？"
    },
    "echo": {
      "editor": "已儲存為草稿範本，正在編輯器中開啟。",
      "sample": "已為 {record} 產生範例。",
      "saved": "已儲存為草稿範本。",
      "test": "已用範例資料向 {email} 傳送測試。"
    },
    "greeting": "我看得到你的郵件範本 — 區塊格式、你的品牌設定，以及每個範本可用的變數。",
    "greetingSub": "描述你需要的郵件，我會依 Adminium 的範本格式草擬；儲存前你可以先寄一封測試郵件。",
    "language": {
      "saved": "已新增 {locale} 版本草稿。"
    },
    "page": "郵件範本",
    "placeholder": "描述你需要的範本…",
    "readPage": "郵件範本 · {templates, plural, other {# 個範本}} · 品牌設定",
    "scopePrimary": "email_templates",
    "workTitle": "已草擬新的郵件範本"
  },
  "error": {
    "generic": "這次沒有成功，請再問一次。",
    "smtp": "尚未設定郵件。請在郵件設定中新增一個中繼。",
    "tooLong": "這段對話超出模型的上下文 — 請開始新的工作階段。",
    "tryAgain": "重試"
  },
  "invoiceTemplate": {
    "action1": "換一個範例預覽",
    "action2": "在編輯器中開啟",
    "action3": "儲存範本",
    "blurb": "了解本頁：{templates, plural, other {# 個範本}} · 編號 {pattern} · {invoices, plural, other {# 張發票}}",
    "chip1": "為歐盟客戶建立適用逆向課稅的範本",
    "chip2": "為我的某個範本加入滯納金說明區段",
    "chip3": "把我的某個範本調整為我們的品牌色",
    "confirm": {
      "body": "{name} 會把「{title}」以草稿加入發票範本。既有發票不受影響。",
      "bodyOpen": "{name} 會把「{title}」以草稿加入發票範本，並在編輯器中開啟。",
      "button": "儲存為草稿",
      "title": "儲存為新的發票範本？"
    },
    "echo": {
      "editor": "已儲存為草稿，正在編輯器中開啟。",
      "noSample": "這裡沒有可用來產生範例的發票。",
      "sample": "已為 {record} 產生範例。",
      "saved": "已儲存為草稿範本。",
      "test": "已向 {email} 傳送測試。"
    },
    "greeting": "我看得到你的發票範本、編號規則，以及範本使用的稅目。",
    "greetingSub": "告訴我你需要的範本，我會依 Adminium 的發票格式建立，再用真實帳戶資料產生範例。",
    "language": {
      "saved": "已新增 {locale} 版本草稿。"
    },
    "page": "發票範本",
    "placeholder": "描述你需要的發票範本…",
    "readPage": "發票範本 · {templates, plural, other {# 個範本}} · 編號 {pattern}",
    "scopePrimary": "invoice_templates",
    "workTitle": "已建立新的發票範本"
  },
  "invoices": {
    "action1": "在編輯器中開啟",
    "action2": "建立發票草稿",
    "blurb": "了解本頁：{invoices, plural, other {# 張發票}} · {templates, plural, other {# 個範本}} · 你的角色可以{write, select, true {寫入} other {讀取}}",
    "chip1": "為某位客戶建立上個月的發票",
    "chip2": "用上個月未開立的項目草擬一張發票",
    "chip3": "列出已逾期的發票",
    "confirm": {
      "body": "{name} 會把這張發票以草稿加入發票清單。在你寄出之前不會更動任何客戶資料列。",
      "bodyOpen": "{name} 會把這張發票以草稿加入發票清單，並在編輯器中開啟。",
      "button": "建立草稿",
      "title": "建立這張發票草稿？"
    },
    "echo": {
      "editor": "已建立為草稿，正在發票編輯器中開啟。",
      "sample": "已為 {record} 產生範例。",
      "saved": "已建立為草稿，就在表格最上方。",
      "test": "已向 {email} 傳送測試。"
    },
    "greeting": "我看得到發票資料表、你的範本，以及發票資料可能的來源。",
    "greetingSub": "告訴我要向誰開立，我會先問用哪個範本、從哪裡取明細，然後才草擬。",
    "language": {
      "saved": "已新增 {locale} 版本草稿。"
    },
    "page": "發票",
    "placeholder": "例如：為某位客戶建立上個月的發票…",
    "readPage": "發票 · {invoices, plural, other {# 筆記錄}} · 你的角色可以{write, select, true {寫入} other {讀取}}",
    "scopePrimary": "invoices",
    "workTitle": "已草擬發票"
  },
  "readOnly": {
    "enable": "啟用操作",
    "lockedTitle": "啟用操作後 {name} 才能執行",
    "noWrite": "你的角色在這裡可以檢視、草擬與預覽，但無法儲存。",
    "noWriteTitle": "你的角色在這裡無法執行此操作",
    "note": "{name} 目前是唯讀的 — 可以檢視、草擬與預覽，但無法儲存、傳送或建立。"
  },
  "report": {
    "action1": "執行完整預覽",
    "action2": "在建構器中開啟",
    "action3": "儲存報表",
    "blurb": "了解本頁：{reports, plural, other {# 份報表}} · {connection} · {tables, plural, other {# 個可讀資料表}}",
    "chip1": "哪些客戶佔用最多支援時間？來源由你挑選",
    "chip2": "用客戶與訂單建立一份留存報表",
    "chip3": "建立每月營運回顧範本",
    "confirm": {
      "body": "{name} 會把「{title}」加入報表。它依需求執行 — 在你設定排程之前不會定時執行。",
      "bodyOpen": "{name} 會把「{title}」加入報表，並在建構器中開啟。",
      "button": "儲存報表",
      "title": "儲存這份報表？"
    },
    "echo": {
      "editor": "已儲存到報表，正在建構器中開啟。",
      "resampled": "已重新執行資料來源 — 更新了 {n, plural, other {# 項數據}}。",
      "resampledRefused": "已重新執行資料來源 — 更新了 {n, plural, other {# 項數據}}；{refused, plural, other {# 個資料來源}}無法讀取。",
      "sample": "已為 {record} 執行完整查詢。",
      "saved": "已儲存到報表。可在報表標題列新增排程。",
      "test": "已向 {email} 傳送測試。"
    },
    "greeting": "我看得到你的報表庫，以及你的角色在 {connection} 中可讀取的 {tables, plural, other {# 個資料表}}。",
    "greetingSub": "說出資料表與版面，或者直接把問題告訴我 — 我來挑選來源，並說明理由。",
    "language": {
      "saved": "已新增 {locale} 版本草稿。"
    },
    "page": "報表建構器",
    "placeholder": "要一份報表，或說出要用哪些資料表…",
    "readPage": "報表產生器 · {reports, plural, other {# 個報表}} · {tables, plural, other {# 張可讀資料表}}",
    "scopePrimary": "reports",
    "workTitle": "已建立報表"
  },
  "scope": {
    "connection": "{connection} · {n, plural, other {# 個資料表}}",
    "extra": "+{n}",
    "title": "本次工作階段可讀取的資料"
  },
  "steps": {
    "done": "完成",
    "failed": "失敗",
    "note": {
      "ready": "就緒",
      "warning": "{n, plural, other {# 則警告}}"
    },
    "readPage": "已讀取此頁面",
    "step": "第 {n} 步",
    "working": "正在處理"
  },
  "tabs": {
    "details": "詳細資料",
    "diff": "差異",
    "preview": "預覽"
  },
  "tokens": {
    "hint": "約 {n} 權杖",
    "title": "本次工作階段已用權杖",
    "value": "{n} 權杖"
  },
  "try": "試試",
  "unavailable": {
    "askAdmin": "請請管理員設定一個。",
    "forbidden": "你沒有使用 {name} 的權限。",
    "network": "本執行個體已關閉對外網路功能。",
    "noProvider": "尚未設定 AI 服務供應商。",
    "settings": "開啟 設定 → AI"
  }
} as const;
