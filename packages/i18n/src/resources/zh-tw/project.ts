// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/project.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "cell": {
    "notCell": "{id} 是卡片，不是表格儲存格。",
    "unknown": "此專案沒有小工具 {id}。"
  },
  "page": {
    "failed": {
      "title": "此頁面的程式碼未能載入"
    },
    "missing": {
      "body": "它的程式碼來自專案資料夾。請重新組建專案，或重新啟動 Adminium，以載入它。",
      "title": "此頁面不在正在執行的組建中"
    }
  },
  "table": {
    "empty": "沒有記錄"
  }
} as const;
