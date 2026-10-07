// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/errors.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "UNAUTHENTICATED": "需要登录才能继续。",
  "SESSION_EXPIRED": "会话已过期。请重新登录以继续。",
  "FORBIDDEN": "你没有执行此操作的权限。",
  "PAGE_FORBIDDEN": "你没有编辑此页面的权限。",
  "NOT_FOUND": "该资源不存在或已被移除。",
  "CONFLICT": "该更改与当前状态冲突。请刷新后重试。",
  "UNIQUE_VIOLATION": "该值已被使用。",
  "VALIDATION_FAILED": "部分字段需要修改后才能保存。",
  "RATE_LIMITED": "请求过多——请稍等片刻再试。",
  "PAYLOAD_TOO_LARGE": "该请求过大。",
  "META_NOT_CONFIGURED": "尚未配置元数据存储。",
  "CONNECTION_FAILED": "Adminium 无法连接到数据库。",
  "INTERNAL": "出错了。请将请求 ID 提供给支持团队。",
  "OFFLINE": "你似乎已离线。请重新联网后继续。",
  "LLM_JSON_PARSE": "AI 返回的内容不是有效的 JSON。",
  "LLM_TRUNCATED": "AI 返回的内容在结束前被截断了。",
  "LLM_VERSION_MISMATCH": "该响应是为不受支持的版本生成的。请在“设置 → AI”中重新生成提示词。",
  "LLM_MODEL_DECLINED": "AI 拒绝为此架构生成建议。",
  "LLM_SCHEMA_INVALID": "AI 响应与预期的结构不匹配。",
  "LLM_LOCALE_KEYS": "某个翻译值缺少一种所请求的语言。",
  "LLM_UNKNOWN_TABLE": "AI 引用了此架构中不存在的表；该建议已被丢弃。",
  "LLM_UNKNOWN_COLUMN": "AI 引用了此架构中不存在的列；该建议已被丢弃。",
  "LLM_BAD_DISPLAY_COLUMN": "建议的显示列是 ID，而非可读值。",
  "LLM_NOT_AN_ENUM": "AI 把某一列当作状态列表，但它并不是。",
  "LLM_ENUM_VALUES": "建议的状态值与该列的实际值不匹配。",
  "LLM_UNKNOWN_RELATION": "AI 确认了此架构中未声明的关系。",
  "LLM_RELATION_INVALID": "建议的关系无效或与现有关系重复。",
  "LLM_UNKNOWN_TEMPLATE": "AI 推荐了不允许使用的页面模板。",
  "LLM_UNKNOWN_WIDGET": "AI 推荐了不允许使用的仪表盘小组件。",
  "LLM_WIDGET_BINDING": "某个建议的小组件绑定到不匹配的列；已被移除。",
  "LLM_GROUP_INVALID": "某个导航分组无效——一个表出现在多个分组中。",
  "LLM_UNKNOWN_ICON": "建议的图标不可用；已改用默认图标。",
  "LLM_LABEL_COLLISION": "两条建议使用了相同的名称；二者会显示为同一个标题。",
  "LLM_RUN_MISMATCH": "该响应似乎是从其他提示词生成的。",
  "POSTING_REFUSED": "无法保存：负责记录的附加组件拒绝了此操作。",
  "POSTING_REASON": {
    "out-of-stock": "剩余数量不足。",
    "expired": "已过期。",
    "needs-batch": "请选择来自哪个批次。",
    "not-valid": "此代码无效。",
    "inactive": "尚未启用。",
    "void": "已取消。",
    "empty": "已无余额。",
    "used-up": "已用完。",
    "over-limit": "这将超出限额。",
    "needs-customer": "需要地址已确认的客户。",
    "refund-over": "超过了以此方式支付的金额。",
    "not-allowed": "此处不允许这样做。",
    "mapped-changed": "此行仍占用着内容：请先归还，再修改。",
    "receipt-open": "此项仍占用着内容：请先归还。",
    "one-at-a-time": "这些行需逐行保存。",
    "add-on-unavailable": "所依赖的附加组件目前无法应答，因此无法保存。",
    "planner-failed": "所依赖的附加组件未按要求应答，因此未保存任何内容。",
    "too-large": "超出了一次可保存的数量。",
    "hooked": "项目代码会更改附加组件管理的表，因此保存期间无法在其中记录。",
    "guarded": "附加组件管理的表有自己的锁，因此保存期间无法在其中记录。",
    "card-pays-card": "不能用这种方式支付。"
  },
  "ADJUST_REFUSED": "无法将此应用于价格。",
  "ADJUST_REASON": {
    "unknown": "这里没有这样的优惠码。",
    "used-up": "此优惠码的使用次数已达上限。",
    "needs-minimum": "此优惠码需消费满 {amount}。",
    "not-for-these-items": "此优惠码不适用于本订单中的任何商品。",
    "needs-sign-in": "此优惠码仅供已登录的顾客使用。",
    "needs-customer": "请先指定顾客：此优惠码每位顾客限用一次。",
    "over-ceiling": "这超出了您可以减免的额度。最多为 {max}。",
    "expired": "此优惠码已过期。",
    "inactive": "此优惠码未启用。",
    "void": "此优惠码已作废。",
    "not-yet": "此优惠码尚不能使用。",
    "over-limit": "该顾客使用此优惠码的次数已达上限。",
    "frozen": "此订单的价格已确定，不能再更改。",
    "not-allowed": "您不能更改此项。",
    "refund-over": "这超出了剩余可退的金额。"
  }
} as const;
