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
  "actions": {
    "saved": "已儲存"
  },
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
  "automation": {
    "action1": "在建構器中開啟",
    "action2": "儲存規則（關閉狀態）",
    "blurb": "了解本頁：{rules, plural, other {# 條規則}} · {templates, plural, other {# 個已啟用的郵件範本}} · {tables, plural, other {# 個可讀資料表}}",
    "chip1": "訂單出貨時寄一封感謝信給客戶",
    "chip2": "新增客戶時通知管理員",
    "chip3": "每天早上標記已超過要求日期的訂單",
    "confirm": {
      "body": "{name} 會把「{title}」以關閉狀態加入自動化規則。在你開啟之前不會執行任何內容。",
      "bodyOpen": "{name} 會把「{title}」以關閉狀態加入自動化規則，並在建構器中開啟。",
      "button": "以關閉狀態儲存",
      "title": "儲存這條規則？"
    },
    "echo": {
      "editor": "已以關閉狀態儲存，正在建構器中開啟。",
      "saved": "已儲存到自動化規則，處於關閉狀態。"
    },
    "greeting": "我看得到你的自動化規則、已啟用的郵件範本，以及你的角色可讀取的資料表。",
    "greetingSub": "說明什麼時候該發生什麼，我來起草規則。儲存後它是關閉的，直到你將它開啟。",
    "page": "自動化規則",
    "placeholder": "描述你需要的規則…",
    "readPage": "自動化規則 · {rules, plural, other {# 條規則}} · {tables, plural, other {# 個可讀資料表}}",
    "scopePrimary": "automations",
    "workTitle": "已起草新規則",
    "applied": "已套用到此規則，尚未儲存。",
    "apply": "套用到此規則",
    "handoff": "開啟郵件範本來草擬一個。",
    "handoffSub": "此對話會隨你一起過去。",
    "handoffOpen": "開啟郵件範本",
    "waiting": "等待範本",
    "savedOff": "將以關閉狀態儲存",
    "notSaved": "在你儲存規則之前，不會儲存任何內容。",
    "workTitleChange": "已修改開啟的規則"
  },
  "button": "詢問 {name}",
  "buttonTitle": "就此頁面詢問 {name}",
  "close": "關閉",
  "composer": {
    "send": "傳送",
    "working": "處理中…"
  },
  "mic": {
    "speak": "對 {name} 說話",
    "stop": "停止聆聽",
    "listening": "正在聆聽",
    "asking": "請允許使用麥克風以便對 {name} 說話",
    "working": "正在記錄您說的話…",
    "check": "檢查文字，然後傳送。",
    "stopped": "已在 {minutes, plural, other {# 分鐘}}時停止。",
    "blocked": "此網站的麥克風已被封鎖。請在瀏覽器網址列中允許它。",
    "used": "今天的語音時間已用完。",
    "failed": "沒有成功。請再試一次。",
    "noticeProvider": "您說的話會傳送給 {provider} 進行記錄。不會保留任何內容。",
    "noticeBrowser": "您說的話由瀏覽器內建的語音服務記錄。",
    "noticeOk": "好",
    "ownService": "您工作區的模型服務"
  },
  "speak": {
    "play": "朗讀",
    "stop": "停止朗讀",
    "settings": "朗讀",
    "readAloud": "朗讀回覆",
    "speed": "速度",
    "voice": "語音",
    "voiceDefault": "瀏覽器內建的",
    "draft": "有一份草稿供您查看。",
    "proposal": "我已把將要變更的內容顯示在畫面上，供您查看。"
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
    "tryAgain": "重試",
    "modelFormat": "此模型的回答方式不是 {name} 需要的。請在「設定 → AI」中換一個模型。",
    "modelFormatAsk": "此模型的回答方式不是 {name} 需要的。請讓管理員換一個模型。",
    "setup": "剛才無法讀取此頁面。請再問一次。",
    "busy": "你的上一個問題還在處理中。請等它完成，或先停止它。",
    "budget": "處理到一半停下了：今天的額度已用完。"
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
    "noWrite": "你的角色在這裡可以檢視、草擬與預覽，但無法儲存。",
    "noWriteTitle": "你的角色在這裡無法執行此操作",
    "switchedOff": "此工作區已為 {name} 關閉儲存。",
    "openSettings": "開啟設定",
    "switchedOffTitle": "此工作區已為 {name} 關閉儲存"
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
  "tryFrom": "來自 {addOn}",
  "unavailable": {
    "askAdmin": "請請管理員設定一個。",
    "forbidden": "你沒有使用 {name} 的權限。",
    "network": "本執行個體已關閉對外網路功能。",
    "noProvider": "尚未設定 AI 服務供應商。",
    "settings": "開啟 設定 → AI"
  },
  "budget": {
    "usedUp": "今天的額度已用完。將於 {time} 重新開始。"
  },
  "data": {
    "page": "此頁面",
    "blurb": "了解此頁面：{table} · {tables, plural, other {# 張可讀的資料表}}",
    "blurbNoTable": "了解此頁面 · {tables, plural, other {# 張可讀的資料表}}",
    "greeting": "我可以讀取此頁面顯示的內容，以及你的角色可以讀取的其他資料表。",
    "greetingSub": "可以問這裡的資料列。我用文字回答，附上數字，並說明讀了哪些資料表。",
    "placeholder": "就這些資料提問…",
    "chip1": "這裡顯示了多少列？",
    "chip2": "總結此頁面顯示的內容",
    "chip3": "最近有什麼變化？",
    "workTitle": "已讀取資料",
    "scopePrimary": "此頁面",
    "readPage": "{page} · {table} · {tables, plural, other {# 張可讀的資料表}}",
    "readPageNoTable": "{tables, plural, other {# 張可讀的資料表}}",
    "confirm": {
      "title": "這裡沒有可儲存的內容",
      "body": "{name} 在此頁面不起草任何內容。",
      "button": "關閉"
    }
  },
  "general": {
    "page": "此工作區",
    "blurb": "瞭解此工作區 · {tables, plural, other {# 張可讀的資料表}}",
    "greeting": "我可以讀取您的角色有權讀取的資料表，並告訴您在哪裡完成各項操作。",
    "greetingSub": "可以詢問您的資料，或在哪裡變更某項內容。我會用文字回答，並附上該位置的連結。",
    "placeholder": "詢問此工作區…",
    "chip1": "在哪裡邀請同事？",
    "chip2": "我在此工作區能看到什麼？",
    "chip3": "哪個資料表的列數最多？",
    "workTitle": "已查詢",
    "scopePrimary": "工作區",
    "readPage": "{tables, plural, other {# 張可讀的資料表}}"
  },
  "answer": {
    "from": "來源：",
    "part": "已讀取 {table} 的 {total, number} 列中的 {returned, number} 列。",
    "nothingRead": "此回答未讀取任何資料。",
    "readAgain": "重新讀取",
    "readAgainAsk": "{question} 請讀取資料後再回答。",
    "forgot": "{name} 已不再記得最早的 {count, plural, other {# 則訊息}}。"
  },
  "suggestion": {
    "open": "開啟",
    "openLabel": "在 Add-ons 中開啟 {addOn}",
    "askAdmin": "請讓管理員安裝此項。"
  },
  "panel": {
    "loading": "正在載入對話…",
    "recordOpen": "{page} · 已開啟 {record}",
    "rowsShown": "{page} · {rows, plural, other {顯示 # 列}}",
    "new": "新對話",
    "earlier": "{count, plural, other {有 # 則較早的訊息未顯示}}。",
    "onPage": "在 {page}",
    "closedElsewhere": "此對話已在另一個視窗中關閉。",
    "stillWorking": "{name} 仍在處理您的上一個問題。",
    "stop": "停止",
    "pageDialog": "請先關閉頁面上開啟的內容，再使用 {name}。",
    "aged": "您先前的對話因時間過久已關閉。"
  },
  "chip": {
    "selected": "{count, plural, other {已選 # 項}}",
    "record": "已開啟的紀錄",
    "filtered": "{rows, plural, other {# 列已篩選}}",
    "filteredUnknown": "已篩選的列",
    "remove": "不含「{label}」提問"
  },
  "parked": {
    "madeOn": "建立於 {page}。",
    "open": "開啟 {page} 以使用此草稿",
    "deleted": "此草稿的文件已被刪除。"
  },
  "proposal": {
    "checking": {
      "title": "待確認的變更",
      "line": "正在檢查會變更什麼…"
    },
    "badge": {
      "replaced": "已被取代",
      "expired": "已過期",
      "cancelled": "已取消",
      "parked": "已擱置"
    },
    "replaced": "之後又問了別的問題。沒有任何變更。",
    "expired": "此提議已過了 30 分鐘。請重新提問。",
    "overCap": "共 {count} 項變更；一次最多可確認 {cap} 項。更多請使用頁面自帶的批次工具。",
    "applying": "處理中…",
    "undone": "已復原。一切恢復原狀。",
    "undonePart": "已收回 {count, plural, other {#}} 項變更。",
    "undoneRest": "其餘保持已變更。",
    "interrupted": "此操作中途停止了。",
    "group": {
      "done": "已完成",
      "check": "請檢查此項",
      "checkLine": "儲存被中斷。它可能已變更，也可能沒有。",
      "notTried": "未嘗試",
      "shared": "{count, plural, other {#}} 列的 {field} {arrow} {value}"
    },
    "openHome": "開啟{page}",
    "notTried": "未嘗試：同時請求過多。請一分鐘後再問。",
    "again": "重新提議其餘部分",
    "againAsk": "請重新提議未完成的變更：\n{rows}",
    "undo": "復原",
    "undoSome": "復原 {total} 項中的 {count} 項",
    "undoPassed": "復原時間已過。",
    "noUndo": "此操作無法在這裡復原。",
    "noUndoSome": "{count, plural, other {#}} 項變更無法在這裡復原。",
    "notChanged": "以下 {count, plural, other {#}} 項未變更：",
    "cancelled": "沒有任何變更。",
    "parked": "開啟{page}以使用此項。",
    "someRefused": "{count, plural, other {#}} 項變更中有 {refused} 項無法執行。",
    "changedSince": "自向你顯示後，此內容已有變化。確認前請再看一次。",
    "fix": "請 {name} 修正",
    "fixAsk": "其中一部分無法執行。請去掉以下內容後重新提議：\n{reasons}",
    "send": {
      "template": "範本",
      "subject": "主旨",
      "to": "收件者",
      "roles": "所有擁有 {roles} 角色的人（{count, plural, other {#}} 人）",
      "open": "開啟範本",
      "skipped": "{count, plural, other {#}} 人已取消訂閱，不會收到。"
    },
    "more": "還有 {count} 項。放大檢視全部。",
    "irreversible": "此操作無法復原。",
    "chosen": "已選 {picked}/{count}",
    "large": "放大檢視",
    "doc": {
      "email": "郵件範本",
      "report": "報告",
      "rule": "規則",
      "invoice": "發票",
      "invoiceTemplate": "發票範本"
    },
    "ask": {
      "change": "變更 {count, plural, other {#}} 列",
      "add": "新增 {count, plural, other {#}} 列",
      "delete": "刪除 {count, plural, other {#}} 列",
      "save": "另存為新的{what}",
      "saveOver": "覆寫儲存「{name}」",
      "deleteDoc": "刪除「{name}」",
      "deleteDocs": "刪除 {count, plural, other {#}} 份文件",
      "send": "傳送給 {count, plural, other {#}} 人",
      "mixed": "執行 {count, plural, other {#}} 項變更"
    },
    "done": {
      "changePart": "已變更 {count, plural, other {#}} 列中的 {done} 列。",
      "part": "已執行 {count, plural, other {#}} 項變更中的 {done} 項。",
      "change": "已變更 {count, plural, other {#}} 列。",
      "add": "已新增 {count, plural, other {#}} 列。",
      "delete": "已刪除 {count, plural, other {#}} 列。",
      "save": "已儲存。",
      "deleteDoc": "已刪除 {count, plural, other {#}} 份文件。",
      "send": "正在傳送給 {count, plural, other {#}} 人。",
      "mixed": "已執行 {count, plural, other {#}} 項變更。"
    },
    "refused": {
      "generic": "伺服器拒絕了此操作。",
      "switchedOff": "此工作區已為 {name} 關閉此功能。",
      "notThisTable": "在這裡只能變更提問所在頁面的資料表。",
      "notData": "這不是你的資料表。",
      "noChange": "該列已是這些值。",
      "unsafeKey": "無法使用該 ID。",
      "notFound": "此項已不存在。",
      "notOffered": "無法在這裡執行此操作。",
      "builtIn": "內建郵件需在其自己的頁面上變更。",
      "notCampaign": "只有行銷郵件可以傳送給人員。",
      "noRecipients": "沒有人會收到這封郵件。",
      "notLive": "草稿需由人開啟後才能傳送。"
    },
    "row": {
      "untitled": "未命名",
      "new": "新列",
      "switchesOff": "儲存後為關閉狀態：檢視後再重新開啟。"
    },
    "delete": {
      "reference": "{table} 中 {count} 列",
      "references": "其他列參照了此項：{list}。它們會隨之刪除或變更，與頁面本身的刪除相同。"
    },
    "noneAble": "這些都無法執行",
    "checkAgain": "重新檢查",
    "undoFailed": "{count, plural, other {#}} 項變更未能收回。請重試。",
    "parkedNoHome": "請回到提出此問題的{page}以使用它。"
  },
  "leftOut": {
    "title": "我省略了什麼，以及原因",
    "nothing": "沒有。"
  }
} as const;
