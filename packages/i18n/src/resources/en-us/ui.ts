// SPDX-License-Identifier: AGPL-3.0-only
/**
 * GENERATED MIRROR of ../../../locales/en-US/ui.json — do not edit by hand.
 * The JSON file is the canonical hand-authored bundle (10-i18n-theming.md §3.1);
 * this TS mirror exists so the runtime can bundle a namespace (en-US's eager
 * ones) or chunk-split it (every other locale, and en-US's deferred `studio`)
 * without JSON import attributes (browser + NodeNext safe).
 * Parity is enforced by src/resources/parity.test.ts. Regenerate with
 * scripts/gen-resources.mjs.
 */
export default {
  "action": {
    "close": "Close",
    "cancel": "Cancel",
    "confirm": "Confirm",
    "save": "Save",
    "apply": "Apply",
    "delete": "Delete",
    "edit": "Edit",
    "copy": "Copy",
    "copied": "Copied",
    "undo": "Undo",
    "retry": "Retry",
    "clear": "Clear",
    "selectAll": "Select all",
    "clearSelection": "Clear selection",
    "showPassword": "Show password",
    "hidePassword": "Hide password",
    "reveal": "Reveal",
    "hide": "Hide",
    "clearSearch": "Clear search"
  },
  "state": {
    "loading": "Loading…",
    "empty": "Nothing here yet",
    "noResults": "No results",
    "optional": "Optional",
    "required": "Required",
    "error": "Something went wrong"
  },
  "pagination": {
    "previous": "Previous",
    "next": "Next",
    "pageOf": "Page {page, number} of {pages, number}",
    "rowsPerPage": "Rows per page",
    "range": "{from, number}–{to, number} of {total, number}"
  },
  "table": {
    "sortAscending": "Sort ascending",
    "sortDescending": "Sort descending",
    "rowActions": "Row actions",
    "selectRow": "Select row",
    "selectAllRows": "Select all rows"
  },
  "dialog": {
    "close": "Close dialog",
    "confirmTitle": "Are you sure?"
  },
  "combobox": {
    "placeholder": "Select…",
    "search": "Search…",
    "noMatches": "No matches"
  },
  "toast": {
    "dismiss": "Dismiss notification"
  },
  "widgets": {
    "kpi": {
      "statCard": {
        "description": "The workhorse metric card: a headline aggregate with an optional trend pill and mini sparkline."
      },
      "usageMeter": {
        "description": "Quota consumption against a limit; the bar turns amber, then red, past your thresholds.",
        "usageLabel": "Usage",
        "ofLabel": "of"
      },
      "statTileCompact": {
        "description": "A slim metric tile with a micro-label, trend chip, and 6-bar spark — for dense rows of 4 to 6."
      },
      "metricHero": {
        "description": "One oversized metric that counts up on load, with a trend pill, spark, and goal progress.",
        "goalLabel": "Goal"
      },
      "statPairCard": {
        "description": "Two metrics side by side; the second can be derived from the first."
      },
      "gaugeRing": {
        "description": "A ring gauge for a score or percentage, tinted by the band the value falls in."
      },
      "gaugeArc": {
        "description": "A speedometer arc with qualitative bands and a needle; also renders a grid of gauges.",
        "emptyTitle": "No gauges to show",
        "emptyBody": "Services appear here as gauges once there is a reading for them."
      },
      "periodComparison": {
        "description": "This period against last as two bars, with the difference computed underneath.",
        "higherLabel": "higher",
        "lowerLabel": "lower",
        "flatLabel": "flat",
        "periodALabel": "This period",
        "periodBLabel": "Last period"
      },
      "microKpiSubtitle": {
        "description": "A one-line header stat built from a template, recomputed from live state."
      },
      "autoInsights": {
        "description": "Ranked insight bullets — a headline stat, a sentence, and a spark — with a refresh rotation.",
        "emptyTitle": "No insights yet",
        "emptyBody": "Insights appear once there is enough data to spot a pattern.",
        "refreshLabel": "Refresh"
      }
    },
    "charts": {
      "boxplot": {
        "description": "Whisker-and-box summary of a numeric column's spread per category — min, quartiles, median and max.",
        "emptyTitle": "No distribution to plot",
        "emptyBody": "No rows matched the filters to summarise as box plots.",
        "chartLabel": "Box plot"
      },
      "violin": {
        "description": "Mirrored density curves comparing how a numeric column is distributed across groups.",
        "emptyTitle": "No distribution to plot",
        "emptyBody": "No rows matched the filters to build density profiles.",
        "chartLabel": "Violin plot"
      },
      "ridgeline": {
        "description": "Overlapping density ridges comparing a numeric column across ordered groups.",
        "emptyTitle": "No ridges to plot",
        "emptyBody": "No rows matched the filters to build density profiles.",
        "chartLabel": "Ridgeline"
      },
      "scatterBubble": {
        "description": "Two numeric columns as points, with an optional bubble size and a trend line.",
        "emptyTitle": "No points to plot",
        "emptyBody": "No rows matched the filters for the selected columns.",
        "chartLabel": "Scatter plot"
      },
      "hexbin": {
        "description": "Hex-binned density of two numeric columns, shaded by how many rows fall in each tile.",
        "emptyTitle": "No density to plot",
        "emptyBody": "No rows matched the filters to bin.",
        "chartLabel": "Density hexbin"
      },
      "correlationMatrix": {
        "description": "Pearson correlation between selected numeric columns, from strong positive to strong negative.",
        "emptyTitle": "Nothing to correlate",
        "emptyBody": "Select at least two numeric columns with matching rows.",
        "chartLabel": "Correlation matrix"
      },
      "parallelCoordinates": {
        "description": "Each record as a line across several normalised numeric axes, coloured by a category.",
        "emptyTitle": "No records to plot",
        "emptyBody": "No rows matched the filters across the selected axes.",
        "chartLabel": "Parallel coordinates"
      },
      "unexpectedShape": "Unexpected data shape.",
      "lineArea": {
        "chartLabel": "Line chart",
        "description": "A metric over time as a line with a soft area fill, with an optional dashed prior-period comparison."
      },
      "bar": {
        "chartLabel": "Bar chart",
        "description": "Categorical or time-bucketed values as vertical bars, with an optional highlight on the largest or current bar."
      },
      "donut": {
        "chartLabel": "Donut chart",
        "otherLabel": "Other",
        "description": "Category shares as donut slices with a legend and centre total, folding small slices into an Other bucket."
      },
      "bullet": {
        "chartLabel": "Bullet chart",
        "description": "Progress toward a goal as a measure bar over qualitative bands, with a target tick per row.",
        "emptyTitle": "No goals to track",
        "emptyBody": "Add measures with targets to compare against."
      },
      "rankingBars": {
        "chartLabel": "Ranking",
        "description": "A top-N ranking as horizontal bars — the leader at full strength, the rest dimmed — with values alongside.",
        "emptyTitle": "Nothing to rank",
        "emptyBody": "No records matched this breakdown yet."
      },
      "pareto": {
        "chartLabel": "Pareto chart",
        "description": "Sorted category bars under a cumulative-percent line, with an optional 80% cutline.",
        "emptyTitle": "No categories to chart",
        "emptyBody": "No grouped counts were returned for this range."
      },
      "waterfall": {
        "chartLabel": "Waterfall chart",
        "description": "A floating-bar bridge from a start total through positive and negative steps to a net total.",
        "emptyTitle": "No movement to bridge",
        "emptyBody": "No start, change, or total steps were found."
      },
      "marimekko": {
        "chartLabel": "Marimekko chart",
        "description": "A two-level mix as variable-width stacked columns — width for the outer share, segments for the inner split.",
        "emptyTitle": "No mix to break down",
        "emptyBody": "No two-level breakdown was returned for this range."
      },
      "stackedBar100": {
        "chartLabel": "100% stacked bar",
        "description": "One 100% bar split into proportional segments with a legend, comparing shares of a whole.",
        "emptyTitle": "No shares to split",
        "emptyBody": "No parts were returned for this breakdown."
      },
      "slope": {
        "chartLabel": "Slope chart",
        "description": "Two periods joined by one line per record, coloured by whether the value rose or fell.",
        "emptyTitle": "No period shift to show",
        "emptyBody": "No before/after values were returned to compare."
      },
      "multiline": {
        "chartLabel": "Multi-line chart",
        "description": "Several series as overlaid lines with end labels, comparing trends over the same time span.",
        "emptyTitle": "No series to plot",
        "emptyBody": "No time series matched the filters for this range."
      },
      "stream": {
        "chartLabel": "Stream chart",
        "description": "Stacked bands flowing around a centre line, showing how a total's composition shifts over time.",
        "emptyTitle": "No flow to chart",
        "emptyBody": "No stacked series were returned for this range."
      },
      "forecast": {
        "chartLabel": "Forecast chart",
        "nowLabel": "Now",
        "forecastLabel": "Forecast",
        "actualLabel": "Actual",
        "description": "A history line extended by a dashed projection inside a widening confidence band, split at a now divider.",
        "emptyTitle": "No history to project",
        "emptyBody": "No past points were returned to forecast from."
      },
      "anomaly": {
        "chartLabel": "Anomaly chart",
        "description": "A value line over its expected range, flagging points that fall outside it with halo dots.",
        "emptyTitle": "No signal to scan",
        "emptyBody": "No points were returned to check for anomalies."
      },
      "candlestick": {
        "chartLabel": "Candlestick chart",
        "livePillLabel": "Live",
        "description": "Open-high-low-close candles coloured by direction, with a dashed last-price line and an optional live pill.",
        "emptyTitle": "No candles to chart",
        "emptyBody": "No open-high-low-close rows matched this range."
      },
      "bump": {
        "chartLabel": "Bump chart",
        "description": "Rank-over-time lines showing how competitors trade places between periods.",
        "emptyTitle": "No ranks to trace",
        "emptyBody": "No period-over-period rankings were returned."
      },
      "timelineLanes": {
        "chartLabel": "Timeline lanes",
        "laneLabel": "Events",
        "description": "Dated events as pills on horizontal swimlanes sharing one time axis.",
        "emptyTitle": "No events to place",
        "emptyBody": "No events matched the filters for this range."
      },
      "treemap": {
        "chartLabel": "Treemap",
        "otherLabel": "Other",
        "description": "A part-to-whole breakdown as squarified tiles sized by value, folding small slices into an Other tile.",
        "emptyTitle": "No slices to tile",
        "emptyBody": "No categories were returned for this breakdown."
      },
      "sunburst": {
        "chartLabel": "Sunburst",
        "description": "A two-level hierarchy as nested rings — parents inside, their children outside — with a parent legend.",
        "emptyTitle": "No rings to draw",
        "emptyBody": "No grouped categories were returned to nest."
      },
      "funnel": {
        "chartLabel": "Funnel",
        "description": "Ordered shrinking stages with per-step continuation rates and an overall-conversion footer.",
        "emptyTitle": "No stages to funnel",
        "emptyBody": "No step counts were returned for this range."
      },
      "radialBar": {
        "chartLabel": "Radial bar",
        "description": "Up to four percentages as concentric progress rings with a dot legend.",
        "emptyTitle": "No rings to fill",
        "emptyBody": "No categories matched this breakdown yet."
      },
      "radar": {
        "chartLabel": "Radar",
        "description": "Several named axes on a polygon with one filled shape per series, against an optional target overlay.",
        "emptyTitle": "No axes to compare",
        "emptyBody": "No matrix of series and axes was returned."
      },
      "chord": {
        "chartLabel": "Chord",
        "description": "Pairwise flows as ribbons between nodes on a ring, with ribbon opacity weighted by volume.",
        "emptyTitle": "No flows to link",
        "emptyBody": "No connections between groups were returned."
      },
      "wordcloud": {
        "chartLabel": "Word cloud",
        "description": "Terms sized by frequency and flowed into rows, for a glanceable view of what dominates.",
        "emptyTitle": "No terms to cloud",
        "emptyBody": "No weighted terms matched the filters."
      },
      "cohortMatrix": {
        "chartLabel": "Cohort retention",
        "description": "Cohort rows against period columns, each cell shaded by retention or revenue.",
        "regionLabel": "Cohort matrix"
      },
      "heatmapCalendar": {
        "chartLabel": "Activity calendar",
        "legendLessLabel": "Less",
        "legendMoreLabel": "More",
        "description": "A year of daily activity as a week-by-day grid shaded by intensity.",
        "regionLabel": "Activity calendar"
      },
      "heatMonth": {
        "chartLabel": "Monthly activity",
        "description": "One calendar month as a day grid shaded by each day's value.",
        "regionLabel": "Monthly heat map"
      },
      "choroplethGrid": {
        "chartLabel": "Regional breakdown",
        "legendLowLabel": "Low",
        "legendHighLabel": "High",
        "description": "Regional values as a tinted US tilegram or compact grid, with an optional top-N ranking list."
      },
      "sankey": {
        "chartLabel": "Flow",
        "description": "Layered source-to-target flows as ribbons whose thickness encodes volume."
      },
      "sparkline": {
        "description": "An inline micro-trend of recent values — no axes or labels — for KPI cards, table cells and list rows."
      }
    },
    "feeds": {
      "activityFeed": {
        "description": "A running feed of who did what across your workspace, newest first.",
        "emptyTitle": "No recent activity",
        "emptyBody": "Actions across your workspace will show up here.",
        "viewAllLabel": "View all"
      },
      "notificationFeed": {
        "description": "Grouped notifications with unread state, filters, and inline actions.",
        "emptyTitle": "No notifications",
        "emptyBody": "New notifications will appear here.",
        "allLabel": "All",
        "unreadLabel": "Unread",
        "mentionsLabel": "Mentions",
        "filterLabel": "Notification filter",
        "markAllReadLabel": "Mark all read",
        "todayLabel": "Today",
        "yesterdayLabel": "Yesterday",
        "earlierLabel": "Earlier",
        "dismissLabel": "Dismiss",
        "emptyUnreadTitle": "You're all caught up",
        "emptyMentionsTitle": "No mentions"
      },
      "realtimeFeed": {
        "description": "A live event stream that prepends new items as they arrive.",
        "emptyTitle": "Waiting for events",
        "emptyBody": "Live events will stream in as they happen.",
        "liveLabel": "Live",
        "pausedLabel": "Paused",
        "pauseLabel": "Pause",
        "resumeLabel": "Resume"
      },
      "timelineVertical": {
        "description": "A vertical timeline of events, releases, incidents, or run steps.",
        "emptyTitle": "Nothing here yet",
        "emptyBody": "Events will appear on this timeline as they happen."
      },
      "unreadBadge": {
        "description": "A count pill showing unread items, synced with feed state.",
        "unitLabel": "unread"
      },
      "loadOlderPaginator": {
        "description": "A footer button that loads older records in batches until the feed is exhausted.",
        "label": "Load older",
        "loadingLabel": "Loading…",
        "exhaustedLabel": "Nothing older",
        "ofLabel": "of"
      },
      "toastStack": {
        "description": "The overlay toast host: brief confirmations with an optional Undo.",
        "undoLabel": "Undo",
        "dismissLabel": "Dismiss",
        "regionLabel": "Notifications"
      }
    },
    "calendar": {
      "calendarMonth": {
        "description": "A month grid of scheduled events with per-day chips and month navigation.",
        "emptyTitle": "Nothing scheduled",
        "emptyBody": "Scheduled events will appear on this calendar.",
        "previousLabel": "Previous month",
        "nextLabel": "Next month",
        "overflowLabel": "+{count} more"
      },
      "dayAgenda": {
        "description": "The selected day's events as a time-ordered agenda.",
        "emptyTitle": "Nothing scheduled",
        "emptyBody": "Events for the selected day will appear here.",
        "countLabel": "{count, plural, one {{n} event} other {{n} events}}"
      },
      "scheduleMatrix": {
        "description": "A resource-by-day shift grid with per-day coverage and a shift legend.",
        "emptyTitle": "No shifts scheduled",
        "emptyBody": "Assigned shifts will appear on this schedule.",
        "resourceLabel": "Resource",
        "coverageLabel": "Coverage",
        "hoursLabel": "{hours}h"
      },
      "capacityBoard": {
        "description": "Per-member utilization bars with a project breakdown and load status.",
        "emptyTitle": "No workload data",
        "emptyBody": "Member utilization will appear here once assignments exist.",
        "status": {
          "overloaded": "Overloaded",
          "balanced": "Balanced",
          "available": "Available"
        },
        "utilizationLabel": "{name}: {util}%",
        "assignmentLabel": "{project} · {hours}h",
        "periodLabel": "h · {period}",
        "period": {
          "week": "week",
          "month": "month"
        }
      },
      "calendarLegendFilter": {
        "description": "Event categories with counts; toggling one filters the calendar beside it.",
        "emptyTitle": "No categories yet",
        "emptyBody": "Event categories will appear here once events exist.",
        "uncategorizedLabel": "Uncategorized",
        "listLabel": "Categories"
      },
      "upcomingEventsList": {
        "description": "The next scheduled events, date-ascending, with owner and status.",
        "emptyTitle": "Nothing upcoming",
        "emptyBody": "Scheduled events will appear here as they are planned.",
        "listLabel": "Upcoming events"
      },
      "dateRangePicker": {
        "description": "A start/end date range with quick presets that filters the rest of the page.",
        "previousLabel": "Previous month",
        "nextLabel": "Next month",
        "summaryLabel": "{n} days selected",
        "presets": {
          "7d": "Last 7 days",
          "30d": "Last 30 days",
          "90d": "Last 90 days",
          "mtd": "Month to date",
          "qtd": "Quarter to date",
          "ytd": "Year to date"
        }
      },
      "scheduledJobsList": {
        "description": "Recurring reports and exports with their cadence, next run, and an on/off switch.",
        "emptyTitle": "No scheduled jobs",
        "emptyBody": "Recurring reports and exports will appear here once scheduled.",
        "nextRunLabel": "Next run",
        "toggleLabel": "Enable schedule",
        "recipientsLabel": "Recipients",
        "listLabel": "Scheduled jobs"
      }
    },
    "tables": {
      "masterList": {
        "description": "A selectable list of records that drives a detail pane.",
        "emptyTitle": "No items match this filter",
        "emptyBody": "Items will appear here once they exist.",
        "allLabel": "All",
        "toggleLabel": "Toggle {title}",
        "progressLabel": "{title} progress"
      },
      "logTable": {
        "description": "An append-only event log with search, an errors filter, and row actions.",
        "emptyTitle": "No log entries",
        "emptyBody": "Events will be recorded here as they happen.",
        "liveLabel": "Live",
        "placeholder": "Search logs…",
        "filterLabel": "Log filter",
        "allLabel": "All",
        "errorsLabel": "Errors",
        "noMatchesLabel": "No matching entries",
        "todayLabel": "Today",
        "yesterdayLabel": "Yesterday",
        "action": {
          "retry": "retry",
          "download": "download",
          "inspect": "inspect"
        }
      },
      "cardGallery": {
        "description": "A responsive gallery of entity cards with status and quick actions.",
        "emptyTitle": "Nothing to show",
        "emptyBody": "Items will appear here as cards."
      },
      "groupedSummaryTable": {
        "description": "Grouped rows with aggregate columns, expandable details, and totals.",
        "emptyTitle": "No summary data",
        "emptyBody": "Grouped totals will appear here once there is data.",
        "groupLabel": "Group",
        "totalsLabel": "Total"
      },
      "schemaTree": {
        "description": "An explorer for schemas, tables, and columns with type and key badges.",
        "emptyTitle": "No schema introspected",
        "emptyBody": "Connect a database to explore its schema here.",
        "treeLabel": "Schema",
        "viewLabel": "view"
      },
      "toggleMatrix": {
        "description": "An interactive grid of boolean toggles for roles, policies, or channels.",
        "emptyTitle": "No matrix configured",
        "emptyBody": "Rows and columns will appear here once configured.",
        "matrixLabel": "Permissions matrix",
        "rowHeaderLabel": "Permission"
      },
      "sparklineTable": {
        "description": "Metric rows with a micro sparkline, the current value, and a good/bad-aware change pill.",
        "emptyTitle": "No metrics to show",
        "emptyBody": "Metrics will appear here once there is data to summarize."
      },
      "topMoversList": {
        "description": "The metrics that changed the most, with the direction judged good or bad per metric.",
        "emptyTitle": "No movers",
        "emptyBody": "Metrics that changed the most will appear here."
      },
      "rankedEntityList": {
        "description": "Top entities by a metric, each with its rank and a proportional bar.",
        "emptyTitle": "Nothing ranked yet",
        "emptyBody": "Top entities will appear here once there is data to rank."
      },
      "accordionList": {
        "description": "Expandable rows with a badge and a detail panel, single- or multi-open.",
        "emptyTitle": "Nothing to expand",
        "emptyBody": "Entries will appear here once there are any."
      },
      "comparisonMatrix": {
        "description": "A feature grid comparing plans or tiers, with one column promoted.",
        "includedLabel": "Included",
        "notIncludedLabel": "Not included",
        "promotedLabel": "Recommended"
      },
      "chipCloud": {
        "description": "Wrapped chips for discovered tables, merge variables, or suggestions.",
        "emptyTitle": "Nothing discovered yet",
        "emptyBody": "Tables and variables will appear here as chips once they are found.",
        "moreLabel": "+{n} more"
      },
      "dataGrid": {
        "selectAllLabel": "Select all rows",
        "selectRowLabel": "Select row",
        "sortByLabel": "Sort by {column}",
        "description": "The canonical CRUD grid with sortable columns, row selection, and type-aware cells.",
        "rowActionsLabel": "Row actions"
      },
      "paginationFooter": {
        "emptyLabel": "0 rows",
        "ofLabel": "of",
        "pageSizeLabel": "Rows",
        "a11y": {
          "pageSize": "Rows per page"
        },
        "prevLabel": "Previous page",
        "nextLabel": "Next page",
        "description": "A footer with the visible row range, prev/next paging, and a page-size select."
      },
      "bulkActionToolbar": {
        "selectedLabel": "selected",
        "clearLabel": "Clear selection",
        "toolbarLabel": "Bulk actions",
        "description": "A selection-aware toolbar showing the selected count and bulk actions."
      },
      "miniTable": {
        "viewAllLabel": "View all",
        "description": "A compact dashboard row list with mapped columns and a view-all link."
      },
      "revealLabel": "Reveal value",
      "hideLabel": "Hide value",
      "trueLabel": "true",
      "falseLabel": "false",
      "detailKeyValue": {
        "description": "A record's fields as label/value rows with type-aware values."
      }
    },
    "boards": {
      "kanbanBoard": {
        "description": "Fixed status columns of draggable cards; drag a card to another column to update its status.",
        "emptyTitle": "No board columns",
        "emptyBody": "Add a status field to group cards into columns."
      },
      "kanbanSwimlaneGrid": {
        "description": "A lane × column grid where dragging a card reassigns both its lane and its status.",
        "emptyTitle": "No swimlanes to show",
        "emptyBody": "Group records by a lane field and a status field to build the grid."
      },
      "addCard": "Add card",
      "grip": "Drag to move card",
      "pointsUnit": "pts",
      "laneSummary": "Σ{points} pts · {count}",
      "a11y": {
        "grabbed": "Grabbed {title}. Use the arrow keys to move, Enter to drop, Escape to cancel.",
        "over": "{title} is over {cell}.",
        "moved": "Moved {title} to {cell}.",
        "returned": "{title} returned to its original position.",
        "failed": "Could not move {title}; it was returned to its original position."
      },
      "boardCard": {
        "description": "A single board card: tag, title, progress, owner, and due date.",
        "emptyTitle": "No card",
        "emptyBody": "This card has no record bound to it yet."
      },
      "inlineComposeCard": {
        "description": "A quick-add card that inserts a new record with the column's defaults.",
        "placeholder": "Card title…",
        "addLabel": "Add",
        "cancelLabel": "Cancel",
        "openLabel": "Add card"
      }
    },
    "communication": {
      "conversationInbox": {
        "description": "A selectable list of conversations with unread counts, presence, and last-message previews.",
        "emptyTitle": "No conversations",
        "emptyBody": "Conversations will appear here as messages arrive.",
        "noMatchesTitle": "No conversations match",
        "searchLabel": "Search conversations",
        "searchPlaceholder": "Search conversations…"
      },
      "chatThread": {
        "description": "Message bubbles grouped by author and day, with attachments and a composer.",
        "emptyTitle": "No messages yet",
        "emptyBody": "Messages in this conversation will appear here.",
        "composerPlaceholder": "Write a message…",
        "sendLabel": "Send",
        "attachLabel": "Add attachment",
        "typingLabel": "typing…",
        "composerLabel": "Message",
        "transcriptLabel": "Conversation"
      },
      "aiChatPanel": {
        "description": "An assistant panel for asking questions about your schema and data.",
        "emptyTitle": "Ask about your data",
        "emptyBody": "Ask a question about your schema, tables, or metrics to get started.",
        "composerPlaceholder": "Ask a question…",
        "sendLabel": "Send",
        "pendingLabel": "Thinking…",
        "configureTitle": "No AI provider configured",
        "configureBody": "Add an Anthropic or OpenAI key — or point Adminium at your own endpoint — to ask questions about your schema.",
        "configureCtaLabel": "Configure a provider",
        "assistantLabel": "Assistant",
        "composerLabel": "Ask a question",
        "transcriptLabel": "Assistant transcript"
      },
      "typingIndicator": {
        "description": "An avatar and an italic “typing…” row, bound to a live per-conversation boolean.",
        "label": "typing…",
        "emptyTitle": "No typing activity",
        "emptyBody": "Typing state appears here once the conversation is live."
      },
      "callWidget": {
        "description": "An incoming voice or video call: the caller’s avatar, the call state, and accept or decline actions.",
        "voiceLabel": "Voice call",
        "videoLabel": "Video call",
        "ringingLabel": "Ringing…",
        "connectingLabel": "Connecting…",
        "activeLabel": "In call",
        "endedLabel": "Call ended",
        "acceptLabel": "Accept",
        "declineLabel": "Decline",
        "endLabel": "End call",
        "emptyTitle": "No active call",
        "emptyBody": "An incoming call will appear here."
      }
    },
    "geo": {
      "mapBubble": {
        "description": "A map whose circle markers are sized by the metric you choose, alongside a ranked list of the top places.",
        "emptyTitle": "No locations",
        "emptyBody": "Rows with latitude and longitude values appear here as map markers.",
        "mapUnavailableLabel": "The map could not be loaded. The ranked list below shows the same data.",
        "regionsLabel": "Top regions",
        "metricLabel": "Metric"
      },
      "mapChoroplethGrid": {
        "description": "Region tiles tinted by value — for tables that carry region codes but no coordinates.",
        "emptyTitle": "No regions",
        "emptyBody": "Rows with a region code and a numeric value appear here as tinted tiles.",
        "legendLowLabel": "Low",
        "legendHighLabel": "High",
        "chartLabel": "Regional breakdown"
      }
    },
    "domain": {
      "orgChart": {
        "description": "The reporting tree built from a people table's manager reference, with collapsible branches.",
        "emptyTitle": "No reporting structure",
        "emptyBody": "The org chart appears once people rows reference a manager.",
        "reportsLabel": "Reports · {count}",
        "a11yLabel": "Organization chart"
      },
      "ganttChart": {
        "description": "Task bars over a time axis, grouped by phase, with progress, milestones, and a today marker.",
        "emptyTitle": "Nothing scheduled",
        "emptyBody": "Tasks appear here once they have start and end dates.",
        "ungroupedLabel": "Tasks"
      },
      "documentCanvas": {
        "description": "A paper-styled document canvas — invoice, report or email — whose blocks can be selected, reordered and removed.",
        "emptyTitle": "No blocks yet",
        "emptyBody": "Add a block from the palette to build this document.",
        "addBlockLabel": "Add block",
        "removeBlockLabel": "Remove block",
        "moveUpLabel": "Move block up",
        "moveDownLabel": "Move block down",
        "blockListLabel": "Document blocks",
        "billedToLabel": "Billed to",
        "issuedLabel": "Issued",
        "dueLabel": "Due",
        "noDocumentTitle": "No document yet",
        "noDocumentBody": "Pick a starter template or add a block to begin."
      },
      "blockTotalsSummary": {
        "description": "The document totals — subtotal, discount, tax and the total due, recomputed from the line items.",
        "emptyTitle": "No totals",
        "emptyBody": "Totals appear once the document has line items.",
        "subtotalLabel": "Subtotal",
        "discountLabel": "Discount",
        "taxLabel": "Tax",
        "totalLabel": "Total due"
      },
      "blockLineItems": {
        "description": "Editable description, quantity and rate rows that feed the document totals.",
        "emptyTitle": "No line items",
        "emptyBody": "Add a line item to build this document.",
        "descHeader": "Description",
        "qtyHeader": "Qty",
        "rateHeader": "Rate",
        "amountHeader": "Amount"
      },
      "blockKpiRow": {
        "description": "A row of stat tiles with sign-aware delta coloring.",
        "emptyTitle": "No metrics",
        "emptyBody": "Report metrics will appear here once the document is bound."
      },
      "blockBarChart": {
        "description": "A mini bar chart in the document accent, sized for a document block.",
        "emptyTitle": "No chart data",
        "emptyBody": "A mini bar chart appears once this block is bound to a series.",
        "a11yLabel": "Bar chart"
      },
      "blockLineChart": {
        "description": "A mini line chart with an optional filled area, sized for a document block.",
        "emptyTitle": "No chart data",
        "emptyBody": "A mini line chart appears once this block is bound to a series.",
        "a11yLabel": "Line chart"
      },
      "blockTwoColTable": {
        "description": "A two-column table with a styled header row and a mono value column.",
        "emptyTitle": "No rows",
        "emptyBody": "Two-column rows will appear here."
      },
      "blockTaxBreakdown": {
        "description": "Tax lines with label, rate and amount, applied to the document subtotal.",
        "emptyTitle": "No tax lines",
        "emptyBody": "Tax lines appear once a rate applies to this document."
      },
      "blockMultiCurrency": {
        "description": "The document total converted per currency at the given rates.",
        "emptyTitle": "No conversions",
        "emptyBody": "Currency conversions appear once exchange rates are available.",
        "footnote": "Rates are indicative and may differ at settlement."
      },
      "blockPaymentHistory": {
        "description": "Past payments with date, masked method, amount and a status pill.",
        "emptyTitle": "No payments yet",
        "emptyBody": "Payments against this document will appear here."
      },
      "blockDiscountCodes": {
        "description": "Applied discount codes with their label and credited amount.",
        "emptyTitle": "No discount codes",
        "emptyBody": "Applied discount codes will appear here."
      },
      "blockLoyaltyBanner": {
        "description": "A loyalty banner with the points balance, tier and points earned on this order.",
        "emptyTitle": "No loyalty balance",
        "emptyBody": "Loyalty points appear once this customer is enrolled.",
        "balanceLabel": "{balance} pts · {tier}",
        "earnedLabel": "+{earned} earned"
      },
      "blockRecurringBanner": {
        "description": "A banner announcing the billing frequency, the next charge date and the cycles remaining.",
        "emptyTitle": "Not recurring",
        "emptyBody": "Recurrence details appear once a schedule is set.",
        "template": "Recurring — {freq} · Next on {next} · {count} cycles"
      },
      "blockQrPay": {
        "description": "A scan-to-pay tile with a caption and the amount due.",
        "emptyTitle": "No payment link",
        "emptyBody": "A scannable payment code appears once an amount is due.",
        "amountLabel": "Amount due"
      },
      "blockDeliveryStepper": {
        "description": "Horizontal delivery steps marked done, current or upcoming.",
        "emptyTitle": "No delivery steps",
        "emptyBody": "Fulfilment progress will appear here."
      },
      "blockSignature": {
        "description": "Signature lines for a name and title, with the date signed.",
        "emptyTitle": "No signature",
        "emptyBody": "A signature line appears once this document requires one.",
        "namePlaceholder": "Name",
        "titlePlaceholder": "Title",
        "dateLabel": "Date",
        "nameInputLabel": "Signature name"
      },
      "blockTermsCheckbox": {
        "description": "A terms toggle with an editable label.",
        "defaultLabel": "I accept the terms"
      },
      "blockApproval": {
        "description": "An approver card with a status-tinted pill and optional approve or reject actions.",
        "emptyTitle": "No approver",
        "emptyBody": "The approval chain appears once a reviewer is assigned.",
        "approveLabel": "Approve",
        "rejectLabel": "Reject",
        "pendingLabel": "Pending",
        "approvedLabel": "Approved",
        "rejectedLabel": "Rejected"
      },
      "blockAttachments": {
        "description": "Attached files with their names and sizes.",
        "emptyTitle": "No attachments",
        "emptyBody": "Files attached to this document will appear here."
      },
      "blockLateFees": {
        "description": "A warning callout stating the late fee and the grace period.",
        "emptyTitle": "No late fee",
        "emptyBody": "Late-fee terms appear once they are set on this document.",
        "template": "A {rate} late fee applies after {days} days."
      },
      "blockImagePlaceholder": {
        "description": "A dashed placeholder box standing in for an image, with a caption.",
        "emptyTitle": "No image slot",
        "emptyBody": "An image placeholder appears once this block is bound."
      },
      "blockContact": {
        "description": "Contact rows for a name, email address and phone number.",
        "emptyTitle": "No contact",
        "emptyBody": "Contact details appear once this document names a recipient."
      },
      "blockHighlightBox": {
        "description": "A callout box pairing a label with a large mono value.",
        "emptyTitle": "Nothing highlighted",
        "emptyBody": "A highlighted figure appears once this block is bound."
      },
      "starterTemplatePicker": {
        "description": "A grid of predefined starters with generated thumbnails; picking one seeds a full document.",
        "emptyTitle": "No starters",
        "emptyBody": "Add starter definitions in config or bind a starters table.",
        "blankLabel": "Blank",
        "kicker": {
          "invoice": "Invoice",
          "report": "Report",
          "email": "Email"
        }
      },
      "sloMonitorCard": {
        "description": "Per-service SLA card with status, availability against target, a daily uptime strip, error budget, and p95 latency.",
        "emptyTitle": "No monitor",
        "emptyBody": "Bind a monitors table with a status and an availability column.",
        "targetLabel": "Target",
        "budgetLabel": "Error budget",
        "latencyLabel": "p95 latency",
        "status": {
          "operational": "Operational",
          "degraded": "Degraded",
          "down": "Down",
          "unknown": "Unknown"
        }
      },
      "uptimeSegmentBar": {
        "description": "Statuspage-style day strips coloured by daily status, with a 30/90-day toggle.",
        "emptyTitle": "No uptime history",
        "emptyBody": "Daily status rows appear here as an uptime strip.",
        "daysAgoLabel": "{days} days ago",
        "todayLabel": "Today",
        "uptimeLabel": "uptime",
        "period30Label": "30d",
        "period90Label": "90d",
        "status": {
          "operational": "Operational",
          "degraded": "Degraded",
          "down": "Down",
          "unknown": "No data"
        }
      },
      "experimentVariantCompare": {
        "description": "Per-variant conversion bars with lift against the control and a significance meter.",
        "emptyTitle": "No variants",
        "emptyBody": "Bind an experiment variants table with conversion numbers.",
        "controlLabel": "CONTROL",
        "winnerLabel": "WINNER",
        "significanceLabel": "Confidence",
        "verdictSignificantLabel": "Statistically significant — safe to call.",
        "verdictInconclusiveLabel": "Not yet significant — keep the test running.",
        "countsLabel": "{users} participants · {conversions} conversions"
      },
      "creditCardTile": {
        "description": "A stored payment method as a branded card with a masked number, holder, and expiry.",
        "emptyTitle": "No payment method",
        "emptyBody": "Add a card to see it here.",
        "defaultLabel": "Default",
        "setDefaultLabel": "Set default",
        "manageLabel": "Manage",
        "addLabel": "Add payment method",
        "expiresLabel": "Expires"
      },
      "planPricingCards": {
        "description": "Pricing tiers with a monthly/annual switch, feature lists, and a promoted plan.",
        "emptyTitle": "No plans",
        "emptyBody": "Bind a plans table with a name and a monthly price.",
        "monthlyLabel": "Monthly",
        "annualLabel": "Annual",
        "popularLabel": "POPULAR",
        "perMonthLabel": "/ month",
        "billedAnnuallyLabel": "Billed {total} yearly",
        "currentLabel": "Current plan",
        "ctaLabel": "Choose plan"
      },
      "apiKeysPanel": {
        "description": "API keys with environment badges, masked values, scopes, last use, and copy, roll, and revoke actions.",
        "emptyTitle": "No API keys",
        "emptyBody": "Create a key to start calling the API.",
        "revealedTitle": "Key created",
        "revealedBody": "Copy it now — it is never shown again.",
        "copyLabel": "Copy",
        "copiedLabel": "Copied",
        "revealLabel": "Reveal key",
        "hideLabel": "Hide key",
        "rollLabel": "Roll key",
        "revokeLabel": "Revoke key",
        "neverUsedLabel": "Never used",
        "lastUsedLabel": "Last used {since}"
      },
      "apiPlayground": {
        "description": "A request composer with parameters and a response pane. It composes only and never sends a real request.",
        "emptyTitle": "No endpoint selected",
        "emptyBody": "Pick an endpoint to compose a request against it.",
        "sendLabel": "Send",
        "requestLabel": "Request",
        "responseLabel": "Response",
        "paramsLabel": "Parameters",
        "responsePlaceholder": "Send the request to see the response."
      },
      "codeSnippetBlock": {
        "description": "A copyable code snippet with a language chip and optional per-language tabs.",
        "emptyTitle": "No snippet",
        "emptyBody": "Bind a code column or set a static snippet in config.",
        "copyLabel": "Copy",
        "copiedLabel": "Copied"
      },
      "webhookEndpointsList": {
        "description": "Webhook endpoints with their event, target URL, last fired time, and an enable toggle.",
        "emptyTitle": "No endpoints",
        "emptyBody": "Add a webhook endpoint to receive table events.",
        "neverFiredLabel": "Never fired",
        "lastFiredLabel": "Last fired {since}"
      },
      "resourceApiCard": {
        "description": "A table's generated API surface: row count, security badge, method chips, and request volume.",
        "emptyTitle": "No resource",
        "emptyBody": "Bind a table to show its generated API surface.",
        "rlsLabel": "RLS",
        "publicLabel": "Public",
        "rowsLabel": "rows",
        "perDayLabel": "{count}/day"
      },
      "liveTimer": {
        "description": "A start/stop stopwatch for a task; stopping it records a time entry.",
        "emptyTitle": "No timer",
        "emptyBody": "Bind a time-entry row with a task and a duration column.",
        "startLabel": "Start",
        "stopLabel": "Stop",
        "taskPlaceholder": "Untitled task"
      },
      "syncStatusCard": {
        "description": "Connection identity, latency, rows synced, and the sync schedule, with a sync-now action.",
        "emptyTitle": "No connection",
        "emptyBody": "Bind a connection row to show its sync status.",
        "connectedLabel": "Connected",
        "disconnectedLabel": "Disconnected",
        "rowsSyncedLabel": "Rows synced",
        "tablesLabel": "Tables",
        "lastSyncLabel": "Last sync",
        "nextSyncLabel": "Next sync",
        "syncingLabel": "Syncing…",
        "syncActionLabel": "Sync now"
      },
      "ipAllowlistCard": {
        "description": "Static egress IP addresses to allow through a firewall, each with a copy button.",
        "emptyTitle": "No egress IPs",
        "emptyBody": "Egress addresses appear here once the connection is provisioned.",
        "copyLabel": "Copy",
        "copiedLabel": "Copied"
      },
      "onboardingChecklist": {
        "description": "Setup steps with time estimates and actions, over a live progress ring and bar.",
        "emptyTitle": "Nothing to set up",
        "emptyBody": "Add onboarding steps in config or bind a steps table.",
        "progressLabel": "{done} of {total} done",
        "celebrateTitle": "All done"
      },
      "testimonialCard": {
        "description": "A customer quote with an avatar and attribution.",
        "emptyTitle": "No testimonial",
        "emptyBody": "Bind a quote row to show a customer testimonial."
      },
      "trustBadges": {
        "description": "A dot-separated row of compliance and trust claims.",
        "emptyTitle": "No badges",
        "emptyBody": "Add compliance claims in config or bind a badges table."
      },
      "policyList": {
        "description": "Row-level security policies per table with their command, role, and an enable toggle.",
        "emptyTitle": "No policies",
        "emptyBody": "This table has no row-level security policies yet."
      },
      "blockEmailHeading": {
        "emptyTitle": "No heading",
        "emptyBody": "Add heading text for this email."
      },
      "blockEmailText": {
        "emptyTitle": "No text",
        "emptyBody": "Add a paragraph for this email."
      },
      "blockEmailButton": {
        "emptyTitle": "Incomplete button",
        "emptyBody": "A button needs both text and a link to be sent."
      },
      "blockEmailSpacer": {
        "label": "{size}px space"
      },
      "blockEmailFooter": {
        "emptyTitle": "No footer",
        "emptyBody": "Legal text, address and unsubscribe copy go here."
      }
    },
    "media": {
      "fileBrowser": {
        "description": "Browse files and folders as a tile grid or a list, with a breadcrumb trail, type icons, and starring.",
        "emptyTitle": "This folder is empty",
        "emptyBody": "Upload files or create a folder to get started."
      },
      "uploadDropzone": {
        "description": "A drag-and-drop target for uploading files, with format and size constraints.",
        "dropTitle": "Drop files to upload",
        "browsePrefix": "or",
        "browseLabel": "browse"
      },
      "uploadProgressList": {
        "description": "Per-file upload rows with a progress bar and status; also drives export-queue jobs.",
        "emptyTitle": "No uploads in progress",
        "emptyBody": "Files you upload will show their progress here."
      },
      "attachmentList": {
        "description": "Files attached to a record, with type icons, sizes, and download or delete actions.",
        "emptyTitle": "No attachments",
        "emptyBody": "Files attached to this record will appear here."
      },
      "imageBoard": {
        "description": "A moodboard grid of image slots with captions, for tables with image URLs.",
        "emptyTitle": "No images yet",
        "emptyBody": "Reference images will appear on this board.",
        "placeholder": "Drop reference"
      },
      "linkList": {
        "description": "Reference links with titles and URLs, opening in a new tab.",
        "emptyTitle": "No links yet",
        "emptyBody": "Reference links will appear here."
      },
      "root": "Files",
      "breadcrumb": "Breadcrumb",
      "gridView": "Grid view",
      "listView": "List view",
      "nameHeader": "Name",
      "sizeHeader": "Size",
      "modifiedHeader": "Modified",
      "star": "Star",
      "items": "items",
      "done": "Done",
      "failed": "Failed",
      "queued": "Queued",
      "retry": "Retry",
      "download": "Download",
      "cancel": "Cancel",
      "delete": "Delete",
      "remove": "Remove",
      "addImage": "Add image",
      "caption": "Caption",
      "addLink": "Add link",
      "linkTitlePlaceholder": "Title",
      "linkUrlPlaceholder": "https://…",
      "add": "Add"
    },
    "forms": {
      "modalWizard": {
        "description": "A modal create form with a success confirmation — the standard “new record” flow.",
        "trigger": "Create",
        "submit": "Create",
        "cancel": "Cancel",
        "done": "Done",
        "successTitle": "Created",
        "successBody": "The record was saved.",
        "required": "This field is required.",
        "titleLabel": "Create record",
        "closeLabel": "Close"
      },
      "drawerForm": {
        "description": "A side-drawer create or edit form for records with more fields than a modal fits.",
        "trigger": "New",
        "submit": "Save",
        "cancel": "Cancel",
        "titleLabel": "New record",
        "closeLabel": "Close"
      },
      "stepper": {
        "description": "A progress stepper showing where a multi-step flow has got to.",
        "a11yLabel": "Progress"
      },
      "progressBar": {
        "description": "A determinate progress track with a percent caption.",
        "label": "Progress"
      },
      "otpInput": {
        "description": "A one-time-code entry field.",
        "label": "One-time code"
      },
      "chipInput": {
        "description": "A tag input: removable chips plus free text that commits on Enter.",
        "remove": "Remove",
        "placeholder": "Type and press Enter…"
      },
      "segmentedControl": {
        "description": "A single-select pill control for periods, environments and filters.",
        "a11yLabel": "Select an option"
      },
      "filterChipBar": {
        "description": "Filter chips with live counts computed from the list they filter.",
        "all": "All",
        "a11yLabel": "Filter",
        "meta": "{shown} of {total}"
      },
      "toggleSwitchList": {
        "description": "A list of settings rows, each with a switch.",
        "save": "Save",
        "dirty": "You have unsaved changes",
        "emptyTitle": "No settings",
        "emptyBody": "Settings appear here once they are configured."
      },
      "optionCards": {
        "description": "A single-select card grid for sources, templates and plans.",
        "a11yLabel": "Choose an option"
      },
      "ruleBuilder": {
        "description": "A condition builder whose rules compile to a filter — the segment/audience editor.",
        "add": "Add condition",
        "remove": "Remove condition",
        "all": "ALL",
        "any": "ANY",
        "field": "Field",
        "operator": "Operator",
        "value": "Value",
        "valuePlaceholder": "Value…",
        "emptyBody": "No conditions yet — add one to define this segment.",
        "op": {
          "eq": "is",
          "neq": "is not",
          "gt": "is greater than",
          "gte": "is at least",
          "lt": "is less than",
          "lte": "is at most",
          "contains": "contains",
          "not-contains": "does not contain",
          "starts-with": "starts with",
          "in": "is one of",
          "before": "is before",
          "after": "is after",
          "is-null": "is empty",
          "is-not-null": "is not empty"
        }
      },
      "flowBuilder": {
        "description": "A vertical workflow canvas of trigger, condition and action steps.",
        "add": "Add step",
        "remove": "Remove step",
        "paletteTitle": "Add a step",
        "stats": "{runs} runs · {rate}% success",
        "emptyBody": "No steps yet — add a trigger to start this workflow."
      },
      "connectionStringField": {
        "description": "A connection-string field that detects the database engine as you type.",
        "label": "Connection string",
        "helper": "postgres://user:password@host:5432/database — mysql:// and sqlite: work too.",
        "quickFill": "Quick fill:",
        "host": "Host: {host}",
        "invalidScheme": "Unrecognized connection-string scheme.",
        "incomplete": "Add a host and database to the connection string."
      },
      "tableInclusionChecklist": {
        "description": "The tables to include, with row counts and PII warnings.",
        "pii": "PII",
        "highVolume": "high volume",
        "a11yLabel": "Tables to include",
        "emptyTitle": "No tables found",
        "emptyBody": "Connect a database and its tables will appear here."
      },
      "columnMappingTable": {
        "description": "Maps the columns of an uploaded file onto the fields of a table.",
        "skip": "Don't import",
        "sourceHeader": "Source column",
        "sampleHeader": "Sample",
        "targetHeader": "Target field",
        "emptyTitle": "No columns to map",
        "emptyBody": "Upload a file and its columns will appear here."
      },
      "validationIssuesList": {
        "description": "Import and validation issues, most severe first, with affected row counts.",
        "emptyTitle": "No issues found",
        "emptyBody": "Everything checks out — you are good to import."
      },
      "exportBuilder": {
        "description": "Builds a data export: format, date range and what to include.",
        "format": "Format",
        "from": "From",
        "to": "To",
        "groupBy": "Group by",
        "includeCharts": "Include charts",
        "email": "Email me the export",
        "submit": "Export",
        "running": "Preparing your export…",
        "done": "Export ready",
        "failed": "The export failed. Try again.",
        "download": "Download"
      },
      "questionBuilder": {
        "description": "A survey editor: add question types and reorder the questions.",
        "paletteTitle": "Add a question",
        "add": "Add question",
        "remove": "Remove question",
        "moveUp": "Move up",
        "moveDown": "Move down",
        "required": "Required",
        "questionPlaceholder": "Ask a question…",
        "emptyTitle": "No questions yet",
        "emptyBody": "Pick a question type to start building your survey.",
        "questionLabel": "Question",
        "dropdownPlaceholder": "Choose…",
        "kind": {
          "single-choice": "Single choice",
          "multi-choice": "Multiple choice",
          "dropdown": "Dropdown",
          "short-text": "Short text",
          "long-text": "Long text",
          "rating": "Star rating",
          "nps": "NPS 0–10",
          "date": "Date"
        }
      },
      "inlineEditableField": {
        "description": "A click-to-edit value inside a document or canvas.",
        "edit": "Edit",
        "save": "Save",
        "cancel": "Cancel",
        "empty": "Empty",
        "valueLabel": "Value"
      },
      "passwordStrengthMeter": {
        "description": "A four-segment meter showing how strong a password is.",
        "label": "Password strength",
        "weak": "Weak",
        "fair": "Fair",
        "good": "Good",
        "strong": "Strong"
      }
    },
    "chrome": {
      "sidebarNav": {
        "description": "The grouped app navigation rail, with live count badges.",
        "a11yLabel": "Main",
        "emptyTitle": "No navigation yet",
        "emptyBody": "Included tables appear here once a connection is generated."
      },
      "commandPalette": {
        "description": "The ⌘K palette: search actions, pages and records from anywhere.",
        "title": "Command palette",
        "placeholder": "Search actions, pages and records…",
        "navigate": "Navigate",
        "select": "Open",
        "close": "Close",
        "emptyTitle": "No results for \"{query}\"",
        "emptyBody": "Start typing to search.",
        "groupActions": "Actions",
        "groupNavigate": "Navigate",
        "groupRecent": "Recent",
        "groupPages": "Pages",
        "groupMetrics": "Metrics",
        "groupPeople": "People",
        "groupRecords": "Records"
      },
      "globalSearch": {
        "description": "Search across every entity, with type facets and result snippets.",
        "placeholder": "Search everything…",
        "all": "All",
        "summary": "{count} results for \"{query}\"",
        "emptyTitle": "No results",
        "emptyBody": "Try a different search term.",
        "searchLabel": "Search",
        "facetRailLabel": "Filter by type"
      },
      "breadcrumb": {
        "description": "The ancestor trail of the current record or folder.",
        "a11yLabel": "Breadcrumb"
      },
      "tabBar": {
        "description": "Tabs that switch panels or navigate, with optional counts.",
        "a11yLabel": "Tabs"
      },
      "navCard": {
        "description": "A grid of link cards for hub and landing pages.",
        "emptyTitle": "Nothing to show",
        "emptyBody": "Hub links appear here once pages are generated."
      },
      "shortcutsPanel": {
        "description": "The keyboard shortcuts cheat sheet.",
        "footerHint": "Press ? anytime",
        "then": "then",
        "emptyTitle": "No shortcuts registered.",
        "generalGroupLabel": "General",
        "navigationGroupLabel": "Navigation",
        "recordsGroupLabel": "Records",
        "openCommandPaletteLabel": "Open command palette",
        "searchLabel": "Search",
        "showShortcutsLabel": "Show shortcuts",
        "goToDashboardLabel": "Go to dashboard",
        "goToOrdersLabel": "Go to orders",
        "newRecordLabel": "New record",
        "saveLabel": "Save",
        "undoLabel": "Undo"
      },
      "avatarStack": {
        "description": "Overlapping avatars with a “+N” overflow and optional presence.",
        "online": "{count} online",
        "a11yLabel": "People"
      }
    },
    "system": {
      "stateHero": {
        "description": "A full-page status screen for 404, 500, offline, forbidden and maintenance states.",
        "notFoundTitle": "This page took a wrong turn",
        "notFoundBody": "The page you are looking for was moved, renamed, or never existed.",
        "serverErrorTitle": "Something broke on our side",
        "serverErrorBody": "The error was logged and the team notified. Trying again often works.",
        "offlineTitle": "You are offline",
        "offlineBody": "Check your connection — the dashboard reconnects automatically.",
        "forbiddenTitle": "You do not have access",
        "forbiddenBody": "Ask a workspace admin to grant you permission for this page.",
        "maintenanceTitle": "Down for maintenance",
        "maintenanceBody": "We are making things better. This usually takes a few minutes.",
        "connErrorTitle": "Cannot reach the database",
        "connErrorBody": "The connection was refused or timed out. Check the connection settings.",
        "backToDashboard": "Back to dashboard",
        "tryAgain": "Try again",
        "retry": "Retry",
        "testConnection": "Test connection"
      },
      "emptyState": {
        "description": "A centred “nothing here yet” panel with optional actions."
      },
      "statusPill": {
        "description": "A tone-coded badge for an enum column — the universal status renderer."
      },
      "alertBanner": {
        "description": "An inline callout for quota, freeze and schedule notices.",
        "dismiss": "Dismiss"
      },
      "statusBannerHero": {
        "description": "A service-health hero whose state derives from the worst service in the list.",
        "upTitle": "All systems operational",
        "upBody": "Every monitored service is responding normally.",
        "degradedTitle": "Degraded performance",
        "degradedBody": "Some services are slower than usual. We are investigating.",
        "downTitle": "Major outage",
        "downBody": "One or more services are unavailable. We are on it."
      },
      "connectionStatus": {
        "description": "The connect/test result for a database connection.",
        "idle": "Not connected",
        "connecting": "Connecting…",
        "connected": "Connected",
        "failed": "Couldn't connect",
        "test": "Test"
      },
      "autosaveIndicator": {
        "description": "The unsaved → saving → saved pill for autosaving documents.",
        "dirty": "Unsaved changes",
        "saving": "Saving…",
        "saved": "All changes saved",
        "error": "Couldn't save"
      },
      "progressLogConsole": {
        "description": "A streaming log console with a progress bar, for long-running tasks.",
        "a11yLabel": "Progress log",
        "progressLabel": "Progress",
        "emptyTitle": "Nothing to report yet",
        "emptyBody": "Log lines appear here once the task starts."
      },
      "diagnosticsReadout": {
        "description": "Connection-check results as toned key/value rows with a freshness stamp.",
        "checkedAt": "Last checked",
        "host": "Host",
        "dns": "DNS",
        "tcp": "TCP",
        "tls": "TLS",
        "auth": "Auth",
        "latency": "Latency"
      },
      "widgetMissing": {
        "description": "The fallback card shown when a stored page references a widget that is not installed.",
        "title": "Widget unavailable",
        "bodyLead": "No widget is registered as",
        "bodyTail": "It may belong to a newer version or an uninstalled extension."
      }
    }
  },
  "grid": {
    "dragHandle": "Drag to move {title}",
    "resizeHandle": "Resize {title}",
    "a11y": {
      "grabbed": "Grabbed {title}. Use the arrow keys to move, hold Shift to resize, Enter to save, Escape to cancel.",
      "moved": "{title} moved to column {col}, row {row}.",
      "resized": "{title} resized to {w} columns by {h} rows.",
      "committed": "{title} placed at column {col}, row {row}.",
      "reverted": "{title} returned to its original position."
    },
    "draggableRole": "draggable widget"
  },
  "templates": {
    "crud": {
      "newRow": "New row",
      "exportAction": "Export",
      "searchPlaceholder": "Search {table}…",
      "removeFilter": "Remove {column} filter",
      "queryFailed": "Query failed",
      "loadingRows": "Loading rows",
      "noMatchesTitle": "No matching rows",
      "emptyTitle": "{count, plural, one {No {entity} yet} other {No {entity}s yet}}",
      "createTitle": "Add {entity}",
      "createSubtitle": "Creates one row in {table}.",
      "createSubmit": "Add {entity}",
      "createSuccessTitle": "{name} added",
      "createSuccessBody": "You can undo this from the toast.",
      "editTitle": "Edit {entity}",
      "saveSubmit": "Save changes",
      "deleteTitle": "Delete {entity}",
      "deletePreflight": "Checking references…",
      "deleteNoReferences": "This row has no inbound references.",
      "deleteConsequencesIntro": "Deleting this row also affects:",
      "referenceRows": "{count, plural, one {{n} row} other {{n} rows}}",
      "confirmPrompt": "Type {value} to confirm",
      "bulkDeleteTitle": "{count, plural, one {Delete {n} row} other {Delete {n} rows}}",
      "bulkDeleteBody": "Referential consequences apply to every selected row.",
      "bulkDeleteConfirm": "Delete rows",
      "uniqueHelper": "Must be unique in {table}.",
      "uniqueHelperCounted": "{count, plural, one {Checked against {n} row.} other {Checked against {n} rows.}}",
      "toast": {
        "created": "{entity} created.",
        "createFailed": "Create failed.",
        "saved": "Changes saved.",
        "updateFailed": "Update failed.",
        "deleted": "{name} deleted.",
        "deleteFailed": "Delete failed.",
        "bulkDeleted": "{count, plural, one {{n} row deleted.} other {{n} rows deleted.}}",
        "bulkDeleteFailed": "Bulk delete failed.",
        "exportIncomplete": "Exported {written, number} of {selected, number} selected rows — reload and try again.",
        "undone": "Change undone.",
        "undoFailed": "Undo failed."
      },
      "detail": {
        "fields": "Fields",
        "inboundReferences": "inbound references",
        "relatedCount": "{count, plural, one {{n} related record in {table}} other {{n} related records in {table}}}",
        "loadError": "Failed to load the record."
      },
      "peekAction": "Peek",
      "openPage": "Open page"
    },
    "queue": {
      "allSegment": "All",
      "daysUnit": "{count, plural, one {{count} day} other {{count} days}}",
      "approvedToast": "{count} approved.",
      "rejectedToast": "{count} rejected.",
      "undoneToast": "Decision undone.",
      "undoFailedToast": "Could not undo this decision.",
      "failedToast": "Decision failed.",
      "invalidConfig": "This queue’s stored configuration is invalid. Regenerate the page to restore it.",
      "queueLabel": "Queue",
      "statusFilterLabel": "Status filter",
      "errorTitle": "This queue failed to load",
      "loading": "Loading queue",
      "emptyTitle": "Nothing in the queue",
      "emptyBody": "New requests appear here as they arrive.",
      "caughtUpTitle": "You're all caught up",
      "caughtUpBody": "No requests in this tab right now.",
      "selectItem": "Select {title}",
      "selectPrompt": "Select a request",
      "selectBody": "Choose an item to review its details.",
      "rejectTitle": "Reject requests",
      "rejectCount": "Selected · {count}",
      "rejectPlaceholder": "Add a note for the requester…",
      "rejectReasonLabel": "Rejection reason",
      "rejectNote": "The requester will be notified with your note."
    },
    "dashboard": {
      "invalidLayout": "This dashboard’s stored layout is invalid. Regenerate the page or reset its layout."
    },
    "builder": {
      "publish": "Publish",
      "paletteTitle": "Blocks",
      "inspectorTitle": "Inspector",
      "startFromTemplate": "Start from a template",
      "untitledDoc": "Untitled document",
      "invalidConfig": "This builder page’s stored config is invalid. Regenerate the page or reset it.",
      "starterPicker": {
        "subtitle": "Selection replaces the current draft."
      },
      "inspector": {
        "titleLabel": "Title",
        "numberLabel": "Number",
        "currencyLabel": "Currency",
        "taxRateLabel": "Tax rate %",
        "modulesLabel": "Modules"
      },
      "summary": {
        "questions": "Questions",
        "estLength": "Est. length",
        "estMinutes": "~{minutes} min",
        "steps": "Steps",
        "triggers": "Triggers",
        "conditions": "Conditions",
        "actions": "Actions",
        "triggerLocked": "The trigger step can’t be removed."
      },
      "publishModal": {
        "confirmTitle": "Publish survey?",
        "confirmSubtitle": "Review before it goes live.",
        "confirmCta": "Publish survey",
        "publishedTitle": "Survey published",
        "publishedSubtitle": "Your survey is live and collecting responses right now."
      },
      "blocks": {
        "block-totals-summary": "Totals summary",
        "block-line-items": "Line items",
        "block-kpi-row": "KPI row",
        "block-bar-chart": "Bar chart",
        "block-line-chart": "Line chart",
        "block-two-col-table": "Two-column table",
        "block-tax-breakdown": "Tax breakdown",
        "block-multi-currency": "Multi-currency",
        "block-payment-history": "Payment history",
        "block-discount-codes": "Discount codes",
        "block-loyalty-banner": "Loyalty points",
        "block-recurring-banner": "Recurring",
        "block-qr-pay": "Payment QR",
        "block-delivery-stepper": "Delivery timeline",
        "block-signature": "Signature",
        "block-terms-checkbox": "Terms",
        "block-approval": "Approval",
        "block-attachments": "Attachments",
        "block-late-fees": "Late fees",
        "block-image-placeholder": "Image",
        "block-contact": "Contact",
        "block-highlight-box": "Highlight box",
        "email-heading": "Heading",
        "email-text": "Paragraph",
        "email-button": "Call-to-action",
        "email-divider": "Divider",
        "email-spacer": "Spacer",
        "email-footer": "Footer"
      },
      "starters": {
        "titles": {
          "st-standard": "Standard invoice",
          "st-recurring": "Recurring subscription",
          "st-deposit": "Deposit request",
          "st-credit-note": "Credit note",
          "st-late-reminder": "Late-payment reminder",
          "st-quote": "Quote / estimate",
          "st-proforma": "Pro forma",
          "st-receipt": "Payment receipt",
          "st-retainer": "Retainer",
          "st-usage": "Usage-based invoice",
          "st-milestone": "Project milestone",
          "st-donation": "Donation receipt (Tax ID)",
          "st-monthly": "Monthly summary",
          "st-quarterly": "Quarterly review",
          "st-usage-report": "Usage breakdown",
          "st-exec": "Executive one-pager",
          "st-welcome": "Welcome email",
          "st-receipt-email": "Invoice receipt",
          "st-digest": "Weekly digest",
          "st-dunning": "Payment reminder"
        },
        "categories": {
          "billing": "Billing",
          "sales": "Sales",
          "nonProfit": "Non-profit",
          "reports": "Reports",
          "lifecycle": "Lifecycle",
          "transactional": "Transactional",
          "marketing": "Marketing"
        }
      }
    },
    "common": {
      "clearFilters": "Clear filters",
      "noMatchesBody": "Try a different search or remove a filter.",
      "detailLabel": "Detail",
      "loadingRecord": "Loading record",
      "connectionPaused": "This connection is paused"
    },
    "directory": {
      "invalidConfig": "This directory’s stored configuration is invalid. Regenerate the page to restore it.",
      "searchPlaceholder": "Search people…",
      "memberCount": "{count, plural, one {{n} person} other {{n} people}}",
      "errorTitle": "This directory failed to load",
      "loading": "Loading people",
      "emptyTitle": "No people yet",
      "emptyBody": "People appear here as rows land in the table.",
      "noMatchesTitle": "No matching people",
      "detailTitle": "Person"
    },
    "masterDetail": {
      "invalidConfig": "This page’s stored configuration is invalid. Regenerate the page to restore it.",
      "railTitle": "Records",
      "errorTitle": "This list failed to load",
      "loading": "Loading records",
      "emptyBody": "Records appear here as rows land in the table.",
      "noMatchesTitle": "No matching records",
      "noMatchesBody": "Try removing a filter.",
      "selectPrompt": "Select a record",
      "selectBody": "Choose an item from the list to see its details."
    },
    "chat": {
      "invalidLayout": "This chat page’s stored layout is invalid. Regenerate the page or reset its layout.",
      "noInboxTitle": "No inbox on this page",
      "noInboxBody": "Regenerate the page.",
      "conversationsFailed": "The conversation query failed",
      "messagesFailed": "The messages query failed",
      "loadingConversations": "Loading conversations",
      "loadingMessages": "Loading messages",
      "selectTitle": "Select a conversation",
      "selectBody": "Pick a conversation from the inbox to read its messages."
    },
    "files": {
      "allFiles": "All files",
      "recent": "Recent",
      "starred": "Starred",
      "invalidLayout": "This files page’s stored layout is invalid. Regenerate the page or reset its layout.",
      "missingSlotTitle": "No file browser on this page",
      "missingSlotBody": "The stored layout has no browser slot. Regenerate the page.",
      "loadFailed": "The file query failed",
      "loading": "Loading files",
      "uploadsUnavailable": "Uploads are not available on this page yet.",
      "previewTitle": "File",
      "kindLabel": "Kind",
      "linkLabel": "Link"
    },
    "logViewer": {
      "invalidLayout": "This log page’s stored layout is invalid. Regenerate the page or reset its layout.",
      "levelFilterLabel": "Log level filter",
      "timeFilterLabel": "Time window filter",
      "window": {
        "1h": "1h",
        "24h": "24h",
        "7d": "7d"
      },
      "heldCount": "+{count}",
      "missingSlotTitle": "No log widget on this page",
      "missingSlotBody": "The stored layout has no log slot. Regenerate the page.",
      "loadFailed": "The log query failed",
      "loading": "Loading log entries",
      "traceTitle": "Trace",
      "latestTitle": "Latest activity",
      "backToLatest": "Back to latest",
      "eventFallback": "Event"
    },
    "calendar": {
      "eventCount": "{count, plural, one {{n} event} other {{n} events}}",
      "composePlaceholder": "Event title…",
      "addEvent": "Add event",
      "dateRange": "Date range",
      "agendaTitle": "Agenda",
      "categoriesTitle": "Categories",
      "upcomingTitle": "Upcoming",
      "invalidLayout": "This calendar’s stored layout is invalid. Regenerate the page or reset its layout."
    },
    "scheduler": {
      "previousWeek": "Previous week",
      "nextWeek": "Next week",
      "week": "Week",
      "month": "Month",
      "invalidLayout": "This schedule’s stored layout is invalid. Regenerate the page or reset its layout.",
      "shiftCount": "{count, plural, one {{n} shift} other {{n} shifts}}",
      "addShift": "Add shift"
    },
    "settings": {
      "title": "Notification settings",
      "subtitle": "Choose what you're notified about and how",
      "matrixLabel": "Notify me about",
      "rowHeader": "Event",
      "saved": "Saved",
      "unavailableTag": "Not available yet",
      "loading": "Loading preferences",
      "errorTitle": "These settings failed to load",
      "emptyTitle": "Nothing to configure yet",
      "emptyBody": "Notification events appear here as producers ship."
    },
    "pageCrud": {
      "description": "The canonical table page: searchable data grid, create/edit forms, safe deletes with reference checks, and undoable changes."
    },
    "pageDashboard": {
      "description": "A widget dashboard over your data: KPI cards, charts, and lists on an editable grid."
    },
    "pageBoard": {
      "description": "A kanban board grouped by a status field — drag cards between columns to update records."
    },
    "pageCalendar": {
      "description": "A month calendar with agenda, category filters, and quick event capture from a date field."
    },
    "pageScheduler": {
      "description": "A week-by-resource shift matrix with capacity tracking and coverage totals."
    },
    "pageDirectory": {
      "description": "A people directory with search, group filters, and a profile drawer."
    },
    "pageMasterDetail": {
      "description": "A list-beside-detail layout: pick a record on the left, work with it on the right."
    },
    "pageQueueInbox": {
      "description": "A review queue with approve/reject decisions, bulk actions, and undo."
    },
    "pageLogViewer": {
      "description": "A live-tailing log table with level and time filters and a trace side panel."
    },
    "pageFiles": {
      "description": "A file browser with smart folders, uploads, and a preview drawer."
    },
    "pageChat": {
      "description": "A conversation inbox beside a message thread, bound to your messages tables."
    },
    "pageBuilder": {
      "description": "A drag-and-drop document builder with block palette, inspector, and publish flow."
    },
    "pageWizard": {
      "description": "A multi-step guided flow that walks users through a structured process."
    },
    "pageSettings": {
      "description": "A notification-preferences matrix with per-channel toggles and autosave."
    },
    "record": {
      "relatedEmptyTitle": "No related records",
      "loadError": "Failed to load the record.",
      "loadingActivity": "Loading activity",
      "activityTab": "Activity",
      "activityEmptyTitle": "No activity recorded",
      "activityEmptyBody": "Changes made through Adminium will appear here.",
      "activityLoadOlder": "Load older activity",
      "activity": {
        "created": "{actor} created this record",
        "updated": "{actor} updated this record",
        "deleted": "{actor} deleted this record",
        "undone": "{actor} undid a change",
        "changedFields": "{count, plural, one {{n} field changed} other {{n} fields changed}}"
      }
    },
    "pageRecord": {
      "description": "One record as a full page: its fields, related records with live counts, and its change activity."
    }
  },
  "frame": {
    "noResult": "No result for widget",
    "emptyTitle": "No data for range",
    "loadError": "Something went wrong loading this widget.",
    "renderError": "This widget failed to render.",
    "refreshing": "Refreshing",
    "infoLabel": "Widget info",
    "menuLabel": "Widget menu"
  },
  "charts": {
    "livePillLabel": "Live",
    "forecast": {
      "nowLabel": "Now",
      "forecastLabel": "Forecast",
      "actualLabel": "Actual"
    },
    "otherLabel": "Other",
    "heat": {
      "lessLabel": "Less",
      "moreLabel": "More"
    },
    "choropleth": {
      "lowLabel": "Low",
      "highLabel": "High"
    },
    "funnel": {
      "stepConversion": "{pct}% continue",
      "overallConversion": "{pct}% overall"
    }
  }
} as const;
