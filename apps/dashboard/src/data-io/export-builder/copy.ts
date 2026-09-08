// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every string the Export Builder shows, as literal `t()` keys under
 * `dataio.builder.*` (41-export-builder.md Appendix A, D20). Literal keys and
 * exhaustive maps rather than assembled ones: an assembled key cannot be
 * checked against the eight bundles and renders as a raw dotted string when it
 * misses (10 §2.5). The fallbacks are the comp's copy, byte for byte.
 */
import type { MeasureFn } from '@adminium/engine/config';

import { t } from '../../i18n/t.js';

export type BadgeKind = 'key' | 'linked' | 'count' | 'sum' | 'avg' | 'min' | 'max' | 'calculated' | 'masked';

export const BADGE_LABEL: Record<BadgeKind, () => string> = {
  key: () => t('dataio.builder.badge.key', 'Key'),
  linked: () => t('dataio.builder.badge.linked', 'Linked'),
  count: () => t('dataio.builder.badge.count', 'Count'),
  sum: () => t('dataio.builder.badge.sum', 'Sum'),
  avg: () => t('dataio.builder.badge.avg', 'Average'),
  min: () => t('dataio.builder.badge.min', 'Min'),
  max: () => t('dataio.builder.badge.max', 'Max'),
  calculated: () => t('dataio.builder.badge.calculated', 'Calculated'),
  masked: () => t('dataio.builder.badge.masked', 'Masked'),
};

export const FOLD_LABEL: Record<Exclude<MeasureFn, 'count'>, () => string> = {
  sum: () => t('dataio.builder.fold.sum', 'Sum'),
  avg: () => t('dataio.builder.fold.avg', 'Average'),
  min: () => t('dataio.builder.fold.min', 'Min'),
  max: () => t('dataio.builder.fold.max', 'Max'),
};

/** The words a generated header leads with (comp 708-712; D4). */
export const FOLD_HEADER_WORD: Record<Exclude<MeasureFn, 'count'>, () => string> = {
  sum: () => t('dataio.builder.gen.sumOf', 'Sum of'),
  avg: () => t('dataio.builder.gen.average', 'Average'),
  min: () => t('dataio.builder.gen.min', 'Min'),
  max: () => t('dataio.builder.gen.max', 'Max'),
};

export const STEP_LABEL = {
  source: () => t('dataio.builder.steps.source', 'Source'),
  columns: () => t('dataio.builder.steps.columns', 'Columns'),
  preview: () => t('dataio.builder.steps.preview', 'Preview'),
} as const;

export const copy = {
  title: () => t('dataio.builder.title', 'New export'),
  subtitle: () => t('dataio.builder.subtitle', 'Choose a table, pick the columns, check the file, export.'),
  cancel: () => t('dataio.builder.cancel', 'Cancel'),
  backToExports: () => t('dataio.builder.backToExports', 'Back to Data exports'),
  basedOn: (name: string) => t('dataio.builder.basedOn', 'Based on {name}', { name }),
  noAccessTitle: () => t('dataio.builder.noAccess.title', 'Nothing to export yet'),
  /** The sentence with the link's TEXT interpolated; the page splits on that text to wrap it in a link. */
  noAccessBody: (link: string) =>
    t(
      'dataio.builder.noAccess.body',
      'You do not have export access to any table on this connection. Ask an admin to grant it under {link}.',
      { link },
    ),
  noAccessLink: () => t('dataio.builder.noAccess.link', 'Roles & access'),
  step: (n: number) => t('dataio.builder.step', 'Step {n} of 3', { n }),
  continue: () => t('dataio.builder.continue', 'Continue'),
  export: () => t('dataio.builder.export', 'Export'),
  back: () => t('dataio.builder.back', 'Back'),
  hintChooseTable: () => t('dataio.builder.hint.chooseTable', 'Choose a table to continue.'),
  hintFromAll: (table: string) => t('dataio.builder.hint.fromAll', 'Starting from all columns of {table}.', { table }),
  hintFromPage: (table: string) => t('dataio.builder.hint.fromPage', 'Starting from a page bound to {table}.', { table }),
  hintNoColumns: () => t('dataio.builder.hint.noColumns', 'Add at least one column to continue.'),
  hintDupes: () => t('dataio.builder.hint.dupes', 'Two columns have the same header. Rename one to continue.'),
  hintOrder: (n: number) => t('dataio.builder.hint.order', '{n} columns will be written in this order.', { n }),
  hintReadSample: () => t('dataio.builder.hint.readSample', 'Read the sample before exporting.'),
  hintDownloads: () => t('dataio.builder.hint.downloads', 'The file downloads from Data exports when it is ready.'),

  sourceTitle: () => t('dataio.builder.source.title', 'Which table?'),
  sourceSearch: () => t('dataio.builder.source.search', 'Search tables…'),
  sourceMeta: (rows: string, cols: number) => t('dataio.builder.source.meta', '{rows} rows · {cols} columns', { rows, cols }),
  sourceMetaNoRows: (cols: number) => t('dataio.builder.source.metaNoRows', '{cols} columns', { cols }),
  sourceUsedBy: (n: number) =>
    t('dataio.builder.source.usedBy', 'Used by {n, plural, one {# page} other {# pages}}', { n }),
  sourceLocked: () => t('dataio.builder.source.locked', 'No export access'),
  sourceLockedToast: (table: string) =>
    t('dataio.builder.source.lockedToast', 'You do not have export access to {table}', { table }),
  startFromTitle: () => t('dataio.builder.startFrom.title', 'Start from'),
  startFromBody: () =>
    t('dataio.builder.startFrom.body', 'Pick where the column list begins. You can change everything in the next step.'),
  startFromAll: (table: string) => t('dataio.builder.startFrom.all', 'All columns of {table}', { table }),
  startFromPage: (page: string) => t('dataio.builder.startFrom.page', 'The columns of a page — {page}', { page }),
  startFromPageMeta: (page: string, n: number, linked: number, totals: number) =>
    t(
      'dataio.builder.startFrom.pageMeta',
      '{page} · {n} columns · {linked} linked · {totals, plural, one {# total} other {# totals}}',
      { page, n, linked, totals },
    ),
  startFromNone: () => t('dataio.builder.startFrom.none', 'No page is bound to this table'),

  columnsTitle: () => t('dataio.builder.columns.title', 'What goes in the file.'),
  addColumns: () => t('dataio.builder.columns.add', 'Add columns'),
  inFile: () => t('dataio.builder.columns.inFile', 'In your file'),
  columnsSummary: (n: number, linked: number, totals: number) =>
    t(
      'dataio.builder.columns.summary',
      '{n} columns · {linked} linked · {totals, plural, one {# total} other {# totals}}',
      { n, linked, totals },
    ),
  reset: () => t('dataio.builder.columns.reset', 'Reset to table columns'),
  removeAll: () => t('dataio.builder.columns.removeAll', 'Remove all'),
  emptyTitle: () => t('dataio.builder.columns.empty.title', 'No columns yet'),
  emptyBody: () =>
    t('dataio.builder.columns.empty.body', 'Add columns from the panel, or reset to the table\'s own columns.'),
  dragTitle: () => t('dataio.builder.columns.dragTitle', 'Drag to reorder, or use the arrow keys'),
  reorder: (header: string) => t('dataio.builder.columns.reorder', 'Reorder {header}', { header }),
  headerLabel: () => t('dataio.builder.columns.headerLabel', 'Header in the file'),
  maskedNote: () => t('dataio.builder.columns.masked', 'Exports as ••••• unless you hold the reveal permission'),
  dupeNote: () => t('dataio.builder.columns.dupe', 'Another column uses this header'),
  removeTitle: () => t('dataio.builder.columns.removeTitle', 'Remove from the file'),
  remove: (header: string) => t('dataio.builder.columns.remove', 'Remove {header}', { header }),

  browserSearch: () => t('dataio.builder.browser.search', 'Search columns…'),
  broken: () => t('dataio.builder.browser.broken', 'That link no longer resolves — start it again.'),
  brokenBack: () => t('dataio.builder.browser.brokenBack', 'Back to all tables'),
  suggested: () => t('dataio.builder.browser.suggested', 'Suggested'),
  fromTable: (table: string) => t('dataio.builder.browser.fromTable', 'From {table}', { table }),
  fromTheTable: () => t('dataio.builder.browser.fromTheTable', 'From the table'),
  readOnly: () => t('dataio.builder.browser.readOnly', 'Read-only column'),
  noMatch: () => t('dataio.builder.browser.noMatch', 'No column matches that search.'),
  allIn: () => t('dataio.builder.browser.allIn', 'Every column of this table is already in your file.'),
  linked: () => t('dataio.builder.browser.linked', 'From linked tables'),
  budget: (used: number, max: number) => t('dataio.builder.browser.budget', '{used} of {max}', { used, max }),
  inbound: () => t('dataio.builder.browser.inbound', 'Tables that link here'),
  via: (column: string) => t('dataio.builder.browser.via', 'via {column}', { column }),
  count: () => t('dataio.builder.browser.count', 'Count'),
  aggregate: () => t('dataio.builder.browser.aggregate', 'Aggregate'),
  add: () => t('dataio.builder.browser.add', 'Add'),
  singleNote: () => t('dataio.builder.browser.singleNote', 'Min and Max take one column.'),
  limit: () => t('dataio.builder.browser.limit', 'Limit reached — remove one to add another'),
  fourMax: () => t('dataio.builder.browser.fourMax', 'Up to four columns'),
  pickNumeric: () => t('dataio.builder.browser.pickNumeric', 'Pick a numeric column first'),
  already: (header: string) => t('dataio.builder.browser.already', '{header} is already in your file', { header }),
  added: (header: string) => t('dataio.builder.browser.added', '{header} added', { header }),
  calculated: () => t('dataio.builder.browser.calculated', 'Calculated'),
  hop: () => t('dataio.builder.browser.hop', 'Add a column, or follow another link outward.'),
  hopLimit: () => t('dataio.builder.browser.hopLimit', 'Three hops is the limit. Add a column here, or step back.'),
  addName: (name: string) => t('dataio.builder.browser.addName', 'Add {name}', { name }),
  noRead: () => t('dataio.builder.browser.noRead', 'No read access'),

  calcArith: () => t('dataio.builder.calc.arith', 'Add or subtract two columns'),
  calcFirst: () => t('dataio.builder.calc.first', 'First column'),
  calcOp: () => t('dataio.builder.calc.op', 'Operator'),
  calcSecond: () => t('dataio.builder.calc.second', 'Second column'),
  calcPct: () => t('dataio.builder.calc.pct', 'A percentage of one column'),
  calcPctLabel: () => t('dataio.builder.calc.pctLabel', 'Percentage'),
  calcPctOf: () => t('dataio.builder.calc.pctOf', '% of'),
  calcColumn: () => t('dataio.builder.calc.column', 'Column'),
  calcRule: () => t('dataio.builder.calc.rule', 'A rule with a threshold'),
  calcIf: () => t('dataio.builder.calc.if', 'If'),
  calcIsOver: () => t('dataio.builder.calc.isOver', 'is over'),
  calcThen: () => t('dataio.builder.calc.then', 'then'),
  calcElse: () => t('dataio.builder.calc.else', 'else'),
  calcThreshold: () => t('dataio.builder.calc.threshold', 'Threshold'),
  calcWhenOver: () => t('dataio.builder.calc.whenOver', 'Value when over'),
  calcOtherwise: () => t('dataio.builder.calc.otherwise', 'Value otherwise'),
  calcNeedTwo: () => t('dataio.builder.calc.needTwo', 'Add two numeric columns first'),
  calcNeedOne: () => t('dataio.builder.calc.needOne', 'Add a numeric column first'),

  genCount: (table: string) => t('dataio.builder.gen.count', '{table} count', { table }),
  genCountSrc: (table: string, column: string) =>
    t('dataio.builder.gen.countSrc', 'count of {table} via {column}', { table, column }),
  genFoldSrc: (fn: string, table: string, cols: string) =>
    t('dataio.builder.gen.foldSrc', '{fn} of {table}.{cols}', { fn, table, cols }),
  genLinkedSrc: (table: string, column: string, path: string) =>
    t('dataio.builder.gen.linkedSrc', '{table}.{column} via {path}', { table, column, path }),
  genArithHeader: (a: string, op: string, b: string) => t('dataio.builder.gen.arithHeader', '{a} {op} {b}', { a, op, b }),
  genPctHeader: (pct: string, a: string) => t('dataio.builder.gen.pctHeader', '{pct}% of {a}', { pct, a }),
  genRuleHeader: (then: string, otherwise: string) =>
    t('dataio.builder.gen.ruleHeader', '{then} or {else}', { then, else: otherwise }),
  genRuleSrc: (a: string, threshold: string, then: string, otherwise: string) =>
    t('dataio.builder.gen.ruleSrc', 'if {a} is over {threshold} then {then}, else {else}', {
      a,
      threshold,
      then,
      else: otherwise,
    }),

  previewTitle: () => t('dataio.builder.preview.title', 'Check the file, then export.'),
  fileName: () => t('dataio.builder.preview.fileName', 'File name'),
  format: () => t('dataio.builder.preview.format', 'Format'),
  csv: () => t('dataio.builder.preview.csv', 'CSV'),
  jsonl: () => t('dataio.builder.preview.jsonl', 'JSON Lines'),
  rows: () => t('dataio.builder.preview.rows', 'Rows'),
  allRows: (n: string) => t('dataio.builder.preview.allRows', 'All rows · {n}', { n }),
  allRowsUnknown: () => t('dataio.builder.preview.allRowsUnknown', 'All rows'),
  viewRows: () => t('dataio.builder.preview.viewRows', 'Rows of a saved view'),
  savedView: () => t('dataio.builder.preview.savedView', 'Saved view'),
  viewLabel: (name: string, filters: number, rows: string) =>
    t('dataio.builder.preview.viewLabel', '{name} · {filters} filters · {rows} rows', { name, filters, rows }),
  viewLabelNoRows: (name: string, filters: number) =>
    t('dataio.builder.preview.viewLabelNoRows', '{name} · {filters} filters', { name, filters }),
  headerRow: () => t('dataio.builder.preview.headerRow', 'Header row'),
  tabTable: () => t('dataio.builder.preview.tabTable', 'Table'),
  tabRaw: () => t('dataio.builder.preview.tabRaw', 'Raw file'),
  sample: (n: number, when: string) => t('dataio.builder.preview.sample', 'Sample of {n} rows · refreshed {when}', { n, when }),
  justNow: () => t('dataio.builder.preview.justNow', 'just now'),
  minutesAgo: (n: number) => t('dataio.builder.preview.minutesAgo', '{n, plural, one {# minute ago} other {# minutes ago}}', { n }),
  refresh: () => t('dataio.builder.preview.refresh', 'Refresh'),
  sampleFailed: () => t('dataio.builder.preview.failed', 'The sample could not be read.'),
  sampleTimeout: () =>
    t('dataio.builder.preview.failedTimeout', 'The connection answered too slowly. The export itself has not run.'),
  retry: () => t('dataio.builder.preview.retry', 'Retry'),
  headerOnly: () => t('dataio.builder.preview.headerOnly', 'The file will contain the header row only.'),
  summaryTitle: () => t('dataio.builder.summary.title', 'The file'),
  summaryColumns: () => t('dataio.builder.summary.columns', 'Columns'),
  summaryRows: () => t('dataio.builder.summary.rows', 'Rows'),
  summarySize: () => t('dataio.builder.summary.size', 'Estimated size'),
  summaryRetention: () => t('dataio.builder.summary.retention', 'Retention'),
  summaryKept: () => t('dataio.builder.summary.kept', 'Kept for 30 days'),
  summaryFileName: () => t('dataio.builder.summary.fileName', 'File name'),
  warnTitle: () => t('dataio.builder.warn.title', 'Worth knowing'),
  warnMasked: (n: number) =>
    t('dataio.builder.warn.masked', '{n, plural, one {# column exports} other {# columns export}} masked', { n }),
  warnSearch: () => t('dataio.builder.warn.search', 'This view has a search term, which an export cannot carry'),
  warnNoRows: () => t('dataio.builder.warn.noRows', 'This table has no rows right now'),

  preparing: (file: string, rows: string) => t('dataio.builder.started.preparing', 'Preparing {file} · {rows} rows', { file, rows }),
  ready: (rows: string) => t('dataio.builder.started.ready', 'Ready · {rows} rows', { rows }),
  noteBusy: () =>
    t('dataio.builder.started.noteBusy', 'It will appear on Data exports and download from there when it is ready.'),
  noteReady: () =>
    t('dataio.builder.started.noteReady', 'Ready. It is also on Data exports if you would rather come back to it later.'),
  download: (format: string) => t('dataio.builder.started.download', 'Download {format}', { format }),
  busy: () => t('dataio.builder.started.busy', 'Preparing the file…'),
  another: () => t('dataio.builder.started.another', 'Export another'),
  toastStarted: () => t('dataio.builder.toast.started', 'Export started'),
  failedTitle: () => t('dataio.builder.started.failed', 'The export failed.'),
} as const;
