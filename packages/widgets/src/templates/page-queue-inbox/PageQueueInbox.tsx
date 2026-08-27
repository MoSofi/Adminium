// SPDX-License-Identifier: AGPL-3.0-only
import {
  Button,
  Checkbox,
  EmptyState,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  SegmentedControl,
  Spinner,
  StatusPill,
  Textarea,
  ToastStack,
  useToastQueue,
} from '@adminium/ui';
import { getFormatters } from '@adminium/i18n';
import { useMaybeT } from '@adminium/i18n/react';
import { useCallback, useMemo, useState } from 'react';

import { WidgetHost } from '../../frame/WidgetHost.js';
import type { WidgetDataState } from '../../frame/WidgetHost.js';
import { BulkActionToolbar } from '../../families/tables/BulkActionToolbar.js';
import { DetailKeyValue } from '../../families/tables/DetailKeyValue.js';
import { LoadOlderPaginator } from '../../families/feeds/LoadOlderPaginator.js';
import { formatRelativeTime, uiToneOf } from '../../families/tables/column-spec.js';
import type { WidgetEvent } from '../../registry/types.js';
import { describeDataError } from '../../lib/data-error.js';
import {
  useDashboardData,
  type DashboardDataAdapter,
  type DashboardDataStates,
} from '../page-dashboard/data-adapter.js';
import type { QueueApi } from './queue-api.js';
import {
  AMOUNT_FIELD_CANDIDATES,
  SUBTITLE_FIELD_CANDIDATES,
  TITLE_FIELD_CANDIDATES,
  UPDATED_FIELD_CANDIDATES,
  cellText,
  configString,
  enumTonesOf,
  guessField,
  humanizeName,
  parseTemplateBody,
  recordPkOf,
  recordRowsOf,
  slotItemOf,
  slotItemsOf,
  specsForRecord,
  type TemplateBody,
} from '../stored-config.js';
import type { GridRow, GridTone, LayoutItem } from '../../page-config/index.js';

/**
 * `page-queue-inbox` — the approvals/inbox archetype (09-generated-app.md
 * §7.4; annex §14 "Approvals Queue, Activity Inbox, Notifications Center"):
 * a KPI row, `segmented-control` status tabs with live counts, the queue list
 * with bulk approve/reject, a reject-with-reason modal, a `detail-key-value`
 * side pane, and a `load-older-paginator` footer.
 *
 * UNDO-FIRST bulk semantics (§4.1): a decision applies optimistically to the
 * exact selected id set, the `QueueApi.bulkUpdate` reply's single-use token
 * rides a success toast whose Undo restores that exact set server-side
 * (the token captured prior values), and a failure rolls the optimistic
 * patch back with an error toast. Enum pill tints flow from the stored
 * `enumTones` map — never hardcoded (M7-T04 class fix).
 *
 * The `notification-feed` queue flavor mounts through WidgetHost instead —
 * the feed owns its tabs/mark-all-read and emits `mutate` intents the host
 * runs through the CRUD API.
 */

export const PAGE_QUEUE_INBOX_TEMPLATE_ID = 'page-queue-inbox';

const QUEUE_WIDGETS = ['notification-feed', 'master-list', 'data-grid'] as const;
const DETAIL_WIDGETS = ['detail-key-value'] as const;

const STATUS_FIELD_CANDIDATES = ['status', 'state', 'approval_status', 'decision'] as const;
const DURATION_FIELD_CANDIDATES = ['days', 'duration_days', 'nights', 'duration'] as const;
const REASON_FIELD_CANDIDATES = ['rejection_reason', 'decision_note', 'reason', 'note'] as const;

/** Client-side reveal batch for the load-older footer (§7.4). */
export const QUEUE_PAGE_SIZE = 25;

export interface PageQueueInboxLabels {
  approve?: string | undefined;
  reject?: string | undefined;
  clearSelection?: string | undefined;
  allSegment?: string | undefined;
  undo?: string | undefined;
  dismiss?: string | undefined;
  approvedToast?: string | undefined; // '{count}' placeholder
  rejectedToast?: string | undefined; // '{count}' placeholder
  undoneToast?: string | undefined;
  failedToast?: string | undefined;
  undoFailedToast?: string | undefined;
  rejectTitle?: string | undefined;
  rejectCount?: string | undefined; // '{count}' placeholder
  rejectNote?: string | undefined;
  rejectPlaceholder?: string | undefined;
  rejectConfirm?: string | undefined;
  cancel?: string | undefined;
  close?: string | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  caughtUpTitle?: string | undefined;
  caughtUpBody?: string | undefined;
  errorTitle?: string | undefined;
  /** Shown instead of `errorTitle` when the connection is paused (0019). */
  connectionPausedTitle?: string | undefined;
  retry?: string | undefined;
  loading?: string | undefined;
  selectPrompt?: string | undefined;
  daysUnit?: string | undefined; // '{count}' placeholder
}

export interface PageQueueInboxProps {
  /** The stored page config body (`{ layout, toolbar, overlays, … }`). */
  config: unknown;
  adapter?: DashboardDataAdapter | undefined;
  params?: Record<string, unknown> | undefined;
  states?: DashboardDataStates | undefined;
  /** Bulk mutation adapter; absent → decisions apply locally only (demo). */
  api?: QueueApi | undefined;
  onEvent?: ((instanceId: string, event: WidgetEvent) => void | Promise<unknown>) | undefined;
  labels?: PageQueueInboxLabels | undefined;
  locale?: string | undefined;
  currency?: string | undefined;
  /** Injectable clock for deterministic relative timestamps. */
  now?: number | undefined;
  testId?: string | undefined;
}

function interpolate(template: string, count: number): string {
  return template.replace('{count}', String(count));
}

interface QueueFields {
  titleField: string;
  subtitleField: string | undefined;
  statusField: string | undefined;
  amountField: string | undefined;
  durationField: string | undefined;
  updatedField: string | undefined;
  reasonField: string | undefined;
  enumTones: Record<string, GridTone> | undefined;
}

function queueFieldsOf(item: LayoutItem | undefined, rows: readonly GridRow[]): QueueFields {
  const config = item?.config ?? {};
  return {
    titleField:
      configString(config, 'titleField', 'titleColumn') ?? guessField(rows, TITLE_FIELD_CANDIDATES) ?? 'name',
    subtitleField:
      configString(config, 'subtitleField', 'subtitleColumn') ?? guessField(rows, SUBTITLE_FIELD_CANDIDATES),
    statusField:
      configString(config, 'statusField', 'statusColumn', 'groupBy') ?? guessField(rows, STATUS_FIELD_CANDIDATES),
    amountField: configString(config, 'amountField', 'amountColumn') ?? guessField(rows, AMOUNT_FIELD_CANDIDATES),
    durationField: configString(config, 'durationField') ?? guessField(rows, DURATION_FIELD_CANDIDATES),
    updatedField: configString(config, 'updatedField') ?? guessField(rows, UPDATED_FIELD_CANDIDATES),
    reasonField: configString(config, 'reasonField', 'reasonColumn') ?? guessField(rows, REASON_FIELD_CANDIDATES),
    enumTones: enumTonesOf(config),
  };
}

/** Workflow decision values: explicit config beats the value-vocabulary scan. */
export function decisionValuesOf(
  config: Record<string, unknown>,
  statusValues: readonly string[],
): { approve: string; reject: string; pending: string | undefined } {
  const approve =
    configString(config, 'approveValue') ??
    statusValues.find((value) => /approv|accept|confirm/i.test(value)) ??
    'approved';
  const reject =
    configString(config, 'rejectValue') ??
    statusValues.find((value) => /reject|denied|declin/i.test(value)) ??
    'rejected';
  const pending =
    configString(config, 'pendingValue') ?? statusValues.find((value) => /pending|await|review|open|submitted/i.test(value));
  return { approve, reject, pending };
}

export function PageQueueInbox({
  config,
  adapter,
  params,
  states,
  api,
  onEvent,
  labels,
  locale,
  currency,
  now,
  testId,
}: PageQueueInboxProps) {
  const body: TemplateBody = useMemo(() => parseTemplateBody(config), [config]);
  const dataStates = useDashboardData(body.layout, adapter, params);
  const stateFor = useCallback(
    (item: LayoutItem | undefined): WidgetDataState =>
      item === undefined
        ? { status: 'loading' }
        : (states?.[item.i] ?? dataStates[item.i] ?? { status: 'loading' }),
    [states, dataStates],
  );

  const kpiItems = useMemo(() => slotItemsOf(body.layout, 'kpi-row'), [body.layout]);
  const queueItem = useMemo(() => slotItemOf(body.layout, 'queue', QUEUE_WIDGETS), [body.layout]);
  const detailItem = useMemo(() => slotItemOf(body.layout, 'detail', DETAIL_WIDGETS), [body.layout]);
  const queueState = stateFor(queueItem);
  const queueConfig = queueItem?.config ?? {};
  const isFeed = queueItem?.widget === 'notification-feed';

  const queue = useToastQueue();
  const t = useMaybeT();
  /**
   * What the error panel should say — a PAUSED connection is not a failed
   * load (meta wave 0019): its own title, a calmer tone, and no Retry,
   * because retrying cannot change the answer until a person resumes it.
   */
  const dataError = describeDataError(
    queueState.status === 'error' ? queueState.error : null,
    labels?.errorTitle ?? t('ui:templates.queue.errorTitle', 'This queue failed to load'),
    labels?.connectionPausedTitle ?? t('ui:templates.common.connectionPaused', 'This connection is paused'),
  );
  const formatters = useMemo(() => getFormatters(locale ?? 'en-US'), [locale]);

  // --- optimistic overlay (undo-first bulk decisions, §4.1) --------------------
  const [patches, setPatches] = useState<Record<string, Record<string, unknown>>>({});
  const rawRows = useMemo(() => recordRowsOf(queueState.data), [queueState.data]);

  // Row identity: the table's REAL primary key from the record-list `columns`
  // meta first (a `request_id` PK must never degrade to the row index — the
  // server bulk route would NOT_FOUND every synthetic id and the queue would
  // lie), then a literal `id` key, then the index (demo-only: no api).
  const idField = useMemo(() => {
    const pk = recordPkOf(queueState.data);
    if (pk !== undefined) return pk;
    return rawRows.some((row) => row['id'] !== undefined) ? 'id' : undefined;
  }, [queueState.data, rawRows]);
  const rowIdText = useCallback(
    (row: GridRow, index: number): string => {
      const id = idField === undefined ? undefined : row[idField];
      return typeof id === 'string' || typeof id === 'number' ? String(id) : String(index);
    },
    [idField],
  );

  // Fresh rows are authoritative: retire the optimistic overlay whenever a
  // refetch lands so server truth can never stay shadowed by stale patches
  // (React "adjust state during render" idiom — no extra effect frame).
  const [patchedForRows, setPatchedForRows] = useState(rawRows);
  if (patchedForRows !== rawRows) {
    setPatchedForRows(rawRows);
    if (Object.keys(patches).length > 0) setPatches({});
  }

  const rows = useMemo(
    () =>
      rawRows.map((row, index) => {
        const patch = patches[rowIdText(row, index)];
        return patch === undefined ? row : { ...row, ...patch };
      }),
    [rawRows, patches, rowIdText],
  );
  const fields = useMemo(() => queueFieldsOf(queueItem, rawRows), [queueItem, rawRows]);

  const statusValues = useMemo(() => {
    if (fields.statusField === undefined) return [];
    return [...new Set(rows.map((row) => cellText(row[fields.statusField as string])).filter((v): v is string => v !== undefined))];
  }, [rows, fields.statusField]);
  const decisions = useMemo(() => decisionValuesOf(queueConfig, statusValues), [queueConfig, statusValues]);

  // --- segments ----------------------------------------------------------------
  const [chosenSegment, setChosenSegment] = useState<string | null>(null);
  // Display default: the pending-ish tab when the enum has one (§7.4 comp).
  const segment = chosenSegment ?? decisions.pending ?? '__all__';
  const segmentOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = fields.statusField === undefined ? undefined : cellText(row[fields.statusField]);
      if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [
      { value: '__all__', label: labels?.allSegment ?? t('ui:templates.queue.allSegment', 'All'), count: rows.length },
      ...[...counts.entries()].map(([value, count]) => ({ value, label: humanizeName(value), count })),
    ];
  }, [rows, fields.statusField, labels?.allSegment, t]);

  const visibleRows = useMemo(
    () =>
      segment === '__all__' || fields.statusField === undefined
        ? rows
        : rows.filter((row) => cellText(row[fields.statusField as string]) === segment),
    [rows, segment, fields.statusField],
  );

  // --- load-older reveal ---------------------------------------------------------
  const [revealed, setRevealed] = useState(QUEUE_PAGE_SIZE);
  const pagedRows = useMemo(() => visibleRows.slice(0, revealed), [visibleRows, revealed]);

  // --- selection (checkboxes + detail focus) ------------------------------------
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Display default: the first visible row fills the pane (no state write).
  const focusedEffectiveId =
    focusedId ?? (pagedRows.length === 0 ? null : rowIdText(pagedRows[0] as GridRow, 0));
  const focusedRow = useMemo(
    () =>
      focusedEffectiveId === null
        ? undefined
        : rows.find((row, index) => rowIdText(row, index) === focusedEffectiveId),
    [focusedEffectiveId, rows],
  );

  const toneFor = useCallback(
    (value: string | undefined) =>
      value === undefined || fields.enumTones?.[value] === undefined
        ? undefined
        : uiToneOf(fields.enumTones[value] as GridTone),
    [fields.enumTones],
  );

  // --- polymorphic amount cell ($4,120 / 5 days / —, §7.4) ----------------------
  const amountTextOf = useCallback(
    (row: GridRow): string => {
      const amount = fields.amountField === undefined ? undefined : row[fields.amountField];
      if (typeof amount === 'number' && Number.isFinite(amount)) {
        return formatters.currency(amount, currency ?? 'USD');
      }
      const duration = fields.durationField === undefined ? undefined : row[fields.durationField];
      if (typeof duration === 'number' && Number.isFinite(duration)) {
        // Override templates keep the simple {count} substitution; the default
        // is an ICU plural whose branches use a bare {count} so the digits stay
        // exactly `String(duration)` (never locale-grouped).
        return labels?.daysUnit !== undefined
          ? interpolate(labels.daysUnit, duration)
          : t('ui:templates.queue.daysUnit', '{count, plural, one {{count} day} other {{count} days}}', {
              count: duration,
            });
      }
      return '—';
    },
    [fields.amountField, fields.durationField, formatters, currency, labels?.daysUnit, t],
  );

  // --- undo-first decisions ------------------------------------------------------
  const applyDecision = useCallback(
    (ids: readonly string[], values: Record<string, unknown>, toastTitle: string) => {
      // Capture the EXACT set (bulk keeper, 09 §4.1) before anything async.
      const exactIds = [...ids];
      const priorPatches = patches;
      setPatches((current) => {
        const next = { ...current };
        for (const id of exactIds) next[id] = { ...next[id], ...values };
        return next;
      });
      setChecked(new Set());

      const rollback = () => setPatches(priorPatches);
      const finish = (undoToken: string | null) => {
        queue.push({
          variant: 'success',
          title: toastTitle,
          ...(undoToken === null || api === undefined
            ? {}
            : {
                action: {
                  label: labels?.undo ?? t('ui:action.undo', 'Undo'),
                  onAction: () => {
                    api
                      .undo(undoToken)
                      .then(() => {
                        rollback();
                        queueState.refetch?.();
                        queue.push({
                          variant: 'info',
                          title: labels?.undoneToast ?? t('ui:templates.queue.undoneToast', 'Decision undone.'),
                        });
                      })
                      .catch((reason: unknown) => {
                        queue.push({
                          variant: 'error',
                          title:
                            reason instanceof Error
                              ? reason.message
                              : (labels?.undoFailedToast ??
                                t('ui:templates.queue.undoFailedToast', 'Could not undo this decision.')),
                        });
                      });
                  },
                },
              }),
        });
      };

      if (api === undefined) {
        finish(null); // demo mode: local-only optimistic decision
        return;
      }
      api
        .bulkUpdate(exactIds, values)
        .then((result) => finish(result.undoToken))
        .catch((reason: unknown) => {
          rollback();
          queue.push({
            variant: 'error',
            title:
              reason instanceof Error
                ? reason.message
                : (labels?.failedToast ?? t('ui:templates.queue.failedToast', 'Decision failed.')),
          });
        });
    },
    [api, patches, queue, queueState, labels, t],
  );

  const approve = useCallback(
    (ids: readonly string[]) => {
      if (fields.statusField === undefined) return;
      applyDecision(
        ids,
        { [fields.statusField]: decisions.approve },
        labels?.approvedToast !== undefined
          ? interpolate(labels.approvedToast, ids.length)
          : t('ui:templates.queue.approvedToast', '{count} approved.', { count: ids.length }),
      );
    },
    [fields.statusField, decisions.approve, applyDecision, labels?.approvedToast, t],
  );

  // --- reject-with-reason modal ---------------------------------------------------
  const [rejectIds, setRejectIds] = useState<readonly string[] | null>(null);
  const [reason, setReason] = useState('');
  const confirmReject = useCallback(() => {
    if (rejectIds === null || fields.statusField === undefined) return;
    const values: Record<string, unknown> = { [fields.statusField]: decisions.reject };
    if (fields.reasonField !== undefined && reason.trim() !== '') values[fields.reasonField] = reason.trim();
    applyDecision(
      rejectIds,
      values,
      labels?.rejectedToast !== undefined
        ? interpolate(labels.rejectedToast, rejectIds.length)
        : t('ui:templates.queue.rejectedToast', '{count} rejected.', { count: rejectIds.length }),
    );
    setRejectIds(null);
    setReason('');
  }, [rejectIds, fields.statusField, fields.reasonField, decisions.reject, reason, applyDecision, labels?.rejectedToast, t]);

  const detailSpecs = useMemo(() => {
    if (focusedRow === undefined) return [];
    const toneFields: Record<string, Record<string, GridTone> | undefined> = {};
    if (fields.statusField !== undefined) toneFields[fields.statusField] = fields.enumTones;
    return specsForRecord(focusedRow, { toneFields, displayField: fields.titleField });
  }, [focusedRow, fields]);

  if (!body.valid) {
    return (
      <p role="alert" className="p-6 text-body-sm text-fg-muted" data-testid="page-queue-inbox-invalid">
        {t(
          'ui:templates.queue.invalidConfig',
          'This queue’s stored configuration is invalid. Regenerate the page to restore it.',
        )}
      </p>
    );
  }

  const checkedIds = [...checked];

  return (
    <div data-part="page-queue-inbox" data-testid={testId} className="flex h-full min-h-0 flex-col gap-4">
      {/* KPI row (manifest `kpi-row`, repeat ≤4). */}
      {kpiItems.length > 0 && (
        <div className="grid shrink-0 grid-cols-2 gap-4 lg:grid-cols-4" data-part="queue-kpi-row">
          {kpiItems.map((item) => (
            <WidgetHost
              key={item.i}
              widgetId={item.widget}
              instanceId={item.i}
              config={item.config}
              data={stateFor(item)}
              onEvent={onEvent === undefined ? undefined : (event) => void onEvent(item.i, event)}
            />
          ))}
        </div>
      )}

      {isFeed ? (
        /* Notifications-center flavor: the feed owns tabs + mark-all-read and
           emits mutate intents the host runs (undoable at the host layer). */
        <div className="min-h-0 flex-1">
          <WidgetHost
            widgetId={queueItem.widget}
            instanceId={queueItem.i}
            config={queueItem.config}
            data={queueState}
            onEvent={onEvent === undefined ? undefined : (event) => void onEvent(queueItem.i, event)}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          {/* Queue list. */}
          <section
            aria-label={t('ui:templates.queue.queueLabel', 'Queue')}
            className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface"
          >
            <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              {checkedIds.length > 0 ? (
                <BulkActionToolbar
                  selectedIds={checkedIds}
                  actions={[
                    // Stored per-type accept labels (§7.4) beat the generic catalog copy.
                    {
                      key: 'approve',
                      label:
                        configString(queueConfig, 'approveLabel') ??
                        labels?.approve ??
                        t('ui:widgets.domain.blockApproval.approveLabel', 'Approve'),
                    },
                    {
                      key: 'reject',
                      label:
                        configString(queueConfig, 'rejectLabel') ??
                        labels?.reject ??
                        t('ui:widgets.domain.blockApproval.rejectLabel', 'Reject'),
                      danger: true,
                    },
                  ]}
                  onAction={(key, ids) => {
                    if (key === 'approve') approve(ids);
                    if (key === 'reject') setRejectIds(ids);
                  }}
                  onClear={() => setChecked(new Set())}
                />
              ) : (
                fields.statusField !== undefined && (
                  <SegmentedControl
                    aria-label={t('ui:templates.queue.statusFilterLabel', 'Status filter')}
                    options={segmentOptions}
                    value={segment}
                    onValueChange={(value) => {
                      setChosenSegment(value);
                      setRevealed(QUEUE_PAGE_SIZE);
                    }}
                  />
                )
              )}
            </div>

            {queueState.status === 'error' ? (
              <EmptyState
                tone={dataError.tone}
                title={dataError.title}
                body={dataError.body}
                actions={
                  // A paused connection offers no Retry: see `describeDataError`.
                  queueState.refetch === undefined || !dataError.retryable ? undefined : (
                    <Button size="sm" variant="secondary" onClick={queueState.refetch}>
                      {labels?.retry ?? t('ui:action.retry', 'Retry')}
                    </Button>
                  )
                }
              />
            ) : queueState.status === 'loading' ? (
              <div className="flex flex-1 items-center justify-center py-16">
                <Spinner label={labels?.loading ?? t('ui:templates.queue.loading', 'Loading queue')} />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                preset="no-data"
                title={labels?.emptyTitle ?? t('ui:templates.queue.emptyTitle', 'Nothing in the queue')}
                body={labels?.emptyBody ?? t('ui:templates.queue.emptyBody', 'New requests appear here as they arrive.')}
              />
            ) : visibleRows.length === 0 ? (
              /* A drained tab is a win — all-caught-up, distinct from first-use. */
              <EmptyState
                preset="all-caught-up"
                title={labels?.caughtUpTitle ?? t('ui:templates.queue.caughtUpTitle', "You're all caught up")}
                body={labels?.caughtUpBody ?? t('ui:templates.queue.caughtUpBody', 'No requests in this tab right now.')}
              />
            ) : (
              <>
                <ul data-part="queue-rows" className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
                  {pagedRows.map((row, index) => {
                    const id = rowIdText(row, index);
                    const title = cellText(row[fields.titleField]) ?? id;
                    const status = fields.statusField === undefined ? undefined : cellText(row[fields.statusField]);
                    const statusTone = toneFor(status);
                    const subtitle = fields.subtitleField === undefined ? undefined : cellText(row[fields.subtitleField]);
                    const updated = fields.updatedField === undefined ? undefined : cellText(row[fields.updatedField]);
                    const isChecked = checked.has(id);
                    const isFocused = focusedEffectiveId === id;
                    return (
                      <li key={id}>
                        <div
                          data-selected={isFocused}
                          className="flex items-center gap-3 border-s-2 border-transparent px-3 py-2.5 data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft/60 hover:bg-surface-2/60"
                        >
                          <Checkbox
                            checked={isChecked}
                            aria-label={t('ui:templates.queue.selectItem', 'Select {title}', { title })}
                            onCheckedChange={(next) => {
                              setChecked((current) => {
                                const nextSet = new Set(current);
                                if (next === true) nextSet.add(id);
                                else nextSet.delete(id);
                                return nextSet;
                              });
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setFocusedId(id)}
                            className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                          >
                            <span className="flex w-full items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-fg">{title}</span>
                              {status !== undefined && (
                                <StatusPill
                                  status={status}
                                  {...(statusTone === undefined ? {} : { tone: statusTone })}
                                  data-part="queue-status-pill"
                                />
                              )}
                            </span>
                            <span className="flex w-full items-center gap-2">
                              {subtitle !== undefined && (
                                <span className="min-w-0 truncate text-caption text-fg-muted">{subtitle}</span>
                              )}
                              {updated !== undefined && (
                                <span className="text-caption text-fg-subtle">
                                  {formatRelativeTime(updated, {
                                    ...(locale === undefined ? {} : { locale }),
                                    ...(now === undefined ? {} : { now }),
                                  })}
                                </span>
                              )}
                              <span
                                data-part="queue-amount"
                                className="ms-auto shrink-0 font-mono text-caption font-semibold tabular-nums text-fg"
                              >
                                {amountTextOf(row)}
                              </span>
                            </span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <LoadOlderPaginator
                  loaded={pagedRows.length}
                  total={visibleRows.length}
                  hasMore={pagedRows.length < visibleRows.length}
                  onLoadOlder={() => setRevealed((current) => current + QUEUE_PAGE_SIZE)}
                  hideWhenExhausted
                  {...(locale === undefined ? {} : { locale })}
                />
              </>
            )}
          </section>

          {/* Detail side pane (manifest `detail`, optional). */}
          {detailItem !== undefined && (
            <aside
              aria-label={t('ui:templates.common.detailLabel', 'Detail')}
              tabIndex={0}
              className="hidden w-1/3 min-w-64 max-w-96 shrink-0 overflow-y-auto lg:block"
            >
              {focusedRow === undefined ? (
                <div className="flex h-full flex-col justify-center rounded-lg border border-border bg-surface">
                  <EmptyState
                    compact
                    preset="no-data"
                    title={labels?.selectPrompt ?? t('ui:templates.queue.selectPrompt', 'Select a request')}
                    body={labels?.emptyBody ?? t('ui:templates.queue.selectBody', 'Choose an item to review its details.')}
                  />
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-surface" data-part="queue-detail-pane">
                  <header className="border-b border-border px-4 py-3">
                    <h3 className="truncate text-body-sm font-bold text-fg">
                      {cellText(focusedRow[fields.titleField]) ?? ''}
                    </h3>
                  </header>
                  <DetailKeyValue columns={detailSpecs} record={focusedRow} testId="queue-detail-record" />
                </div>
              )}
            </aside>
          )}
        </div>
      )}

      {/* Reject with reason — "the requester will be notified" (§7.4). */}
      <Modal open={rejectIds !== null} onOpenChange={(open) => !open && setRejectIds(null)} size="sm">
        <ModalHeader
          title={labels?.rejectTitle ?? t('ui:templates.queue.rejectTitle', 'Reject requests')}
          // Non-inflecting count form by design; override templates keep the
          // simple {count} substitution.
          subtitle={
            labels?.rejectCount !== undefined
              ? interpolate(labels.rejectCount, rejectIds?.length ?? 0)
              : t('ui:templates.queue.rejectCount', 'Selected · {count}', { count: rejectIds?.length ?? 0 })
          }
          closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
        />
        <ModalBody className="flex flex-col gap-2">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              labels?.rejectPlaceholder ?? t('ui:templates.queue.rejectPlaceholder', 'Add a note for the requester…')
            }
            rows={3}
            aria-label={t('ui:templates.queue.rejectReasonLabel', 'Rejection reason')}
          />
          <p className="text-caption text-fg-muted">
            {labels?.rejectNote ?? t('ui:templates.queue.rejectNote', 'The requester will be notified with your note.')}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setRejectIds(null)}>
            {labels?.cancel ?? t('ui:action.cancel', 'Cancel')}
          </Button>
          <Button variant="destructive" onClick={confirmReject}>
            {labels?.rejectConfirm ?? t('ui:widgets.domain.blockApproval.rejectLabel', 'Reject')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* aria-live keeps undo toasts reachable while the modal is open. */}
      <ToastStack
        {...queue.stackProps}
        aria-live="polite"
        dismissLabel={labels?.dismiss ?? t('ui:widgets.feeds.toastStack.dismissLabel', 'Dismiss')}
      />
    </div>
  );
}
