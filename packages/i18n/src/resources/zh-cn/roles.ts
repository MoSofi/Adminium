// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/roles.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle;
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "delete": "删除",
    "rename": "重命名"
  },
  "builtinLocked": "内置角色无法删除。",
  "category": {
    "access": "访问",
    "data": "数据",
    "operations": "运维",
    "workspace": "工作区",
    "records": "页面与记录",
    "apps": "应用"
  },
  "column": {
    "actions": "操作",
    "members": "成员",
    "name": "角色"
  },
  "create": {
    "descriptionLabel": "描述",
    "description": "新建的角色最初不具备任何权限。",
    "failed": "无法创建该角色",
    "namePlaceholder": "例如：客服专员",
    "name": "名称",
    "submit": "创建角色",
    "title": "新建角色"
  },
  "createButton": "新建角色",
  "delete": {
    "confirm": "删除角色",
    "description": "该角色及其权限记录都会被删除。",
    "failed": "无法删除该角色",
    "hasMembers": "“{name}”仍有 {count, plural, other {# 位成员}}。请选择他们迁移到的角色——Adminium 不会让任何账户处于没有角色的状态。",
    "noMembers": "没有人拥有“{name}”，因此不需要迁移任何人。",
    "reassignPlaceholder": "选择一个角色…",
    "reassignTo": "将成员迁移到",
    "title": "删除角色"
  },
  "list": {
    "title": "角色"
  },
  "loadFailed": {
    "body": "下方的矩阵并不完整，此时保存会清除那些只是没有加载出来的权限。请先重新加载，再进行更改。",
    "title": "部分权限无法读取"
  },
  "matrix": {
    "discard": "放弃",
    "empty": {
      "body": "此实例报告说完全没有可授予的权限，这不应该发生——请重新加载；若问题依旧，请查看服务器日志。",
      "title": "没有可显示的权限"
    },
    "label": "角色权限",
    "noChanges": "没有待保存的更改",
    "pending": "{count, plural, other {# 项待保存的更改}}",
    "rowHeader": "权限",
    "title": "权限"
  },
  "memberCount": "{count, plural, other {# 位用户}}",
  "permission": {
    "apiKeysManage": "管理 API 密钥",
    "auditRead": "查看审计日志",
    "connectionsManage": "管理数据库连接",
    "exportsManage": "管理所有人的导出",
    "importsManage": "管理所有人的导入",
    "jobsManage": "启动和取消后台任务",
    "manifestsManage": "安装并管理应用和插件",
    "jobsRead": "查看所有后台任务",
    "llmRun": "运行 AI 辅助",
    "pagesManage": "创建和整理页面",
    "projectRead": "读取页面和架构更改以拉取到项目",
    "reportsManage": "管理定时报告",
    "rolesManage": "管理角色和权限",
    "schemaRemap": "编辑架构标签和覆盖",
    "schemaDdl": "创建、编辑和删除表",
    "settingsManage": "管理工作区设置",
    "usersManage": "管理用户",
    "filesManage": "管理所有人的文件",
    "storageManage": "管理存储目标",
    "designerUse": "使用 Adminium Designer 构建应用",
    "paymentsManage": "设置付款",
    "paymentsRefund": "办理退款",
    "paymentsView": "查看付款活动并导出"
  },
  "rename": {
    "failed": "无法重命名该角色",
    "title": "重命名角色"
  },
  "saveFailed": {
    "title": "无法保存全部角色"
  },
  "subtitle": "每个角色可以做什么。用户会获得其所持有的全部角色的权限并集。",
  "title": "角色与权限",
  "data": {
    "pagesView": "查看所有页面",
    "read": "读取记录",
    "readPii": "查看记录中的个人数据",
    "create": "创建记录",
    "update": "编辑记录",
    "delete": "删除记录",
    "export": "导出记录",
    "import": "导入记录",
    "pagesEdit": "更改页面布局",
    "narrow": "另有 {count, plural, other {# 项}}针对单个页面或数据表的授权同样生效，叠加在下方各行之上。保存时会保留它们。"
  },
  "apps": {
    "every": "打开所有应用的员工界面",
    "one": "打开 {app} 的员工界面"
  },
  "rows": {
    "locked": "超级管理员可访问每一行。",
    "saveFirst": "请先保存或放弃对权限的更改。",
    "action": "行",
    "actionLabel": {
      "read": "读取",
      "update": "修改",
      "delete": "删除"
    },
    "way": {
      "person": "{column} 中的人员",
      "listingDated": "当天在 {table} 中为它登记的任何人",
      "listing": "在 {table} 中为它登记的任何人",
      "parent": "能访问其所属{table}的人",
      "whileIn": "仅当 {column} 为 {values} 时",
      "whileEmpty": "仅当 {column} 为空时",
      "whileSet": "仅当 {column} 已填写时"
    },
    "follows": "跟随：{table}",
    "belongs": "一行属于{ways}。",
    "sentence": {
      "all": "{table} 的每一行。",
      "allWhile": "{table} 的每一行",
      "team": "仅属于此人的行，或属于其所带团队成员的行",
      "own": "仅属于此人的行",
      "unowned": "以及尚无人负责的行",
      "while": "仅当 {column} 为 {values} 时",
      "by": "且仅限 {column} 指明为其本人的行",
      "notThrough": "但不包括作为 {listings} 中所列人员的情况",
      "viaOwn": "仅 {table} 中其 {via} 的 {column} 指明为其本人的行",
      "viaTeam": "仅 {table} 中其 {via} 的 {column} 指明为其本人或其所带团队成员的行",
      "allWho": "{table} 的每一行，无论 {column} 是谁。",
      "only": "仅 {table} 中{ways}的行",
      "onlyTeam": "仅 {table} 中{ways}的行，或其所带团队成员的行",
      "onlyTeamWays": "仅 {table} 中{ways}的行，或对其所带团队成员同样成立的行"
    },
    "title": "“{role}”可访问哪些行",
    "intro": "角色可以访问它能打开的表中的每一行，除非在此加以限制。只有当给某人该表的每个角色都受限时，限制才对此人生效。",
    "loadFailed": "无法读取这些表。",
    "empty": {
      "title": "没有可限制的内容",
      "body": "此角色可打开的表都没有说明行属于谁。"
    },
    "tryAs": "以此人身份试看",
    "tryAsNone": "无",
    "samplePerson": "{name}（示例）",
    "failed": "无法保存行限制",
    "private": "仅由每行所属的人员读取，其他人都不能读取。这里没有可选项。",
    "reachLabel": "{action}：哪些行",
    "reach": {
      "all": "所有行",
      "own": "自己的",
      "team": "团队的",
      "allWhile": "每一行，仅当…"
    },
    "unowned": "以及尚无人负责的行",
    "widened": "此角色通过范围更宽的权限打开该表。保存限制时，也会按名称把该表授予它。",
    "count": "{name} 将看到 {table} 的 {total} 行中的 {reached} 行。",
    "capped": "此人带领的人数超过了单个范围的上限，因此未统计其整个团队。",
    "lifted": "{name} 还拥有 {roles}，该角色可访问每一行。此限制对其不生效。",
    "several": "满足其中任意一条即可。这些由应用设定，并按应用所写保留。",
    "wayIs": {
      "person": "{column} 为此人",
      "listing": "此人登记在 {table} 中",
      "listingDated": "此人当天登记在 {table} 中",
      "parent": "此人能访问其所属{table}"
    }
  },
  "partsOff": "它所属的应用部分已关闭：在该部分开启之前不授予任何权限。",
  "people": {
    "unnamed": "未具名人员"
  }
} as const;
