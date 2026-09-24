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
    "storageManage": "管理存储目标"
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
  }
} as const;
