// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/pay.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "documentTitle": "支付 {label}",
  "documentTitlePlain": "付款",
  "testBand": "测试页面 — 不会有任何资金转移。",
  "language": {
    "menu": "语言",
    "button": "语言：{name}"
  },
  "hero": {
    "due": "应付金额",
    "paid": "已付款",
    "started": "付款已发起",
    "partly": "{total} 中已支付 {paid}。",
    "dueBy": "到期日：{date}"
  },
  "ways": {
    "title": "付款方式",
    "stripe": "使用银行卡及其他方式付款",
    "stripeSub": "银行卡、Apple Pay、Google Pay 等，在安全的 Stripe 页面上完成",
    "paypal": "使用 PayPal 付款",
    "demo": "使用演示服务付款",
    "demoSub": "模拟资金，仅限测试模式",
    "online": "在线付款",
    "bank": "银行转账付款",
    "cash": "货到付款",
    "other": "其他付款方式",
    "gettingReady": "正在准备…",
    "noteStripe": "您将在 Stripe 页面上付款。该商家绝不会看到您的银行卡。",
    "notePaypal": "您将在 PayPal 页面上付款。该商家绝不会看到您的银行卡。",
    "noteBoth": "您将在 Stripe 或 PayPal 页面上付款。该商家绝不会看到您的银行卡。",
    "staffNoWay": "仅您可见：此记录未开启任何在线付款方式，因此此测试页面只提供演示服务。请在 Studio → 付款 → 付款方式中开启一种。"
  },
  "provider": {
    "stripe": "Stripe",
    "paypal": "PayPal",
    "demo": "演示服务",
    "other": "支付服务"
  },
  "redirect": {
    "title": "正在前往 {provider}…",
    "link": "没有跳转？继续前往 {provider}",
    "notArabic": "Stripe 页面不提供阿拉伯语。"
  },
  "checking": {
    "title": "正在向 {provider} 确认…",
    "body": "这需要几秒钟。您可以关闭此页面，商家仍会收到您的付款。",
    "slow": "所需时间比平时长。您可以关闭此页面，商家仍会收到您的付款。"
  },
  "paid": {
    "title": "谢谢。您支付的 {amount} 已到账。",
    "receiptAsk": "如需收据，请联系 {shop}。",
    "already": "此款项已付清。谢谢。",
    "receiptSent": "收据正在发送到您的邮箱。"
  },
  "processing": {
    "title": "您的银行正在确认",
    "withMethod": "{date} 已发起一笔 {amount} 的付款（{method}）。您的银行会在几个工作日内确认。您无需再次付款。",
    "plain": "{date} 已发起一笔 {amount} 的付款。您的银行会在几个工作日内确认。您无需再次付款。"
  },
  "failed": {
    "title": "付款未成功。",
    "body": "未扣除任何款项。",
    "retry": "重试",
    "otherWay": "选择其他方式"
  },
  "cancelled": {
    "title": "您在付款前离开了付款页面。",
    "body": "未扣除任何款项。",
    "stripe": "您在付款前离开了 Stripe 页面。",
    "paypal": "您在付款前离开了 PayPal 页面。"
  },
  "shopChecks": {
    "title": "商家将核查这笔付款",
    "body": "我们收到了一笔付款，但金额与应付金额不符。商家会进行核查，并写信联系您。"
  },
  "retryLater": "请重新打开付款链接再试一次。",
  "nothingDue": {
    "title": "这里暂时没有需要支付的款项。",
    "body": "请联系 {shop}。"
  },
  "voided": {
    "title": "此款项已无法在这里支付。",
    "body": "请联系 {shop}。"
  },
  "expired": {
    "title": "此付款链接已过期。",
    "body": "请向 {shop} 索取新链接。"
  },
  "testEnded": {
    "title": "这是一个测试链接。",
    "body": "{shop} 现已接受真实付款。请向其索取付款链接。"
  },
  "unknown": {
    "title": "此链接无效。",
    "body": "请向 {shop} 索取新链接。"
  },
  "locked": {
    "title": "此链接的付款尝试次数过多。",
    "bodyBank": "请一小时后再试，或通过银行转账付款。",
    "body": "请一小时后再试。"
  },
  "noWays": {
    "title": "这里无法在线支付此金额。",
    "body": "请联系 {shop}。"
  },
  "unavailable": {
    "title": "{shop} 目前无法接受在线付款。",
    "body": "请直接联系商家。"
  },
  "testStaffOnly": {
    "title": "此测试链接仅对 {shop} 的员工开放。",
    "body": "请在此浏览器中登录仪表盘，然后重新打开链接。"
  },
  "offline": {
    "title": "此页面无法连接到商家。",
    "body": "请检查网络连接后重试。",
    "retry": "重试"
  },
  "proofFailed": "真人验证未通过。请重试。",
  "bank": {
    "title": "银行转账",
    "holder": "账户持有人",
    "iban": "IBAN",
    "bic": "BIC",
    "accountNumber": "账号",
    "sortCode": "银行分类代码",
    "bankName": "银行",
    "amount": "金额",
    "reference": "付款参考号",
    "note": "请填写此参考号，以便商家找到您的付款。商家核对后，状态会显示为已付款。",
    "copy": "复制",
    "copied": "已复制",
    "copyLabel": "复制 {label}",
    "copiedLive": "已复制 {label}。",
    "otherWays": "其他付款方式",
    "noAccount": "请向 {shop} 索取该币种的银行账户信息。"
  },
  "cash": {
    "title": "货到付款",
    "plain": "订单送达时支付应付金额。"
  },
  "footer": {
    "questions": "有疑问？请写信至"
  },
  "demo": {
    "title": "演示支付服务",
    "staff": "仅限员工。这是模拟支付服务：不会转移任何资金，也不需要银行卡。",
    "succeeds": "付款：银行卡支付成功",
    "fails": "付款：银行卡被拒绝",
    "needsStep": "付款：银行要求完成一个步骤",
    "settlesLate": "付款：款项稍后到账",
    "finishStep": "完成银行要求的步骤",
    "leave": "不付款并离开",
    "gone": "此演示付款无法继续。请返回付款页面。"
  },
  "lines": {
    "title": "付款用途"
  },
  "noscript": {
    "title": "此页面需要 JavaScript 才能在线付款。"
  },
  "shopFallback": "商家",
  "shopFallbackStart": "商家"
} as const;
