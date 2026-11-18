// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/xChat.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "asked": "您已请求由人工回复。",
  "automatic": "自动回答",
  "automaticIn": "自动回答 · {language}",
  "away": {
    "again": "届时请再联系我们。",
    "later": "请稍后再联系我们。",
    "leave": "请留下您的问题和邮箱，我们会通过邮件回复。",
    "now": "我们暂时不在。",
    "opens": "{day, select, today {今天 {time}} tomorrow {明天 {time}} date {{date} {time}} other {{weekday} {time}}}",
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
} as const;
