// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/addOns.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "page": {
    "notInstalled": {
      "title": "尚未安装此 Add-on",
      "body": "您打开的页面属于某个 Add-on，但该 Add-on 未安装在此工作区，或已被关闭。管理员可以在 Studio 中安装它。"
    },
    "unknown": {
      "title": "页面不存在",
      "body": "此 Add-on 已安装，但在该地址下没有页面。"
    },
    "retry": "重试",
    "noBundle": {
      "title": "无法加载此页面",
      "body": "该 Add-on 声明了此页面，却没有附带它指向的文件。重新安装或升级到更新的版本即可解决。"
    },
    "failed": {
      "title": "无法加载此页面",
      "body": "无法获取该 Add-on 的代码，或其内容与安装时记录的指纹不符。其中的代码未被执行。"
    },
    "listFailed": {
      "body": "无法读取已安装的 Add-on 列表，因此无法确定此页面应加载哪个文件。"
    }
  }
} as const;
