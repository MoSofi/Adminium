// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/automations.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "rules": {
    "title": "自動化規則",
    "subtitle": "在事情發生時自動觸發工作流程。",
    "new": "新增規則",
    "empty": {
      "title": "還沒有規則",
      "body": "建立一條規則，讓步驟在事情發生時自動執行。"
    },
    "none": "選擇一條規則以檢視其流程"
  },
  "kpi": {
    "activeRules": "啟用中的規則",
    "runsToday": "今日執行",
    "successRate": "成功率",
    "timeSaved": "節省時間（月）"
  },
  "filter": {
    "all": "全部",
    "active": "啟用",
    "paused": "已暫停"
  },
  "card": {
    "runs": "次執行",
    "success": "成功率",
    "never": "從未執行",
    "toggle": "切換"
  },
  "status": {
    "active": "啟用",
    "paused": "已暫停"
  },
  "flow": {
    "steps": "{count, plural, other {# 個步驟}}",
    "saves": "每次執行節省 {time}",
    "runs30d": "30 天執行",
    "success": "成功率",
    "test": "測試",
    "running": "執行中",
    "noSample": "沒有可用於測試的記錄 — 請先新增一筆",
    "menu": "規則操作"
  },
  "menu": {
    "rename": "重新命名",
    "duplicate": "複製",
    "delete": "刪除"
  },
  "delete": {
    "title": "刪除 {name}？",
    "body": "執行紀錄會一併刪除，且無法復原。",
    "confirm": "刪除",
    "cancel": "取消"
  },
  "save": {
    "unsaved": "有未儲存的變更",
    "saving": "儲存中…",
    "saved": "已全部儲存",
    "action": "儲存"
  },
  "guard": {
    "title": "不儲存就離開？",
    "body": "你對這條規則的變更將會遺失。",
    "stay": "繼續編輯",
    "leave": "離開"
  },
  "toast": {
    "saved": "規則已儲存",
    "enabled": "{name} 已啟用",
    "paused": "{name} 已暫停",
    "incomplete": "先完成「{step}」，再啟用這條規則",
    "duplicated": "已複製 {name}",
    "deleted": "已刪除 {name}",
    "failed": "未能儲存 — {reason}"
  },
  "canvas": {
    "insert": "在此插入步驟",
    "addStep": "新增步驟",
    "remove": "移除步驟"
  },
  "kind": {
    "trigger": "觸發器",
    "condition": "篩選",
    "branch": "條件分支",
    "wait": "延遲",
    "action": "動作"
  },
  "branch": {
    "ifMatches": "符合時",
    "otherwise": "否則"
  },
  "picker": {
    "title": "新增步驟",
    "before": "在 {title} 之前",
    "end": "在流程結尾",
    "inBranch": "在分支 {label} 內",
    "actions": "動作",
    "logic": "邏輯",
    "close": "關閉"
  },
  "pick": {
    "email": "傳送郵件",
    "emailDesc": "使用已儲存的範本",
    "notification": "傳送通知",
    "notificationDesc": "通知此工作區的成員",
    "create": "建立記錄",
    "createDesc": "在表格中新增一列",
    "update": "更新欄位",
    "updateDesc": "寫回到記錄",
    "webhook": "呼叫 Webhook",
    "webhookDesc": "把資料送到任何地方",
    "slack": "Slack 訊息",
    "slackDesc": "發布到頻道",
    "branch": "條件分支",
    "branchDesc": "分成兩條路徑",
    "filter": "僅在符合時繼續",
    "filterDesc": "不符合時停止",
    "wait": "等待 / 延遲",
    "waitDesc": "在下一步之前暫停",
    "stop": "停止流程",
    "stopDesc": "在此結束這次執行"
  },
  "node": {
    "email": {
      "sub": "範本 · 請選擇",
      "summary": "範本 · {template} → {to}"
    },
    "notification": {
      "sub": "選擇通知對象",
      "summary": "傳送給 · {who}"
    },
    "create": {
      "sub": "表格 · 請選擇",
      "summary": "{table} · {count} 個值"
    },
    "update": {
      "sub": "設定一個值",
      "summary": "{pairs}"
    },
    "webhook": {
      "sub": "POST · JSON 內容",
      "summary": "{method} {host}"
    },
    "slack": {
      "sub": "頻道 · 新增 Webhook URL",
      "summary": "Slack · {host}"
    },
    "wait": {
      "title": "等待 / 延遲",
      "sub": "暫停 {duration}"
    },
    "stop": {
      "title": "停止流程",
      "sub": "結束這次執行"
    },
    "condition": {
      "empty": "設定一個條件"
    },
    "trigger": {
      "record": "當 {table} 中有記錄被{event}時",
      "interval": "每 {minutes} 分鐘",
      "daily": "每天 {time}",
      "weekly": "每週{day} {time}",
      "monthly": "每月 {day} 日 {time}",
      "sub": "觸發器 · {event}"
    }
  },
  "event": {
    "created": "建立",
    "updated": "更新",
    "deleted": "刪除"
  },
  "insp": {
    "stepName": "步驟名稱",
    "description": "說明",
    "condition": "條件",
    "lookAt": "檢視",
    "thisRecord": "這筆記錄",
    "related": "關聯記錄",
    "field": "欄位",
    "value": "值",
    "countOf": "統計",
    "where": "其中",
    "isThisRecords": "等於這筆記錄的",
    "andWhere": "而且",
    "branchLabels": "分支名稱",
    "onError": "發生錯誤時繼續",
    "onErrorBody": "即使此步驟失敗也繼續執行後續步驟",
    "moveUp": "上移",
    "moveDown": "下移",
    "duplicate": "複製",
    "delete": "刪除",
    "close": "關閉",
    "settings": "設定"
  },
  "op": {
    "is": "等於",
    "isNot": "不等於",
    "contains": "包含",
    "gt": "大於",
    "lt": "小於",
    "isEmpty": "為空",
    "notEmpty": "不為空",
    "withinNext": "在未來",
    "withinLast": "在過去",
    "moreThanAgo": "早於……之前",
    "moreThanAhead": "晚於……之後"
  },
  "unit": {
    "minutes": "{count, plural, other {分鐘}}",
    "hours": "{count, plural, other {小時}}",
    "days": "{count, plural, other {天}}"
  },
  "trig": {
    "title": "觸發器",
    "kind": "何時",
    "record": "記錄被{event}",
    "schedule": "依排程",
    "table": "表格",
    "changed": "僅當此欄位變動時",
    "anyColumn": "任一欄位",
    "watch": {
      "on": "同時監看在 Adminium 之外寫入的列 · 每分鐘 · 透過 {column}",
      "off": "監看已關閉：此表格沒有「{shape}」形式的欄位，也沒有遞增主鍵，因此只有透過 Adminium 的寫入才會觸發這條規則",
      "deleted": "已刪除的列無法監看；只有透過 Adminium 的刪除才會觸發這條規則",
      "fromNow": "從現在起的列"
    },
    "when": "僅當",
    "every": "每",
    "at": "在",
    "timezone": "時區",
    "forEach": "對以下表格的每筆記錄",
    "forEachWhere": "其中",
    "noTable": "不選表格 — 每個週期執行一次",
    "once": "每筆記錄僅一次",
    "onceBody": "已符合過的記錄不會再次執行",
    "timeSaved": "每次執行節省的時間",
    "timeSavedBody": "一個人本來會花的分鐘數 — 在規則上顯示為「節省」",
    "addCondition": "新增條件",
    "connection": "連線"
  },
  "sched": {
    "interval": "間隔",
    "daily": "每天",
    "weekly": "每週",
    "monthly": "每月"
  },
  "email": {
    "template": "範本",
    "to": "收件者",
    "toField": "這筆記錄的電子郵件",
    "toFixed": "地址",
    "column": "欄位",
    "addresses": "新增地址…"
  },
  "notif": {
    "to": "傳送給",
    "roles": "擁有某角色的所有人",
    "users": "指定的人",
    "title": "標題",
    "body": "訊息"
  },
  "rec": {
    "table": "表格",
    "values": "值",
    "addValue": "新增一個值",
    "column": "欄位",
    "value": "值",
    "now": "現在",
    "remove": "移除此值",
    "tokenHint": "使用 {token} 從記錄中取值"
  },
  "hook": {
    "url": "URL",
    "method": "方法",
    "body": "內容",
    "bodyJson": "JSON（事件、規則、記錄）",
    "bodyText": "自訂文字",
    "header": "標頭",
    "headerName": "名稱",
    "headerValue": "值",
    "slackUrl": "Slack Webhook URL",
    "slackText": "訊息"
  },
  "wait": {
    "for": "等待",
    "max": "最多 30 天",
    "amount": "數量",
    "unit": "單位"
  },
  "modal": {
    "title": "新增規則",
    "subtitle": "在事情發生時自動觸發工作流程。",
    "name": "規則名稱",
    "namePlaceholder": "例如：歡迎新註冊使用者",
    "when": "當（觸發器）",
    "then": "則（動作）",
    "enable": "立即啟用",
    "enableBody": "規則建立後立即開始執行",
    "cancel": "取消",
    "create": "建立規則",
    "doneTitle": "規則已建立",
    "doneBody": "規則已啟用，下次被觸發時就會執行。",
    "savedTitle": "規則已儲存",
    "savedBody": "完成它的步驟後再啟用。",
    "done": "完成",
    "trigger": {
      "recordCreated": "建立了一筆記錄",
      "recordUpdated": "更新了一筆記錄",
      "recordDeleted": "刪除了一筆記錄",
      "schedule": "依排程"
    },
    "connection": "{connection} · {table}",
    "tablePlaceholder": "搜尋表格…",
    "tableEmpty": "沒有相符的表格"
  },
  "logs": {
    "title": "工作流程紀錄",
    "subtitle": "你的自動化的執行紀錄。",
    "refresh": "重新整理",
    "kpi": {
      "runsToday": "今日執行",
      "success": "成功率",
      "failed": "失敗",
      "avgDuration": "平均時長"
    },
    "filter": {
      "all": "全部",
      "success": "成功",
      "failed": "失敗",
      "running": "執行中"
    },
    "status": {
      "success": "成功",
      "failed": "失敗",
      "running": "執行中",
      "pending": "{when}開始",
      "waiting": "等待中 · {when}繼續",
      "skipped": "已略過",
      "cancelled": "已取消"
    },
    "trigger": "觸發器",
    "duration": "時長",
    "started": "開始於",
    "trace": "執行軌跡",
    "loadOlder": "載入更早的",
    "empty": {
      "title": "還沒有執行紀錄",
      "filtered": "最近 7 天沒有「{status}」的執行"
    },
    "select": "選擇一次執行以檢視其軌跡",
    "justNow": "剛剛"
  },
  "trace": {
    "trigger": "記錄 = {label} · {summary}",
    "scheduleTick": "觸發 · {stamp}",
    "evaluated": "求值 → {result}",
    "stopped": "求值 → false · 已停止",
    "branch": "走了「{label}」",
    "wait": "{stamp}繼續",
    "wouldWait": "將等待 {duration}",
    "email": {
      "ok": "{smtp} · 已投遞至 {to}",
      "fail": "錯誤 · {reason}",
      "would": "將把「{subject}」傳送至 {to}",
      "noSmtp": "未設定 SMTP — 設定 → 郵件",
      "noRecipient": "沒有收件者：{column} 為空"
    },
    "notif": {
      "ok": "已通知 {count, plural, other {# 人}}"
    },
    "create": {
      "ok": "已建立 {label}"
    },
    "update": {
      "ok": "已設定 {pairs}"
    },
    "write": {
      "would": "將設定 {pairs}"
    },
    "hook": {
      "ok": "{method} {path} → {status} · {ms} 毫秒",
      "fail": "{method} {path} → {status}",
      "would": "將執行 {method} {url}"
    },
    "stop": "在此停止",
    "undone": "在執行前被復原",
    "gone": "記錄已不存在",
    "ruleOff": "等待期間規則被關閉",
    "skipped": "—",
    "document": {
      "ok": "已繪製單據 · {number}",
      "skipped": "未繪製單據 · {reason}",
      "would": "將繪製 {kind} · {name}",
      "off": "對應已關閉 · {name}"
    }
  },
  "dur": {
    "ms": "{ms} 毫秒",
    "s": "{s} 秒",
    "none": "—"
  },
  "saved": {
    "h": "{h} 小時",
    "m": "{m} 分鐘"
  }
} as const;
