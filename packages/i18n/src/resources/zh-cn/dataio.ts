// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/dataio.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "back": "返回",
  "import": {
    "stepUpload": "上传",
    "stepMap": "映射列",
    "stepValidate": "校验",
    "stepRun": "导入并核查",
    "targetLabel": "目标表",
    "targetPlaceholder": "选择一个表页面…",
    "notATable": "该页面不是数据表——请选择要导入的表页面。",
    "dropTitle": "拖放 CSV 文件以导入",
    "dropHint": "CSV 最大 32 MB——第一行必须是表头",
    "skipTarget": "不导入",
    "mapHint": "{file} 中有 {count} 行数据——请为每一列选择目标。",
    "validating": "正在校验…",
    "toValidate": "校验",
    "validateFailed": "校验失败。",
    "validationSummary": "{total} 行中有 {valid} 行可导入——将跳过 {invalid} 行。",
    "allValid": "所有行均通过校验",
    "run": "运行导入",
    "runSkipping": "导入 {valid} 行（跳过 {invalid} 行）",
    "progressLabel": "导入进度",
    "running": "正在导入…",
    "kpiTotal": "文件中的行数",
    "kpiCreated": "已创建",
    "kpiUpdated": "已更新",
    "kpiSkipped": "已跳过",
    "inconsistent": "导入数字不一致——总数必须等于已创建 + 已更新 + 已跳过。",
    "downloadErrors": "下载跳过行报告（CSV）",
    "runFailed": "导入失败。"
  },
  "exports": {
    "tableLabel": "数据表",
    "tablePlaceholder": "选择数据表…",
    "notATable": "该页面不是数据表——请选择要导出的表页面。",
    "formatLabel": "格式",
    "create": "导出",
    "createFailed": "无法发起导出。",
    "retention": "导出文件保留 30 天后过期。",
    "statusProcessing": "处理中…",
    "statusReady": "已就绪——{rows} 行·点击下载",
    "statusFailed": "失败——{error}",
    "statusCancelled": "已取消",
    "statusExpired": "已过期",
    "emptyTitle": "还没有导出",
    "emptyBody": "在上方发起导出——生成的文件将连同状态显示在这里。",
    "new": "新建导出"
  },
  "builder": {
    "title": "新建导出",
    "subtitle": "选择数据表，挑选列，检查文件，然后导出。",
    "cancel": "取消",
    "backToExports": "返回数据导出",
    "basedOn": "基于 {name}",
    "noAccess": {
      "title": "暂时没有可导出的内容",
      "body": "您对此连接的任何数据表都没有导出权限。请管理员在{link}中授予。",
      "link": "角色与权限"
    },
    "step": "第 {n} 步，共 3 步",
    "steps": {
      "source": "来源",
      "columns": "列",
      "preview": "预览"
    },
    "continue": "继续",
    "export": "导出",
    "back": "返回",
    "hint": {
      "chooseTable": "选择一个数据表以继续。",
      "fromAll": "从 {table} 的全部列开始。",
      "fromPage": "从绑定到 {table} 的页面开始。",
      "noColumns": "至少添加一列以继续。",
      "dupes": "有两列使用了相同的标题。请重命名其中一列以继续。",
      "order": "将按此顺序写入 {n} 列。",
      "readSample": "导出前请先查看样本。",
      "downloads": "文件准备好后可在数据导出中下载。"
    },
    "source": {
      "title": "哪个数据表？",
      "search": "搜索数据表…",
      "meta": "{rows} 行 · {cols} 列",
      "metaNoRows": "{cols} 列",
      "usedBy": "被 {n, plural, other {# 个页面}}使用",
      "locked": "无导出权限",
      "lockedToast": "您没有 {table} 的导出权限"
    },
    "startFrom": {
      "title": "起点",
      "body": "选择列清单从哪里开始。下一步中可以更改所有内容。",
      "all": "{table} 的全部列",
      "page": "某个页面的列 — {page}",
      "pageMeta": "{page} · {n} 列 · {linked} 个关联 · {totals, plural, other {# 个合计}}",
      "none": "没有页面绑定到此数据表"
    },
    "columns": {
      "title": "文件中包含什么。",
      "add": "添加列",
      "inFile": "您的文件中",
      "summary": "{n} 列 · {linked} 个关联 · {totals, plural, other {# 个合计}}",
      "reset": "重置为数据表的列",
      "removeAll": "全部移除",
      "empty": {
        "title": "还没有列",
        "body": "从面板添加列，或重置为数据表自身的列。"
      },
      "dragTitle": "拖动以重新排序，或使用方向键",
      "reorder": "重新排序 {header}",
      "headerLabel": "文件中的标题",
      "masked": "除非您拥有显示权限，否则导出为 •••••",
      "dupe": "另一列使用了此标题",
      "removeTitle": "从文件中移除",
      "remove": "移除 {header}"
    },
    "browser": {
      "search": "搜索列…",
      "broken": "该关联已无法解析——请重新开始。",
      "brokenBack": "返回全部数据表",
      "suggested": "建议",
      "fromTable": "来自 {table}",
      "fromTheTable": "来自数据表",
      "readOnly": "只读列",
      "noMatch": "没有列匹配该搜索。",
      "allIn": "此数据表的所有列都已在您的文件中。",
      "linked": "来自关联的数据表",
      "budget": "{used} / {max}",
      "inbound": "关联到此表的数据表",
      "via": "经由 {column}",
      "count": "计数",
      "aggregate": "聚合",
      "add": "添加",
      "singleNote": "最小值和最大值只取一列。",
      "limit": "已达上限——移除一个才能再添加",
      "fourMax": "最多四列",
      "pickNumeric": "请先选择一个数值列",
      "already": "{header} 已在您的文件中",
      "added": "已添加 {header}",
      "calculated": "计算列",
      "hop": "添加一列，或继续沿关联向外查找。",
      "hopLimit": "最多三层关联。在此添加一列，或返回上一层。",
      "addName": "添加 {name}",
      "noRead": "无读取权限"
    },
    "calc": {
      "arith": "两列相加或相减",
      "first": "第一列",
      "op": "运算符",
      "second": "第二列",
      "pct": "某一列的百分比",
      "pctLabel": "百分比",
      "pctOf": "% 的",
      "column": "列",
      "rule": "带阈值的规则",
      "if": "如果",
      "isOver": "超过",
      "then": "则",
      "else": "否则",
      "threshold": "阈值",
      "whenOver": "超过时的值",
      "otherwise": "否则的值",
      "needTwo": "请先添加两个数值列",
      "needOne": "请先添加一个数值列"
    },
    "gen": {
      "count": "{table} 计数",
      "countSrc": "经由 {column} 统计 {table}",
      "foldSrc": "{table}.{cols} 的{fn}",
      "linkedSrc": "{table}.{column} 经由 {path}",
      "arithHeader": "{a} {op} {b}",
      "pctHeader": "{a} 的 {pct}%",
      "ruleHeader": "{then} 或 {else}",
      "ruleSrc": "如果 {a} 超过 {threshold} 则 {then}，否则 {else}",
      "sumOf": "合计",
      "average": "平均",
      "min": "最小",
      "max": "最大"
    },
    "badge": {
      "key": "键",
      "linked": "关联",
      "count": "计数",
      "sum": "合计",
      "avg": "平均",
      "min": "最小",
      "max": "最大",
      "calculated": "计算",
      "masked": "已隐藏"
    },
    "fold": {
      "sum": "合计",
      "avg": "平均",
      "min": "最小",
      "max": "最大"
    },
    "preview": {
      "title": "检查文件，然后导出。",
      "fileName": "文件名",
      "format": "格式",
      "csv": "CSV",
      "jsonl": "JSON Lines",
      "rows": "行",
      "allRows": "全部行 · {n}",
      "allRowsUnknown": "全部行",
      "viewRows": "已保存视图的行",
      "savedView": "已保存的视图",
      "viewLabel": "{name} · {filters} 个筛选 · {rows} 行",
      "viewLabelNoRows": "{name} · {filters} 个筛选",
      "headerRow": "标题行",
      "tabTable": "表格",
      "tabRaw": "原始文件",
      "sample": "{n} 行样本 · 刷新于{when}",
      "justNow": "刚刚",
      "minutesAgo": "{n, plural, other {# 分钟前}}",
      "refresh": "刷新",
      "failed": "无法读取样本。",
      "failedTimeout": "连接响应太慢。导出本身尚未运行。",
      "retry": "重试",
      "headerOnly": "文件将只包含标题行。"
    },
    "summary": {
      "title": "文件",
      "columns": "列数",
      "rows": "行数",
      "size": "预计大小",
      "retention": "保留期",
      "kept": "保留 30 天",
      "fileName": "文件名"
    },
    "warn": {
      "title": "需要了解",
      "masked": "{n, plural, other {# 列}}将以隐藏方式导出",
      "search": "此视图带有搜索词，导出无法包含它",
      "noRows": "此数据表目前没有任何行"
    },
    "started": {
      "preparing": "正在准备 {file} · {rows} 行",
      "ready": "已就绪 · {rows} 行",
      "noteBusy": "它会出现在数据导出中，准备好后可在那里下载。",
      "noteReady": "已就绪。它也在数据导出中，您可以稍后再回来。",
      "download": "下载 {format}",
      "busy": "正在准备文件…",
      "another": "再导出一个",
      "failed": "导出失败。"
    },
    "toast": {
      "started": "导出已开始"
    }
  }
} as const;
