// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/common.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "common": {
    "dismiss": "關閉",
    "notifications": "通知",
    "retry": "重試",
    "undo": "復原",
    "close": "關閉",
    "cancel": "取消",
    "back": "返回",
    "loading": "載入中",
    "clearSearch": "清除搜尋",
    "clear": "清除",
    "save": "儲存"
  },
  "auth": {
    "headline": "把任何資料庫變成儀表板。",
    "trust": "AGPL 核心 · 自行架設 · 資料永遠屬於你",
    "signIn": {
      "title": "歡迎回來",
      "subtitle": "登入你的 Adminium 工作區。",
      "email": "電子郵件",
      "emailInvalid": "請輸入有效的電子郵件地址。",
      "password": "密碼",
      "passwordRequired": "請輸入密碼。",
      "remember": "保持登入",
      "showPassword": "顯示密碼",
      "hidePassword": "隱藏密碼",
      "forgot": "忘記密碼？",
      "submit": "登入",
      "invalid": "電子郵件或密碼不正確。",
      "rateLimited": "嘗試次數過多——請一分鐘後再試。",
      "failed": "登入失敗。請檢查網路連線後再試一次。"
    },
    "forgot": {
      "title": "重設密碼",
      "email": "電子郵件",
      "emailInvalid": "請輸入有效的電子郵件地址。",
      "submit": "傳送重設連結",
      "sentTitle": "請查看你的信箱",
      "resend": "再寄一次",
      "back": "返回登入",
      "done": "返回登入",
      "rateLimited": "要求次數過多——請稍後再試。",
      "failed": "發生錯誤。請再試一次。",
      "smtpUnconfigured": "此 Adminium 未設定郵件伺服器，無法寄送重設連結。請請管理員為你重設密碼。",
      "subtitle": "輸入你的電子郵件，我們就會寄送重設連結給你。",
      "sentBody": "我們已將重設連結寄至 {email}，連結將於 15 分鐘後失效。",
      "resendHint": "沒有收到嗎？"
    },
    "reset": {
      "title": "設定新密碼",
      "subtitle": "至少 8 個字元。",
      "password": "新密碼",
      "confirm": "確認密碼",
      "showPassword": "顯示密碼",
      "hidePassword": "隱藏密碼",
      "strength": "密碼強度",
      "weak": "弱",
      "fair": "普通",
      "good": "良好",
      "strong": "強",
      "tooShort": "請至少使用 8 個字元。",
      "submit": "重設密碼",
      "failed": "重設失敗。請再試一次。",
      "mismatch": "兩次輸入的密碼不一致。"
    },
    "otp": {
      "title": "兩步驟驗證",
      "subtitle": "請輸入驗證器應用程式中的 6 位數驗證碼。",
      "code": "一次性驗證碼",
      "recoveryCode": "備用碼",
      "useRecovery": "裝置遺失？使用備用碼",
      "useAuthenticator": "改用驗證器應用程式",
      "submit": "驗證",
      "invalid": "驗證碼不正確。請再試一次。",
      "failed": "驗證失敗。請檢查網路連線後再試一次。"
    }
  },
  "nav": {
    "home": "首頁",
    "primary": "主要",
    "account": "帳戶",
    "signOut": "登出",
    "empty": "連接資料庫後，頁面會出現在這裡。",
    "connection": {
      "shared": "共用",
      "unnamed": "連線"
    },
    "imports": "匯入資料",
    "exports": "資料匯出",
    "emailTemplates": "郵件範本",
    "notificationSettings": "通知設定",
    "scheduledReports": "排程報表",
    "group": {
      "workspace": "工作區",
      "library": "資源庫",
      "planning": "規劃",
      "people": "人員",
      "account": "帳戶"
    },
    "back": "返回",
    "team": "團隊",
    "roles": "角色與權限",
    "audit": "稽核紀錄",
    "security": "密碼與工作階段"
  },
  "topbar": {
    "search": "搜尋…",
    "notifications": "通知",
    "notificationsLoading": "正在載入通知",
    "notificationsError": "無法載入通知。",
    "notificationsEmpty": "沒有新通知。",
    "theme": "切換淺色 / 深色",
    "userMenu": "帳戶選單",
    "profile": "個人資料",
    "preferences": "偏好設定",
    "studio": "Studio",
    "signOut": "登出"
  },
  "palette": {
    "dialog": "命令面板",
    "placeholder": "輸入命令或搜尋…",
    "navigate": "導覽",
    "actions": "動作",
    "askAi": "詢問 AI",
    "shortcuts": "鍵盤快速鍵",
    "signOut": "登出",
    "themeDark": "深色模式",
    "themeLight": "淺色模式",
    "footerNavigate": "導覽",
    "footerOpen": "選取",
    "footerClose": "關閉",
    "recent": "最近使用",
    "searching": "正在搜尋記錄…",
    "records": "記錄",
    "empty": "找不到「{query}」的結果"
  },
  "shortcuts": {
    "title": "鍵盤快速鍵",
    "subtitle": "在 Adminium 中更有效率地工作",
    "close": "關閉",
    "dismiss": "關閉或取消",
    "palette": "開啟命令面板",
    "panel": "顯示快速鍵面板",
    "search": "聚焦搜尋欄",
    "sidebar": "切換側邊欄",
    "studio": "前往 Studio",
    "theme": "切換淺色 / 深色",
    "then": "接著",
    "footerPre": "隨時按下",
    "footerPost": "即可開啟此面板。"
  },
  "states": {
    "checked": "8 秒前檢查過",
    "diagnostics": "診斷",
    "reference": {
      "label": "參考編號",
      "copy": "複製參考編號",
      "copied": "已複製",
      "hint": "回報問題時請附上它——伺服器日誌中記錄了相同的 ID。"
    },
    "notFound": {
      "title": "找不到頁面",
      "body": "我們找不到該頁面。它可能已被移動，或是連結失效了。",
      "primary": "回到儀表板",
      "secondary": "聯絡支援團隊"
    },
    "forbidden": {
      "title": "你沒有存取權限",
      "body": "這個儀表板受到限制。請向工作區管理員申請存取權限。",
      "primary": "申請存取權限",
      "secondary": "返回上頁"
    },
    "error": {
      "title": "發生錯誤",
      "body": "Adminium 處理這個請求時發生非預期的錯誤。詳細資訊記錄在伺服器日誌中。",
      "primary": "再試一次"
    },
    "dbUnreachable": {
      "title": "無法連線到資料庫",
      "body": "我們無法連線到 prod-db。連線恢復後，你的儀表板就會繼續運作。",
      "primary": "重新連線",
      "secondary": "編輯連線",
      "diag": {
        "status": "連線逾時（10s）",
        "hint": "將 52.9.14.2 加入允許清單後重試"
      }
    },
    "maintenance": {
      "title": "排定維護",
      "body": "Adminium 正在進行維護，很快就會恢復。感謝你的耐心等候。",
      "primary": "查看服務狀態"
    },
    "rateLimited": {
      "title": "已達速率上限",
      "body": "短時間內的要求次數過多。請稍候幾分鐘後再試一次。",
      "primary": "再試一次",
      "secondary": "返回上頁"
    },
    "offline": {
      "title": "你目前離線",
      "body": "請檢查你的網路連線。恢復連線後，Adminium 會自動重新連上。",
      "primary": "立即重試",
      "banner": "目前離線——正在嘗試重新連線…"
    },
    "expiredLink": {
      "title": "此連結已過期",
      "body": "快速登入連結會在 10 分鐘後失效。請重新索取一個新連結以繼續。",
      "primary": "寄送新連結",
      "secondary": "返回登入"
    },
    "expiredSession": {
      "title": "你的工作階段已過期",
      "body": "為了你的帳戶安全，閒置一段時間後你已被登出。請重新登入，接續先前的進度。",
      "primary": "重新登入"
    },
    "emptyNoSources": {
      "title": "尚無資料來源",
      "body": "連接一個 PostgreSQL 資料庫，Adminium 就會產生你的第一個管理儀表板。",
      "primary": "連接資料庫",
      "secondary": "匯入範例資料"
    },
    "readOnly": {
      "title": "唯讀模式",
      "body": "你在這個工作區擁有 Viewer 權限。你可以瀏覽儀表板，但編輯與危險操作已停用。",
      "primary": "申請編輯權限",
      "secondary": "我知道了"
    },
    "suspended": {
      "title": "這個工作區已停權",
      "body": "這個工作區已被管理員停權。你的資料仍完整保留——請聯絡工作區擁有者以恢復存取權限。",
      "primary": "聯絡擁有者",
      "secondary": "返回上頁"
    }
  },
  "notFound": {
    "title": "找不到這個頁面",
    "errorLine": "錯誤 404",
    "searchPlaceholder": "搜尋頁面…",
    "matches": "符合的頁面",
    "popular": "熱門目的地",
    "goBack": "返回上頁",
    "backToDashboard": "回到儀表板",
    "noMatches": "沒有符合「{query}」的頁面"
  },
  "page": {
    "invalid": {
      "title": "此頁面的組態無效",
      "body": "儲存的頁面文件未通過驗證，無法呈現。"
    },
    "renderError": {
      "title": "此頁面無法呈現"
    },
    "tooNew": {
      "title": "此頁面需要較新版本的 Adminium"
    },
    "unknownTemplate": {
      "title": "未知的頁面範本"
    }
  },
  "mutation": {
    "created": "已建立記錄",
    "updated": "已更新記錄",
    "deleted": "已刪除記錄"
  },
  "undo": {
    "done": "已復原變更",
    "failed": "無法復原此變更"
  },
  "prefs": {
    "theme": {
      "label": "主題",
      "light": "淺色",
      "dark": "深色",
      "system": "跟隨系統"
    },
    "accent": {
      "label": "強調色",
      "indigo": "靛藍",
      "blue": "藍色",
      "teal": "藍綠",
      "violet": "紫色",
      "rose": "玫瑰紅",
      "red": "紅色",
      "orange": "橘色",
      "black": "黑色"
    },
    "density": {
      "label": "密度",
      "comfortable": "舒適",
      "compact": "緊湊"
    },
    "locale": {
      "label": "語言",
      "directionNote": "文字方向：由右至左（依語言自動設定）",
      "communityDraft": "此翻譯為社群草稿，尚未經過母語者審校。"
    }
  },
  "account": {
    "title": "帳戶",
    "subtitle": "目前工作階段的身分資訊。顯示偏好與通知設定請在各自的專屬頁面中管理。",
    "preferencesLink": "偏好設定",
    "notificationsLink": "通知設定",
    "name": "姓名",
    "email": "電子郵件",
    "roles": "角色",
    "twoFactor": "兩步驟驗證",
    "on": "已啟用",
    "off": "未啟用",
    "preferences": {
      "title": "偏好設定",
      "subtitle": "Adminium 為你呈現的外觀與語言——在這部裝置以及你登入的每部裝置上都適用。",
      "workspaceDefault": "工作區預設",
      "personal": "個人",
      "usingDefault": "正在使用工作區預設值（{value}）",
      "reset": "還原為工作區預設值",
      "resetFailed": "無法重設此偏好設定。請再試一次。",
      "appliesInstantly": "變更會立即生效，並儲存至你的個人資料。"
    }
  },
  "settings": {
    "defaults": {
      "title": "全域預設值",
      "subtitle": "套用於整個工作區的外觀與語言預設值。",
      "explainer": "這些預設值適用於所有未自行覆寫的使用者。任何人都可以在「個人資料 → 偏好設定」中設定自己的偏好——對該使用者而言，個人偏好永遠優先。",
      "appearanceHeading": "外觀預設值",
      "languageHeading": "語言與地區預設值",
      "adoption": "共 {total, plural, other {# 位使用者}}，其中 {following, number} 位遵循此預設值。",
      "weekStartNote": "每週起始日與數字格式依語言而定。",
      "save": "儲存預設值",
      "saved": "已更新工作區預設值",
      "saveFailed": "無法儲存工作區預設值。請再試一次。",
      "liveNote": "儲存後變更會即時廣播——遵循預設值的線上使用者不必重新載入就會看到。"
    },
    "notifications": {
      "subtitle": "選擇通知內容與方式",
      "matrixLabel": "通知我",
      "rowHeader": "事件",
      "saving": "儲存中…",
      "saved": "已儲存",
      "unavailable": "尚不可用",
      "loading": "正在載入偏好設定",
      "errorTitle": "無法載入這些設定",
      "emptyTitle": "尚無可設定項目",
      "emptyBody": "隨著功能推出，通知事件會顯示在這裡。",
      "saveFailed": "無法儲存此變更。"
    }
  },
  "studio": {
    "source": {
      "engine": {
        "label": "資料庫引擎",
        "postgres": "PostgreSQL",
        "mysql": "MySQL / MariaDB",
        "sqlite": "SQLite"
      },
      "format": {
        "label": "綱要格式",
        "helper": "除非自動偵測判斷錯誤，否則保持自動偵測即可。",
        "auto": "自動偵測",
        "sql": "SQL DDL / pg_dump",
        "prisma": "Prisma 綱要",
        "drizzle": "Drizzle ORM",
        "typeorm": "TypeORM 實體",
        "sequelize": "Sequelize 模型",
        "rails": "Rails schema.rb",
        "django": "Django models.py",
        "json": "Adminium JSON"
      },
      "sqlite": {
        "file": "資料庫檔案路徑",
        "helper": "SQLite 是檔案而非伺服器——請填寫執行 Adminium 的機器上的絕對路徑。"
      },
      "file": {
        "detectedAs": "偵測到：{format}",
        "moreWarnings": "還有 {count} 則警告——完整清單會在分析步驟顯示。",
        "dropTitle": "將結構描述檔案拖放到此處，或瀏覽選取",
        "dropHint": "SQL DDL / pg_dump、Prisma、Drizzle、TypeORM、Sequelize、Rails schema.rb、Django 模型、Adminium JSON",
        "pitch": "無需資料庫連線——我們會解析你的結構描述檔案並建立相同的儀表板。",
        "parsing": "正在讀取上傳的結構描述檔案…",
        "tables": "個資料表",
        "columns": "欄",
        "warnings": "警告",
        "errorTitle": "無法解析該檔案",
        "parseFailed": "我們無法解析該檔案。如果自動偵測判斷錯誤，請明確選擇格式後重試。",
        "unsupported": "無法辨識該格式——支援 SQL DDL、Prisma、Drizzle、TypeORM、Sequelize、Rails schema.rb、Django 模型與 Adminium JSON。請明確選擇一種後重試。",
        "requestFailed": "上傳失敗——請檢查網路連線後重試。"
      },
      "title": "連接你的資料庫",
      "subtitle": "將 Adminium 指向資料庫，我們會根據其結構描述產生管理儀表板。",
      "name": "連線名稱",
      "namePlaceholder": "正式環境 Postgres",
      "modeLabel": "來源輸入方式",
      "mode": {
        "dsn": "連線字串",
        "fields": "逐項欄位",
        "file": "結構描述檔案"
      },
      "dsn": {
        "label": "連線字串",
        "helper": "postgres://user:password@host:5432/database——mysql:// 與 sqlite: 也可使用。",
        "incomplete": "請補齊主機與資料庫，例如 postgres://user@host:5432/db",
        "invalidScheme": "無法辨識的協定——應為 postgres://、mysql://、mariadb:// 或 sqlite:",
        "quickFill": "快速填入："
      },
      "fields": {
        "host": "主機",
        "port": "連接埠",
        "database": "資料庫",
        "user": "使用者",
        "password": "密碼",
        "ssl": "SSL 模式",
        "preview": "連線字串預覽："
      },
      "readOnlyRole": {
        "title": "使用唯讀角色",
        "body": "Adminium 絕不會寫入你的資料庫——設定過程僅使用結構描述中繼資料。建議使用僅具 SELECT 權限的專用使用者；Adminium 自身資料表的存放位置可在中繼資料儲存步驟中決定。"
      }
    },
    "capability": {
      "mysqlApproxRows": "MySQL 的資料列數為儲存引擎估計值（誤差可達 ±40%），以 ≈ 顯示。",
      "mysqlFkEnum": "MySQL 的外鍵／列舉中繼資料較弱：MyISAM 資料表不宣告外鍵，列舉是逐欄的 enum(…) 型別，CHECK 條件約束需要 MySQL 8.0.16+ / MariaDB 10.2+。",
      "sqliteCheckEnums": "SQLite 沒有原生列舉型別——列舉由 CHECK (col IN (…)) 條件約束合成。",
      "sqliteNoComments": "SQLite 不支援欄位註解——請在綱要重對應編輯器中新增標籤。",
      "importNoRowCounts": "綱要檔案不含資料列數——資料表清單會顯示 — 而不是虛構的數字。",
      "importNoLiveHealth": "沒有即時資料庫連線——此來源無法進行健康檢查與綱要漂移偵測。",
      "rowsUnavailable": "綱要檔案沒有即時資料庫——在連接資料庫之前，資料列數未知。",
      "rowsRunAnalyze": "尚無估計值——請在資料庫上執行 ANALYZE 以取得資料列數。",
      "rowsNoEstimate": "引擎未回報此資料表的估計值。",
      "rowsApproximate": "儲存引擎估計值——在 InnoDB 上誤差可達 ±40%。"
    },
    "test": {
      "log": {
        "moreWarnings": "還有 {count} 則解析器警告",
        "connecting": "正在建立安全連線…",
        "connected": "已連線（{latency} 毫秒）· 唯讀內省",
        "connectFailed": "連線失敗。",
        "readingSchema": "正在讀取結構描述：public",
        "readingFile": "正在讀取上傳的結構描述檔案…",
        "parsingFile": "正在解析 {file}…",
        "detected": "偵測到 {tables} 個資料表 · {columns} 欄",
        "found": "共找到 {tables} 個資料表 · {columns} 欄",
        "mapping": "正在對應欄類型 → 輸入元件",
        "relations": "正在偵測關聯…",
        "piiScan": "正在掃描 PII 欄…",
        "piiDone": "PII 掃描完成——預設遮罩 {count} 欄",
        "piiDoneUnknown": "PII 掃描完成",
        "jobFailed": "內省失敗。",
        "networkFailed": "要求失敗——請檢查網路連線後重試。",
        "ready": "就緒"
      },
      "title": "正在分析你的結構描述",
      "subtitle": "正在內省資料表、欄與關聯。這需要幾秒鐘。",
      "trust": "我們只讀取你的結構描述與資料，不會進行任何修改。",
      "errorTitle": "連線失敗",
      "retry": "重試",
      "logLabel": "內省記錄",
      "hint": {
        "auth": "驗證失敗——請檢查 DSN 中的使用者名稱與密碼。",
        "hostUnreachable": "無法連上主機——請檢查主機名稱與連接埠，並確認資料庫接受來自本機的連線（將我們的 IP 加入允許清單）。",
        "metaPlacement": "該資料來源無法承載 Adminium 的中繼資料表——請改用獨立的中繼資料庫繼續。",
        "permission": "該角色已連線，但缺少讀取結構描述的權限——請為內省角色授予該結構描述的 USAGE 權限。",
        "timeout": "資料庫未及時回應——請檢查網路路徑與負載後重試。",
        "tls": "TLS 交涉失敗——請嘗試 sslmode=require，或上傳伺服器所需的 CA 憑證。",
        "unknown": "連線失敗——請核對 DSN 後重試。"
      }
    },
    "tables": {
      "importNoCounts": "綱要檔案不含資料列數——在連接即時資料庫之前，此欄會顯示 —。",
      "title": "選擇資料表",
      "subtitle": "選擇要納入的資料表。之後可隨時變更。",
      "search": "篩選資料表…",
      "listLabel": "可納入的資料表",
      "emptyFilter": "沒有符合篩選條件的資料表。",
      "pii": "PII",
      "highVolume": "高資料量",
      "highVolumeNote": "超過 100,000 列的資料表預設不勾選——維運類資料表很少適合放進儀表板。",
      "joinHidden": "{count} 個關聯/系統資料表已預先隱藏——它們仍支撐多對多關聯。"
    },
    "hub": {
      "title": "資料連線",
      "subtitle": "{total, plural, other {# 個連線中 {healthy, number} 個}}狀態正常",
      "connectNew": "新增連線",
      "stats": {
        "connections": "連線",
        "healthy": "正常",
        "tables": "已包含的資料表",
        "pages": "已產生的頁面"
      },
      "status": {
        "connected": "已連線",
        "error": "錯誤",
        "unconfigured": "草稿",
        "testing": "測試中…"
      },
      "card": {
        "readOnly": "唯讀",
        "tables": "資料表",
        "pages": "頁面",
        "latency": "延遲",
        "latencyMs": "{latency, number} 毫秒",
        "lastIntrospected": "上次內省",
        "never": "從未"
      },
      "action": {
        "test": "測試",
        "reintrospect": "重新內省",
        "reintrospectFile": "結構檔案來源沒有線上資料庫——請改為重新上傳檔案。",
        "remap": "重新對應結構",
        "delete": "刪除"
      },
      "test": {
        "ok": "連線正常 · {latency, number} 毫秒",
        "failed": "連線測試失敗"
      },
      "introspect": {
        "noChanges": "結構沒有變更——未建立新快照。",
        "updated": "已重新內省結構",
        "masksProposed": "{count, plural, other {建議對 # 個欄位進行遮罩}}——請在重新對應編輯器中檢視。",
        "failed": "內省失敗，請再試一次。"
      },
      "delete": {
        "title": "刪除連線",
        "body": "此操作會刪除「{name}」及其產生的頁面。您的資料庫本身不會被更動。",
        "prompt": "輸入 {name} 以確認",
        "confirm": "刪除連線",
        "cancel": "取消",
        "close": "關閉",
        "success": "已刪除連線「{name}」",
        "failed": "無法刪除連線，請再試一次。"
      },
      "empty": {
        "title": "尚無資料來源",
        "body": "連接資料庫後，Adminium 會根據其結構產生您的管理面板。",
        "cta": "連接資料庫"
      }
    },
    "settingsHub": {
      "title": "工作區設定",
      "subtitle": "此工作區的識別、安全性與危險操作。",
      "save": "儲存變更",
      "saved": "工作區設定已更新",
      "saveFailed": "無法儲存工作區設定，請再試一次。",
      "superAdminOnlyTitle": "需要超級管理員",
      "superAdminOnly": "只有超級管理員才能變更工作區識別與安全性設定。",
      "identity": {
        "heading": "工作區識別",
        "appName": {
          "label": "應用程式名稱",
          "helper": "顯示在側邊欄、瀏覽器標題與電子郵件中。",
          "error": "請輸入不超過 60 個字元的名稱。"
        },
        "logo": {
          "label": "標誌",
          "drop": "將圖片拖放到此處",
          "helper": "支援 PNG、JPEG、WebP、GIF 或 SVG，上限 1 MB。將在所有位置取代內建標誌。",
          "upload": "上傳標誌",
          "replace": "更換標誌",
          "remove": "移除",
          "uploaded": "標誌已更新",
          "removed": "標誌已移除",
          "tooLarge": "此圖片大於 1 MB。",
          "badType": "請選擇 PNG、JPEG、WebP、GIF 或 SVG 圖片。",
          "undo": "復原"
        },
        "showVersion": {
          "label": "側邊欄中的版本",
          "helper": "標誌旁的版本編號。關閉後將隱藏您執行的版本。"
        }
      },
      "security": {
        "heading": "安全性",
        "require2fa": {
          "label": "強制雙重驗證",
          "desc": "每位成員都必須啟用雙重驗證才能登入。",
          "note": "這是提示而非強制：未啟用雙重驗證的成員會被導向設定，之後也無法再關閉，但登入不會被阻擋，API 金鑰也不受影響。"
        },
        "allowSignup": {
          "label": "允許自行註冊",
          "desc": "任何人都可以建立帳戶——關閉後此工作區僅限邀請。"
        },
        "sessionTtl": {
          "label": "工作階段有效期（小時）",
          "error": "介於 {min, number} 到 {max, number} 小時之間。"
        },
        "passwordMin": {
          "label": "密碼最小長度",
          "error": "介於 {min, number} 到 {max, number} 個字元之間。"
        }
      },
      "review": {
        "title": "儲存工作區設定",
        "subtitle": "儲存前請確認您的變更。",
        "confirm": "儲存變更",
        "cancel": "取消",
        "close": "關閉",
        "on": "開",
        "off": "關",
        "shown": "顯示",
        "hidden": "隱藏",
        "change": "{before} → {after}"
      },
      "defaultsCard": {
        "heading": "外觀與語言預設值",
        "body": "整個工作區的主題、強調色、密度與語言設定位於全域預設值。",
        "cta": "開啟全域預設值"
      },
      "danger": {
        "heading": "危險區域",
        "subtitle": "不可逆的操作。",
        "empty": "沒有可刪除的項目——尚無連線。",
        "deleteDesc": "刪除該連線及其產生的頁面。您的資料庫不會被更動。此操作無法復原。",
        "deleteCta": "刪除連線"
      },
      "aiCard": {
        "heading": "AI 增強",
        "body": "設定 AI 供應商（或複製貼上往返）以增強標籤、分組與關聯。",
        "cta": "開啟 AI 設定"
      },
      "pagesCard": {
        "heading": "頁面",
        "body": "新增、編輯與刪除頁面，變更每個頁面的內容，並重新排列側邊欄。",
        "cta": "管理頁面"
      }
    },
    "settingsAi": {
      "title": "AI 增強",
      "subtitle": "連接一個模型，讓 Adminium 建議標籤、分組、關聯等——在套用之前一律以差異形式審閱。",
      "saved": "AI 供應商已儲存",
      "saveFailed": "無法儲存 AI 供應商。請重試。",
      "save": "儲存供應商",
      "test": "測試連線",
      "testHintDirty": "測試前請先儲存變更。",
      "testing": "正在連線供應商…",
      "testError": "測試失敗",
      "testErrorBody": "無法連線到供應商。請檢查金鑰與基礎 URL。",
      "testOk": "已連線到 {model}，耗時 {latency} 毫秒",
      "testUnknownModel": "供應商",
      "provider": {
        "heading": "AI 供應商",
        "subtitle": "選擇 Adminium 如何存取模型以增強你的結構描述。金鑰會加密儲存且不再顯示。",
        "active": "使用中",
        "anthropic": {
          "label": "Anthropic",
          "desc": "透過 Anthropic API 使用 Claude 模型。"
        },
        "openai": {
          "label": "OpenAI",
          "desc": "透過 OpenAI API 使用 GPT 模型。"
        },
        "openaiCompatible": {
          "label": "相容 OpenAI",
          "desc": "任何使用 OpenAI 協定的端點——Groq、Together、vLLM、LM Studio。"
        },
        "ollama": {
          "label": "Ollama（本機）",
          "desc": "透過 Ollama 在本機執行模型——免金鑰，免雲端。"
        },
        "requiresNetwork": "需要網際網路與 API 金鑰",
        "networkDisabledTitle": "此安裝已關閉直連 AI 服務商",
        "networkDisabledBody": "此 Adminium 設定為無對外網路存取，無法連線服務商 API。請使用下方的複製貼上往返方式——不需金鑰，也不需連網。"
      },
      "configure": {
        "heading": "設定 {provider}"
      },
      "field": {
        "baseUrl": "基礎 URL",
        "baseUrlOptional": "除非 Ollama 執行於其他主機，否則保持不變。",
        "baseUrlHelper": "提供 /chat/completions 的端點根位址。",
        "model": "模型",
        "modelFreeText": "輸入你的端點所提供的確切模型 ID。",
        "modelLive": "已從供應商即時載入。",
        "modelStatic": "一份經過驗證的清單；儲存後輸入自訂 ID 可重新整理。",
        "modelLoading": "載入中…",
        "modelPlaceholder": "選擇一個模型…",
        "key": "API 金鑰",
        "keyStored": "已加密儲存。替換它以使用其他金鑰。",
        "keyMask": "sk-…{last4}",
        "keyReplace": "替換金鑰",
        "keyOptional": "選填——部分端點不需要金鑰。",
        "keyWriteOnly": "僅供寫入：一旦儲存即不再顯示。",
        "noKeyTitle": "不需要 API 金鑰",
        "noKeyBody": "Ollama 在本機執行，因此沒有任何內容離開這台機器。"
      },
      "runStatus": {
        "draft": "草稿",
        "running": "執行中",
        "awaitingResponse": "等待回應",
        "validated": "已驗證",
        "applied": "已套用",
        "partiallyApplied": "部分套用",
        "failed": "失敗",
        "discarded": "已捨棄"
      },
      "byo": {
        "heading": "沒有金鑰？使用你自己的 AI 工具",
        "subtitle": "複製貼上往返——沒有任何內容離開這台機器。",
        "body": "Studio 可以依你的結構描述產生一個自足的提示詞。在 Claude Code、ChatGPT 或任何工具中執行它，然後將回傳的 JSON 貼回連線精靈。驗證、審閱與結果都與直連方式相同。",
        "guaranteeTitle": "無遙測保證",
        "guarantee1": "提示詞僅包含你的結構描述與彙總統計——預設絕不包含列資料。",
        "guarantee2": "不嵌入任何憑證、執行個體 URL 或識別碼。",
        "guarantee3": "BYO 執行不進行任何網路呼叫。",
        "promptVersion": "提示詞 {version}",
        "schemaVersion": "結構描述 {version}",
        "headingRecommended": "使用你自己的 AI 工具——不需金鑰",
        "recommended": "建議"
      },
      "history": {
        "heading": "執行紀錄",
        "subtitle": "過往的增強執行。開啟其中一個以審閱其建議。",
        "tableLabel": "增強執行",
        "colDate": "日期",
        "colSource": "來源",
        "colStatus": "狀態",
        "colChunks": "區塊",
        "openReview": "開啟 {date} 的執行審閱",
        "connection": "連線",
        "empty": "尚無增強執行。在連線精靈中增強結構描述後，紀錄將顯示於此。",
        "errorTitle": "無法載入執行",
        "errorBody": "重新整理頁面以再試一次。",
        "noConnections": "請先連線資料庫——增強執行會依連線分別記錄。",
        "byo": "BYO",
        "directPath": "直連"
      }
    },
    "enrich": {
      "title": "使用 AI 豐富",
      "subtitle": "可選擇使用 LLM 優化生成的標籤、分組、列舉和儀表板。啟發式基準無需它即可運作——這僅新增供你在套用前審閱的建議。",
      "intentLabel": "你希望如何豐富？",
      "sectionsLegend": "應由 AI 決定哪些內容？",
      "localesLegend": "將標籤翻譯為",
      "localeLocked": "（必填）",
      "samplingTitle": "包含範例值",
      "samplingHint": "在提示中為每個非 PII 欄位最多包含 20 個真實值。",
      "samplingPreviewTitle": "離開此機器的內容",
      "samplingPreviewBody": "每個非 PII 欄位最多 20 個最常見值，以及數值與日期欄位的最小/最大值。標記為 PII 的欄位永不取樣。其餘所有內容僅保留彙總值。複製前請審閱確切的提示（BYO）——未經你的操作不會傳送任何內容。",
      "noSections": "請至少選擇一個要豐富的決策群組。",
      "generatePrompt": "生成提示",
      "startProvider": "開始豐富",
      "startOver": "重新開始",
      "copied": "已複製",
      "createFailed": "無法建立豐富提示——請重試。",
      "createFailedTitle": "無法啟動",
      "providerFallback": "你的 AI 供應商",
      "fileTitle": "AI 豐富需要一個線上資料庫",
      "fileBody": "結構描述檔案來源尚無可豐富的快照。連接一個線上資料庫以使用 AI 豐富，或繼續——啟發式基準仍會生成完整的應用程式。",
      "section": {
        "labels": "標籤與描述",
        "groups": "導覽分組",
        "enums": "列舉語意",
        "relations": "關聯",
        "keys": "關鍵欄位",
        "templates": "頁面範本",
        "widgets": "儀表板小工具",
        "pii": "PII 與遮罩",
        "icons": "圖示",
        "microcopy": "微文案"
      },
      "provider": {
        "title": "使用我的 AI 供應商",
        "description": "立即使用已設定的供應商執行豐富。你將以差異形式審閱每則建議。",
        "unconfigured": "尚未設定 AI 供應商——請在下方將提示複製到你自己的工具，或先設定一個供應商。",
        "settingsHint": "想直接執行嗎？",
        "settingsLink": "在「設定 → AI」中設定供應商",
        "networkDisabled": "此 Adminium 無對外網路存取，無法連線服務商 API。請改用複製貼上往返方式——同樣的提示詞，同樣的審閱。"
      },
      "byo": {
        "cardTitle": "複製提示到我自己的 AI 工具",
        "cardDescription": "將一個自包含的提示複製到 Claude Code、ChatGPT 或任何工具——然後將 JSON 貼回。無需金鑰，不會自動將任何內容傳出此機器。",
        "guidance": "在任意 AI 工具中執行——Claude Code、ChatGPT，皆可。將其回傳的 JSON 貼到下方。",
        "promptLabel": "豐富提示",
        "promptLabelN": "豐富提示 第 {index} 個，共 {total} 個",
        "tokenChip": "≈ {tokens} 個 token",
        "copyPrompt": "複製提示",
        "copyPromptDone": "提示已複製",
        "download": "下載 .md",
        "chunkTabs": "提示分塊",
        "chunkTab": "提示 {index}",
        "chunkValid": "分塊 {index} 已驗證",
        "pasteLabel": "貼上 JSON 回應",
        "pastePlaceholder": "在此貼上 JSON 回應…",
        "validate": "驗證",
        "valid": "回應已驗證",
        "mergedTitle": "全部 {count} 個分塊已驗證並合併",
        "mergedTitleSingle": "回應已驗證",
        "mergedBody": "建議已準備好，可對照啟發式基準進行審閱。",
        "errorsTitle": "驗證發現 {count} 個問題",
        "copyErrors": "為你的 AI 工具複製錯誤",
        "copyErrorsDone": "錯誤已複製",
        "copyErrorsHint": "將其貼回你的 AI 工具以取得更正後的回應。",
        "droppedItems": "有 {count} 則建議在驗證時被捨棄——審閱中顯示其餘內容。",
        "pendingTitle": "驗證每個提示以繼續",
        "pendingBody": "在上方貼上 JSON 回應並驗證，以繼續進行審閱。",
        "pendingBodyChunked": "每個分塊都必須先驗證，建議才會合併。請貼上並驗證上方的每個提示。",
        "requestFailed": "無法連接伺服器進行驗證——請重試。",
        "continueReview": "繼續審閱",
        "wholeDocument": "整份文件",
        "cardTitleRecommended": "把提示詞複製到我自己的 AI 工具——建議"
      },
      "direct": {
        "title": "正在使用 AI 豐富",
        "subtitle": "正在將你的結構描述傳送至",
        "building": "正在建立提示…",
        "logLabel": "豐富日誌",
        "cancel": "取消",
        "back": "返回選項",
        "retry": "重試",
        "done": "豐富完成——請審閱建議。",
        "continueReview": "繼續審閱",
        "failed": "供應商執行失敗。請檢查你的 AI 設定並重試。",
        "jobFailed": "豐富執行未完成。",
        "startFailed": "無法啟動執行——請重試。",
        "errorTitle": "豐富失敗"
      },
      "skip": {
        "title": "略過——僅使用啟發式",
        "description": "從啟發式基準生成。你之後可在「設定 → AI」中豐富——略過絕不會受到懲罰。",
        "confirmTitle": "繼續使用啟發式",
        "confirmBody": "生成的應用程式將使用啟發式的標籤、分組和儀表板。繼續生成——你可隨時在「設定 → AI」中執行 AI 豐富。"
      }
    },
    "review": {
      "unavailableTitle": "審閱畫面不可用",
      "unavailableBody": "此組建尚未包含增強審閱畫面（06-T14）。它將隨差異與套用流程一起推出。"
    },
    "llmRuns": {
      "review": {
        "header": {
          "title": "審查 AI 建議",
          "model": "模型",
          "snapshot": "快照",
          "byo": "自帶",
          "pathDirect": "直接 API",
          "pathByo": "複製貼上",
          "agree": "{n} 項一致",
          "conflict": "{n} 項衝突",
          "new": "{n} 項新增",
          "rejects": "{n} 項拒絕",
          "countsAria": "建議數量"
        },
        "bulk": {
          "thresholdLabel": "信心度門檻",
          "thresholdAria": "「全部接受」的信心度門檻",
          "acceptAll": "接受所有 ≥ {pct}%",
          "clear": "清除選取"
        },
        "section": {
          "selectAllAria": "全選 {group}",
          "acceptedCount": "已接受 {n} 項"
        },
        "group": {
          "labels": "標籤與翻譯",
          "navigation": "導覽與領域",
          "enums": "列舉語意",
          "relations": "關聯",
          "keys": "鍵欄位",
          "templates": "頁面範本",
          "dashboards": "儀表板與小工具",
          "pii": "個人資料與遮罩",
          "icons": "圖示",
          "microcopy": "微文案"
        },
        "status": {
          "agree": "一致",
          "conflict": "衝突",
          "new": "新增",
          "heuristicOnly": "僅啟發式",
          "rejects": "拒絕啟發式",
          "locked": "已鎖定"
        },
        "row": {
          "acceptAria": "接受 {target} 的{noun}建議",
          "keptEdited": "已保留——由您編輯",
          "rejectsCallout": "AI 拒絕了某項啟發式決策——接受前請確認。",
          "showTranslations": "顯示翻譯",
          "hideTranslations": "隱藏翻譯",
          "confidenceAria": "信心度 {pct}%",
          "noAi": "無 AI 建議"
        },
        "value": {
          "none": "無值",
          "absent": "無",
          "dash": "—",
          "display": "顯示",
          "key": "鍵",
          "rank": "排名 {n}",
          "span": "跨距 {n}",
          "tableCount": "{n} 張資料表",
          "widgetCount": "{n} 個小工具",
          "enumWorkflow": "工作流程",
          "enumCategory": "分類",
          "notPii": "非個人資料",
          "label": "標籤",
          "description": "描述",
          "subtitle": "頁面副標題",
          "headline": "空狀態標題",
          "guidance": "空狀態提示"
        },
        "apply": {
          "title": "套用 {n} 項建議",
          "subtitle": "這些變更將在單一交易中寫入，並可復原。",
          "empty": "未選擇任何要套用的內容。",
          "confirm": "套用變更"
        },
        "footer": {
          "count": "已選擇 {n} 項建議",
          "apply": "套用 {n} 項已接受的建議",
          "failed": "套用失敗"
        },
        "toast": {
          "applied": "已套用 {n} 項建議",
          "appliedPartial": "已套用 {n} 項建議（部分已略過）",
          "applyFailed": "無法套用建議",
          "undoFailed": "無法復原此變更"
        },
        "error": {
          "title": "無法載入此執行"
        },
        "notReady": {
          "title": "此執行尚無可審查的建議",
          "body": "執行必須先通過驗證，才能審查其建議。請先產生或貼上回應。"
        },
        "applied": {
          "title": "此執行已套用",
          "body": "下方已接受的建議為唯讀。"
        },
        "empty": {
          "title": "無建議",
          "body": "此執行未產生可審查的建議。"
        },
        "cat": {
          "label": "標籤",
          "key": "鍵欄位",
          "enum": "列舉",
          "relation": "關聯",
          "pii": "個人資料",
          "template": "頁面範本",
          "group": "導覽群組",
          "dashboard": "儀表板",
          "widget": "小工具",
          "copy": "微文案"
        }
      }
    },
    "wizard": {
      "title": "新增連線",
      "back": "返回",
      "continue": "繼續",
      "progress": "設定進度",
      "persistFailed": "無法儲存你的資料表選擇——請重試。",
      "persistFailedTitle": "儲存失敗",
      "bridgeAppliedTitle": "已收到連線字串",
      "bridgeAppliedBody": "由你的瀏覽器從 adminium.dev 直接交給本機——它從未被上傳到任何伺服器。請在下方核對後繼續。",
      "bridgeFailedTitle": "無法使用這次交接",
      "bridgeFailedBody": "它已被使用或已過期。請改為在下方貼上你的連線字串。",
      "step": {
        "source": "來源",
        "test": "分析",
        "tables": "資料表",
        "meta": "中繼資料儲存",
        "intent": "意圖",
        "enrich": "豐富",
        "generate": "產生"
      }
    },
    "meta": {
      "title": "Adminium 應將自己的資料表放在哪裡？",
      "subtitle": "頁面、角色、稽核記錄與設定存放在以 adminium_ 為前綴的資料表中——絕不混入你的資料。",
      "sameDb": {
        "title": "同一資料庫",
        "description": "adminium_* 資料表會建立在你的來源資料表旁。這是最簡單的設定——需要具有寫入與 CREATE TABLE 權限的角色。",
        "disabledReadOnly": "你的角色為唯讀——Adminium 絕不會寫入此資料庫。請為 Adminium 自身的資料表選擇獨立的資料庫。",
        "disabledNoDdl": "該角色無法執行 DDL——Adminium 遷移需要 CREATE TABLE 權限。請為 Adminium 自身的資料表選擇獨立的資料庫。",
        "disabledFile": "結構描述檔案沒有即時資料庫——請為 Adminium 自身的資料表選擇獨立的資料庫。"
      },
      "separate": {
        "title": "獨立的資料庫",
        "description": "Adminium 會將其資料表保存在另一個資料庫中。你的來源保持不變——唯讀來源必須如此。",
        "dsn": "中繼資料庫連線字串",
        "helper": "需要寫入與 DDL 權限——Adminium 會在那裡執行自己的遷移。",
        "test": "測試連線",
        "ok": "相容——寫入 ✓ · DDL ✓",
        "insufficient": "該角色無法承載中繼資料存放區——Adminium 在那裡需要寫入與 CREATE TABLE 權限。",
        "errorTitle": "中繼資料存放區不相容"
      },
      "testFailed": "連線失敗。",
      "v1Note": {
        "title": "關於此安裝",
        "body": "此伺服器已將自有資料表保存在設定好的資料庫中，本步驟不會搬移它們。它只驗證您的選擇是否與此連線相容——伺服器會獨立執行相同規則（409 META_PLACEMENT_INVALID）。"
      },
      "move": {
        "title": "正在搬移 Adminium 的資料表",
        "copying": "正在搬移 Adminium 的資料表…",
        "restarting": "正在重新啟動…",
        "copyingBody": "正在將每張 adminium_ 資料表複製到新資料庫。您的來源資料不會被更動，且必須通過驗證後才會切換。",
        "restartingBody": "複製已完成。Adminium 正在新資料庫上重新啟動——本頁面將在數秒後自動繼續。",
        "failed": "無法搬移 Adminium 的資料表——請重試。",
        "timeout": "Adminium 已搬移資料表，但尚未恢復。您的資料已安全存放於新資料庫——請稍後重新載入本頁面。"
      },
      "willMove": {
        "title": "此步驟將搬移 Adminium 的資料表",
        "body": "Adminium 目前使用內建的 SQLite 儲存區。按「繼續」會將該儲存區複製到您選擇的資料庫並在其上重新啟動——帳號、頁面與設定都會一併搬移，您將保持登入狀態。"
      }
    },
    "intent": {
      "title": "你需要什麼？",
      "subtitle": "意圖決定會產生哪些頁面。之後可以變更——變更會提議重新產生，絕不會靜默改寫。",
      "trust": "我們只讀取你的結構描述——設定期間絕不讀取列資料。",
      "fullAdmin": {
        "title": "完整管理面板",
        "description": "儀表板、CRUD 頁面、搜尋、匯入與匯出——你的結構描述支援的一切。"
      },
      "analytics": {
        "title": "唯讀分析",
        "description": "儀表板、圖表與唯讀網格。沒有表單、沒有寫入——所有角色上限為檢視者。"
      },
      "crud": {
        "title": "CRUD 資料表",
        "description": "每個資料表一個編輯頁面，外加搜尋與匯入/匯出——極簡首頁，沒有儀表板。"
      },
      "support": {
        "title": "客服主控台",
        "description": "優先產生佇列、工單與客戶詳情頁面。預設關閉刪除。（佇列範本將於 M7 推出——v1 頁面集與完整管理面板相同。）"
      }
    },
    "generate": {
      "title": "產生你的應用程式",
      "subtitle": "每個已納入的資料表一個頁面，外加依領域產生的儀表板——意圖：",
      "run": "產生儀表板",
      "openApp": "開啟你的應用程式",
      "logLabel": "產生記錄",
      "log": {
        "classifying": "正在對結構描述分類…",
        "composing": "正在組合範本…",
        "writing": "正在寫入頁面…",
        "done": "已產生 {pages} 個頁面，分佈於 {groups} 個導覽群組"
      },
      "successTitle": "你的儀表板已就緒",
      "successBody": "{pages} 個頁面，分佈於 {groups} 個導覽群組——由你的結構描述產生，可在 Studio 中編輯。",
      "errorTitle": "產生失敗",
      "failed": "產生失敗——請重試，或先重新執行內省。",
      "fileTitle": "結構描述檔案已解析——產生需要即時資料庫",
      "fileBody": "你的結構描述解析順利，上方預覽是真實的。直接從結構描述檔案產生可執行的應用程式（含佔位列）尚不可用——請連接即時資料庫立即產生。"
    },
    "remap": {
      "column": {
        "nullable": "可為 null",
        "labelOverride": "顯示標籤",
        "labelHelper": "推斷：{name}",
        "logicalType": "邏輯型別",
        "logicalTypeHelper": "推斷：{type}（來自 {dbType}）——由配接器對應；v1 不可覆寫。",
        "semantic": "語意型別",
        "unclassified": "尚未分類。",
        "semanticHelper": "分類器：{tag} · 信心度 {confidence}% · 來源：{source}",
        "semanticInferred": "推斷：{tag}",
        "currency": "貨幣",
        "currencyHelper": "套用於金額格式的 ISO 4217 代碼。",
        "pii": "預設遮罩",
        "piiHelper": "遮罩的值會以隱匿形式呈現；取消遮罩需要 data.unmask_pii 權限，且會寫入稽核記錄。",
        "enum": "列舉語意",
        "enumKind": "列舉種類",
        "enumWorkflow": "工作流程",
        "enumCategory": "類別",
        "enumLabelFor": "{value} 的標籤",
        "enumToneFor": "{value} 的色調",
        "enumToneAuto": "自動",
        "enumHelper": "工作流程列舉會驅動狀態膠囊與看板欄；色調會將各值對應到語意色調刻度。"
      },
      "diff": {
        "one": "1 項變更",
        "count": "{count} 項變更",
        "saved": "已儲存覆寫。",
        "revertOne": "還原 {change}",
        "regenerate": "重新產生頁面",
        "revertAll": "全部還原",
        "save": "儲存覆寫"
      },
      "table": {
        "iconPicker": "資料表圖示",
        "system": "系統",
        "labelOverride": "顯示標籤",
        "labelHelper": "推斷：{name}",
        "icon": "圖示",
        "navGroup": "導覽群組",
        "navGroupHelper": "導覽位置由產生器決定——table.navGroup 覆寫不在 v1 詞彙表中。",
        "include": "納入產生的應用程式",
        "includeHelper": "被排除的資料表不會產生頁面，並會從導覽中消失。",
        "shape": "資料表形態（已分類）",
        "role": "角色",
        "unclassified": "未分類",
        "kind": "種類",
        "hierarchy": "階層",
        "selfFk": "透過 {column} 自我參照",
        "polymorphic": "多型配對",
        "rows": "資料列估計值",
        "shapeHelper": "每次內省都會重新計算分類；覆寫會疊加在其上，並在重新產生後保留。"
      },
      "relations": {
        "declared": "已宣告的外鍵",
        "noneDeclared": "沒有已宣告的外鍵涉及此資料表。",
        "inferred": "推斷的關聯",
        "noneInferred": "此資料表沒有任何推斷結果。",
        "confidence": "推斷 · {pct}%",
        "accepted": "已接受",
        "suppressed": "已抑制",
        "accept": "接受",
        "suppress": "抑制",
        "overrides": "覆寫關聯（已套用）",
        "overrideBadge": "覆寫",
        "add": "新增虛擬關聯",
        "fromColumn": "來源欄位",
        "noColumns": "沒有符合的欄位",
        "fromPlaceholder": "customer_id",
        "toTable": "目標資料表",
        "noTables": "沒有符合的資料表",
        "toColumn": "目標欄位",
        "cardinality": "基數",
        "addButton": "新增關聯"
      },
      "toast": {
        "saved": "已儲存結構描述覆寫",
        "savedDetail": "下方已套用的結構描述已反映你的變更。",
        "regenerated": "已建立 {created} · 已更新 {updated} · 未變更 {unchanged}",
        "regeneratedDetail": "你手動編輯過的頁面會被保留——只有 generated_hash 未被更動的頁面才會就地重新產生。",
        "regenerateFailed": "重新產生失敗"
      },
      "title": "結構描述重新對應",
      "subtitle": "{tables} 個資料表 · 已套用 {applied} 項覆寫",
      "saveFailed": "儲存失敗：{message}",
      "loadFailed": "無法載入此連線的結構描述。",
      "inspector": "檢閱器",
      "empty": {
        "title": "選擇資料表或欄位",
        "description": "在結構描述樹中選取項目，即可重新對應其標籤、型別、關聯或遮罩。"
      },
      "tabs": {
        "details": "詳細資料",
        "relations": "關聯"
      },
      "tree": {
        "label": "結構描述",
        "search": "搜尋資料表與欄位",
        "searchPlaceholder": "搜尋資料表…",
        "noMatches": "沒有符合搜尋條件的資料表。",
        "collapse": "收合資料表",
        "expand": "展開資料表",
        "unsaved": "未儲存的變更",
        "excluded": "已排除"
      },
      "badge": {
        "pk": "PK",
        "fk": "FK",
        "unique": "UNIQUE",
        "pii": "PII",
        "masked": "已遮罩"
      },
      "unavailableTitle": "結構描述重新對應編輯器無法使用"
    }
  },
  "onboarding": {
    "title": "開始使用",
    "subtitle": "幾個步驟，讓你的工作區準備就緒。",
    "loading": "正在載入設定清單…",
    "welcome": "歡迎使用 Adminium，{name} 👋",
    "progressBody": "你已完成 {total} 個設定步驟中的 {done} 個。完成其餘步驟以解鎖完整工作區。",
    "completeBody": "全部就緒 — 你的工作區已完全設定。",
    "ringLabel": "已完成 {total} 個步驟中的 {done} 個",
    "done": "完成",
    "skip": "暫時略過",
    "goToWorkspace": "前往工作區",
    "help": {
      "title": "需要協助？",
      "body": "我們隨時協助你快速完成設定。"
    },
    "steps": {
      "connectDatabase": {
        "title": "連線資料庫",
        "desc": "將 Adminium 指向你的 Postgres、MySQL 或 SQLite — 唯讀角色也可以。",
        "time": "5 分鐘",
        "action": "連線"
      },
      "chooseTables": {
        "title": "選擇你的資料表",
        "desc": "選擇哪些資料表成為頁面 — 個人資訊預設已遮罩。",
        "time": "2 分鐘",
        "action": "選擇"
      },
      "inviteTeammates": {
        "title": "邀請團隊成員",
        "desc": "邀請團隊一起探索與協作。",
        "time": "2 分鐘",
        "action": "邀請"
      },
      "workspaceDefaults": {
        "title": "設定工作區預設值",
        "desc": "為所有人設定主題、強調色、密度與語言。",
        "time": "1 分鐘",
        "action": "設定"
      }
    },
    "entry": {
      "wayBack": "開始使用 · {done}/{total}",
      "dismiss": "隱藏設定清單",
      "continue": "繼續設定",
      "banner": "完成工作區設定 — 已完成 {total} 個步驟中的 {done} 個。"
    }
  },
  "views": {
    "baseView": "全部記錄",
    "menuLabel": "已儲存檢視",
    "saveAs": "將目前儲存為檢視…",
    "updateActive": "更新「{name}」",
    "rename": "重新命名…",
    "setDefault": "設為預設",
    "delete": "刪除…",
    "saveTitle": "儲存檢視",
    "save": "儲存檢視",
    "renameTitle": "重新命名檢視",
    "saveName": "儲存名稱",
    "nameLabel": "檢視名稱",
    "namePlaceholder": "例如：本月活躍",
    "nameRequired": "請輸入此檢視的名稱。",
    "saveFailed": "無法儲存檢視。",
    "deleteTitle": "刪除檢視",
    "deleteBody": "這會移除已儲存的檢視。你的資料不受影響。",
    "deletePrompt": "輸入檢視名稱以確認",
    "deleteConfirm": "刪除檢視",
    "savedToast": "檢視「{name}」已儲存。",
    "updatedToast": "檢視「{name}」已更新。",
    "defaultToast": "「{name}」現在是預設檢視。",
    "deletedToast": "檢視「{name}」已刪除。"
  },
  "builder": {
    "view": "檢視",
    "edit": "編輯",
    "done": "完成",
    "addWidget": "新增小工具",
    "saveLayout": "儲存版面",
    "saving": "正在儲存…",
    "savedShort": "已儲存",
    "options": "儀表板選項",
    "resetLayout": "重設版面",
    "resetTitle": "重設為共用版面？",
    "resetBody": "這會移除你的個人變更並還原所有人看到的儀表板。你的資料不受影響。",
    "resetConfirm": "重設版面",
    "resetDone": "版面已重設為共用預設值。",
    "sharedNote": "你正在編輯所有人都能看到的共用儀表板。",
    "personalNote": "你正在編輯個人版面——只有你能看到這些變更。",
    "savedShared": "儀表板已為所有有權限的人儲存。",
    "empty": "此儀表板尚無任何小工具。",
    "emptyAction": "新增小工具",
    "palette": {
      "title": "新增小工具",
      "count": "{count} 個小工具",
      "searchLabel": "搜尋小工具",
      "searchPlaceholder": "搜尋小工具…",
      "clear": "清除搜尋",
      "noResults": "沒有小工具符合「{query}」。",
      "add": "新增 {name}",
      "added": "已新增 {name}。"
    },
    "inspector": {
      "title": "設定小工具",
      "empty": "此小工具沒有可設定的選項。",
      "locked": "已鎖定",
      "lockedHint": "此欄位由資料來源設定，無法在此處編輯。",
      "selectPlaceholder": "選擇…",
      "increment": "增加",
      "decrement": "減少",
      "done": "完成"
    },
    "item": {
      "configure": "設定 {name}",
      "duplicate": "複製 {name}",
      "remove": "移除 {name}",
      "removed": "已移除 {name}。",
      "duplicated": "已複製 {name}。",
      "unboundHint": "此小工具在這裡以及正式頁面上都顯示範例資料。請開啟「設定」將它連接到資料表。",
      "unbound": "範例資料"
    },
    "families": {
      "kpi": "關鍵指標",
      "charts": "圖表",
      "tables": "表格",
      "feeds": "動態",
      "calendar": "行事曆",
      "boards": "看板",
      "geo": "地圖",
      "media": "媒體",
      "communication": "溝通",
      "forms": "表單",
      "chrome": "導覽",
      "system": "系統",
      "domain": "領域"
    },
    "versions": "版本",
    "versionsEmpty": "尚未儲存任何版本",
    "saveAsVersion": "儲存為版本",
    "saveVersionTitle": "儲存版本",
    "saveVersionBody": "為目前文件建立快照。可隨時從「版本」還原。",
    "versionName": "版本名稱",
    "versionNamePlaceholder": "例如：Q3 費率調整前",
    "discard": "捨棄變更",
    "discardTitle": "捨棄你的變更？",
    "discardBody": "儀表板將回復到你開啟編輯器時的樣子。你的資料不受影響。",
    "discardConfirm": "捨棄變更",
    "keepEditing": "繼續編輯",
    "discarded": "變更已捨棄。",
    "binding": {
      "addFilter": "新增篩選條件",
      "brokenBody": "它已不符合此版本能理解的查詢格式，因此小工具在正式頁面上會顯示錯誤。",
      "brokenTitle": "此小工具的查詢已損毀",
      "bucketColumn": "日期欄位",
      "bucketRequired": "請選擇存放日期的欄位。",
      "bucketUnit": "時間分組單位",
      "columnNone": "無",
      "columnPlaceholder": "選擇欄位…",
      "connect": "連接資料",
      "edit": "編輯查詢",
      "event": {
        "category": "類別欄位（選填）",
        "date": "開始日期欄位",
        "end": "結束日期欄位（選填）",
        "title": "標題欄位"
      },
      "filterColumnRequired": "請選擇欄位。",
      "filterColumn": "欄位",
      "filterListHelper": "多個值請以逗號分隔。",
      "filterOp": "條件",
      "filterValue": "值",
      "fn": {
        "avg": "平均值",
        "countDistinct": "相異值計數",
        "count": "資料列筆數",
        "max": "最大值",
        "min": "最小值",
        "sum": "總和"
      },
      "groupByColumns": "直欄",
      "groupByRequired": "此檢視需要一個分組欄位。",
      "groupByRows": "橫列",
      "groupBy": "分組依據",
      "incompleteBody": "請填寫已標示的欄位——只寫了一半的查詢在正式儀表板上會失敗。",
      "incompleteTitle": "此查詢尚未完成",
      "limit": "最多擷取的資料列數",
      "loadingSchema": "正在載入資料表…",
      "lossyBody": "其中部分內容——額外的量值、排序或頁面篩選連結——不會顯示在這裡，若你儲存就會被捨棄。",
      "lossyTitle": "此查詢比編輯器所能處理的更進階",
      "measureColumnRequired": "此計算需要一個欄位。",
      "measureColumn": "計算欄位",
      "measureFn": "計算方式",
      "noConnectionBody": "只有隸屬於某個連線的頁面，才能將小工具繫結到資料。",
      "noConnectionTitle": "此頁面沒有資料庫連線",
      "noDateColumns": "此資料表沒有日期或時間戳記欄位。",
      "noFilters": "沒有篩選條件——資料表中的每一列都會被計入。",
      "noSnapshotBody": "資料表與欄位來自此連線上次的內省結果。請先在 Studio 中執行內省，然後重新開啟此編輯器。",
      "noSnapshotTitle": "此連線沒有結構描述快照",
      "op": {
        "between": "介於",
        "ilike": "包含（不分大小寫）",
        "in": "是其中之一",
        "isNull": "是空值",
        "like": "包含",
        "notNull": "不是空值"
      },
      "orderAsc": "最舊／最小的在前",
      "orderBy": "排序依據",
      "orderDesc": "最新／最大的在前",
      "orderDir": "排序方向",
      "orderNone": "資料庫預設順序",
      "pickTableFirst": "請先選擇資料表，才能選擇其中的欄位。",
      "removeFilter": "移除篩選條件",
      "remove": "移除資料來源",
      "save": "使用此查詢",
      "sectionBreakdown": "分組",
      "sectionColumns": "欄位",
      "sectionFilters": "篩選條件",
      "sectionMeasure": "量值",
      "sectionRows": "資料列",
      "sectionSource": "來源",
      "sectionTime": "時間軸",
      "sectionWindow": "期間",
      "selectColumns": "要顯示的欄位",
      "selectRequired": "請至少選擇一個要顯示的欄位。",
      "shape": {
        "calendarEvents": "附日期的事件",
        "categorical": "每個類別一個值",
        "distribution": "單一欄位的分佈",
        "matrix": "由橫列與直欄組成的格線",
        "metricDelta": "一個數字，並與前一期間比較",
        "multiTimeseries": "每個類別一條隨時間變化的線",
        "recordList": "資料列清單",
        "record": "單一資料列",
        "singleMetric": "單一數字",
        "stream": "近期資料列的即時動態",
        "timeseries": "隨時間變化的值",
        "tree": "每個類別一個值，分成兩個層級",
        "geoPoints": "每個地點或地區一個值",
        "flows": "從一個類別流向另一個類別的數量",
        "ohlc": "每個期間的開盤、最高、最低與收盤價",
        "booleanMap": "每個鍵一個開／關標記"
      },
      "shapeHelper": "變更這項設定會改變可套用的查詢控制項。",
      "shapeLabel": "此小工具顯示的內容",
      "summaryColumns": "{count, plural, other {# 個欄位}}",
      "summaryFilters": "{count, plural, other {# 個篩選條件}}",
      "tableEmpty": "沒有符合的資料表。",
      "tablePlaceholder": "搜尋資料表…",
      "tableRequired": "請選擇要查詢的資料表。",
      "table": "資料表或檢視表",
      "title": "資料來源",
      "unbindableBody": "它呈現的資料形態是查詢引擎尚未支援的，因此會改用自己的範例內容。",
      "unbindableTitle": "此小工具尚無法查詢資料",
      "unboundBody": "它在這裡以及正式頁面上都顯示範例數字。請將它連接到資料表以顯示真實資料。",
      "unboundTitle": "尚未連接你的資料",
      "unit": {
        "day": "每日",
        "hour": "每小時",
        "month": "每月",
        "quarter": "每季",
        "week": "每週",
        "year": "每年"
      },
      "valueColumnRequired": "請選擇要計算的欄位。",
      "valueColumn": "數值欄位",
      "windowColumn": "日期欄位",
      "windowLast": "最近",
      "windowNone": "全部時間",
      "windowRequired": "與前一期間比較需要一個日期欄位。",
      "windowUnit": {
        "day": "天",
        "hour": "小時",
        "month": "個月",
        "quarter": "季",
        "week": "週",
        "year": "年"
      },
      "windowUnitLabel": "單位",
      "role": {
        "flagKey": "鍵欄位",
        "flagValue": "開／關欄位"
      },
      "roleColumnsRequired": "請填寫每個必填欄位，且在已填寫的欄位之前不能留空，因為這些欄位是依序讀取的。"
    }
  },
  "setup": {
    "title": "設定 Adminium",
    "subtitle": "建立第一位管理員。此操作只會進行一次。",
    "progress": "設定進度",
    "steps": {
      "account": "管理員帳戶",
      "consent": "隱私"
    },
    "account": {
      "name": "您的姓名",
      "email": "電子郵件",
      "emailInvalid": "請輸入有效的電子郵件地址。",
      "password": "密碼",
      "passwordHelper": "至少 {min} 個字元。",
      "passwordTooShort": "請至少使用 {min} 個字元。",
      "confirm": "確認密碼",
      "passwordMismatch": "兩次輸入的密碼不一致。",
      "continue": "繼續",
      "strength": "密碼強度",
      "strengthLevels": {
        "weak": "弱",
        "fair": "普通",
        "good": "良好",
        "strong": "強"
      }
    },
    "consent": {
      "telemetry": {
        "title": "分享匿名使用資料",
        "description": "協助我們瞭解應優先支援哪些資料庫引擎。預設關閉，除非您主動開啟。"
      },
      "updates": {
        "title": "檢查新版本",
        "description": "當有新版本（包括安全性修正）可用時顯示提示。這會向 GitHub 查詢最新發行版，因而會向 GitHub 揭露本執行個體的 IP 位址與版本。除此之外不會傳送任何內容。"
      },
      "sentTitle": "傳送的內容僅限於：",
      "sent": {
        "instanceId": "一組隨機執行個體 ID（在本機產生的 UUID；並非由您的姓名、主機或資料庫推導而來）",
        "version": "本執行個體執行的 Adminium 版本",
        "engines": "已連線的資料庫引擎類型（例如「postgres」）——僅類型"
      },
      "neverTitle": "絕不傳送：",
      "never": {
        "schema": "您的結構描述——不含任何資料表、欄位或列舉名稱",
        "rows": "您的資料——從不傳送任何一列",
        "connections": "連線字串、主機名稱或憑證",
        "people": "使用者的電子郵件、姓名或 ID",
        "llm": "AI 提示詞或執行內容"
      },
      "reversible": "兩項預設皆為關閉，之後您可以隨時在「設定」中變更。",
      "back": "返回",
      "finish": "建立管理員帳戶"
    },
    "error": {
      "alreadyCompleted": "本執行個體已完成設定。請使用現有的管理員帳戶登入。",
      "rejected": "伺服器拒絕了這些資訊。請檢查電子郵件與密碼後再試一次。",
      "failed": "設定失敗。請檢查您的網路連線後再試一次。"
    }
  },
  "about": {
    "title": "關於 Adminium",
    "subtitle": "版本、授權條款，以及本執行個體原始碼的位置。",
    "version": "版本",
    "license": "授權條款",
    "metaStore": "中繼資料儲存區",
    "node": "Node.js",
    "engine": {
      "postgres": "PostgreSQL",
      "mysql": "MySQL / MariaDB",
      "sqlite": "SQLite"
    },
    "licenseCard": {
      "title": "自由與開放原始碼",
      "body": "Adminium 以 GNU Affero 通用公共授權條款 v3.0 授權。您可以自由地執行、研究、修改與分享它。若您透過網路向他人提供修改後的版本，AGPL 要求您同樣向他們提供其原始碼。"
    },
    "viewLicense": "閱讀授權條款",
    "viewSource": "取得原始碼",
    "updates": {
      "title": "更新",
      "description": "本執行個體是否檢查新版本。"
    },
    "update": {
      "disabled": "更新檢查已關閉，因此本執行個體從不聯絡 GitHub。可在「設定」中開啟以得知新版本。",
      "current": "您正在使用最新版本。",
      "available": "Adminium {version} 已發行",
      "availableBody": "您目前執行的是 {version}。",
      "viewRelease": "檢視發行說明"
    },
    "desktop": {
      "unknown": "未知",
      "appVersion": "應用程式版本",
      "serverVersion": "伺服器版本",
      "migration": "中繼資料庫遷移",
      "electron": "Electron",
      "chromium": "Chromium",
      "runtimeNode": "Node 執行環境",
      "system": {
        "title": "系統"
      },
      "dataDir": "資料目錄",
      "reveal": "在資料夾中顯示",
      "secret": {
        "title": "祕密儲存",
        "safe": "由作業系統加密",
        "plainWarning": "此電腦沒有可用的系統金鑰圈，因此你的 Adminium 祕密以未加密方式儲存在磁碟上。任何能讀取本機檔案的人都能讀取它。請設定登入金鑰圈（或 Linux 祕密服務）並重新啟動 Adminium 以保護它。"
      },
      "updates": {
        "title": "更新",
        "mode": {
          "notify": "有新版本時通知我",
          "manual": "僅在我檢查時",
          "disabled": "關閉（離線）"
        },
        "disabledBody": "自動更新已關閉（離線）。請手動安裝新版本。",
        "check": "檢查更新",
        "checking": "正在檢查…",
        "lastChecked": "上次檢查 {when}",
        "available": "版本 {version} 可用",
        "none": "你已是最新版本。",
        "unavailable": "此安裝已關閉更新。",
        "error": "無法檢查更新。",
        "download": "下載更新",
        "downloading": "正在下載… {percent}%",
        "downloaded": "版本 {version} 已可安裝",
        "restart": "重新啟動以安裝",
        "downloadError": "下載未完成。你可以重試。",
        "toast": {
          "available": "有新版本的 Adminium 可用",
          "view": "檢視",
          "downloaded": "更新已可安裝",
          "restart": "立即重新啟動"
        }
      },
      "legal": {
        "title": "授權",
        "agpl": "Adminium Desktop 是遵循 GNU Affero General Public License v3.0 的自由軟體。",
        "viewLicense": "檢視授權",
        "licenseTitle": "GNU Affero General Public License v3.0",
        "licenseUnavailable": "此組建中沒有隨附的授權檔案。",
        "viewNotices": "第三方授權",
        "noticesTitle": "第三方聲明",
        "noticesUnavailable": "第三方聲明在應用程式封裝時產生，此組建中不可用。",
        "source": "原始碼",
        "close": "關閉"
      },
      "telemetry": {
        "title": "匿名使用資料",
        "label": "分享匿名使用資料",
        "description": "協助我們決定優先支援哪些資料庫引擎。除非你開啟，否則預設關閉；絕不會傳送結構描述、資料或個人資訊。",
        "saveFailed": "無法儲存該設定。請重試。"
      },
      "diagnostics": {
        "title": "診斷",
        "description": "有助於你回報問題的詳細資訊。不包含任何結構描述或資料。",
        "copy": "複製診斷資訊",
        "copied": "已複製",
        "showLogs": "顯示記錄",
        "dataSize": "資料大小：{size}"
      }
    }
  },
  "apiKeys": {
    "title": "API 金鑰與權杖",
    "subtitle": "管理對工作區的程式化存取。",
    "createButton": "建立金鑰",
    "copy": "複製",
    "copied": "已複製",
    "revoke": "撤銷金鑰",
    "neverUsed": "從未使用",
    "lastUsed": "上次使用於 {since}",
    "scopesOverflow": "另有 {count} 項",
    "status": {
      "active": "有效",
      "revoked": "已撤銷",
      "expired": "已逾期"
    },
    "list": {
      "title": "金鑰",
      "activeCount": "{count, plural, other {# 個有效金鑰}}"
    },
    "empty": {
      "title": "尚無 API 金鑰",
      "body": "建立一個，即可在自己的程式碼中呼叫 Adminium API。"
    },
    "revealed": {
      "title": "新金鑰已建立",
      "body": "請立即複製 —— 之後將無法再次檢視。"
    },
    "rolesUnavailable": {
      "title": "你無權檢視角色",
      "body": "建立金鑰須選擇它所代表的角色，而你的帳號無法讀取角色清單。請向管理員申請「管理角色」權限。"
    },
    "quickStart": {
      "title": "快速開始",
      "body": "在 Authorization 標頭中帶入金鑰完成驗證。"
    },
    "create": {
      "title": "建立 API 金鑰",
      "description": "此金鑰將以你所選角色的權限運作。",
      "name": "名稱",
      "namePlaceholder": "例如：分析資料管線",
      "role": "角色",
      "roleHelper": "選擇足以完成工作的最小權限角色。",
      "expires": "到期時間",
      "expiresHelper": "留空表示金鑰永不到期。",
      "submit": "建立金鑰",
      "failed": "無法建立金鑰"
    },
    "revokeConfirm": {
      "title": "撤銷 API 金鑰",
      "body": "任何仍以「{name}」呼叫 API 的程式碼將立即失敗。此動作無法復原。",
      "prompt": "輸入「{name}」以確認",
      "confirm": "撤銷金鑰"
    }
  },
  "changelog": {
    "title": "變更紀錄",
    "subtitle": "產品更新與版本發佈。",
    "allReleases": "所有版本",
    "tag": {
      "new": "新增",
      "improved": "改進",
      "fixed": "修正",
      "security": "安全性"
    },
    "filter": {
      "all": "全部",
      "label": "依類型篩選變更"
    },
    "empty": {
      "title": "此篩選下沒有內容",
      "body": "尚無版本包含這類變更。",
      "clear": "顯示所有變更"
    }
  },
  "kb": {
    "title": "知識庫",
    "subtitle": "{count, plural, other {# 篇指南}} · 完整文件請見 docs.adminium.dev",
    "openDocs": "開啟文件",
    "browse": "依主題瀏覽",
    "hero": {
      "title": "需要什麼協助？",
      "subtitle": "搜尋指南、API 文件與疑難排解。",
      "placeholder": "搜尋知識庫…",
      "label": "搜尋知識庫",
      "clear": "清除搜尋"
    },
    "category": {
      "start": "入門",
      "connect": "連接資料",
      "api": "API 與開發",
      "security": "安全性與存取",
      "selfhost": "自架",
      "trouble": "疑難排解",
      "count": "{count, plural, other {# 篇文章}}",
      "selected": "篩選中"
    },
    "list": {
      "all": "所有指南",
      "clear": "清除篩選"
    },
    "empty": {
      "title": "沒有符合的指南",
      "body": "換個關鍵字，或前往 docs.adminium.dev 搜尋完整文件。",
      "openDocs": "開啟文件"
    },
    "article": {
      "install": {
        "title": "安裝 Adminium",
        "excerpt": "從原始碼簽出執行，或使用 docker run，一分鐘內進入首次執行精靈。"
      },
      "firstAdmin": {
        "title": "建立第一位超級管理員",
        "excerpt": "首次執行精靈會詢問什麼，以及它為何只能執行一次。"
      },
      "connectDb": {
        "title": "連接你的第一個資料庫",
        "excerpt": "將 Adminium 指向 PostgreSQL、MySQL 或 SQLite，產生後台管理應用。"
      },
      "schemaFile": {
        "title": "從結構描述檔產生",
        "excerpt": "上傳 Prisma schema、Django models.py、Rails schema.rb 或 .sql 傾印檔 —— 無需資料庫連線。"
      },
      "readOnly": {
        "title": "使用唯讀角色",
        "excerpt": "自省僅讀取結構描述中繼資料。請只授予 Adminium 必要的最小權限。"
      },
      "apiKeys": {
        "title": "使用 API 金鑰驗證",
        "excerpt": "建立與撤銷金鑰，以及金鑰為何只向你顯示一次。"
      },
      "rest": {
        "title": "REST API 參考",
        "excerpt": "產生的應用所公開的每個端點，含請求與回應結構。"
      },
      "manifest": {
        "title": "頁面資訊清單",
        "excerpt": "頁面如何以組態描述，以及如何手動編輯。"
      },
      "roles": {
        "title": "角色與權限",
        "excerpt": "指派檢視者、編輯者與管理員，並以權限矩陣自訂角色。"
      },
      "audit": {
        "title": "閱讀稽核紀錄",
        "excerpt": "誰在何時、從何處更動了什麼。"
      },
      "secrets": {
        "title": "Adminium 如何保存你的機密",
        "excerpt": "連線憑證以 ADMINIUM_SECRET 加密儲存，API 金鑰則以雜湊保存。"
      },
      "docker": {
        "title": "以 Docker 自架",
        "excerpt": "官方映像檔、docker-compose，以及獨立中繼資料庫的運行方式。"
      },
      "backup": {
        "title": "備份與搬遷執行個體",
        "excerpt": "export-zip 會打包伺服器組態；匯入後可在他處重現同一套設定。"
      },
      "telemetry": {
        "title": "遙測與更新檢查",
        "excerpt": "兩者皆為選擇性啟用，預設關閉。啟用後會送出哪些內容。"
      },
      "connectionFails": {
        "title": "資料庫連線失敗",
        "excerpt": "查看診斷卡片：主機、連接埠、TLS，以及資料庫須放行的 IP。"
      },
      "missingTables": {
        "title": "自省後缺少資料表",
        "excerpt": "結構描述可見性、被排除的資料表，以及重新執行產生。"
      }
    }
  },
  "desktop": {
    "menu": {
      "file": "檔案",
      "fileNewDatabase": "新增本機資料庫…",
      "fileOpenSqlite": "開啟 SQLite 檔案…",
      "fileBackupNow": "立即備份…",
      "fileRestore": "從備份還原…",
      "edit": "編輯",
      "view": "檢視",
      "window": "視窗",
      "help": "說明",
      "helpDocs": "Adminium 文件",
      "helpShortcuts": "鍵盤快速鍵",
      "helpLogs": "顯示日誌",
      "helpCheckForUpdates": "檢查更新…",
      "helpAbout": "關於 Adminium"
    },
    "settings": {
      "explainer": "這些設定僅適用於這台電腦上的 Adminium 應用程式，會儲存在本機，不會儲存到你的工作區。",
      "title": "桌面設定"
    },
    "security": {
      "heading": "登入"
    },
    "requireLogin": {
      "label": "在此裝置上要求登入",
      "description": "Adminium 通常會在這台電腦上自動登入。開啟後，每次啟動都會要求輸入密碼——如果其他人也可能使用這台電腦，建議開啟。此設定會在下次開啟 Adminium 時生效。",
      "savedOn": "下次啟動時需要登入",
      "savedOff": "Adminium 將在這台電腦上略過登入",
      "saveFailed": "無法儲存此設定，請重試。"
    },
    "chip": {
      "local": "本機",
      "lanShare": "本機 · 已在區域網路分享",
      "remoteDb": "本機 + 遠端資料庫",
      "remoteDbOffline": "遠端資料庫離線",
      "remoteDbOfflineDetail": "無法連線 {names}。這些連線的頁面會顯示重新連線狀態。"
    },
    "lan": {
      "heading": "在區域網路中分享",
      "label": "允許此網路中的其他裝置使用 Adminium",
      "description": "同一網路中的其他電腦、平板和手機可以在瀏覽器中開啟 Adminium，並用各自的帳戶登入。Adminium 必須在這台電腦上保持開啟，他們才能存取。",
      "savedOn": "正在區域網路中分享",
      "savedOff": "已停止分享 — Adminium 恢復為僅限這台電腦",
      "saveFailed": "無法變更網路分享",
      "noUsers": "目前只有你擁有帳戶，因此還沒有其他人能登入。分享仍然可用 — 只是需要先邀請其他人才能使用。",
      "usersUnknown": "Adminium 無法檢查這台電腦上還有誰擁有帳戶。共用仍然有效，任何擁有帳戶的人都可以登入——只有這項檢查失敗了。",
      "acknowledge": "我知道了 — 我接下來會邀請其他人",
      "port": "連接埠",
      "portHelper": "預設 {port}",
      "portInvalid": "請輸入 1024 到 65535 之間的數字。",
      "applyPort": "變更連接埠",
      "portInUse": "連接埠 {port} 已被其他程式占用。",
      "portInUseHint": "未做任何變更 — 分享仍處於關閉狀態。",
      "portInUseNoSuggestion": "未做任何變更。請嘗試其他連接埠。",
      "tryPort": "嘗試 {port}",
      "urlsHeading": "在其他裝置上開啟",
      "noUrls": "這台電腦目前未連線到網路，因此沒有可分享的位址。連線 Wi-Fi 或插入網路線後，此清單會自動填入。",
      "copyUrl": "複製",
      "sessions": "{count, plural, =0 {沒有來自此網路的裝置登入} other {已有 # 台裝置從此網路登入}}",
      "sessionsUnknown": "正在檢查已連線的裝置…",
      "pending": "正在開始分享…",
      "mismatch": "Adminium 在此網路中仍可存取",
      "mismatchBody": "分享已關閉，但伺服器尚未釋放網路。請重新啟動 Adminium 以關閉它。",
      "transportTitle": "區域網路中的流量未加密。",
      "transportBody": "僅在你信任的網路中分享。如需遠端存取，請使用置於 HTTPS 之後的 Adminium 自架版本。",
      "firewall": "首次分享時，作業系統會詢問是否允許傳入連線 — 請選擇「允許」，否則其他裝置將無法存取 Adminium。",
      "manageTeam": "管理使用者與角色"
    },
    "setup": {
      "title": "歡迎使用 Adminium",
      "subtitle": "只需四個簡短步驟，Adminium 就能從你的資料庫生成一個管理應用程式。所有內容都保留在這台電腦上。",
      "progress": "設定進度",
      "back": "上一步",
      "continue": "繼續",
      "createAccount": "建立帳戶並繼續",
      "step": {
        "location": "歡迎",
        "database": "你的第一個資料庫",
        "account": "你的帳戶",
        "generate": "生成"
      },
      "dataDir": {
        "heading": "Adminium 應該把你的資料儲存在哪裡？",
        "description": "你的資料庫、設定和備份都存放在這個資料夾中。所有內容都保留在這台電腦上——不會上傳到任何地方。",
        "label": "資料夾",
        "loading": "正在讀取目前位置…",
        "pending": "繼續時 Adminium 會重新啟動，以便切換到這個資料夾。",
        "change": "變更…",
        "revert": "復原",
        "dialogTitle": "選擇 Adminium 儲存資料的位置",
        "cloudSyncTitle": "該資料夾會同步到雲端",
        "cloudSyncWarning": "Adminium 將資料儲存在 SQLite 檔案中。{provider} 會在背景複製「{folder}」中的檔案進行同步，這可能損毀正在開啟的資料庫——並在毫無提示的情況下遺失資料。請選擇 {provider} 之外的資料夾。",
        "chooseAnother": "選擇其他資料夾",
        "useAnyway": "仍然使用——我接受風險",
        "unusableTitle": "Adminium 無法使用該資料夾",
        "failed": "Adminium 無法使用該資料夾。"
      },
      "source": {
        "heading": "Adminium 應該根據什麼來建構？",
        "description": "Adminium 會讀取資料庫的結構並據此生成管理應用程式。你之後可以新增更多資料庫。",
        "groupLabel": "資料庫來源",
        "local": {
          "title": "建立新的本機資料庫",
          "description": "從零開始，或使用你已有的結構檔。資料庫會建立在你的資料夾中。",
          "name": "資料庫名稱",
          "namePlaceholder": "營運",
          "nameUnusable": "請至少使用一個字母或數字——檔名由此生成。",
          "fileHelper": "將建立 {file}",
          "schemaLabel": "起始方式",
          "blank": "空白",
          "fromFile": "結構檔",
          "schemaFile": "結構檔",
          "schemaFileHelper": ".sql、pg_dump、Prisma、Drizzle、TypeORM、Sequelize、schema.rb、Django 或 Adminium JSON。Adminium 會將其轉換為 SQLite。",
          "placeholder": "自動生成佔位資料",
          "placeholderHelper": "你匯入的結構沒有資料列。為每個資料表填入逼真的範例資料，讓儀表板和圖表立刻能夠呈現。"
        },
        "openSqlite": {
          "title": "開啟現有的 SQLite 檔案",
          "description": "讓 Adminium 指向這台電腦上的 .sqlite 檔案。檔案會在原處開啟——不會複製或移動。",
          "browse": "選擇一個 .sqlite 檔案…",
          "change": "選擇其他檔案…",
          "networkTitle": "該檔案位於網路共用上",
          "networkBody": "SQLite 的鎖定機制在網路檔案共用上並不可靠，寫入過程中斷線可能損毀資料庫。複製到這台電腦本機磁碟上更安全。"
        },
        "remote": {
          "title": "連線到伺服器資料庫",
          "description": "PostgreSQL 或 MySQL。需要一個可存取的網路資料庫；Adminium 自身的資料表仍然保留在這台電腦上。",
          "networkNote": "需要一個可存取的網路資料庫",
          "metaNote": "無論如何，Adminium 自身的資料表——你的頁面、設定和登入資訊——都保留在這台電腦的資料夾中。",
          "engine": "引擎",
          "name": "連線名稱",
          "namePlaceholder": "正式環境",
          "dsn": "連線字串",
          "dsnHelper": "Adminium 會在連線時測試它。如果你只需要儀表板，請使用唯讀角色。"
        },
        "demo": {
          "title": "體驗示範資料庫",
          "description": "一個現成的團隊營運資料庫，讓你在指向自己的資料之前先看看 Adminium 會建構出什麼。你可以隨時刪除它。",
          "unavailable": "此版本不包含示範資料，因此沒有可載入的內容。請選擇上面的某個選項。"
        }
      },
      "account": {
        "heading": "建立你的帳戶",
        "description": "這是這份 Adminium 的管理員帳戶。密碼用於保護你的備份以及你在網路上共用的對象——每次啟動時不會向你索取密碼。",
        "name": "你的姓名",
        "email": "電子郵件",
        "password": "密碼",
        "passwordHelper": "至少 {min} 個字元。",
        "confirm": "確認密碼",
        "strength": "密碼強度",
        "strengthLevels": {
          "weak": "弱",
          "fair": "普通",
          "good": "良好",
          "strong": "強"
        },
        "singleUser": "在這台電腦上略過登入",
        "singleUserHelper": "在這裡開啟時，Adminium 會自動為你登入。如果其他人也使用這台機器，請關閉此項。你之後可以在 設定 → 桌面 中變更。",
        "locale": "語言",
        "theme": "外觀",
        "alreadyExists": "這份 Adminium 已經有一個帳戶。請改用該帳戶登入。",
        "failed": "Adminium 無法建立該帳戶。"
      },
      "generate": {
        "creating": "正在設定你的資料庫…",
        "introspecting": "正在讀取你的結構——資料表、欄位和關聯…",
        "working": "處理中…",
        "offlineNote": "這一切都在這台電腦上完成。",
        "failedTitle": "Adminium 無法設定該資料庫",
        "failedBody": "出了點問題。請重試。",
        "retry": "重試"
      }
    }
  },
  "capabilities": {
    "heading": "應用程式權限",
    "description": "您安裝的應用程式可以要求使用本電腦的硬體。您需逐一核准，並可隨時撤銷存取權限。",
    "grantedTo": "已允許 {app}",
    "status": {
      "available": "可用",
      "stub": "尚未可用",
      "unavailable": "無法使用"
    },
    "allow": {
      "action": "允許…"
    },
    "revoke": {
      "action": "撤銷",
      "saved": "已撤銷存取權限",
      "failed": "無法撤銷存取權限，請重試。"
    },
    "grant": {
      "saved": "已允許存取",
      "failed": "無法允許存取，請重試。"
    },
    "catalog": {
      "printerEscpos": {
        "name": "收據印表機 (ESC/POS)",
        "scope": "在收據印表機上列印並開啟連接的錢櫃"
      }
    },
    "consent": {
      "title": "允許 {app}？",
      "subtitle": "{app} 要求使用本電腦的硬體。",
      "willAllow": "這將允許 {app}：",
      "revokeNote": "您可以隨時在「設定 → 桌面」中撤銷。僅允許您信任的應用程式。",
      "deny": "暫不",
      "approve": "允許"
    }
  },
  "emailTemplates": {
    "title": "郵件範本",
    "subtitle": "工作區傳送的交易與生命週期郵件。",
    "search": "搜尋範本…",
    "loadFailed": "無法載入範本",
    "empty": "尚未有郵件範本",
    "emptyBody": "伺服器建立範本或您建立範本後，會顯示在這裡。",
    "noMatches": "沒有相符的範本",
    "noMatchesBody": "試試其他搜尋詞。",
    "live": "已啟用",
    "disabled": "已停用",
    "name": "範本名稱",
    "subject": "主旨",
    "enabled": "已啟用"
  },
  "board": {
    "addCard": "新增卡片",
    "compose": {
      "placeholder": "卡片標題…",
      "add": "新增",
      "cancel": "取消"
    },
    "empty": {
      "title": "沒有看板欄",
      "body": "新增狀態欄位，將卡片分組到欄中。"
    }
  },
  "calendar": {
    "dateRange": "日期範圍",
    "compose": {
      "placeholder": "事件標題…",
      "add": "新增",
      "cancel": "取消",
      "open": "新增事件"
    },
    "agenda": {
      "empty": "尚無排程"
    }
  },
  "scheduler": {
    "prevWeek": "上一週",
    "nextWeek": "下一週",
    "week": "週",
    "month": "月",
    "resource": "資源",
    "coverage": "覆蓋",
    "addShift": "新增班次",
    "shiftCount": "{n} 個班次"
  },
  "planning": {
    "drawer": {
      "close": "關閉",
      "loading": "正在載入記錄",
      "error": "無法載入此記錄。"
    }
  },
  "files": {
    "uploadsUnavailable": "此頁面尚不支援上傳。"
  },
  "chat": {
    "messageSent": "訊息已傳送",
    "sendFailed": "訊息無法傳送。"
  },
  "templates": {
    "crud": {
      "title": "記錄",
      "description": "可搜尋的資料表格，支援新增、編輯與刪除。"
    },
    "dashboard": {
      "title": "儀表板",
      "description": "由您自行排列的圖表與指標格線。"
    },
    "board": {
      "title": "看板",
      "description": "依狀態分欄的卡片，可在欄之間拖曳。"
    },
    "calendar": {
      "title": "行事曆",
      "description": "依日期排在月檢視或週檢視格線上的記錄。"
    },
    "scheduler": {
      "title": "排班",
      "description": "誰在做什麼——以每人一列的時間軸呈現。"
    },
    "logViewer": {
      "title": "記錄檔",
      "description": "密集且可篩選的事件列，附詳細追蹤。"
    },
    "files": {
      "title": "檔案",
      "description": "以可瀏覽的資料庫形式呈現檔案與資料夾。"
    },
    "chat": {
      "title": "聊天",
      "description": "附訊息歷史的對話討論串。"
    },
    "builder": {
      "title": "建立工具",
      "description": "用於製作文件與範本的拖放畫布。"
    },
    "wizard": {
      "title": "精靈",
      "description": "引導式的分步流程，逐步完成工作。"
    },
    "settings": {
      "title": "設定",
      "description": "分組的偏好設定列，含開關與欄位。"
    },
    "directory": {
      "title": "通訊錄",
      "searchPlaceholder": "搜尋人員…",
      "allFilter": "全部",
      "clearFilters": "清除篩選",
      "detailTitle": "人員",
      "emptyTitle": "尚未有人員",
      "emptyBody": "資料表有資料後，人員會顯示在這裡。",
      "noMatchesTitle": "沒有相符的人員",
      "noMatchesBody": "試試其他搜尋詞或移除篩選。",
      "errorTitle": "無法載入此通訊錄",
      "loading": "正在載入人員",
      "memberCount": "{count} 人",
      "description": "以卡片呈現人員，並附組織圖。"
    },
    "masterDetail": {
      "title": "清單與詳情",
      "allFilter": "全部",
      "clearFilters": "清除篩選",
      "emptyTitle": "這裡還沒有內容",
      "emptyBody": "資料表有資料後，記錄會顯示在這裡。",
      "noMatchesTitle": "沒有相符的記錄",
      "noMatchesBody": "試試移除篩選。",
      "errorTitle": "無法載入此清單",
      "loading": "正在載入記錄",
      "selectPrompt": "選擇一筆記錄",
      "description": "左側是清單，選取的記錄顯示在旁邊。"
    },
    "queueInbox": {
      "title": "佇列",
      "approve": "核准",
      "reject": "拒絕",
      "allSegment": "全部",
      "approvedToast": "已核准 {count} 項。",
      "rejectedToast": "已拒絕 {count} 項。",
      "undoneToast": "已復原該決定。",
      "failedToast": "操作失敗。",
      "bulkFailed": "所選列中有 {failed}/{total} 列未能更新。",
      "undoFailedToast": "無法復原該決定。",
      "rejectTitle": "拒絕請求",
      "rejectCount": "已選 · {count}",
      "rejectNote": "請求者會收到通知與您的備註。",
      "rejectPlaceholder": "為請求者新增備註…",
      "rejectConfirm": "拒絕",
      "emptyTitle": "佇列是空的",
      "emptyBody": "新請求送達後會顯示在這裡。",
      "caughtUpTitle": "全部處理完畢",
      "caughtUpBody": "此索引標籤目前沒有請求。",
      "errorTitle": "無法載入此佇列",
      "loading": "正在載入佇列",
      "selectPrompt": "選擇一個請求",
      "daysUnit": "{count} 天",
      "description": "附有核准與拒絕操作的工作佇列。"
    }
  },
  "dataio": {
    "back": "返回",
    "import": {
      "title": "匯入資料",
      "stepUpload": "上傳",
      "stepMap": "對應欄位",
      "stepValidate": "驗證",
      "stepRun": "匯入並檢查",
      "targetLabel": "目標資料表",
      "targetPlaceholder": "選擇一個資料表頁面…",
      "notATable": "該頁面不是資料表——請選擇要匯入的資料表頁面。",
      "dropTitle": "拖放 CSV 檔案以匯入",
      "dropHint": "CSV 最大 32 MB——第一列必須是標題列",
      "skipTarget": "不匯入",
      "mapHint": "{file} 中有 {count} 行資料——請為每一欄選擇目標。",
      "validating": "正在驗證…",
      "toValidate": "驗證",
      "validateFailed": "驗證失敗。",
      "validationSummary": "{total} 行中有 {valid} 行可匯入——將略過 {invalid} 行。",
      "allValid": "所有列均通過驗證",
      "run": "執行匯入",
      "runSkipping": "匯入 {valid} 行（略過 {invalid} 行）",
      "progressLabel": "匯入進度",
      "running": "正在匯入…",
      "kpiTotal": "檔案中的列數",
      "kpiCreated": "已建立",
      "kpiUpdated": "已更新",
      "kpiSkipped": "已略過",
      "inconsistent": "匯入數字不一致——總數必須等於已建立 + 已更新 + 已略過。",
      "downloadErrors": "下載略過列報告（CSV）",
      "runFailed": "匯入失敗。"
    },
    "exports": {
      "title": "資料匯出",
      "tableLabel": "資料表",
      "tablePlaceholder": "選擇資料表…",
      "notATable": "該頁面不是資料表——請選擇要匯出的資料表頁面。",
      "formatLabel": "格式",
      "create": "匯出",
      "createFailed": "無法發起匯出。",
      "retention": "匯出檔案保留 30 天後過期。",
      "statusProcessing": "處理中…",
      "statusReady": "已就緒——{rows} 行·點擊下載",
      "statusFailed": "失敗——{error}",
      "statusCancelled": "已取消",
      "statusExpired": "已過期",
      "emptyTitle": "尚未有匯出",
      "emptyBody": "在上方發起匯出——產出的檔案會連同狀態顯示在這裡。"
    }
  },
  "reports": {
    "title": "排程報表",
    "subtitle": "頁面的定期資料快照，以應用程式內通知送達。",
    "new": "新增報表",
    "loadFailed": "無法載入排程報表。",
    "saveFailed": "無法儲存此報表。",
    "nextRun": "下次執行",
    "emptyTitle": "尚未有排程報表",
    "emptyBody": "建立一個，即可定期取得任一資料表頁面的資料快照。",
    "createTitle": "新增排程報表",
    "editTitle": "編輯排程報表",
    "nameLabel": "名稱",
    "namePlaceholder": "例如：每週營收",
    "pageLabel": "頁面",
    "pagePlaceholder": "選擇頁面…",
    "frequencyLabel": "頻率",
    "frequency": {
      "daily": "每天",
      "weekly": "每週",
      "monthly": "每月"
    },
    "dayOfWeekLabel": "星期",
    "dayOfMonthLabel": "每月日期",
    "timeLabel": "時間",
    "timezoneLabel": "時區",
    "formatLabel": "送達方式",
    "formatHint": "資料快照（PDF/PNG 轉譯將在後續版本推出）——每次執行都會產生 CSV 快照與應用程式內通知。",
    "recipientsLabel": "收件者",
    "recipientsHint": "與報表一起儲存。郵件送達將在後續版本推出——目前執行結果以應用程式內通知提醒您。",
    "deliveryBadge": "CSV 快照",
    "delete": "刪除",
    "create": "建立",
    "cadence": {
      "daily": "每天 {time}（{zone}）",
      "weekly": "每週 · {day} {time}（{zone}）",
      "monthly": "每月 · {day} 日 {time}（{zone}）"
    }
  },
  "notifications": {
    "channel": {
      "inApp": "應用程式內",
      "email": "郵件",
      "push": "推播"
    },
    "event": {
      "reportReady": "排程報表已就緒",
      "reportFailed": "排程報表失敗",
      "backupCompleted": "備份完成"
    }
  },
  "theme": {
    "toLight": "淺色模式",
    "toDark": "深色模式"
  },
  "studioPages": {
    "title": "頁面",
    "subtitle": "新增、編輯與整理應用程式的頁面，以及它們在側邊欄中的排序。",
    "createButton": "新增頁面",
    "loadFailed": {
      "title": "無法載入頁面",
      "body": "管理頁面需要「管理頁面」權限。請聯絡管理員將該權限授予您的其中一個角色。"
    },
    "tab": {
      "pages": "所有頁面",
      "sidebar": "側邊欄排序"
    },
    "list": {
      "title": "頁面",
      "count": "{count, plural, other {# 個頁面}}"
    },
    "empty": {
      "title": "尚無頁面",
      "body": "連線資料庫即可自動產生頁面，也可以手動建立一個。"
    },
    "status": {
      "live": "已啟用",
      "hidden": "已隱藏"
    },
    "origin": {
      "generated": "自動產生",
      "manifest": "外掛",
      "llm": "助理",
      "system": "系統",
      "user": "自訂"
    },
    "row": {
      "menu": "{title} 的操作"
    },
    "action": {
      "edit": "編輯頁面",
      "duplicate": "建立複本",
      "hide": "在側邊欄中隱藏",
      "show": "在側邊欄中顯示",
      "delete": "刪除頁面"
    },
    "create": {
      "title": "新增頁面",
      "failed": "無法建立頁面",
      "submit": "建立頁面",
      "subtitle": "選擇此頁面顯示什麼以及外觀如何。預覽會跟隨您的選擇。"
    },
    "duplicate": {
      "title": "建立頁面複本",
      "failed": "無法建立複本",
      "submit": "建立複本"
    },
    "delete": {
      "title": "確定要刪除此頁面嗎？",
      "body": "此操作無法復原。此頁面上所有已儲存的檢視與個人版面配置將對所有人刪除。",
      "bodyGenerated": "此頁面由結構描述產生，下次重新產生時會再次出現。已儲存的檢視與個人版面配置將對所有人刪除。",
      "prompt": "輸入 {slug} 以確認",
      "confirm": "刪除頁面"
    },
    "field": {
      "title": "標題",
      "titleHint": "顯示在側邊欄與頁面標題列中。",
      "slug": "頁面網址",
      "slugHint": "僅限小寫字母、數字與連字號。只需填寫最後一段，其餘部分會自動補上。",
      "slugTaken": "已有其他頁面使用此網址。",
      "slugWarning": "變更網址會使指向此頁面的現有連結與書籤失效。",
      "template": "範本",
      "templateHint": "決定頁面可以承載哪些內容，之後可以變更。",
      "group": "側邊欄群組",
      "groupHint": "頁面出現在側邊欄的哪個區塊。",
      "icon": "圖示",
      "iconHint": "顯示在側邊欄中頁面名稱的旁邊。",
      "visible": "在側邊欄中顯示",
      "visibleHint": "隱藏的頁面仍可透過網址存取，只要對方有連結。",
      "table": "資料表",
      "tableCreateHint": "此頁面讀取的資料表。現在選擇即可直接使用；留空則可稍後再繫結。",
      "tableNone": "未繫結",
      "tableNeedsConnection": "請先選擇資料來源。",
      "connection": "資料來源",
      "connectionNone": "無",
      "iconPick": "選擇頁面圖示",
      "padding": "頁面內距"
    },
    "editor": {
      "title": "編輯頁面",
      "save": "儲存變更",
      "saveFailed": "無法儲存變更",
      "openPage": "開啟頁面",
      "generated": {
        "title": "此頁面依您的結構描述產生",
        "body": "重新產生時會保留您的修改：頁面會標記為已編輯並原樣保留。但刪除只在下次產生前有效，屆時頁面會重新建立。"
      },
      "contentUnavailable": "無法載入頁面內容",
      "contentUnavailableBody": "上方的設定仍可儲存。",
      "contentInvalid": "無法讀取此頁面的設定",
      "contentInvalidBody": "設定由較新的版本寫入，或已損毀。請重新產生或刪除此頁面。",
      "data": "資料",
      "schemaFailed": "無法列出資料表",
      "schemaFailedBody": "此連線可能尚未分析。請在「工作室 → 資料連線」中執行結構分析。",
      "notBindable": "此範本不繫結單一資料表",
      "notBindableBody": "它的內容由小工具逐一組成。開啟頁面並點選「編輯」即可加入。",
      "recompose": "此頁面將重新建立",
      "recomposeBody": "儲存後會依上方的範本與資料表用全新版面配置取代頁面內容。此頁面上的欄位調整與小工具變更將會遺失。",
      "missing": "此頁面已不存在",
      "missingBody": "它可能已被刪除，或被某次重新產生移除。",
      "details": "詳細資訊",
      "itemsPending": "請先儲存上方的變更——頁面內容將依新的範本與資料表重建。",
      "columns": "欄位",
      "appearance": "外觀"
    },
    "sidebar": {
      "help": "在群組內重新排序頁面，或將頁面移至其他群組。變更會對所有人生效。",
      "discard": "捨棄",
      "save": "儲存排序",
      "saveFailed": "無法儲存新的排序",
      "emptyGroup": "此群組中沒有頁面。",
      "moveUp": "將 {title} 上移",
      "moveDown": "將 {title} 下移",
      "moveTo": "將 {title} 移至其他群組",
      "ungrouped": {
        "title": "有些頁面不屬於任何側邊欄群組",
        "body": "這些頁面可透過網址存取，但不會出現在側邊欄中。請逐一開啟並選擇群組。"
      }
    },
    "columns": {
      "help": "重新排序欄位、重新命名欄位標題，並選擇哪些欄位顯示在表格中。",
      "discard": "捨棄",
      "save": "儲存欄位",
      "saveFailed": "無法儲存欄位",
      "pk": "主鍵",
      "pii": "個人資料",
      "header": "{name} 的欄位標題",
      "shown": "顯示",
      "toggle": "在表格中顯示 {name}",
      "moveUp": "將 {name} 上移",
      "moveDown": "將 {name} 下移",
      "remove": "移除 {name}",
      "none": {
        "title": "此頁面尚無欄位",
        "body": "產生頁面時會從資料表讀取欄位。請將此頁面繫結至資料表後重新產生。"
      }
    },
    "icon": {
      "none": "選擇圖示",
      "search": "搜尋圖示",
      "noMatches": "沒有圖示符合此搜尋。"
    },
    "preview": {
      "untitled": "未命名頁面",
      "note": "這是版面示意圖，不是您的資料。儲存後真實頁面才會填入內容。"
    },
    "padding": {
      "default": "此範本的預設值",
      "none": "無",
      "standard": "標準 (28 × 24)",
      "custom": "自訂…",
      "x": "左右 (px)",
      "y": "上下 (px)"
    }
  },
  "audit": {
    "action": {
      "view": "檢視"
    },
    "actor": {
      "apiKey": "API 金鑰",
      "automation": "自動化",
      "system": "系統",
      "user": "使用者"
    },
    "category": {
      "auth": "登入與帳戶",
      "automation": "自動化",
      "connection": "連線",
      "data": "記錄",
      "export": "匯入與匯出",
      "llm": "AI 協助",
      "rbac": "角色與權限",
      "schema": "結構描述",
      "settings": "設定",
      "system": "系統"
    },
    "column": {
      "action": "動作",
      "actor": "執行者",
      "category": "類別",
      "details": "詳細資料",
      "when": "時間"
    },
    "drawer": {
      "actorId": "執行者 ID",
      "actorKind": "執行者類型",
      "after": "變更後",
      "before": "變更前",
      "category": "類別",
      "changes": "變更內容",
      "connection": "連線",
      "field": "欄位",
      "ip": "IP 位址",
      "noChanges": "此動作沒有記錄變更前後的內容。",
      "none": "無",
      "requestId": "要求 ID",
      "resource": "資源",
      "subtitle": "{actor} · {when}",
      "truncated": "已於 16 KB 處截斷",
      "userAgent": "使用者代理程式"
    },
    "empty": {
      "body": "資料、結構描述、設定與權限的變更，會在發生時顯示在這裡。",
      "filtered": {
        "body": "請擴大日期範圍，或清除類別篩選。",
        "title": "沒有項目符合這些篩選條件"
      },
      "title": "尚未記錄任何項目"
    },
    "filterActor": "執行者 ID",
    "filterCategoryAny": "任何類別",
    "filterCategory": "依類別篩選",
    "filterFrom": "起始",
    "filterTo": "結束",
    "listFailed": {
      "title": "無法載入稽核紀錄"
    },
    "loadMore": "載入較舊的項目",
    "subtitle": "這個工作區中的每一項變更、由誰執行，以及變更了什麼。",
    "title": "稽核紀錄"
  },
  "roles": {
    "action": {
      "delete": "刪除",
      "rename": "重新命名"
    },
    "builtinLocked": "內建角色無法刪除。",
    "category": {
      "access": "存取",
      "data": "資料",
      "operations": "維運",
      "workspace": "工作區"
    },
    "column": {
      "actions": "操作",
      "members": "成員",
      "name": "角色"
    },
    "create": {
      "descriptionLabel": "說明",
      "description": "新角色一開始完全沒有任何權限。",
      "failed": "無法建立角色",
      "namePlaceholder": "例如：客服人員",
      "name": "名稱",
      "submit": "建立角色",
      "title": "新增角色"
    },
    "createButton": "新增角色",
    "delete": {
      "confirm": "刪除角色",
      "description": "此角色與它的權限設定列都會被移除。",
      "failed": "無法刪除角色",
      "hasMembers": "「{name}」仍有 {count, plural, other {# 位成員}}。請選擇要把他們移到哪個角色——Adminium 不會讓任何帳戶沒有角色。",
      "noMembers": "沒有人擁有「{name}」，因此不會有任何成員需要移動。",
      "reassignPlaceholder": "選擇一個角色…",
      "reassignTo": "將成員移至",
      "title": "刪除角色"
    },
    "list": {
      "title": "角色"
    },
    "loadFailed": {
      "body": "下方的矩陣並不完整，因此直接儲存會清除那些只是尚未載入的權限。請先重新載入，再進行變更。",
      "title": "有部分權限無法讀取"
    },
    "matrix": {
      "discard": "捨棄",
      "empty": {
        "body": "此執行個體回報完全沒有可授予的權限，這不應該發生——請重新載入；若情況持續，請檢查伺服器日誌。",
        "title": "沒有可顯示的權限"
      },
      "label": "角色權限",
      "noChanges": "沒有待儲存的變更",
      "pending": "{count, plural, other {# 項待儲存的變更}}",
      "rowHeader": "權限",
      "title": "權限"
    },
    "memberCount": "{count, plural, other {# 位使用者}}",
    "permission": {
      "apiKeysManage": "管理 API 金鑰",
      "auditRead": "讀取稽核紀錄",
      "connectionsManage": "管理資料庫連線",
      "exportsManage": "管理所有人的匯出",
      "importsManage": "管理所有人的匯入",
      "jobsManage": "啟動與取消背景工作",
      "jobsRead": "檢視所有背景工作",
      "llmRun": "執行 AI 協助",
      "pagesManage": "建立與整理頁面",
      "reportsManage": "管理排程報表",
      "rolesManage": "管理角色與權限",
      "schemaRemap": "編輯結構描述的標籤與覆寫",
      "settingsManage": "管理工作區設定",
      "usersManage": "管理使用者"
    },
    "rename": {
      "failed": "無法重新命名角色",
      "title": "重新命名角色"
    },
    "saveFailed": {
      "title": "有部分角色無法儲存"
    },
    "subtitle": "每個角色可以做什麼。使用者會取得他所擁有的所有角色的權限總和。",
    "title": "角色與權限"
  },
  "security": {
    "password": {
      "changedBody": "下次登入時請使用新密碼。其他裝置上的工作階段不受影響——若你希望它們登出，請在下方撤銷。",
      "changed": "密碼已變更",
      "confirm": "確認新密碼",
      "current": "目前的密碼",
      "failed": "無法變更你的密碼",
      "helper": "至少 8 個字元。",
      "mismatch": "兩次輸入的密碼不一致。",
      "new": "新密碼",
      "submit": "變更密碼",
      "title": "密碼"
    },
    "sessions": {
      "expires": "{at} 到期",
      "failedBody": "這份清單是唯一能顯示你的帳戶在哪些地方登入的地方，因此清單是空的時候，應視為狀態不明，而不是視為沒有任何登入。",
      "failed": "無法讀取你的工作階段",
      "ip": "IP {ip}",
      "loading": "正在尋找其他已登入的裝置…",
      "noIp": "未記錄 IP",
      "revokeBody": "該工作階段會立即結束，正在使用它的人必須重新登入。",
      "revokeFailed": "無法將該裝置登出",
      "revokeTitle": "將此裝置登出",
      "revoke": "登出",
      "seenUnknown": "上次活動：不明",
      "seen": "上次活動 {since}",
      "thisDevice": "這台裝置",
      "title": "已登入的裝置",
      "unknownDevice": "無法辨識的裝置"
    },
    "subtitle": "你的密碼、你的第二道驗證，以及你目前登入的所有位置。",
    "title": "安全性",
    "twoFactor": {
      "activateFailed": "這組驗證碼未被接受",
      "activate": "啟用兩步驟驗證",
      "body": "驗證器應用程式會產生一組 6 位數驗證碼，Adminium 會在你輸入密碼之後要求輸入它。",
      "code": "驗證器應用程式中的驗證碼",
      "copyKey": "複製設定金鑰",
      "copyLink": "複製設定連結",
      "disableBody": "你的帳戶會恢復為僅使用密碼，而你的備用碼將會失效。",
      "disableConfirm": "關閉",
      "disableFailed": "無法關閉兩步驟驗證",
      "disablePassword": "你的密碼",
      "disableTitle": "關閉兩步驟驗證",
      "disable": "關閉兩步驟驗證",
      "enrollFailed": "無法開始設定",
      "enroll": "設定兩步驟驗證",
      "hide": "隱藏設定金鑰",
      "off": "未啟用",
      "on": "已啟用",
      "recovery": {
        "body": "如果你遺失了驗證器，每一組備用碼都可以讓你登入一次。它們只會在現在顯示這一次。",
        "copy": "複製備用碼",
        "title": "儲存你的備用碼"
      },
      "reveal": "顯示設定金鑰",
      "secretHelper": "把設定連結貼到你的驗證器中，或手動輸入這組金鑰。",
      "secret": "設定金鑰",
      "title": "兩步驟驗證"
    }
  },
  "team": {
    "action": {
      "reactivate": "重新啟用",
      "remove": "刪除",
      "resend": "新連結",
      "roles": "角色",
      "suspend": "停權"
    },
    "column": {
      "actions": "操作",
      "lastSeen": "上次活動",
      "person": "人員",
      "roles": "角色",
      "status": "狀態"
    },
    "counts": "{active} 位啟用中 · {invited} 位已邀請 · {suspended} 位已停權",
    "empty": {
      "body": "邀請團隊成員加入，讓他們擁有自己的登入帳戶與角色。",
      "filtered": {
        "body": "清除篩選條件，即可看到完整的成員名冊。",
        "title": "沒有人符合這些篩選條件"
      },
      "title": "目前只有你擁有帳戶"
    },
    "filterRoleAny": "任何角色",
    "filterRole": "依角色篩選",
    "filterStatusAny": "任何狀態",
    "filterStatus": "依狀態篩選",
    "invite": {
      "copied": "已複製",
      "copyLink": "複製連結",
      "created": {
        "body": "請你自己把這個連結傳送給 {email}。它只會顯示這一次——Adminium 只保存它的雜湊值，因此一旦遺失，你就必須刪除這份邀請並重新發出一份新的。",
        "title": "邀請已建立"
      },
      "emailIt": "以電子郵件寄送邀請",
      "expiresRelative": "此連結將於 {at} 失效（{relative}）。",
      "expires": "此連結將於 {at} 失效。",
      "noEmail": {
        "smtp": "此執行個體未設定 SMTP 伺服器，因此沒有任何可用來寄送郵件的方式。請透過你原本就信任的管道分享這個連結。",
        "title": "Adminium 沒有以電子郵件寄出這個連結",
        "unknown": "Adminium 無法確認此執行個體是否能夠寄送郵件。請透過你原本就信任的管道分享這個連結。"
      }
    },
    "inviteButton": "邀請團隊成員",
    "inviteDialog": {
      "description": "Adminium 會建立帳戶，並給你一組一次性的啟用連結，讓你轉交出去。",
      "emailPlaceholder": "name@example.com",
      "email": "電子郵件",
      "failed": "無法建立邀請",
      "namePlaceholder": "例如：陳怡君",
      "name": "姓名",
      "rolesHelper": "請選擇足以讓他們完成工作的最小權限角色。之後可以再變更。",
      "roles": "角色",
      "submit": "建立邀請",
      "title": "邀請團隊成員"
    },
    "listFailed": {
      "title": "無法載入成員名冊"
    },
    "loadMore": "載入更多",
    "neverSignedIn": "從未登入",
    "noRoles": "沒有角色",
    "remove": {
      "body": "這會抹除 {name} 的帳戶、他們的偏好設定與登入工作階段，並把他們變更過的設定紀錄中的姓名清空。改用「停權」則會保留上述全部內容，只是讓他們無法登入。此操作無法復原。",
      "confirm": "永久刪除",
      "prompt": "輸入「{email}」以確認",
      "title": "永久刪除帳戶"
    },
    "roles": {
      "unavailable": "你的帳戶無法檢視角色，因此無法在這裡指派任何角色。"
    },
    "rolesDialog": {
      "description": "使用者會取得他所擁有的所有角色的權限總和。",
      "failed": "無法變更角色",
      "title": "{name} 的角色"
    },
    "rolesLocked": "變更角色需要「管理角色」權限。",
    "search": "搜尋姓名或電子郵件",
    "status": {
      "active": "啟用中",
      "invited": "已邀請",
      "suspended": "已停權"
    },
    "subtitle": "誰在這個 Adminium 上擁有帳戶，以及他們各自可以做什麼。",
    "title": "團隊",
    "twoFactorOn": "已啟用兩步驟驗證",
    "twoFactorShort": "2FA"
  },
  "email": {
    "linkFallback": "如果按鈕無法使用，請將這個連結貼到你的瀏覽器：{url}",
    "notification": {
      "action": "開啟 {appName}",
      "footer": "你會收到這封郵件，是因為你的 {appName} 帳戶已開啟電子郵件通知。你可以在通知設定中關閉這些通知。",
      "name": "通知"
    },
    "passwordReset": {
      "action": "設定新密碼",
      "heading": "重設你的密碼",
      "intro": "{name} 你好，我們收到為 {email} 重設密碼的要求。",
      "name": "重設密碼",
      "notice": "這個連結只能使用一次，並將於 {expiresInMinutes} 分鐘後失效。如果你沒有要求重設密碼，可以忽略這封郵件——你目前的密碼仍然有效。",
      "subject": "重設你的 {appName} 密碼"
    },
    "userInvite": {
      "action": "接受邀請",
      "heading": "你已受邀",
      "intro": "{inviterName}邀請你加入 {appName}。請接受邀請，為 {email} 設定密碼並登入。",
      "name": "團隊邀請",
      "notice": "這份邀請只能使用一次，並將於 {expiresInDays} 天後失效。如果你並未預期收到這份邀請，可以忽略這封郵件。",
      "subject": "你受邀加入 {appName}",
      "inviterFallback": "一位管理員"
    }
  }
} as const;
