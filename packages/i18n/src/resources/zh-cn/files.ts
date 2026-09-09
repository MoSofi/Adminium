// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/files.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "toast": {
    "restored": "{name} 已恢复",
    "restoreFailed": "无法恢复此文件",
    "trashed": "{name} 已移至回收站",
    "trashFailed": "无法将此文件移至回收站"
  },
  "title": "文件",
  "subtitle": "通过此工作区上传的所有文件，以及它们的字节存放在何处。",
  "search": "按文件名搜索",
  "trash": {
    "notice": {
      "title": "回收站会自动清空",
      "body": "回收站中的文件在本服务器的保留期结束后会被彻底删除，字节数据也一并清除。请在此之前恢复仍需要的文件。"
    }
  },
  "listFailed": {
    "title": "无法加载这些文件"
  },
  "empty": {
    "filtered": {
      "title": "这里没有内容",
      "body": "清除搜索条件，或从侧栏中选择其他快捷入口。"
    },
    "title": "还没有文件",
    "body": "有人将文件附加到记录或填写文件字段后，文件会显示在这里。"
  },
  "loadMore": "加载更多文件",
  "usage": {
    "label": "已用存储",
    "used": "已用 {size}",
    "count": "{count, plural, other {# 个文件}}",
    "diskLabel": "已用空间",
    "ofDisk": "此磁盘已用 {used}，共 {size}"
  },
  "rail": {
    "label": "文件快捷入口",
    "byTable": "按数据表",
    "byDestination": "按存储目标",
    "byConnection": "按连接"
  },
  "preset": {
    "all": "全部文件",
    "unattached": "未附加",
    "trash": "回收站",
    "recent": "最近"
  },
  "column": {
    "name": "文件",
    "size": "大小",
    "attachedTo": "附加到",
    "destination": "存储目标",
    "added": "添加时间",
    "actions": "操作"
  },
  "row": {
    "unattached": "未附加",
    "localDestination": "本服务器的磁盘",
    "noRecord": "未附加到任何记录"
  },
  "action": {
    "restore": "恢复",
    "download": "下载",
    "deleteNamed": "删除 {name}",
    "delete": "删除"
  },
  "drawer": {
    "none": "无",
    "subtitle": "{size} · {type}",
    "destination": "存储目标",
    "attachedTo": "附加到",
    "uploadedBy": "上传者",
    "added": "添加时间",
    "attachedAt": "附加时间",
    "trashedAt": "移入回收站时间",
    "id": "文件 ID",
    "checksum": "校验和"
  },
  "view": {
    "label": "文件的显示方式",
    "grid": "网格",
    "list": "列表"
  },
  "upload": {
    "open": "上传",
    "title": "上传文件",
    "subtitle": "向此工作区添加文件。",
    "connection": "它们属于哪个连接",
    "drop": "将文件拖到此处",
    "browse": "浏览你的电脑",
    "sending": "正在上传",
    "cancelOne": "取消 {name}",
    "removeOne": "移除 {name}",
    "complete": "上传完成",
    "completeBody": "这些文件现已在此工作区中，稍后可以附加到记录。",
    "send": "{count, plural, other {上传 # 个文件}}",
    "done": "完成",
    "failed": "失败",
    "cancelled": "已取消"
  }
} as const;
