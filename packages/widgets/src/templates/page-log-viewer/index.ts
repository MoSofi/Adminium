/**
 * `page-log-viewer` template (09-generated-app.md §7.8; 04 §10) — the component
 * the dashboard PageRenderer mounts for `template: 'page-log-viewer'`
 * envelopes, plus the pure log field-mapping helpers its binding and tests
 * share.
 */
export {
  PAGE_LOG_VIEWER_TEMPLATE_ID,
  PageLogViewer,
  classifyLogViewerItems,
  type PageLogViewerLabels,
  type PageLogViewerProps,
} from './PageLogViewer.js';
export {
  LOG_TIME_WINDOWS,
  TRACE_SNIPPET_MAX,
  detectLogFields,
  filterLogRows,
  logKeyOf,
  logRecordRowsOf,
  toMappedLogRow,
  traceEntriesOf,
  tsHintOf,
  type LogFieldMap,
  type LogLevelKey,
  type LogTimeWindowKey,
  type MappedLogRow,
} from './log-mapping.js';
export { demoLogViewerLayout } from './demo-layout.js';
