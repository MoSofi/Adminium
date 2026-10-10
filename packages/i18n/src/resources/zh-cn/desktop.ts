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
  "packages": {
    "again": "重试",
    "body": "构建此项目所需的内容尚未在这台电脑上。Adminium 可以现在下载，然后打开项目。网络较慢时需要几分钟。",
    "cancel": "暂不",
    "failed": "无法获取软件包。",
    "get": "获取并打开",
    "title": "获取此项目的软件包？",
    "working": "正在获取软件包"
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
  },
  "found": {
    "data": "已找到此项目的数据。",
    "key": "已找到它的密钥。",
    "noData": "此文件夹中有项目，但没有数据。",
    "madeBoth": "Adminium 创建了新的密钥和一个空数据库。",
    "madeDatabase": "Adminium 创建了一个空数据库。",
    "rowsLost": "应用自己的表会重新创建。旧数据中的行不在这里。"
  },
  "opening": {
    "continue": "继续",
    "close": "关闭",
    "notAProject": {
      "line": "你可以在其中的文件夹里创建新项目。",
      "another": "选择其他文件夹",
      "make": "在此处创建新项目"
    }
  },
  "key": {
    "heading": "此项目的数据在这里，但缺少密钥。",
    "body": "密钥是项目文件夹中名为 ‹.env› 的文件里的一行。你的电脑会隐藏名称以点开头的文件。",
    "body2": "没有密钥，就无法读取此项目数据中保存的数据库连接和 API 密钥。",
    "hidden": {
      "mac": "在访达中按 ⌘ ⇧ . 可显示它们。",
      "windows": "在文件资源管理器中，选择 查看 › 显示 › 隐藏的项目。",
      "linux": "在文件管理器中按 Ctrl H。"
    },
    "env": {
      "title": "我有 .env 文件",
      "line": "选择它，Adminium 会把它复制进来。",
      "pick": "选择此项目的 .env 文件",
      "notAKey": "该文件中没有密钥。请选择随此项目数据一起提供的 .env 文件。"
    },
    "fresh": {
      "title": "重新开始数据，保留我的应用",
      "line": "你的旧数据会移到名为 ‹{folder}› 的文件夹中。不会删除任何内容。"
    },
    "new": {
      "title": "使用新密钥继续",
      "line": "数据会保留。其中保存的连接和密钥将失效，需要重新输入。"
    },
    "failed": "无法完成该操作。"
  },
  "accounts": {
    "heading": "此项目附带了账户",
    "people": "{count, plural, other {# 个人}}",
    "peopleLabel": "人员",
    "apiKeys": "{count, plural, other {# 个 API 密钥}}",
    "apiKeysLabel": "API 密钥",
    "publicKeys": "{count, plural, other {# 个对公众开放的密钥}}",
    "publicKeysLabel": "对公众开放",
    "body": "你将在这台电脑上以其所有者身份工作。在网络上共享它之前，你需要设置新的所有者密码，旧的会话和 API 密钥将失效。",
    "show": "显示",
    "hide": "隐藏",
    "more": "另有 {count} 个"
  },
  "notice": {
    "manager": {
      "title": "此项目使用 {manager}。",
      "line": "Adminium 改用 npm 安装。你的 {manager} 文件保持原样。"
    },
    "older": {
      "title": "此项目由较旧的 Adminium（‹{was}›）创建。",
      "line": "将它更新到 ‹{here}›，使一切保持一致。这会更改项目中的一行，并重新下载它的构建模块。",
      "update": "更新此项目",
      "notNow": "暂时不要",
      "working": "正在更新此项目…",
      "failed": "无法更新此项目。它仍可按原样打开。"
    },
    "newer": {
      "title": "此项目需要更新版本的 Adminium。",
      "line": "它上次是用 Adminium ‹{last}› 打开的。这台电脑上是 ‹{here}›。",
      "lineUnknown": "它上次是用更新版本的 Adminium 打开的。这台电脑上是 ‹{here}›。",
      "update": "更新 Adminium",
      "looking": "正在查找更新版本的 Adminium。找到后会在此处提供。",
      "cannot": "此 Adminium 副本不会自行更新。请从 adminium.dev 获取最新版本。"
    },
    "running": {
      "title": "此项目已在运行",
      "cli": "它已在终端中打开，端口为 ‹{port}›。请先在那里关闭它。",
      "app": "它已在另一个 Adminium 窗口中打开，端口为 ‹{port}›。请先在那里关闭它。",
      "again": "重新检查"
    }
  },
  "install": {
    "offline": "无法连接互联网。软件包来自 registry.npmjs.org：请检查网络连接后重试。",
    "proxy": "你的网络代理拒绝了下载。请检查这台电脑的代理设置后重试。",
    "disk": "此磁盘已满。请释放一些空间后重试。",
    "registry": "软件包注册表返回了错误。请稍后重试。"
  },
  "shared": {
    "copyFailed": "无法复制该地址。",
    "best": "推荐",
    "copy": "复制 {address}",
    "portChanged": "端口 {was} 已被占用，因此地址改为 {now}。",
    "heading": "{name} 正在共享",
    "noNetwork": "这台电脑未连接任何网络，因此其他设备暂时无法访问它。请加入 Wi-Fi 或插上网线：地址会显示在这里。",
    "open": "在另一台设备上打开",
    "qr": "用于扫描 {address} 的二维码",
    "notEncrypted": "本地网络上的流量未加密。请只在你信任的网络上共享。",
    "awake": "项目共享期间你的电脑会保持唤醒。合上盖子会停止共享。",
    "dashboard": "打开仪表板",
    "build": "返回构建",
    "designerOff": "项目共享期间 Designer 处于关闭状态。返回构建即可更改你的应用。",
    "keep": "继续共享",
    "buildAsk": "返回构建？",
    "buildAskBody": "在其他设备上使用它的人将被断开连接。"
  },
  "connect": {
    "notAnAddress": "这不是一个地址。请输入类似 office-pc.local:4600 的地址。",
    "notPrivate": "Adminium 只在你自己的网络上使用未加密连接。请使用 https 地址。",
    "noAnswer": "该地址没有任何响应。请检查另一台电脑是否已开机并正在共享。",
    "notAdminium": "该地址没有看起来像 Adminium 的响应。",
    "address": "地址",
    "checking": "正在检查…",
    "go": "连接",
    "notEncrypted": "此地址未加密。请只在你信任的网络上使用它。",
    "anyway": "仍然连接",
    "recent": "最近",
    "version": "Adminium {version}",
    "forgetOf": "忘记 {address}",
    "forget": "忘记"
  }
} as const;
