/**
 * GENERATED MIRROR of ../../../locales/zh-CN/errors.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "UNAUTHENTICATED": "需要登录才能继续。",
  "SESSION_EXPIRED": "会话已过期。请重新登录以继续。",
  "FORBIDDEN": "你没有执行此操作的权限。",
  "NOT_FOUND": "该资源不存在或已被移除。",
  "CONFLICT": "该更改与当前状态冲突。请刷新后重试。",
  "UNIQUE_VIOLATION": "该值已被使用。",
  "VALIDATION_FAILED": "部分字段需要修改后才能保存。",
  "RATE_LIMITED": "请求过多——请稍等片刻再试。",
  "PAYLOAD_TOO_LARGE": "该请求过大。",
  "META_NOT_CONFIGURED": "尚未配置元数据存储。",
  "CONNECTION_FAILED": "Adminium 无法连接到数据库。",
  "INTERNAL": "出错了。请将请求 ID 提供给支持团队。",
  "OFFLINE": "你似乎已离线。请重新联网后继续。"
} as const;
