// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/designer.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "brand": "Adminium Designer",
  "spent": {
    "title": "此連結已使用過",
    "body": "再次執行 design 指令以開啟 Adminium Designer。",
    "copy": "複製指令",
    "copied": "已複製"
  },
  "topbar": {
    "home": "Adminium Designer 首頁",
    "toDark": "切換到深色主題",
    "toLight": "切換到淺色主題",
    "dashboard": "開啟儀表板",
    "language": "語言"
  },
  "home": {
    "title": "你想建立什麼？",
    "lead": "描述它。Adminium 提供資料庫、儀表板、登入和 API。",
    "promptLabel": "描述你的應用程式",
    "placeholder": "描述你的應用程式…",
    "placeholderNoModel": "新增一個模型即可開始",
    "send": "傳送",
    "noModel": "Adminium Designer 使用你自己的 AI 模型。新增一個即可開始。",
    "cannotBuild": "此模型無法建立應用程式：它不支援工具。請選擇其他模型。",
    "failed": "Designer 無法啟動"
  },
  "target": {
    "label": "建立內容：{target}",
    "menu": "建立內容",
    "auto": "自動",
    "autoLine": "由 Adminium 決定",
    "dashboard": "僅儀表板",
    "dashboardLine": "資料表和管理頁面",
    "web": "網頁",
    "webLine": "員工端或客戶端"
  },
  "examples": {
    "label": "範例",
    "refresh": "顯示其他範例",
    "repair": {
      "label": "維修店",
      "text": "一家維修店：顧客送來物品，員工記錄工單和零件，物品可取時顧客會收到訊息。"
    },
    "classes": {
      "label": "課程報名",
      "text": "小工作室的課程報名：每週課表、每堂課的名額、候補名單以及前一天的提醒。"
    },
    "loans": {
      "label": "設備借用",
      "text": "團隊設備借用：誰借了哪件物品、何時歸還，逾期時發送提醒。"
    },
    "catering": {
      "label": "外燴訂單",
      "text": "外燴訂單：顧客選擇菜單和日期，員工確認，廚房每天都能看到要準備什麼。"
    },
    "volunteers": {
      "label": "志工排班",
      "text": "社區廚房的志工排班：每週的班次、誰報名了哪個班次，以及仍空缺的班次清單。"
    },
    "nursery": {
      "label": "苗圃庫存",
      "text": "苗圃的庫存：植物及其規格和價格、每個苗床上的數量，以及本週需要換盆的植物。"
    },
    "grooming": {
      "label": "寵物狗美容",
      "text": "寵物狗美容預約：飼主在線上為狗狗預約時段，員工查看當天安排，每次到訪都保留備註。"
    },
    "tutoring": {
      "label": "家教課程",
      "text": "家教課程：學生、家教老師和科目，每週預約的課程，以及每堂課教了什麼。"
    },
    "bikes": {
      "label": "自行車租賃",
      "text": "自行車租賃：車輛及其狀況、按小時或按天出租，以及目前已租出的車輛。"
    },
    "lost": {
      "label": "失物招領",
      "text": "失物招領處：登記交來的物品及其拾獲地點和時間，並提供一個公開頁面讓人們描述遺失的物品。"
    },
    "foodbank": {
      "label": "食物銀行領取",
      "text": "食物銀行領取：家庭登記並預約領取時間，員工將每個包裹標記為已發放。"
    },
    "rooms": {
      "label": "房間預訂",
      "text": "共享工作室的房間預訂：房間、誰在何時預訂了哪一間，並且不會有兩個預訂時間重疊。"
    }
  },
  "start": {
    "title": "從一個應用程式開始",
    "filters": "篩選應用程式",
    "all": "全部",
    "browse": "瀏覽全部",
    "loading": "正在載入應用程式清單",
    "off": "此安裝已關閉線上應用程式清單。",
    "failed": "無法載入應用程式清單。",
    "stillDescribe": "你仍然可以在上方描述一個應用程式。",
    "retry": "重試",
    "startThis": "從這個開始",
    "startApp": "從這個開始：{name}",
    "staffSide": "員工端",
    "customerSide": "客戶端"
  },
  "apps": {
    "title": "你的應用程式",
    "noVersions": "尚無版本",
    "versions": "{count, plural, other {# 個版本}}",
    "edited": "{when}編輯",
    "continue": "繼續",
    "continueApp": "繼續 {name}"
  },
  "model": {
    "add": "新增模型",
    "button": "模型：{model}",
    "buttonCannot": "模型：{model}。它無法建立應用程式。",
    "choose": "選擇模型",
    "fromSettings": "{provider} · 儲存在設定中",
    "find": "尋找模型",
    "list": "模型",
    "empty": "尚無模型。",
    "cannotBuild": "無法建立",
    "cannotBuildHint": "此模型不支援工具，因此無法建立應用程式。",
    "unreachable": "無法連線到此連線",
    "retry": "重試",
    "keyRefused": "金鑰遭到拒絕。",
    "testFailed": "測試失敗：{message}",
    "chooseProvider": "選擇供應商",
    "addedChip": "已新增",
    "close": "關閉",
    "address": "位址",
    "key": "API 金鑰",
    "optional": "選填",
    "keySaved": "已儲存一組金鑰。輸入新金鑰即可取代。",
    "showKey": "顯示金鑰",
    "hideKey": "隱藏金鑰",
    "copyKey": "複製金鑰",
    "copied": "已複製",
    "model": "模型",
    "testKeyFirst": "測試金鑰以列出模型",
    "testAddressFirst": "測試位址以列出模型",
    "connected": "已連線。{model} 在 {seconds} 秒內回應。",
    "checking": "正在詢問此模型能否建立…",
    "canBuild": "此模型可以建立應用程式。",
    "cannotBuildSave": "此模型無法建立應用程式：它不支援工具。你仍可將其儲存用於其他用途。",
    "keptLead": "儲存位置：",
    "kept": "在本機專案資料夾中的 {file} 檔案裡。它不會傳送到瀏覽器，也不會提交到 git。",
    "back": "返回",
    "test": "測試",
    "testing": "正在測試…",
    "save": "儲存",
    "saving": "正在儲存…",
    "addedToast": "已新增模型。"
  },
  "provider": {
    "anthropic": "Anthropic",
    "openai": "OpenAI",
    "compatible": "相容 OpenAI",
    "ollama": "Ollama（本機）",
    "anthropicLine": "Claude 模型。需要 API 金鑰。",
    "openaiLine": "GPT 模型。需要 API 金鑰。",
    "compatibleLine": "任何使用相同協定的服務。需要位址。",
    "ollamaLine": "在本機上執行的模型。無需金鑰。"
  },
  "build": {
    "answerFailed": "未能接收回答",
    "answerPlaceholder": "回答上面的問題…",
    "chat": "對話",
    "empty": "描述要建立或修改的內容，Designer 就會開始。",
    "halves": "對話與預覽",
    "home": "返回 Designer",
    "message": "給 Adminium Designer 的訊息",
    "missing": "此工作階段不在這裡",
    "missingBody": "它可能屬於另一個專案資料夾。",
    "openDashboard": "在儀表板中開啟",
    "placeholder": "描述一項修改…",
    "preview": "預覽",
    "rename": "此應用程式的名稱",
    "renameApp": "重新命名 {name}",
    "resize": "調整對話寬度",
    "saveFailed": "變更未儲存",
    "stop": "停止",
    "stopFailed": "無法停止本輪",
    "turnFailed": "Designer 無法開始本輪",
    "work": "應用程式"
  },
  "card": {
    "addIt": "新增",
    "doWithout": "不用了",
    "keepAll": "保留它們",
    "keepAsWas": "保持原樣",
    "keepColumn": "保留該欄位",
    "keepTable": "保留該資料表",
    "kept": "已保留。",
    "narrow": "收窄 {table} 中的 {column}：{rows, plural, other {# 列不再符合}}。無論如何它們都會保留。",
    "narrowIt": "收窄",
    "narrowTitle": "此變更會收窄一個欄位",
    "narrowed": "已收窄。",
    "noAnswer": "未作答。",
    "ownWords": "用我自己的話回答",
    "package": "需要一個套件：{name}（{version}）。要新增嗎？",
    "packageNo": "你選擇不用它。",
    "packageYes": "你同意了。",
    "removalTitle": "此變更會刪除資料",
    "removeAll": "刪除它們及其資料",
    "removeColumn": "從 {table} 刪除欄位 {column} 會刪除其中儲存的內容：有 {rows} 列有值。",
    "removeIt": "刪除它及其資料",
    "removeTable": "刪除資料表 {table} 會刪除其 {rows, plural, other {# 列}}。",
    "removed": "已刪除。",
    "youAnswered": "你的回答：{answer}"
  },
  "step": {
    "addOns": "正在查看附加元件",
    "addOnsDone": "已查看附加元件",
    "answered": "你已回答",
    "applied": "已套用到資料庫",
    "applying": "正在套用應用程式",
    "asking": "正在詢問你",
    "buildFailed": "畫面未能建置",
    "building": "正在建置畫面",
    "built": "已建置畫面",
    "checkedClean": "已檢查應用程式 — 無錯誤",
    "checkedErrors": "{count, plural, other {已檢查應用程式 — # 個錯誤}}",
    "checking": "正在檢查應用程式",
    "deleted": "已刪除 {subject}",
    "deleting": "正在刪除 {subject}",
    "edited": "已編輯 {subject}",
    "editing": "正在編輯 {subject}",
    "failed": "此步驟失敗",
    "listed": "已列出檔案",
    "listing": "正在列出檔案",
    "noScreens": "沒有需要建置的畫面",
    "notApplied": "未套用",
    "packageAdded": "已新增 {subject}",
    "packageAsking": "正在請求新增 {subject}",
    "packageDeclined": "未使用 {subject}",
    "packageFailed": "無法新增 {subject}",
    "packageRefused": "未新增套件",
    "read": "已讀取 {subject}",
    "reading": "正在讀取 {subject}",
    "stopped": "已停止",
    "testing": "正在執行應用程式的測試",
    "testsFailed": "測試失敗",
    "testsPassed": "測試通過",
    "writing": "正在寫入 {subject}",
    "wrote": "已寫入 {subject}",
    "wroteMany": "{count, plural, other {已寫入 # 個檔案}}"
  },
  "steps": {
    "count": "{count, plural, other {# 步}}",
    "running": "（進行中）",
    "summary": "{count, plural, other {# 步}} · {seconds} 秒",
    "usage": "第 {step} 步 · 目前已用 {tokens} 個詞元",
    "working": "正在處理",
    "seconds": "{seconds} 秒"
  },
  "turn": {
    "continue": "繼續",
    "continueMessage": "繼續。",
    "failed": "本輪失敗：{message} 沒有遺失任何內容。",
    "keepGoing": "繼續進行",
    "keepGoingMessage": "繼續進行。",
    "limitSaved": "目前的工作已儲存為 {version}。",
    "limitSessionTokens": "本工作階段已達到 {value} 個詞元的用量上限。",
    "limitSteps": "本輪已達到 {value} 步的上限。",
    "limitTurnTokens": "本輪已達到 {value} 個詞元的上限。",
    "modelFailed": "模型停止了回應（{provider}，{status}）。沒有遺失任何內容。",
    "notApplied": "本輪的變更未被套用：{message}",
    "putBack": "還原檔案",
    "putBackDone": "檔案已恢復原樣。",
    "retry": "重試",
    "saved": "已儲存為 {version}",
    "stopped": "已停止。本輪的內容都沒有儲存為版本。"
  },
  "versions": {
    "button": "版本 {version}：{name}",
    "cancel": "取消",
    "confirm": "回到此版本",
    "confirmBody": "你的檔案會回到 {version}。{later} 仍留在清單中，你可以再往前。資料庫中已有的資料會保留。",
    "confirmBodyNone": "你的檔案會回到 {version}。資料庫中已有的資料會保留。",
    "confirmTitle": "回到 {version}？",
    "current": "目前",
    "failed": "無法還原檔案",
    "goBack": "回到此版本",
    "goBackTo": "回到 {version}：{name}",
    "notApplied": "它們未被套用。下一輪會說明原因。",
    "off": "版本功能已關閉",
    "offHint": "版本功能需要本機安裝 git。請安裝 git 後重新啟動 Designer。",
    "title": "版本",
    "wentBack": "你的檔案已恢復為 {version} 時的樣子。"
  },
  "work": {
    "architecture": "架構",
    "architectureSoon": "{name} 的構成會顯示在這裡。",
    "preview": "預覽",
    "previewSoon": "{name} 的預覽會顯示在這裡。"
  }
} as const;
