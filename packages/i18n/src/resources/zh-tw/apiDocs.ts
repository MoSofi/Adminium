// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/apiDocs.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "badge": {
    "anon": "公開唯讀",
    "authenticated": "需要登入",
    "public": "公開",
    "service": "服務角色"
  },
  "code": {
    "copied": "已複製",
    "copy": "複製",
    "curl": "cURL",
    "js": "JavaScript",
    "languages": "程式碼範例語言",
    "python": "Python"
  },
  "copyBase": "複製基礎 URL",
  "crumb": "API",
  "empty": {
    "body": "此部署尚未發布任何端點。",
    "title": "尚無端點"
  },
  "ep": {
    "batch": {
      "desc": "批次插入或 upsert，最多 500 列。",
      "title": "批次建立 {ref}"
    },
    "create": {
      "desc": "插入一列，並傳回建立的記錄。",
      "title": "{article, select, other {}}建立 {singular}"
    },
    "delete": {
      "desc": "移除具有此主鍵的列。",
      "title": "{article, select, other {}}刪除 {singular}"
    },
    "list": {
      "desc": "傳回經過篩選、排序及分頁的一組列。",
      "title": "列出 {ref}"
    },
    "one": {
      "desc": "依主鍵取得單一列。",
      "title": "{article, select, other {}}取得 {singular}"
    },
    "replace": {
      "desc": "依主鍵取代整列。",
      "title": "{article, select, other {}}取代 {singular}"
    },
    "rowWord": "記錄",
    "update": {
      "desc": "修改具有此主鍵之列中的欄位。",
      "title": "{article, select, other {}}更新 {singular}"
    }
  },
  "meta": "{endpoints, plural, other {# 個端點}} · 筆數上限 {limit}，排序 {order}",
  "pg": {
    "auth": "授權",
    "authHelper": "瀏覽器金鑰。它只會保留在此分頁中，重新載入後即會消失。",
    "authPlaceholder": "貼上金鑰",
    "body": "請求本文",
    "needKey": "請先貼上金鑰",
    "send": "傳送請求",
    "sending": "傳送中…",
    "title": "測試主控台"
  },
  "rail": {
    "empty": "沒有符合此篩選條件的項目。",
    "filter": "篩選資料表…",
    "heading": "資源",
    "reference": "API 參考"
  },
  "res": {
    "idle": "傳送請求即可查看回應。",
    "ms": "{ms} ms",
    "network": "請求未能送達伺服器。",
    "noBody": "204 No Content — 已刪除該列",
    "title": "回應"
  },
  "schema": {
    "body": "本文結構",
    "response": "回應欄位"
  },
  "status": {
    "live": "API 運作中",
    "off": "已停用"
  },
  "tag": {
    "fk": "FK",
    "pk": "PK",
    "unique": "UNIQUE"
  }
} as const;
