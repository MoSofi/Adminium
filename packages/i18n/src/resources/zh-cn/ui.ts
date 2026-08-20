// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-CN/ui.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "close": "关闭",
    "cancel": "取消",
    "confirm": "确认",
    "save": "保存",
    "apply": "应用",
    "delete": "删除",
    "edit": "编辑",
    "copy": "复制",
    "copied": "已复制",
    "undo": "撤销",
    "retry": "重试",
    "clear": "清除",
    "selectAll": "全选",
    "clearSelection": "清除所选",
    "showPassword": "显示密码",
    "hidePassword": "隐藏密码",
    "reveal": "显示",
    "hide": "隐藏",
    "clearSearch": "清除搜索"
  },
  "state": {
    "loading": "加载中…",
    "empty": "这里还没有内容",
    "noResults": "没有结果",
    "optional": "可选",
    "required": "必填",
    "error": "出错了"
  },
  "pagination": {
    "previous": "上一页",
    "next": "下一页",
    "pageOf": "第 {page, number} 页，共 {pages, number} 页",
    "rowsPerPage": "每页行数",
    "range": "第 {from, number}–{to, number} 条，共 {total, number} 条"
  },
  "table": {
    "sortAscending": "升序排序",
    "sortDescending": "降序排序",
    "rowActions": "行操作",
    "selectRow": "选择此行",
    "selectAllRows": "选择所有行"
  },
  "dialog": {
    "close": "关闭对话框",
    "confirmTitle": "确定要继续吗？"
  },
  "combobox": {
    "placeholder": "请选择…",
    "search": "搜索…",
    "noMatches": "无匹配项"
  },
  "toast": {
    "dismiss": "关闭通知"
  },
  "widgets": {
    "kpi": {
      "statCard": {
        "description": "常用指标卡：一个主要聚合值，可选趋势徽标和迷你迷你图。"
      },
      "usageMeter": {
        "description": "配额用量与上限的对比；超过所设阈值后，进度条会依次变为橙色和红色。",
        "usageLabel": "用量",
        "ofLabel": "/"
      },
      "statTileCompact": {
        "description": "纤薄的指标磁贴，含微型标签、趋势标记和 6 条迷你图——适合 4 至 6 个一行的密集布局。"
      },
      "metricHero": {
        "description": "一个超大指标，加载时数字递增，附带趋势徽标、迷你图和目标进度。",
        "goalLabel": "目标"
      },
      "statPairCard": {
        "description": "两个指标并排显示；第二个可由第一个推导得出。"
      },
      "gaugeRing": {
        "description": "用于分数或百分比的环形仪表，按数值所处区间着色。"
      },
      "gaugeArc": {
        "description": "带定性区间和指针的速度表弧线；也可呈现仪表网格。",
        "emptyTitle": "暂无可显示的仪表",
        "emptyBody": "服务有读数后，将在此处显示为仪表。"
      },
      "periodComparison": {
        "description": "本期与上期以两条进度条对比，下方给出计算出的差值。",
        "higherLabel": "更高",
        "lowerLabel": "更低",
        "flatLabel": "持平",
        "periodALabel": "本期",
        "periodBLabel": "上期"
      },
      "microKpiSubtitle": {
        "description": "由模板生成的单行页眉统计，随实时状态重新计算。"
      },
      "autoInsights": {
        "description": "按重要性排序的洞察条目——主要数字、说明句和迷你图——并可刷新轮换。",
        "emptyTitle": "暂无洞察",
        "emptyBody": "数据足以呈现规律后，洞察就会显示在这里。",
        "refreshLabel": "刷新"
      }
    },
    "charts": {
      "boxplot": {
        "description": "按类别汇总数值列分布的箱线图——最小值、四分位数、中位数和最大值。",
        "emptyTitle": "没有可绘制的分布",
        "emptyBody": "没有符合筛选条件的行可用于箱线图。",
        "chartLabel": "箱线图"
      },
      "violin": {
        "description": "镜像密度曲线，比较数值列在各组之间的分布。",
        "emptyTitle": "没有可绘制的分布",
        "emptyBody": "没有符合筛选条件的行可用于密度曲线。",
        "chartLabel": "小提琴图"
      },
      "ridgeline": {
        "description": "重叠的密度山脊图，比较数值列在有序分组间的分布。",
        "emptyTitle": "没有可绘制的山脊",
        "emptyBody": "没有符合筛选条件的行可用于密度曲线。",
        "chartLabel": "山脊图"
      },
      "scatterBubble": {
        "description": "将两个数值列绘制为散点，可选气泡大小和趋势线。",
        "emptyTitle": "没有可绘制的散点",
        "emptyBody": "没有符合筛选条件的行匹配所选列。",
        "chartLabel": "散点图"
      },
      "hexbin": {
        "description": "两个数值列的六边形密度图，按每格落入的行数着色。",
        "emptyTitle": "没有可绘制的密度",
        "emptyBody": "没有符合筛选条件的行可供分箱。",
        "chartLabel": "六边形密度图"
      },
      "correlationMatrix": {
        "description": "所选数值列之间的皮尔逊相关性，从强正相关到强负相关。",
        "emptyTitle": "没有可计算的相关性",
        "emptyBody": "请至少选择两个具有匹配行的数值列。",
        "chartLabel": "相关性矩阵"
      },
      "parallelCoordinates": {
        "description": "将每条记录绘制为跨多个归一化数值轴的折线，按类别着色。",
        "emptyTitle": "没有可绘制的记录",
        "emptyBody": "没有符合筛选条件的行覆盖所选各轴。",
        "chartLabel": "平行坐标图"
      },
      "unexpectedShape": "数据结构不符合预期。",
      "lineArea": {
        "chartLabel": "折线图",
        "description": "以折线呈现指标随时间的变化，并带柔和的面积填充，可选叠加上期对比虚线。"
      },
      "bar": {
        "chartLabel": "柱状图",
        "description": "以垂直柱形呈现分类或按时间分桶的数值，可选高亮最大柱或当前柱。"
      },
      "donut": {
        "chartLabel": "环形图",
        "otherLabel": "其他",
        "description": "以环形扇区呈现各类别占比，含图例和中心合计，并将细小扇区归入“其他”。"
      },
      "bullet": {
        "chartLabel": "子弹图",
        "description": "在定性区间上以度量条呈现目标完成进度，每行带一个目标刻度。",
        "emptyTitle": "暂无可跟踪的目标",
        "emptyBody": "添加带目标值的度量即可进行对比。"
      },
      "rankingBars": {
        "chartLabel": "排名",
        "description": "以水平条形呈现前 N 名排名——第一名满色，其余淡化——并在旁显示数值。",
        "emptyTitle": "暂无可排名的内容",
        "emptyBody": "尚无记录符合此细分。"
      },
      "pareto": {
        "chartLabel": "帕累托图",
        "description": "排序后的类别柱形，上方为累计百分比折线，可选 80% 分界线。",
        "emptyTitle": "暂无可绘制的类别",
        "emptyBody": "此范围没有返回分组计数。"
      },
      "waterfall": {
        "chartLabel": "瀑布图",
        "description": "以浮动柱形从起始合计经正负增减过渡到净合计。",
        "emptyTitle": "暂无可衔接的变动",
        "emptyBody": "未找到起始、变动或合计步骤。"
      },
      "marimekko": {
        "chartLabel": "马赛克图",
        "description": "以宽度可变的堆叠柱呈现两级构成——宽度表示外层占比，分段表示内层拆分。",
        "emptyTitle": "暂无可拆解的构成",
        "emptyBody": "此范围没有返回两级细分。"
      },
      "stackedBar100": {
        "chartLabel": "100% 堆叠条形图",
        "description": "一条 100% 的条形按比例拆分为若干分段并配图例，用于比较各部分在整体中的占比。",
        "emptyTitle": "暂无可拆分的占比",
        "emptyBody": "此细分没有返回任何组成部分。"
      },
      "slope": {
        "chartLabel": "斜率图",
        "description": "每条记录用一条线连接两个时期，并按数值上升或下降着色。",
        "emptyTitle": "暂无可显示的期间变化",
        "emptyBody": "没有返回可供对比的前后数值。"
      },
      "multiline": {
        "chartLabel": "多折线图",
        "description": "多个系列叠加为折线并在末端标注，用于比较同一时间跨度内的趋势。",
        "emptyTitle": "暂无可绘制的系列",
        "emptyBody": "此范围没有符合筛选条件的时间序列。"
      },
      "stream": {
        "chartLabel": "流图",
        "description": "围绕中心线流动的堆叠色带，展示总量的构成如何随时间变化。",
        "emptyTitle": "暂无可绘制的流量",
        "emptyBody": "此范围没有返回堆叠系列。"
      },
      "forecast": {
        "chartLabel": "预测图",
        "nowLabel": "现在",
        "forecastLabel": "预测",
        "actualLabel": "实际",
        "description": "历史折线由虚线预测延伸，置于逐渐变宽的置信区间内，并在“现在”处以分隔线断开。",
        "emptyTitle": "暂无可用于预测的历史",
        "emptyBody": "没有返回可供预测的历史数据点。"
      },
      "anomaly": {
        "chartLabel": "异常图",
        "description": "数值折线叠加在预期区间上，超出区间的点以光晕圆点标出。",
        "emptyTitle": "暂无可扫描的信号",
        "emptyBody": "没有返回可供检测异常的数据点。"
      },
      "candlestick": {
        "chartLabel": "K 线图",
        "livePillLabel": "实时",
        "description": "开高低收蜡烛按涨跌着色，附最新价虚线，可选实时标记。",
        "emptyTitle": "暂无可绘制的 K 线",
        "emptyBody": "此范围没有符合条件的开高低收数据行。"
      },
      "bump": {
        "chartLabel": "名次变化图",
        "description": "排名随时间变化的折线，展示各方在不同时期如何互换位次。",
        "emptyTitle": "暂无可追踪的排名",
        "emptyBody": "没有返回逐期排名数据。"
      },
      "timelineLanes": {
        "chartLabel": "时间线泳道",
        "laneLabel": "事件",
        "description": "带日期的事件以胶囊形式排布在共享同一时间轴的横向泳道上。",
        "emptyTitle": "暂无可排布的事件",
        "emptyBody": "此范围没有符合筛选条件的事件。"
      },
      "treemap": {
        "chartLabel": "矩形树图",
        "otherLabel": "其他",
        "description": "以按数值确定大小的方块呈现部分与整体的构成，并将细小分块归入“其他”方块。",
        "emptyTitle": "暂无可平铺的分块",
        "emptyBody": "此细分没有返回任何类别。"
      },
      "sunburst": {
        "chartLabel": "旭日图",
        "description": "以嵌套圆环呈现两级层次——父级在内、子级在外——并附父级图例。",
        "emptyTitle": "暂无可绘制的圆环",
        "emptyBody": "没有返回可嵌套的分组类别。"
      },
      "funnel": {
        "chartLabel": "漏斗图",
        "description": "依次收窄的有序阶段，含每步的继续率和总体转化率页脚。",
        "emptyTitle": "暂无可呈现的阶段",
        "emptyBody": "此范围没有返回各步骤的计数。"
      },
      "radialBar": {
        "chartLabel": "径向条形图",
        "description": "最多四个百分比以同心进度环呈现，并附圆点图例。",
        "emptyTitle": "暂无可填充的圆环",
        "emptyBody": "尚无类别符合此细分。"
      },
      "radar": {
        "chartLabel": "雷达图",
        "description": "多个命名坐标轴构成多边形，每个系列一个填充形状，可叠加目标参考。",
        "emptyTitle": "暂无可对比的坐标轴",
        "emptyBody": "没有返回系列与坐标轴的矩阵数据。"
      },
      "chord": {
        "chartLabel": "弦图",
        "description": "环上节点之间的两两流量以色带呈现，色带透明度按流量加权。",
        "emptyTitle": "暂无可连接的流量",
        "emptyBody": "没有返回分组之间的关联。"
      },
      "wordcloud": {
        "chartLabel": "词云",
        "description": "词条按出现频率确定字号并按行排布，一眼看清哪些内容占主导。",
        "emptyTitle": "暂无可生成词云的词条",
        "emptyBody": "没有符合筛选条件的加权词条。"
      },
      "cohortMatrix": {
        "chartLabel": "同期群留存",
        "description": "同期群为行、周期为列，每个单元格按留存率或收入着色。",
        "regionLabel": "Cohort matrix"
      },
      "heatmapCalendar": {
        "chartLabel": "活动日历",
        "legendLessLabel": "较少",
        "legendMoreLabel": "较多",
        "description": "以周×日的网格呈现全年每日活动，按强度着色。",
        "regionLabel": "Activity calendar"
      },
      "heatMonth": {
        "chartLabel": "每月活动",
        "description": "将一个自然月呈现为日期网格，按每天的数值着色。",
        "regionLabel": "Monthly heat map"
      },
      "choroplethGrid": {
        "chartLabel": "区域细分",
        "legendLowLabel": "低",
        "legendHighLabel": "高",
        "description": "以着色的美国方块地图或紧凑网格呈现各区域数值，可选附前 N 名排行榜。"
      },
      "sankey": {
        "chartLabel": "流向图",
        "description": "分层的源到目标流向以色带呈现，色带粗细表示流量大小。"
      },
      "sparkline": {
        "description": "近期数值的内联迷你走势——无坐标轴与标签——适用于指标卡、表格单元格和列表行。"
      }
    },
    "feeds": {
      "activityFeed": {
        "description": "按时间倒序显示工作区中谁做了什么的动态信息流。",
        "emptyTitle": "暂无近期动态",
        "emptyBody": "工作区中的操作将显示在这里。",
        "viewAllLabel": "查看全部"
      },
      "notificationFeed": {
        "description": "带未读状态、筛选和内联操作的分组通知。",
        "emptyTitle": "暂无通知",
        "emptyBody": "新通知将显示在这里。",
        "allLabel": "全部",
        "unreadLabel": "未读",
        "mentionsLabel": "提及",
        "filterLabel": "通知筛选",
        "markAllReadLabel": "全部标为已读",
        "todayLabel": "今天",
        "yesterdayLabel": "昨天",
        "earlierLabel": "更早",
        "dismissLabel": "关闭",
        "emptyUnreadTitle": "已全部读完",
        "emptyMentionsTitle": "暂无提及"
      },
      "realtimeFeed": {
        "description": "实时事件流，新条目到达时会置于顶部。",
        "emptyTitle": "正在等待事件",
        "emptyBody": "实时事件将随发生实时显示。",
        "liveLabel": "实时",
        "pausedLabel": "已暂停",
        "pauseLabel": "暂停",
        "resumeLabel": "继续"
      },
      "timelineVertical": {
        "description": "事件、发布、故障或执行步骤的垂直时间线。",
        "emptyTitle": "这里还没有内容",
        "emptyBody": "事件将随发生显示在此时间线上。"
      },
      "unreadBadge": {
        "description": "显示未读条目的计数标记，与信息流状态同步。",
        "unitLabel": "未读"
      },
      "loadOlderPaginator": {
        "description": "页脚按钮，分批加载更早的记录，直至动态流加载完毕。",
        "label": "加载更早",
        "loadingLabel": "加载中…",
        "exhaustedLabel": "没有更早的了",
        "ofLabel": "/"
      },
      "toastStack": {
        "description": "浮层提示宿主：简短的操作确认，可附带撤销。",
        "undoLabel": "撤销",
        "dismissLabel": "关闭",
        "regionLabel": "通知"
      }
    },
    "calendar": {
      "calendarMonth": {
        "description": "按月显示已排期事件的网格，含每日标签和月份导航。",
        "emptyTitle": "暂无排期",
        "emptyBody": "已排期的事件将显示在此日历中。",
        "previousLabel": "上个月",
        "nextLabel": "下个月",
        "overflowLabel": "+{count} 项"
      },
      "dayAgenda": {
        "description": "所选日期的事件按时间排序的日程。",
        "emptyTitle": "暂无排期",
        "emptyBody": "所选日期的事件将显示在此处。",
        "countLabel": "{count, plural, other {{n} events}}"
      },
      "scheduleMatrix": {
        "description": "按资源和日期排列的班次网格，含每日覆盖情况和图例。",
        "emptyTitle": "暂无排班",
        "emptyBody": "已分配的班次将显示在此排班表中。",
        "resourceLabel": "资源",
        "coverageLabel": "覆盖情况",
        "hoursLabel": "{hours} 小时"
      },
      "capacityBoard": {
        "description": "按成员显示利用率条，含项目细分和负载状态。",
        "emptyTitle": "暂无工作量数据",
        "emptyBody": "有分配后，成员的利用率将显示在此处。",
        "status": {
          "overloaded": "超负荷",
          "balanced": "均衡",
          "available": "有余量"
        },
        "utilizationLabel": "{name}：{util}%",
        "assignmentLabel": "{project} · {hours} 小时",
        "periodLabel": "小时 · {period}",
        "period": {
          "week": "周",
          "month": "月"
        }
      },
      "calendarLegendFilter": {
        "description": "带计数的事件类别；切换即可筛选旁边的日历。",
        "emptyTitle": "暂无类别",
        "emptyBody": "有事件后，事件类别将显示在这里。",
        "uncategorizedLabel": "未分类",
        "listLabel": "Categories"
      },
      "upcomingEventsList": {
        "description": "按日期排列的近期事件，含负责人和状态。",
        "emptyTitle": "暂无即将开始的事件",
        "emptyBody": "计划中的事件将陆续显示在这里。",
        "listLabel": "Upcoming events"
      },
      "dateRangePicker": {
        "description": "带快捷选项的日期范围，可筛选页面其余内容。",
        "previousLabel": "上个月",
        "nextLabel": "下个月",
        "summaryLabel": "已选择 {n} 天",
        "presets": {
          "7d": "最近 7 天",
          "30d": "最近 30 天",
          "90d": "最近 90 天",
          "mtd": "本月至今",
          "qtd": "本季度至今",
          "ytd": "今年至今"
        }
      },
      "scheduledJobsList": {
        "description": "周期性报表和导出任务，含频率、下次运行时间和开关。",
        "emptyTitle": "暂无计划任务",
        "emptyBody": "计划周期性报表或导出后，将显示在这里。",
        "nextRunLabel": "下次运行",
        "toggleLabel": "启用计划",
        "recipientsLabel": "接收人",
        "listLabel": "Scheduled jobs"
      }
    },
    "tables": {
      "masterList": {
        "description": "可选择的记录列表，用于驱动详情面板。",
        "emptyTitle": "暂无条目",
        "emptyBody": "条目存在后将显示在这里。",
        "allLabel": "全部",
        "toggleLabel": "切换{title}",
        "progressLabel": "{title}进度"
      },
      "logTable": {
        "description": "带搜索、错误筛选和行操作的追加式事件日志。",
        "emptyTitle": "暂无日志条目",
        "emptyBody": "事件将随发生记录在这里。",
        "liveLabel": "实时",
        "placeholder": "搜索日志…",
        "filterLabel": "日志筛选",
        "allLabel": "全部",
        "errorsLabel": "错误",
        "noMatchesLabel": "没有匹配的条目",
        "todayLabel": "今天",
        "yesterdayLabel": "昨天",
        "action": {
          "retry": "重试",
          "download": "下载",
          "inspect": "查看"
        }
      },
      "cardGallery": {
        "description": "带状态和快捷操作的自适应实体卡片库。",
        "emptyTitle": "暂无内容",
        "emptyBody": "条目将以卡片形式显示在这里。"
      },
      "groupedSummaryTable": {
        "description": "带汇总列、可展开明细和合计的分组行。",
        "emptyTitle": "暂无汇总数据",
        "emptyBody": "有数据后分组合计将显示在这里。",
        "groupLabel": "分组",
        "totalsLabel": "合计"
      },
      "schemaTree": {
        "description": "带类型和键徽章的架构、表和列浏览器。",
        "emptyTitle": "尚未读取架构",
        "emptyBody": "连接数据库即可在此浏览其架构。",
        "treeLabel": "架构",
        "viewLabel": "视图"
      },
      "toggleMatrix": {
        "description": "用于角色、策略或渠道的布尔开关交互网格。",
        "emptyTitle": "尚未配置矩阵",
        "emptyBody": "配置后行和列将显示在这里。",
        "matrixLabel": "权限矩阵",
        "rowHeaderLabel": "权限"
      },
      "sparklineTable": {
        "description": "指标行，包含迷你走势图、当前值和可区分好坏方向的变化标签。",
        "emptyTitle": "暂无指标",
        "emptyBody": "有数据可汇总后，指标将显示在这里。"
      },
      "topMoversList": {
        "description": "变化最大的指标，并按每项指标判断方向是好还是坏。",
        "emptyTitle": "暂无变化",
        "emptyBody": "变化最大的指标将显示在这里。"
      },
      "rankedEntityList": {
        "description": "按指标排名的实体，附排名序号和等比条形。",
        "emptyTitle": "暂无排名",
        "emptyBody": "有数据可排序后，排名靠前的实体将显示在这里。"
      },
      "accordionList": {
        "description": "可展开的行，带徽标和详情面板，支持单开或多开。",
        "emptyTitle": "暂无可展开内容",
        "emptyBody": "有条目后将显示在这里。"
      },
      "comparisonMatrix": {
        "description": "对比套餐的功能网格，其中一列会突出显示。",
        "includedLabel": "包含",
        "notIncludedLabel": "不包含",
        "promotedLabel": "推荐"
      },
      "chipCloud": {
        "description": "自动换行的标签，用于展示发现的数据表、合并变量或建议。",
        "emptyTitle": "尚未发现内容",
        "emptyBody": "发现数据表和变量后，将以标签形式显示在这里。",
        "moreLabel": "还有 {n} 个"
      },
      "dataGrid": {
        "selectAllLabel": "选择所有行",
        "selectRowLabel": "选择此行",
        "sortByLabel": "按{column}排序",
        "description": "标准的增删改查表格，含可排序列、行选择和类型感知单元格。"
      },
      "paginationFooter": {
        "emptyLabel": "0 行",
        "ofLabel": "/",
        "pageSizeLabel": "行数",
        "a11y": {
          "pageSize": "每页行数"
        },
        "prevLabel": "上一页",
        "nextLabel": "下一页",
        "description": "页脚，显示当前可见的行范围、上一页/下一页翻页和每页行数选择器。"
      },
      "bulkActionToolbar": {
        "selectedLabel": "项已选",
        "clearLabel": "清除所选",
        "toolbarLabel": "批量操作",
        "description": "感知选择状态的工具栏，显示已选数量和批量操作。"
      },
      "miniTable": {
        "viewAllLabel": "查看全部",
        "description": "紧凑的仪表板行列表，含映射列和“查看全部”链接。"
      },
      "revealLabel": "显示值",
      "hideLabel": "隐藏值",
      "trueLabel": "是",
      "falseLabel": "否",
      "detailKeyValue": {
        "description": "将记录的字段呈现为标签/值行，值按类型渲染。"
      }
    },
    "boards": {
      "kanbanBoard": {
        "description": "固定的状态列与可拖动卡片；将卡片拖到其他列即可更新其状态。",
        "emptyTitle": "暂无卡片",
        "emptyBody": "创建记录后，卡片将出现在对应的状态列中。"
      },
      "kanbanSwimlaneGrid": {
        "description": "泳道 × 列的网格；拖动卡片会同时重新分配其泳道和状态。",
        "emptyTitle": "没有可显示的泳道",
        "emptyBody": "按泳道字段和状态字段对记录分组以构建网格。"
      },
      "addCard": "添加卡片",
      "grip": "拖动以移动卡片",
      "pointsUnit": "点",
      "laneSummary": "Σ{points} 点 · {count}",
      "a11y": {
        "grabbed": "已抓取 {title}。使用方向键移动，回车放下，Esc 取消。",
        "over": "{title} 位于 {cell} 上方。",
        "moved": "已将 {title} 移动到 {cell}。",
        "returned": "{title} 已返回原位。",
        "failed": "无法移动 {title}；已返回原位。"
      },
      "boardCard": {
        "description": "单张看板卡片：标签、标题、进度、负责人和截止日期。",
        "emptyTitle": "暂无卡片",
        "emptyBody": "此卡片尚未绑定任何记录。"
      },
      "inlineComposeCard": {
        "description": "快速添加，使用该列的默认值创建新记录。",
        "placeholder": "卡片标题…",
        "addLabel": "添加",
        "cancelLabel": "取消",
        "openLabel": "添加卡片"
      }
    },
    "communication": {
      "conversationInbox": {
        "description": "可选择的会话列表，显示未读数量、在线状态和最近消息预览。",
        "emptyTitle": "暂无会话",
        "emptyBody": "收到消息后，会话将显示在这里。",
        "noMatchesTitle": "没有匹配的会话",
        "searchLabel": "搜索会话",
        "searchPlaceholder": "搜索会话…"
      },
      "chatThread": {
        "description": "按发送者和日期分组的消息气泡，支持附件和输入框。",
        "emptyTitle": "暂无消息",
        "emptyBody": "该会话中的消息将显示在这里。",
        "composerPlaceholder": "输入消息…",
        "sendLabel": "发送",
        "attachLabel": "添加附件",
        "typingLabel": "正在输入…",
        "composerLabel": "消息",
        "transcriptLabel": "Conversation"
      },
      "aiChatPanel": {
        "description": "用于询问数据库结构和数据的助手面板。",
        "emptyTitle": "询问你的数据",
        "emptyBody": "提出关于结构、数据表或指标的问题即可开始。",
        "composerPlaceholder": "提出问题…",
        "sendLabel": "发送",
        "pendingLabel": "思考中…",
        "configureTitle": "尚未配置 AI 提供方",
        "configureBody": "添加 Anthropic 或 OpenAI 密钥，或将 Adminium 指向你自己的接口地址，即可询问数据库结构。",
        "configureCtaLabel": "配置提供方",
        "assistantLabel": "助手",
        "composerLabel": "提出问题",
        "transcriptLabel": "Assistant transcript"
      },
      "typingIndicator": {
        "description": "头像加斜体“正在输入…”行，绑定到每个会话的实时布尔值。",
        "label": "正在输入…",
        "emptyTitle": "暂无输入动态",
        "emptyBody": "会话开始后，输入状态会显示在这里。"
      },
      "callWidget": {
        "description": "来电（语音或视频）：来电者头像、通话状态，以及接听或拒接操作。",
        "voiceLabel": "语音通话",
        "videoLabel": "视频通话",
        "ringingLabel": "正在响铃…",
        "connectingLabel": "正在连接…",
        "activeLabel": "通话中",
        "endedLabel": "通话已结束",
        "acceptLabel": "接听",
        "declineLabel": "拒接",
        "endLabel": "结束通话",
        "emptyTitle": "没有进行中的通话",
        "emptyBody": "来电会显示在这里。"
      }
    },
    "geo": {
      "mapBubble": {
        "description": "地图上的圆形标记按所选指标缩放，并附带排名靠前地点的列表。",
        "emptyTitle": "没有位置",
        "emptyBody": "包含纬度和经度的行会在这里显示为地图标记。",
        "mapUnavailableLabel": "地图无法加载。排名列表显示的是相同数据。",
        "regionsLabel": "热门区域",
        "metricLabel": "指标"
      },
      "mapChoroplethGrid": {
        "description": "按数值着色的区域方块——适用于只有区域代码、没有坐标的表。",
        "emptyTitle": "没有区域",
        "emptyBody": "包含区域代码和数值的行会在这里显示为着色方块。",
        "legendLowLabel": "低",
        "legendHighLabel": "高",
        "chartLabel": "区域细分"
      }
    },
    "domain": {
      "orgChart": {
        "description": "根据人员表的上级引用构建的汇报关系树，分支可折叠。",
        "emptyTitle": "暂无汇报结构",
        "emptyBody": "当人员记录引用上级后，组织架构图将显示在此处。",
        "reportsLabel": "下属 · {count}",
        "a11yLabel": "组织架构图"
      },
      "ganttChart": {
        "description": "时间轴上的任务条，按阶段分组，包含进度、里程碑和今日标记。",
        "emptyTitle": "暂无排期",
        "emptyBody": "任务设置开始和结束日期后将显示在此处。",
        "ungroupedLabel": "任务"
      },
      "documentCanvas": {
        "description": "纸张风格的文档画布（发票、报告或邮件），其中的区块可选中、重新排序和删除。",
        "emptyTitle": "此文档为空",
        "emptyBody": "从面板中添加区块，开始编排文档。",
        "addBlockLabel": "添加区块",
        "removeBlockLabel": "删除区块",
        "moveUpLabel": "上移区块",
        "moveDownLabel": "下移区块",
        "blockListLabel": "文档区块",
        "billedToLabel": "开票给",
        "issuedLabel": "开具日期",
        "dueLabel": "到期日",
        "noDocumentTitle": "尚无文档",
        "noDocumentBody": "选择一个入门模板或添加区块即可开始。"
      },
      "blockTotalsSummary": {
        "description": "文档合计：小计、折扣、税费和应付总额，均根据明细行重新计算。",
        "emptyTitle": "暂无合计",
        "emptyBody": "文档包含明细行后，合计将显示在此处。",
        "subtotalLabel": "小计",
        "discountLabel": "折扣",
        "taxLabel": "税费",
        "totalLabel": "应付总额"
      },
      "blockLineItems": {
        "description": "可编辑的说明、数量和单价行，用于计算文档合计。",
        "emptyTitle": "暂无明细行",
        "emptyBody": "添加明细行即可对此文档的工作计费。",
        "descHeader": "说明",
        "qtyHeader": "数量",
        "rateHeader": "单价",
        "amountHeader": "金额"
      },
      "blockKpiRow": {
        "description": "一行指标磁贴，变化值按正负着色。",
        "emptyTitle": "暂无指标",
        "emptyBody": "报告包含数据后，指标将显示在此处。"
      },
      "blockBarChart": {
        "description": "采用文档强调色的迷你柱状图，尺寸适配文档区块。",
        "emptyTitle": "暂无绘图数据",
        "emptyBody": "报告包含数据系列后，柱形将显示在此处。",
        "a11yLabel": "柱状图"
      },
      "blockLineChart": {
        "description": "迷你折线图，可选填充区域，尺寸适配文档区块。",
        "emptyTitle": "暂无绘图数据",
        "emptyBody": "报告包含数据系列后，折线将显示在此处。",
        "a11yLabel": "折线图"
      },
      "blockTwoColTable": {
        "description": "两列表格，首行为样式化表头，右列使用等宽字体。",
        "emptyTitle": "暂无行",
        "emptyBody": "报告包含数值后，行将显示在此处。"
      },
      "blockTaxBreakdown": {
        "description": "含名称、税率和金额的税费行，按文档小计计算。",
        "emptyTitle": "暂无税费行",
        "emptyBody": "文档设置税率后，税费行将显示在此处。"
      },
      "blockMultiCurrency": {
        "description": "按给定汇率将文档总额换算为各币种金额。",
        "emptyTitle": "暂无换算",
        "emptyBody": "文档列出汇率后，换算结果将显示在此处。",
        "footnote": "汇率仅供参考，实际结算时可能有所不同。"
      },
      "blockPaymentHistory": {
        "description": "历史付款记录，含日期、脱敏付款方式、金额和状态标签。",
        "emptyTitle": "暂无付款记录",
        "emptyBody": "针对此文档的付款将显示在此处。"
      },
      "blockDiscountCodes": {
        "description": "已使用的折扣码，含名称和抵扣金额。",
        "emptyTitle": "未使用折扣",
        "emptyBody": "应用于此文档的折扣码将显示在此处。"
      },
      "blockLoyaltyBanner": {
        "description": "会员横幅，显示积分余额、等级以及本次订单获得的积分。",
        "emptyTitle": "暂无积分余额",
        "emptyBody": "客户拥有积分余额后，会员横幅将显示在此处。",
        "balanceLabel": "{balance} 积分 · {tier}",
        "earnedLabel": "本次订单获得 +{earned}"
      },
      "blockRecurringBanner": {
        "description": "横幅，显示计费周期、下次扣款日期和剩余期数。",
        "emptyTitle": "非周期性",
        "emptyBody": "文档采用周期性计费后，此横幅将显示在此处。",
        "template": "周期性 — {freq} · 下次 {next} · 共 {count} 期"
      },
      "blockQrPay": {
        "description": "扫码支付磁贴，含说明文字和应付金额。",
        "emptyTitle": "无需付款",
        "emptyBody": "文档有应付金额后，支付码将显示在此处。",
        "amountLabel": "应付金额"
      },
      "blockDeliveryStepper": {
        "description": "横向配送步骤，标记为已完成、进行中或待处理。",
        "emptyTitle": "暂无配送步骤",
        "emptyBody": "订单有配送路径后，步骤将显示在此处。"
      },
      "blockSignature": {
        "description": "姓名和职务的签名栏，含签署日期。",
        "emptyTitle": "暂无签名",
        "emptyBody": "文档指定签署人后，签名栏将显示在此处。",
        "namePlaceholder": "姓名",
        "titlePlaceholder": "职务",
        "dateLabel": "日期",
        "nameInputLabel": "签名姓名"
      },
      "blockTermsCheckbox": {
        "description": "条款勾选框，标签可编辑。",
        "defaultLabel": "我接受条款和条件"
      },
      "blockApproval": {
        "description": "审批人卡片，含按状态着色的标签，以及可选的批准或驳回操作。",
        "emptyTitle": "暂无审批人",
        "emptyBody": "文档指定审批人后，审批卡片将显示在此处。",
        "approveLabel": "批准",
        "rejectLabel": "驳回",
        "pendingLabel": "待处理",
        "approvedLabel": "已批准",
        "rejectedLabel": "已驳回"
      },
      "blockAttachments": {
        "description": "附件文件，含文件名和大小。",
        "emptyTitle": "暂无附件",
        "emptyBody": "此文档的附件将显示在此处。"
      },
      "blockLateFees": {
        "description": "警告提示框，说明滞纳金和宽限期。",
        "emptyTitle": "无滞纳金",
        "emptyBody": "文档设置滞纳金规则后，此提示框将显示在此处。",
        "template": "逾期 {days} 天后将收取 {rate} 的滞纳金。"
      },
      "blockImagePlaceholder": {
        "description": "虚线占位框，用于替代图片，并附说明文字。",
        "emptyTitle": "暂无图片",
        "emptyBody": "区块设置说明文字后，占位框将显示在此处。"
      },
      "blockContact": {
        "description": "联系人行，含姓名、电子邮箱和电话号码。",
        "emptyTitle": "暂无联系人",
        "emptyBody": "文档指定联系人后，联系方式将显示在此处。"
      },
      "blockHighlightBox": {
        "description": "提示框，将标签与等宽大号数值配对显示。",
        "emptyTitle": "暂无重点内容",
        "emptyBody": "区块有数值后，提示框将显示在此处。"
      },
      "starterTemplatePicker": {
        "description": "预设模板网格，附带生成的缩略图；选中后即可创建完整文档。",
        "emptyTitle": "暂无模板",
        "emptyBody": "请在配置中定义模板，或绑定模板表。",
        "blankLabel": "空白",
        "kicker": {
          "invoice": "发票",
          "report": "报告",
          "email": "邮件"
        }
      },
      "sloMonitorCard": {
        "description": "按服务显示的 SLA 卡片，包含状态、相对目标的可用率、每日在线状态条、错误预算和 p95 延迟。",
        "emptyTitle": "暂无监控",
        "emptyBody": "请绑定含状态列和可用率列的监控表。",
        "targetLabel": "目标",
        "budgetLabel": "错误预算",
        "latencyLabel": "p95 延迟",
        "status": {
          "operational": "正常",
          "degraded": "降级",
          "down": "中断",
          "unknown": "未知"
        }
      },
      "uptimeSegmentBar": {
        "description": "状态页风格的每日状态条，按当日状态着色，可在 30 天和 90 天之间切换。",
        "emptyTitle": "暂无在线记录",
        "emptyBody": "每日状态数据将在此显示为在线状态条。",
        "daysAgoLabel": "{days} 天前",
        "todayLabel": "今天",
        "uptimeLabel": "在线率",
        "period30Label": "30 天",
        "period90Label": "90 天",
        "status": {
          "operational": "正常",
          "degraded": "降级",
          "down": "中断",
          "unknown": "暂无数据"
        }
      },
      "experimentVariantCompare": {
        "description": "按变体显示的转化条，含相对对照组的提升幅度和显著性指示器。",
        "emptyTitle": "暂无变体",
        "emptyBody": "请绑定含转化数据的实验变体表。",
        "controlLabel": "对照组",
        "winnerLabel": "胜出",
        "significanceLabel": "置信度",
        "verdictSignificantLabel": "统计显著——可以下结论。",
        "verdictInconclusiveLabel": "尚未显著——请继续运行实验。",
        "countsLabel": "{users} 名参与者 · {conversions} 次转化"
      },
      "creditCardTile": {
        "description": "已保存的支付方式，以品牌卡片形式显示掩码卡号、持卡人和有效期。",
        "emptyTitle": "暂无支付方式",
        "emptyBody": "添加银行卡后即可在此查看。",
        "defaultLabel": "默认",
        "setDefaultLabel": "设为默认",
        "manageLabel": "管理",
        "addLabel": "添加支付方式",
        "expiresLabel": "有效期至"
      },
      "planPricingCards": {
        "description": "套餐档位，含按月/按年切换、功能清单和重点推荐套餐。",
        "emptyTitle": "暂无套餐",
        "emptyBody": "请绑定含名称和月度价格的套餐表。",
        "monthlyLabel": "按月",
        "annualLabel": "按年",
        "popularLabel": "热门",
        "perMonthLabel": "/月",
        "billedAnnuallyLabel": "按年计费 {total}",
        "currentLabel": "当前套餐",
        "ctaLabel": "选择套餐"
      },
      "apiKeysPanel": {
        "description": "API 密钥列表，含环境标记、掩码值、权限范围、最近使用时间，以及复制、轮换和吊销操作。",
        "emptyTitle": "暂无 API 密钥",
        "emptyBody": "创建密钥后即可开始调用 API。",
        "revealedTitle": "密钥已创建",
        "revealedBody": "请立即复制——它不会再次显示。",
        "copyLabel": "复制",
        "copiedLabel": "已复制",
        "revealLabel": "显示密钥",
        "hideLabel": "隐藏密钥",
        "rollLabel": "轮换密钥",
        "revokeLabel": "吊销密钥",
        "neverUsedLabel": "从未使用",
        "lastUsedLabel": "上次使用 {since}"
      },
      "apiPlayground": {
        "description": "请求编辑器，含参数和响应面板。仅用于构造请求，绝不会真正发送。",
        "emptyTitle": "未选择接口",
        "emptyBody": "请选择一个接口以构造针对它的请求。",
        "sendLabel": "发送",
        "requestLabel": "请求",
        "responseLabel": "响应",
        "paramsLabel": "参数",
        "responsePlaceholder": "发送请求即可查看响应。"
      },
      "codeSnippetBlock": {
        "description": "可复制的代码片段，含语言标记和可选的分语言标签页。",
        "emptyTitle": "暂无代码片段",
        "emptyBody": "请绑定代码列，或在配置中设置静态代码片段。",
        "copyLabel": "复制",
        "copiedLabel": "已复制"
      },
      "webhookEndpointsList": {
        "description": "Webhook 接口列表，含事件、目标网址、最近触发时间和启用开关。",
        "emptyTitle": "暂无接口",
        "emptyBody": "添加 Webhook 接口以接收数据表事件。",
        "neverFiredLabel": "从未触发",
        "lastFiredLabel": "上次触发 {since}"
      },
      "resourceApiCard": {
        "description": "数据表生成的 API 接口：行数、安全标记、方法标签和请求量。",
        "emptyTitle": "暂无资源",
        "emptyBody": "请绑定数据表以显示其生成的 API 接口。",
        "rlsLabel": "RLS",
        "publicLabel": "公开",
        "rowsLabel": "行",
        "perDayLabel": "{count}/天"
      },
      "liveTimer": {
        "description": "任务用的启停秒表；停止后会自动记录一条工时。",
        "emptyTitle": "暂无计时器",
        "emptyBody": "请绑定含任务和时长列的工时记录行。",
        "startLabel": "开始",
        "stopLabel": "停止",
        "taskPlaceholder": "未命名任务"
      },
      "syncStatusCard": {
        "description": "连接标识、延迟、已同步行数和同步计划，并提供立即同步操作。",
        "emptyTitle": "暂无连接",
        "emptyBody": "请绑定连接行以显示其同步状态。",
        "connectedLabel": "已连接",
        "disconnectedLabel": "未连接",
        "rowsSyncedLabel": "已同步行数",
        "tablesLabel": "数据表",
        "lastSyncLabel": "上次同步",
        "nextSyncLabel": "下次同步",
        "syncingLabel": "正在同步…",
        "syncActionLabel": "立即同步"
      },
      "ipAllowlistCard": {
        "description": "需要在防火墙中放行的固定出口 IP 地址，每项均带复制按钮。",
        "emptyTitle": "暂无出口 IP",
        "emptyBody": "连接开通后，出口地址将在此显示。",
        "copyLabel": "复制",
        "copiedLabel": "已复制"
      },
      "onboardingChecklist": {
        "description": "配置步骤，含预计用时和操作按钮，上方为实时重算的进度环和进度条。",
        "emptyTitle": "暂无待办事项",
        "emptyBody": "请在配置中添加引导步骤，或绑定步骤表。",
        "progressLabel": "已完成 {done} / {total}",
        "celebrateTitle": "全部完成"
      },
      "testimonialCard": {
        "description": "客户评价，含头像和署名。",
        "emptyTitle": "暂无客户评价",
        "emptyBody": "请绑定评价行以显示客户评价。"
      },
      "trustBadges": {
        "description": "以圆点分隔的合规与信任声明行。",
        "emptyTitle": "暂无徽章",
        "emptyBody": "请在配置中添加合规声明，或绑定徽章表。"
      },
      "policyList": {
        "description": "按数据表显示的行级安全策略，含命令、角色和启用开关。",
        "emptyTitle": "暂无策略",
        "emptyBody": "该数据表尚未设置行级安全策略。"
      }
    },
    "media": {
      "fileBrowser": {
        "description": "以磁贴网格或列表浏览文件和文件夹，支持面包屑导航、类型图标和星标。",
        "emptyTitle": "此文件夹为空",
        "emptyBody": "上传文件或创建文件夹即可开始。"
      },
      "uploadDropzone": {
        "description": "用于上传文件的拖放区域，可限制格式和大小。",
        "dropTitle": "拖放文件以上传",
        "browsePrefix": "或",
        "browseLabel": "浏览"
      },
      "uploadProgressList": {
        "description": "逐个文件的上传行，带进度条和状态；同样适用于导出队列作业。",
        "emptyTitle": "没有正在进行的上传",
        "emptyBody": "您上传的文件将在此显示进度。"
      },
      "attachmentList": {
        "description": "附加到记录的文件，带类型图标、大小以及下载或删除操作。",
        "emptyTitle": "没有附件",
        "emptyBody": "附加到此记录的文件将显示在这里。"
      },
      "imageBoard": {
        "description": "带标题的图片位灵感板网格，适用于含图片 URL 的表。",
        "emptyTitle": "暂无图片",
        "emptyBody": "参考图片将显示在此板上。",
        "placeholder": "拖放参考图片"
      },
      "linkList": {
        "description": "带标题和网址的参考链接，在新标签页中打开。",
        "emptyTitle": "暂无链接",
        "emptyBody": "参考链接将显示在这里。"
      },
      "root": "文件",
      "breadcrumb": "面包屑导航",
      "gridView": "网格视图",
      "listView": "列表视图",
      "nameHeader": "名称",
      "sizeHeader": "大小",
      "modifiedHeader": "修改时间",
      "star": "星标",
      "items": "项",
      "done": "完成",
      "failed": "失败",
      "queued": "排队中",
      "retry": "重试",
      "download": "下载",
      "cancel": "取消",
      "delete": "删除",
      "remove": "移除",
      "addImage": "添加图片",
      "caption": "标题",
      "addLink": "添加链接",
      "linkTitlePlaceholder": "标题",
      "linkUrlPlaceholder": "https://…",
      "add": "添加"
    },
    "forms": {
      "modalWizard": {
        "description": "带成功确认的弹窗创建表单——标准的“新建记录”流程。",
        "trigger": "创建",
        "submit": "创建",
        "cancel": "取消",
        "done": "完成",
        "successTitle": "记录已创建",
        "successBody": "记录已保存。",
        "required": "此字段为必填项。",
        "titleLabel": "创建记录",
        "closeLabel": "关闭"
      },
      "drawerForm": {
        "description": "用于字段较多记录的侧边抽屉创建或编辑表单。",
        "trigger": "新建",
        "submit": "保存",
        "cancel": "取消",
        "titleLabel": "新建记录",
        "closeLabel": "关闭"
      },
      "stepper": {
        "description": "显示多步流程进展的步骤指示器。",
        "a11yLabel": "进度"
      },
      "progressBar": {
        "description": "带百分比说明的确定进度条。",
        "label": "进度"
      },
      "otpInput": {
        "description": "一次性验证码输入框。",
        "label": "一次性验证码"
      },
      "chipInput": {
        "description": "标签输入：可移除的标签加上按回车提交的自由文本。",
        "remove": "移除",
        "placeholder": "输入后按回车…"
      },
      "segmentedControl": {
        "description": "用于时间段、环境和筛选的单选分段控件。",
        "a11yLabel": "选择一项"
      },
      "filterChipBar": {
        "description": "筛选标签，计数根据所筛选的列表实时计算。",
        "all": "全部",
        "a11yLabel": "筛选",
        "meta": "{total} 条中的 {shown} 条"
      },
      "toggleSwitchList": {
        "description": "设置行列表，每行带一个开关。",
        "save": "保存",
        "dirty": "您有未保存的更改",
        "emptyTitle": "暂无设置",
        "emptyBody": "设置配置后将显示在这里。"
      },
      "optionCards": {
        "description": "用于数据源、模板和套餐的单选卡片网格。",
        "a11yLabel": "选择一项"
      },
      "ruleBuilder": {
        "description": "条件构建器，其规则将编译为过滤条件——即分群编辑器。",
        "add": "添加条件",
        "remove": "移除条件",
        "all": "全部满足",
        "any": "任一满足",
        "field": "字段",
        "operator": "运算符",
        "value": "值",
        "valuePlaceholder": "值…",
        "emptyBody": "尚无条件——添加一个来定义此分群。",
        "op": {
          "eq": "等于",
          "neq": "不等于",
          "gt": "大于",
          "gte": "大于或等于",
          "lt": "小于",
          "lte": "小于或等于",
          "contains": "包含",
          "not-contains": "不包含",
          "starts-with": "开头为",
          "in": "属于其中之一",
          "before": "早于",
          "after": "晚于",
          "is-null": "为空",
          "is-not-null": "不为空"
        }
      },
      "flowBuilder": {
        "description": "由触发器、条件和动作步骤组成的纵向工作流画布。",
        "add": "添加步骤",
        "remove": "移除步骤",
        "paletteTitle": "添加步骤",
        "stats": "{runs} 次运行 · {rate}% 成功率",
        "emptyBody": "尚无步骤——添加触发器以启动此工作流。"
      },
      "connectionStringField": {
        "description": "连接字符串输入框，输入时自动识别数据库引擎。",
        "label": "连接字符串",
        "helper": "postgres://user:password@host:5432/database——mysql:// 和 sqlite: 同样支持。",
        "quickFill": "快速填充：",
        "host": "主机：{host}",
        "invalidScheme": "无法识别的连接字符串协议。",
        "incomplete": "请在连接字符串中补充主机和数据库。"
      },
      "tableInclusionChecklist": {
        "description": "要纳入的数据表，附行数与个人信息提示。",
        "pii": "个人信息",
        "highVolume": "数据量大",
        "a11yLabel": "要纳入的数据表",
        "emptyTitle": "未找到数据表",
        "emptyBody": "连接数据库后，其数据表将显示在此处。"
      },
      "columnMappingTable": {
        "description": "将上传文件的列映射到数据表的字段。",
        "skip": "不导入",
        "sourceHeader": "源列",
        "sampleHeader": "示例",
        "targetHeader": "目标字段",
        "emptyTitle": "没有可映射的列",
        "emptyBody": "上传文件后，其列将显示在此处。"
      },
      "validationIssuesList": {
        "description": "导入与校验问题，按严重程度排序，并显示受影响的行数。",
        "emptyTitle": "未发现问题",
        "emptyBody": "一切正常——可以开始导入。"
      },
      "exportBuilder": {
        "description": "配置数据导出：格式、日期范围与包含内容。",
        "format": "格式",
        "from": "起始",
        "to": "截止",
        "groupBy": "分组依据",
        "includeCharts": "包含图表",
        "email": "将导出结果发送到我的邮箱",
        "submit": "导出",
        "running": "正在准备导出…",
        "done": "导出已就绪",
        "failed": "导出失败，请重试。",
        "download": "下载"
      },
      "questionBuilder": {
        "description": "问卷编辑器：添加题型并调整题目顺序。",
        "paletteTitle": "添加题目",
        "add": "添加题目",
        "remove": "移除题目",
        "moveUp": "上移",
        "moveDown": "下移",
        "required": "必填",
        "questionPlaceholder": "输入题目…",
        "emptyTitle": "尚无题目",
        "emptyBody": "选择一种题型，开始搭建您的问卷。",
        "questionLabel": "题目",
        "dropdownPlaceholder": "请选择…",
        "kind": {
          "single-choice": "单选",
          "multi-choice": "多选",
          "dropdown": "下拉选择",
          "short-text": "短文本",
          "long-text": "长文本",
          "rating": "星级评分",
          "nps": "NPS 0–10",
          "date": "日期"
        }
      },
      "inlineEditableField": {
        "description": "文档或画布中可点击编辑的值。",
        "edit": "编辑",
        "save": "保存",
        "cancel": "取消",
        "empty": "空",
        "valueLabel": "值"
      },
      "passwordStrengthMeter": {
        "description": "显示密码强度的四段式指示器。",
        "label": "密码强度",
        "weak": "弱",
        "fair": "一般",
        "good": "良好",
        "strong": "强"
      }
    },
    "chrome": {
      "sidebarNav": {
        "description": "应用的分组导航栏，带实时计数徽标。",
        "a11yLabel": "主导航",
        "emptyTitle": "暂无导航",
        "emptyBody": "生成连接后，已包含的表将显示在这里。"
      },
      "commandPalette": {
        "description": "⌘K 命令面板：随时搜索操作、页面和记录。",
        "title": "命令面板",
        "placeholder": "搜索操作、页面和记录…",
        "navigate": "导航",
        "select": "打开",
        "close": "关闭",
        "emptyTitle": "“{query}”没有结果",
        "emptyBody": "开始输入以搜索。",
        "groupActions": "操作",
        "groupNavigate": "导航",
        "groupRecent": "最近",
        "groupPages": "页面",
        "groupMetrics": "指标",
        "groupPeople": "人员",
        "groupRecords": "记录"
      },
      "globalSearch": {
        "description": "跨所有实体搜索，带类型分面和结果摘要。",
        "placeholder": "搜索全部…",
        "all": "全部",
        "summary": "“{query}”的 {count} 条结果",
        "emptyTitle": "无结果",
        "emptyBody": "请尝试其他搜索词。",
        "searchLabel": "搜索",
        "facetRailLabel": "按类型筛选"
      },
      "breadcrumb": {
        "description": "当前记录或文件夹的层级路径。",
        "a11yLabel": "面包屑导航"
      },
      "tabBar": {
        "description": "用于切换面板或导航的标签页，可带计数。",
        "a11yLabel": "标签页"
      },
      "navCard": {
        "description": "用于导航页和着陆页的链接卡片网格。",
        "emptyTitle": "暂无内容",
        "emptyBody": "页面生成后链接将显示在这里。"
      },
      "shortcutsPanel": {
        "description": "键盘快捷键速查表。",
        "footerHint": "随时按 ?",
        "then": "然后",
        "emptyTitle": "未注册任何快捷键。",
        "generalGroupLabel": "通用",
        "navigationGroupLabel": "导航",
        "recordsGroupLabel": "记录",
        "openCommandPaletteLabel": "打开命令面板",
        "searchLabel": "搜索",
        "showShortcutsLabel": "显示快捷键",
        "goToDashboardLabel": "前往仪表板",
        "goToOrdersLabel": "前往订单",
        "newRecordLabel": "新建记录",
        "saveLabel": "保存",
        "undoLabel": "撤销"
      },
      "avatarStack": {
        "description": "带“+N”溢出和可选在线状态的重叠头像。",
        "online": "{count} 人在线",
        "a11yLabel": "人员"
      }
    },
    "system": {
      "stateHero": {
        "description": "用于 404、500、离线、无权限和维护状态的整页状态屏。",
        "notFoundTitle": "这个页面走错了路",
        "notFoundBody": "您要找的页面已被移动、重命名，或从未存在。",
        "serverErrorTitle": "我们这边出了点问题",
        "serverErrorBody": "错误已记录并已通知团队。重试通常有效。",
        "offlineTitle": "您已离线",
        "offlineBody": "请检查网络连接——仪表板会自动重连。",
        "forbiddenTitle": "您没有访问权限",
        "forbiddenBody": "请联系工作区管理员为您授予此页面的权限。",
        "maintenanceTitle": "正在维护",
        "maintenanceBody": "我们正在改进。通常只需几分钟。",
        "connErrorTitle": "无法连接数据库",
        "connErrorBody": "连接被拒绝或超时。请检查连接设置。",
        "backToDashboard": "返回仪表板",
        "tryAgain": "重试",
        "retry": "重试",
        "testConnection": "测试连接"
      },
      "emptyState": {
        "description": "带可选操作的居中“暂无内容”面板。"
      },
      "statusPill": {
        "description": "用于枚举列的彩色徽标——通用状态渲染器。"
      },
      "alertBanner": {
        "description": "用于配额、冻结和计划提示的内嵌提示条。",
        "dismiss": "关闭"
      },
      "statusBannerHero": {
        "description": "服务健康状态横幅，其状态取自列表中最差的服务。",
        "upTitle": "所有系统运行正常",
        "upBody": "所有受监控的服务均正常响应。",
        "degradedTitle": "性能下降",
        "degradedBody": "部分服务比平时慢。我们正在排查。",
        "downTitle": "重大故障",
        "downBody": "一项或多项服务不可用。我们正在处理。"
      },
      "connectionStatus": {
        "description": "数据库连接的连接或测试结果。",
        "idle": "未连接",
        "connecting": "正在连接…",
        "connected": "已连接",
        "failed": "连接失败",
        "test": "测试"
      },
      "autosaveIndicator": {
        "description": "自动保存文档的“未保存 → 保存中 → 已保存”标记。",
        "dirty": "有未保存的更改",
        "saving": "保存中…",
        "saved": "所有更改已保存",
        "error": "保存失败"
      },
      "progressLogConsole": {
        "description": "带进度条的流式日志控制台，用于长时间运行的任务。",
        "a11yLabel": "进度日志",
        "progressLabel": "进度",
        "emptyTitle": "暂无内容",
        "emptyBody": "任务开始后日志将显示在这里。"
      },
      "diagnosticsReadout": {
        "description": "连接检查结果，以带颜色的键/值行显示，并附检查时间。",
        "checkedAt": "最后检查",
        "host": "主机",
        "dns": "DNS",
        "tcp": "TCP",
        "tls": "TLS",
        "auth": "认证",
        "latency": "延迟"
      },
      "widgetMissing": {
        "description": "当已保存的页面引用了未安装的小组件时显示的回退卡片。",
        "title": "小组件不可用",
        "bodyLead": "没有小组件注册为",
        "bodyTail": "它可能属于更高版本，或来自某个未安装的扩展。"
      }
    }
  },
  "grid": {
    "dragHandle": "拖动以移动 {title}",
    "resizeHandle": "调整 {title} 的大小",
    "a11y": {
      "grabbed": "已抓取 {title}。使用方向键移动，按住 Shift 调整大小，回车保存，Esc 取消。",
      "moved": "{title} 已移动到第 {col} 列，第 {row} 行。",
      "resized": "{title} 已调整为 {w} 列 × {h} 行。",
      "committed": "{title} 已放置在第 {col} 列，第 {row} 行。",
      "reverted": "{title} 已返回原始位置。"
    },
    "draggableRole": "可拖动的小组件"
  },
  "templates": {
    "crud": {
      "newRow": "新建行",
      "exportAction": "导出",
      "searchPlaceholder": "搜索 {table}…",
      "removeFilter": "移除 {column} 筛选",
      "queryFailed": "查询失败",
      "loadingRows": "正在加载行",
      "noMatchesTitle": "没有匹配的行",
      "emptyTitle": "{count, plural, other {No {entity}s yet}}",
      "createTitle": "添加 {entity}",
      "createSubtitle": "将在 {table} 中创建一行。",
      "createSubmit": "添加 {entity}",
      "createSuccessTitle": "已添加 {name}",
      "createSuccessBody": "您可以从该通知中撤销此操作。",
      "editTitle": "编辑 {entity}",
      "saveSubmit": "保存更改",
      "deleteTitle": "删除 {entity}",
      "deletePreflight": "正在检查引用…",
      "deleteNoReferences": "此行没有入站引用。",
      "deleteConsequencesIntro": "删除此行还会影响：",
      "referenceRows": "{count, plural, other {{n} rows}}",
      "confirmPrompt": "输入 {value} 以确认",
      "bulkDeleteTitle": "{count, plural, other {Delete {n} rows}}",
      "bulkDeleteBody": "引用带来的影响适用于所选的每一行。",
      "bulkDeleteConfirm": "删除这些行",
      "uniqueHelper": "在 {table} 中必须唯一。",
      "uniqueHelperCounted": "{count, plural, other {Checked against {n} rows.}}",
      "toast": {
        "created": "{entity} 已创建。",
        "createFailed": "创建失败。",
        "saved": "更改已保存。",
        "updateFailed": "更新失败。",
        "deleted": "{name} 已删除。",
        "deleteFailed": "删除失败。",
        "bulkDeleted": "{count, plural, other {{n} rows deleted.}}",
        "bulkDeleteFailed": "批量删除失败。",
        "exportIncomplete": "已导出 {selected, number} 个所选行中的 {written, number} 个 — 请重新加载后重试。",
        "undone": "更改已撤销。",
        "undoFailed": "撤销失败。"
      },
      "detail": {
        "fields": "字段",
        "inboundReferences": "入站引用",
        "relatedCount": "{count, plural, other {{n} related records in {table}}}",
        "loadError": "无法加载该记录。"
      }
    },
    "queue": {
      "allSegment": "全部",
      "daysUnit": "{count, plural, other {{count} days}}",
      "approvedToast": "已批准 {count} 项。",
      "rejectedToast": "已拒绝 {count} 项。",
      "undoneToast": "已撤销该决定。",
      "undoFailedToast": "无法撤销该决定。",
      "failedToast": "操作失败。",
      "invalidConfig": "此队列保存的配置无效。请重新生成页面以恢复。",
      "queueLabel": "队列",
      "statusFilterLabel": "状态筛选",
      "errorTitle": "无法加载此队列",
      "loading": "正在加载队列",
      "emptyTitle": "队列为空",
      "emptyBody": "新请求到达后将显示在这里。",
      "caughtUpTitle": "全部处理完毕",
      "caughtUpBody": "此标签页当前没有请求。",
      "selectItem": "选择 {title}",
      "selectPrompt": "选择一个请求",
      "selectBody": "选择一项以查看其详情。",
      "rejectTitle": "拒绝请求",
      "rejectCount": "已选 · {count}",
      "rejectPlaceholder": "为请求者添加备注…",
      "rejectReasonLabel": "拒绝原因",
      "rejectNote": "请求者将收到通知及您的备注。"
    },
    "dashboard": {
      "invalidLayout": "此仪表板保存的布局无效。请重新生成页面或重置其布局。"
    },
    "builder": {
      "publish": "发布",
      "paletteTitle": "区块",
      "inspectorTitle": "检查器",
      "startFromTemplate": "从模板开始",
      "untitledDoc": "未命名文档",
      "invalidConfig": "此构建器页面保存的配置无效。请重新生成页面或将其重置。",
      "starterPicker": {
        "subtitle": "选择模板会替换当前草稿。"
      },
      "inspector": {
        "titleLabel": "标题",
        "numberLabel": "编号",
        "currencyLabel": "币种",
        "taxRateLabel": "税率 %",
        "modulesLabel": "模块"
      },
      "summary": {
        "questions": "题目",
        "estLength": "预计时长",
        "estMinutes": "约 {minutes} 分钟",
        "steps": "步骤",
        "triggers": "触发器",
        "conditions": "条件",
        "actions": "动作",
        "triggerLocked": "触发器步骤无法移除。"
      },
      "publishModal": {
        "confirmTitle": "发布问卷？",
        "confirmSubtitle": "上线前请再检查一遍。",
        "confirmCta": "发布问卷",
        "publishedTitle": "问卷已发布",
        "publishedSubtitle": "您的问卷已上线，正在收集回答。"
      },
      "blocks": {
        "block-totals-summary": "合计汇总",
        "block-line-items": "明细行",
        "block-kpi-row": "指标行",
        "block-bar-chart": "柱状图",
        "block-line-chart": "折线图",
        "block-two-col-table": "两列表格",
        "block-tax-breakdown": "税费明细",
        "block-multi-currency": "多币种",
        "block-payment-history": "付款记录",
        "block-discount-codes": "折扣码",
        "block-loyalty-banner": "会员积分",
        "block-recurring-banner": "周期性",
        "block-qr-pay": "支付二维码",
        "block-delivery-stepper": "配送时间线",
        "block-signature": "签名",
        "block-terms-checkbox": "条款",
        "block-approval": "审批",
        "block-attachments": "附件",
        "block-late-fees": "滞纳金",
        "block-image-placeholder": "图片",
        "block-contact": "联系人",
        "block-highlight-box": "重点提示框"
      },
      "starters": {
        "titles": {
          "st-standard": "标准发票",
          "st-recurring": "周期性订阅",
          "st-deposit": "定金请求",
          "st-credit-note": "贷记单",
          "st-late-reminder": "逾期付款提醒",
          "st-quote": "报价 / 估价",
          "st-proforma": "形式发票",
          "st-receipt": "付款收据",
          "st-retainer": "预聘费",
          "st-usage": "按用量计费发票",
          "st-milestone": "项目里程碑",
          "st-donation": "捐赠收据（税号）",
          "st-monthly": "月度汇总",
          "st-quarterly": "季度回顾",
          "st-usage-report": "用量明细",
          "st-exec": "管理层一页纸",
          "st-welcome": "欢迎邮件",
          "st-receipt-email": "发票收据",
          "st-digest": "每周摘要",
          "st-dunning": "付款提醒"
        },
        "categories": {
          "billing": "计费",
          "sales": "销售",
          "nonProfit": "非营利",
          "reports": "报告",
          "lifecycle": "生命周期",
          "transactional": "事务性",
          "marketing": "营销"
        }
      }
    },
    "common": {
      "clearFilters": "清除筛选",
      "noMatchesBody": "试试其他搜索词或移除筛选。",
      "detailLabel": "详情",
      "loadingRecord": "正在加载记录"
    },
    "directory": {
      "invalidConfig": "此通讯录保存的配置无效。请重新生成页面以恢复。",
      "searchPlaceholder": "搜索人员…",
      "memberCount": "{count, plural, other {{n} people}}",
      "errorTitle": "无法加载此通讯录",
      "loading": "正在加载人员",
      "emptyTitle": "还没有人员",
      "emptyBody": "表中有数据后，人员将显示在这里。",
      "noMatchesTitle": "没有匹配的人员",
      "detailTitle": "人员"
    },
    "masterDetail": {
      "invalidConfig": "此页面保存的配置无效。请重新生成页面以恢复。",
      "railTitle": "记录",
      "errorTitle": "无法加载此列表",
      "loading": "正在加载记录",
      "emptyBody": "表中有数据后，记录将显示在这里。",
      "noMatchesTitle": "没有匹配的记录",
      "noMatchesBody": "试试移除筛选。",
      "selectPrompt": "选择一条记录",
      "selectBody": "从列表中选择一项以查看其详情。"
    },
    "chat": {
      "invalidLayout": "此聊天页面保存的布局无效。请重新生成页面或重置其布局。",
      "noInboxTitle": "此页面没有收件箱",
      "noInboxBody": "请重新生成页面。",
      "conversationsFailed": "会话查询失败",
      "messagesFailed": "消息查询失败",
      "loadingConversations": "正在加载会话",
      "loadingMessages": "正在加载消息",
      "selectTitle": "选择一个会话",
      "selectBody": "从收件箱中选择一个会话以阅读其消息。"
    },
    "files": {
      "allFiles": "全部文件",
      "recent": "最近",
      "starred": "已加星标",
      "invalidLayout": "此文件页面保存的布局无效。请重新生成页面或重置其布局。",
      "missingSlotTitle": "此页面没有文件浏览器",
      "missingSlotBody": "保存的布局中没有浏览器插槽。请重新生成页面。",
      "loadFailed": "文件查询失败",
      "loading": "正在加载文件",
      "uploadsUnavailable": "此页面暂不支持上传。",
      "previewTitle": "文件",
      "kindLabel": "类型",
      "linkLabel": "链接"
    },
    "logViewer": {
      "invalidLayout": "此日志页面保存的布局无效。请重新生成页面或重置其布局。",
      "levelFilterLabel": "日志级别筛选",
      "timeFilterLabel": "时间范围筛选",
      "window": {
        "1h": "1 小时",
        "24h": "24 小时",
        "7d": "7 天"
      },
      "heldCount": "+{count}",
      "missingSlotTitle": "此页面没有日志小组件",
      "missingSlotBody": "保存的布局中没有日志插槽。请重新生成页面。",
      "loadFailed": "日志查询失败",
      "loading": "正在加载日志条目",
      "traceTitle": "调用链",
      "latestTitle": "最新动态",
      "backToLatest": "返回最新",
      "eventFallback": "事件"
    },
    "calendar": {
      "eventCount": "{count, plural, other {{n} events}}",
      "composePlaceholder": "事件标题…",
      "addEvent": "添加事件",
      "dateRange": "日期范围",
      "agendaTitle": "日程",
      "categoriesTitle": "类别",
      "upcomingTitle": "即将到来",
      "invalidLayout": "此日历保存的布局无效。请重新生成页面或重置其布局。"
    },
    "scheduler": {
      "previousWeek": "上一周",
      "nextWeek": "下一周",
      "week": "周",
      "month": "月",
      "invalidLayout": "此排班表保存的布局无效。请重新生成页面或重置其布局。",
      "shiftCount": "{count, plural, other {{n} shifts}}",
      "addShift": "添加班次"
    },
    "settings": {
      "title": "通知设置",
      "subtitle": "选择通知内容与方式",
      "matrixLabel": "通知我",
      "rowHeader": "事件",
      "saved": "已保存",
      "unavailableTag": "暂不可用",
      "loading": "正在加载偏好设置",
      "errorTitle": "无法加载这些设置",
      "emptyTitle": "暂无可配置项",
      "emptyBody": "随着功能上线，通知事件将显示在这里。"
    },
    "pageCrud": {
      "description": "标准的数据表页面：可搜索的数据网格、创建/编辑表单、带引用检查的安全删除，以及可撤销的更改。"
    },
    "pageDashboard": {
      "description": "基于您数据的小组件仪表板：可编辑网格上的指标卡、图表和列表。"
    },
    "pageBoard": {
      "description": "按状态字段分组的看板——在列之间拖动卡片即可更新记录。"
    },
    "pageCalendar": {
      "description": "月视图日历，含日程、类别筛选，并可从日期字段快速录入事件。"
    },
    "pageScheduler": {
      "description": "按周与资源排列的班次矩阵，含容量跟踪和覆盖合计。"
    },
    "pageDirectory": {
      "description": "人员通讯录，含搜索、分组筛选和资料抽屉。"
    },
    "pageMasterDetail": {
      "description": "列表与详情并排的布局：在左侧选择记录，在右侧进行处理。"
    },
    "pageQueueInbox": {
      "description": "审核队列，支持批准/拒绝决定、批量操作和撤销。"
    },
    "pageLogViewer": {
      "description": "实时滚动的日志表格，含级别与时间筛选以及调用链侧栏。"
    },
    "pageFiles": {
      "description": "文件浏览器，含智能文件夹、上传和预览抽屉。"
    },
    "pageChat": {
      "description": "会话收件箱与消息会话串并排，绑定到您的消息数据表。"
    },
    "pageBuilder": {
      "description": "拖放式文档构建器，含区块面板、检查器和发布流程。"
    },
    "pageWizard": {
      "description": "多步骤引导流程，带领用户完成结构化的操作。"
    },
    "pageSettings": {
      "description": "通知偏好矩阵，含按渠道的开关和自动保存。"
    }
  },
  "frame": {
    "noResult": "此小组件没有结果",
    "emptyTitle": "此范围内没有数据",
    "loadError": "加载此小组件时出错。",
    "renderError": "此小组件渲染失败。",
    "refreshing": "正在刷新",
    "infoLabel": "小组件信息",
    "menuLabel": "小组件菜单"
  },
  "charts": {
    "livePillLabel": "实时",
    "forecast": {
      "nowLabel": "现在",
      "forecastLabel": "预测",
      "actualLabel": "实际"
    },
    "otherLabel": "其他",
    "heat": {
      "lessLabel": "少",
      "moreLabel": "多"
    },
    "choropleth": {
      "lowLabel": "低",
      "highLabel": "高"
    },
    "funnel": {
      "stepConversion": "{pct}% 继续",
      "overallConversion": "总体 {pct}%"
    }
  }
} as const;
