// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/roles.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "delete": "刪除",
    "rename": "重新命名"
  },
  "builtinLocked": "內建角色無法刪除。",
  "category": {
    "access": "存取",
    "data": "資料",
    "operations": "維運",
    "workspace": "工作區",
    "records": "頁面與記錄",
    "apps": "應用程式"
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
    "manifestsManage": "安裝並管理應用程式和外掛",
    "jobsRead": "檢視所有背景工作",
    "llmRun": "執行 AI 協助",
    "pagesManage": "建立與整理頁面",
    "projectRead": "讀取頁面與結構描述變更以拉取到專案",
    "reportsManage": "管理排程報表",
    "rolesManage": "管理角色與權限",
    "schemaRemap": "編輯結構描述的標籤與覆寫",
    "schemaDdl": "建立、編輯與刪除資料表",
    "settingsManage": "管理工作區設定",
    "usersManage": "管理使用者",
    "filesManage": "管理所有人的檔案",
    "storageManage": "管理儲存目的地",
    "designerUse": "使用 Adminium Designer 建立應用程式"
  },
  "rename": {
    "failed": "無法重新命名角色",
    "title": "重新命名角色"
  },
  "saveFailed": {
    "title": "有部分角色無法儲存"
  },
  "subtitle": "每個角色可以做什麼。使用者會取得他所擁有的所有角色的權限總和。",
  "title": "角色與權限",
  "data": {
    "pagesView": "檢視所有頁面",
    "read": "讀取記錄",
    "readPii": "檢視記錄中的個人資料",
    "create": "建立記錄",
    "update": "編輯記錄",
    "delete": "刪除記錄",
    "export": "匯出記錄",
    "import": "匯入記錄",
    "pagesEdit": "變更頁面版面",
    "narrow": "另有 {count, plural, other {# 項}}針對單一頁面或資料表的授權同樣生效，疊加在下方各列之上。儲存時會保留它們。"
  },
  "apps": {
    "every": "開啟所有應用程式的員工畫面",
    "one": "開啟 {app} 的員工畫面"
  },
  "rows": {
    "locked": "超級管理員可存取每一列。",
    "saveFirst": "請先儲存或捨棄對權限的變更。",
    "action": "資料列",
    "actionLabel": {
      "read": "讀取",
      "update": "變更",
      "delete": "刪除"
    },
    "way": {
      "person": "{column} 中的人員",
      "listingDated": "當天在 {table} 中為它登記的任何人",
      "listing": "在 {table} 中為它登記的任何人",
      "parent": "能存取其所屬{table}的人"
    },
    "follows": "跟隨：{table}",
    "belongs": "一列屬於{ways}。",
    "sentence": {
      "all": "可存取每一列。",
      "allWhile": "每一列",
      "team": "僅屬於此人的資料列，或屬於其帶領團隊成員的資料列",
      "own": "僅屬於此人的資料列",
      "unowned": "以及尚無人負責的資料列",
      "while": "僅當 {column} 為 {values} 時",
      "by": "且僅限 {column} 指明為其本人的列"
    },
    "title": "「{role}」可存取哪些資料列",
    "intro": "角色可以存取它能開啟的資料表中的每一列，除非在此加以限制。只有當給某人該資料表的每個角色都受限時，限制才對此人生效。",
    "loadFailed": "無法讀取這些資料表。",
    "empty": {
      "title": "沒有可限制的項目",
      "body": "此角色可開啟的資料表都沒有說明資料列屬於誰。"
    },
    "tryAs": "以此人身分試看",
    "tryAsNone": "無",
    "samplePerson": "{name}（範例）",
    "failed": "無法儲存資料列限制",
    "private": "僅由每一列所屬的人員讀取，其他人都不能讀取。這裡沒有可選項目。",
    "reachLabel": "{action}：哪些資料列",
    "reach": {
      "all": "每一列",
      "own": "自己的資料列",
      "team": "自己的資料列和團隊的資料列",
      "allWhile": "每一列，僅當…"
    },
    "unowned": "以及尚無人負責的資料列",
    "widened": "此角色透過範圍較寬的權限開啟該資料表。儲存限制時，也會依名稱將該資料表授予它。",
    "count": "{name} 將看到 {total} 列中的 {reached} 列。",
    "capped": "此人帶領的人數超過單一範圍的上限，因此未統計其整個團隊。",
    "lifted": "{name} 還擁有 {roles}，該角色可存取每一列。此限制對其不生效。"
  },
  "partsOff": "它所屬的應用程式部分已關閉：在該部分開啟之前不授予任何權限。"
} as const;
