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
      "needsPackages": "這台電腦上還沒有此專案的套件。",
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
  }
} as const;
