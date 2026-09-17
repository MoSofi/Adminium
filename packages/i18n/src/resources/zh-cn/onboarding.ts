// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/onboarding.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "account": {
    "body": "第一位管理员。这只会发生一次，之后你将保持登录状态。",
    "confirm": "确认密码",
    "email": "电子邮箱",
    "hidePassword": "隐藏密码",
    "label": "你的账户",
    "name": "你的姓名",
    "password": "密码",
    "passwordHelper": "至少 {min} 个字符。",
    "showPassword": "显示密码",
    "strength": "密码强度",
    "strengthLevels": {
      "fair": "一般",
      "good": "良好",
      "strong": "很强",
      "weak": "较弱"
    },
    "sub": "登录信息",
    "submit": "创建账户",
    "title": "创建你的账户"
  },
  "back": "返回",
  "connect": {
    "body": "把 Adminium 指向一个数据源。我们只读取结构，除非你要求，否则绝不写入。",
    "bridge": {
      "body": "它由 adminium.dev 交接而来。创建账户后，我们会在连接向导中打开它，你可以在任何东西使用它之前先看清楚。",
      "title": "有一个连接字符串正在等待此实例"
    },
    "dsn": {
      "checking": "正在检查该数据库……",
      "helper": "在你的账户创建之前，任何内容都不会离开此浏览器——之后我们才会测试它。",
      "incomplete": "请补上主机和数据库，例如 postgres://user@host:5432/db",
      "invalidScheme": "无法识别的协议——应为 postgres://、mysql://、mariadb:// 或 sqlite:",
      "label": "连接字符串"
    },
    "engine": {
      "mysql": "MySQL / MariaDB",
      "postgres": "PostgreSQL",
      "sqlite": "SQLite"
    },
    "engineLabel": "数据库引擎",
    "existing": {
      "adopt": "使用它并登录",
      "adopting": "正在把此实例指向它……",
      "body": "其中有 {count, plural, other {# 张 Adminium 表}}含有数据。你有两个选择：",
      "failed": "无法把此实例指向那个数据库。",
      "otherSecret": "它是用另一个 ADMINIUM_SECRET 建立的：登录仍然可用，但此实例无法解密它保存的连接字符串。",
      "park": "保留它们并重新开始",
      "parked": {
        "body": "它们会被改名挪开——每一行都保留——Adminium 会在旁边新建自己的表。在你把 Adminium 自己的数据放进这个数据库之前，什么都不会发生。",
        "title": "已有的表将被保留"
      },
      "restarting": "正在切换到它并重启……",
      "timeout": "Adminium 已指向那个数据库，但尚未恢复——请稍后重新加载此页面。",
      "title": "那个数据库里已经在运行一个 Adminium"
    },
    "label": "连接数据",
    "sub": "关联数据库",
    "title": "连接你的数据库"
  },
  "continue": "继续",
  "done": {
    "connected": {
      "reading": "已连接——Adminium 正在读取你的数据库结构。",
      "tables": "已连接 · 找到 {count, plural, other {# 张表}}。"
    },
    "invited": "已创建 {count, plural, other {# 份邀请}}。",
    "label": "全部就绪",
    "next": {
      "blank": "你的工作区已就绪。随时都可以添加页面——正如你所选择的，我们没有生成任何内容。",
      "generate": "你的工作区已就绪。接下来我们会挑选要包含的表并生成页面。"
    },
    "storage": {
      "local": "Adminium 把自己的数据保存在这台机器的一个文件里。",
      "sameDb": "Adminium 把自己的数据保存在你刚连接的数据库里。",
      "separate": "Adminium 把自己的数据保存在你为它指定的数据库里。"
    },
    "sub": "开始构建",
    "title": "一切就绪！🎉"
  },
  "error": {
    "alreadyCompleted": "此实例已完成设置。请使用现有的管理员账户登录。",
    "connectionFailed": "你的账户已创建，并且已登录——但无法连接那个数据库：{detail}",
    "connectionUnknown": "数据库没有响应",
    "failed": "设置失败。请检查连接后重试。",
    "rejected": "服务器拒绝了这些信息。请检查邮箱和密码后重试。"
  },
  "finish": "前往仪表板",
  "kicker": "第 {n} 步，共 {total} 步",
  "meta": {
    "body": "你的登录信息、生成的页面和保存的设置。它与你刚连接的数据库是分开的，Adminium 只读取后者。",
    "label": "Adminium 的数据",
    "local": {
      "body": "无需任何配置。适合试用 Adminium，或只运行一个实例。",
      "title": "保存在这台机器的文件里"
    },
    "moving": {
      "copying": "正在复制 Adminium 的数据……",
      "failed": "无法移动 Adminium 的数据——请重试。",
      "restarting": "正在切换到新数据库并重启……",
      "timeout": "Adminium 已移动数据，但尚未恢复。数据安全地存放在新数据库中——请稍后重新加载此页面。"
    },
    "pinned": {
      "body": "此实例启动时已配置好元数据存储，因此无需移动。你可以稍后在 Studio 设置中更改。",
      "title": "Adminium 的数据已有归宿"
    },
    "sameDb": {
      "alreadyAdminium": "那个数据库里已经有一个 Adminium 实例。返回上一步保留它的表并在旁边新建，或者直接登录到它。",
      "body": "Adminium 会在你的表旁边添加自己的 `adminium_` 表。只需备份一个数据库。",
      "disabledFile": "SQLite 文件不是服务器，Adminium 无法在其中添加自己的表。",
      "disabledNoDdl": "该角色无法执行 CREATE TABLE，而 Adminium 自身的迁移需要它。",
      "disabledReadOnly": "该角色是只读的——Adminium 从不写入你的数据库。把它的数据放在文件里，或者给它一个自己的数据库。",
      "noSource": "你还没有连接数据库——先连接一个，或者把 Adminium 的数据保存在文件里。",
      "parked": "已经在那里的 Adminium 表会先被改名挪开——每一行都保留——Adminium 在旁边新建自己的表。",
      "title": "保存在你刚连接的数据库里"
    },
    "separate": {
      "body": "由你提供的 PostgreSQL 或 MySQL 数据库。适合生产环境或多个实例。",
      "failed": "那个数据库没有响应。",
      "incomplete": "请补上主机和数据库，例如 postgres://user@host:5432/adminium",
      "insufficient": "该角色无法执行 CREATE TABLE——Adminium 自身的迁移需要它。",
      "invalidScheme": "无法识别的协议——应为 postgres://、mysql:// 或 mariadb://",
      "label": "Adminium 使用的连接字符串",
      "ok": "可以连接，并且能够创建表。",
      "test": "测试这个数据库",
      "title": "保存在它自己的数据库里"
    },
    "sub": "存放位置",
    "title": "Adminium 把自己的数据放在哪里"
  },
  "progressComplete": "已完成 {percent}%",
  "progressLabel": "设置进度",
  "skip": "跳过",
  "start": {
    "body": "这只会影响我们为你生成的页面。之后你可以随意更改，也可以从零开始。",
    "label": "起点",
    "options": {
      "analytics": {
        "body": "只供阅读的图表和表格。不会写回任何内容。",
        "title": "只读分析"
      },
      "blank": {
        "body": "不生成任何内容。连接数据库后，逐个构建你想要的页面。",
        "title": "空白画布"
      },
      "crud": {
        "body": "表格和表单，不含仪表板。",
        "title": "CRUD 表格"
      },
      "fullAdmin": {
        "body": "每张表一个页面，支持新增、编辑和删除。",
        "title": "完整管理面板"
      },
      "support": {
        "body": "优先生成队列和客户详情页，并关闭删除。",
        "title": "客服控制台"
      }
    },
    "sub": "选择形态",
    "title": "你想先做什么？"
  },
  "team": {
    "body": "邀请与你共事的人。之后随时可以添加更多。",
    "copied": "已复制",
    "copyLink": "复制链接",
    "duplicate": "此人已被邀请。",
    "emailLabel": "同事的电子邮箱",
    "emailed": "邀请已通过邮件发送",
    "failed": "无法创建该邀请。",
    "invalidEmail": "请输入有效的电子邮箱地址。",
    "invite": "邀请",
    "label": "你的团队",
    "note": "没有邮件时，邀请会显示一个由你自行发送的链接。它只显示一次——Adminium 只保留它的哈希值。",
    "placeholder": "tongshi@gongsi.com",
    "sub": "添加成员",
    "title": "邀请你的团队"
  }
} as const;
