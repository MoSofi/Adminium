// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/onboarding.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "account": {
    "body": "第一位管理員。這只會發生一次，之後你將保持登入狀態。",
    "confirm": "確認密碼",
    "email": "電子郵件",
    "hidePassword": "隱藏密碼",
    "label": "你的帳戶",
    "name": "你的姓名",
    "password": "密碼",
    "passwordHelper": "至少 {min} 個字元。",
    "showPassword": "顯示密碼",
    "strength": "密碼強度",
    "strengthLevels": {
      "fair": "普通",
      "good": "良好",
      "strong": "很強",
      "weak": "較弱"
    },
    "sub": "登入資訊",
    "submit": "建立帳戶",
    "title": "建立你的帳戶"
  },
  "back": "返回",
  "connect": {
    "body": "把 Adminium 指向一個資料來源。我們只讀取結構，除非你要求，否則絕不寫入。",
    "bridge": {
      "body": "它由 adminium.dev 交接而來。建立帳戶後，我們會在連線精靈中開啟它，你可以在任何東西使用它之前先看清楚。",
      "title": "有一個連線字串正在等待此執行個體"
    },
    "dsn": {
      "checking": "正在檢查該資料庫……",
      "helper": "在你的帳戶建立之前，任何內容都不會離開此瀏覽器——之後我們才會測試它。",
      "incomplete": "請補上主機與資料庫，例如 postgres://user@host:5432/db",
      "invalidScheme": "無法辨識的協定——應為 postgres://、mysql://、mariadb:// 或 sqlite:",
      "label": "連線字串"
    },
    "engine": {
      "mysql": "MySQL / MariaDB",
      "postgres": "PostgreSQL",
      "sqlite": "SQLite"
    },
    "engineLabel": "資料庫引擎",
    "existing": {
      "adopt": "使用它並登入",
      "adopting": "正在把此執行個體指向它……",
      "body": "其中有 {count, plural, other {# 張 Adminium 資料表}}含有資料。你有兩個選擇：",
      "failed": "無法把此執行個體指向那個資料庫。",
      "otherSecret": "它是用另一個 ADMINIUM_SECRET 建立的：登入仍然可用，但此執行個體無法解密它儲存的連線字串。",
      "park": "保留它們並重新開始",
      "parked": {
        "body": "它們會被改名移開——每一列都保留——Adminium 會在旁邊新建自己的資料表。在你把 Adminium 自己的資料放進這個資料庫之前，不會有任何變動。",
        "title": "既有的資料表會被保留"
      },
      "restarting": "正在切換到它並重新啟動……",
      "timeout": "Adminium 已指向那個資料庫，但尚未恢復——請稍後重新載入此頁面。",
      "title": "那個資料庫已經在執行一個 Adminium"
    },
    "label": "連接資料",
    "sub": "連結資料庫",
    "title": "連接你的資料庫"
  },
  "continue": "繼續",
  "done": {
    "connected": {
      "reading": "已連線——Adminium 正在讀取你的資料庫結構。",
      "tables": "已連線 · 找到 {count, plural, other {# 張資料表}}。"
    },
    "invited": "已建立 {count, plural, other {# 份邀請}}。",
    "label": "全部就緒",
    "next": {
      "blank": "你的工作區已就緒。隨時都可以新增頁面——正如你所選擇的，我們沒有產生任何內容。",
      "generate": "你的工作區已就緒。接下來我們會挑選要包含的資料表並產生頁面。"
    },
    "storage": {
      "local": "Adminium 把自己的資料存放在這台機器的一個檔案裡。",
      "sameDb": "Adminium 把自己的資料存放在你剛連接的資料庫裡。",
      "separate": "Adminium 把自己的資料存放在你為它指定的資料庫裡。"
    },
    "sub": "開始建構",
    "title": "一切就緒！🎉"
  },
  "error": {
    "alreadyCompleted": "此執行個體已完成設定。請使用現有的管理員帳戶登入。",
    "connectionFailed": "你的帳戶已建立，而且已登入——但無法連線到那個資料庫：{detail}",
    "connectionUnknown": "資料庫沒有回應",
    "failed": "設定失敗。請檢查連線後重試。",
    "rejected": "伺服器拒絕了這些資訊。請檢查電子郵件與密碼後重試。"
  },
  "finish": "前往儀表板",
  "kicker": "第 {n} 步，共 {total} 步",
  "meta": {
    "body": "你的登入資訊、產生的頁面與儲存的設定。它與你剛連接的資料庫是分開的，Adminium 只讀取後者。",
    "label": "Adminium 的資料",
    "local": {
      "body": "不需要任何設定。適合試用 Adminium，或只執行一個執行個體。",
      "title": "存放在這台機器的檔案裡"
    },
    "moving": {
      "copying": "正在複製 Adminium 的資料……",
      "failed": "無法搬移 Adminium 的資料——請重試。",
      "restarting": "正在切換到新資料庫並重新啟動……",
      "timeout": "Adminium 已搬移資料，但尚未恢復。資料安全地存放在新資料庫中——請稍後重新載入此頁面。"
    },
    "pinned": {
      "body": "此執行個體啟動時已設定好中繼資料儲存區，因此不需要搬移。你可以稍後在 Studio 設定中變更。",
      "title": "Adminium 的資料已有歸屬"
    },
    "sameDb": {
      "alreadyAdminium": "那個資料庫已經有一個 Adminium 執行個體。返回上一步保留它的資料表並在旁邊新建，或直接登入它。",
      "body": "Adminium 會在你的資料表旁邊加入自己的 `adminium_` 資料表。只需備份一個資料庫。",
      "disabledFile": "SQLite 檔案不是伺服器，Adminium 無法在其中加入自己的資料表。",
      "disabledNoDdl": "該角色無法執行 CREATE TABLE，而 Adminium 自身的移轉需要它。",
      "disabledReadOnly": "該角色是唯讀的——Adminium 從不寫入你的資料庫。把它的資料放在檔案裡，或給它一個自己的資料庫。",
      "noSource": "你還沒有連接資料庫——先連接一個，或把 Adminium 的資料存放在檔案裡。",
      "parked": "已經在那裡的 Adminium 資料表會先被改名移開——每一列都保留——Adminium 在旁邊新建自己的資料表。",
      "title": "存放在你剛連接的資料庫裡"
    },
    "separate": {
      "body": "由你提供的 PostgreSQL 或 MySQL 資料庫。適合正式環境或多個執行個體。",
      "failed": "那個資料庫沒有回應。",
      "incomplete": "請補上主機與資料庫，例如 postgres://user@host:5432/adminium",
      "insufficient": "該角色無法執行 CREATE TABLE——Adminium 自身的移轉需要它。",
      "invalidScheme": "無法辨識的協定——應為 postgres://、mysql:// 或 mariadb://",
      "label": "Adminium 使用的連線字串",
      "ok": "可以連線，而且能夠建立資料表。",
      "test": "測試這個資料庫",
      "title": "存放在它自己的資料庫裡"
    },
    "sub": "存放位置",
    "title": "Adminium 把自己的資料放在哪裡"
  },
  "progressComplete": "已完成 {percent}%",
  "progressLabel": "設定進度",
  "skip": "略過",
  "start": {
    "body": "這只會影響我們為你產生的頁面。之後你可以隨意變更，也可以從零開始。",
    "label": "起點",
    "options": {
      "analytics": {
        "body": "只供閱讀的圖表與表格。不會寫回任何內容。",
        "title": "唯讀分析"
      },
      "blank": {
        "body": "不產生任何內容。連接資料庫後，逐一建構你想要的頁面。",
        "title": "空白畫布"
      },
      "crud": {
        "body": "資料表與表單，不含儀表板。",
        "title": "CRUD 資料表"
      },
      "fullAdmin": {
        "body": "每張資料表一個頁面，支援新增、編輯與刪除。",
        "title": "完整管理面板"
      },
      "support": {
        "body": "優先產生佇列與客戶詳細頁，並關閉刪除。",
        "title": "客服主控台"
      }
    },
    "sub": "選擇形態",
    "title": "你想先做什麼？"
  },
  "team": {
    "body": "邀請與你共事的人。之後隨時可以新增更多。",
    "copied": "已複製",
    "copyLink": "複製連結",
    "duplicate": "此人已被邀請。",
    "emailLabel": "同事的電子郵件",
    "emailed": "邀請已透過電子郵件寄出",
    "failed": "無法建立該邀請。",
    "invalidEmail": "請輸入有效的電子郵件地址。",
    "invite": "邀請",
    "label": "你的團隊",
    "note": "沒有電子郵件時，邀請會顯示一個由你自行寄送的連結。它只顯示一次——Adminium 只保留它的雜湊值。",
    "placeholder": "tongshi@gongsi.com",
    "sub": "新增成員",
    "title": "邀請你的團隊"
  }
} as const;
