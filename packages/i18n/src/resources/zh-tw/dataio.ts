// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/dataio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "back": "返回",
  "import": {
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
    "emptyBody": "在上方發起匯出——產出的檔案會連同狀態顯示在這裡。",
    "new": "新增匯出"
  },
  "builder": {
    "title": "新增匯出",
    "subtitle": "選擇資料表，挑選欄位，檢查檔案，然後匯出。",
    "cancel": "取消",
    "backToExports": "返回資料匯出",
    "basedOn": "基於 {name}",
    "noAccess": {
      "title": "目前沒有可匯出的內容",
      "body": "您對此連線的任何資料表都沒有匯出權限。請管理員在{link}中授予。",
      "link": "角色與權限"
    },
    "step": "第 {n} 步，共 3 步",
    "steps": {
      "source": "來源",
      "columns": "欄位",
      "preview": "預覽"
    },
    "continue": "繼續",
    "export": "匯出",
    "back": "返回",
    "hint": {
      "chooseTable": "選擇一個資料表以繼續。",
      "fromAll": "從 {table} 的全部欄位開始。",
      "fromPage": "從繫結到 {table} 的頁面開始。",
      "noColumns": "至少新增一個欄位以繼續。",
      "dupes": "有兩個欄位使用相同的標題。請重新命名其中一個以繼續。",
      "order": "將依此順序寫入 {n} 個欄位。",
      "readSample": "匯出前請先查看樣本。",
      "downloads": "檔案準備好後可在資料匯出中下載。"
    },
    "source": {
      "title": "哪個資料表？",
      "search": "搜尋資料表…",
      "meta": "{rows} 列 · {cols} 欄",
      "metaNoRows": "{cols} 欄",
      "usedBy": "被 {n, plural, other {# 個頁面}}使用",
      "locked": "無匯出權限",
      "lockedToast": "您沒有 {table} 的匯出權限"
    },
    "startFrom": {
      "title": "起點",
      "body": "選擇欄位清單從哪裡開始。下一步可以更改所有內容。",
      "all": "{table} 的全部欄位",
      "page": "某個頁面的欄位 — {page}",
      "pageMeta": "{page} · {n} 欄 · {linked} 個連結 · {totals, plural, other {# 個合計}}",
      "none": "沒有頁面繫結到此資料表"
    },
    "columns": {
      "title": "檔案中包含什麼。",
      "add": "新增欄位",
      "inFile": "您的檔案中",
      "summary": "{n} 欄 · {linked} 個連結 · {totals, plural, other {# 個合計}}",
      "reset": "重設為資料表的欄位",
      "removeAll": "全部移除",
      "empty": {
        "title": "還沒有欄位",
        "body": "從面板新增欄位，或重設為資料表本身的欄位。"
      },
      "dragTitle": "拖曳以重新排序，或使用方向鍵",
      "reorder": "重新排序 {header}",
      "headerLabel": "檔案中的標題",
      "masked": "除非您擁有顯示權限，否則匯出為 •••••",
      "dupe": "另一個欄位使用了此標題",
      "removeTitle": "從檔案中移除",
      "remove": "移除 {header}"
    },
    "browser": {
      "search": "搜尋欄位…",
      "broken": "該連結已無法解析——請重新開始。",
      "brokenBack": "返回全部資料表",
      "suggested": "建議",
      "fromTable": "來自 {table}",
      "fromTheTable": "來自資料表",
      "readOnly": "唯讀欄位",
      "noMatch": "沒有欄位符合該搜尋。",
      "allIn": "此資料表的所有欄位都已在您的檔案中。",
      "linked": "來自連結的資料表",
      "budget": "{used} / {max}",
      "inbound": "連結到此表的資料表",
      "via": "經由 {column}",
      "count": "計數",
      "aggregate": "彙總",
      "add": "新增",
      "singleNote": "最小值和最大值只取一個欄位。",
      "limit": "已達上限——移除一個才能再新增",
      "fourMax": "最多四個欄位",
      "pickNumeric": "請先選擇一個數值欄位",
      "already": "{header} 已在您的檔案中",
      "added": "已新增 {header}",
      "calculated": "計算欄位",
      "hop": "新增一個欄位，或繼續沿連結向外查找。",
      "hopLimit": "最多三層連結。在此新增欄位，或返回上一層。",
      "addName": "新增 {name}",
      "noRead": "無讀取權限"
    },
    "calc": {
      "arith": "兩個欄位相加或相減",
      "first": "第一個欄位",
      "op": "運算子",
      "second": "第二個欄位",
      "pct": "某個欄位的百分比",
      "pctLabel": "百分比",
      "pctOf": "% 的",
      "column": "欄位",
      "rule": "帶門檻的規則",
      "if": "如果",
      "isOver": "超過",
      "then": "則",
      "else": "否則",
      "threshold": "門檻",
      "whenOver": "超過時的值",
      "otherwise": "否則的值",
      "needTwo": "請先新增兩個數值欄位",
      "needOne": "請先新增一個數值欄位"
    },
    "gen": {
      "count": "{table} 計數",
      "countSrc": "經由 {column} 統計 {table}",
      "foldSrc": "{table}.{cols} 的{fn}",
      "linkedSrc": "{table}.{column} 經由 {path}",
      "arithHeader": "{a} {op} {b}",
      "pctHeader": "{a} 的 {pct}%",
      "ruleHeader": "{then} 或 {else}",
      "ruleSrc": "如果 {a} 超過 {threshold} 則 {then}，否則 {else}",
      "sumOf": "合計",
      "average": "平均",
      "min": "最小",
      "max": "最大"
    },
    "badge": {
      "key": "鍵",
      "linked": "連結",
      "count": "計數",
      "sum": "合計",
      "avg": "平均",
      "min": "最小",
      "max": "最大",
      "calculated": "計算",
      "masked": "已隱藏"
    },
    "fold": {
      "sum": "合計",
      "avg": "平均",
      "min": "最小",
      "max": "最大"
    },
    "preview": {
      "title": "檢查檔案，然後匯出。",
      "fileName": "檔案名稱",
      "format": "格式",
      "csv": "CSV",
      "jsonl": "JSON Lines",
      "rows": "列",
      "allRows": "全部列 · {n}",
      "allRowsUnknown": "全部列",
      "viewRows": "已儲存檢視的列",
      "savedView": "已儲存的檢視",
      "viewLabel": "{name} · {filters} 個篩選 · {rows} 列",
      "viewLabelNoRows": "{name} · {filters} 個篩選",
      "headerRow": "標題列",
      "tabTable": "表格",
      "tabRaw": "原始檔案",
      "sample": "{n} 列樣本 · 更新於{when}",
      "justNow": "剛剛",
      "minutesAgo": "{n, plural, other {# 分鐘前}}",
      "refresh": "重新整理",
      "failed": "無法讀取樣本。",
      "failedTimeout": "連線回應太慢。匯出本身尚未執行。",
      "retry": "重試",
      "headerOnly": "檔案將只包含標題列。"
    },
    "summary": {
      "title": "檔案",
      "columns": "欄數",
      "rows": "列數",
      "size": "預計大小",
      "retention": "保留期",
      "kept": "保留 30 天",
      "fileName": "檔案名稱"
    },
    "warn": {
      "title": "需要了解",
      "masked": "{n, plural, other {# 個欄位}}將以隱藏方式匯出",
      "search": "此檢視帶有搜尋詞，匯出無法包含它",
      "noRows": "此資料表目前沒有任何列"
    },
    "started": {
      "preparing": "正在準備 {file} · {rows} 列",
      "ready": "已就緒 · {rows} 列",
      "noteBusy": "它會出現在資料匯出中，準備好後可在那裡下載。",
      "noteReady": "已就緒。它也在資料匯出中，您可以稍後再回來。",
      "download": "下載 {format}",
      "busy": "正在準備檔案…",
      "another": "再匯出一個",
      "failed": "匯出失敗。"
    },
    "toast": {
      "started": "匯出已開始"
    }
  }
} as const;
