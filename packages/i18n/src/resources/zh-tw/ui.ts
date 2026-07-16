/**
 * GENERATED MIRROR of ../../../locales/zh-TW/ui.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "close": "關閉",
    "cancel": "取消",
    "confirm": "確認",
    "save": "儲存",
    "apply": "套用",
    "delete": "刪除",
    "edit": "編輯",
    "copy": "複製",
    "copied": "已複製",
    "undo": "復原",
    "retry": "重試",
    "clear": "清除",
    "selectAll": "全選",
    "clearSelection": "清除選取",
    "showPassword": "顯示密碼",
    "hidePassword": "隱藏密碼",
    "reveal": "顯示",
    "hide": "隱藏"
  },
  "state": {
    "loading": "載入中…",
    "empty": "這裡還沒有內容",
    "noResults": "沒有結果",
    "optional": "選填",
    "required": "必填",
    "error": "發生錯誤"
  },
  "pagination": {
    "previous": "上一頁",
    "next": "下一頁",
    "pageOf": "第 {page, number} 頁，共 {pages, number} 頁",
    "rowsPerPage": "每頁列數",
    "range": "第 {from, number}–{to, number} 筆，共 {total, number} 筆"
  },
  "table": {
    "sortAscending": "遞增排序",
    "sortDescending": "遞減排序",
    "rowActions": "列動作",
    "selectRow": "選取此列",
    "selectAllRows": "選取所有列"
  },
  "dialog": {
    "close": "關閉對話方塊",
    "confirmTitle": "確定要繼續嗎？"
  },
  "combobox": {
    "placeholder": "請選取…",
    "search": "搜尋…",
    "noMatches": "沒有符合項目"
  },
  "toast": {
    "dismiss": "關閉通知"
  },
  "widgets": {
    "charts": {
      "boxplot": {
        "description": "依類別彙總數值欄位分佈的盒鬚圖——最小值、四分位數、中位數與最大值。",
        "emptyTitle": "沒有可繪製的分佈",
        "emptyBody": "沒有符合篩選條件的資料列可用於盒鬚圖。"
      },
      "violin": {
        "description": "鏡像密度曲線，比較數值欄位在各群組之間的分佈。",
        "emptyTitle": "沒有可繪製的分佈",
        "emptyBody": "沒有符合篩選條件的資料列可用於密度曲線。"
      },
      "ridgeline": {
        "description": "重疊的密度山脊圖，比較數值欄位在有序群組間的分佈。",
        "emptyTitle": "沒有可繪製的山脊",
        "emptyBody": "沒有符合篩選條件的資料列可用於密度曲線。"
      },
      "scatterBubble": {
        "description": "將兩個數值欄位繪製為散佈點，可選氣泡大小與趨勢線。",
        "emptyTitle": "沒有可繪製的散佈點",
        "emptyBody": "沒有符合篩選條件的資料列符合所選欄位。"
      },
      "hexbin": {
        "description": "兩個數值欄位的六邊形密度圖，依每格落入的資料列數著色。",
        "emptyTitle": "沒有可繪製的密度",
        "emptyBody": "沒有符合篩選條件的資料列可供分箱。"
      },
      "correlationMatrix": {
        "description": "所選數值欄位之間的皮爾森相關性，從強正相關到強負相關。",
        "emptyTitle": "沒有可計算的相關性",
        "emptyBody": "請至少選擇兩個具有相符資料列的數值欄位。"
      },
      "parallelCoordinates": {
        "description": "將每筆記錄繪製為跨多個正規化數值軸的折線，依類別著色。",
        "emptyTitle": "沒有可繪製的記錄",
        "emptyBody": "沒有符合篩選條件的資料列涵蓋所選各軸。"
      }
    },
    "feeds": {
      "activityFeed": {
        "description": "依時間倒序顯示工作區中誰做了什麼的動態資訊流。",
        "emptyTitle": "尚無近期動態",
        "emptyBody": "工作區中的操作將顯示在這裡。"
      },
      "notificationFeed": {
        "description": "帶未讀狀態、篩選與內嵌操作的分組通知。",
        "emptyTitle": "尚無通知",
        "emptyBody": "新通知將顯示在這裡。"
      },
      "realtimeFeed": {
        "description": "即時事件串流，新項目抵達時會置於頂端。",
        "emptyTitle": "正在等待事件",
        "emptyBody": "即時事件將隨發生即時顯示。"
      },
      "timelineVertical": {
        "description": "事件、發佈、事故或執行步驟的垂直時間軸。",
        "emptyTitle": "這裡還沒有內容",
        "emptyBody": "事件將隨發生顯示在此時間軸上。"
      },
      "unreadBadge": {
        "description": "顯示未讀項目的計數標記，與資訊流狀態同步。",
        "unitLabel": "未讀"
      }
    },
    "calendar": {
      "calendarMonth": {
        "description": "按月顯示已排程事件的格線，含每日標籤與月份導覽。",
        "emptyTitle": "尚無排程",
        "emptyBody": "已排程的事件將顯示在此行事曆中。"
      },
      "dayAgenda": {
        "description": "所選日期的事件依時間排序的議程。",
        "emptyTitle": "尚無排程",
        "emptyBody": "所選日期的事件將顯示在此處。"
      },
      "scheduleMatrix": {
        "description": "依資源與日期排列的班次格線，含每日涵蓋情形與圖例。",
        "emptyTitle": "尚無排班",
        "emptyBody": "已指派的班次將顯示在此排班表中。"
      },
      "capacityBoard": {
        "description": "依成員顯示使用率長條，含專案細分與負載狀態。",
        "emptyTitle": "尚無工作量資料",
        "emptyBody": "有指派後，成員的使用率將顯示在此處。"
      }
    },
    "tables": {
      "masterList": {
        "description": "可選取的記錄清單，用於驅動詳細資料窗格。",
        "emptyTitle": "尚無項目",
        "emptyBody": "項目存在後將顯示在這裡。"
      },
      "logTable": {
        "description": "帶搜尋、錯誤篩選與列操作的附加式事件記錄。",
        "emptyTitle": "尚無記錄項目",
        "emptyBody": "事件將隨發生記錄在這裡。"
      },
      "cardGallery": {
        "description": "帶狀態與快捷操作的自適應實體卡片庫。",
        "emptyTitle": "尚無內容",
        "emptyBody": "項目將以卡片形式顯示在這裡。"
      },
      "groupedSummaryTable": {
        "description": "帶彙總欄、可展開明細與合計的分組列。",
        "emptyTitle": "尚無彙總資料",
        "emptyBody": "有資料後分組合計將顯示在這裡。"
      },
      "schemaTree": {
        "description": "帶型別與索引鍵標章的結構描述、資料表與欄位瀏覽器。",
        "emptyTitle": "尚未讀取結構描述",
        "emptyBody": "連接資料庫即可在此瀏覽其結構描述。"
      },
      "toggleMatrix": {
        "description": "用於角色、原則或管道的布林開關互動格線。",
        "emptyTitle": "尚未設定矩陣",
        "emptyBody": "設定後列與欄將顯示在這裡。"
      }
    },
    "boards": {
      "kanbanBoard": {
        "description": "固定的狀態欄與可拖曳卡片；將卡片拖到其他欄即可更新其狀態。",
        "emptyTitle": "尚無卡片",
        "emptyBody": "建立記錄後，卡片將出現在對應的狀態欄中。"
      },
      "kanbanSwimlaneGrid": {
        "description": "泳道 × 欄的格線；拖曳卡片會同時重新指派其泳道與狀態。",
        "emptyTitle": "沒有可顯示的泳道",
        "emptyBody": "依泳道欄位與狀態欄位將記錄分組以建立格線。"
      },
      "addCard": "新增卡片",
      "grip": "拖曳以移動卡片",
      "pointsUnit": "點",
      "laneSummary": "Σ{points} 點 · {count}",
      "a11y": {
        "grabbed": "已抓取 {title}。使用方向鍵移動，Enter 放下，Esc 取消。",
        "over": "{title} 位於 {cell} 上方。",
        "moved": "已將 {title} 移動到 {cell}。",
        "returned": "{title} 已返回原位。",
        "failed": "無法移動 {title}；已返回原位。"
      }
    },
    "communication": {
      "conversationInbox": {
        "description": "可選取的對話清單，顯示未讀數量、上線狀態與最近訊息預覽。",
        "emptyTitle": "尚無對話",
        "emptyBody": "收到訊息後，對話將顯示在這裡。",
        "noMatchesTitle": "沒有相符的對話",
        "searchLabel": "搜尋對話",
        "searchPlaceholder": "搜尋對話…"
      },
      "chatThread": {
        "description": "依傳送者與日期分組的訊息泡泡，支援附件與輸入框。",
        "emptyTitle": "尚無訊息",
        "emptyBody": "此對話中的訊息將顯示在這裡。",
        "composerPlaceholder": "輸入訊息…",
        "sendLabel": "傳送",
        "attachLabel": "新增附件",
        "typingLabel": "正在輸入…"
      },
      "aiChatPanel": {
        "description": "用於詢問資料庫結構與資料的助理面板。",
        "emptyTitle": "詢問你的資料",
        "emptyBody": "提出關於結構、資料表或指標的問題即可開始。",
        "composerPlaceholder": "提出問題…",
        "sendLabel": "傳送",
        "pendingLabel": "思考中…",
        "configureTitle": "尚未設定 AI 供應商",
        "configureBody": "新增 Anthropic 或 OpenAI 金鑰，或將 Adminium 指向你自己的端點，即可詢問資料庫結構。",
        "configureCtaLabel": "設定供應商"
      }
    },
    "domain": {
      "orgChart": {
        "description": "依人員資料表的主管參照建立的匯報關係樹，分支可摺疊。",
        "emptyTitle": "尚無匯報結構",
        "emptyBody": "當人員記錄參照主管後，組織圖便會顯示於此。",
        "reportsLabel": "部屬 · {count}",
        "a11yLabel": "組織圖"
      },
      "ganttChart": {
        "description": "時間軸上的任務長條，依階段分組，含進度、里程碑與今日標記。",
        "emptyTitle": "尚無排程",
        "emptyBody": "任務設定開始與結束日期後便會顯示於此。",
        "ungroupedLabel": "任務"
      }
    },
    "media": {
      "fileBrowser": {
        "description": "以磁磚格線或清單瀏覽檔案與資料夾，支援麵包屑導覽、類型圖示與星號標記。",
        "emptyTitle": "此資料夾是空的",
        "emptyBody": "上傳檔案或建立資料夾即可開始。"
      },
      "uploadDropzone": {
        "description": "用於上傳檔案的拖放區域，可限制格式與大小。",
        "dropTitle": "拖放檔案以上傳",
        "browsePrefix": "或",
        "browseLabel": "瀏覽"
      },
      "uploadProgressList": {
        "description": "逐一檔案的上傳列，附進度列與狀態；同樣適用於匯出佇列作業。",
        "emptyTitle": "沒有進行中的上傳",
        "emptyBody": "您上傳的檔案將在此顯示進度。"
      },
      "attachmentList": {
        "description": "附加至記錄的檔案，附類型圖示、大小以及下載或刪除動作。",
        "emptyTitle": "沒有附件",
        "emptyBody": "附加至此記錄的檔案將顯示於此。"
      },
      "imageBoard": {
        "description": "附說明文字的圖片格線靈感板，適用於含圖片 URL 的資料表。",
        "emptyTitle": "尚無圖片",
        "emptyBody": "參考圖片將顯示在此看板上。"
      },
      "linkList": {
        "description": "附標題與網址的參考連結，於新分頁開啟。",
        "emptyTitle": "尚無連結",
        "emptyBody": "參考連結將顯示於此。"
      },
      "root": "檔案",
      "breadcrumb": "麵包屑導覽",
      "gridView": "格線檢視",
      "listView": "清單檢視",
      "nameHeader": "名稱",
      "sizeHeader": "大小",
      "modifiedHeader": "修改時間",
      "star": "星號標記",
      "items": "項",
      "done": "完成",
      "failed": "失敗",
      "queued": "佇列中",
      "retry": "重試",
      "download": "下載",
      "cancel": "取消",
      "delete": "刪除",
      "remove": "移除",
      "addImage": "新增圖片",
      "caption": "說明文字",
      "addLink": "新增連結",
      "linkTitlePlaceholder": "標題",
      "linkUrlPlaceholder": "https://…",
      "add": "新增"
    },
    "forms": {
      "modalWizard": {
        "description": "帶成功確認的彈窗建立表單——標準的「新增記錄」流程。",
        "trigger": "建立",
        "submit": "建立",
        "cancel": "取消",
        "done": "完成",
        "successTitle": "記錄已建立",
        "successBody": "記錄已儲存。",
        "required": "此欄位為必填。"
      },
      "drawerForm": {
        "description": "用於欄位較多記錄的側邊抽屜建立或編輯表單。",
        "trigger": "新增",
        "submit": "儲存",
        "cancel": "取消"
      },
      "stepper": {
        "description": "顯示多步驟流程進度的步驟指示器。",
        "a11yLabel": "進度"
      },
      "progressBar": {
        "description": "帶百分比說明的確定進度條。",
        "label": "進度"
      },
      "otpInput": {
        "description": "一次性驗證碼輸入欄位。",
        "label": "一次性驗證碼"
      },
      "chipInput": {
        "description": "標籤輸入：可移除的標籤加上按 Enter 提交的自由文字。",
        "remove": "移除",
        "placeholder": "輸入後按 Enter…"
      },
      "segmentedControl": {
        "description": "用於時間範圍、環境與篩選的單選分段控制項。",
        "a11yLabel": "選擇一項"
      },
      "filterChipBar": {
        "description": "篩選標籤，計數依所篩選的清單即時計算。",
        "all": "全部",
        "a11yLabel": "篩選",
        "meta": "{total} 筆中的 {shown} 筆"
      },
      "toggleSwitchList": {
        "description": "設定列清單，每列附一個開關。",
        "save": "儲存",
        "dirty": "您有未儲存的變更",
        "emptyTitle": "尚無設定",
        "emptyBody": "設定完成後將顯示於此。"
      },
      "optionCards": {
        "description": "用於資料來源、範本與方案的單選卡片格線。",
        "a11yLabel": "選擇一項"
      },
      "passwordStrengthMeter": {
        "description": "顯示密碼強度的四段式指示器。",
        "label": "密碼強度",
        "weak": "弱",
        "fair": "普通",
        "good": "良好",
        "strong": "強"
      },
      "validationIssuesList": {
        "description": "匯入與驗證問題，依嚴重程度排序，並顯示受影響的列數。",
        "emptyTitle": "未發現問題",
        "emptyBody": "一切正常——可以開始匯入。"
      }
    },
    "chrome": {
      "sidebarNav": {
        "description": "應用程式的分組導覽列，附即時計數標記。",
        "a11yLabel": "主導覽",
        "emptyTitle": "尚無導覽",
        "emptyBody": "產生連線後，已納入的資料表將顯示於此。"
      },
      "commandPalette": {
        "description": "⌘K 命令面板：隨時搜尋動作、頁面與記錄。",
        "title": "命令面板",
        "placeholder": "搜尋動作、頁面與記錄…",
        "navigate": "導覽",
        "select": "開啟",
        "close": "關閉",
        "emptyTitle": "無結果",
        "emptyBody": "開始輸入以搜尋。",
        "groupActions": "動作",
        "groupNavigate": "導覽",
        "groupRecent": "最近",
        "groupPages": "頁面",
        "groupMetrics": "指標",
        "groupPeople": "人員",
        "groupRecords": "記錄"
      },
      "globalSearch": {
        "description": "跨所有實體搜尋，附類型分面與結果摘要。",
        "placeholder": "搜尋全部…",
        "all": "全部",
        "summary": "「{query}」的 {count} 筆結果",
        "emptyTitle": "無結果",
        "emptyBody": "請嘗試其他搜尋字詞。"
      },
      "breadcrumb": {
        "description": "目前記錄或資料夾的階層路徑。",
        "a11yLabel": "麵包屑導覽"
      },
      "tabBar": {
        "description": "用於切換面板或導覽的分頁，可附計數。",
        "a11yLabel": "分頁"
      },
      "navCard": {
        "description": "用於導覽頁與登陸頁的連結卡片格線。",
        "emptyTitle": "無內容可顯示",
        "emptyBody": "頁面產生後連結將顯示於此。"
      },
      "shortcutsPanel": {
        "description": "鍵盤快速鍵速查表。",
        "footerHint": "隨時按 ?",
        "then": "接著",
        "emptyTitle": "未註冊任何快速鍵。"
      },
      "avatarStack": {
        "description": "帶「+N」溢位與可選在線狀態的重疊頭像。",
        "online": "{count} 人在線"
      }
    },
    "system": {
      "stateHero": {
        "description": "用於 404、500、離線、無權限與維護狀態的整頁狀態畫面。",
        "notFoundTitle": "這個頁面走錯路了",
        "notFoundBody": "您要找的頁面已被移動、重新命名，或從未存在。",
        "serverErrorTitle": "我們這邊出了點問題",
        "serverErrorBody": "錯誤已記錄並已通知團隊。重試通常有效。",
        "offlineTitle": "您已離線",
        "offlineBody": "請檢查網路連線——儀表板會自動重新連線。",
        "forbiddenTitle": "您沒有存取權限",
        "forbiddenBody": "請聯絡工作區管理員為您授予此頁面的權限。",
        "maintenanceTitle": "維護中",
        "maintenanceBody": "我們正在改進。通常只需幾分鐘。",
        "connErrorTitle": "無法連線資料庫",
        "connErrorBody": "連線遭拒或逾時。請檢查連線設定。",
        "backToDashboard": "返回儀表板",
        "tryAgain": "重試",
        "retry": "重試",
        "testConnection": "測試連線"
      },
      "emptyState": {
        "description": "帶可選動作的置中「尚無內容」面板。"
      },
      "statusPill": {
        "description": "用於列舉欄位的彩色標記——通用狀態呈現器。"
      },
      "alertBanner": {
        "description": "用於配額、凍結與排程提示的內嵌提示列。",
        "dismiss": "關閉"
      },
      "statusBannerHero": {
        "description": "服務健康狀態橫幅，其狀態取自清單中最差的服務。",
        "upTitle": "所有系統運作正常",
        "upBody": "所有受監控的服務均正常回應。",
        "degradedTitle": "效能降低",
        "degradedBody": "部分服務比平常慢。我們正在調查。",
        "downTitle": "重大故障",
        "downBody": "一項或多項服務無法使用。我們正在處理。"
      },
      "connectionStatus": {
        "description": "資料庫連線的連線或測試結果。",
        "idle": "未連線",
        "connecting": "連線中…",
        "connected": "已連線",
        "failed": "連線失敗",
        "test": "測試"
      },
      "autosaveIndicator": {
        "description": "自動儲存文件的「未儲存 → 儲存中 → 已儲存」標記。",
        "dirty": "有未儲存的變更",
        "saving": "儲存中…",
        "saved": "所有變更已儲存",
        "error": "儲存失敗"
      },
      "progressLogConsole": {
        "description": "帶進度條的串流日誌主控台，用於長時間執行的工作。",
        "a11yLabel": "進度日誌",
        "progressLabel": "進度",
        "emptyTitle": "尚無內容",
        "emptyBody": "工作開始後日誌將顯示於此。"
      },
      "diagnosticsReadout": {
        "description": "連線檢查結果，以帶顏色的鍵/值列顯示，並附檢查時間。",
        "checkedAt": "最後檢查",
        "host": "主機",
        "dns": "DNS",
        "tcp": "TCP",
        "tls": "TLS",
        "auth": "驗證",
        "latency": "延遲"
      }
    }
  },
  "grid": {
    "dragHandle": "拖曳以移動 {title}",
    "resizeHandle": "調整 {title} 的大小",
    "a11y": {
      "grabbed": "已抓取 {title}。使用方向鍵移動，按住 Shift 調整大小，Enter 儲存，Esc 取消。",
      "moved": "{title} 已移動到第 {col} 欄，第 {row} 列。",
      "resized": "{title} 已調整為 {w} 欄 × {h} 列。",
      "committed": "{title} 已放置在第 {col} 欄，第 {row} 列。",
      "reverted": "{title} 已返回原始位置。"
    }
  }
} as const;
