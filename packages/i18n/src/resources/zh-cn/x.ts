// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/x.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "language": {
    "menu": "语言",
    "button": "语言：{name}"
  },
  "footer": {
    "questions": "有疑问？请写信至",
    "privacyNotice": "隐私声明"
  },
  "required": "必填",
  "optional": "选填",
  "send": "发送",
  "sendAnswers": "提交回答",
  "sending": "正在发送…",
  "preview": "此处不会发送任何内容。",
  "keeps": "{business} 会保留您发送的内容，以便回复您。",
  "summary": "请检查下方标出的回答。",
  "proofFailed": "未能确认您是真人。请重试。",
  "honeypot": "此栏请留空",
  "anonymous": "您的回答不会与您的姓名关联。",
  "surveyAbout": "关于{record}。",
  "error": {
    "required": "请回答此问题。",
    "name": "请输入您的姓名",
    "tooLong": "{max, plural, other {最多 # 个字符。}}",
    "email": "请输入邮箱地址，例如 name@company.com",
    "phone": "请输入 6 到 15 位数字的电话号码。",
    "choice": "请选择其中一项。",
    "tooFew": "请至少选择 {min} 项。",
    "tooMany": "请最多选择 {max} 项。",
    "date": "请输入日期。",
    "fromToday": "请选择今天或之后的日期",
    "fromTomorrow": "请选择明天或之后的日期",
    "number": "请输入数字。",
    "whole": "请输入整数。",
    "tooSmall": "请输入 {min} 或更大的数。",
    "tooLarge": "请输入 {max} 或更小的数。",
    "score": "请选择 0 到 10 的分数。",
    "stars": "请选择 1 到 5 颗星。",
    "file": "无法接收此文件。",
    "tick": "请勾选此框，或留空。",
    "answer": "部分回答未被接收。请检查后重新发送。"
  },
  "file": {
    "chooseOne": "选择文件",
    "chooseMany": "选择文件",
    "hint": "{kinds}，最大 {mb} MB",
    "kind": {
      "pdf": "PDF",
      "jpg": "JPG",
      "png": "PNG",
      "text": "纯文本"
    }
  },
  "files": {
    "remove": "移除 {file}",
    "added": "已添加 {file}。",
    "removed": "已移除 {file}。",
    "refused": "未添加 {file}。",
    "tooBig": "此文件大小为 {size}。上限为 {mb} MB。",
    "kind": "不接受此类文件。请使用 {kinds}。",
    "quota": "目前无法接收文件。请稍后再试。",
    "cap": "今天从此处发送的文件过多。请明天再试。",
    "count": "最多可添加 {max, plural, other {# 个文件}}。",
    "failed": "无法发送此文件。请重试。"
  },
  "score": {
    "low": "不太可能",
    "high": "非常可能",
    "ends": "0 表示不太可能，10 表示非常可能。"
  },
  "stars": {
    "of": "{n} / 5",
    "star": "{n, plural, other {# 星}}"
  },
  "ending": {
    "thanksName": "谢谢，{name}。",
    "thanks": "谢谢。",
    "confirmNewsletter": "新闻通讯还差一步：请查看您的邮件并点击“确认”。",
    "confirmSurveys": "调查还差一步：请查看您的邮件并点击“确认”。",
    "surveyThanksName": "谢谢您，{name}。",
    "surveyHelps": "您的回答对我们很有帮助。",
    "already": "您已回答过此调查。谢谢。",
    "dead": "此链接无效。",
    "write": "请写信至 {email}。",
    "closed": "此表单已关闭。",
    "tooMany": "此处发送次数过多。请{when}再试，或写信至 {email}。",
    "tooManyPlain": "此处发送次数过多。请{when}再试。",
    "unavailable": "此页面不可用。",
    "noScript": "此表单需要 JavaScript。",
    "noScriptWrite": "您也可以写信至 {email}。",
    "offline": "无法打开此页面。",
    "offlineBody": "请检查网络连接后重试。",
    "retry": "重试",
    "continue": "继续"
  },
  "chat": {
    "noScript": "此对话需要 JavaScript。",
    "asked": "您已请求由人工回复。",
    "automatic": "自动回答",
    "automaticIn": "自动回答 · {language}",
    "away": {
      "again": "届时请再联系我们。",
      "later": "请稍后再联系我们。",
      "leave": "请留下您的问题和邮箱，我们会通过邮件回复。",
      "now": "我们暂时不在。",
      "sent": "{day, select, today {谢谢。我们会在 {time} 之后回复到 {email}。} tomorrow {谢谢。我们会在 {time} 之后回复到 {email}。} date {谢谢。我们会在 {date} {time} 之后回复到 {email}。} other {谢谢。我们会在{weekday} {time} 之后回复到 {email}。}}",
      "sentNone": "谢谢。我们会回复到 {email}。",
      "until": "{day, select, today {我们今天 {time} 回来。} tomorrow {我们明天 {time} 回来。} date {我们 {date} {time} 回来。} other {我们{weekday} {time} 回来。}}"
    },
    "card": {
      "badEmail": "请输入邮箱地址，例如 name@company.example",
      "badName": "请填写姓名，不要包含网址。",
      "change": "修改",
      "email": "您的邮箱",
      "emailOptional": "您的邮箱（可选）",
      "helper": "这样即使您关闭此页面，我们也能回复您。",
      "name": "您的姓名（可选）",
      "needEmail": "请输入您的邮箱，以便我们回复。",
      "needOne": "请先填写姓名或邮箱。",
      "needQuestion": "请先写下您的问题。",
      "question": "您的问题",
      "save": "保存",
      "send": "发送"
    },
    "close": "关闭对话",
    "closed": "此对话已关闭 · {time}",
    "closedBy": "{name} 关闭了此对话 · {time}",
    "done": {
      "leave": "如果您离开，我们会回复到 {email}。",
      "named": "谢谢，{name}。",
      "stay": "请保持此页面打开以查看回复。",
      "thanks": "谢谢。"
    },
    "first": {
      "automatic": "这里的部分回答是自动的，选自 {business} 撰写的回答。人工可随时接手。您的消息会由 AI 服务（{service}）读取。",
      "drafts": "这里由人工回答。工作人员可能会使用 AI 服务（{service}）协助撰写回复。",
      "person": "这里由人工回答。"
    },
    "from": "{business} 的 {name}",
    "hand": {
      "info": "将由人工在这里回答。请保持此页面打开以查看回复。",
      "text": "将由人工在这里回答。"
    },
    "hide": "隐藏对话",
    "hours": {
      "openUntil": "今天营业至 {time}",
      "opens": "{day, select, today {今天 {time} 开始营业} tomorrow {明天 {time} 开始营业} date {{date} {time} 开始营业} other {{weekday} {time} 开始营业}}"
    },
    "hoursEnded": {
      "next": "{day, select, today {{business} 的营业时间已于 {closing} 结束。仍可能有人回复；否则我们会在今天 {time} 之后回复。} tomorrow {{business} 的营业时间已于 {closing} 结束。仍可能有人回复；否则我们会在明天 {time} 之后回复。} date {{business} 的营业时间已于 {closing} 结束。仍可能有人回复；否则我们会在 {date} {time} 之后回复。} other {{business} 的营业时间已于 {closing} 结束。仍可能有人回复；否则我们会在{weekday} {time} 之后回复。}}",
      "none": "{business} 的营业时间已于 {closing} 结束。仍可能有人回复。"
    },
    "language": "语言",
    "languageOf": "语言：{name}",
    "log": "消息",
    "lost": "找不到您之前的对话。请在下方开始新的对话。",
    "newChat": "开始新对话",
    "newMessages": "{count, plural, other {来自 {business} 的 {n} 条新消息}}",
    "newTab": "（在新标签页中打开）",
    "offline": "无法连接 {business}。正在重试…",
    "privacy": "隐私声明。",
    "rate": {
      "chat": "您在此对话中发送了太多消息。",
      "minute": "您发送了太多消息。请等待一分钟后再试。",
      "wait": "您发送了太多消息。请等待 {minutes, plural, other {{n} 分钟}}后再试。"
    },
    "reopened": "此对话已重新打开 · {time}",
    "reopenedBy": "{name} 重新打开了此对话 · {time}",
    "resumed": "您从 {time} 开始的对话",
    "send": "发送",
    "status": {
      "checking": "正在确认您是真人…",
      "failed": "未能确认您是真人。",
      "notSent": "未发送。",
      "queued": "等待发送",
      "retry": "重试"
    },
    "talk": "与人工交谈",
    "waiting": "仍在等待 {business} 的工作人员。",
    "waitingMail": "仍在等待 {business} 的工作人员。您可以留下邮箱后关闭此页面。",
    "with": "与 {business} 对话",
    "withNew": "与 {business} 对话，{count, plural, other {{n} 条新消息}}",
    "write": "写一条消息…"
  }
} as const;
