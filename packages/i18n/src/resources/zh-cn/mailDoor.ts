// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/mailDoor.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "language": "语言",
  "questions": "有疑问？请写信至",
  "privacyNotice": "隐私声明",
  "optional": "选填",
  "why": "原因？",
  "reason": {
    "tooMany": "邮件太多",
    "notUseful": "对我没用",
    "neverSignedUp": "我从未订阅",
    "other": "其他原因"
  },
  "unsubscribe": {
    "titleNewsletter": "将 {address} 从 {business} 的新闻通讯中退订？",
    "titleSurveys": "将 {address} 从 {business} 的调查中退订？",
    "titleAll": "将 {address} 从 {business} 的所有营销邮件中退订？",
    "one": "退订",
    "all": "退订 {business} 的所有营销邮件",
    "done": "您已退订。",
    "doneNewsletter": "您将不会再收到 {business} 的新闻通讯。",
    "doneSurveys": "您将不会再收到 {business} 的调查。",
    "doneAll": "您将不会再收到 {business} 的营销邮件。",
    "stillService": "有关您自己的订单和参观的邮件仍会发送给您。",
    "already": "您已经退订了。",
    "dead": "此链接无效。",
    "deadWrite": "请写信至 {email}，我们会将您从名单中移除。",
    "deadAsk": "请联系 {business}，他们会将您从名单中移除。"
  },
  "unavailable": {
    "title": "此页面不可用。"
  },
  "confirm": {
    "titleNewsletter": "确认订阅 {business} 的新闻通讯",
    "titleSurveys": "确认参与 {business} 的调查",
    "for": "适用于 {address}",
    "button": "确认",
    "note": "在您按下“确认”之前，什么都不会发生。我们发送的每封电子邮件都可以退订。",
    "done": "您已订阅。谢谢。",
    "doneNewsletter": "您将收到 {business} 的新闻通讯。",
    "doneSurveys": "您将收到 {business} 的调查。",
    "leave": "每封电子邮件都有退订链接。",
    "already": "您已确认过。谢谢。",
    "tooOld": "此链接已过期。",
    "tooOldWebsite": "请在 {website} 重新订阅，我们会发送新的链接。",
    "tooOldAgain": "请在 {business} 的网站重新订阅，我们会发送新的链接。",
    "deadWrite": "如果您想订阅，请写信至 {email}。",
    "deadAsk": "如果您想订阅，请联系 {business}。"
  },
  "object": {
    "title": "反对 {business} 保留您的信息？",
    "line": "{business} 将删除您的信息，并把此地址加入其不发送邮件的名单。",
    "button": "提出反对",
    "done": "已完成。我们已删除您的信息，不会再给您写信。",
    "stays": "{business} 会保留其自身提到过您的记录，但已删去您的信息：{records}。",
    "already": "您已经提出过反对。{business} 不保留您的信息。",
    "dead": "此链接无效。请写信至 {email}。",
    "deadAsk": "此链接无效。请写信给 {business}。"
  },
  "textConfirm": {
    "title": "通过短信接收{business}的优惠？",
    "line": "点击“确认”后，{business}可以通过短信向此号码发送优惠信息。您可以回复 STOP 退订其中任何一条。",
    "button": "确认",
    "done": "已确认。{business}现在可以通过短信向您发送优惠信息。",
    "stop": "回复其中任何一条 STOP 即可退订。",
    "already": "您已确认过。",
    "withdrawn": "此请求已无法确认。",
    "withdrawnLine": "除非您再次同意，否则不会收到{business}的任何短信优惠。",
    "tooOld": "此链接已过期。"
  }
} as const;
