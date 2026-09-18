// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/studio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "addOns": {
    "browse": {
      "all": "全部",
      "bundled": "Included",
      "categories": "分类",
      "discard": "Discard",
      "download": "Download",
      "emptyBody": "This build shipped none, and the online catalogue is off.",
      "emptyOnlineBody": "在线目录已开启，但上次检查没有找到内容。试试检查更新。",
      "emptyTitle": "No add-ons available",
      "install": "Install",
      "noMatchBody": "没有插件符合该搜索和分类。",
      "noMatchTitle": "没有匹配项",
      "offline": "Showing the add-ons that came with this build. Browsing online is switched off, and nothing here has contacted the internet.",
      "online": "Includes add-ons from the online catalogue. Checking for newer versions is a separate action.",
      "refresh": "Check for newer",
      "search": "搜索插件",
      "title": "Available",
      "toggle": "Browse the online catalogue",
      "upgrade": "v{version} available",
      "upgradeAction": "Upgrade"
    },
    "card": {
      "needsApiKey": "需要 API 密钥",
      "needsOauth": "通过 OAuth 连接"
    },
    "category": {
      "artwork": "美工",
      "data": "数据",
      "delivery": "配送",
      "email": "邮件",
      "payments": "支付"
    },
    "confirm": {
      "cancel": "Cancel",
      "close": "Close",
      "discard": "Discard",
      "discardBody": "The downloaded files are deleted. Nothing was installed, so nothing else changes — you can download it again whenever you like.",
      "discardTitle": "Discard this download",
      "disconnect": "Disconnect",
      "disconnectBody": "Its keys are deleted and it stops making calls. Every table and every row it created stays exactly as it is, and you can reconnect at any time.",
      "disconnectTitle": "Disconnect this add-on",
      "uninstall": "Uninstall",
      "uninstallBody": "Its keys are deleted and its files are removed from this server. Every table and every row it created stays exactly as it is. You can install it again later.",
      "uninstallTitle": "Uninstall this add-on"
    },
    "connect": {
      "apiKey": "API key",
      "submit": "Connect"
    },
    "consent": {
      "cancel": "Cancel",
      "close": "Close",
      "confirm": "Install",
      "hosts": "Attach to",
      "loading": "Working out what this would do…",
      "subtitle": "What this add-on will do, before it can do it.",
      "title": "Install {name}"
    },
    "error": "Something went wrong",
    "installed": {
      "connected": "Connected",
      "disconnect": "Disconnect",
      "egress": "May contact: {hosts}",
      "emptyBody": "Install an add-on above and it will appear here with its hosts and connection.",
      "emptyTitle": "Nothing installed yet",
      "notConnected": "Not connected",
      "off": "off",
      "on": "on",
      "title": "Installed",
      "uninstall": "Uninstall"
    },
    "job": {
      "body": "Fetching and verifying. Nothing is installed until you say so.",
      "failed": "The download did not finish. Nothing was installed.",
      "title": "Downloading"
    },
    "plan": {
      "blocked": "This cannot be installed here",
      "needsColumns": "This add-on needs columns you do not have",
      "needsColumnsBody": "Adminium will not add columns to tables you already own. Add them yourself, then install.",
      "noData": "This add-on reads and writes no tables of its own.",
      "reuse": "This add-on will use tables you already have:",
      "willCreate": "This will create tables in your database",
      "willCreateBody": "Installing creates these tables. Uninstalling later leaves them, and their data, alone."
    },
    "settings": {
      "badJson": "这不是有效的 JSON，因此未保存。",
      "save": "保存设置",
      "title": "设置"
    },
    "sideload": {
      "file": "Package file (.tgz)",
      "hint": "For a server with no internet. It is checked exactly as a download would be, so it needs the hash that came with it.",
      "sha": "Integrity (sha512-…)",
      "shaHint": "The sha512- fingerprint published with the release, shown beside its Download link on adminium.dev/marketplace. The upload is refused if the bytes do not match.",
      "submit": "Upload",
      "title": "Upload a package",
      "uploaded": {
        "title": "已上传 {name} {version}",
        "body": "请在上方列表中安装。"
      }
    },
    "subtitle": "Extra capabilities you can add to your apps — shipping, artwork, data. Each one says what it needs before you install it.",
    "title": "Add-ons",
    "upgradeNote": "Upgrading keeps the hosts an add-on is attached to and the connection it already has.",
    "veto": {
      "body": "The setting is saved, but network features are off for this server and that wins. Downloaded add-ons still work, and you can still upload one yourself.",
      "title": "This deployment cannot browse online"
    }
  },
  "capability": {
    "importNoLiveHealth": "没有实时数据库连接——此来源无法进行健康检查和架构漂移检测。",
    "importNoRowCounts": "架构文件不包含行数——表格列表显示 — 而不是编造的数字。",
    "mysqlApproxRows": "MySQL 的行数来自存储引擎估算（偏差可达 ±40%），以 ≈ 显示。",
    "mysqlFkEnum": "MySQL 的外键/枚举元数据较弱：MyISAM 表不声明外键，枚举是按列的 enum(…) 类型，CHECK 约束需要 MySQL 8.0.16+ / MariaDB 10.2+。",
    "rowsApproximate": "存储引擎估算——在 InnoDB 上偏差可达 ±40%。",
    "rowsNoEstimate": "引擎未报告此表的行数估算。",
    "rowsRunAnalyze": "尚无估算——请在数据库上运行 ANALYZE 以获取行数。",
    "rowsUnavailable": "架构文件没有实时数据库——在连接数据库之前行数未知。",
    "sqliteCheckEnums": "SQLite 没有原生枚举类型——枚举由 CHECK (col IN (…)) 约束合成。",
    "sqliteNoComments": "SQLite 不支持列注释——请在架构重映射编辑器中添加标签。"
  },
  "design": {
    "adopt": {
      "action": "添加到我的应用",
      "done": "新建 {created} 个页面，更新 {updated} 个，{unchanged} 个已是最新。",
      "everything": "此连接已显示所有表，因此无需再包含任何内容。",
      "forbidden": "你的角色可以修改架构，但不能生成页面。请让拥有连接管理权限的管理员把这些表添加到应用中。",
      "grants": "不会自动给任何角色授权——请在“设置 → 角色”中授予。",
      "offer": "新表在有页面之前不会起任何作用。要把 {tables} 添加到你的应用吗？",
      "skippedEdited": "因为你编辑过而保持原样：{pages}。"
    },
    "apply": "应用",
    "brokenEnumValues": "{columns} 的每个允许值都必须填写，并且互不相同。",
    "ceiling": {
      "authorise": "授权此次重写",
      "body": "{table} 有超过 {rows} 行——超出 Adminium 自行重写的规模。只有超级管理员可以授权，且重写期间该表将被锁定。",
      "hint": "请完全按照上方显示的名称输入表名。",
      "notYours": "{table} 有超过 {rows} 行。只有超级管理员能授权这么大的重写——请联系一位，或在维护窗口用你自己的工具执行。",
      "prompt": "再次输入 {table} 以授权重写"
    },
    "column": {
      "default": "初始值",
      "defaultValue": "值",
      "help": "这些设置是什么意思？",
      "length": "长度",
      "link": "关联到",
      "linkHelp": "将此关联到另一个表中的一行。",
      "linkTypeNote": "类型已与关联表的主键匹配。",
      "name": "名称",
      "namePlaceholder": "client_id",
      "noLink": "无",
      "onDelete": "当关联的行被删除时",
      "precision": "精度",
      "primaryKey": "主键",
      "remove": "移除 {name}",
      "required": "必填",
      "type": "类型",
      "unique": "唯一"
    },
    "confirm": {
      "body": "此更改会丢弃数据或移除对象。Adminium 无法撤销。",
      "cancel": "取消",
      "close": "关闭",
      "confirm": "应用更改",
      "prompt": "输入 {word} 以确认",
      "title": "应用破坏性更改"
    },
    "default": {
      "autoincrement": "在最后一行之后递增",
      "false": "否",
      "literal": "指定值",
      "none": "无",
      "now": "当前日期和时间",
      "true": "是",
      "uuid": "新的唯一 id"
    },
    "designer": "表设计器",
    "discard": "放弃更改",
    "discardTable": "放弃这个新表",
    "dropping": "已标记为删除",
    "empty": {
      "body": "创建一个表，或选择一个进行编辑。在你查看并应用这些语句之前，不会有任何内容写入你的数据库。",
      "title": "设计你的架构"
    },
    "error": {
      "atColumn": "第 {n} 列，{field}",
      "atTable": "表 {field}",
      "empty": "需要填写名称。",
      "identifier": "请使用小写字母、数字和下划线，并以字母开头。",
      "tooLong": "太长 — {dialect} 允许 {max} 个字符。"
    },
    "existing": "现有表",
    "hazard": {
      "irreversible": "无法撤销",
      "locking": "会持有锁",
      "lossy": "会丢弃数据",
      "refused": "已拒绝",
      "rewrite": "会重写表",
      "safe": "安全"
    },
    "help": {
      "close": "关闭",
      "default": {
        "example": "以当前日期和时间开始的“创建时间”字段无需手动填写，也不会填错。",
        "term": "初始值",
        "what": "没有人填写时字段里的内容。值由数据库自己写入，因此在 Adminium 之外创建的行也会被填上。"
      },
      "keyGeneration": {
        "example": "只有 PostgreSQL 能生成唯一 id 并立即返回，所以在其他引擎上主键采用递增。",
        "term": "主键如何填充",
        "what": "每行的 id 从哪里来。在最后一行之后递增会得到 1、2、3，适合大多数表；唯一 id 则是又长又随机，更难猜，也更难念出来。"
      },
      "link": {
        "example": "一条预订关联到一位客户。Adminium 随后会在预订上显示该客户，也会在客户上显示其预订记录。",
        "term": "关联到另一个表",
        "what": "把这一行关联到另一个表中的一行，并让数据库确保这层关联始终有效——你无法指向一个并不存在的东西。"
      },
      "primaryKey": {
        "example": "没有主键，Adminium 可以列出这些行，但无法编辑或删除其中的某一行。",
        "term": "主键",
        "what": "用来标识每一行的字段——Adminium 靠它来区分不同的行。每张表都应该恰好有一个，而且它几乎总是系统为你创建的 \"id\" 字段。"
      },
      "required": {
        "example": "订单必须有客户，所以那个字段是必填的。配送备注可填可不填，所以不是必填。",
        "term": "必填",
        "what": "这个字段必须填写。只要它是空的，这一行就无法保存。"
      },
      "subtitle": "用大白话说明每一项设置的作用，以及它会给使用你应用的人带来什么变化。",
      "title": "这些字段的含义",
      "type": {
        "example": "电话号码通常是文字，而不是数字——数字会把开头的 0 丢掉。",
        "term": "类型",
        "what": "这个字段存放哪一类信息——文字、整数、金额、日期，或者是/否的答案。选对了类型，Adminium 才能显示日期选择器而不是文本框，也才能把一整列金额加起来。"
      },
      "unique": {
        "example": "两个客户不应该共用同一个邮箱地址——把它标记为唯一，他们就不可能共用了。",
        "term": "唯一",
        "what": "任何两行都不能存放相同的值。数据库会拒绝第二个。"
      },
      "values": {
        "example": "状态为新建、进行中或已完成。没人能打成“进行种”而意外多出第四种状态。",
        "term": "允许的值",
        "what": "这个字段接受的完整答案列表。其他内容数据库一律拒绝，Adminium 会把列表显示为按钮或菜单，而不是文本框。"
      }
    },
    "keepTable": "保留 {table}",
    "newTable": "新建表",
    "onDelete": {
      "cascade": "同时删除此行",
      "restrict": "阻止删除",
      "setNull": "将此字段留空"
    },
    "plan": "查看更改",
    "result": {
      "applied": "已应用。Adminium 已重新读取你的架构。",
      "failed": "未应用任何更改——你的数据库没有变化。{error}",
      "partial": "部分应用：{total} 个步骤中已执行 {done} 个。再次应用相同的更改即可完成。",
      "repaired": "重命名已同步到 {pages, plural, other {# 个页面}}、{grants, plural, other {# 项角色授权}}和 {overrides, plural, other {# 项架构覆盖}}。"
    },
    "review": {
      "noChanges": "尚无架构更改。",
      "pending": "查看你的更改，即可看到 Adminium 将执行的确切语句。",
      "steps": "计划的步骤",
      "superAdmin": "超级管理员",
      "unfinished": "此连接上先前的一次应用从未报告结果。它的架构可能停留在两种形态之间——在应用更多更改前请查看更改历史。"
    },
    "reviewPane": "审阅",
    "table": {
      "addColumn": "添加列",
      "columns": "列",
      "drop": "删除此表",
      "dropHelp": "该表及其中所有行都将被销毁。在执行任何操作前，您会看到具体会有什么受影响。",
      "keyCounted": "在最后一行之后递增",
      "keyGeneration": "主键如何填充",
      "keyGenerationHelp": "每次插入后，Adminium 通过这个主键读回新行。",
      "keyGenerationOne": "在 {dialect} 上，主键必须是递增整数：数据库生成的 id 在插入后无法读回。",
      "keyUnique": "新的唯一 id",
      "name": "表名",
      "nameHelp": "小写字母、数字和下划线。",
      "namePlaceholder": "reservations",
      "noKey": "此表没有主键，因此 Adminium 会将其视为只读——可以列出行，但无法编辑。",
      "renameHelp": "更改它会重命名你数据库中的表。"
    },
    "unnamed": "为每个表和列命名后才能查看更改。",
    "unrepresentableDefaults": "这些列保留由数据库生成的默认值，Adminium 无法在此编辑，将保持原样：{columns}",
    "valuelessEnum": "为 {columns} 至少设置一个允许的值，才能检查更改。",
    "values": {
      "add": "添加值",
      "addOnly": "这个列表是数据库中的一个类型，值一旦存在，Postgres 就无法删除或重命名。您仍然可以添加新值。",
      "down": "下移 {value}",
      "empty": "选择列至少需要一个值，才能检查此更改。",
      "label": "允许的值",
      "placeholder": "in_progress",
      "remove": "移除 {value}",
      "up": "上移 {value}",
      "value": "值 {n}"
    }
  },
  "diagram": {
    "ceiling": "正在显示关联最多的 {shown} 个表。另有 {omitted} 个被隐藏——搜索可将其调出。",
    "legend": {
      "declared": "外键",
      "inferred": "推断",
      "virtual": "在 Adminium 中添加"
    },
    "legendLabel": "图例",
    "node": {
      "foreignKey": "外键",
      "more": "还有 {count} 个",
      "primaryKey": "主键"
    },
    "outline": {
      "intro": "{tables} 个表与 {relations} 个关系，以列表呈现。",
      "more": " 以及另外 {count} 个",
      "referencedBy": "被引用于：{list}",
      "references": "引用：{list}"
    },
    "saveLayout": "保存布局",
    "search": "查找表或列",
    "showDiagram": "显示图表",
    "showList": "以列表显示"
  },
  "documents": {
    "cancel": "取消",
    "connectionLabel": "连接",
    "delete": "删除",
    "delivery": {
      "email": "发送给",
      "noEmail": "不发送——只留在记录上",
      "noEmailSlot": "这种单据没有地址字段，因此无法发送。",
      "noSmtp": "这套 Adminium 还没有设置邮件服务器，因此无法发送。请在 Studio → 设置 → 邮件中设置一个。",
      "stored": "始终留在记录上。"
    },
    "disabled": "已关闭",
    "edit": "编辑",
    "empty": "尚无映射。",
    "grants": {
      "refused": "这条映射会读取 {tables}，而你无权阅读。由它生成的单据对你会失败。",
      "title": "你无权阅读其中全部"
    },
    "intro": "一条映射说明哪张表的哪些列构成一种单据、由什么触发，以及去往何处。",
    "name": "为这条映射命名",
    "newFrom": "新建映射：",
    "noProvider": "尚无已安装的插件可以绘制单据。请先在“插件”中安装一个，可用的映射就会出现在这里。",
    "pickTable": "选择一张表…",
    "prefix": "编号前缀",
    "render": {
      "failedRow": "没有绘制出来：{reason}",
      "intro": "现在就从你选的一行数据绘制一份。不会发送到任何地方——它像其他单据一样留在记录上。",
      "noRows": "还没有可供绘制的数据行。",
      "open": "打开",
      "pending": "正在绘制…",
      "pick": "绘制这一行",
      "ready": "已绘制。",
      "saveFirst": "请先保存映射。单据是从已保存的映射绘制的，这样你能先于他人看到结果。",
      "search": "搜索数据行",
      "slow": "还没有单据出现。它可能仍在排队，也可能这套安装没有运行后台任务——不运行就不会绘制。",
      "slowTitle": "仍然没有"
    },
    "save": "保存映射",
    "slot": {
      "byDefault": "由 Adminium 填充",
      "lineColumnOf": "每条明细的 {column}",
      "lineColumns": "每一条明细的各列由什么填充",
      "looksLikeLines": "看起来像明细",
      "noChildren": "你的数据库中没有任何表指向这张表，因此没有明细可绘制。单据需要一张带外键指回本表的子表。",
      "noLines": "没有明细",
      "pii": "隐藏数据",
      "typed": "我填写的值",
      "typedHint": "在此填写，不从你的数据中读取——这条映射生成的每份单据都取同一个值。",
      "typedValue": "{slot} 的值",
      "unmapped": "不填充"
    },
    "step": {
      "delivery": "去往何处",
      "kind": "类型",
      "mapping": "各字段由什么填充",
      "mappingHelp": "每个字段读取一列，或者取用你在此填写的值。",
      "render": "在一行数据上试试",
      "table": "连接与表",
      "trigger": "由什么触发"
    },
    "tableLabel": "表",
    "title": "单据映射",
    "trigger": {
      "created": "新增一行时",
      "manual": "仅在有人请求时",
      "manualShort": "按请求",
      "note": "通过导入添加的行、或直接写入数据库的行不会触发任何绘制——只有经由 Adminium 的写入才会。",
      "noteTitle": "什么算作变更",
      "updated": "某行变更时"
    },
    "unbound": "仍需填写：{slots}"
  },
  "enrich": {
    "byo": {
      "cardDescription": "将一个自包含的提示复制到 Claude Code、ChatGPT 或任何工具——然后将 JSON 粘贴回来。无需密钥，不会自动将任何内容传出此机器。",
      "cardTitle": "复制提示到我自己的 AI 工具",
      "cardTitleRecommended": "把提示词复制到我自己的 AI 工具——推荐",
      "chunkTab": "提示 {index}",
      "chunkTabs": "提示分块",
      "chunkValid": "分块 {index} 已验证",
      "continueReview": "继续审阅",
      "copyErrors": "为你的 AI 工具复制错误",
      "copyErrorsDone": "错误已复制",
      "copyErrorsHint": "将其粘贴回你的 AI 工具以获取更正后的响应。",
      "copyPrompt": "复制提示",
      "copyPromptDone": "提示已复制",
      "download": "下载 .md",
      "droppedItems": "有 {count} 条建议在验证时被丢弃——审阅中显示其余内容。",
      "errorsTitle": "验证发现 {count} 个问题",
      "guidance": "在任意 AI 工具中运行——Claude Code、ChatGPT，皆可。将其返回的 JSON 粘贴到下方。",
      "mergedBody": "建议已准备好，可对照启发式基线进行审阅。",
      "mergedTitle": "全部 {count} 个分块已验证并合并",
      "mergedTitleSingle": "响应已验证",
      "pasteLabel": "粘贴 JSON 响应",
      "pastePlaceholder": "在此粘贴 JSON 响应…",
      "pendingBody": "在上方粘贴 JSON 响应并验证，以继续进行审阅。",
      "pendingBodyChunked": "每个分块都必须先验证，建议才会合并。请粘贴并验证上方的每个提示。",
      "pendingTitle": "验证每个提示以继续",
      "promptLabel": "丰富提示",
      "promptLabelN": "丰富提示 第 {index} 个，共 {total} 个",
      "requestFailed": "无法连接服务器进行验证——请重试。",
      "tokenChip": "≈ {tokens} 个 token",
      "valid": "响应已验证",
      "validate": "验证",
      "wholeDocument": "整个文档"
    },
    "copied": "已复制",
    "createFailed": "无法构建丰富提示——请重试。",
    "createFailedTitle": "无法启动",
    "direct": {
      "back": "返回选项",
      "building": "正在构建提示…",
      "cancel": "取消",
      "continueReview": "继续审阅",
      "done": "丰富完成——请审阅建议。",
      "errorTitle": "丰富失败",
      "failed": "提供商运行失败。请检查你的 AI 设置并重试。",
      "jobFailed": "丰富运行未完成。",
      "logLabel": "丰富日志",
      "retry": "重试",
      "startFailed": "无法启动运行——请重试。",
      "subtitle": "正在将你的架构发送至",
      "title": "正在使用 AI 丰富"
    },
    "fileBody": "架构文件来源尚无可丰富的快照。连接一个在线数据库以使用 AI 丰富，或继续——启发式基线仍会生成完整的应用。",
    "fileTitle": "AI 丰富需要一个在线数据库",
    "generatePrompt": "生成提示",
    "intentLabel": "你希望如何丰富？",
    "localeLocked": "（必填）",
    "localesLegend": "将标签翻译为",
    "noSections": "请至少选择一个要丰富的决策组。",
    "provider": {
      "configError": "无法加载提供商设置——请在“设置 → AI”中配置一个，然后返回此步骤。",
      "description": "立即使用已配置的提供商运行丰富。你将以差异形式审阅每条建议。",
      "networkDisabled": "此 Adminium 无出站网络访问，无法连接服务商 API。请改用复制粘贴往返方式——同样的提示词，同样的审阅。",
      "readyBody": "在上方选择“使用我的 AI 提供商”，立即对此连接运行丰富。",
      "readyTitle": "AI 提供商已配置",
      "setUpHere": "在此配置提供商",
      "setUpHide": "隐藏提供商配置",
      "settingsHint": "想直接运行吗？",
      "settingsLink": "在“设置 → AI”中配置提供商",
      "title": "使用我的 AI 提供商",
      "unconfigured": "尚未配置 AI 提供商——请在下方配置一个，或将提示复制到你自己的 AI 工具。"
    },
    "providerFallback": "你的 AI 提供商",
    "samplingHint": "在提示中为每个非 PII 列最多包含 20 个真实值。",
    "samplingPreviewBody": "每个非 PII 列最多 20 个最常见值，以及数值和日期列的最小/最大值。标记为 PII 的列永不采样。其余所有内容仅保留聚合值。复制前请审阅确切的提示（BYO）——未经你的操作不会发送任何内容。",
    "samplingPreviewTitle": "离开此机器的内容",
    "samplingTitle": "包含示例值",
    "section": {
      "enums": "枚举语义",
      "groups": "导航分组",
      "icons": "图标",
      "keys": "关键列",
      "labels": "标签与描述",
      "microcopy": "微文案",
      "pii": "PII 与脱敏",
      "relations": "关系",
      "templates": "页面模板",
      "widgets": "仪表板小组件"
    },
    "sectionsLegend": "应由 AI 决定哪些内容？",
    "skip": {
      "confirmBody": "生成的应用将使用启发式的标签、分组和仪表板。继续生成——你可随时在“设置 → AI”中运行 AI 丰富。",
      "confirmTitle": "继续使用启发式",
      "description": "从启发式基线生成。你之后可在“设置 → AI”中丰富——跳过绝不会受到惩罚。",
      "title": "跳过——仅使用启发式"
    },
    "startOver": "重新开始",
    "startProvider": "开始丰富",
    "subtitle": "可选择使用 LLM 优化生成的标签、分组、枚举和仪表板。启发式基线无需它即可工作——这仅添加供你在应用前审阅的建议。",
    "title": "使用 AI 丰富"
  },
  "generate": {
    "errorTitle": "生成失败",
    "failed": "生成失败——请重试，或先重新运行自省。",
    "fileBody": "你的架构解析顺利，上方预览是真实的。直接从架构文件生成可运行的应用（含占位行）尚不可用——请连接实时数据库立即生成。",
    "fileTitle": "架构文件已解析——生成需要实时数据库",
    "log": {
      "classifying": "正在对架构分类…",
      "composing": "正在组合模板…",
      "done": "已生成 {pages} 个页面，分布于 {groups} 个导航组",
      "writing": "正在写入页面…"
    },
    "logLabel": "生成日志",
    "openApp": "打开你的应用",
    "run": "生成仪表板",
    "subtitle": "每个已包含的表一个页面，外加按领域生成的仪表板——意图：",
    "successBody": "{pages} 个页面，分布于 {groups} 个导航组——由你的架构生成，可在 Studio 中编辑。",
    "successTitle": "你的仪表板已就绪",
    "title": "生成你的应用"
  },
  "hostedApps": {
    "domains": {
      "add": "附加域名",
      "hostLabel": "主机",
      "instanceLabel": "实例",
      "instanceOwn": "应用自身",
      "issuesTitle": "域名映射被拒绝",
      "none": "未附加任何域名。",
      "remove": "移除",
      "save": "保存域名",
      "savedBody": "映射会在几秒内生效。只有当其 DNS 和你的代理真正到达此实例时，主机才会响应。",
      "savedTitle": "已保存",
      "subtitle": "将域名的 DNS 指向你的代理，把 Host 标头透传给 Adminium，然后在此附加——该主机随后将提供此界面而非本仪表盘。证书保留在你的代理上。",
      "surfaceLabel": "界面",
      "title": "域名"
    },
    "emptyBody": "将 ADMINIUM_SURFACES_DIR 指向存放已构建界面的目录——每个应用和端各一个文件夹，各含其 index.html——然后重启。之后它们将在 /apps/ 下提供，并显示在这里。",
    "emptyTitle": "当前没有提供任何应用界面",
    "error": "出了点问题",
    "instances": {
      "add": "添加实例",
      "appLabel": "应用",
      "body": "让同一个应用服务于多个数据库。每个实例可通过 /apps/<app>/<segment>/<side>/ 访问，且只读取你指定的连接。",
      "empty": "没有额外实例。",
      "failed": "实例未保存",
      "readsLabel": "读取",
      "remove": "移除",
      "save": "保存实例",
      "slugLabel": "URL 片段",
      "title": "实例"
    },
    "subtitle": "此实例所服务的应用界面——每个界面出现的位置，以及指向它们的域名。",
    "surfaces": {
      "boundKey": "提供密钥",
      "connectionLabel": "读取",
      "connectionUnset": "当前提供服务的连接",
      "customer": "客户",
      "mintLink": "在“公开 API”中创建",
      "noKey": "未绑定密钥——为其创建密钥之前，此界面无法读取数据。",
      "noNav": "内嵌位置不可用——请用当前工具链重新构建此界面，使其生成 surface.json。",
      "placementExternal": "外部（仅自有网址）",
      "placementInternal": "在侧边栏中（内嵌）",
      "placementLabel": "位置",
      "staff": "员工",
      "subtitle": "员工界面可以融入此仪表盘的侧边栏，也可以独立存在；客户界面是公开的，通过其绑定的密钥读取数据。",
      "title": "界面"
    },
    "title": "托管应用",
    "install": {
      "steps": {
        "bundle": "安装包",
        "database": "数据库",
        "plan": "架构计划",
        "done": "完成"
      },
      "progress": "安装进度",
      "failed": "安装失败",
      "bundle": {
        "title": "上传应用安装包",
        "hint": "应用的发布文件（.tgz）——其中包含 manifest.json 以及 staff/ 或 customer/ 目录。",
        "file": "安装包文件（.tgz）",
        "fileHint": "在你于架构计划这一步确认之前，不会创建任何内容。",
        "integrity": "完整性校验（可选）",
        "integrityHint": "粘贴随版本发布的 sha512- 值，服务器将据此校验这些字节。留空则在本页计算。"
      },
      "database": {
        "title": "安装到哪个数据库？",
        "hint": "选择一个可写连接。表将创建在那里，应用之后也从那里读取。",
        "tables": "表：{count}",
        "readOnly": "只读",
        "writable": "可写",
        "noWritable": "没有可写连接",
        "allReadOnly": "这里的所有连接都使用只读角色，因此任何应用都无法创建自己的表。请先连接一个可以执行 DDL 的连接。"
      },
      "plan": {
        "title": "检查架构计划",
        "hint": "这正是将在你的数据库中创建的内容。目前尚未写入任何数据。",
        "refused": "此应用无法安装到这里",
        "create": "创建",
        "reuse": "复用现有",
        "toggleDdl": "显示 DDL 预览",
        "ddl": "DDL 预览",
        "ddlNote": "仅供参考。服务器会为你的数据库引擎生成确切语句，包括外键。",
        "summary": "创建 {created} · 复用 {reused}"
      },
      "done": {
        "title": "已安装",
        "body": "{key} 已开始提供服务。请在下方选择其员工端的显示位置。",
        "schema": "已创建表：{created} · 复用：{reused}"
      },
      "cancel": "取消",
      "back": "上一步",
      "upload": "上传",
      "continue": "继续",
      "confirm": "安装",
      "finish": "管理应用",
      "staged": "已解包文件：{files}",
      "footerStep": "第 {n} 步，共 {total} 步",
      "footerStepApp": "第 {n} 步，共 {total} 步 · {app}",
      "chosen": {
        "title": "安装 {app}",
        "hint": "这个应用随你的构建附带，已经在磁盘上。在你确认架构计划之前不会创建任何内容。"
      },
      "downloaded": {
        "hint": "已从在线应用目录下载，并按其公布的指纹校验。在你确认架构计划之前不会创建任何内容。"
      },
      "uploaded": {
        "hint": "读取自你上传的安装包中的 manifest.json。在你确认架构计划之前不会创建任何内容。",
        "replace": "上传其他安装包"
      }
    },
    "installed": {
      "title": "已安装的应用",
      "install": "安装应用",
      "emptyTitle": "尚未安装任何应用",
      "emptyBody": "上传已构建的界面包即可安装。在这里安装的应用会立即提供服务——与指向目录的方式不同，无需重启。",
      "uninstall": "卸载",
      "confirmTitle": "卸载此应用？",
      "confirmBody": "它的界面将停止提供服务，安装包会被删除。它在你数据库中创建的表不会受到影响。",
      "confirmPrompt": "输入 {key} 以确认",
      "confirmCancel": "取消",
      "confirmClose": "关闭",
      "stagedTitle": "已上传但未安装",
      "stagedHint": "丢弃你决定不用的那个，或再次上传同一标识以替换它。",
      "discard": "丢弃",
      "installedAt": "安装于 {when}",
      "updatesAvailable": "{count, plural, other {# 个可用更新}}",
      "updateTo": "更新到 v{version}",
      "needsNewer": "v{version} 需要 Adminium {minimum} 或更高版本",
      "update": "更新"
    },
    "browse": {
      "title": "可安装的应用",
      "subtitle": "随此构建附带的现成应用。安装会创建它所需的表并开始提供其界面——在你确认计划之前不会发生任何事。",
      "search": "搜索应用…",
      "clear": "清除搜索",
      "all": "全部",
      "by": "来自 {publisher}",
      "install": "安装",
      "installed": "已安装",
      "noMatch": "没有匹配的应用",
      "noMatchBody": "换个关键词，或换个分类试试。",
      "emptyTitle": "没有可安装的应用",
      "emptyBody": "随此构建附带的应用会显示在这里。把 ADMINIUM_BUNDLED_APPS 指向一个应用包目录，或自行上传一个。",
      "unreadable": "无法读取该包的清单，因此无法安装——请在下方丢弃它。",
      "subtitleOnline": "随此构建附带的应用，以及在线目录中的应用。安装时会按需下载并创建所需的表——在你确认计划之前不会发生任何事。",
      "neverChecked": "在线目录已开启，但尚未检查。检查更新以列出其中的应用。",
      "refresh": "检查更新",
      "toggle": "浏览在线应用目录",
      "emptyOnlineBody": "在线目录已开启，但还没有列出任何内容。检查更新以获取目录。",
      "fromCatalog": "在线",
      "needsNewer": "需要 Adminium {version} 或更高版本"
    },
    "job": {
      "refreshTitle": "正在检查在线应用目录",
      "downloadTitle": "正在下载 {app}",
      "body": "正在获取并校验。在你同意之前不会安装或更改任何内容。",
      "failed": "任务未完成。没有安装或更改任何内容。"
    },
    "update": {
      "title": "将 {app} 更新到 v{version}",
      "subtitle": "此版本需要已安装版本没有的表。",
      "body": "这些表会创建在此应用已在使用的数据库中。已有的表不会被更改。",
      "cancel": "取消",
      "confirm": "更新",
      "close": "关闭",
      "done": "{app} 已更新到 v{version}",
      "missingColumns": "缺少：{tables}。"
    },
    "veto": {
      "title": "此部署无法在线浏览",
      "body": "设置已保存，但此服务器关闭了网络功能，以此为准。已安装的应用仍可使用，你也仍可以自行上传应用。"
    }
  },
  "hub": {
    "action": {
      "delete": "删除",
      "pause": "暂停",
      "pausedHint": "此连接已暂停 — 恢复后才能访问数据库。",
      "regional": "区域设置",
      "reintrospect": "重新内省",
      "reintrospectFile": "架构文件来源没有在线数据库——请改为重新上传文件。",
      "remap": "重映射架构",
      "rename": "重命名",
      "resume": "恢复",
      "test": "测试"
    },
    "card": {
      "lastIntrospected": "上次内省",
      "latency": "延迟",
      "latencyMs": "{latency, number} 毫秒",
      "never": "从未",
      "pages": "页面",
      "paused": "Adminium 不会连接此数据库。恢复后，其页面会重新加载数据。",
      "pausedSince": "已于{when}暂停 — Adminium 不会连接此数据库。恢复后，其页面会重新加载数据。",
      "readOnly": "只读",
      "tables": "表",
      "timezone": "时区",
      "timezoneGuessed": "来自此服务器"
    },
    "connectNew": "新建连接",
    "delete": {
      "body": "此操作将删除“{name}”及其生成的页面。您的数据库本身不会被改动。",
      "cancel": "取消",
      "close": "关闭",
      "confirm": "删除连接",
      "failed": "无法删除连接，请重试。",
      "prompt": "输入 {name} 以确认",
      "success": "连接“{name}”已删除",
      "title": "删除连接"
    },
    "empty": {
      "body": "连接数据库后，Adminium 会根据其架构生成您的管理面板。",
      "cta": "连接数据库",
      "title": "还没有数据源"
    },
    "hostedApps": "托管应用",
    "introspect": {
      "failed": "内省失败，请重试。",
      "masksProposed": "{count, plural, other {建议对 # 列进行脱敏}}——请在重映射编辑器中查看。",
      "noChanges": "架构无变化——未创建新快照。",
      "updated": "已重新内省架构"
    },
    "pause": {
      "body": "Adminium 将不再打开到“{name}”的任何连接。在你恢复之前，{pages, plural, other {它的 # 个页面}}、计划报告和托管应用都会停止加载数据。",
      "confirm": "暂停连接",
      "keeps": "不会删除任何内容 — 连接、它的结构和{pages, plural, other {它的 # 个页面}}都会保留，一键即可恢复。",
      "pauseFailed": "无法暂停该连接。请重试。",
      "pausedToast": "已暂停连接“{name}”",
      "resumeFailed": "无法恢复该连接。请重试。",
      "resumedToast": "已恢复连接“{name}”",
      "title": "暂停此连接？"
    },
    "regional": {
      "currency": "货币",
      "currencyHelper": "用于格式化金额。可选——不设置仅影响格式。",
      "currencyPlaceholder": "ISO-4217 代码",
      "failed": "无法保存区域设置",
      "guessedBody": "Adminium 从其运行的机器上取得该时区，并非有人在此选择。保存即可确认，或选择该商家实际所在的时区。",
      "guessedTitle": "此时区来自服务器",
      "intro": "这些设置描述该数据库所属的业务，而非阅读者本人。由 Adminium 提供服务的应用会从这里读取。",
      "noMatch": "没有匹配的时区",
      "noMatchCurrency": "没有匹配的货币",
      "notSet": "未设置",
      "save": "保存",
      "saved": "区域设置已更新",
      "timezone": "时区",
      "timezoneHelper": "日期和时间以此时区显示。若未设置，由 Adminium 托管的应用将回退到 UTC，并在界面上说明。",
      "timezonePlaceholder": "地区/城市",
      "title": "区域设置"
    },
    "rename": {
      "failed": "无法重命名该连接",
      "helper": "该数据库在整个 Adminium 中的显示名称——卡片、其页面上方的侧边栏分组，以及每个提供它的选择器。数据库本身不会被重命名。",
      "label": "名称",
      "save": "重命名",
      "saved": "连接已重命名",
      "title": "重命名连接"
    },
    "stats": {
      "connections": "连接",
      "healthy": "正常",
      "pages": "已生成的页面",
      "tables": "已包含的表"
    },
    "status": {
      "connected": "已连接",
      "error": "错误",
      "paused": "已暂停",
      "testing": "测试中…",
      "unconfigured": "草稿"
    },
    "subtitle": "{total, plural, other {# 个连接中 {healthy, number} 个}}状态正常",
    "subtitlePaused": "{total, plural, other {# 个连接中 {healthy, number} 个}}状态正常 · {paused, number} 个已暂停",
    "test": {
      "failed": "连接测试失败",
      "ok": "连接正常 · {latency, number} 毫秒"
    },
    "title": "数据连接"
  },
  "intent": {
    "analytics": {
      "description": "仪表板、图表和只读网格。没有表单、没有写入——所有角色上限为查看者。",
      "title": "只读分析"
    },
    "crud": {
      "description": "每个表一个编辑页面，外加搜索和导入/导出——极简主页，没有仪表板。",
      "title": "CRUD 数据表"
    },
    "fullAdmin": {
      "description": "仪表板、CRUD 页面、搜索、导入与导出——你的架构支持的一切。",
      "title": "完整管理面板"
    },
    "subtitle": "意图决定生成哪些页面。之后可以更改——更改会提议重新生成，绝不会静默重写。",
    "support": {
      "description": "优先生成队列、工单和客户详情页面。默认关闭删除。（队列模板在 M7 提供——v1 页面集与完整管理面板相同。）",
      "title": "客服控制台"
    },
    "title": "你需要什么？",
    "trust": "我们只读取你的架构——设置期间绝不读取行数据。"
  },
  "llmRuns": {
    "review": {
      "applied": {
        "body": "下方已接受的建议为只读。",
        "title": "此运行已应用"
      },
      "apply": {
        "confirm": "应用更改",
        "empty": "未选择任何要应用的内容。",
        "subtitle": "这些更改将在一个事务中写入，并可撤销。",
        "title": "应用 {n} 项建议"
      },
      "applyFailed": "没有任何更改被应用",
      "applyUnknown": "服务器没有说明原因。",
      "bulk": {
        "acceptAll": "接受所有 ≥ {pct}%",
        "clear": "清除选择",
        "thresholdAria": "“全部接受”的置信度阈值",
        "thresholdLabel": "置信度阈值"
      },
      "cat": {
        "copy": "微文案",
        "dashboard": "仪表盘",
        "enum": "枚举",
        "group": "导航分组",
        "key": "键列",
        "label": "标签",
        "pii": "个人信息",
        "relation": "关系",
        "template": "页面模板",
        "widget": "小组件"
      },
      "empty": {
        "body": "此运行未生成可审查的建议。",
        "title": "无建议"
      },
      "error": {
        "title": "无法加载此运行"
      },
      "footer": {
        "apply": "应用 {n} 项已接受的建议",
        "count": "已选择 {n} 项建议",
        "failed": "应用失败"
      },
      "group": {
        "dashboards": "仪表盘与小组件",
        "enums": "枚举语义",
        "icons": "图标",
        "keys": "键列",
        "labels": "标签与翻译",
        "microcopy": "微文案",
        "navigation": "导航与领域",
        "pii": "个人信息与脱敏",
        "relations": "关系",
        "templates": "页面模板"
      },
      "header": {
        "agree": "{n} 项一致",
        "byo": "自带",
        "conflict": "{n} 项冲突",
        "countsAria": "建议数量",
        "model": "模型",
        "new": "{n} 项新增",
        "pathByo": "复制粘贴",
        "pathDirect": "直接 API",
        "rejects": "{n} 项拒绝",
        "snapshot": "快照",
        "title": "审查 AI 建议"
      },
      "notReady": {
        "body": "运行必须先通过验证，才能审查其建议。请先生成或粘贴响应。",
        "title": "此运行尚无可审查的建议"
      },
      "row": {
        "acceptAria": "接受 {target} 的{noun}建议",
        "confidenceAria": "置信度 {pct}%",
        "hideTranslations": "隐藏翻译",
        "keptEdited": "已保留——由您编辑",
        "noAi": "无 AI 建议",
        "rejectsCallout": "AI 拒绝了某项启发式决策——接受前请确认。",
        "showTranslations": "显示翻译"
      },
      "section": {
        "acceptedCount": "已接受 {n} 项",
        "selectAllAria": "全选 {group}"
      },
      "status": {
        "agree": "一致",
        "conflict": "冲突",
        "heuristicOnly": "仅启发式",
        "locked": "已锁定",
        "new": "新增",
        "rejects": "拒绝启发式"
      },
      "toast": {
        "applied": "已应用 {n} 项建议",
        "appliedPartial": "已应用 {n} 项建议（部分已跳过）",
        "applyFailed": "无法应用建议",
        "undoFailed": "无法撤销此更改"
      },
      "value": {
        "absent": "无",
        "dash": "—",
        "description": "描述",
        "display": "显示",
        "enumCategory": "分类",
        "enumWorkflow": "工作流",
        "guidance": "空状态提示",
        "headline": "空状态标题",
        "key": "键",
        "label": "标签",
        "none": "无值",
        "notPii": "非个人信息",
        "rank": "排名 {n}",
        "span": "跨度 {n}",
        "subtitle": "页面副标题",
        "tableCount": "{n} 张表",
        "widgetCount": "{n} 个小组件"
      }
    }
  },
  "meta": {
    "move": {
      "copying": "正在迁移 Adminium 的数据表…",
      "copyingBody": "正在将每张 adminium_ 表复制到新数据库。你的源数据不会被改动，只有在校验通过后才会切换。",
      "failed": "无法迁移 Adminium 的数据表——请重试。",
      "restarting": "正在重启…",
      "restartingBody": "复制已完成。Adminium 正在新数据库上重启——本页面将在几秒后自动继续。",
      "timeout": "Adminium 已迁移数据表，但尚未恢复。你的数据已安全存放在新数据库中——请稍后刷新本页面。",
      "title": "正在迁移 Adminium 的数据表"
    },
    "sameDb": {
      "description": "adminium_* 表将创建在你的源表旁边。这是最简单的设置——需要具有写入和 CREATE TABLE 权限的角色。",
      "disabledFile": "架构文件没有实时数据库——请为 Adminium 自己的表选择单独的数据库。",
      "disabledNoDdl": "该角色无法执行 DDL——Adminium 迁移需要 CREATE TABLE 权限。请为 Adminium 自己的表选择单独的数据库。",
      "disabledReadOnly": "你的角色是只读的——Adminium 绝不会写入此数据库。请为 Adminium 自己的表选择单独的数据库。",
      "title": "同一数据库"
    },
    "separate": {
      "description": "Adminium 将其表保存在另一个数据库中。你的源保持不变——只读源必须如此。",
      "dsn": "元数据库连接字符串",
      "errorTitle": "元数据存储不兼容",
      "helper": "需要写入和 DDL 权限——Adminium 会在那里运行自己的迁移。",
      "insufficient": "该角色无法承载元数据存储——Adminium 在那里需要写入和 CREATE TABLE 权限。",
      "ok": "兼容——写入 ✓ · DDL ✓",
      "test": "测试连接",
      "title": "单独的数据库"
    },
    "subtitle": "页面、角色、审计日志和设置存放在以 adminium_ 为前缀的表中——绝不混入你的数据。",
    "testFailed": "连接失败。",
    "title": "Adminium 应把自己的表放在哪里？",
    "v1Note": {
      "body": "此服务器已将自有数据表保存在配置好的数据库中，本步骤不会迁移它们。它只校验你的选择是否与此连接兼容——服务器会独立执行同一规则（409 META_PLACEMENT_INVALID）。",
      "title": "关于此安装"
    },
    "willMove": {
      "body": "Adminium 目前使用内置的 SQLite 存储。点击“继续”会把该存储复制到你选择的数据库并在其上重启——账号、页面和设置都会一起迁移，你将保持登录状态。",
      "title": "此操作将迁移 Adminium 的数据表"
    }
  },
  "pages": {
    "action": {
      "delete": "删除页面",
      "duplicate": "创建副本",
      "edit": "编辑页面",
      "hide": "在侧边栏中隐藏",
      "show": "在侧边栏中显示"
    },
    "attachments": {
      "accept": "接受的文件类型",
      "acceptHint": "一个都不选，则接受此工作区允许的一切。在这里的选择只会缩小范围，绝不会扩大。",
      "column": {
        "adoptHint": "该表已有此列，因此不会新建——将直接使用它。",
        "bound": "文件存放在此表的 {column} 列中。",
        "boundHint": "以后关闭附件只会解除此页面的绑定。该列及其中的文件保持不变。",
        "confirm": "执行",
        "create": "创建该列",
        "createHint": "Adminium 会向此表添加一个文本列。执行前你会看到确切的语句。",
        "createdHint": "该列已创建。保存此页面即可完成连接。",
        "failed": "操作未成功",
        "invalid": "列名必须以字母开头，且只能包含小写字母、数字和下划线。",
        "label": "存放文件的列",
        "required": "请为该列命名。",
        "tooLong": "该名称对于列来说太长了。",
        "use": "使用此列",
        "wrongType": "此表已有同名的列，且它无法存放文件引用。请换一个名称。"
      },
      "destination": "文件存放到哪里",
      "destinationDefault": "默认存储目标",
      "destinationHint": "除非此表的文件应当另存他处，否则保持默认即可。",
      "destinationIsDefault": "{name}（默认）",
      "destinationLocal": "此服务器的磁盘",
      "enable": "允许为此表的记录添加附件",
      "enableHint": "文件在 Adminium 一侧关联，因此此表无需新增列——只读连接上可用，你不愿改动的表上也可用。",
      "enableHintColumn": "文件存放在此表的一个列中，因此会同时出现在“新建”和“编辑”对话框以及每条记录上。",
      "enableHintSidecar": "文件改为在 Adminium 一侧关联。它们出现在每条记录的页面上，而不是“新建”对话框中。",
      "maxBytes": "最大文件（MB）",
      "maxBytesHint": "留空则沿用工作区的限制。在这里填写的数字只能把它调低。",
      "maxCount": "每条记录最多文件数",
      "maxCountHint": "留空则一条记录需要多少就接受多少。",
      "sidecar": {
        "noPrivilege": "此连接的角色无法修改表，因此 Adminium 无法为它添加列。",
        "readOnlyIntent": "此连接设置为只读分析，因此 Adminium 无法为它添加列。",
        "readOnlyRole": "此连接使用只读角色登录，因此 Adminium 无法为它添加列。",
        "schemaFile": "此连接由架构文件创建，因此 Adminium 无法为它添加列。"
      },
      "type": {
        "office": "Office 文档",
        "text": "纯文本"
      }
    },
    "columns": {
      "addFromLinked": "来自关联表",
      "addFromTable": "来自 {table}",
      "addLinkedFrom": "链接到此表的表",
      "addLinkedFromHelp": "统计指向每条记录的行数，或将其中一个数字相加。",
      "addLinkedHelp": "显示链接列所指向表中的值。",
      "addNoMatches": "没有与“{query}”匹配的列。",
      "addOpen": "添加列",
      "addSearch": "搜索列…",
      "addTitle": "添加列",
      "addVia": "通过 {column}",
      "avatar": "头像",
      "avatarToggle": "在 {name} 旁显示字母图标",
      "countBadge": "计数",
      "dragHandle": "调整 {name} 的顺序",
      "empty": "还没有列——在下方添加。",
      "file": {
        "acceptHelp": "全部不勾选，则接受此工作区所接受的一切。在这里选择类型只会缩小范围——某一列永远无法接受工作区拒绝的类型。",
        "acceptLabel": "接受的类型",
        "badge": "文件",
        "destinationDefault": "默认存储目标",
        "destinationHelp": "通过此列上传的字节存放在哪里。",
        "destinationLabel": "存储目标",
        "inlineHelp": "只有图片会画在单元格里。无论此项如何设置，其他文件都只显示为带名称和大小的标签块。",
        "inlineLabel": "在表格中显示",
        "maxCountHelp": "留空则接受记录所需的任意数量。",
        "maxCountLabel": "每条记录最多文件数",
        "maxCountToggle": "{name} 最多可存放的文件数",
        "maxHelp": "留空则使用工作区的限制。列只能要求更小的值。",
        "maxLabel": "最大文件（MB）",
        "maxToggle": "{name} 接受的最大文件，单位 MB",
        "multipleHelp": "该列存储文件列表而不是单个文件。现有的单个值仍然有效——会被读作只有一项的列表。",
        "multipleLabel": "存放多个文件",
        "ref": {
          "id": "Adminium 的文件 ID",
          "key": "存储目标中的键",
          "url": "文件的链接"
        },
        "refHelp": "上传文件时写入此列的内容。已存的值仍然有效——这只影响下一次写入。",
        "refLabel": "存入的值",
        "refTooNarrow": "此列太短，装不下该值。请选择它能容纳的一种，或在数据库中加宽该列。",
        "refWidth": "{shape}——需要 {needs} 个字符，此列可容纳 {holds} 个",
        "switch": "文件",
        "switchToggle": "{name} 存放文件",
        "type": {
          "csv": "CSV",
          "gif": "GIF",
          "heic": "HEIC",
          "jpeg": "JPEG",
          "json": "JSON",
          "markdown": "Markdown",
          "mp3": "MP3 音频",
          "mp4": "MP4 视频",
          "office": "Office 文档",
          "ogg": "Ogg",
          "pdf": "PDF",
          "png": "PNG",
          "svg": "SVG",
          "text": "纯文本",
          "wav": "WAV 音频",
          "webm": "WebM",
          "webp": "WebP",
          "zip": "ZIP"
        }
      },
      "fold": {
        "avg": "平均值",
        "max": "最大值",
        "min": "最小值",
        "sum": "求和"
      },
      "foldAdd": "添加",
      "foldLabel": "聚合",
      "followColumn": "跟随 {name}",
      "header": "{name} 的列标题",
      "help": "拖动以重新排序列、重命名列标题，并选择哪些列显示在表格中。",
      "lookupBack": "返回",
      "lookupBadge": "关联",
      "lookupBroken": "该关联已无法解析",
      "lookupBrokenBody": "浏览期间架构发生了变化。请重新开始关联。",
      "lookupBrowse": "选择要从 {table} 显示的内容",
      "mask": "遮盖",
      "maskHelp": "遮盖会把数值藏在显示按钮之后，供有权查看的人点击展开。数据是否离开数据库，由连接设置决定，不在这里。",
      "maskToggle": "将 {name} 隐藏在显示按钮之后",
      "masked": "已遮盖",
      "none": {
        "body": "生成页面时会从数据表读取列。请将此页面绑定到数据表后重新生成。",
        "title": "此页面还没有列"
      },
      "pk": "主键",
      "remove": "移除 {name}",
      "schemaUnavailable": "无法列出数据库的列，因此这里无法重新添加列。",
      "shown": "显示",
      "toggle": "在表格中显示 {name}"
    },
    "create": {
      "failed": "无法创建页面",
      "submit": "创建页面",
      "subtitle": "选择此页面显示什么以及外观如何。预览会跟随你的选择。",
      "title": "新建页面"
    },
    "createButton": "新建页面",
    "delete": {
      "body": "此操作无法撤销。该页面上所有已保存的视图和个人布局将对所有人删除。",
      "bodyGenerated": "此页面由架构生成创建，下次重新生成时会再次出现。已保存的视图和个人布局将对所有人删除。",
      "confirm": "删除页面",
      "prompt": "输入 {slug} 以确认",
      "title": "确定删除此页面吗？"
    },
    "derived": {
      "add": "添加列",
      "atLeast": "至少为",
      "cancel": "取消",
      "emptyBody": "请先在“列”卡片中汇总一个关联表——这里的规则基于那些数字。",
      "emptyTitle": "尚无计算数字",
      "fieldBadge": "计算值",
      "foldBadge": "汇总",
      "help": "根据上面的汇总和本记录自身的列计算数字。它们在页面加载时计算，无法排序。",
      "label": "列标题",
      "minus": "减",
      "numberHelp": "数字为普通小数——500 或 12.50，不能写成 1,000 或 5e3。",
      "operandA": "数字",
      "operandB": "数字",
      "operator": "运算符",
      "otherwise": "否则",
      "percentOf": "来自本记录的百分比",
      "plus": "加",
      "preset": {
        "combine": "两个数字相加或相减",
        "percent": "某个数字的百分比",
        "rule": "带阈值的规则"
      },
      "previewHelp": "示例值，由页面所用的同一段代码计算。",
      "previewTitle": "预览",
      "remove": "移除 {name}",
      "thenShow": "则显示"
    },
    "duplicate": {
      "failed": "无法创建副本",
      "submit": "创建副本",
      "title": "创建页面副本"
    },
    "editor": {
      "appearance": "外观",
      "attachments": "附件",
      "columns": "列",
      "contentInvalid": "无法读取此页面的配置",
      "contentInvalidBody": "配置由更新的版本写入，或已损坏。请重新生成或删除该页面。",
      "contentUnavailable": "无法加载页面内容",
      "contentUnavailableBody": "以上信息仍可保存。",
      "data": "数据",
      "derived": "派生数字",
      "details": "详细信息",
      "generated": {
        "body": "重新生成时会保留你的修改：页面会被标记为已编辑并原样保留。但删除只在下次生成前有效，届时页面会被重新创建。",
        "title": "此页面根据你的数据库架构生成"
      },
      "itemsPending": "请先保存上方的更改——页面内容将依据新的模板和数据表重建。",
      "missing": "此页面已不存在",
      "missingBody": "它可能已被删除，或被某次重新生成移除。",
      "notBindable": "此模板不绑定单个数据表",
      "notBindableBody": "它的内容由小组件逐个搭建。打开页面并点击“编辑”即可添加。",
      "openPage": "打开页面",
      "recompose": "此页面将被重建",
      "recomposeBody": "保存后将依据上方的模板和数据表用全新布局替换页面内容。此页面上的列调整和小组件改动将会丢失。",
      "save": "保存更改",
      "saveFailed": "无法保存更改",
      "schemaFailed": "无法列出数据表",
      "schemaFailedBody": "此连接可能尚未分析。请在“工作室 → 数据连接”中运行架构分析。",
      "title": "编辑页面"
    },
    "empty": {
      "body": "连接数据库即可自动生成页面，也可以手动创建一个。",
      "title": "暂无页面"
    },
    "field": {
      "connection": "数据源",
      "connectionNone": "无",
      "group": "侧边栏分组",
      "groupHint": "页面出现在侧边栏的哪个区块。",
      "icon": "图标",
      "iconHint": "显示在侧边栏中页面名称的旁边。",
      "iconPick": "选择页面图标",
      "newRowLabel": "添加按钮",
      "newRowLabelHint": "添加记录的按钮上显示的文字。留空则使用默认文字，默认文字已翻译。",
      "padding": "页面内边距",
      "slug": "页面地址",
      "slugHint": "仅限小写字母、数字和连字符。只需填写最后一段，其余部分会自动补全。",
      "slugTaken": "已有其他页面使用该地址。",
      "slugWarning": "修改地址会导致指向此页面的现有链接和书签失效。",
      "table": "数据表",
      "tableCreateHint": "此页面读取的数据表。现在选择即可直接使用；留空则可稍后再绑定。",
      "tableNeedsConnection": "请先选择数据源。",
      "tableNone": "未绑定",
      "template": "模板",
      "templateHint": "决定页面可以承载哪些内容，之后可以更改。",
      "title": "标题",
      "titleHint": "显示在侧边栏和页面标题栏中。",
      "visible": "在侧边栏中显示",
      "visibleHint": "隐藏的页面仍可通过网址访问，只要对方有链接。",
      "width": "内容宽度",
      "widthHint": "在大屏幕上，页面内容列最多可以有多宽。"
    },
    "filters": {
      "add": "添加筛选",
      "control": "{column} 的控件",
      "down": "下移 {column}",
      "empty": "此页面没有筛选。在下方添加一个。",
      "full": "一个页面最多显示 {max} 个筛选。",
      "name": "{column} 的名称",
      "remove": "移除 {column} 筛选",
      "reset": "回到建议的筛选",
      "subtitle": "工具栏可以对此表提出的问题。未改动时，它跟随表。",
      "title": "筛选",
      "up": "上移 {column}"
    },
    "form": {
      "addLines": "{label}（明细行）",
      "dialog": {
        "cta": "按钮",
        "ctaIcon": "按钮图标",
        "iconDefault": "默认",
        "subtitle": "副标题",
        "title": "标题",
        "titleHelp": "留空则使用自动生成的文案。"
      },
      "field": {
        "availability": "已被占用的条件",
        "availabilityAny": "任何一行占用该时间",
        "availabilityHelp": "另一行占用了同一时间。选择一列可缩小到某个房间、某人或某台机器。不选则不显示任何占用。",
        "availabilityOff": "不检查",
        "control": "控件",
        "down": "将 {name} 下移",
        "drag": "重新排序 {name}",
        "help": "帮助文字",
        "initial": "初始值",
        "initialHelp": "新建记录时的初始内容。编辑时不会套用。",
        "initialLiteral": "固定值",
        "initialNone": "无",
        "initialNow": "当前日期和时间",
        "initialToday": "今天",
        "initialUser": "当前登录的人",
        "initialValue": "该值",
        "label": "标签",
        "placeholder": "占位文字",
        "recap": "摘要",
        "recapHelp": "一个摘要框。目前其文案在页面的 JSON 中编辑。",
        "remove": "移除 {name}",
        "required": "必须填写",
        "requiredHelp": "缺少该值时表单不会保存。数据库本身的要求在“架构”中设置。",
        "ruleChecks": "还有额外校验",
        "ruleDatabase": "由数据库填写",
        "ruleFilled": "由 Adminium 填写",
        "ruleList": "只接受列表 {key} 中的值",
        "ruleRequired": "数据库要求填写",
        "ruleValues": "只接受固定的一组值",
        "rules": "此列：{rules}。",
        "rulesLink": "在“架构”中修改",
        "settings": "{name} 的设置",
        "slotsEnd": "到",
        "slotsEvery": "每",
        "slotsHelp": "留空时间即为仅选择日期。",
        "slotsStart": "时间从",
        "span": "宽度",
        "spanHelp": "该字段占据此分节的几列。",
        "up": "将 {name} 上移"
      },
      "gallery": {
        "choice": {
          "body": "可选择的选项卡片、胶囊开关和滑块。",
          "title": "选项卡片"
        },
        "multi": {
          "body": "邮箱标签输入、角色选择、权限勾选列表。",
          "title": "多项录入"
        },
        "quick": {
          "body": "一个标题字段，附带同行的信息标签。无分节外框。",
          "title": "快速创建"
        },
        "repeater": {
          "body": "一个引用、可重复的明细行和实时合计。",
          "title": "重复行与合计"
        },
        "sectioned": {
          "body": "较长的记录拆分为带标题的分节，内容区可滚动。",
          "title": "分节"
        },
        "segmented": {
          "body": "分段式优先级、长描述、附件列表、负责人。",
          "title": "分段与文件"
        },
        "split": {
          "body": "两栏：第一节在左，其余在右。为日历而设。",
          "title": "分栏"
        },
        "upload": {
          "body": "媒体拖放区、金额输入、标签和发布开关。",
          "title": "上传与标签"
        },
        "wizard": {
          "body": "分步向导，带进度轨和“上一步 / 下一步”页脚。",
          "title": "向导"
        }
      },
      "missing": {
        "title": "不在此表单中。数据库要求的列会在对话框打开时自动补回。"
      },
      "preview": "预览",
      "previewEntity": "记录",
      "reset": "恢复为自动生成",
      "section": {
        "add": "添加分节",
        "columnCount": "{count} 列",
        "columns": "列数",
        "empty": "此处还没有字段——移一个进来，或在下方添加。",
        "label": "分节名称",
        "remove": "移除此分节",
        "unnamed": "未命名分节"
      },
      "subtitle": "“新建”和“编辑”对话框显示的内容。未作改动时，它跟随表结构。",
      "title": "创建表单"
    },
    "icon": {
      "noMatches": "没有图标符合该搜索。",
      "none": "选择图标",
      "search": "搜索图标"
    },
    "list": {
      "count": "{count, plural, other {# 个页面}}",
      "title": "页面"
    },
    "loadFailed": {
      "body": "管理页面需要“管理页面”权限。请联系管理员将该权限授予你的某个角色。",
      "title": "无法加载页面"
    },
    "origin": {
      "generated": "自动生成",
      "llm": "助手",
      "manifest": "插件",
      "project": "项目代码",
      "system": "系统",
      "user": "自定义"
    },
    "padding": {
      "custom": "自定义…",
      "default": "此模板的默认值",
      "none": "无",
      "standard": "标准 (28 × 24)",
      "x": "左右 (px)",
      "y": "上下 (px)"
    },
    "preview": {
      "note": "这是版式示意图，不是你的数据。保存后真实页面才会填充内容。",
      "untitled": "未命名页面"
    },
    "project": {
      "badge": {
        "changed": "已在服务器上更改",
        "conflict": "冲突",
        "outside": "不在项目中"
      },
      "changed": {
        "body": "请将这些更改拉取到项目中并部署，否则它们只保留在此服务器上：",
        "title": "{count, plural, other {此服务器上有 # 个页面已更改}}"
      },
      "conflicts": {
        "body": "在你做出选择之前，此服务器会保留自己的版本。",
        "title": "{count, plural, other {有 # 个页面在此处和项目中都已更改}}"
      },
      "fromCode": "此页面来自 {source}。请在那里修改。",
      "invalid": {
        "body": "请修复这些文件。在此之前，将继续使用最后一个有效版本。",
        "title": "{count, plural, other {有 # 个项目文件未被应用}}"
      },
      "keepServer": "保留服务器版本",
      "notConfigured": "其中一些属于项目未列出的数据库。将其添加到 adminium.config.ts，即可将其页面保留在项目中。",
      "outside": {
        "body": "它们只存在于此服务器上。将它们拉取到项目中即可保留：",
        "title": "{count, plural, other {有 # 个页面不在项目中}}"
      },
      "resolveFailed": "无法完成此更改。",
      "useProject": "使用项目版本"
    },
    "row": {
      "menu": "{title} 的操作"
    },
    "sidebar": {
      "discard": "放弃",
      "emptyGroup": "此分组中没有页面。",
      "help": "在分组内重新排序页面，或将页面移到其他分组。更改对所有人生效。",
      "moveDown": "将 {title} 下移",
      "moveTo": "将 {title} 移到其他分组",
      "moveUp": "将 {title} 上移",
      "save": "保存顺序",
      "saveFailed": "无法保存新顺序",
      "ungrouped": {
        "body": "这些页面可以通过网址访问，但不会出现在侧边栏中。请逐个打开并选择分组。",
        "title": "有些页面不属于任何侧边栏分组"
      }
    },
    "status": {
      "hidden": "已隐藏",
      "live": "已上线"
    },
    "subtitle": "添加、编辑和整理应用的页面，以及它们在侧边栏中的顺序。",
    "tab": {
      "pages": "全部页面",
      "sidebar": "侧边栏顺序"
    },
    "title": "页面",
    "width": {
      "content": "内容（900px）",
      "dash": "仪表板（1320px）",
      "default": "此模板的默认值",
      "full": "全宽（不限制）",
      "narrow": "窄（720px）",
      "page": "页面（1080px）",
      "wide": "宽（1800px）"
    }
  },
  "project": {
    "actions": {
      "bulk": "一条或多条记录",
      "empty": "没有操作。actions/ 中的文件会为记录添加按钮。",
      "needs": "需要：{permission}",
      "single": "一条记录",
      "title": "操作"
    },
    "changes": {
      "empty": "所有页面和架构文件都与此服务器一致。",
      "open": "在“页面”中处理",
      "title": "在此服务器上已更改"
    },
    "code": {
      "disabled": "未加载：桌面应用从不运行项目代码",
      "label": "项目代码",
      "loaded": "已加载（{when}）",
      "none": "未加载任何内容"
    },
    "failures": {
      "empty": "服务器启动以来没有钩子失败。",
      "title": "钩子错误"
    },
    "files": {
      "count": "{count, plural, other {# 个文件}}",
      "pages": "页面文件",
      "schema": "架构文件",
      "title": "文件"
    },
    "folder": "文件夹",
    "hooks": {
      "empty": "没有钩子。hooks/ 中的文件会在记录变化时运行代码。",
      "onImport": "也用于 CSV 导入",
      "title": "钩子"
    },
    "loadFailed": "无法加载项目",
    "mode": {
      "dev": "开发：文件夹与 Studio 保持同步",
      "label": "运行方式",
      "server": "服务器：文件夹只随部署而改变"
    },
    "none": {
      "body": "项目是用 `npx @adminiumjs/adminium new` 创建的文件夹。服务器运行项目时，其页面、钩子和操作会显示在这里。",
      "title": "此服务器未运行任何项目"
    },
    "pages": {
      "empty": "没有页面。pages/ 中的 .tsx 文件会添加你自己的页面。",
      "hidden": "不在侧边栏中",
      "title": "页面"
    },
    "permission": {
      "create": "添加",
      "delete": "删除",
      "read": "查看",
      "update": "编辑"
    },
    "problems": {
      "body": "请修复这些文件。其余项目代码正在运行。",
      "title": "{count, plural, other {# 个文件未能加载}}"
    },
    "status": {
      "changed": "在此服务器上已更改",
      "conflict": "冲突",
      "invalid": "无效",
      "outside": "不在项目中",
      "pending": "尚未应用"
    },
    "subtitle": "此服务器运行的项目文件夹，以及它加载的代码。",
    "superAdminOnly": "只有超级管理员可以查看此服务器运行的项目。",
    "title": "项目",
    "version": "Adminium",
    "widgets": {
      "card": "仪表盘卡片",
      "cell": "表格单元格",
      "empty": "没有小组件。widgets/ 中的文件会添加表格单元格或仪表盘卡片。",
      "title": "小组件"
    }
  },
  "publicApi": {
    "cancel": "取消",
    "close": "关闭",
    "error": "出了点问题",
    "keys": {
      "appHint": "应用的客户界面随后会自行提供此密钥——轮换密钥无需重新构建。",
      "appLabel": "绑定到托管应用界面（可选）",
      "appNone": "未绑定",
      "create": "创建密钥",
      "emptyBody": "请先创建一个作用域，再为它创建密钥。",
      "emptyTitle": "尚无密钥",
      "formLabel": "创建一个密钥",
      "nameLabel": "名称",
      "reveal": "显示密钥",
      "revoke": "吊销",
      "rotate": "轮换",
      "scopeIsAuthBody": "密钥能触及的正是其作用域中列出的内容，除此之外别无其他。它不使用角色或表权限，也无法通过 API 的其余部分读取任何内容。",
      "scopeIsAuthTitle": "作用域是唯一的权限",
      "scopeLabel": "作用域",
      "scopePlaceholder": "选择一个作用域",
      "subtitle": "这些密钥会放进你页面的 JavaScript 里，因此任何人都能读到。这是预期之内的——密钥能做的，永远不会超出其作用域允许的范围。",
      "title": "密钥"
    },
    "notRegistered": {
      "body": "请将 ADMINIUM_PUBLIC_API_ORIGINS 设为允许调用它的确切来源，然后重启。在此之前，这些路由完全不会对外提供。",
      "title": "此服务器未启用"
    },
    "origins": {
      "label": "允许调用它的来源"
    },
    "scopes": {
      "connectionLabel": "连接 ID",
      "create": "创建作用域",
      "delete": "删除",
      "deleteBody": "任何使用绑定到此作用域的密钥的页面都会停止加载数据。密钥不会被删除——如果你想删除的是密钥，请先吊销它们。",
      "deleteConfirm": "删除作用域",
      "deletePrompt": "输入作用域名称以确认",
      "deleteTitle": "删除此作用域",
      "documentHint": "保存时会对照你的架构进行编译。调用方能触及的每一列都只在此处列出，别无他处。默认值可以是 '{'\"$generate\": \"uuid\"'}' 或 '{'\"$generate\": \"now\"'}'——服务器会在创建时填入这些值，因此访客无需自己指定 id 就能新增一行。",
      "documentLabel": "作用域文档",
      "emptyBody": "在下方创建一个。保存前会对照你的实时架构进行检查。",
      "emptyTitle": "尚无作用域",
      "formLabel": "创建一个作用域",
      "issuesTitle": "此作用域未能编译",
      "keyCount": "{count, plural, =0 {没有密钥} other {# 个密钥}}",
      "nameLabel": "名称",
      "subtitle": "作用域界定了一个密钥所能触及的全部范围——哪些表、具体哪些列，以及一个调用方只能收窄、绝不能移除的过滤条件。",
      "title": "作用域"
    },
    "status": {
      "heading": "状态"
    },
    "subtitle": "让你自己的面向客户或员工的页面通过你定义的作用域读取这个数据库。",
    "title": "公开 API",
    "toggle": {
      "hint": "关闭后，所有公开请求会立即停止。不会删除任何内容——密钥、作用域和数据都会保留。",
      "label": "提供公开 API"
    }
  },
  "remap": {
    "badge": {
      "fk": "外键",
      "masked": "已脱敏",
      "pii": "PII",
      "pk": "主键",
      "unique": "唯一"
    },
    "column": {
      "currency": "货币",
      "currencyHelper": "应用于金额格式化的 ISO 4217 代码。",
      "enum": "枚举语义",
      "enumCategory": "分类",
      "enumHelper": "工作流枚举驱动状态徽章和看板列；色调将各值映射到语义色阶上。",
      "enumKind": "枚举种类",
      "enumLabelFor": "{value} 的标签",
      "enumToneAuto": "自动",
      "enumToneFor": "{value} 的色调",
      "enumWorkflow": "工作流",
      "labelHelper": "推断：{name}",
      "labelOverride": "显示标签",
      "logicalType": "逻辑类型",
      "logicalTypeHelper": "推断：{type}（来自 {dbType}）——由适配器映射；v1 中不可覆盖。",
      "nullable": "可为空",
      "pii": "默认脱敏",
      "piiHelper": "脱敏值以遮盖形式显示；取消脱敏需要 data.unmask_pii 权限，并会记录到审计日志。",
      "semantic": "语义类型",
      "semanticHelper": "分类器：{tag} · 置信度 {confidence}% · 来源：{source}",
      "semanticInferred": "推断：{tag}",
      "unclassified": "尚未分类。"
    },
    "diff": {
      "count": "{count} 项更改",
      "one": "1 项更改",
      "regenerate": "重新生成页面",
      "revertAll": "全部还原",
      "revertOne": "还原 {change}",
      "save": "保存覆盖",
      "saved": "覆盖已保存。"
    },
    "empty": {
      "description": "在架构树中选择一项，以重映射其标签、类型、关系或脱敏设置。",
      "title": "选择一个表或列"
    },
    "inspector": "检查器",
    "loadFailed": "无法加载此连接的架构。",
    "mode": {
      "design": "设计",
      "diagram": "关系图",
      "remap": "标签与关系"
    },
    "modeLabel": "编辑器模式",
    "noDesign": {
      "noPrivilege": "此连接的角色无法创建或修改表。请授予它架构权限，或改用具备权限的角色连接。",
      "readOnlyIntent": "此连接被设置为只读分析用途。请在“设置”中更改其用途，才能编辑其架构。",
      "readOnlyRole": "此连接使用只读角色登录，因此 Adminium 无法更改其架构。",
      "schemaFile": "此连接由架构文件创建，因此没有可更改的数据库。标签和关系仍然可用。"
    },
    "relations": {
      "accept": "接受",
      "accepted": "已接受",
      "add": "添加虚拟关系",
      "addButton": "添加关系",
      "cardinality": "基数",
      "confidence": "推断 · {pct}%",
      "declared": "已声明的外键",
      "fromColumn": "源列",
      "fromPlaceholder": "customer_id",
      "inferred": "推断的关系",
      "noColumns": "没有匹配的列",
      "noTables": "没有匹配的表",
      "noneDeclared": "没有已声明的外键涉及此表。",
      "noneInferred": "此表没有推断结果。",
      "overrideBadge": "覆盖",
      "overrides": "覆盖关系（已应用）",
      "suppress": "屏蔽",
      "suppressed": "已屏蔽",
      "toColumn": "目标列",
      "toTable": "目标表"
    },
    "rules": {
      "fill": "初始值",
      "fillDb": "由数据库填写（触发器）",
      "fillDefault": "交给数据库处理",
      "fillHelp": "没有人填写时，Adminium 会在这里放什么。",
      "fillImplicit": "Adminium 会自动填写。",
      "fillLiteral": "固定值",
      "fillNone": "不填——留空",
      "fillNow": "当前日期和时间",
      "fillText": "值",
      "fillUser": "当前登录的人",
      "fillUuid": "新的唯一 id",
      "format": "格式",
      "formatAny": "任意",
      "formatEmail": "电子邮件地址",
      "formatPhone": "电话号码",
      "formatUrl": "网址",
      "help": "只要写入数据行，这些规则都会生效——表单、导入、自动化和 API，而不只是这个应用。",
      "max": "最大值",
      "maxLength": "最长长度",
      "min": "最小值",
      "minLength": "最短长度",
      "onUpdate": "每次更改时重新填写",
      "optionsFromDatabase": "这一列的允许值由数据库决定，请在“设计”中修改。",
      "optionsHelp": "每行一个。留空表示接受任何值。",
      "required": "必须填写",
      "requiredAlready": "您的数据库已经要求这一列必填。",
      "requiredHelp": "表单会要求填写，缺少它的写入会被拒绝。",
      "title": "规则",
      "optionsAnything": "任意内容",
      "optionsInline": "这些值",
      "optionsList": "一个列表",
      "optionsListHelp": "列表本身在 Studio → 列表 中编辑。",
      "optionsListLabel": "列表",
      "optionsListUnavailable": "无法读取列表。",
      "optionsMissingList": "{key}（不在此工作区中）",
      "optionsPickList": "选择一个列表…",
      "optionsSource": "允许的值",
      "optionsSourceHelp": "列表在 Studio 中写一次，引用它的每一列都能使用。",
      "optionsValues": "这些值"
    },
    "saveFailed": "保存失败：{message}",
    "subtitle": "{tables} 张表 · 已应用 {applied} 项覆盖",
    "table": {
      "hierarchy": "层级",
      "icon": "图标",
      "iconPicker": "表图标",
      "include": "包含在生成的应用中",
      "includeHelper": "被排除的表不会生成页面，也不会出现在导航中。",
      "kind": "种类",
      "labelHelper": "推断：{name}",
      "labelOverride": "显示标签",
      "navGroup": "导航组",
      "navGroupHelper": "导航位置由生成器决定——table.navGroup 覆盖不在 v1 词汇表中。",
      "polymorphic": "多态列对",
      "role": "角色",
      "rows": "行数估算",
      "selfFk": "通过 {column} 自引用",
      "shape": "表形态（已分类）",
      "shapeHelper": "每次自省都会重新计算分类；覆盖叠加在其上，并在重新生成后保留。",
      "system": "系统",
      "unclassified": "未分类"
    },
    "tabs": {
      "details": "详情",
      "relations": "关系"
    },
    "title": "架构",
    "toast": {
      "regenerateFailed": "重新生成失败",
      "regenerated": "已创建 {created} · 已更新 {updated} · 未变化 {unchanged}",
      "regeneratedDetail": "你手动编辑过的页面会被保留——只有 generated_hash 未被改动的页面才会原地重新生成。",
      "saved": "架构覆盖已保存",
      "savedDetail": "下方已应用的架构反映了你的更改。"
    },
    "tree": {
      "collapse": "折叠表",
      "excluded": "已排除",
      "expand": "展开表",
      "label": "架构",
      "noMatches": "没有与搜索匹配的表。",
      "search": "搜索表和列",
      "searchPlaceholder": "搜索表…",
      "unsaved": "未保存的更改"
    },
    "unavailableBody": "此版本尚未包含重映射编辑器。等它上线后重新运行生成，即可重映射标签、类型和关系。",
    "unavailableTitle": "架构重映射编辑器不可用"
  },
  "review": {
    "unavailableBody": "此版本尚未包含增强审阅界面。它将随差异与应用流程一起推出。",
    "unavailableTitle": "审阅界面不可用"
  },
  "settings": {
    "globalDefaultsNav": "全局默认值",
    "title": "设置",
    "workspaceSection": "工作区"
  },
  "settingsAi": {
    "byo": {
      "body": "Studio 可以根据你的架构生成一个自包含的提示词。在 Claude Code、ChatGPT 或任意工具中运行它，然后将返回的 JSON 粘贴回连接向导。验证、审阅和结果都与直连方式相同。",
      "guarantee1": "提示词仅包含你的架构和聚合统计——默认绝不包含行数据。",
      "guarantee2": "不嵌入任何凭据、实例 URL 或标识符。",
      "guarantee3": "BYO 运行不进行任何网络调用。",
      "guaranteeTitle": "无遥测保证",
      "heading": "没有密钥？使用你自己的 AI 工具",
      "headingRecommended": "使用你自己的 AI 工具——无需密钥",
      "promptVersion": "提示词 {version}",
      "recommended": "推荐",
      "schemaVersion": "架构 {version}",
      "subtitle": "复制粘贴往返——没有任何内容离开这台机器。"
    },
    "configure": {
      "heading": "配置 {provider}"
    },
    "field": {
      "baseUrl": "基础 URL",
      "baseUrlHelper": "提供 /chat/completions 的端点根地址。",
      "baseUrlOptional": "除非 Ollama 运行在其他主机上，否则保持不变。",
      "key": "API 密钥",
      "keyMask": "sk-…{last4}",
      "keyOptional": "可选——某些端点无需密钥。",
      "keyReplace": "替换密钥",
      "keyStored": "已加密存储。替换它以使用其他密钥。",
      "keyWriteOnly": "仅写入：保存后将不再显示。",
      "model": "模型",
      "modelFreeText": "输入你的端点所提供的确切模型 ID。",
      "modelLive": "已从提供方实时加载。",
      "modelLoading": "加载中…",
      "modelPlaceholder": "选择一个模型…",
      "modelStatic": "一份经过验证的列表；保存后输入自定义 ID 可刷新它。",
      "noKeyBody": "Ollama 在本地运行，因此没有任何内容离开这台机器。",
      "noKeyTitle": "无需 API 密钥"
    },
    "history": {
      "byo": "BYO",
      "colChunks": "分块",
      "colDate": "日期",
      "colSource": "来源",
      "colStatus": "状态",
      "connection": "连接",
      "directPath": "直连",
      "empty": "暂无增强运行。在连接向导中增强架构后，历史将显示在这里。",
      "errorBody": "刷新页面以重试。",
      "errorTitle": "无法加载运行",
      "heading": "运行历史",
      "noConnections": "请先连接数据库——增强运行按连接记录。",
      "openReview": "打开 {date} 的运行审阅",
      "subtitle": "过往的增强运行。打开其中一个以审阅其建议。",
      "tableLabel": "增强运行"
    },
    "provider": {
      "active": "使用中",
      "anthropic": {
        "desc": "通过 Anthropic API 使用 Claude 模型。",
        "label": "Anthropic"
      },
      "heading": "AI 提供方",
      "networkDisabledBody": "此 Adminium 配置为无出站网络访问，无法连接服务商 API。请使用下方的复制粘贴往返方式——无需密钥，也无需联网。",
      "networkDisabledTitle": "此安装已关闭直连 AI 服务商",
      "ollama": {
        "desc": "通过 Ollama 在本地运行模型——无需密钥，无需云端。",
        "label": "Ollama（本地）"
      },
      "openai": {
        "desc": "通过 OpenAI API 使用 GPT 模型。",
        "label": "OpenAI"
      },
      "openaiCompatible": {
        "desc": "任何使用 OpenAI 协议的端点——Groq、Together、vLLM、LM Studio。",
        "label": "兼容 OpenAI"
      },
      "requiresNetwork": "需要联网和 API 密钥",
      "subtitle": "选择 Adminium 如何访问模型来增强你的架构。密钥将加密存储且不再显示。"
    },
    "runStatus": {
      "applied": "已应用",
      "awaitingResponse": "等待响应",
      "discarded": "已丢弃",
      "draft": "草稿",
      "failed": "失败",
      "partiallyApplied": "部分应用",
      "running": "运行中",
      "validated": "已验证"
    },
    "save": "保存提供方",
    "saveFailed": "无法保存 AI 提供方。请重试。",
    "saved": "AI 提供方已保存",
    "subtitle": "连接一个模型，让 Adminium 建议标签、分组、关系等——在应用之前始终以差异形式审阅。",
    "test": "测试连接",
    "testError": "测试失败",
    "testErrorBody": "无法连接到提供方。请检查密钥和基础 URL。",
    "testHintDirty": "测试前请先保存更改。",
    "testOk": "已连接到 {model}，用时 {latency} 毫秒",
    "testUnknownModel": "提供方",
    "testing": "正在连接提供方…",
    "title": "AI 增强"
  },
  "settingsHub": {
    "addOnsCard": {
      "body": "浏览、安装并连接插件——额外的区块、数据包和集成——或者自己上传一个。",
      "cta": "打开插件",
      "heading": "插件"
    },
    "aiCard": {
      "body": "配置 AI 提供方（或复制粘贴往返）来增强标签、分组和关系。",
      "cta": "打开 AI 设置",
      "heading": "AI 增强"
    },
    "danger": {
      "deleteCta": "删除连接",
      "deleteDesc": "删除该连接及其生成的页面。您的数据库不会被改动。此操作无法撤销。",
      "empty": "没有可删除的内容——还没有连接。",
      "heading": "危险区域",
      "subtitle": "不可逆的操作。"
    },
    "defaultsCard": {
      "body": "工作区级的主题、强调色、密度和语言设置位于全局默认值中。",
      "cta": "打开全局默认值",
      "heading": "外观与语言默认值"
    },
    "email": {
      "attachmentCap": {
        "error": "介于 {min, number} 到 {max, number} MB 之间。",
        "helper": "单封邮件可携带的附件总大小上限。",
        "label": "附件上限（MB）"
      },
      "from": {
        "error": "请输入电子邮件地址。",
        "helper": "可只填地址，或在地址前加显示名称。",
        "label": "发件人地址"
      },
      "heading": "电子邮件 (SMTP)",
      "host": {
        "error": "只能填写主机名或 IP 地址 — 不含协议、端口或凭据。",
        "label": "SMTP 主机"
      },
      "linkOrigin": {
        "error": "请输入类似 https://admin.example.com 的地址，不要包含路径。",
        "helper": "密码重置和邀请链接会打开此地址。如果留空，Adminium 会从下一位登录或保存更改的管理员处自动填写，但使用 localhost 时除外。",
        "label": "邮件链接中的地址"
      },
      "pass": {
        "error": "该用户名需要密码。",
        "helper": "加密存储且不再显示。留空则保留当前密码。",
        "label": "密码"
      },
      "port": {
        "error": "介于 {min, number} 与 {max, number} 之间。",
        "label": "端口"
      },
      "remove": "移除邮件服务器",
      "review": {
        "password": "已替换",
        "removed": "已移除"
      },
      "secure": {
        "helper": "端口 465 请开启。关闭时以明文开始并通过 STARTTLS 升级，这正是端口 587 所期望的。",
        "label": "隐式 TLS"
      },
      "senders": {
        "add": "添加发件人",
        "address": "地址",
        "error": "请输入电子邮件地址。",
        "heading": "发件人",
        "helper": "邮件可使用的发件地址。SMTP 发件地址始终可用。",
        "implicit": "SMTP 发件地址",
        "name": "显示名称",
        "remove": "移除发件人",
        "review": "发件人"
      },
      "unconfigured": "尚未设置邮件服务器，因此 Adminium 无法发送密码重置、用户邀请或计划报告。",
      "user": {
        "helper": "若中继无需认证，请留空。",
        "label": "用户名"
      }
    },
    "identity": {
      "appName": {
        "error": "请输入不超过 60 个字符的名称。",
        "helper": "显示在侧边栏、浏览器标题和邮件中。",
        "label": "应用名称"
      },
      "heading": "工作区标识",
      "logo": {
        "badType": "请选择 PNG、JPEG、WebP、GIF 或 SVG 图片。",
        "drop": "将图片拖放到此处",
        "helper": "支持 PNG、JPEG、WebP、GIF 或 SVG，最大 1 MB。将在所有位置替换内置标志。",
        "label": "标志",
        "remove": "移除",
        "removed": "标志已移除",
        "replace": "更换标志",
        "tooLarge": "该图片大于 1 MB。",
        "undo": "撤销",
        "upload": "上传标志",
        "uploaded": "标志已更新"
      },
      "showVersion": {
        "helper": "标志旁的版本号。关闭后将隐藏您运行的版本。",
        "label": "侧边栏中的版本"
      }
    },
    "pagesCard": {
      "body": "添加、编辑和删除页面，更改每个页面的内容，并重新排列侧边栏。",
      "cta": "管理页面",
      "heading": "页面"
    },
    "projectCard": {
      "body": "此服务器运行的项目文件夹：其钩子、操作和页面文件。",
      "cta": "打开项目",
      "heading": "项目"
    },
    "publicApiCard": {
      "body": "让你自己的面向客户或员工的页面通过你定义的作用域读取这个数据库。",
      "cta": "打开公开 API",
      "heading": "公开 API"
    },
    "review": {
      "cancel": "取消",
      "change": "{before} → {after}",
      "close": "关闭",
      "confirm": "保存更改",
      "hidden": "隐藏",
      "off": "关",
      "on": "开",
      "shown": "显示",
      "subtitle": "保存前请确认您的更改。",
      "title": "保存工作区设置"
    },
    "save": "保存更改",
    "saveFailed": "无法保存工作区设置，请重试。",
    "saved": "工作区设置已更新",
    "security": {
      "allowSignup": {
        "desc": "任何人都可以创建账户——关闭后此工作区仅限邀请。",
        "label": "允许自助注册"
      },
      "heading": "安全",
      "passwordMin": {
        "error": "介于 {min, number} 到 {max, number} 个字符之间。",
        "label": "密码最小长度"
      },
      "require2fa": {
        "desc": "每位成员都必须启用双重验证才能登录。",
        "label": "强制双重验证",
        "note": "这是提示而非强制：未启用双重验证的成员会被引导去设置，之后也无法再关闭，但登录不会被阻止，API 密钥也不受影响。"
      },
      "sessionTtl": {
        "error": "介于 {min, number} 到 {max, number} 小时之间。",
        "label": "会话有效期（小时）"
      }
    },
    "storageCard": {
      "body": "选择上传的文件、导出文件和其他已存字节存放在哪里——本服务器、存储桶，或你自己的服务器。",
      "cta": "打开存储",
      "heading": "存储"
    },
    "subtitle": "此工作区的标识、安全与危险操作。",
    "superAdminOnly": "只有超级管理员才能更改工作区标识和安全设置。",
    "superAdminOnlyTitle": "需要超级管理员",
    "title": "工作区设置",
    "translationsCard": {
      "body": "重写 Adminium 中的任何文案，决定用户可以选择哪些语言，并添加你自己的语言。",
      "cta": "打开翻译",
      "heading": "语言与翻译"
    },
    "listsCard": {
      "body": "一列所接受的答案——国家和地区、阶段、部门——命名一次，随处使用。",
      "cta": "打开列表",
      "heading": "列表"
    }
  },
  "source": {
    "dsn": {
      "helper": "postgres://user:password@host:5432/database——mysql:// 和 sqlite: 也可用。",
      "incomplete": "请补全主机和数据库，例如 postgres://user@host:5432/db",
      "invalidScheme": "无法识别的协议——应为 postgres://、mysql://、mariadb:// 或 sqlite:",
      "label": "连接字符串",
      "quickFill": "快速填充："
    },
    "engine": {
      "label": "数据库引擎",
      "mysql": "MySQL / MariaDB",
      "postgres": "PostgreSQL",
      "sqlite": "SQLite"
    },
    "fields": {
      "database": "数据库",
      "host": "主机",
      "password": "密码",
      "port": "端口",
      "preview": "连接字符串预览：",
      "ssl": "SSL 模式",
      "user": "用户"
    },
    "file": {
      "columns": "列",
      "detectedAs": "检测到：{format}",
      "dropHint": "SQL DDL / pg_dump、Prisma、Drizzle、TypeORM、Sequelize、Rails schema.rb、Django 模型、Adminium JSON",
      "dropTitle": "将架构文件拖放到此处，或浏览选择",
      "errorTitle": "无法解析该文件",
      "moreWarnings": "另有 {count} 条警告——完整列表将在分析步骤中显示。",
      "parseFailed": "我们无法解析该文件。如果自动检测判断有误，请明确选择格式后重试。",
      "parsing": "正在读取上传的架构文件…",
      "pitch": "无需数据库连接——我们解析你的架构文件并构建相同的仪表板。",
      "requestFailed": "上传失败——请检查网络连接后重试。",
      "tables": "个表",
      "unsupported": "无法识别该格式——支持 SQL DDL、Prisma、Drizzle、TypeORM、Sequelize、Rails schema.rb、Django 模型和 Adminium JSON。请明确选择一种后重试。",
      "warnings": "警告"
    },
    "format": {
      "auto": "自动检测",
      "django": "Django models.py",
      "drizzle": "Drizzle ORM",
      "helper": "除非自动检测出错，否则保持自动检测即可。",
      "json": "Adminium JSON",
      "label": "架构格式",
      "prisma": "Prisma 架构",
      "rails": "Rails schema.rb",
      "sequelize": "Sequelize 模型",
      "sql": "SQL DDL / pg_dump",
      "typeorm": "TypeORM 实体"
    },
    "mode": {
      "dsn": "连接字符串",
      "fields": "逐项填写",
      "file": "架构文件"
    },
    "modeLabel": "来源输入方式",
    "name": "连接名称",
    "namePlaceholder": "生产环境 Postgres",
    "readOnlyRole": {
      "body": "设置期间 Adminium 只读取架构元数据——绝不读取你的数据行。建议使用仅具 SELECT 权限的专用用户；Adminium 自己的表存放在哪里，你可以在元数据存储步骤中决定。",
      "title": "使用只读角色"
    },
    "sqlite": {
      "file": "数据库文件路径",
      "helper": "SQLite 是文件而非服务器——请填写运行 Adminium 的机器上的绝对路径。"
    },
    "subtitle": "将 Adminium 指向一个数据库，我们会根据其架构生成管理仪表板。",
    "title": "连接你的数据库"
  },
  "storage": {
    "actionFailed": "操作未成功",
    "add": "添加存储目标",
    "availableOnDisk": "此磁盘上可用 {size}",
    "default": "默认",
    "defaultBlockedByDisabled": "已停用的存储目标不能作为默认。请先启用它。",
    "delete": {
      "blockedBody": "{name} 中仍有 {count, plural, other {# 个文件}}。请先把它们迁移到其他存储目标，然后再删除。",
      "blockedTitle": "此存储目标中仍有文件",
      "body": "Adminium 会忘记 {name} 及其凭据。其中存放的内容不会被改动——存储桶或服务器本身归你所有；若仍有文件记录在它名下，删除会被拒绝。",
      "confirm": "删除存储目标",
      "title": "删除此存储目标"
    },
    "deleteButton": "删除",
    "disable": "停用",
    "disabled": "已停用",
    "driver": {
      "local": "本机上的一个路径",
      "s3": "兼容 S3 的存储桶",
      "webdav": "WebDAV 服务器"
    },
    "edit": "编辑",
    "editor": {
      "createTitle": "添加存储目标",
      "editTitle": "编辑存储目标",
      "subtitle": "Adminium 代表你通过此存储目标读写；它是由你掌控的基础设施。"
    },
    "enable": "启用",
    "field": {
      "accessKeyId": "访问密钥 ID",
      "bucket": "存储桶",
      "driver": "种类",
      "driverLocked": "更改已存有文件的存储目标的种类，会让这些文件无法访问。",
      "endpoint": "端点",
      "endpointDerived": "使用 AWS 本身时请留空——端点由区域推导得出。",
      "name": "名称",
      "namePlaceholder": "上传存储桶",
      "password": "密码",
      "pathStyle": "路径式寻址",
      "pathStyleToggle": "把存储桶作为路径而非主机名来寻址",
      "prefix": "前缀",
      "prefixHelper": "存储目标内部的一个文件夹。同一个存储桶上仅此项不同的两个存储目标共用该桶，但不共用命名空间。",
      "preset": "服务商",
      "presetHelper": "自动填入端点、区域和寻址方式。服务商无从得知的账户信息会留空，由你自行填写。",
      "publicBaseUrl": "公开基础 URL",
      "publicBaseUrlHelper": "可选。这些对象在不经过 Adminium 时的可读地址——公开存储桶前面的 CDN。仅当某一列存放链接时才会用到。",
      "region": "区域",
      "root": "目录",
      "rootHelper": "此服务器可写入的绝对路径——挂载的卷或网络共享。不要填默认目录，它已经是列表中的第一项。",
      "secretAccessKey": "私有访问密钥",
      "secretKept": "已存储一个密钥。两个字段都留空则保留它；两个都填写则替换它。",
      "url": "集合 URL",
      "urlHelper": "Adminium 写入的集合，按你的服务器公布的地址填写。",
      "username": "用户名"
    },
    "fileCount": "{count, plural, other {# 个文件}}",
    "kind": {
      "archive": "归档的审计日志批次",
      "branding": "工作区标志",
      "export": "数据导出生成的文件",
      "import": "上传的 CSV 文件及其错误报告",
      "schema": "导入的架构文件",
      "upload": "附加到记录的文件"
    },
    "list": {
      "subtitle": "新文件会存入默认存储目标。已有文件会留在原处，直到你迁移它们。",
      "title": "存储目标"
    },
    "loadFailed": {
      "forbidden": "更改文件的存放位置需要“管理存储目标”权限。请联系管理员将该权限授予你的某个角色。",
      "title": "无法加载存储目标"
    },
    "localDisk": "此服务器的磁盘",
    "move": {
      "from": "从",
      "kinds": "限定为",
      "kindsHelp": "全都不勾选表示迁移所有种类。上传文件是大家附加的文件；其余都是 Adminium 自己生成的产物。",
      "open": "迁移文件…",
      "start": "开始迁移",
      "startedBody": "它以后台任务 {jobId} 运行，即使你离开此页面也会继续。下方的计数会随着文件到达而变化——刷新页面即可看到。",
      "startedTitle": "迁移已开始",
      "subtitle": "把一个存储目标中的每个文件复制到另一个存储目标，然后忘掉旧副本。整个过程中下载都不受影响。",
      "title": "迁移文件",
      "to": "到"
    },
    "preset": {
      "aws": "AWS S3",
      "b2": "Backblaze B2",
      "minio": "MinIO 或其他兼容 S3 的服务器",
      "r2": "Cloudflare R2",
      "spaces": "DigitalOcean Spaces",
      "tigris": "Tigris",
      "wasabi": "Wasabi"
    },
    "save": "保存存储目标",
    "secret": {
      "partialBody": "两个字段都填写以替换已存储的凭据，或都清空以保留它。只填其中一个就保存，会悄悄保留旧凭据。",
      "partialTitle": "只填一半算不上凭据"
    },
    "setDefault": "设为默认",
    "status": {
      "error": "无法访问",
      "ok": "可访问",
      "untested": "未测试"
    },
    "subtitle": "此实例存放上传的文件、导出文件以及其他已存字节的位置。",
    "test": {
      "button": "测试",
      "failed": "无法连通此存储目标",
      "ok": "已连通，用时 {ms} 毫秒",
      "unreachable": "无法执行测试"
    },
    "title": "存储",
    "usedBytes": "已用 {size}"
  },
  "tables": {
    "emptyFilter": "没有匹配筛选条件的表。",
    "highVolume": "高数据量",
    "highVolumeNote": "超过 100,000 行的表默认不勾选——运维类表很少适合放进仪表板。",
    "importNoCounts": "架构文件不包含行数——在连接实时数据库之前，该列显示 —。",
    "joinHidden": "{count} 个关联/系统表已预先隐藏——它们仍支撑多对多关系。",
    "listLabel": "可包含的表",
    "pii": "PII",
    "search": "筛选表…",
    "subtitle": "选择要包含的表。之后可随时更改。",
    "title": "选择数据表"
  },
  "test": {
    "errorTitle": "连接失败",
    "hint": {
      "auth": "身份验证失败——请检查 DSN 中的用户名和密码。",
      "hostUnreachable": "主机不可达——请检查主机名和端口，并确认数据库接受来自本机的连接（将我们的 IP 加入允许列表）。",
      "metaPlacement": "该数据源无法承载 Adminium 的元数据表——请改用单独的元数据库继续。",
      "permission": "该角色已连接，但缺少读取架构的权限——请为自省角色授予该架构的 USAGE 权限。",
      "timeout": "数据库未及时响应——请检查网络路径和负载后重试。",
      "tls": "TLS 协商失败——请尝试 sslmode=require，或上传服务器所需的 CA 证书。",
      "unknown": "连接失败——请核对 DSN 后重试。"
    },
    "log": {
      "connectFailed": "连接失败。",
      "connected": "已连接（{latency} 毫秒）· 只读自省",
      "connecting": "正在建立安全连接…",
      "detected": "检测到 {tables} 个表 · {columns} 列",
      "found": "共发现 {tables} 个表 · {columns} 列",
      "jobFailed": "自省失败。",
      "mapping": "正在映射列类型 → 输入组件",
      "moreWarnings": "另有 {count} 条解析器警告",
      "networkFailed": "请求失败——请检查网络连接后重试。",
      "parsingFile": "正在解析 {file}…",
      "piiDone": "PII 扫描完成——默认屏蔽 {count} 列",
      "piiDoneUnknown": "PII 扫描完成",
      "piiScan": "正在扫描 PII 列…",
      "readingFile": "正在读取上传的架构文件…",
      "readingSchema": "正在读取架构：public",
      "ready": "就绪",
      "relations": "正在检测关系…"
    },
    "logLabel": "自省日志",
    "retry": "重试",
    "subtitle": "正在自省表、列和关系。这需要几秒钟。",
    "title": "正在分析你的架构",
    "trust": "我们只读取你的架构和数据，不会做任何修改。"
  },
  "title": "Studio",
  "wizard": {
    "back": "返回",
    "bridgeAppliedBody": "由你的浏览器从 adminium.dev 直接交给本机——它从未被上传到任何服务器。请在下方核对后继续。",
    "bridgeAppliedTitle": "已收到连接字符串",
    "bridgeFailedBody": "它已被使用或已过期。请改为在下方粘贴你的连接字符串。",
    "bridgeFailedTitle": "无法使用这次交接",
    "continue": "继续",
    "persistFailed": "无法保存你的表选择——请重试。",
    "persistFailedTitle": "保存失败",
    "progress": "设置进度",
    "step": {
      "enrich": "丰富",
      "generate": "生成",
      "intent": "意图",
      "meta": "元数据存储",
      "source": "来源",
      "tables": "数据表",
      "test": "分析"
    },
    "title": "新建连接"
  },
  "lists": {
    "addValue": "添加值",
    "andMore": "另有 {count} 项",
    "builtin": "内置",
    "builtinCount": "{count} 个值",
    "builtinSubtitle": "Adminium 自带的列表。它在每个工作区都相同，名称按各人自己的语言显示。",
    "cancel": "取消",
    "close": "关闭",
    "copiedFrom": "{key} 的副本",
    "copyTitle": "{name} 的副本",
    "create": "创建列表",
    "delete": "删除",
    "deleteBody": "列表会被删除。行中已保存的值保持原样——列表决定表单提供什么，而不是列里存着什么。",
    "deleteTitle": "删除 {name}？",
    "edit": "编辑",
    "editSubtitle": "使用该列表的列所接受的答案，按表单提供它们的顺序排列。",
    "editTitle": "编辑 {name}",
    "emptyBody": "列表就是一列所接受的一组答案。",
    "emptyTitle": "还没有列表",
    "errorUnknown": "操作未成功，请重试。",
    "inUseBody": "请先从 {columns} 中移除它。",
    "inUseNone": "请先从使用它的列中移除它。",
    "inUseTitle": "{name} 正被某一列使用",
    "issueBlank": "其中一个值为空。请填写或删除该行。",
    "issueDuplicate": "“{value}”在列表中出现了两次。",
    "issueEmpty": "列表至少需要一个值。",
    "issueName": "给列表起个名字。",
    "key": "键",
    "keyFixed": "规则以此名称引用该列表",
    "keyHelper": "规则和项目文件用来引用该列表的名称，之后无法更改。",
    "labelAt": "标签 {n}",
    "labelPlaceholder": "人们看到的文字",
    "makeCopy": "创建一个可编辑的副本",
    "moveDown": "将 {value} 下移",
    "moveUp": "将 {value} 上移",
    "name": "名称",
    "namePlaceholder": "部门",
    "new": "新建列表",
    "removeValue": "移除 {value}",
    "save": "保存更改",
    "storeLabel": "改为保存标签",
    "storeLabelHelp": "副本保存代码，例如 DE。“改为保存标签”保存它在这里的名称，例如“德国”——采用本工作区的语言，从现在起生效。",
    "subtitle": "一列所接受的答案：命名一次，随处使用。",
    "title": "列表",
    "valueAt": "值 {n}",
    "valueCount": "{count} 个值",
    "values": "值",
    "view": "查看"
  }
} as const;
