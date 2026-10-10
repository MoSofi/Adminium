// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/desktop.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "new": {
    "back": "返回",
    "change": "變更…",
    "create": "建立",
    "creating": "正在準備…",
    "failed": "無法建立此專案。",
    "heading": "建置應用程式",
    "help": "Adminium 會為你建立這個資料夾。與你的應用程式有關的一切都在其中。",
    "name": "名稱",
    "refuse": {
      "badName": "名稱中至少要有一個字母或數字。",
      "existsWithFiles": "已有同名資料夾，且其中有檔案。請換一個名稱或另選資料夾。",
      "homeFolder": "專案不能直接放在你的個人資料夾中。請在其中選擇或新增一個資料夾。",
      "insideAProject": "此資料夾位於另一個專案內。請選擇該專案之外的資料夾。",
      "insideTheApp": "專案不能放在 Adminium 本身之內。請另選資料夾。",
      "notAbsolute": "請用「變更…」按鈕選擇資料夾。",
      "systemFolder": "專案不能放在屬於系統的資料夾中。請選擇你自己的資料夾。"
    },
    "step": {
      "files": "正在準備應用程式的檔案",
      "packages": "正在取得建置應用程式所需的內容",
      "database": "正在建立資料庫",
      "opening": "正在開啟應用程式",
      "slow": "第一次時這一步最久：網路較慢時需要幾分鐘。之後的應用程式會更快。",
      "label": "正在進行的作業"
    },
    "warn": {
      "another": "另選資料夾",
      "anyway": "仍然使用",
      "dropbox": "此資料夾由 Dropbox 同步。專案在同步資料夾中運作不佳：同步可能損壞其資料。",
      "googledrive": "此資料夾由 Google Drive 同步。專案在同步資料夾中運作不佳：同步可能損壞其資料。",
      "icloud": "此資料夾由 iCloud Drive 同步。專案在同步資料夾中運作不佳：同步可能損壞其資料。",
      "noLinks": "此磁碟無法儲存專案套件所需的連結，因此取得套件很可能失敗。",
      "onedrive": "此資料夾由 OneDrive 同步。專案在同步資料夾中運作不佳：同步可能損壞其資料。"
    },
    "where": "儲存位置"
  },
  "packages": {
    "again": "重試",
    "body": "建置此專案所需的內容尚未在這台電腦上。Adminium 可以現在下載，然後開啟專案。網路較慢時需要幾分鐘。",
    "cancel": "暫不",
    "failed": "無法取得套件。",
    "get": "取得並開啟",
    "title": "取得此專案的套件？",
    "working": "正在取得套件"
  },
  "start": {
    "choice": {
      "build": {
        "line": "描述它，Designer 就會在這台電腦上把它建置出來。",
        "title": "建置應用程式"
      },
      "connect": {
        "line": "使用在另一台電腦上執行的 Adminium。",
        "title": "連線到另一個 Adminium"
      },
      "db": {
        "line": "為你已有的資料庫製作畫面。",
        "title": "使用我自己的資料庫"
      },
      "open": {
        "line": "繼續使用已在某個資料夾中的應用程式，或別人傳給你的應用程式。",
        "title": "開啟資料夾"
      }
    },
    "heading": "你想做什麼？",
    "open": {
      "notAProject": "此資料夾不是 Adminium 專案。"
    },
    "recent": {
      "alreadyListed": "該資料夾已在清單中。",
      "building": "建置中",
      "gone": "此資料夾已被移動或刪除",
      "heading": "最近的專案",
      "locate": "尋找…",
      "locateTitle": "{name} 現在在哪裡？",
      "notThatProject": "該資料夾不是 Adminium 專案。",
      "open": "開啟 {name}",
      "openDashboard": "開啟儀表板",
      "openDashboardOf": "開啟 {name} 的儀表板",
      "openDesigner": "在 Designer 中開啟",
      "openDesignerOf": "在 Designer 中開啟 {name}",
      "opened": "開啟時間：{when}",
      "remove": "移除",
      "removed": "已從最近的專案中移除",
      "shared": "已分享"
    },
    "welcome": "歡迎使用 Adminium。"
  },
  "toast": {
    "dismiss": "關閉",
    "region": "通知"
  },
  "trust": {
    "body": "開啟它會在這台電腦上執行其中的程式碼，並擁有你對自己檔案的存取權限。只開啟你自己建立的或來自你信任的人的資料夾。",
    "cancel": "取消",
    "changed": "自你上次開啟以來，此資料夾的程式碼已變更。",
    "open": "開啟",
    "title": "要開啟此資料夾嗎？"
  },
  "found": {
    "data": "已找到此專案的資料。",
    "key": "已找到它的金鑰。",
    "noData": "此資料夾中有專案，但沒有資料。",
    "madeBoth": "Adminium 建立了新的金鑰和一個空的資料庫。",
    "madeDatabase": "Adminium 建立了一個空的資料庫。",
    "rowsLost": "應用程式自己的資料表會重新建立。舊資料中的資料列不在這裡。"
  },
  "opening": {
    "continue": "繼續",
    "close": "關閉",
    "notAProject": {
      "line": "你可以在其中的資料夾裡建立新專案。",
      "another": "選擇其他資料夾",
      "make": "在此處建立新專案"
    }
  },
  "key": {
    "heading": "此專案的資料在這裡，但缺少金鑰。",
    "body": "金鑰是專案資料夾中名為 ‹.env› 的檔案裡的一行。你的電腦會隱藏名稱以點開頭的檔案。",
    "body2": "沒有金鑰，就無法讀取此專案資料中儲存的資料庫連線和 API 金鑰。",
    "hidden": {
      "mac": "在 Finder 中按 ⌘ ⇧ . 可顯示它們。",
      "windows": "在檔案總管中，選擇 檢視 › 顯示 › 隱藏的項目。",
      "linux": "在檔案管理員中按 Ctrl H。"
    },
    "env": {
      "title": "我有 .env 檔案",
      "line": "選擇它，Adminium 會把它複製進來。",
      "pick": "選擇此專案的 .env 檔案",
      "notAKey": "該檔案中沒有金鑰。請選擇隨此專案資料一起提供的 .env 檔案。"
    },
    "fresh": {
      "title": "重新開始資料，保留我的應用程式",
      "line": "你的舊資料會移到名為 ‹{folder}› 的資料夾中。不會刪除任何內容。"
    },
    "new": {
      "title": "使用新金鑰繼續",
      "line": "資料會保留。其中儲存的連線和金鑰將失效，需要重新輸入。"
    },
    "failed": "無法完成該操作。"
  },
  "accounts": {
    "heading": "此專案附帶了帳戶",
    "people": "{count, plural, other {# 個人}}",
    "peopleLabel": "人員",
    "apiKeys": "{count, plural, other {# 個 API 金鑰}}",
    "apiKeysLabel": "API 金鑰",
    "publicKeys": "{count, plural, other {# 個對公眾開放的金鑰}}",
    "publicKeysLabel": "對公眾開放",
    "body": "你將在這台電腦上以其擁有者身分工作。在網路上分享它之前，你需要設定新的擁有者密碼，舊的工作階段和 API 金鑰將失效。",
    "show": "顯示",
    "hide": "隱藏",
    "more": "另有 {count} 個"
  },
  "notice": {
    "manager": {
      "title": "此專案使用 {manager}。",
      "line": "Adminium 改用 npm 安裝。你的 {manager} 檔案保持原樣。"
    },
    "older": {
      "title": "此專案由較舊的 Adminium（‹{was}›）建立。",
      "line": "將它更新到 ‹{here}›，使一切保持一致。這會變更專案中的一行，並重新下載它的建置模組。",
      "update": "更新此專案",
      "notNow": "暫時不要",
      "working": "正在更新此專案…",
      "failed": "無法更新此專案。它仍可依原樣開啟。"
    },
    "newer": {
      "title": "此專案需要較新版本的 Adminium。",
      "line": "它上次是用 Adminium ‹{last}› 開啟的。這台電腦上是 ‹{here}›。",
      "lineUnknown": "它上次是用較新版本的 Adminium 開啟的。這台電腦上是 ‹{here}›。",
      "update": "更新 Adminium",
      "looking": "正在尋找較新版本的 Adminium。找到後會在此處提供。",
      "cannot": "此 Adminium 副本不會自行更新。請從 adminium.dev 取得最新版本。"
    },
    "running": {
      "title": "此專案已在執行",
      "cli": "它已在終端機中開啟，連接埠為 ‹{port}›。請先在那裡關閉它。",
      "app": "它已在另一個 Adminium 視窗中開啟，連接埠為 ‹{port}›。請先在那裡關閉它。",
      "again": "重新檢查"
    }
  },
  "install": {
    "offline": "無法連線到網際網路。套件來自 registry.npmjs.org：請檢查網路連線後重試。",
    "proxy": "你的網路代理伺服器拒絕了下載。請檢查這台電腦的代理設定後重試。",
    "disk": "此磁碟已滿。請釋放一些空間後重試。",
    "registry": "套件登錄庫傳回了錯誤。請稍後重試。"
  },
  "shared": {
    "copyFailed": "無法複製該位址。",
    "best": "建議",
    "copy": "複製 {address}",
    "portChanged": "連接埠 {was} 已被占用，因此位址改為 {now}。",
    "heading": "{name} 正在分享",
    "noNetwork": "這台電腦未連上任何網路，因此其他裝置暫時無法存取它。請加入 Wi-Fi 或插上網路線：位址會顯示在這裡。",
    "open": "在另一台裝置上開啟",
    "qr": "用於掃描 {address} 的 QR 碼",
    "notEncrypted": "區域網路上的流量未加密。請只在你信任的網路上分享。",
    "awake": "專案分享期間你的電腦會保持喚醒。闔上上蓋會停止分享。",
    "dashboard": "開啟儀表板",
    "build": "返回建置",
    "designerOff": "專案分享期間 Designer 處於關閉狀態。返回建置即可變更你的應用程式。",
    "keep": "繼續分享",
    "buildAsk": "返回建置？",
    "buildAskBody": "在其他裝置上使用它的人將被中斷連線。"
  }
} as const;
