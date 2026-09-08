// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/automations.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "rules": {
    "title": "自动化规则",
    "subtitle": "在事情发生时自动触发工作流。",
    "new": "新建规则",
    "empty": {
      "title": "还没有规则",
      "body": "创建一条规则，让步骤在事情发生时自动执行。"
    },
    "none": "选择一条规则以查看其流程"
  },
  "kpi": {
    "activeRules": "启用中的规则",
    "runsToday": "今日运行",
    "successRate": "成功率",
    "timeSaved": "节省时间（月）"
  },
  "filter": {
    "all": "全部",
    "active": "启用",
    "paused": "已暂停"
  },
  "card": {
    "runs": "次运行",
    "success": "成功率",
    "never": "从未运行",
    "toggle": "切换"
  },
  "status": {
    "active": "启用",
    "paused": "已暂停"
  },
  "flow": {
    "steps": "{count, plural, other {# 个步骤}}",
    "saves": "每次运行节省 {time}",
    "runs30d": "30 天运行",
    "success": "成功率",
    "test": "测试",
    "running": "运行中",
    "noSample": "没有可用于测试的记录 — 请先添加一条",
    "menu": "规则操作"
  },
  "menu": {
    "rename": "重命名",
    "duplicate": "复制",
    "delete": "删除"
  },
  "delete": {
    "title": "删除 {name}？",
    "body": "运行历史将一并删除，且无法撤销。",
    "confirm": "删除",
    "cancel": "取消"
  },
  "save": {
    "unsaved": "有未保存的更改",
    "saving": "保存中…",
    "saved": "已全部保存",
    "action": "保存"
  },
  "guard": {
    "title": "不保存就离开？",
    "body": "你对这条规则的更改将会丢失。",
    "stay": "继续编辑",
    "leave": "离开"
  },
  "toast": {
    "saved": "规则已保存",
    "enabled": "{name} 已启用",
    "paused": "{name} 已暂停",
    "incomplete": "先完成“{step}”，再启用这条规则",
    "duplicated": "已复制 {name}",
    "deleted": "已删除 {name}",
    "failed": "未能保存 — {reason}"
  },
  "canvas": {
    "insert": "在此插入步骤",
    "addStep": "添加步骤",
    "remove": "移除步骤"
  },
  "kind": {
    "trigger": "触发器",
    "condition": "筛选",
    "branch": "条件分支",
    "wait": "延迟",
    "action": "动作"
  },
  "branch": {
    "ifMatches": "匹配时",
    "otherwise": "否则"
  },
  "picker": {
    "title": "添加步骤",
    "before": "在 {title} 之前",
    "end": "在流程末尾",
    "inBranch": "在分支 {label} 内",
    "actions": "动作",
    "logic": "逻辑",
    "close": "关闭"
  },
  "pick": {
    "email": "发送邮件",
    "emailDesc": "使用已保存的模板",
    "notification": "发送通知",
    "notificationDesc": "通知此工作区中的成员",
    "create": "创建记录",
    "createDesc": "向表中新增一行",
    "update": "更新字段",
    "updateDesc": "写回到记录",
    "webhook": "调用 Webhook",
    "webhookDesc": "把数据发送到任何地方",
    "slack": "Slack 消息",
    "slackDesc": "发布到频道",
    "branch": "条件分支",
    "branchDesc": "分成两条路径",
    "filter": "仅在满足时继续",
    "filterDesc": "不匹配时停止",
    "wait": "等待 / 延迟",
    "waitDesc": "在下一步之前暂停",
    "stop": "停止流程",
    "stopDesc": "在此结束本次运行"
  },
  "node": {
    "email": {
      "sub": "模板 · 请选择",
      "summary": "模板 · {template} → {to}"
    },
    "notification": {
      "sub": "选择通知对象",
      "summary": "发送给 · {who}"
    },
    "create": {
      "sub": "表 · 请选择",
      "summary": "{table} · {count} 个值"
    },
    "update": {
      "sub": "设置一个值",
      "summary": "{pairs}"
    },
    "webhook": {
      "sub": "POST · JSON 负载",
      "summary": "{method} {host}"
    },
    "slack": {
      "sub": "频道 · 添加 Webhook URL",
      "summary": "Slack · {host}"
    },
    "wait": {
      "title": "等待 / 延迟",
      "sub": "暂停 {duration}"
    },
    "stop": {
      "title": "停止流程",
      "sub": "结束本次运行"
    },
    "condition": {
      "empty": "设置一个条件"
    },
    "trigger": {
      "record": "当 {table} 中有记录被{event}时",
      "interval": "每 {minutes} 分钟",
      "daily": "每天 {time}",
      "weekly": "每周{day} {time}",
      "monthly": "每月 {day} 日 {time}",
      "sub": "触发器 · {event}"
    }
  },
  "event": {
    "created": "创建",
    "updated": "更新",
    "deleted": "删除"
  },
  "insp": {
    "stepName": "步骤名称",
    "description": "说明",
    "condition": "条件",
    "lookAt": "查看",
    "thisRecord": "本条记录",
    "related": "关联记录",
    "field": "字段",
    "value": "值",
    "countOf": "统计",
    "where": "其中",
    "isThisRecords": "等于本记录的",
    "andWhere": "并且",
    "branchLabels": "分支名称",
    "onError": "出错时继续",
    "onErrorBody": "即使此步骤失败也继续执行后续步骤",
    "moveUp": "上移",
    "moveDown": "下移",
    "duplicate": "复制",
    "delete": "删除",
    "close": "关闭",
    "settings": "设置"
  },
  "op": {
    "is": "等于",
    "isNot": "不等于",
    "contains": "包含",
    "gt": "大于",
    "lt": "小于",
    "isEmpty": "为空",
    "notEmpty": "不为空",
    "withinNext": "在未来",
    "withinLast": "在过去",
    "moreThanAgo": "早于……之前",
    "moreThanAhead": "晚于……之后"
  },
  "unit": {
    "minutes": "{count, plural, other {分钟}}",
    "hours": "{count, plural, other {小时}}",
    "days": "{count, plural, other {天}}"
  },
  "trig": {
    "title": "触发器",
    "kind": "何时",
    "record": "记录被{event}",
    "schedule": "按计划",
    "table": "表",
    "changed": "仅当此列发生变化时",
    "anyColumn": "任意列",
    "watch": {
      "on": "同时监视在 Adminium 之外写入的行 · 每分钟 · 通过 {column}",
      "off": "监视已关闭：此表没有“{shape}”形式的列，也没有递增主键，因此只有通过 Adminium 的写入才会触发这条规则",
      "deleted": "已删除的行无法监视；只有通过 Adminium 的删除才会触发这条规则",
      "fromNow": "从现在起的行"
    },
    "when": "仅当",
    "every": "每",
    "at": "在",
    "timezone": "时区",
    "forEach": "对以下表的每条记录",
    "forEachWhere": "其中",
    "once": "每条记录仅一次",
    "onceBody": "已匹配过的记录不会再次运行",
    "timeSaved": "每次运行节省的时间",
    "timeSavedBody": "一个人本会花费的分钟数 — 在规则上显示为“节省”",
    "addCondition": "添加条件",
    "connection": "连接"
  },
  "sched": {
    "interval": "间隔",
    "daily": "每天",
    "weekly": "每周",
    "monthly": "每月"
  },
  "email": {
    "template": "模板",
    "to": "收件人",
    "toField": "本记录的邮箱",
    "toFixed": "地址",
    "column": "列",
    "addresses": "添加地址…"
  },
  "notif": {
    "to": "发送给",
    "roles": "拥有某角色的所有人",
    "users": "指定的人",
    "title": "标题",
    "body": "消息"
  },
  "rec": {
    "table": "表",
    "values": "值",
    "addValue": "添加一个值",
    "column": "列",
    "value": "值",
    "now": "现在",
    "remove": "移除此值",
    "tokenHint": "使用 {token} 从记录中取值"
  },
  "hook": {
    "url": "URL",
    "method": "方法",
    "body": "正文",
    "bodyJson": "JSON（事件、规则、记录）",
    "bodyText": "自定义文本",
    "header": "请求头",
    "headerName": "名称",
    "headerValue": "值",
    "slackUrl": "Slack Webhook URL",
    "slackText": "消息"
  },
  "wait": {
    "for": "等待",
    "max": "最多 30 天",
    "amount": "数量",
    "unit": "单位"
  },
  "modal": {
    "title": "新建规则",
    "subtitle": "在事情发生时自动触发工作流。",
    "name": "规则名称",
    "namePlaceholder": "例如：欢迎新注册用户",
    "when": "当（触发器）",
    "then": "则（动作）",
    "enable": "立即启用",
    "enableBody": "规则创建后立即开始运行",
    "cancel": "取消",
    "create": "创建规则",
    "doneTitle": "规则已创建",
    "doneBody": "规则已启用，下次被触发时就会运行。",
    "savedTitle": "规则已保存",
    "savedBody": "完成它的步骤后再启用。",
    "done": "完成",
    "trigger": {
      "created": "{table} 中创建了一条记录",
      "updated": "{table} 中更新了一条记录",
      "deleted": "{table} 中删除了一条记录",
      "schedule": "按计划"
    },
    "connection": "{connection} · {table}"
  },
  "logs": {
    "title": "工作流日志",
    "subtitle": "你的自动化的执行历史。",
    "refresh": "刷新",
    "kpi": {
      "runsToday": "今日运行",
      "success": "成功率",
      "failed": "失败",
      "avgDuration": "平均时长"
    },
    "filter": {
      "all": "全部",
      "success": "成功",
      "failed": "失败",
      "running": "运行中"
    },
    "status": {
      "success": "成功",
      "failed": "失败",
      "running": "运行中",
      "pending": "{when}开始",
      "waiting": "等待中 · {when}继续",
      "skipped": "已跳过",
      "cancelled": "已取消"
    },
    "trigger": "触发器",
    "duration": "时长",
    "started": "开始于",
    "trace": "执行轨迹",
    "loadOlder": "加载更早的",
    "empty": {
      "title": "还没有运行记录",
      "filtered": "最近 7 天没有“{status}”的运行"
    },
    "select": "选择一次运行以查看其轨迹",
    "justNow": "刚刚"
  },
  "trace": {
    "trigger": "记录 = {label} · {summary}",
    "scheduleTick": "触发 · {stamp}",
    "evaluated": "求值 → {result}",
    "stopped": "求值 → false · 已停止",
    "branch": "走了“{label}”",
    "wait": "{stamp}继续",
    "wouldWait": "将等待 {duration}",
    "email": {
      "ok": "{smtp} · 已投递至 {to}",
      "fail": "错误 · {reason}",
      "would": "将把“{subject}”发送至 {to}",
      "noSmtp": "未配置 SMTP — 设置 → 邮件",
      "noRecipient": "没有收件人：{column} 为空"
    },
    "notif": {
      "ok": "已通知 {count, plural, other {# 人}}"
    },
    "create": {
      "ok": "已创建 {label}"
    },
    "update": {
      "ok": "已设置 {pairs}"
    },
    "write": {
      "would": "将设置 {pairs}"
    },
    "hook": {
      "ok": "{method} {path} → {status} · {ms} 毫秒",
      "fail": "{method} {path} → {status}",
      "would": "将执行 {method} {url}"
    },
    "stop": "在此停止",
    "undone": "在运行前被撤销",
    "gone": "记录已不存在",
    "ruleOff": "等待期间规则被关闭",
    "skipped": "—"
  },
  "dur": {
    "ms": "{ms} 毫秒",
    "s": "{s} 秒",
    "none": "—"
  },
  "saved": {
    "h": "{h} 小时",
    "m": "{m} 分钟"
  }
} as const;
