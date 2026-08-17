// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/zh-TW/ui.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime bundles en-US resources (and chunk-splits
 * the other locales) without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "close": "關閉",
    "cancel": "取消",
    "confirm": "確認",
    "save": "儲存",
    "apply": "套用",
    "delete": "刪除",
    "edit": "編輯",
    "copy": "複製",
    "copied": "已複製",
    "undo": "復原",
    "retry": "重試",
    "clear": "清除",
    "selectAll": "全選",
    "clearSelection": "清除選取",
    "showPassword": "顯示密碼",
    "hidePassword": "隱藏密碼",
    "reveal": "顯示",
    "hide": "隱藏",
    "clearSearch": "清除搜尋"
  },
  "state": {
    "loading": "載入中…",
    "empty": "這裡還沒有內容",
    "noResults": "沒有結果",
    "optional": "選填",
    "required": "必填",
    "error": "發生錯誤"
  },
  "pagination": {
    "previous": "上一頁",
    "next": "下一頁",
    "pageOf": "第 {page, number} 頁，共 {pages, number} 頁",
    "rowsPerPage": "每頁列數",
    "range": "第 {from, number}–{to, number} 筆，共 {total, number} 筆"
  },
  "table": {
    "sortAscending": "遞增排序",
    "sortDescending": "遞減排序",
    "rowActions": "列動作",
    "selectRow": "選取此列",
    "selectAllRows": "選取所有列"
  },
  "dialog": {
    "close": "關閉對話方塊",
    "confirmTitle": "確定要繼續嗎？"
  },
  "combobox": {
    "placeholder": "請選取…",
    "search": "搜尋…",
    "noMatches": "沒有符合項目"
  },
  "toast": {
    "dismiss": "關閉通知"
  },
  "widgets": {
    "kpi": {
      "statCard": {
        "description": "常用指標卡：一個主要彙總值，可選趨勢標章與迷你走勢圖。"
      },
      "usageMeter": {
        "description": "配額用量與上限的對比；超過所設門檻後，進度列會依序轉為橘色和紅色。",
        "usageLabel": "用量",
        "ofLabel": "/"
      },
      "statTileCompact": {
        "description": "纖薄的指標磚，含微型標籤、趨勢標記與 6 條走勢圖——適合 4 至 6 個一列的密集版面。"
      },
      "metricHero": {
        "description": "一個超大指標，載入時數字遞增，並附趨勢標章、走勢圖與目標進度。",
        "goalLabel": "目標"
      },
      "statPairCard": {
        "description": "兩個指標並排顯示；第二個可由第一個推導而得。"
      },
      "gaugeRing": {
        "description": "用於分數或百分比的環形量表，依數值所在區間著色。"
      },
      "gaugeArc": {
        "description": "帶定性區間與指針的速度表弧線；也可呈現量表格線。",
        "emptyTitle": "沒有可顯示的量表",
        "emptyBody": "服務有讀數後，就會以量表形式顯示在這裡。"
      },
      "periodComparison": {
        "description": "本期與上期以兩條進度列對比，下方列出計算出的差額。",
        "higherLabel": "較高",
        "lowerLabel": "較低",
        "flatLabel": "持平",
        "periodALabel": "本期",
        "periodBLabel": "上期"
      },
      "microKpiSubtitle": {
        "description": "由範本產生的單行頁首統計，隨即時狀態重新計算。"
      },
      "autoInsights": {
        "description": "依重要性排序的洞察項目——主要數字、說明句與走勢圖——並可重新整理輪替。",
        "emptyTitle": "尚無洞察",
        "emptyBody": "資料足以呈現規律後，洞察就會顯示在這裡。",
        "refreshLabel": "重新整理"
      }
    },
    "charts": {
      "boxplot": {
        "description": "依類別彙總數值欄位分佈的盒鬚圖——最小值、四分位數、中位數與最大值。",
        "emptyTitle": "沒有可繪製的分佈",
        "emptyBody": "沒有符合篩選條件的資料列可用於盒鬚圖。",
        "chartLabel": "盒鬚圖"
      },
      "violin": {
        "description": "鏡像密度曲線，比較數值欄位在各群組之間的分佈。",
        "emptyTitle": "沒有可繪製的分佈",
        "emptyBody": "沒有符合篩選條件的資料列可用於密度曲線。",
        "chartLabel": "小提琴圖"
      },
      "ridgeline": {
        "description": "重疊的密度山脊圖，比較數值欄位在有序群組間的分佈。",
        "emptyTitle": "沒有可繪製的山脊",
        "emptyBody": "沒有符合篩選條件的資料列可用於密度曲線。",
        "chartLabel": "山脊圖"
      },
      "scatterBubble": {
        "description": "將兩個數值欄位繪製為散佈點，可選氣泡大小與趨勢線。",
        "emptyTitle": "沒有可繪製的散佈點",
        "emptyBody": "沒有符合篩選條件的資料列符合所選欄位。",
        "chartLabel": "散佈圖"
      },
      "hexbin": {
        "description": "兩個數值欄位的六邊形密度圖，依每格落入的資料列數著色。",
        "emptyTitle": "沒有可繪製的密度",
        "emptyBody": "沒有符合篩選條件的資料列可供分箱。",
        "chartLabel": "六邊形密度圖"
      },
      "correlationMatrix": {
        "description": "所選數值欄位之間的皮爾森相關性，從強正相關到強負相關。",
        "emptyTitle": "沒有可計算的相關性",
        "emptyBody": "請至少選擇兩個具有相符資料列的數值欄位。",
        "chartLabel": "相關性矩陣"
      },
      "parallelCoordinates": {
        "description": "將每筆記錄繪製為跨多個正規化數值軸的折線，依類別著色。",
        "emptyTitle": "沒有可繪製的記錄",
        "emptyBody": "沒有符合篩選條件的資料列涵蓋所選各軸。",
        "chartLabel": "平行座標圖"
      },
      "unexpectedShape": "非預期的資料形態。",
      "lineArea": {
        "chartLabel": "折線圖",
        "description": "以折線搭配柔和的區域填色呈現指標隨時間的變化，可選擇加上虛線的前期對比。"
      },
      "bar": {
        "chartLabel": "長條圖",
        "description": "以垂直長條呈現分類或依時間分組的數值，可選擇特別標示最大或當前的長條。"
      },
      "donut": {
        "chartLabel": "環圈圖",
        "otherLabel": "其他",
        "description": "以環圈扇形呈現各類別佔比，含圖例與中央總計，並將細小扇形併入「其他」。"
      },
      "bullet": {
        "chartLabel": "標靶圖",
        "description": "以量測長條疊在定性區間之上呈現目標達成進度，每列附一個目標刻度。",
        "emptyTitle": "沒有可追蹤的目標",
        "emptyBody": "請新增帶有目標值的量測項目以供對照。"
      },
      "rankingBars": {
        "chartLabel": "排名",
        "description": "以水平長條呈現前 N 名排名——領先者完整著色，其餘淡化——並在旁標示數值。",
        "emptyTitle": "沒有可排名的內容",
        "emptyBody": "目前沒有符合此分項的記錄。"
      },
      "pareto": {
        "chartLabel": "柏拉圖",
        "description": "已排序的類別長條，搭配累積百分比折線，可選擇加上 80% 分界線。",
        "emptyTitle": "沒有可繪製的類別",
        "emptyBody": "此區間沒有回傳任何分組計數。"
      },
      "waterfall": {
        "chartLabel": "瀑布圖",
        "description": "以浮動長條串起從期初總計、歷經正負增減、到淨額總計的變化。",
        "emptyTitle": "沒有可串接的變化",
        "emptyBody": "找不到期初、增減或總計等步驟。"
      },
      "marimekko": {
        "chartLabel": "馬賽克圖",
        "description": "以寬度不等的堆疊直條呈現兩層組成——寬度代表外層佔比，區段代表內層細分。",
        "emptyTitle": "沒有可拆解的組成",
        "emptyBody": "此區間沒有回傳兩層分項資料。"
      },
      "stackedBar100": {
        "chartLabel": "100% 堆疊長條圖",
        "description": "將一條 100% 長條依比例切分為多個區段並附圖例，用以比較各部分佔整體的比重。",
        "emptyTitle": "沒有可切分的佔比",
        "emptyBody": "此分項沒有回傳任何組成部分。"
      },
      "slope": {
        "chartLabel": "斜率圖",
        "description": "兩個期間之間每筆記錄各以一條線相連，並依數值上升或下降著色。",
        "emptyTitle": "沒有可顯示的期間變化",
        "emptyBody": "沒有回傳可供比較的前後數值。"
      },
      "multiline": {
        "chartLabel": "多線折線圖",
        "description": "多組數列以重疊折線呈現並在末端標示名稱，比較同一時間範圍內的趨勢。",
        "emptyTitle": "沒有可繪製的數列",
        "emptyBody": "此區間沒有符合篩選條件的時間數列。"
      },
      "stream": {
        "chartLabel": "河流圖",
        "description": "圍繞中心線流動的堆疊色帶，呈現總量的組成如何隨時間變化。",
        "emptyTitle": "沒有可繪製的流量",
        "emptyBody": "此區間沒有回傳堆疊數列。"
      },
      "forecast": {
        "chartLabel": "預測圖",
        "nowLabel": "現在",
        "forecastLabel": "預測",
        "actualLabel": "實際",
        "description": "歷史折線延伸為虛線推估，外覆逐漸擴大的信賴區間，並以「現在」分隔線切分。",
        "emptyTitle": "沒有可推估的歷史資料",
        "emptyBody": "沒有回傳可作為預測基礎的過往資料點。"
      },
      "anomaly": {
        "chartLabel": "異常圖",
        "description": "數值折線疊在預期範圍之上，並以光暈圓點標示落在範圍外的資料點。",
        "emptyTitle": "沒有可掃描的訊號",
        "emptyBody": "沒有回傳可檢查異常的資料點。"
      },
      "candlestick": {
        "chartLabel": "K 線圖",
        "livePillLabel": "即時",
        "description": "開高低收 K 棒依漲跌著色，附最新價格虛線，並可選擇顯示即時標記。",
        "emptyTitle": "沒有可繪製的 K 棒",
        "emptyBody": "此區間沒有符合的開高低收資料列。"
      },
      "bump": {
        "chartLabel": "名次變化圖",
        "description": "名次隨時間變化的折線，呈現競爭者在各期間之間如何互換位置。",
        "emptyTitle": "沒有可追蹤的名次",
        "emptyBody": "沒有回傳逐期排名資料。"
      },
      "timelineLanes": {
        "chartLabel": "時間軸泳道",
        "laneLabel": "事件",
        "description": "帶日期的事件以膠囊形式排在共用同一時間軸的水平泳道上。",
        "emptyTitle": "沒有可放置的事件",
        "emptyBody": "此區間沒有符合篩選條件的事件。"
      },
      "treemap": {
        "chartLabel": "矩形樹狀圖",
        "otherLabel": "其他",
        "description": "以依數值調整大小的方格磚呈現部分與整體的關係，並將細小區塊併入「其他」磚。",
        "emptyTitle": "沒有可排列的區塊",
        "emptyBody": "此分項沒有回傳任何類別。"
      },
      "sunburst": {
        "chartLabel": "旭日圖",
        "description": "以巢狀環圈呈現兩層階層——父項在內、子項在外——並附父項圖例。",
        "emptyTitle": "沒有可繪製的環圈",
        "emptyBody": "沒有回傳可供巢狀排列的分組類別。"
      },
      "funnel": {
        "chartLabel": "漏斗圖",
        "description": "依序遞減的階段，含各步驟的續進率與整體轉換率頁尾。",
        "emptyTitle": "沒有可呈現的階段",
        "emptyBody": "此區間沒有回傳各步驟的計數。"
      },
      "radialBar": {
        "chartLabel": "環形長條圖",
        "description": "最多四個百分比以同心進度環呈現，並附圓點圖例。",
        "emptyTitle": "沒有可填滿的環圈",
        "emptyBody": "目前沒有符合此分項的類別。"
      },
      "radar": {
        "chartLabel": "雷達圖",
        "description": "多條具名軸線構成多邊形，每組數列一個填色形狀，可再疊上目標值。",
        "emptyTitle": "沒有可比較的軸線",
        "emptyBody": "沒有回傳數列與軸線的矩陣。"
      },
      "chord": {
        "chartLabel": "弦圖",
        "description": "環上節點之間的成對流向以緞帶呈現，緞帶的透明度依流量加權。",
        "emptyTitle": "沒有可連接的流向",
        "emptyBody": "沒有回傳群組之間的連結。"
      },
      "wordcloud": {
        "chartLabel": "文字雲",
        "description": "詞彙依出現頻率調整大小並排入多列，一眼看出哪些內容最為突出。",
        "emptyTitle": "沒有可呈現的詞彙",
        "emptyBody": "沒有符合篩選條件的加權詞彙。"
      },
      "cohortMatrix": {
        "chartLabel": "世代留存",
        "description": "世代為列、期間為欄，每格依留存率或營收深淺著色。"
      },
      "heatmapCalendar": {
        "chartLabel": "活動行事曆",
        "legendLessLabel": "少",
        "legendMoreLabel": "多",
        "description": "一整年的每日活動以週對日的格線呈現，依強度深淺著色。"
      },
      "heatMonth": {
        "chartLabel": "每月活動",
        "description": "單一日曆月份以日格線呈現，依當日數值深淺著色。"
      },
      "choroplethGrid": {
        "chartLabel": "區域分佈",
        "legendLowLabel": "低",
        "legendHighLabel": "高",
        "description": "區域數值以著色的美國方格地圖或精簡格線呈現，可選擇附上前 N 名排名清單。"
      },
      "sankey": {
        "chartLabel": "流向圖",
        "description": "分層的來源至目標流向以緞帶呈現，緞帶粗細代表流量大小。"
      },
      "sparkline": {
        "description": "近期數值的內嵌微型趨勢——沒有軸線或標籤——適用於 KPI 卡片、表格儲存格與清單列。"
      }
    },
    "feeds": {
      "activityFeed": {
        "description": "依時間倒序顯示工作區中誰做了什麼的動態資訊流。",
        "emptyTitle": "尚無近期動態",
        "emptyBody": "工作區中的操作將顯示在這裡。",
        "viewAllLabel": "檢視全部"
      },
      "notificationFeed": {
        "description": "帶未讀狀態、篩選與內嵌操作的分組通知。",
        "emptyTitle": "尚無通知",
        "emptyBody": "新通知將顯示在這裡。",
        "allLabel": "全部",
        "unreadLabel": "未讀",
        "mentionsLabel": "提及",
        "filterLabel": "通知篩選",
        "markAllReadLabel": "全部標示為已讀",
        "todayLabel": "今天",
        "yesterdayLabel": "昨天",
        "earlierLabel": "更早",
        "dismissLabel": "關閉",
        "emptyUnreadTitle": "全部都看完了",
        "emptyMentionsTitle": "沒有提及"
      },
      "realtimeFeed": {
        "description": "即時事件串流，新項目抵達時會置於頂端。",
        "emptyTitle": "正在等待事件",
        "emptyBody": "即時事件將隨發生即時顯示。",
        "liveLabel": "即時",
        "pausedLabel": "已暫停",
        "pauseLabel": "暫停",
        "resumeLabel": "繼續"
      },
      "timelineVertical": {
        "description": "事件、發佈、事故或執行步驟的垂直時間軸。",
        "emptyTitle": "這裡還沒有內容",
        "emptyBody": "事件將隨發生顯示在此時間軸上。"
      },
      "unreadBadge": {
        "description": "顯示未讀項目的計數標記，與資訊流狀態同步。",
        "unitLabel": "未讀"
      },
      "loadOlderPaginator": {
        "description": "頁尾按鈕，分批載入較早的記錄，直到動態消息載入完畢。",
        "label": "載入較早",
        "loadingLabel": "載入中…",
        "exhaustedLabel": "沒有更早的了",
        "ofLabel": "/"
      },
      "toastStack": {
        "description": "浮層提示宿主：簡短的操作確認，可附帶復原。",
        "undoLabel": "復原",
        "dismissLabel": "關閉",
        "regionLabel": "通知"
      }
    },
    "calendar": {
      "calendarMonth": {
        "description": "按月顯示已排程事件的格線，含每日標籤與月份導覽。",
        "emptyTitle": "尚無排程",
        "emptyBody": "已排程的事件將顯示在此行事曆中。",
        "previousLabel": "上個月",
        "nextLabel": "下個月",
        "overflowLabel": "另有 {count} 項"
      },
      "dayAgenda": {
        "description": "所選日期的事件依時間排序的議程。",
        "emptyTitle": "尚無排程",
        "emptyBody": "所選日期的事件將顯示在此處。",
        "countLabel": "{count, plural, other {{n} events}}"
      },
      "scheduleMatrix": {
        "description": "依資源與日期排列的班次格線，含每日涵蓋情形與圖例。",
        "emptyTitle": "尚無排班",
        "emptyBody": "已指派的班次將顯示在此排班表中。",
        "resourceLabel": "資源",
        "coverageLabel": "覆蓋",
        "hoursLabel": "{hours} 小時"
      },
      "capacityBoard": {
        "description": "依成員顯示使用率長條，含專案細分與負載狀態。",
        "emptyTitle": "尚無工作量資料",
        "emptyBody": "有指派後，成員的使用率將顯示在此處。",
        "status": {
          "overloaded": "超載",
          "balanced": "平衡",
          "available": "有餘裕"
        },
        "utilizationLabel": "{name}：{util}%",
        "assignmentLabel": "{project} · {hours} 小時",
        "periodLabel": "小時 · {period}",
        "period": {
          "week": "週",
          "month": "月"
        }
      },
      "calendarLegendFilter": {
        "description": "附計數的事件類別；切換即可篩選旁邊的行事曆。",
        "emptyTitle": "尚無類別",
        "emptyBody": "有事件後，事件類別會顯示在這裡。",
        "uncategorizedLabel": "未分類"
      },
      "upcomingEventsList": {
        "description": "依日期排序的近期事件，含負責人與狀態。",
        "emptyTitle": "沒有即將到來的事件",
        "emptyBody": "排定的事件會陸續顯示在這裡。"
      },
      "dateRangePicker": {
        "description": "附快捷選項的日期區間，可篩選頁面其餘內容。",
        "previousLabel": "上個月",
        "nextLabel": "下個月",
        "summaryLabel": "已選擇 {n} 天",
        "presets": {
          "7d": "最近 7 天",
          "30d": "最近 30 天",
          "90d": "最近 90 天",
          "mtd": "本月至今",
          "qtd": "本季至今",
          "ytd": "今年至今"
        }
      },
      "scheduledJobsList": {
        "description": "週期性報表與匯出作業，含頻率、下次執行時間與開關。",
        "emptyTitle": "尚無排程作業",
        "emptyBody": "排定週期性報表或匯出後，會顯示在這裡。",
        "nextRunLabel": "下次執行",
        "toggleLabel": "啟用排程",
        "recipientsLabel": "收件者"
      }
    },
    "tables": {
      "masterList": {
        "description": "可選取的記錄清單，用於驅動詳細資料窗格。",
        "emptyTitle": "尚無項目",
        "emptyBody": "項目存在後將顯示在這裡。",
        "allLabel": "全部",
        "toggleLabel": "切換 {title}",
        "progressLabel": "{title} 進度"
      },
      "logTable": {
        "description": "帶搜尋、錯誤篩選與列操作的附加式事件記錄。",
        "emptyTitle": "尚無記錄項目",
        "emptyBody": "事件將隨發生記錄在這裡。",
        "liveLabel": "即時",
        "placeholder": "搜尋記錄…",
        "filterLabel": "記錄篩選",
        "allLabel": "全部",
        "errorsLabel": "錯誤",
        "noMatchesLabel": "沒有相符的項目",
        "todayLabel": "今天",
        "yesterdayLabel": "昨天",
        "action": {
          "retry": "重試",
          "download": "下載",
          "inspect": "檢視"
        }
      },
      "cardGallery": {
        "description": "帶狀態與快捷操作的自適應實體卡片庫。",
        "emptyTitle": "尚無內容",
        "emptyBody": "項目將以卡片形式顯示在這裡。"
      },
      "groupedSummaryTable": {
        "description": "帶彙總欄、可展開明細與合計的分組列。",
        "emptyTitle": "尚無彙總資料",
        "emptyBody": "有資料後分組合計將顯示在這裡。",
        "groupLabel": "群組",
        "totalsLabel": "總計"
      },
      "schemaTree": {
        "description": "帶型別與索引鍵標章的結構描述、資料表與欄位瀏覽器。",
        "emptyTitle": "尚未讀取結構描述",
        "emptyBody": "連接資料庫即可在此瀏覽其結構描述。",
        "treeLabel": "結構描述",
        "viewLabel": "檢視表"
      },
      "toggleMatrix": {
        "description": "用於角色、原則或管道的布林開關互動格線。",
        "emptyTitle": "尚未設定矩陣",
        "emptyBody": "設定後列與欄將顯示在這裡。",
        "matrixLabel": "權限矩陣",
        "rowHeaderLabel": "權限"
      },
      "sparklineTable": {
        "description": "指標列，包含迷你走勢圖、目前數值以及可分辨好壞方向的變化標籤。",
        "emptyTitle": "尚無指標",
        "emptyBody": "有資料可彙總後，指標會顯示在這裡。"
      },
      "topMoversList": {
        "description": "變化最大的指標，並依各項指標判斷方向是好是壞。",
        "emptyTitle": "尚無變化",
        "emptyBody": "變化最大的指標會顯示在這裡。"
      },
      "rankedEntityList": {
        "description": "依指標排名的項目，附名次與等比長條。",
        "emptyTitle": "尚無排名",
        "emptyBody": "有資料可排序後，排名靠前的項目會顯示在這裡。"
      },
      "accordionList": {
        "description": "可展開的列，含標記與詳細面板，支援單開或多開。",
        "emptyTitle": "沒有可展開的內容",
        "emptyBody": "有項目後就會顯示在這裡。"
      },
      "comparisonMatrix": {
        "description": "比較方案的功能表格，其中一欄會特別標示。",
        "includedLabel": "包含",
        "notIncludedLabel": "未包含",
        "promotedLabel": "推薦"
      },
      "chipCloud": {
        "description": "自動換行的標籤，用於呈現探索到的資料表、合併變數或建議。",
        "emptyTitle": "尚未探索到內容",
        "emptyBody": "找到資料表與變數後，會以標籤形式顯示在這裡。",
        "moreLabel": "還有 {n} 個"
      },
      "dataGrid": {
        "selectAllLabel": "選取所有列",
        "selectRowLabel": "選取此列",
        "sortByLabel": "依 {column} 排序",
        "description": "標準的 CRUD 資料格線，支援欄位排序、列選取與依型別呈現的儲存格。"
      },
      "paginationFooter": {
        "emptyLabel": "0 列",
        "ofLabel": "/",
        "pageSizeLabel": "列數",
        "a11y": {
          "pageSize": "每頁列數"
        },
        "prevLabel": "上一頁",
        "nextLabel": "下一頁",
        "description": "頁尾顯示目前的資料列範圍、上一頁/下一頁分頁，以及每頁列數選單。"
      },
      "bulkActionToolbar": {
        "selectedLabel": "項已選取",
        "clearLabel": "清除選取",
        "toolbarLabel": "批次操作",
        "description": "會感知選取狀態的工具列，顯示已選取的數量與批次操作。"
      },
      "miniTable": {
        "viewAllLabel": "檢視全部",
        "description": "精簡的儀表板列清單，含對應的欄位與「檢視全部」連結。"
      },
      "revealLabel": "顯示值",
      "hideLabel": "隱藏值",
      "trueLabel": "是",
      "falseLabel": "否",
      "detailKeyValue": {
        "description": "將一筆記錄的欄位以標籤／數值列呈現，數值依型別格式化。"
      }
    },
    "boards": {
      "kanbanBoard": {
        "description": "固定的狀態欄與可拖曳卡片；將卡片拖到其他欄即可更新其狀態。",
        "emptyTitle": "尚無卡片",
        "emptyBody": "建立記錄後，卡片將出現在對應的狀態欄中。"
      },
      "kanbanSwimlaneGrid": {
        "description": "泳道 × 欄的格線；拖曳卡片會同時重新指派其泳道與狀態。",
        "emptyTitle": "沒有可顯示的泳道",
        "emptyBody": "依泳道欄位與狀態欄位將記錄分組以建立格線。"
      },
      "addCard": "新增卡片",
      "grip": "拖曳以移動卡片",
      "pointsUnit": "點",
      "laneSummary": "Σ{points} 點 · {count}",
      "a11y": {
        "grabbed": "已抓取 {title}。使用方向鍵移動，Enter 放下，Esc 取消。",
        "over": "{title} 位於 {cell} 上方。",
        "moved": "已將 {title} 移動到 {cell}。",
        "returned": "{title} 已返回原位。",
        "failed": "無法移動 {title}；已返回原位。"
      },
      "boardCard": {
        "description": "單張看板卡片：標籤、標題、進度、負責人與到期日。",
        "emptyTitle": "沒有卡片",
        "emptyBody": "這張卡片尚未綁定任何記錄。"
      },
      "inlineComposeCard": {
        "description": "快速新增，使用該欄的預設值建立新記錄。",
        "placeholder": "卡片標題…",
        "addLabel": "新增",
        "cancelLabel": "取消",
        "openLabel": "新增卡片"
      }
    },
    "communication": {
      "conversationInbox": {
        "description": "可選取的對話清單，顯示未讀數量、上線狀態與最近訊息預覽。",
        "emptyTitle": "尚無對話",
        "emptyBody": "收到訊息後，對話將顯示在這裡。",
        "noMatchesTitle": "沒有相符的對話",
        "searchLabel": "搜尋對話",
        "searchPlaceholder": "搜尋對話…"
      },
      "chatThread": {
        "description": "依傳送者與日期分組的訊息泡泡，支援附件與輸入框。",
        "emptyTitle": "尚無訊息",
        "emptyBody": "此對話中的訊息將顯示在這裡。",
        "composerPlaceholder": "輸入訊息…",
        "sendLabel": "傳送",
        "attachLabel": "新增附件",
        "typingLabel": "正在輸入…",
        "composerLabel": "訊息"
      },
      "aiChatPanel": {
        "description": "用於詢問資料庫結構與資料的助理面板。",
        "emptyTitle": "詢問你的資料",
        "emptyBody": "提出關於結構、資料表或指標的問題即可開始。",
        "composerPlaceholder": "提出問題…",
        "sendLabel": "傳送",
        "pendingLabel": "思考中…",
        "configureTitle": "尚未設定 AI 供應商",
        "configureBody": "新增 Anthropic 或 OpenAI 金鑰，或將 Adminium 指向你自己的端點，即可詢問資料庫結構。",
        "configureCtaLabel": "設定供應商",
        "assistantLabel": "助理",
        "composerLabel": "提出問題"
      },
      "typingIndicator": {
        "description": "頭像加斜體「輸入中…」列，繫結至每個對話的即時布林值。",
        "label": "輸入中…",
        "emptyTitle": "沒有輸入動態",
        "emptyBody": "對話開始後，輸入狀態會顯示在這裡。"
      },
      "callWidget": {
        "description": "來電（語音或視訊）：來電者頭像、通話狀態，以及接聽或拒接操作。",
        "voiceLabel": "語音通話",
        "videoLabel": "視訊通話",
        "ringingLabel": "響鈴中…",
        "connectingLabel": "連線中…",
        "activeLabel": "通話中",
        "endedLabel": "通話已結束",
        "acceptLabel": "接聽",
        "declineLabel": "拒接",
        "endLabel": "結束通話",
        "emptyTitle": "沒有進行中的通話",
        "emptyBody": "來電會顯示在這裡。"
      }
    },
    "geo": {
      "mapBubble": {
        "description": "地圖上的圓形標記依所選指標縮放，並附上排名靠前地點的清單。",
        "emptyTitle": "沒有位置",
        "emptyBody": "包含緯度與經度的列會在這裡顯示為地圖標記。",
        "mapUnavailableLabel": "地圖無法載入。排名清單顯示的是相同資料。",
        "regionsLabel": "熱門區域",
        "metricLabel": "指標"
      },
      "mapChoroplethGrid": {
        "description": "依數值著色的區域方塊——適用於只有區域代碼、沒有座標的資料表。",
        "emptyTitle": "沒有區域",
        "emptyBody": "包含區域代碼與數值的列會在這裡顯示為著色方塊。",
        "legendLowLabel": "低",
        "legendHighLabel": "高",
        "chartLabel": "區域分佈"
      }
    },
    "domain": {
      "orgChart": {
        "description": "依人員資料表的主管參照建立的匯報關係樹，分支可摺疊。",
        "emptyTitle": "尚無匯報結構",
        "emptyBody": "當人員記錄參照主管後，組織圖便會顯示於此。",
        "reportsLabel": "部屬 · {count}",
        "a11yLabel": "組織圖"
      },
      "ganttChart": {
        "description": "時間軸上的任務長條，依階段分組，含進度、里程碑與今日標記。",
        "emptyTitle": "尚無排程",
        "emptyBody": "任務設定開始與結束日期後便會顯示於此。",
        "ungroupedLabel": "任務"
      },
      "documentCanvas": {
        "description": "紙張風格的文件畫布（發票、報表或郵件），其中的區塊可選取、重新排序與移除。",
        "emptyTitle": "此文件是空的",
        "emptyBody": "從面板中加入區塊，開始編排文件。",
        "addBlockLabel": "新增區塊",
        "removeBlockLabel": "移除區塊",
        "moveUpLabel": "將區塊上移",
        "moveDownLabel": "將區塊下移",
        "blockListLabel": "文件區塊",
        "billedToLabel": "帳單開立對象",
        "issuedLabel": "開立日期",
        "dueLabel": "到期日",
        "noDocumentTitle": "尚無文件",
        "noDocumentBody": "選擇一個起始範本或新增區塊即可開始。"
      },
      "blockTotalsSummary": {
        "description": "文件總計：小計、折扣、稅金與應付總額，皆依明細列重新計算。",
        "emptyTitle": "尚無總計",
        "emptyBody": "文件包含明細列後，總計將顯示於此。",
        "subtotalLabel": "小計",
        "discountLabel": "折扣",
        "taxLabel": "稅金",
        "totalLabel": "應付總額"
      },
      "blockLineItems": {
        "description": "可編輯的說明、數量與單價列，用於計算文件總計。",
        "emptyTitle": "尚無明細列",
        "emptyBody": "新增明細列即可為此文件的工作計費。",
        "descHeader": "說明",
        "qtyHeader": "數量",
        "rateHeader": "單價",
        "amountHeader": "金額"
      },
      "blockKpiRow": {
        "description": "一列指標方塊，變化值依正負著色。",
        "emptyTitle": "尚無指標",
        "emptyBody": "報表包含數據後，指標將顯示於此。"
      },
      "blockBarChart": {
        "description": "採用文件強調色的迷你長條圖，尺寸適合文件區塊。",
        "emptyTitle": "尚無繪圖資料",
        "emptyBody": "報表包含資料數列後，長條將顯示於此。",
        "a11yLabel": "長條圖"
      },
      "blockLineChart": {
        "description": "迷你折線圖，可選填滿區域，尺寸適合文件區塊。",
        "emptyTitle": "尚無繪圖資料",
        "emptyBody": "報表包含資料數列後，折線將顯示於此。",
        "a11yLabel": "折線圖"
      },
      "blockTwoColTable": {
        "description": "兩欄表格，首列為樣式化表頭，右欄使用等寬字型。",
        "emptyTitle": "尚無列",
        "emptyBody": "報表包含數值後，列將顯示於此。"
      },
      "blockTaxBreakdown": {
        "description": "含名稱、稅率與金額的稅金列，依文件小計計算。",
        "emptyTitle": "尚無稅金列",
        "emptyBody": "文件設定稅率後，稅金列將顯示於此。"
      },
      "blockMultiCurrency": {
        "description": "依指定匯率將文件總額換算為各幣別金額。",
        "emptyTitle": "尚無換算",
        "emptyBody": "文件列出匯率後，換算結果將顯示於此。",
        "footnote": "匯率僅供參考，實際結算時可能有所不同。"
      },
      "blockPaymentHistory": {
        "description": "歷史付款紀錄，含日期、遮罩付款方式、金額與狀態標籤。",
        "emptyTitle": "尚無付款紀錄",
        "emptyBody": "針對此文件的付款將顯示於此。"
      },
      "blockDiscountCodes": {
        "description": "已套用的折扣碼，含名稱與折抵金額。",
        "emptyTitle": "未套用折扣",
        "emptyBody": "套用於此文件的折扣碼將顯示於此。"
      },
      "blockLoyaltyBanner": {
        "description": "會員橫幅，顯示點數餘額、等級與此訂單獲得的點數。",
        "emptyTitle": "尚無點數餘額",
        "emptyBody": "客戶擁有點數餘額後，會員橫幅將顯示於此。",
        "balanceLabel": "{balance} 點 · {tier}",
        "earnedLabel": "此訂單獲得 +{earned}"
      },
      "blockRecurringBanner": {
        "description": "橫幅，顯示計費週期、下次扣款日期與剩餘期數。",
        "emptyTitle": "非週期性",
        "emptyBody": "文件採用週期性計費後，此橫幅將顯示於此。",
        "template": "週期性 — {freq} · 下次 {next} · 共 {count} 期"
      },
      "blockQrPay": {
        "description": "掃碼付款方塊，含說明文字與應付金額。",
        "emptyTitle": "無須付款",
        "emptyBody": "文件有應付金額後，付款碼將顯示於此。",
        "amountLabel": "應付金額"
      },
      "blockDeliveryStepper": {
        "description": "橫向配送步驟，標記為已完成、進行中或待處理。",
        "emptyTitle": "尚無配送步驟",
        "emptyBody": "訂單有配送路線後，步驟將顯示於此。"
      },
      "blockSignature": {
        "description": "姓名與職稱的簽名欄，含簽署日期。",
        "emptyTitle": "尚無簽名",
        "emptyBody": "文件指定簽署人後，簽名欄將顯示於此。",
        "namePlaceholder": "姓名",
        "titlePlaceholder": "職稱",
        "dateLabel": "日期",
        "nameInputLabel": "簽名者姓名"
      },
      "blockTermsCheckbox": {
        "description": "條款勾選方塊，標籤可編輯。",
        "defaultLabel": "我接受條款與條件"
      },
      "blockApproval": {
        "description": "簽核人卡片，含依狀態著色的標籤，以及選用的核准或退回操作。",
        "emptyTitle": "尚無簽核人",
        "emptyBody": "文件指定簽核人後，簽核卡片將顯示於此。",
        "approveLabel": "核准",
        "rejectLabel": "退回",
        "pendingLabel": "待處理",
        "approvedLabel": "已核准",
        "rejectedLabel": "已退回"
      },
      "blockAttachments": {
        "description": "附件檔案，含檔名與大小。",
        "emptyTitle": "尚無附件",
        "emptyBody": "此文件的附件將顯示於此。"
      },
      "blockLateFees": {
        "description": "警告提示框，說明逾期費用與寬限期。",
        "emptyTitle": "無逾期費用",
        "emptyBody": "文件設定逾期費用規則後，此提示框將顯示於此。",
        "template": "逾期 {days} 天後將收取 {rate} 的逾期費用。"
      },
      "blockImagePlaceholder": {
        "description": "虛線佔位框，用於替代圖片，並附說明文字。",
        "emptyTitle": "尚無圖片",
        "emptyBody": "區塊設定說明文字後，佔位框將顯示於此。"
      },
      "blockContact": {
        "description": "聯絡人列，含姓名、電子郵件與電話號碼。",
        "emptyTitle": "尚無聯絡人",
        "emptyBody": "文件指定聯絡人後，聯絡資訊將顯示於此。"
      },
      "blockHighlightBox": {
        "description": "提示框，將標籤與等寬大型數值配對顯示。",
        "emptyTitle": "尚無重點內容",
        "emptyBody": "區塊有數值後，提示框將顯示於此。"
      },
      "starterTemplatePicker": {
        "description": "預設範本格線，附有產生的縮圖；選取後即可建立完整文件。",
        "emptyTitle": "尚無範本",
        "emptyBody": "請在設定中定義範本，或繫結範本資料表。",
        "blankLabel": "空白",
        "kicker": {
          "invoice": "發票",
          "report": "報表",
          "email": "郵件"
        }
      },
      "sloMonitorCard": {
        "description": "依服務顯示的 SLA 卡片，包含狀態、相對目標的可用率、每日運作狀態條、錯誤預算與 p95 延遲。",
        "emptyTitle": "尚無監控",
        "emptyBody": "請繫結含狀態欄與可用率欄的監控資料表。",
        "targetLabel": "目標",
        "budgetLabel": "錯誤預算",
        "latencyLabel": "p95 延遲",
        "status": {
          "operational": "運作正常",
          "degraded": "效能降低",
          "down": "服務中斷",
          "unknown": "未知"
        }
      },
      "uptimeSegmentBar": {
        "description": "狀態頁風格的每日狀態條，依當日狀態上色，可於 30 天與 90 天之間切換。",
        "emptyTitle": "尚無運作記錄",
        "emptyBody": "每日狀態資料將在此顯示為運作狀態條。",
        "daysAgoLabel": "{days} 天前",
        "todayLabel": "今天",
        "uptimeLabel": "運作率",
        "period30Label": "30 天",
        "period90Label": "90 天",
        "status": {
          "operational": "運作正常",
          "degraded": "效能降低",
          "down": "服務中斷",
          "unknown": "無資料"
        }
      },
      "experimentVariantCompare": {
        "description": "依變體顯示的轉換條，含相對對照組的提升幅度與顯著性指示器。",
        "emptyTitle": "尚無變體",
        "emptyBody": "請繫結含轉換數據的實驗變體資料表。",
        "controlLabel": "對照組",
        "winnerLabel": "勝出",
        "significanceLabel": "信心度",
        "verdictSignificantLabel": "具統計顯著性——可以下定論。",
        "verdictInconclusiveLabel": "尚未達顯著性——請繼續進行測試。",
        "countsLabel": "{users} 位參與者 · {conversions} 次轉換"
      },
      "creditCardTile": {
        "description": "已儲存的付款方式，以品牌卡片形式顯示遮罩卡號、持卡人與有效期限。",
        "emptyTitle": "尚無付款方式",
        "emptyBody": "新增卡片後即可在此檢視。",
        "defaultLabel": "預設",
        "setDefaultLabel": "設為預設",
        "manageLabel": "管理",
        "addLabel": "新增付款方式",
        "expiresLabel": "有效期限"
      },
      "planPricingCards": {
        "description": "方案級距，含按月/按年切換、功能清單與重點推薦方案。",
        "emptyTitle": "尚無方案",
        "emptyBody": "請繫結含名稱與每月價格的方案資料表。",
        "monthlyLabel": "每月",
        "annualLabel": "每年",
        "popularLabel": "熱門",
        "perMonthLabel": "/ 月",
        "billedAnnuallyLabel": "每年收費 {total}",
        "currentLabel": "目前方案",
        "ctaLabel": "選擇方案"
      },
      "apiKeysPanel": {
        "description": "API 金鑰清單，含環境標記、遮罩值、權限範圍、最近使用時間，以及複製、輪替與撤銷操作。",
        "emptyTitle": "尚無 API 金鑰",
        "emptyBody": "建立金鑰後即可開始呼叫 API。",
        "revealedTitle": "金鑰已建立",
        "revealedBody": "請立即複製——之後將不再顯示。",
        "copyLabel": "複製",
        "copiedLabel": "已複製",
        "revealLabel": "顯示金鑰",
        "hideLabel": "隱藏金鑰",
        "rollLabel": "輪替金鑰",
        "revokeLabel": "撤銷金鑰",
        "neverUsedLabel": "從未使用",
        "lastUsedLabel": "上次使用於 {since}"
      },
      "apiPlayground": {
        "description": "請求編輯器，含參數與回應面板。僅用於組合請求，絕不會真正送出。",
        "emptyTitle": "未選取端點",
        "emptyBody": "請選取端點以組合針對它的請求。",
        "sendLabel": "傳送",
        "requestLabel": "請求",
        "responseLabel": "回應",
        "paramsLabel": "參數",
        "responsePlaceholder": "送出請求即可查看回應。"
      },
      "codeSnippetBlock": {
        "description": "可複製的程式碼片段，含語言標記與選用的分語言頁籤。",
        "emptyTitle": "尚無程式碼片段",
        "emptyBody": "請繫結程式碼欄，或在設定中指定靜態程式碼片段。",
        "copyLabel": "複製",
        "copiedLabel": "已複製"
      },
      "webhookEndpointsList": {
        "description": "Webhook 端點清單，含事件、目標網址、最近觸發時間與啟用開關。",
        "emptyTitle": "尚無端點",
        "emptyBody": "新增 Webhook 端點以接收資料表事件。",
        "neverFiredLabel": "從未觸發",
        "lastFiredLabel": "上次觸發於 {since}"
      },
      "resourceApiCard": {
        "description": "資料表產生的 API 介面：資料列數、安全標記、方法標籤與請求量。",
        "emptyTitle": "尚無資源",
        "emptyBody": "請繫結資料表以顯示其產生的 API 介面。",
        "rlsLabel": "RLS",
        "publicLabel": "公開",
        "rowsLabel": "列",
        "perDayLabel": "{count}/天"
      },
      "liveTimer": {
        "description": "任務用的啟停碼錶；停止後會自動建立一筆工時記錄。",
        "emptyTitle": "尚無計時器",
        "emptyBody": "請繫結含任務與時長欄的工時記錄列。",
        "startLabel": "開始",
        "stopLabel": "停止",
        "taskPlaceholder": "未命名任務"
      },
      "syncStatusCard": {
        "description": "連線識別、延遲、已同步資料列數與同步排程，並提供立即同步操作。",
        "emptyTitle": "尚無連線",
        "emptyBody": "請繫結連線資料列以顯示其同步狀態。",
        "connectedLabel": "已連線",
        "disconnectedLabel": "已中斷連線",
        "rowsSyncedLabel": "已同步資料列",
        "tablesLabel": "資料表",
        "lastSyncLabel": "上次同步",
        "nextSyncLabel": "下次同步",
        "syncingLabel": "同步中…",
        "syncActionLabel": "立即同步"
      },
      "ipAllowlistCard": {
        "description": "需在防火牆中放行的固定輸出 IP 位址，每項皆附複製按鈕。",
        "emptyTitle": "尚無輸出 IP",
        "emptyBody": "連線佈建完成後，輸出位址將在此顯示。",
        "copyLabel": "複製",
        "copiedLabel": "已複製"
      },
      "onboardingChecklist": {
        "description": "設定步驟，含預估時間與操作按鈕，上方為即時重算的進度環與進度條。",
        "emptyTitle": "尚無待辦事項",
        "emptyBody": "請在設定中新增導覽步驟，或繫結步驟資料表。",
        "progressLabel": "已完成 {done} / {total}",
        "celebrateTitle": "全部完成"
      },
      "testimonialCard": {
        "description": "客戶推薦，含頭像與署名。",
        "emptyTitle": "尚無客戶推薦",
        "emptyBody": "請繫結引言資料列以顯示客戶推薦。"
      },
      "trustBadges": {
        "description": "以圓點分隔的法遵與信任聲明列。",
        "emptyTitle": "尚無徽章",
        "emptyBody": "請在設定中新增法遵聲明，或繫結徽章資料表。"
      },
      "policyList": {
        "description": "依資料表顯示的資料列層級安全性原則，含指令、角色與啟用開關。",
        "emptyTitle": "尚無原則",
        "emptyBody": "此資料表尚未設定資料列層級安全性原則。"
      }
    },
    "media": {
      "fileBrowser": {
        "description": "以磁磚格線或清單瀏覽檔案與資料夾，支援麵包屑導覽、類型圖示與星號標記。",
        "emptyTitle": "此資料夾是空的",
        "emptyBody": "上傳檔案或建立資料夾即可開始。"
      },
      "uploadDropzone": {
        "description": "用於上傳檔案的拖放區域，可限制格式與大小。",
        "dropTitle": "拖放檔案以上傳",
        "browsePrefix": "或",
        "browseLabel": "瀏覽"
      },
      "uploadProgressList": {
        "description": "逐一檔案的上傳列，附進度列與狀態；同樣適用於匯出佇列作業。",
        "emptyTitle": "沒有進行中的上傳",
        "emptyBody": "您上傳的檔案將在此顯示進度。"
      },
      "attachmentList": {
        "description": "附加至記錄的檔案，附類型圖示、大小以及下載或刪除動作。",
        "emptyTitle": "沒有附件",
        "emptyBody": "附加至此記錄的檔案將顯示於此。"
      },
      "imageBoard": {
        "description": "附說明文字的圖片格線靈感板，適用於含圖片 URL 的資料表。",
        "emptyTitle": "尚無圖片",
        "emptyBody": "參考圖片將顯示在此看板上。",
        "placeholder": "拖放參考圖片"
      },
      "linkList": {
        "description": "附標題與網址的參考連結，於新分頁開啟。",
        "emptyTitle": "尚無連結",
        "emptyBody": "參考連結將顯示於此。"
      },
      "root": "檔案",
      "breadcrumb": "麵包屑導覽",
      "gridView": "格線檢視",
      "listView": "清單檢視",
      "nameHeader": "名稱",
      "sizeHeader": "大小",
      "modifiedHeader": "修改時間",
      "star": "星號標記",
      "items": "項",
      "done": "完成",
      "failed": "失敗",
      "queued": "佇列中",
      "retry": "重試",
      "download": "下載",
      "cancel": "取消",
      "delete": "刪除",
      "remove": "移除",
      "addImage": "新增圖片",
      "caption": "說明文字",
      "addLink": "新增連結",
      "linkTitlePlaceholder": "標題",
      "linkUrlPlaceholder": "https://…",
      "add": "新增"
    },
    "forms": {
      "modalWizard": {
        "description": "帶成功確認的彈窗建立表單——標準的「新增記錄」流程。",
        "trigger": "建立",
        "submit": "建立",
        "cancel": "取消",
        "done": "完成",
        "successTitle": "記錄已建立",
        "successBody": "記錄已儲存。",
        "required": "此欄位為必填。",
        "titleLabel": "建立記錄",
        "closeLabel": "關閉"
      },
      "drawerForm": {
        "description": "用於欄位較多記錄的側邊抽屜建立或編輯表單。",
        "trigger": "新增",
        "submit": "儲存",
        "cancel": "取消",
        "titleLabel": "新增記錄",
        "closeLabel": "關閉"
      },
      "stepper": {
        "description": "顯示多步驟流程進度的步驟指示器。",
        "a11yLabel": "進度"
      },
      "progressBar": {
        "description": "帶百分比說明的確定進度條。",
        "label": "進度"
      },
      "otpInput": {
        "description": "一次性驗證碼輸入欄位。",
        "label": "一次性驗證碼"
      },
      "chipInput": {
        "description": "標籤輸入：可移除的標籤加上按 Enter 提交的自由文字。",
        "remove": "移除",
        "placeholder": "輸入後按 Enter…"
      },
      "segmentedControl": {
        "description": "用於時間範圍、環境與篩選的單選分段控制項。",
        "a11yLabel": "選擇一項"
      },
      "filterChipBar": {
        "description": "篩選標籤，計數依所篩選的清單即時計算。",
        "all": "全部",
        "a11yLabel": "篩選",
        "meta": "{total} 筆中的 {shown} 筆"
      },
      "toggleSwitchList": {
        "description": "設定列清單，每列附一個開關。",
        "save": "儲存",
        "dirty": "您有未儲存的變更",
        "emptyTitle": "尚無設定",
        "emptyBody": "設定完成後將顯示於此。"
      },
      "optionCards": {
        "description": "用於資料來源、範本與方案的單選卡片格線。",
        "a11yLabel": "選擇一項"
      },
      "ruleBuilder": {
        "description": "條件建構器，其規則會編譯成篩選條件——即分眾編輯器。",
        "add": "新增條件",
        "remove": "移除條件",
        "all": "全部符合",
        "any": "任一符合",
        "field": "欄位",
        "operator": "運算子",
        "value": "值",
        "valuePlaceholder": "值…",
        "emptyBody": "尚無條件——新增一個以定義此分眾。",
        "op": {
          "eq": "等於",
          "neq": "不等於",
          "gt": "大於",
          "gte": "大於或等於",
          "lt": "小於",
          "lte": "小於或等於",
          "contains": "包含",
          "not-contains": "不包含",
          "starts-with": "開頭為",
          "in": "屬於其中之一",
          "before": "早於",
          "after": "晚於",
          "is-null": "為空",
          "is-not-null": "不為空"
        }
      },
      "flowBuilder": {
        "description": "由觸發器、條件與動作步驟組成的直向工作流程畫布。",
        "add": "新增步驟",
        "remove": "移除步驟",
        "paletteTitle": "新增步驟",
        "stats": "{runs} 次執行 · {rate}% 成功率",
        "emptyBody": "尚無步驟——新增觸發器以啟動此工作流程。"
      },
      "connectionStringField": {
        "description": "連線字串輸入欄，輸入時自動辨識資料庫引擎。",
        "label": "連線字串",
        "helper": "postgres://user:password@host:5432/database——mysql:// 與 sqlite: 同樣支援。",
        "quickFill": "快速填入：",
        "host": "主機：{host}",
        "invalidScheme": "無法辨識的連線字串通訊協定。",
        "incomplete": "請在連線字串中補上主機與資料庫。"
      },
      "tableInclusionChecklist": {
        "description": "要納入的資料表，附列數與個人資料提示。",
        "pii": "個人資料",
        "highVolume": "資料量大",
        "a11yLabel": "要納入的資料表",
        "emptyTitle": "找不到資料表",
        "emptyBody": "連線資料庫後，其資料表會顯示在此處。"
      },
      "columnMappingTable": {
        "description": "將上傳檔案的欄位對應到資料表的欄位。",
        "skip": "不匯入",
        "sourceHeader": "來源欄位",
        "sampleHeader": "範例",
        "targetHeader": "目標欄位",
        "emptyTitle": "沒有可對應的欄位",
        "emptyBody": "上傳檔案後，其欄位會顯示在此處。"
      },
      "validationIssuesList": {
        "description": "匯入與驗證問題，依嚴重程度排序，並顯示受影響的列數。",
        "emptyTitle": "未發現問題",
        "emptyBody": "一切正常——可以開始匯入。"
      },
      "exportBuilder": {
        "description": "設定資料匯出：格式、日期範圍與包含內容。",
        "format": "格式",
        "from": "起始",
        "to": "截止",
        "groupBy": "分組依據",
        "includeCharts": "包含圖表",
        "email": "將匯出結果寄到我的信箱",
        "submit": "匯出",
        "running": "正在準備匯出…",
        "done": "匯出已就緒",
        "failed": "匯出失敗，請再試一次。",
        "download": "下載"
      },
      "questionBuilder": {
        "description": "問卷編輯器：新增題型並調整題目順序。",
        "paletteTitle": "新增題目",
        "add": "新增題目",
        "remove": "移除題目",
        "moveUp": "上移",
        "moveDown": "下移",
        "required": "必填",
        "questionPlaceholder": "輸入題目…",
        "emptyTitle": "尚無題目",
        "emptyBody": "選擇一種題型，開始建立您的問卷。",
        "questionLabel": "題目",
        "dropdownPlaceholder": "請選擇…",
        "kind": {
          "single-choice": "單選題",
          "multi-choice": "複選題",
          "dropdown": "下拉選單",
          "short-text": "簡答題",
          "long-text": "詳答題",
          "rating": "星級評分",
          "nps": "NPS 0–10",
          "date": "日期"
        }
      },
      "inlineEditableField": {
        "description": "文件或畫布中可點擊編輯的值。",
        "edit": "編輯",
        "save": "儲存",
        "cancel": "取消",
        "empty": "空白",
        "valueLabel": "值"
      },
      "passwordStrengthMeter": {
        "description": "顯示密碼強度的四段式指示器。",
        "label": "密碼強度",
        "weak": "弱",
        "fair": "普通",
        "good": "良好",
        "strong": "強"
      }
    },
    "chrome": {
      "sidebarNav": {
        "description": "應用程式的分組導覽列，附即時計數標記。",
        "a11yLabel": "主導覽",
        "emptyTitle": "尚無導覽",
        "emptyBody": "產生連線後，已納入的資料表將顯示於此。"
      },
      "commandPalette": {
        "description": "⌘K 命令面板：隨時搜尋動作、頁面與記錄。",
        "title": "命令面板",
        "placeholder": "搜尋動作、頁面與記錄…",
        "navigate": "導覽",
        "select": "開啟",
        "close": "關閉",
        "emptyTitle": "「{query}」沒有結果",
        "emptyBody": "開始輸入以搜尋。",
        "groupActions": "動作",
        "groupNavigate": "導覽",
        "groupRecent": "最近",
        "groupPages": "頁面",
        "groupMetrics": "指標",
        "groupPeople": "人員",
        "groupRecords": "記錄"
      },
      "globalSearch": {
        "description": "跨所有實體搜尋，附類型分面與結果摘要。",
        "placeholder": "搜尋全部…",
        "all": "全部",
        "summary": "「{query}」的 {count} 筆結果",
        "emptyTitle": "無結果",
        "emptyBody": "請嘗試其他搜尋字詞。",
        "searchLabel": "搜尋",
        "facetRailLabel": "依類型篩選"
      },
      "breadcrumb": {
        "description": "目前記錄或資料夾的階層路徑。",
        "a11yLabel": "麵包屑導覽"
      },
      "tabBar": {
        "description": "用於切換面板或導覽的分頁，可附計數。",
        "a11yLabel": "分頁"
      },
      "navCard": {
        "description": "用於導覽頁與登陸頁的連結卡片格線。",
        "emptyTitle": "無內容可顯示",
        "emptyBody": "頁面產生後連結將顯示於此。"
      },
      "shortcutsPanel": {
        "description": "鍵盤快速鍵速查表。",
        "footerHint": "隨時按 ?",
        "then": "接著",
        "emptyTitle": "未註冊任何快速鍵。",
        "generalGroupLabel": "一般",
        "navigationGroupLabel": "導覽",
        "recordsGroupLabel": "記錄",
        "openCommandPaletteLabel": "開啟命令面板",
        "searchLabel": "搜尋",
        "showShortcutsLabel": "顯示快速鍵",
        "goToDashboardLabel": "前往儀表板",
        "goToOrdersLabel": "前往訂單",
        "newRecordLabel": "新增記錄",
        "saveLabel": "儲存",
        "undoLabel": "復原"
      },
      "avatarStack": {
        "description": "帶「+N」溢位與可選在線狀態的重疊頭像。",
        "online": "{count} 人在線",
        "a11yLabel": "人員"
      }
    },
    "system": {
      "stateHero": {
        "description": "用於 404、500、離線、無權限與維護狀態的整頁狀態畫面。",
        "notFoundTitle": "這個頁面走錯路了",
        "notFoundBody": "您要找的頁面已被移動、重新命名，或從未存在。",
        "serverErrorTitle": "我們這邊出了點問題",
        "serverErrorBody": "錯誤已記錄並已通知團隊。重試通常有效。",
        "offlineTitle": "您已離線",
        "offlineBody": "請檢查網路連線——儀表板會自動重新連線。",
        "forbiddenTitle": "您沒有存取權限",
        "forbiddenBody": "請聯絡工作區管理員為您授予此頁面的權限。",
        "maintenanceTitle": "維護中",
        "maintenanceBody": "我們正在改進。通常只需幾分鐘。",
        "connErrorTitle": "無法連線資料庫",
        "connErrorBody": "連線遭拒或逾時。請檢查連線設定。",
        "backToDashboard": "返回儀表板",
        "tryAgain": "重試",
        "retry": "重試",
        "testConnection": "測試連線"
      },
      "emptyState": {
        "description": "帶可選動作的置中「尚無內容」面板。"
      },
      "statusPill": {
        "description": "用於列舉欄位的彩色標記——通用狀態呈現器。"
      },
      "alertBanner": {
        "description": "用於配額、凍結與排程提示的內嵌提示列。",
        "dismiss": "關閉"
      },
      "statusBannerHero": {
        "description": "服務健康狀態橫幅，其狀態取自清單中最差的服務。",
        "upTitle": "所有系統運作正常",
        "upBody": "所有受監控的服務均正常回應。",
        "degradedTitle": "效能降低",
        "degradedBody": "部分服務比平常慢。我們正在調查。",
        "downTitle": "重大故障",
        "downBody": "一項或多項服務無法使用。我們正在處理。"
      },
      "connectionStatus": {
        "description": "資料庫連線的連線或測試結果。",
        "idle": "未連線",
        "connecting": "連線中…",
        "connected": "已連線",
        "failed": "連線失敗",
        "test": "測試"
      },
      "autosaveIndicator": {
        "description": "自動儲存文件的「未儲存 → 儲存中 → 已儲存」標記。",
        "dirty": "有未儲存的變更",
        "saving": "儲存中…",
        "saved": "所有變更已儲存",
        "error": "儲存失敗"
      },
      "progressLogConsole": {
        "description": "帶進度條的串流日誌主控台，用於長時間執行的工作。",
        "a11yLabel": "進度日誌",
        "progressLabel": "進度",
        "emptyTitle": "尚無內容",
        "emptyBody": "工作開始後日誌將顯示於此。"
      },
      "diagnosticsReadout": {
        "description": "連線檢查結果，以帶顏色的鍵/值列顯示，並附檢查時間。",
        "checkedAt": "最後檢查",
        "host": "主機",
        "dns": "DNS",
        "tcp": "TCP",
        "tls": "TLS",
        "auth": "驗證",
        "latency": "延遲"
      },
      "widgetMissing": {
        "description": "當儲存的頁面參照到未安裝的小工具時，顯示的備用卡片。",
        "title": "小工具無法使用",
        "bodyLead": "沒有小工具註冊為",
        "bodyTail": "它可能屬於較新的版本，或未安裝的擴充功能。"
      }
    }
  },
  "grid": {
    "dragHandle": "拖曳以移動 {title}",
    "resizeHandle": "調整 {title} 的大小",
    "a11y": {
      "grabbed": "已抓取 {title}。使用方向鍵移動，按住 Shift 調整大小，Enter 儲存，Esc 取消。",
      "moved": "{title} 已移動到第 {col} 欄，第 {row} 列。",
      "resized": "{title} 已調整為 {w} 欄 × {h} 列。",
      "committed": "{title} 已放置在第 {col} 欄，第 {row} 列。",
      "reverted": "{title} 已返回原始位置。"
    },
    "draggableRole": "可拖曳的小工具"
  },
  "templates": {
    "crud": {
      "newRow": "新增資料列",
      "exportAction": "匯出",
      "searchPlaceholder": "搜尋 {table}…",
      "removeFilter": "移除 {column} 篩選",
      "queryFailed": "查詢失敗",
      "loadingRows": "正在載入資料列",
      "noMatchesTitle": "沒有相符的資料列",
      "emptyTitle": "{count, plural, other {No {entity}s yet}}",
      "createTitle": "新增 {entity}",
      "createSubtitle": "會在 {table} 中建立一筆資料列。",
      "createSubmit": "新增 {entity}",
      "createSuccessTitle": "已新增 {name}",
      "createSuccessBody": "您可以從通知中復原這項操作。",
      "editTitle": "編輯 {entity}",
      "saveSubmit": "儲存變更",
      "deleteTitle": "刪除 {entity}",
      "deletePreflight": "正在檢查參照…",
      "deleteNoReferences": "此資料列沒有任何傳入參照。",
      "deleteConsequencesIntro": "刪除此資料列也會影響：",
      "referenceRows": "{count, plural, other {{n} rows}}",
      "confirmPrompt": "請輸入 {value} 以確認",
      "bulkDeleteTitle": "{count, plural, other {Delete {n} rows}}",
      "bulkDeleteBody": "參照造成的影響會套用到每一筆選取的資料列。",
      "bulkDeleteConfirm": "刪除資料列",
      "uniqueHelper": "在 {table} 中必須是唯一值。",
      "uniqueHelperCounted": "{count, plural, other {Checked against {n} rows.}}",
      "toast": {
        "created": "已建立 {entity}。",
        "createFailed": "建立失敗。",
        "saved": "變更已儲存。",
        "updateFailed": "更新失敗。",
        "deleted": "已刪除 {name}。",
        "deleteFailed": "刪除失敗。",
        "bulkDeleted": "{count, plural, other {{n} rows deleted.}}",
        "bulkDeleteFailed": "批次刪除失敗。",
        "undone": "已復原變更。",
        "undoFailed": "復原失敗。"
      },
      "detail": {
        "fields": "欄位",
        "inboundReferences": "個傳入參照",
        "relatedCount": "{count, plural, other {{n} related records in {table}}}",
        "loadError": "無法載入此記錄。"
      }
    },
    "queue": {
      "allSegment": "全部",
      "daysUnit": "{count, plural, other {{count} days}}",
      "approvedToast": "已核准 {count} 項。",
      "rejectedToast": "已拒絕 {count} 項。",
      "undoneToast": "已復原該決定。",
      "undoFailedToast": "無法復原該決定。",
      "failedToast": "操作失敗。",
      "invalidConfig": "此佇列儲存的設定無效。請重新產生頁面以還原。",
      "queueLabel": "佇列",
      "statusFilterLabel": "狀態篩選",
      "errorTitle": "無法載入此佇列",
      "loading": "正在載入佇列",
      "emptyTitle": "佇列是空的",
      "emptyBody": "新請求送達後會顯示在這裡。",
      "caughtUpTitle": "全部處理完畢",
      "caughtUpBody": "此索引標籤目前沒有請求。",
      "selectItem": "選取 {title}",
      "selectPrompt": "選擇一個請求",
      "selectBody": "選擇一個項目以檢視其詳細資料。",
      "rejectTitle": "拒絕請求",
      "rejectCount": "已選 · {count}",
      "rejectPlaceholder": "為請求者新增備註…",
      "rejectReasonLabel": "拒絕原因",
      "rejectNote": "請求者會收到通知與您的備註。"
    },
    "dashboard": {
      "invalidLayout": "此儀表板儲存的版面配置無效。請重新產生頁面或重設其版面配置。"
    },
    "builder": {
      "publish": "發佈",
      "paletteTitle": "區塊",
      "inspectorTitle": "檢閱器",
      "startFromTemplate": "從範本開始",
      "untitledDoc": "未命名文件",
      "invalidConfig": "此建立工具頁面儲存的設定無效。請重新產生頁面或將其重設。",
      "starterPicker": {
        "subtitle": "選取範本會取代目前的草稿。"
      },
      "inspector": {
        "titleLabel": "標題",
        "numberLabel": "編號",
        "currencyLabel": "幣別",
        "taxRateLabel": "稅率 %",
        "modulesLabel": "模組"
      },
      "summary": {
        "questions": "題目",
        "estLength": "預估長度",
        "estMinutes": "約 {minutes} 分鐘",
        "steps": "步驟",
        "triggers": "觸發器",
        "conditions": "條件",
        "actions": "動作",
        "triggerLocked": "觸發器步驟無法移除。"
      },
      "publishModal": {
        "confirmTitle": "要發佈問卷嗎？",
        "confirmSubtitle": "上線前請先確認內容。",
        "confirmCta": "發佈問卷",
        "publishedTitle": "問卷已發佈",
        "publishedSubtitle": "您的問卷已上線，正在收集回覆。"
      },
      "blocks": {
        "block-totals-summary": "總計摘要",
        "block-line-items": "明細列",
        "block-kpi-row": "指標列",
        "block-bar-chart": "長條圖",
        "block-line-chart": "折線圖",
        "block-two-col-table": "兩欄表格",
        "block-tax-breakdown": "稅金明細",
        "block-multi-currency": "多幣別",
        "block-payment-history": "付款紀錄",
        "block-discount-codes": "折扣碼",
        "block-loyalty-banner": "會員點數",
        "block-recurring-banner": "週期性",
        "block-qr-pay": "付款 QR 碼",
        "block-delivery-stepper": "配送流程",
        "block-signature": "簽名",
        "block-terms-checkbox": "條款",
        "block-approval": "簽核",
        "block-attachments": "附件",
        "block-late-fees": "逾期費用",
        "block-image-placeholder": "圖片",
        "block-contact": "聯絡人",
        "block-highlight-box": "重點提示框"
      },
      "starters": {
        "titles": {
          "st-standard": "標準發票",
          "st-recurring": "週期性訂閱",
          "st-deposit": "訂金請款",
          "st-credit-note": "貸項通知單",
          "st-late-reminder": "逾期付款提醒",
          "st-quote": "報價／估價單",
          "st-proforma": "形式發票",
          "st-receipt": "付款收據",
          "st-retainer": "預付服務費",
          "st-usage": "用量計費發票",
          "st-milestone": "專案里程碑",
          "st-donation": "捐款收據（稅籍編號）",
          "st-monthly": "每月摘要",
          "st-quarterly": "季度回顧",
          "st-usage-report": "用量明細",
          "st-exec": "主管單頁報告",
          "st-welcome": "歡迎信",
          "st-receipt-email": "發票收據",
          "st-digest": "每週摘要",
          "st-dunning": "付款提醒"
        },
        "categories": {
          "billing": "帳務",
          "sales": "銷售",
          "nonProfit": "非營利",
          "reports": "報表",
          "lifecycle": "生命週期",
          "transactional": "交易通知",
          "marketing": "行銷"
        }
      }
    },
    "common": {
      "clearFilters": "清除篩選",
      "noMatchesBody": "試試其他搜尋詞或移除篩選。",
      "detailLabel": "詳細資料",
      "loadingRecord": "正在載入記錄"
    },
    "directory": {
      "invalidConfig": "此通訊錄儲存的設定無效。請重新產生頁面以還原。",
      "searchPlaceholder": "搜尋人員…",
      "memberCount": "{count, plural, other {{n} people}}",
      "errorTitle": "無法載入此通訊錄",
      "loading": "正在載入人員",
      "emptyTitle": "尚未有人員",
      "emptyBody": "資料表有資料列後，人員會顯示在這裡。",
      "noMatchesTitle": "沒有相符的人員",
      "detailTitle": "人員"
    },
    "masterDetail": {
      "invalidConfig": "此頁面儲存的設定無效。請重新產生頁面以還原。",
      "railTitle": "記錄",
      "errorTitle": "無法載入此清單",
      "loading": "正在載入記錄",
      "emptyBody": "資料表有資料列後，記錄會顯示在這裡。",
      "noMatchesTitle": "沒有相符的記錄",
      "noMatchesBody": "試試移除篩選。",
      "selectPrompt": "選擇一筆記錄",
      "selectBody": "從清單中選擇項目以檢視其詳細資料。"
    },
    "chat": {
      "invalidLayout": "此聊天頁面儲存的版面配置無效。請重新產生頁面或重設其版面配置。",
      "noInboxTitle": "此頁面沒有收件匣",
      "noInboxBody": "請重新產生頁面。",
      "conversationsFailed": "對話查詢失敗",
      "messagesFailed": "訊息查詢失敗",
      "loadingConversations": "正在載入對話",
      "loadingMessages": "正在載入訊息",
      "selectTitle": "選擇一則對話",
      "selectBody": "從收件匣選擇一則對話以閱讀其訊息。"
    },
    "files": {
      "allFiles": "所有檔案",
      "recent": "最近",
      "starred": "已加星號",
      "invalidLayout": "此檔案頁面儲存的版面配置無效。請重新產生頁面或重設其版面配置。",
      "missingSlotTitle": "此頁面沒有檔案瀏覽器",
      "missingSlotBody": "儲存的版面配置沒有瀏覽器版位。請重新產生頁面。",
      "loadFailed": "檔案查詢失敗",
      "loading": "正在載入檔案",
      "uploadsUnavailable": "此頁面尚不支援上傳。",
      "previewTitle": "檔案",
      "kindLabel": "類型",
      "linkLabel": "連結"
    },
    "logViewer": {
      "invalidLayout": "此記錄檔頁面儲存的版面配置無效。請重新產生頁面或重設其版面配置。",
      "levelFilterLabel": "記錄層級篩選",
      "timeFilterLabel": "時間範圍篩選",
      "window": {
        "1h": "1 小時",
        "24h": "24 小時",
        "7d": "7 天"
      },
      "heldCount": "+{count}",
      "missingSlotTitle": "此頁面沒有記錄檔小工具",
      "missingSlotBody": "儲存的版面配置沒有記錄檔版位。請重新產生頁面。",
      "loadFailed": "記錄檔查詢失敗",
      "loading": "正在載入記錄項目",
      "traceTitle": "追蹤",
      "latestTitle": "最新動態",
      "backToLatest": "回到最新",
      "eventFallback": "事件"
    },
    "calendar": {
      "eventCount": "{count, plural, other {{n} events}}",
      "composePlaceholder": "事件標題…",
      "addEvent": "新增事件",
      "dateRange": "日期範圍",
      "agendaTitle": "議程",
      "categoriesTitle": "類別",
      "upcomingTitle": "即將到來",
      "invalidLayout": "此行事曆儲存的版面配置無效。請重新產生頁面或重設其版面配置。"
    },
    "scheduler": {
      "previousWeek": "上一週",
      "nextWeek": "下一週",
      "week": "週",
      "month": "月",
      "invalidLayout": "此排班表儲存的版面配置無效。請重新產生頁面或重設其版面配置。",
      "shiftCount": "{count, plural, other {{n} shifts}}",
      "addShift": "新增班次"
    },
    "settings": {
      "title": "通知設定",
      "subtitle": "選擇您要接收哪些通知，以及接收方式",
      "matrixLabel": "通知我以下事件",
      "rowHeader": "事件",
      "saved": "已儲存",
      "unavailableTag": "尚未提供",
      "loading": "正在載入偏好設定",
      "errorTitle": "無法載入這些設定",
      "emptyTitle": "尚無可設定的項目",
      "emptyBody": "產生通知的功能推出後，通知事件會顯示在這裡。"
    },
    "pageCrud": {
      "description": "標準的資料表頁面：可搜尋的資料格線、建立與編輯表單、含參照檢查的安全刪除，以及可復原的變更。"
    },
    "pageDashboard": {
      "description": "以您的資料為基礎的小工具儀表板：可編輯格線上的指標卡、圖表與清單。"
    },
    "pageBoard": {
      "description": "依狀態欄位分組的看板——在欄之間拖曳卡片即可更新記錄。"
    },
    "pageCalendar": {
      "description": "月曆檢視，含議程、類別篩選，並可從日期欄位快速建立事件。"
    },
    "pageScheduler": {
      "description": "週 × 資源的班次矩陣，含產能追蹤與涵蓋合計。"
    },
    "pageDirectory": {
      "description": "人員通訊錄，含搜尋、群組篩選與個人資料抽屜。"
    },
    "pageMasterDetail": {
      "description": "清單與詳情並排的版面：在左側選取記錄，在右側進行處理。"
    },
    "pageQueueInbox": {
      "description": "審核佇列，支援核准與拒絕決定、批次操作與復原。"
    },
    "pageLogViewer": {
      "description": "即時追加的記錄檔表格，含層級與時間篩選，以及追蹤側邊面板。"
    },
    "pageFiles": {
      "description": "檔案瀏覽器，含智慧資料夾、上傳與預覽抽屜。"
    },
    "pageChat": {
      "description": "對話收件匣與訊息串並列，繫結至您的訊息資料表。"
    },
    "pageBuilder": {
      "description": "拖放式文件建立工具，含區塊面板、檢閱器與發佈流程。"
    },
    "pageWizard": {
      "description": "多步驟引導流程，帶領使用者完成結構化的作業。"
    },
    "pageSettings": {
      "description": "通知偏好設定矩陣，含各管道開關與自動儲存。"
    }
  },
  "frame": {
    "noResult": "此小工具沒有結果",
    "emptyTitle": "此範圍沒有資料",
    "loadError": "載入此小工具時發生錯誤。",
    "renderError": "此小工具無法顯示。",
    "refreshing": "重新整理中",
    "infoLabel": "小工具資訊",
    "menuLabel": "小工具選單"
  },
  "charts": {
    "livePillLabel": "即時",
    "forecast": {
      "nowLabel": "現在",
      "forecastLabel": "預測",
      "actualLabel": "實際"
    },
    "otherLabel": "其他",
    "heat": {
      "lessLabel": "較少",
      "moreLabel": "較多"
    },
    "choropleth": {
      "lowLabel": "低",
      "highLabel": "高"
    },
    "funnel": {
      "stepConversion": "{pct}% 繼續",
      "overallConversion": "整體 {pct}%"
    }
  }
} as const;
