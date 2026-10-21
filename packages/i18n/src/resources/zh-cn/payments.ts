// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/payments.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "panel": {
    "balanceDue": "待付余额",
    "paid": "已付",
    "paidInFull": "已全额付清",
    "copyLink": "复制付款链接",
    "emailLink": "通过电子邮件发送付款链接",
    "record": "记录一笔付款",
    "revoke": "撤销",
    "test": "测试",
    "refunded": "已退款",
    "linkLine": "付款链接创建于 {made} · 有效期至 {until}",
    "waitingWith": "通过 {way} 的付款开始于 {date} · 等待银行确认",
    "waitingPlain": "一笔在线付款开始于 {date} · 等待银行确认",
    "recordedBy": "由 {name} 记录",
    "online": "在线付款（{service}）",
    "refundedInline": "已退款 {amount}",
    "listLabel": "此记录的付款",
    "notice": {
      "draft": "请先发送发票。只有已发送的发票才能记录付款。",
      "private": "客户无法访问此服务器，因此付款链接已关闭。您仍可以记录付款。",
      "update": "此发票表需要其应用的更新才能接受在线付款。",
      "voided": "此发票已作废，无法收款。",
      "noCurrency": "此记录没有币种，因此无法记录付款。",
      "unclear": "此记录的金额在其币种中不精确，因此无法记录付款。",
      "notPayable": "此记录目前无法接受付款。"
    },
    "by": {
      "bank-transfer": "通过银行转账",
      "cash": "现金",
      "card": "通过我们自己的刷卡终端",
      "cheque": "通过支票",
      "other": "其他方式",
      "online": "在线"
    },
    "toast": {
      "copied": "已复制付款链接。",
      "replaced": "新的付款链接已替换 {date} 创建的链接。",
      "revoked": "已撤销付款链接。旧地址不再有效。",
      "recorded": "已记录 {amount} 的付款。",
      "copyFailed": "付款链接已创建，但此浏览器未能复制：{url}",
      "failed": "操作未成功：{message}",
      "emailed": "付款链接正在发送至 {to}。"
    }
  },
  "record": {
    "title": "记录一笔付款",
    "amount": "金额",
    "way": "付款方式",
    "wayPh": "选择付款方式",
    "ways": {
      "bank-transfer": "银行转账",
      "cash": "现金",
      "card": "我们自己的刷卡终端",
      "cheque": "支票",
      "other": "其他"
    },
    "date": "日期",
    "note": "备注",
    "notePh": "可选",
    "approval": "授权码",
    "approvalHelp": "最多 12 个字母和数字。",
    "approvalErr": "只能使用字母和数字，最多 12 个。",
    "last4": "卡号后四位",
    "last4Err": "只输入卡号后四位。",
    "cardNumber": "这看起来像完整的卡号。请勿在此填写卡号。",
    "amountErr": "请输入大于零的金额。",
    "overDue": "这超过了待付的 {amount}。",
    "dateErr": "付款日期不能在未来。",
    "pendingWarn": "有一笔在线付款正在等待银行确认。再记录一笔可能会重复收款。",
    "cancel": "取消",
    "submit": "记录付款",
    "close": "关闭",
    "failed": "付款未记录：{message}"
  }
} as const;
