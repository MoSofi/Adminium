// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/desktop.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "new": {
    "back": "返回",
    "change": "更改…",
    "create": "创建",
    "creating": "正在准备…",
    "failed": "无法创建该项目。",
    "heading": "构建应用",
    "help": "Adminium 会为你创建这个文件夹。与你的应用有关的一切都在其中。",
    "name": "名称",
    "refuse": {
      "badName": "名称中至少要有一个字母或数字。",
      "existsWithFiles": "已有同名文件夹，且其中有文件。请换一个名称或另选文件夹。",
      "homeFolder": "项目不能直接放在你的个人文件夹中。请在其中选择或新建一个文件夹。",
      "insideAProject": "此文件夹位于另一个项目内。请选择该项目之外的文件夹。",
      "insideTheApp": "项目不能放在 Adminium 自身之内。请另选文件夹。",
      "notAbsolute": "请用“更改…”按钮选择文件夹。",
      "systemFolder": "项目不能放在属于系统的文件夹中。请选择你自己的文件夹。"
    },
    "step": {
      "files": "正在准备应用的文件",
      "packages": "正在获取构建应用所需的内容",
      "database": "正在创建数据库",
      "opening": "正在打开应用",
      "slow": "第一次时这一步最久：网络较慢时需要几分钟。之后的应用会更快。",
      "label": "正在进行的操作"
    },
    "warn": {
      "another": "另选文件夹",
      "anyway": "仍然使用",
      "dropbox": "此文件夹由 Dropbox 同步。项目在同步文件夹中运行不佳：同步可能损坏其数据。",
      "googledrive": "此文件夹由 Google Drive 同步。项目在同步文件夹中运行不佳：同步可能损坏其数据。",
      "icloud": "此文件夹由 iCloud Drive 同步。项目在同步文件夹中运行不佳：同步可能损坏其数据。",
      "noLinks": "此磁盘无法保存项目的软件包所需的链接，因此获取软件包很可能失败。",
      "onedrive": "此文件夹由 OneDrive 同步。项目在同步文件夹中运行不佳：同步可能损坏其数据。"
    },
    "where": "保存位置"
  },
  "start": {
    "choice": {
      "build": {
        "line": "描述它，Designer 就会在这台电脑上把它构建出来。",
        "title": "构建应用"
      },
      "connect": {
        "line": "使用在另一台电脑上运行的 Adminium。",
        "title": "连接到另一个 Adminium"
      },
      "db": {
        "line": "为你已有的数据库制作界面。",
        "title": "使用我自己的数据库"
      },
      "open": {
        "line": "继续使用已在某个文件夹中的应用，或别人发给你的应用。",
        "title": "打开文件夹"
      }
    },
    "heading": "你想做什么？",
    "open": {
      "needsPackages": "这台电脑上还没有此项目的软件包。",
      "notAProject": "此文件夹不是 Adminium 项目。"
    },
    "recent": {
      "alreadyListed": "该文件夹已在列表中。",
      "building": "构建中",
      "gone": "此文件夹已被移动或删除",
      "heading": "最近的项目",
      "locate": "查找…",
      "locateTitle": "{name} 现在在哪里？",
      "notThatProject": "该文件夹不是 Adminium 项目。",
      "open": "打开 {name}",
      "openDashboard": "打开仪表板",
      "openDashboardOf": "打开 {name} 的仪表板",
      "openDesigner": "在 Designer 中打开",
      "openDesignerOf": "在 Designer 中打开 {name}",
      "opened": "打开时间：{when}",
      "remove": "移除",
      "removed": "已从最近的项目中移除",
      "shared": "已共享"
    },
    "welcome": "欢迎使用 Adminium。"
  },
  "toast": {
    "dismiss": "关闭",
    "region": "通知"
  },
  "trust": {
    "body": "打开它会在这台电脑上运行其中的代码，并拥有你对自己文件的访问权限。只打开你自己创建的或来自你信任的人的文件夹。",
    "cancel": "取消",
    "changed": "自你上次打开以来，此文件夹的代码已更改。",
    "open": "打开",
    "title": "要打开此文件夹吗？"
  }
} as const;
