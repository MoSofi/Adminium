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
  "notInstalled": {
    "title": "尚未安装此 Add-on",
    "body": "您打开的页面属于某个 Add-on，但该 Add-on 未安装在此服务器上，或已被关闭。管理员可以在 Studio 中安装它。"
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
  "refused": {
    "body": "页面代码已加载，但服务器拒绝了它的一个请求：{reason}"
  },
  "crashed": {
    "body": "页面代码已加载，但因出错而停止：{reason}"
  },
  "listFailed": {
    "body": "无法读取已安装的 Add-on 列表，因此无法确定此页面应加载哪个文件。"
  },
  "tooOld": {
    "title": "此页面需要更新版本的 Adminium",
    "body": "此附加组件的页面是为比当前更新的 Adminium 版本构建的。更新 Adminium 后即可打开；页面中的任何内容都未运行。"
  },
  "accounts": {
    "notice": {
      "connectedTitle": "{person} 连接了一个账户",
      "connectedBody": "{person} 现已以 {account} 连接到 {provider}。",
      "refusedTitle": "{provider} 拒绝了此服务器的应用",
      "refusedBody": "请检查为 {provider} 保存的客户端 ID 和密钥。无需任何人重新连接：应用被接受后，连接会自动恢复。",
      "clashTitle": "{person} 的日历有冲突",
      "clashBody": "{person} 日历中的忙碌时间现在与一项预约重叠。打开该预约以改期或保留。",
      "staleTitle": "已移除 {person} 的忙碌时间",
      "staleBody": "{person} 已 7 天未重新连接，因此其日历不再占用时间。",
      "removedTitle": "{person} 删除了日历 {calendar}",
      "removedBody": "该日历在一周内被删除两次，因此预约不再写入 {person} 的日历，直到其重新开启。",
      "remadeTitle": "已重新创建日历 {calendar}",
      "remadeBody": "该日历已从 {person} 的账户中删除，因此已连同即将到来的预约重新创建。",
      "silentTitle": "{person} 日历的更改到达延迟",
      "silentBody": "即时更新已停止，更改将随定期检查到达，大约在 12 分钟内。",
      "secretEndingTitle": "{provider} 客户端密钥将于 {date} 到期",
      "secretEndingBody": "请在此日期前创建新的客户端密钥并粘贴到设置指南中，否则所有 {provider} 连接都会停止。无需任何人重新连接。"
    }
  }
} as const;
