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
      "emailed": "付款链接正在发送至 {to}。",
      "refundRequested": "已申请退款 {amount}。",
      "refundFailed": "退款 {amount} 失败：{reason}"
    },
    "moreFor": "{ref} 的更多操作",
    "menu": {
      "refund": "退款…"
    },
    "why": {
      "pending": "这笔付款仍在等待银行处理。",
      "full": "这笔付款已全额退款。",
      "offline": "这种付款方式无法在线退款。请自行向客户退款。",
      "disputed": "这笔付款有争议。请先在 {service} 控制台中答复争议。",
      "notTaken": "这笔付款没有扣到钱。"
    },
    "disputed": "有争议",
    "disputeLine": "有争议 — 请在 {service} 控制台中答复",
    "disputeNote": "如果争议败诉，款项会退还给客户。发票不会因此自动更改。",
    "disputeClosed": "争议已结束。结果请在 {service} 控制台中查看。",
    "refundRequested": "已申请退款 {amount}",
    "refundWaitingCustomer": "退款 {amount} 正在等待客户",
    "refundFailed": "退款 {amount} 失败：{reason}。请联系客户，并记录你们商定的结果。",
    "refundFailedPlain": "退款 {amount} 失败。请联系客户，并记录你们商定的结果。",
    "refundCancelled": "退款 {amount} 已取消。",
    "refundedOnInline": "已于 {date} 退款 {amount}",
    "refundedThere": "已于 {date} 在 {service} 控制台中退款 {amount} · 已记录",
    "needsLook": "需要查看"
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
  },
  "notice": {
    "landed": {
      "title": "已收到付款",
      "body": "{label} 的 {amount}",
      "bodyWith": "{label} 的 {amount}，通过 {paidWith}"
    },
    "look": {
      "title": "有一笔付款需要查看",
      "notRecorded": "已在 {provider} 付款，未记录：{label}",
      "notYet": "已在 {provider} 付款，尚未记录：{label}",
      "amount": "已在 {provider} 付款，但金额与要求不符：{label}",
      "voided": "作废后在 {provider} 付款：{label}",
      "mode": "在 {provider} 以另一种模式付款，未被认可：{label}",
      "twice": "在 {provider} 付款了两次：{label}",
      "missing": "已记录的付款已不存在：{label}",
      "refundedThere": "已在 {provider} 控制台中退款：{label} 的 {amount}。已记录。"
    },
    "key": {
      "title": "{provider} 拒绝了密钥",
      "body": "在保存可用的密钥之前，付款已暂停。"
    },
    "webhook": {
      "title": "{provider} 的 webhook 没有消息",
      "body": "自 {date} 起没有事件。将通过查询找到付款，速度较慢。",
      "bodyNever": "尚未收到任何正式事件。将通过查询找到付款，速度较慢。"
    },
    "reads": {
      "title": "Adminium 向 {provider} 查询的频率降低",
      "body": "本月 {provider} 允许的查询次数已用掉一半。"
    },
    "keysRemoved": {
      "title": "{provider} 的密钥已删除",
      "body": "由 {by} 删除。在保存新密钥之前，不会通过 {provider} 开始任何付款。"
    },
    "redirect": {
      "account": "某个付款密钥现在属于另一个账户",
      "bank": "银行转账的银行信息已更改",
      "payAddress": "付款地址已更改",
      "body": "原为 {from} · 现为 {to} · 由 {by} 更改",
      "byTo": "现为 {to} · 由 {by} 更改",
      "byOnly": "由 {by} 更改"
    },
    "refundFailed": {
      "title": "退款失败",
      "body": "{amount} 退至 {paidWith}"
    },
    "dispute": {
      "title": "已发起争议",
      "body": "{label} · 请在 {date} 前答复",
      "bodyNoDate": "{label} · 请在 {provider} 控制台中答复"
    }
  },
  "refund": {
    "step1": "第 1 步，共 2 步",
    "step2": "第 2 步，共 2 步",
    "title": "退款",
    "close": "关闭",
    "amount": "金额",
    "full": "全额",
    "part": "部分",
    "upTo": "最多可退款 {amount}",
    "reason": "原因",
    "reasons": {
      "requested_by_customer": "客户要求",
      "duplicate": "重复付款",
      "fraudulent": "欺诈",
      "other": "其他"
    },
    "note": "备注",
    "notePh": "可选",
    "goesBack": "退回至 {paidWith}。通常需要 5–10 天。",
    "goesBackPlain": "按原付款方式退回。通常需要 5–10 天。",
    "cancel": "取消",
    "continue": "继续",
    "question": "向 {paidWith} 退款 {amount}？",
    "questionPlain": "退款 {amount}？",
    "cantUndo": "此操作无法撤销。",
    "back": "返回",
    "submit": "退款",
    "failed": "未能申请退款：{message}"
  }
} as const;
