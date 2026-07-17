/**
 * GENERATED MIRROR of ../../../locales/zh-CN/common.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "common": {
    "dismiss": "关闭",
    "notifications": "通知",
    "retry": "重试",
    "undo": "撤销",
    "close": "关闭",
    "cancel": "取消"
  },
  "auth": {
    "headline": "把任何数据库变成仪表盘。",
    "trust": "AGPL 核心 · 自托管 · 数据始终归你所有",
    "signIn": {
      "title": "欢迎回来",
      "subtitle": "登录你的 Adminium 工作区。",
      "email": "邮箱",
      "emailInvalid": "请输入有效的邮箱地址。",
      "password": "密码",
      "passwordRequired": "请输入密码。",
      "showPassword": "显示密码",
      "hidePassword": "隐藏密码",
      "remember": "保持登录状态",
      "forgot": "忘记了？",
      "submit": "登录",
      "invalid": "邮箱或密码不正确。",
      "rateLimited": "尝试次数过多——请一分钟后再试。",
      "failed": "登录失败。请检查网络连接后重试。"
    },
    "forgot": {
      "title": "重置密码",
      "email": "邮箱",
      "emailInvalid": "请输入有效的邮箱地址。",
      "submit": "发送重置链接",
      "sentTitle": "请查收邮件",
      "resend": "再发一次",
      "back": "返回登录",
      "done": "返回登录",
      "rateLimited": "请求过多——请稍后再试。",
      "failed": "出错了。请重试。",
      "smtpUnconfigured": "此 Adminium 未配置邮件服务器，无法发送重置链接。请让管理员为你重置密码。"
    },
    "reset": {
      "title": "设置新密码",
      "subtitle": "至少 8 个字符。",
      "password": "新密码",
      "confirm": "确认密码",
      "showPassword": "显示密码",
      "hidePassword": "隐藏密码",
      "strength": "密码强度",
      "weak": "弱",
      "fair": "一般",
      "good": "良好",
      "strong": "强",
      "tooShort": "请至少使用 8 个字符。",
      "submit": "重置密码",
      "failed": "重置失败。请重试。"
    },
    "otp": {
      "title": "双重验证",
      "subtitle": "请输入验证器应用中的 6 位数字验证码。",
      "code": "一次性验证码",
      "recoveryCode": "恢复代码",
      "useRecovery": "设备丢失？使用恢复代码",
      "useAuthenticator": "改用验证器应用",
      "submit": "验证",
      "invalid": "验证码不正确。请重试。",
      "failed": "验证失败。请检查网络连接后重试。"
    }
  },
  "nav": {
    "home": "首页",
    "primary": "主要",
    "account": "账户",
    "signOut": "退出登录",
    "empty": "连接数据库后，页面会显示在这里。",
    "connection": {
      "shared": "共享",
      "unnamed": "连接"
    }
  },
  "topbar": {
    "search": "搜索…",
    "notifications": "通知",
    "notificationsSoon": "通知功能将随通知中心一起推出（M7）。",
    "theme": "切换浅色 / 深色",
    "userMenu": "账户菜单",
    "profile": "个人资料",
    "preferences": "偏好设置",
    "signOut": "退出登录"
  },
  "palette": {
    "dialog": "命令面板",
    "placeholder": "输入命令或搜索…",
    "navigate": "导航",
    "actions": "操作",
    "askAi": "询问 AI",
    "shortcuts": "键盘快捷键",
    "signOut": "退出登录",
    "themeDark": "切换到深色主题",
    "themeLight": "切换到浅色主题",
    "footerNavigate": "导航",
    "footerOpen": "选择",
    "footerClose": "关闭"
  },
  "shortcuts": {
    "title": "键盘快捷键",
    "subtitle": "在 Adminium 中更高效地工作",
    "close": "关闭",
    "dismiss": "关闭或取消",
    "palette": "打开命令面板",
    "panel": "显示快捷键面板",
    "search": "聚焦搜索框",
    "sidebar": "切换侧边栏",
    "theme": "切换浅色 / 深色",
    "then": "然后",
    "footerPre": "随时按",
    "footerPost": "即可打开此面板。"
  },
  "states": {
    "checked": "8 秒前检查过",
    "diagnostics": "诊断"
  },
  "notFound": {
    "title": "页面不见了",
    "errorLine": "错误 404",
    "searchPlaceholder": "搜索页面…",
    "matches": "匹配的页面",
    "popular": "常用页面",
    "goBack": "返回",
    "backToDashboard": "回到仪表盘"
  },
  "page": {
    "invalid": {
      "title": "此页面的配置无效",
      "body": "存储的页面文档未通过校验，无法渲染。"
    },
    "renderError": {
      "title": "此页面渲染失败"
    },
    "tooNew": {
      "title": "此页面需要更新版本的 Adminium"
    },
    "unknownTemplate": {
      "title": "未知的页面模板"
    }
  },
  "mutation": {
    "created": "记录已创建",
    "updated": "记录已更新",
    "deleted": "记录已删除"
  },
  "undo": {
    "done": "更改已撤销",
    "failed": "无法撤销此更改"
  },
  "prefs": {
    "theme": {
      "label": "主题",
      "light": "浅色",
      "dark": "深色",
      "system": "跟随系统"
    },
    "accent": {
      "label": "强调色",
      "indigo": "靛蓝",
      "blue": "蓝色",
      "teal": "青色",
      "violet": "紫色",
      "rose": "玫红",
      "red": "红色",
      "orange": "橙色",
      "black": "黑色"
    },
    "density": {
      "label": "密度",
      "comfortable": "舒适",
      "compact": "紧凑"
    },
    "locale": {
      "label": "语言",
      "directionNote": "文字方向：从右到左（由语言自动设定）"
    }
  },
  "account": {
    "title": "账户",
    "stub": "个人资料与偏好设置页面将在 Wave B（09-T18）作为预置设置页面推出。",
    "name": "姓名",
    "email": "邮箱",
    "roles": "角色",
    "twoFactor": "双重验证",
    "on": "已启用",
    "off": "未启用",
    "preferences": {
      "title": "偏好设置",
      "subtitle": "Adminium 在你这里的外观与语言——在这台设备和你登录的每台设备上生效。",
      "workspaceDefault": "工作区默认",
      "personal": "个人",
      "usingDefault": "正在使用工作区默认值（{value}）",
      "reset": "恢复为工作区默认值",
      "resetFailed": "无法重置此偏好。请重试。",
      "appliesInstantly": "更改会立即生效，并保存到你的个人资料。"
    }
  },
  "settings": {
    "defaults": {
      "title": "全局默认值",
      "subtitle": "适用于整个工作区的外观与语言默认值。",
      "explainer": "这些默认值适用于所有未自行覆盖的用户。任何人都可以在「个人资料 → 偏好设置」中设置自己的偏好——对该用户而言，个人偏好始终优先。",
      "appearanceHeading": "外观默认值",
      "languageHeading": "语言与区域默认值",
      "adoption": "共 {total, plural, other {# 位用户}}，其中 {following, number} 位遵循此默认值。",
      "weekStartNote": "每周起始日与数字格式跟随所选语言。",
      "save": "保存默认值",
      "saved": "工作区默认值已更新",
      "saveFailed": "无法保存工作区默认值。请重试。",
      "liveNote": "保存后更改会实时推送——遵循默认值的在线用户无需刷新即可看到。"
    }
  },
  "studio": {
    "source": {
      "engine": {
        "label": "数据库引擎",
        "postgres": "PostgreSQL",
        "mysql": "MySQL / MariaDB",
        "sqlite": "SQLite"
      },
      "format": {
        "label": "架构格式",
        "helper": "除非自动检测出错，否则保持自动检测即可。",
        "auto": "自动检测",
        "sql": "SQL DDL / pg_dump",
        "prisma": "Prisma 架构",
        "drizzle": "Drizzle ORM",
        "typeorm": "TypeORM 实体",
        "sequelize": "Sequelize 模型",
        "rails": "Rails schema.rb",
        "django": "Django models.py",
        "json": "Adminium JSON"
      },
      "sqlite": {
        "file": "数据库文件路径",
        "helper": "SQLite 是文件而非服务器——请填写运行 Adminium 的机器上的绝对路径。"
      },
      "file": {
        "detectedAs": "检测到：{format}",
        "moreWarnings": "另有 {count} 条警告——完整列表将在分析步骤中显示。"
      }
    },
    "capability": {
      "mysqlApproxRows": "MySQL 的行数来自存储引擎估算（偏差可达 ±40%），以 ≈ 显示。",
      "mysqlFkEnum": "MySQL 的外键/枚举元数据较弱：MyISAM 表不声明外键，枚举是按列的 enum(…) 类型，CHECK 约束需要 MySQL 8.0.16+ / MariaDB 10.2+。",
      "sqliteCheckEnums": "SQLite 没有原生枚举类型——枚举由 CHECK (col IN (…)) 约束合成。",
      "sqliteNoComments": "SQLite 不支持列注释——请在架构重映射编辑器中添加标签。",
      "importNoRowCounts": "架构文件不包含行数——表格列表显示 — 而不是编造的数字。",
      "importNoLiveHealth": "没有实时数据库连接——此来源无法进行健康检查和架构漂移检测。",
      "rowsUnavailable": "架构文件没有实时数据库——在连接数据库之前行数未知。",
      "rowsRunAnalyze": "尚无估算——请在数据库上运行 ANALYZE 以获取行数。",
      "rowsNoEstimate": "引擎未报告此表的行数估算。",
      "rowsApproximate": "存储引擎估算——在 InnoDB 上偏差可达 ±40%。"
    },
    "test": {
      "log": {
        "moreWarnings": "另有 {count} 条解析器警告"
      }
    },
    "tables": {
      "importNoCounts": "架构文件不包含行数——在连接实时数据库之前，该列显示 —。"
    },
    "hub": {
      "title": "数据连接",
      "subtitle": "{total, plural, other {# 个连接中 {healthy, number} 个}}状态正常",
      "connectNew": "新建连接",
      "stats": {
        "connections": "连接",
        "healthy": "正常",
        "tables": "已包含的表",
        "pages": "已生成的页面"
      },
      "status": {
        "connected": "已连接",
        "error": "错误",
        "unconfigured": "草稿",
        "testing": "测试中…"
      },
      "card": {
        "readOnly": "只读",
        "tables": "表",
        "pages": "页面",
        "latency": "延迟",
        "latencyMs": "{latency, number} 毫秒",
        "lastIntrospected": "上次内省",
        "never": "从未"
      },
      "action": {
        "test": "测试",
        "reintrospect": "重新内省",
        "reintrospectFile": "架构文件来源没有在线数据库——请改为重新上传文件。",
        "remap": "重映射架构",
        "delete": "删除"
      },
      "test": {
        "ok": "连接正常 · {latency, number} 毫秒",
        "failed": "连接测试失败"
      },
      "introspect": {
        "noChanges": "架构无变化——未创建新快照。",
        "updated": "已重新内省架构",
        "masksProposed": "{count, plural, other {建议对 # 列进行脱敏}}——请在重映射编辑器中查看。",
        "failed": "内省失败，请重试。"
      },
      "delete": {
        "title": "删除连接",
        "body": "此操作将删除“{name}”及其生成的页面。您的数据库本身不会被改动。",
        "prompt": "输入 {name} 以确认",
        "confirm": "删除连接",
        "cancel": "取消",
        "close": "关闭",
        "success": "连接“{name}”已删除",
        "failed": "无法删除连接，请重试。"
      },
      "empty": {
        "title": "还没有数据源",
        "body": "连接数据库后，Adminium 会根据其架构生成您的管理面板。",
        "cta": "连接数据库"
      }
    },
    "settingsHub": {
      "title": "工作区设置",
      "subtitle": "此工作区的标识、安全与危险操作。",
      "save": "保存更改",
      "saved": "工作区设置已更新",
      "saveFailed": "无法保存工作区设置，请重试。",
      "superAdminOnlyTitle": "需要超级管理员",
      "superAdminOnly": "只有超级管理员才能更改工作区标识和安全设置。",
      "identity": {
        "heading": "工作区标识",
        "appName": {
          "label": "应用名称",
          "helper": "显示在侧边栏、浏览器标题和邮件中。",
          "error": "请输入不超过 60 个字符的名称。"
        }
      },
      "security": {
        "heading": "安全",
        "require2fa": {
          "label": "强制双重验证",
          "desc": "每位成员都必须启用双重验证才能登录。"
        },
        "allowSignup": {
          "label": "允许自助注册",
          "desc": "任何人都可以创建账户——关闭后此工作区仅限邀请。"
        },
        "sessionTtl": {
          "label": "会话有效期（小时）",
          "error": "介于 {min, number} 到 {max, number} 小时之间。"
        },
        "passwordMin": {
          "label": "密码最小长度",
          "error": "介于 {min, number} 到 {max, number} 个字符之间。"
        }
      },
      "review": {
        "title": "保存工作区设置",
        "subtitle": "保存前请确认您的更改。",
        "confirm": "保存更改",
        "cancel": "取消",
        "close": "关闭",
        "on": "开",
        "off": "关",
        "change": "{before} → {after}"
      },
      "defaultsCard": {
        "heading": "外观与语言默认值",
        "body": "工作区级的主题、强调色、密度和语言设置位于全局默认值中。",
        "cta": "打开全局默认值"
      },
      "danger": {
        "heading": "危险区域",
        "subtitle": "不可逆的操作。",
        "empty": "没有可删除的内容——还没有连接。",
        "deleteDesc": "删除该连接及其生成的页面。您的数据库不会被改动。此操作无法撤销。",
        "deleteCta": "删除连接"
      },
      "aiCard": {
        "heading": "AI 增强",
        "body": "配置 AI 提供方（或复制粘贴往返）来增强标签、分组和关系。",
        "cta": "打开 AI 设置"
      }
    },
    "settingsAi": {
      "title": "AI 增强",
      "subtitle": "连接一个模型，让 Adminium 建议标签、分组、关系等——在应用之前始终以差异形式审阅。",
      "saved": "AI 提供方已保存",
      "saveFailed": "无法保存 AI 提供方。请重试。",
      "save": "保存提供方",
      "test": "测试连接",
      "testHintDirty": "测试前请先保存更改。",
      "testing": "正在连接提供方…",
      "testError": "测试失败",
      "testErrorBody": "无法连接到提供方。请检查密钥和基础 URL。",
      "testOk": "已连接到 {model}，用时 {latency} 毫秒",
      "testUnknownModel": "提供方",
      "provider": {
        "heading": "AI 提供方",
        "subtitle": "选择 Adminium 如何访问模型来增强你的架构。密钥将加密存储且不再显示。",
        "active": "使用中",
        "anthropic": {
          "label": "Anthropic",
          "desc": "通过 Anthropic API 使用 Claude 模型。"
        },
        "openai": {
          "label": "OpenAI",
          "desc": "通过 OpenAI API 使用 GPT 模型。"
        },
        "openaiCompatible": {
          "label": "兼容 OpenAI",
          "desc": "任何使用 OpenAI 协议的端点——Groq、Together、vLLM、LM Studio。"
        },
        "ollama": {
          "label": "Ollama（本地）",
          "desc": "通过 Ollama 在本地运行模型——无需密钥，无需云端。"
        },
        "requiresNetwork": "需要联网和 API 密钥",
        "networkDisabledTitle": "此安装已关闭直连 AI 服务商",
        "networkDisabledBody": "此 Adminium 配置为无出站网络访问，无法连接服务商 API。请使用下方的复制粘贴往返方式——无需密钥，也无需联网。"
      },
      "configure": {
        "heading": "配置 {provider}"
      },
      "field": {
        "baseUrl": "基础 URL",
        "baseUrlOptional": "除非 Ollama 运行在其他主机上，否则保持不变。",
        "baseUrlHelper": "提供 /chat/completions 的端点根地址。",
        "model": "模型",
        "modelFreeText": "输入你的端点所提供的确切模型 ID。",
        "modelLive": "已从提供方实时加载。",
        "modelStatic": "一份经过验证的列表；保存后输入自定义 ID 可刷新它。",
        "modelLoading": "加载中…",
        "modelPlaceholder": "选择一个模型…",
        "key": "API 密钥",
        "keyStored": "已加密存储。替换它以使用其他密钥。",
        "keyMask": "sk-…{last4}",
        "keyReplace": "替换密钥",
        "keyOptional": "可选——某些端点无需密钥。",
        "keyWriteOnly": "仅写入：保存后将不再显示。",
        "noKeyTitle": "无需 API 密钥",
        "noKeyBody": "Ollama 在本地运行，因此没有任何内容离开这台机器。"
      },
      "runStatus": {
        "draft": "草稿",
        "running": "运行中",
        "awaitingResponse": "等待响应",
        "validated": "已验证",
        "applied": "已应用",
        "partiallyApplied": "部分应用",
        "failed": "失败",
        "discarded": "已丢弃"
      },
      "byo": {
        "heading": "没有密钥？使用你自己的 AI 工具",
        "subtitle": "复制粘贴往返——没有任何内容离开这台机器。",
        "body": "Studio 可以根据你的架构生成一个自包含的提示词。在 Claude Code、ChatGPT 或任意工具中运行它，然后将返回的 JSON 粘贴回连接向导。验证、审阅和结果都与直连方式相同。",
        "guaranteeTitle": "无遥测保证",
        "guarantee1": "提示词仅包含你的架构和聚合统计——默认绝不包含行数据。",
        "guarantee2": "不嵌入任何凭据、实例 URL 或标识符。",
        "guarantee3": "BYO 运行不进行任何网络调用，也绝不计费。",
        "promptVersion": "提示词 {version}",
        "schemaVersion": "架构 {version}",
        "headingRecommended": "使用你自己的 AI 工具——无需密钥",
        "recommended": "推荐"
      },
      "history": {
        "heading": "运行历史",
        "subtitle": "过往的增强运行。打开其中一个以审阅其建议。",
        "tableLabel": "增强运行",
        "colDate": "日期",
        "colSource": "来源",
        "colStatus": "状态",
        "colChunks": "分块",
        "openReview": "打开 {date} 的运行审阅",
        "connection": "连接",
        "empty": "暂无增强运行。在连接向导中增强架构后，历史将显示在这里。",
        "errorTitle": "无法加载运行",
        "errorBody": "刷新页面以重试。",
        "noConnections": "请先连接数据库——增强运行按连接记录。",
        "byo": "BYO",
        "directPath": "直连"
      }
    },
    "enrich": {
      "title": "使用 AI 丰富",
      "subtitle": "可选择使用 LLM 优化生成的标签、分组、枚举和仪表板。启发式基线无需它即可工作——这仅添加供你在应用前审阅的建议。",
      "intentLabel": "你希望如何丰富？",
      "sectionsLegend": "应由 AI 决定哪些内容？",
      "localesLegend": "将标签翻译为",
      "localeLocked": "（必填）",
      "samplingTitle": "包含示例值",
      "samplingHint": "在提示中为每个非 PII 列最多包含 20 个真实值。",
      "samplingPreviewTitle": "离开此机器的内容",
      "samplingPreviewBody": "每个非 PII 列最多 20 个最常见值，以及数值和日期列的最小/最大值。标记为 PII 的列永不采样。其余所有内容仅保留聚合值。复制前请审阅确切的提示（BYO）——未经你的操作不会发送任何内容。",
      "noSections": "请至少选择一个要丰富的决策组。",
      "generatePrompt": "生成提示",
      "startProvider": "开始丰富",
      "startOver": "重新开始",
      "copied": "已复制",
      "createFailed": "无法构建丰富提示——请重试。",
      "createFailedTitle": "无法启动",
      "providerFallback": "你的 AI 提供商",
      "fileTitle": "AI 丰富需要一个在线数据库",
      "fileBody": "架构文件来源尚无可丰富的快照。连接一个在线数据库以使用 AI 丰富，或继续——启发式基线仍会生成完整的应用。",
      "section": {
        "labels": "标签与描述",
        "groups": "导航分组",
        "enums": "枚举语义",
        "relations": "关系",
        "keys": "关键列",
        "templates": "页面模板",
        "widgets": "仪表板小组件",
        "pii": "PII 与脱敏",
        "icons": "图标",
        "microcopy": "微文案"
      },
      "provider": {
        "title": "使用我的 AI 提供商",
        "description": "立即使用已配置的提供商运行丰富。你将以差异形式审阅每条建议。",
        "unconfigured": "尚未配置 AI 提供商——请在下方将提示复制到你自己的工具，或先配置一个提供商。",
        "settingsHint": "想直接运行吗？",
        "settingsLink": "在“设置 → AI”中配置提供商",
        "networkDisabled": "此 Adminium 无出站网络访问，无法连接服务商 API。请改用复制粘贴往返方式——同样的提示词，同样的审阅。"
      },
      "byo": {
        "cardTitle": "复制提示到我自己的 AI 工具",
        "cardDescription": "将一个自包含的提示复制到 Claude Code、ChatGPT 或任何工具——然后将 JSON 粘贴回来。无需密钥，不会自动将任何内容传出此机器。",
        "guidance": "在任意 AI 工具中运行——Claude Code、ChatGPT，皆可。将其返回的 JSON 粘贴到下方。",
        "promptLabel": "丰富提示",
        "promptLabelN": "丰富提示 第 {index} 个，共 {total} 个",
        "tokenChip": "≈ {tokens} 个 token",
        "copyPrompt": "复制提示",
        "copyPromptDone": "提示已复制",
        "download": "下载 .md",
        "chunkTabs": "提示分块",
        "chunkTab": "提示 {index}",
        "chunkValid": "分块 {index} 已验证",
        "pasteLabel": "粘贴 JSON 响应",
        "pastePlaceholder": "在此粘贴 JSON 响应…",
        "validate": "验证",
        "valid": "响应已验证",
        "mergedTitle": "全部 {count} 个分块已验证并合并",
        "mergedTitleSingle": "响应已验证",
        "mergedBody": "建议已准备好，可对照启发式基线进行审阅。",
        "errorsTitle": "验证发现 {count} 个问题",
        "copyErrors": "为你的 AI 工具复制错误",
        "copyErrorsDone": "错误已复制",
        "copyErrorsHint": "将其粘贴回你的 AI 工具以获取更正后的响应。",
        "droppedItems": "有 {count} 条建议在验证时被丢弃——审阅中显示其余内容。",
        "pendingTitle": "验证每个提示以继续",
        "pendingBody": "在上方粘贴 JSON 响应并验证，以继续进行审阅。",
        "pendingBodyChunked": "每个分块都必须先验证，建议才会合并。请粘贴并验证上方的每个提示。",
        "requestFailed": "无法连接服务器进行验证——请重试。",
        "continueReview": "继续审阅",
        "wholeDocument": "整个文档",
        "cardTitleRecommended": "把提示词复制到我自己的 AI 工具——推荐"
      },
      "direct": {
        "title": "正在使用 AI 丰富",
        "subtitle": "正在将你的架构发送至",
        "building": "正在构建提示…",
        "logLabel": "丰富日志",
        "cancel": "取消",
        "back": "返回选项",
        "retry": "重试",
        "done": "丰富完成——请审阅建议。",
        "continueReview": "继续审阅",
        "failed": "提供商运行失败。请检查你的 AI 设置并重试。",
        "jobFailed": "丰富运行未完成。",
        "startFailed": "无法启动运行——请重试。",
        "errorTitle": "丰富失败"
      },
      "skip": {
        "title": "跳过——仅使用启发式",
        "description": "从启发式基线生成。你之后可在“设置 → AI”中丰富——跳过绝不会受到惩罚。",
        "confirmTitle": "继续使用启发式",
        "confirmBody": "生成的应用将使用启发式的标签、分组和仪表板。继续生成——你可随时在“设置 → AI”中运行 AI 丰富。"
      }
    },
    "review": {
      "unavailableTitle": "审阅界面不可用",
      "unavailableBody": "此版本尚未包含增强审阅界面（06-T14）。它将随差异与应用流程一起推出。"
    },
    "llmRuns": {
      "review": {
        "header": {
          "title": "审查 AI 建议",
          "model": "模型",
          "snapshot": "快照",
          "byo": "自带",
          "pathDirect": "直接 API",
          "pathByo": "复制粘贴",
          "agree": "{n} 项一致",
          "conflict": "{n} 项冲突",
          "new": "{n} 项新增",
          "rejects": "{n} 项拒绝",
          "countsAria": "建议数量"
        },
        "bulk": {
          "thresholdLabel": "置信度阈值",
          "thresholdAria": "“全部接受”的置信度阈值",
          "acceptAll": "接受所有 ≥ {pct}%",
          "clear": "清除选择"
        },
        "section": {
          "selectAllAria": "全选 {group}",
          "acceptedCount": "已接受 {n} 项"
        },
        "group": {
          "labels": "标签与翻译",
          "navigation": "导航与领域",
          "enums": "枚举语义",
          "relations": "关系",
          "keys": "键列",
          "templates": "页面模板",
          "dashboards": "仪表盘与小组件",
          "pii": "个人信息与脱敏",
          "icons": "图标",
          "microcopy": "微文案"
        },
        "status": {
          "agree": "一致",
          "conflict": "冲突",
          "new": "新增",
          "heuristicOnly": "仅启发式",
          "rejects": "拒绝启发式",
          "locked": "已锁定"
        },
        "row": {
          "acceptAria": "接受 {target} 的{noun}建议",
          "keptEdited": "已保留——由您编辑",
          "rejectsCallout": "AI 拒绝了某项启发式决策——接受前请确认。",
          "showTranslations": "显示翻译",
          "hideTranslations": "隐藏翻译",
          "confidenceAria": "置信度 {pct}%",
          "noAi": "无 AI 建议"
        },
        "value": {
          "none": "无值",
          "absent": "无",
          "dash": "—",
          "display": "显示",
          "key": "键",
          "rank": "排名 {n}",
          "span": "跨度 {n}",
          "tableCount": "{n} 张表",
          "widgetCount": "{n} 个小组件",
          "enumWorkflow": "工作流",
          "enumCategory": "分类",
          "notPii": "非个人信息",
          "label": "标签",
          "description": "描述",
          "subtitle": "页面副标题",
          "headline": "空状态标题",
          "guidance": "空状态提示"
        },
        "apply": {
          "title": "应用 {n} 项建议",
          "subtitle": "这些更改将在一个事务中写入，并可撤销。",
          "empty": "未选择任何要应用的内容。",
          "confirm": "应用更改"
        },
        "footer": {
          "count": "已选择 {n} 项建议",
          "apply": "应用 {n} 项已接受的建议",
          "failed": "应用失败"
        },
        "toast": {
          "applied": "已应用 {n} 项建议",
          "appliedPartial": "已应用 {n} 项建议（部分已跳过）",
          "applyFailed": "无法应用建议",
          "undoFailed": "无法撤销此更改"
        },
        "error": {
          "title": "无法加载此运行"
        },
        "notReady": {
          "title": "此运行尚无可审查的建议",
          "body": "运行必须先通过验证，才能审查其建议。请先生成或粘贴响应。"
        },
        "applied": {
          "title": "此运行已应用",
          "body": "下方已接受的建议为只读。"
        },
        "empty": {
          "title": "无建议",
          "body": "此运行未生成可审查的建议。"
        },
        "cat": {
          "label": "标签",
          "key": "键列",
          "enum": "枚举",
          "relation": "关系",
          "pii": "个人信息",
          "template": "页面模板",
          "group": "导航分组",
          "dashboard": "仪表盘",
          "widget": "小组件",
          "copy": "微文案"
        }
      }
    }
  },
  "onboarding": {
    "title": "开始使用",
    "subtitle": "几个步骤，让你的工作区准备就绪。",
    "loading": "正在加载设置清单…",
    "welcome": "欢迎使用 Adminium，{name} 👋",
    "progressBody": "你已完成 {total} 个设置步骤中的 {done} 个。完成其余步骤以解锁完整工作区。",
    "completeBody": "全部就绪 — 你的工作区已完全配置。",
    "ringLabel": "已完成 {total} 个步骤中的 {done} 个",
    "done": "完成",
    "skip": "暂时跳过",
    "goToWorkspace": "前往工作区",
    "help": {
      "title": "需要帮助？",
      "body": "我们随时帮助你快速完成设置。"
    },
    "steps": {
      "connectDatabase": {
        "title": "连接数据库",
        "desc": "将 Adminium 指向你的 Postgres、MySQL 或 SQLite — 只读角色也可以。",
        "time": "5 分钟",
        "action": "连接"
      },
      "chooseTables": {
        "title": "选择你的表",
        "desc": "选择哪些表成为页面 — 个人信息默认已脱敏。",
        "time": "2 分钟",
        "action": "选择"
      },
      "inviteTeammates": {
        "title": "邀请团队成员",
        "desc": "邀请团队一起探索和协作。",
        "time": "2 分钟",
        "action": "邀请"
      },
      "workspaceDefaults": {
        "title": "设置工作区默认值",
        "desc": "为所有人设置主题、强调色、密度和语言。",
        "time": "1 分钟",
        "action": "设置"
      }
    },
    "entry": {
      "wayBack": "开始使用 · {done}/{total}",
      "dismiss": "隐藏设置清单",
      "continue": "继续设置",
      "banner": "完成工作区设置 — 已完成 {total} 个步骤中的 {done} 个。"
    }
  },
  "views": {
    "baseView": "全部记录",
    "menuLabel": "已保存视图",
    "saveAs": "将当前保存为视图…",
    "updateActive": "更新“{name}”",
    "rename": "重命名…",
    "setDefault": "设为默认",
    "delete": "删除…",
    "saveTitle": "保存视图",
    "save": "保存视图",
    "renameTitle": "重命名视图",
    "saveName": "保存名称",
    "nameLabel": "视图名称",
    "namePlaceholder": "例如：本月活跃",
    "nameRequired": "请输入此视图的名称。",
    "saveFailed": "无法保存视图。",
    "deleteTitle": "删除视图",
    "deleteBody": "这将移除已保存的视图。你的数据不受影响。",
    "deletePrompt": "输入视图名称以确认",
    "deleteConfirm": "删除视图",
    "savedToast": "视图“{name}”已保存。",
    "updatedToast": "视图“{name}”已更新。",
    "defaultToast": "“{name}”现在是默认视图。",
    "deletedToast": "视图“{name}”已删除。"
  },
  "builder": {
    "view": "查看",
    "edit": "编辑",
    "done": "完成",
    "addWidget": "添加小组件",
    "saveLayout": "保存布局",
    "saving": "正在保存…",
    "savedShort": "已保存",
    "options": "仪表盘选项",
    "resetLayout": "重置布局",
    "resetTitle": "重置为共享布局？",
    "resetBody": "这将移除你的个人更改并恢复所有人看到的仪表盘。你的数据不受影响。",
    "resetConfirm": "重置布局",
    "resetDone": "布局已重置为共享默认值。",
    "sharedNote": "你正在编辑所有人都能看到的共享仪表盘。",
    "personalNote": "你正在编辑个人布局——只有你能看到这些更改。",
    "savedShared": "仪表盘已为所有有权限的人保存。",
    "empty": "此仪表盘尚无任何小组件。",
    "emptyAction": "添加小组件",
    "palette": {
      "title": "添加小组件",
      "count": "{count} 个小组件",
      "searchLabel": "搜索小组件",
      "searchPlaceholder": "搜索小组件…",
      "clear": "清除搜索",
      "noResults": "没有小组件匹配“{query}”。",
      "add": "添加 {name}",
      "added": "已添加 {name}。"
    },
    "inspector": {
      "title": "配置小组件",
      "empty": "此小组件没有可配置的选项。",
      "locked": "已锁定",
      "lockedHint": "此字段由数据源设置，无法在此处编辑。",
      "selectPlaceholder": "选择…",
      "increment": "增加",
      "decrement": "减少",
      "done": "完成"
    },
    "item": {
      "configure": "配置 {name}",
      "duplicate": "复制 {name}",
      "remove": "移除 {name}",
      "removed": "已移除 {name}。",
      "duplicated": "已复制 {name}。"
    },
    "families": {
      "kpi": "关键指标",
      "charts": "图表",
      "tables": "表格",
      "feeds": "动态",
      "calendar": "日历",
      "boards": "看板",
      "geo": "地图",
      "media": "媒体",
      "communication": "沟通",
      "forms": "表单",
      "chrome": "导航",
      "system": "系统",
      "domain": "领域"
    }
  },
  "setup": {
    "title": "设置 Adminium",
    "subtitle": "创建第一位管理员。此操作只进行一次。",
    "progress": "设置进度",
    "steps": {
      "account": "管理员账户",
      "consent": "隐私"
    },
    "account": {
      "name": "你的姓名",
      "email": "邮箱",
      "emailInvalid": "请输入有效的邮箱地址。",
      "password": "密码",
      "passwordHelper": "至少 {min} 个字符。",
      "passwordTooShort": "请至少使用 {min} 个字符。",
      "confirm": "确认密码",
      "passwordMismatch": "两次输入的密码不一致。",
      "continue": "继续",
      "strength": "密码强度",
      "strengthLevels": {
        "weak": "弱",
        "fair": "一般",
        "good": "良好",
        "strong": "强"
      }
    },
    "consent": {
      "telemetry": {
        "title": "共享匿名使用数据",
        "description": "帮助我们了解应优先支持哪些数据库引擎。默认关闭，除非你主动开启。"
      },
      "updates": {
        "title": "检查新版本",
        "description": "当有新版本（包括安全修复）可用时显示提示。这会向 GitHub 查询最新发行版，因而会向 GitHub 暴露本实例的 IP 地址和版本。除此之外不会发送任何内容。"
      },
      "sentTitle": "发送的内容仅限于：",
      "sent": {
        "instanceId": "一个随机实例 ID（在本地生成的 UUID；不由你的姓名、主机或数据库推导而来）",
        "version": "本实例运行的 Adminium 版本",
        "engines": "已连接的数据库引擎类型（例如 “postgres”）——仅类型"
      },
      "neverTitle": "绝不发送：",
      "never": {
        "schema": "你的表结构——不含任何表名、列名或枚举名",
        "rows": "你的数据——从不发送任何一行",
        "connections": "连接字符串、主机名或凭据",
        "people": "用户的邮箱、姓名或 ID",
        "llm": "AI 提示词或运行内容"
      },
      "reversible": "两项默认均为关闭，之后你可以随时在“设置”中更改。",
      "back": "返回",
      "finish": "创建管理员账户"
    },
    "error": {
      "alreadyCompleted": "本实例已完成设置。请使用现有的管理员账户登录。",
      "rejected": "服务器拒绝了这些信息。请检查邮箱和密码后重试。",
      "failed": "设置失败。请检查网络连接后重试。"
    }
  },
  "about": {
    "title": "关于 Adminium",
    "subtitle": "版本、许可证，以及本实例源代码的位置。",
    "version": "版本",
    "license": "许可证",
    "metaStore": "元数据存储",
    "node": "Node.js",
    "engine": {
      "postgres": "PostgreSQL",
      "mysql": "MySQL / MariaDB",
      "sqlite": "SQLite"
    },
    "licenseCard": {
      "title": "自由与开源",
      "body": "Adminium 基于 GNU Affero 通用公共许可证 v3.0 授权。你可以自由地运行、研究、修改和分享它。如果你通过网络向他人提供修改后的版本，AGPL 要求你同样向他们提供其源代码。"
    },
    "viewLicense": "阅读许可证",
    "viewSource": "获取源代码",
    "updates": {
      "title": "更新",
      "description": "本实例是否检查新版本。"
    },
    "update": {
      "disabled": "更新检查已关闭，因此本实例从不联系 GitHub。可在“设置”中开启以获知新版本。",
      "current": "你正在使用最新版本。",
      "available": "Adminium {version} 已发布",
      "availableBody": "你当前运行的是 {version}。",
      "viewRelease": "查看发行说明"
    }
  },
  "apiKeys": {
    "title": "API 密钥与令牌",
    "subtitle": "管理对工作区的程序化访问。",
    "createButton": "创建密钥",
    "copy": "复制",
    "copied": "已复制",
    "revoke": "吊销密钥",
    "neverUsed": "从未使用",
    "lastUsed": "上次使用于 {since}",
    "scopesOverflow": "另有 {count} 项",
    "status": {
      "active": "有效",
      "revoked": "已吊销",
      "expired": "已过期"
    },
    "list": {
      "title": "密钥",
      "activeCount": "{count, plural, other {# 个有效密钥}}"
    },
    "empty": {
      "title": "尚无 API 密钥",
      "body": "创建一个，即可在自己的代码中调用 Adminium API。"
    },
    "revealed": {
      "title": "新密钥已创建",
      "body": "请立即复制 —— 之后将无法再次查看。"
    },
    "rolesUnavailable": {
      "title": "你无权查看角色",
      "body": "创建密钥需要选择它所代表的角色，而你的账号无法读取角色列表。请向管理员申请“管理角色”权限。"
    },
    "quickStart": {
      "title": "快速开始",
      "body": "在 Authorization 请求头中携带密钥完成鉴权。"
    },
    "create": {
      "title": "创建 API 密钥",
      "description": "该密钥将以你所选角色的权限运行。",
      "name": "名称",
      "namePlaceholder": "例如：分析数据管道",
      "role": "角色",
      "roleHelper": "选择能完成任务的最小权限角色。",
      "expires": "过期时间",
      "expiresHelper": "留空表示密钥永不过期。",
      "submit": "创建密钥",
      "failed": "无法创建密钥"
    },
    "revokeConfirm": {
      "title": "吊销 API 密钥",
      "body": "任何仍在使用“{name}”调用 API 的代码将立即失败。此操作无法撤销。",
      "prompt": "输入“{name}”以确认",
      "confirm": "吊销密钥"
    }
  },
  "changelog": {
    "title": "更新日志",
    "subtitle": "产品更新与版本发布。",
    "allReleases": "全部版本",
    "tag": {
      "new": "新增",
      "improved": "改进",
      "fixed": "修复",
      "security": "安全"
    },
    "filter": {
      "all": "全部",
      "label": "按类型筛选变更"
    },
    "empty": {
      "title": "该筛选下暂无内容",
      "body": "还没有版本包含此类变更。",
      "clear": "显示全部变更"
    }
  },
  "kb": {
    "title": "知识库",
    "subtitle": "{count, plural, other {# 篇指南}} · 完整文档见 docs.adminium.ai",
    "openDocs": "打开文档",
    "browse": "按主题浏览",
    "hero": {
      "title": "需要什么帮助？",
      "subtitle": "搜索指南、API 文档与故障排查。",
      "placeholder": "搜索知识库…",
      "label": "搜索知识库",
      "clear": "清除搜索"
    },
    "category": {
      "start": "入门",
      "connect": "连接数据",
      "api": "API 与开发",
      "security": "安全与访问",
      "selfhost": "自托管",
      "trouble": "故障排查",
      "count": "{count, plural, other {# 篇文章}}",
      "selected": "筛选中"
    },
    "list": {
      "all": "全部指南",
      "clear": "清除筛选"
    },
    "empty": {
      "title": "没有匹配的指南",
      "body": "换个关键词，或前往 docs.adminium.ai 搜索完整文档。",
      "openDocs": "打开文档"
    },
    "article": {
      "install": {
        "title": "安装 Adminium",
        "excerpt": "运行 npx adminium 或 docker run，一分钟内进入首次运行向导。"
      },
      "firstAdmin": {
        "title": "创建第一位超级管理员",
        "excerpt": "首次运行向导会询问什么，以及它为何只能运行一次。"
      },
      "connectDb": {
        "title": "连接你的第一个数据库",
        "excerpt": "将 Adminium 指向 PostgreSQL、MySQL 或 SQLite，生成后台管理应用。"
      },
      "schemaFile": {
        "title": "从模式文件生成",
        "excerpt": "上传 Prisma schema、Django models.py、Rails schema.rb 或 .sql 转储 —— 无需数据库连接。"
      },
      "readOnly": {
        "title": "使用只读角色",
        "excerpt": "内省仅读取模式元数据。请只授予 Adminium 必需的最小权限。"
      },
      "apiKeys": {
        "title": "使用 API 密钥鉴权",
        "excerpt": "创建与吊销密钥，以及密钥为何只向你展示一次。"
      },
      "rest": {
        "title": "REST API 参考",
        "excerpt": "生成应用暴露的每个端点，含请求与响应结构。"
      },
      "manifest": {
        "title": "页面清单",
        "excerpt": "页面如何以配置描述，以及如何手工编辑。"
      },
      "roles": {
        "title": "角色与权限",
        "excerpt": "分配查看者、编辑者与管理员，并用权限矩阵自建角色。"
      },
      "audit": {
        "title": "阅读审计日志",
        "excerpt": "谁在何时、从何处更改了什么。"
      },
      "secrets": {
        "title": "Adminium 如何保存你的机密",
        "excerpt": "连接凭据使用 ADMINIUM_SECRET 加密存储，API 密钥则以哈希保存。"
      },
      "docker": {
        "title": "使用 Docker 自托管",
        "excerpt": "官方镜像、docker-compose，以及独立元数据库的运行方式。"
      },
      "backup": {
        "title": "备份与迁移实例",
        "excerpt": "export-zip 打包服务器配置；导入后可在别处重放同一套设置。"
      },
      "telemetry": {
        "title": "遥测与更新检查",
        "excerpt": "两者均为选择性开启，默认关闭。开启后会发送哪些内容。"
      },
      "connectionFails": {
        "title": "数据库连接失败",
        "excerpt": "查看诊断卡片：主机、端口、TLS，以及数据库需放行的 IP。"
      },
      "missingTables": {
        "title": "内省后缺少表",
        "excerpt": "模式可见性、被排除的表，以及重新运行生成。"
      }
    }
  },
  "desktop": {
    "settings": {
      "explainer": "这些设置仅适用于这台电脑上的 Adminium 应用，保存在本机，不会保存到你的工作区。"
    },
    "security": {
      "heading": "登录"
    },
    "requireLogin": {
      "label": "在此设备上要求登录",
      "description": "Adminium 通常会在这台电脑上自动登录。开启后，每次启动都会要求输入密码——如果其他人也能使用这台电脑，建议开启。该设置将在下次打开 Adminium 时生效。",
      "savedOn": "下次启动时需要登录",
      "savedOff": "Adminium 将在这台电脑上跳过登录",
      "saveFailed": "无法保存该设置，请重试。"
    },
    "chip": {
      "local": "本地",
      "lanShare": "本地 · 已在局域网共享",
      "remoteDb": "本地 + 远程数据库",
      "remoteDbOffline": "远程数据库离线",
      "remoteDbOfflineDetail": "无法连接 {names}。这些连接的页面会显示重新连接状态。"
    },
    "lan": {
      "heading": "在局域网中共享",
      "label": "允许此网络中的其他设备使用 Adminium",
      "description": "同一网络中的其他电脑、平板和手机可以在浏览器中打开 Adminium，并用各自的账户登录。Adminium 必须在这台电脑上保持打开，他们才能访问。",
      "savedOn": "正在局域网中共享",
      "savedOff": "已停止共享 — Adminium 恢复为仅限这台电脑",
      "saveFailed": "无法更改网络共享",
      "noUsers": "目前只有你拥有账户，因此还没有其他人能登录。共享仍然可用 — 只是需要先邀请其他人才能使用。",
      "usersUnknown": "Adminium 无法检查这台电脑上还有谁拥有账户。共享仍然有效，任何拥有账户的人都可以登录——只有这项检查失败了。",
      "acknowledge": "我知道了 — 我接下来会邀请其他人",
      "port": "端口",
      "portHelper": "默认 {port}",
      "portInvalid": "请输入 1024 到 65535 之间的数字。",
      "applyPort": "更改端口",
      "portInUse": "端口 {port} 已被其他程序占用。",
      "portInUseHint": "未做任何更改 — 共享仍处于关闭状态。",
      "portInUseNoSuggestion": "未做任何更改。请尝试其他端口。",
      "tryPort": "尝试 {port}",
      "urlsHeading": "在其他设备上打开",
      "noUrls": "这台电脑当前未连接到网络，因此没有可共享的地址。连接 Wi-Fi 或插入网线后，此列表会自动填充。",
      "copyUrl": "复制",
      "sessions": "{count, plural, =0 {没有来自此网络的设备登录} other {已有 # 台设备从此网络登录}}",
      "sessionsUnknown": "正在检查已连接的设备…",
      "pending": "正在开始共享…",
      "mismatch": "Adminium 在此网络中仍可访问",
      "mismatchBody": "共享已关闭，但服务器尚未释放网络。请重启 Adminium 以关闭它。",
      "transportTitle": "局域网中的流量未加密。",
      "transportBody": "仅在你信任的网络中共享。如需远程访问，请使用置于 HTTPS 之后的 Adminium 自托管版本。",
      "firewall": "首次共享时，操作系统会询问是否允许传入连接 — 请选择\"允许\"，否则其他设备将无法访问 Adminium。"
    },
    "setup": {
      "title": "欢迎使用 Adminium",
      "subtitle": "只需四个简短步骤，Adminium 就能从你的数据库生成一个管理应用。所有内容都保留在这台电脑上。",
      "progress": "设置进度",
      "back": "上一步",
      "continue": "继续",
      "createAccount": "创建账户并继续",
      "step": {
        "location": "欢迎",
        "database": "你的第一个数据库",
        "account": "你的账户",
        "generate": "生成"
      },
      "dataDir": {
        "heading": "Adminium 应该把你的数据保存在哪里？",
        "description": "你的数据库、设置和备份都存放在这个文件夹中。所有内容都保留在这台电脑上——不会上传到任何地方。",
        "label": "数据文件夹",
        "loading": "正在读取当前位置…",
        "pending": "继续时 Adminium 会重启，以便切换到这个文件夹。",
        "change": "更改…",
        "revert": "撤销",
        "dialogTitle": "选择 Adminium 保存数据的位置",
        "cloudSyncTitle": "该文件夹会同步到云端",
        "cloudSyncWarning": "Adminium 将数据存储在 SQLite 文件中。{provider} 会在后台复制“{folder}”中的文件进行同步，这可能损坏正在打开的数据库——并在毫无提示的情况下丢失数据。请选择 {provider} 之外的文件夹。",
        "chooseAnother": "选择其他文件夹",
        "useAnyway": "仍然使用——我接受风险",
        "unusableTitle": "Adminium 无法使用该文件夹",
        "failed": "Adminium 无法使用该文件夹。"
      },
      "source": {
        "heading": "Adminium 应该基于什么来构建？",
        "description": "Adminium 会读取数据库的结构并据此生成管理应用。你之后可以添加更多数据库。",
        "groupLabel": "数据库来源",
        "local": {
          "title": "创建新的本地数据库",
          "description": "从零开始，或使用你已有的结构文件。数据库会创建在你的数据文件夹中。",
          "name": "数据库名称",
          "namePlaceholder": "运营",
          "nameUnusable": "请至少使用一个字母或数字——文件名由此生成。",
          "fileHelper": "将创建 {file}",
          "schemaLabel": "起始方式",
          "blank": "空白",
          "fromFile": "结构文件",
          "schemaFile": "结构文件",
          "schemaFileHelper": ".sql、pg_dump、Prisma、Drizzle、TypeORM、Sequelize、schema.rb、Django 或 Adminium JSON。Adminium 会将其转换为 SQLite。",
          "placeholder": "自动生成占位数据",
          "placeholderHelper": "你导入的结构没有数据行。为每个表填充逼真的示例数据，让仪表板和图表立刻能够呈现。"
        },
        "openSqlite": {
          "title": "打开现有的 SQLite 文件",
          "description": "让 Adminium 指向这台电脑上的 .sqlite 文件。文件会在原位打开——不会复制或移动。",
          "browse": "选择一个 .sqlite 文件…",
          "change": "选择其他文件…",
          "networkTitle": "该文件位于网络共享上",
          "networkBody": "SQLite 的锁机制在网络文件共享上并不可靠，写入过程中断开连接可能损坏数据库。复制到这台电脑本地磁盘上更安全。"
        },
        "remote": {
          "title": "连接到服务器数据库",
          "description": "PostgreSQL 或 MySQL。需要一个可访问的网络数据库；Adminium 自身的数据表仍然保留在这台电脑上。",
          "networkNote": "需要一个可访问的网络数据库",
          "metaNote": "无论如何，Adminium 自身的数据表——你的页面、设置和登录信息——都保留在这台电脑的数据文件夹中。",
          "engine": "引擎",
          "name": "连接名称",
          "namePlaceholder": "生产环境",
          "dsn": "连接字符串",
          "dsnHelper": "Adminium 会在连接时测试它。如果你只需要仪表板，请使用只读角色。"
        },
        "demo": {
          "title": "体验演示数据库",
          "description": "一个现成的团队运营数据库，让你在指向自己的数据之前先看看 Adminium 会构建出什么。你可以随时删除它。",
          "unavailable": "此版本不包含演示数据，因此没有可加载的内容。请选择上面的某个选项。"
        }
      },
      "account": {
        "heading": "创建你的账户",
        "description": "这是这份 Adminium 的管理员账户。密码用于保护你的备份以及你在网络上共享的对象——每次启动时不会向你索取密码。",
        "name": "你的姓名",
        "email": "邮箱",
        "password": "密码",
        "passwordHelper": "至少 {min} 个字符。",
        "confirm": "确认密码",
        "strength": "密码强度",
        "strengthLevels": {
          "weak": "弱",
          "fair": "一般",
          "good": "良好",
          "strong": "强"
        },
        "singleUser": "在这台电脑上跳过登录",
        "singleUserHelper": "在这里打开时，Adminium 会自动为你登录。如果其他人也使用这台机器，请关闭此项。你之后可以在 设置 → 桌面 中更改。",
        "locale": "语言",
        "theme": "外观",
        "alreadyExists": "这份 Adminium 已经有一个账户。请改用该账户登录。",
        "failed": "Adminium 无法创建该账户。"
      },
      "generate": {
        "creating": "正在设置你的数据库…",
        "introspecting": "正在读取你的结构——表、列和关系…",
        "working": "处理中…",
        "offlineNote": "这一切都在这台电脑上完成。",
        "failedTitle": "Adminium 无法设置该数据库",
        "failedBody": "出了点问题。请重试。",
        "retry": "重试"
      }
    }
  }
} as const;
