// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/project.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "cell": {
    "notCell": "{id} 是卡片，不是表格单元格。",
    "unknown": "此项目没有小组件 {id}。"
  },
  "page": {
    "failed": {
      "title": "此页面的代码未能加载"
    },
    "missing": {
      "body": "它的代码来自项目文件夹。请重新构建项目，或重启 Adminium，以加载它。",
      "title": "此页面不在正在运行的构建中"
    }
  },
  "table": {
    "empty": "没有记录"
  }
} as const;
