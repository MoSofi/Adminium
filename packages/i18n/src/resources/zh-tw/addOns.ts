// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/addOns.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "notInstalled": {
    "title": "尚未安裝此 Add-on",
    "body": "您開啟的頁面屬於某個 Add-on，但該 Add-on 未安裝於此伺服器，或已被關閉。管理員可以在 Studio 中安裝它。"
  },
  "unknown": {
    "title": "頁面不存在",
    "body": "此 Add-on 已安裝，但在該位址下沒有頁面。"
  },
  "retry": "重試",
  "noBundle": {
    "title": "無法載入此頁面",
    "body": "該 Add-on 宣告了此頁面，卻沒有附帶它指向的檔案。重新安裝或升級到較新的版本即可解決。"
  },
  "failed": {
    "title": "無法載入此頁面",
    "body": "無法取得該 Add-on 的程式碼，或其內容與安裝時記錄的指紋不符。其中的程式碼未被執行。"
  },
  "refused": {
    "body": "頁面程式碼已載入，但伺服器拒絕了它的一個請求：{reason}"
  },
  "crashed": {
    "body": "頁面程式碼已載入，但因發生錯誤而停止：{reason}"
  },
  "listFailed": {
    "body": "無法讀取已安裝的 Add-on 清單，因此無法確定此頁面應載入哪個檔案。"
  },
  "tooOld": {
    "title": "此頁面需要較新版本的 Adminium",
    "body": "此附加元件的頁面是為比目前更新的 Adminium 版本所建置。更新 Adminium 後即可開啟；頁面中的任何內容都未執行。"
  },
  "accounts": {
    "notice": {
      "connectedTitle": "{person} 連接了一個帳戶",
      "connectedBody": "{person} 現已以 {account} 連接到 {provider}。",
      "refusedTitle": "{provider} 拒絕了此伺服器的應用程式",
      "refusedBody": "請檢查為 {provider} 儲存的用戶端 ID 和密鑰。無需任何人重新連接：應用程式被接受後，連線會自動恢復。",
      "clashTitle": "{person} 的行事曆有衝突",
      "clashBody": "{person} 行事曆中的忙碌時間現在與一筆預約重疊。開啟該預約以改期或保留。",
      "staleTitle": "已移除 {person} 的忙碌時間",
      "staleBody": "{person} 已 7 天未重新連線，因此其行事曆不再佔用時間。",
      "removedTitle": "{person} 刪除了行事曆 {calendar}",
      "removedBody": "該行事曆在一週內被刪除兩次，因此預約不再寫入 {person} 的行事曆，直到其重新開啟。",
      "remadeTitle": "已重新建立行事曆 {calendar}",
      "remadeBody": "該行事曆已從 {person} 的帳戶中刪除，因此已連同即將到來的預約重新建立。",
      "silentTitle": "{person} 行事曆的變更延遲到達",
      "silentBody": "即時更新已停止，變更將隨定期檢查到達，大約在 12 分鐘內。",
      "secretEndingTitle": "{provider} 用戶端密碼將於 {date} 到期",
      "secretEndingBody": "請在此日期前建立新的用戶端密碼並貼到設定指南中，否則所有 {provider} 連線都會停止。不需要任何人重新連結。",
      "unreadableTitle": "{person} 的一個日曆已無法讀取",
      "unreadableBody": "該日曆已被刪除或不再共用，因此已從計為忙碌的日曆中移除，不再佔用 {person} 的時段。其他日曆仍會佔用。",
      "namesLeftTitle": "{person} 的行事曆可能仍顯示客戶姓名",
      "namesLeftBody": "在此連線結束前，未能從 {calendar} 行事曆中移除部分活動。請 {person} 在該行事曆中刪除它們。"
    }
  }
} as const;
