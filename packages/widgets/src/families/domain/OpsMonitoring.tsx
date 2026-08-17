// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, Button, IconTile, MonoText } from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { Database, Play, RefreshCw, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  liveTimerConfigSchema,
  liveTimerDemoData,
  OPS_DEMO_NOW_MS,
  syncStatusCardConfigSchema,
  syncStatusCardDemoData,
} from './domain-ops-config.js';
import type { LiveTimerConfig, SyncStatusCardConfig } from './domain-ops-config.js';
import {
  booleanField,
  countField,
  formatCompact,
  formatCount,
  formatDuration,
  formatMs,
  formatStamp,
  instantField,
  labelField,
  oneOf,
  opsBindingSourceOf,
  opsRowOf,
  resolveNow,
} from './domain-ops-lib.js';
import type { SyncStatus, TimerState } from './domain-ops-types.js';
import { OpsEmpty } from './OpsEmpty.js';
import type { WidgetProps } from '../../registry/types.js';

export {
  liveTimerConfigSchema,
  liveTimerDemoData,
  syncStatusCardConfigSchema,
  syncStatusCardDemoData,
};
export type { LiveTimerConfig, SyncStatusCardConfig };

/**
 * TRACK OPS — the CONNECTION/CLOCK half of the annex §13 ops cards, grouped in
 * one module because both render a live state machine over an INJECTED clock and
 * share the same "now" discipline:
 *
 *   `sync-status-card`, `live-timer`.
 *
 * THE CLOCK POLICY, which is the whole reason these two sit together
 * (04 §7.7 / qa/determinism.test.ts):
 *
 *   Neither component reads the wall clock at MODULE or RENDER scope. "Now"
 *   resolves through `resolveNow(config.format.referenceTime, fallback)`, and the
 *   fallback is captured ONCE in lazy `useState` state — never recomputed per
 *   render, which would make every re-render a new timestamp and the component
 *   impossible to snapshot.
 *
 *   `live-timer` ticks, but only when nobody pinned the clock: a pinned
 *   `referenceTime` (demo, tests, VRT) means the readout is a pure function of
 *   config + data, so the interval is never even started. That is the difference
 *   between a stopwatch that is deterministic under test and one that is merely
 *   deterministic-ish.
 *
 * NEITHER WRITES: the annex's "stop auto-creates a time entry" and "Sync now"
 * both emit intents through `onEvent` and the host runs them through the CRUD
 * API with undo + audit (04 §2.1). Unbound → no affordance is rendered: there is
 * nowhere to send the intent, and a Stop that silently drops the run is worse
 * than no button.
 */

// ── sync-status-card ────────────────────────────────────────────────────────

export interface SyncStatusCardViewProps {
  status: SyncStatus;
  locale?: string | undefined;
  syncAction?: string | undefined;
  connectedLabel?: string | undefined;
  disconnectedLabel?: string | undefined;
  rowsSyncedLabel?: string | undefined;
  tablesLabel?: string | undefined;
  lastSyncLabel?: string | undefined;
  nextSyncLabel?: string | undefined;
  syncingLabel?: string | undefined;
  onSync?: (() => void) | undefined;
  testId?: string | undefined;
}

export function SyncStatusCardView({
  status,
  locale,
  syncAction,
  connectedLabel,
  disconnectedLabel,
  rowsSyncedLabel,
  tablesLabel,
  lastSyncLabel,
  nextSyncLabel,
  syncingLabel,
  onSync,
  testId,
}: SyncStatusCardViewProps) {
  const t = useMaybeT();
  const syncing = status.phase === 'syncing';
  const tone = status.connected ? (status.phase === 'failed' ? 'danger' : 'pos') : 'danger';
  const last = formatStamp(status.lastSync, locale);
  const next = formatStamp(status.nextSync, locale);
  const resolvedConnected = connectedLabel ?? t('ui:widgets.domain.syncStatusCard.connectedLabel', 'Connected');

  return (
    <div
      data-widget="sync-status-card"
      data-testid={testId}
      data-phase={status.phase}
      className="flex h-full flex-col gap-3 overflow-auto px-[var(--widget-pad)] pb-[var(--widget-pad)]"
    >
      <div className="flex items-start gap-2.5">
        <IconTile tone={tone} size="sm" icon={<Database />} />
        <div className="min-w-0 flex-1">
          <MonoText className="block truncate text-body-sm font-bold text-fg">{status.name}</MonoText>
          {status.engine === undefined ? null : (
            <p className="truncate text-caption text-fg-subtle">{status.engine}</p>
          )}
        </div>
        <Badge tone={tone} dot data-part="sync-connection">
          {/*
            The annex's "Connected · 42ms" — latency is a PROPERTY of a live
            connection, so it is appended only while connected. A disconnected
            card claiming "42ms" would be reporting a stale probe as current.
          */}
          {status.connected
            ? status.latencyMs === undefined
              ? resolvedConnected
              : `${resolvedConnected} · ${formatMs(status.latencyMs, locale)}`
            : (disconnectedLabel ?? t('ui:widgets.domain.syncStatusCard.disconnectedLabel', 'Disconnected'))}
        </Badge>
      </div>

      <div>
        <MonoText data-part="sync-rows" className="text-h2 font-bold tabular-nums text-fg">
          {formatCompact(status.rowsSynced, locale)}
        </MonoText>
        <p className="text-caption text-fg-subtle">{rowsSyncedLabel ?? t('ui:widgets.domain.syncStatusCard.rowsSyncedLabel', 'Rows synced')}</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-caption">
        <div>
          <dt className="text-fg-subtle">{tablesLabel ?? t('ui:widgets.domain.syncStatusCard.tablesLabel', 'Tables')}</dt>
          <dd>
            <MonoText className="font-semibold text-fg">{formatCount(status.tables, locale)}</MonoText>
          </dd>
        </div>
        {last === undefined ? null : (
          <div className="min-w-0">
            <dt className="text-fg-subtle">{lastSyncLabel ?? t('ui:widgets.domain.syncStatusCard.lastSyncLabel', 'Last sync')}</dt>
            <dd className="truncate text-fg">{last}</dd>
          </div>
        )}
        {next === undefined ? null : (
          <div className="min-w-0">
            <dt className="text-fg-subtle">{nextSyncLabel ?? t('ui:widgets.domain.syncStatusCard.nextSyncLabel', 'Next sync')}</dt>
            <dd className="truncate text-fg">{next}</dd>
          </div>
        )}
      </dl>

      {onSync === undefined ? null : (
        <Button
          variant="secondary"
          size="sm"
          className="mt-auto self-start"
          data-part="sync-now"
          disabled={syncing}
          iconLeft={<RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />}
          onClick={onSync}
        >
          {syncing
            ? (syncingLabel ?? t('ui:widgets.domain.syncStatusCard.syncingLabel', 'Syncing…'))
            : (syncAction ?? t('ui:widgets.domain.syncStatusCard.syncActionLabel', 'Sync now'))}
        </Button>
      )}
    </div>
  );
}

/** Project the bound `record` onto the sync model (config-driven columns). */
function syncStatusOf(config: SyncStatusCardConfig, data: unknown): SyncStatus | null {
  const row = opsRowOf(data);
  if (row === null) return null;
  return {
    name: labelField(row, config.nameField, 'Connection'),
    engine: row[config.engineField] === undefined ? undefined : labelField(row, config.engineField, ''),
    // Absent column → assume connected: the card binds a connection the host
    // just queried, so "no `connected` column" means the table does not track
    // it, not that the database is down.
    connected: booleanField(row, config.connectedField) ?? true,
    latencyMs: row[config.latencyField] === undefined ? undefined : countField(row, config.latencyField, 0),
    rowsSynced: countField(row, config.rowsSyncedField, 0),
    tables: countField(row, config.tablesField, 0),
    lastSync: instantField(row, config.lastSyncField),
    nextSync: instantField(row, config.nextSyncField),
    phase: oneOf(row[config.phaseField], ['idle', 'syncing', 'synced', 'failed'] as const, 'idle'),
  };
}

export function SyncStatusCardWidget({ config, data, onEvent }: WidgetProps<SyncStatusCardConfig>) {
  const t = useMaybeT();
  const status = useMemo(() => syncStatusOf(config, data), [config, data]);
  const source = useMemo(() => opsBindingSourceOf(config.binding), [config.binding]);

  if (status === null) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.syncStatusCard.emptyTitle', 'No connection')}
        body={config.emptyBody ?? t('ui:widgets.domain.syncStatusCard.emptyBody', 'Bind a connection row to show its sync status.')}
      />
    );
  }

  return (
    <SyncStatusCardView
      status={status}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.syncAction === undefined ? {} : { syncAction: config.syncAction })}
      {...(config.connectedLabel === undefined ? {} : { connectedLabel: config.connectedLabel })}
      {...(config.disconnectedLabel === undefined ? {} : { disconnectedLabel: config.disconnectedLabel })}
      {...(config.rowsSyncedLabel === undefined ? {} : { rowsSyncedLabel: config.rowsSyncedLabel })}
      {...(config.tablesLabel === undefined ? {} : { tablesLabel: config.tablesLabel })}
      {...(config.lastSyncLabel === undefined ? {} : { lastSyncLabel: config.lastSyncLabel })}
      {...(config.nextSyncLabel === undefined ? {} : { nextSyncLabel: config.nextSyncLabel })}
      {...(config.syncingLabel === undefined ? {} : { syncingLabel: config.syncingLabel })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      {...(source === null
        ? {}
        : {
            onSync: () =>
              void onEvent({
                type: 'mutate',
                intent: 'update',
                connectionId: source.connectionId,
                table: source.table,
                values: { phase: 'syncing' },
              }),
          })}
    />
  );
}

// ── live-timer ──────────────────────────────────────────────────────────────

export interface LiveTimerViewProps {
  timer: TimerState;
  /** Epoch ms "now" the readout is computed against. NEVER read from the clock here. */
  now: number;
  locale?: string | undefined;
  startLabel?: string | undefined;
  stopLabel?: string | undefined;
  taskPlaceholder?: string | undefined;
  onStart?: (() => void) | undefined;
  onStop?: ((seconds: number) => void) | undefined;
  testId?: string | undefined;
}

/**
 * Total elapsed seconds: the paused total plus the current run. PURE in `now` —
 * this function is what the tick re-invokes, and it is why the readout is a
 * function of injected state rather than of when React happened to render.
 */
export function timerSeconds(timer: TimerState, now: number): number {
  if (!timer.running || timer.startedAt === undefined) return Math.max(0, timer.elapsed);
  // A `startedAt` in the FUTURE (clock skew between the DB and the browser, or a
  // row written by a server an hour ahead) would otherwise subtract from the
  // paused total and render a stopwatch running backwards.
  const run = Math.max(0, (now - timer.startedAt) / 1000);
  return Math.max(0, timer.elapsed + run);
}

export function LiveTimerView({
  timer,
  now,
  locale,
  startLabel,
  stopLabel,
  taskPlaceholder,
  onStart,
  onStop,
  testId,
}: LiveTimerViewProps) {
  const t = useMaybeT();
  const seconds = timerSeconds(timer, now);
  /*
    The annex's "running state restyles card (accent→danger, play→square)".
    `Button` carries no `tone` — the accent/danger axis is its `variant`, so the
    restyle is primary (accent) → destructive (danger).
  */
  const variant = timer.running ? 'destructive' : 'primary';

  return (
    <div
      data-widget="live-timer"
      data-testid={testId}
      data-running={timer.running ? '' : undefined}
      className="flex h-full flex-col justify-center gap-3 px-[var(--widget-pad)] pb-[var(--widget-pad)] sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-semibold text-fg" data-part="timer-task">
          {timer.taskName === ''
            ? (taskPlaceholder ?? t('ui:widgets.domain.liveTimer.taskPlaceholder', 'Untitled task'))
            : timer.taskName}
        </p>
        {timer.project === undefined ? null : (
          <Badge tone="neutral" className="mt-0.5" data-part="timer-project">
            {timer.project}
          </Badge>
        )}
      </div>

      {/*
        `aria-live="off"`: a stopwatch that announced every second would make the
        page unusable with a screen reader. The value stays readable on demand —
        it is plain text in the accessibility tree — and the START/STOP buttons
        announce the state changes that actually matter.
      */}
      <MonoText
        data-part="timer-readout"
        aria-live="off"
        className={`text-h1 font-bold tabular-nums ${timer.running ? 'text-danger' : 'text-fg'}`}
      >
        {formatDuration(seconds, locale)}
      </MonoText>

      {timer.running
        ? onStop === undefined
          ? null
          : (
              <Button
                variant={variant}
                size="sm"
                data-part="timer-stop"
                iconLeft={<Square className="size-3.5" />}
                onClick={() => onStop(Math.floor(seconds))}
              >
                {stopLabel ?? t('ui:widgets.domain.liveTimer.stopLabel', 'Stop')}
              </Button>
            )
        : onStart === undefined
          ? null
          : (
              <Button
                variant={variant}
                size="sm"
                data-part="timer-start"
                iconLeft={<Play className="size-3.5" />}
                onClick={onStart}
              >
                {startLabel ?? t('ui:widgets.domain.liveTimer.startLabel', 'Start')}
              </Button>
            )}
    </div>
  );
}

/** Project the bound `record` onto the timer model (config-driven columns). */
function timerOf(config: LiveTimerConfig, data: unknown): TimerState | null {
  const row = opsRowOf(data);
  if (row === null) return null;
  return {
    taskName: labelField(row, config.taskField, ''),
    project: row[config.projectField] === undefined ? undefined : labelField(row, config.projectField, ''),
    running: booleanField(row, config.runningField) ?? false,
    elapsed: countField(row, config.elapsedField, 0),
    startedAt: instantField(row, config.startedAtField),
  };
}

/**
 * The 1s tick — and the reason it is a hook rather than an inline interval.
 *
 * `pinned` (a `format.referenceTime`) means the host wants a FIXED instant:
 * demo payloads, unit tests and VRT captures all pin it, and under a pin the
 * readout must be a pure function of config + data. So the interval is not
 * started at all — not started-and-ignored, which would still schedule timers in
 * every test that mounts this widget and leak them across cases.
 *
 * It also does not run while STOPPED: a paused stopwatch's readout cannot change,
 * so ticking it would be pure wakeups for an unchanging number.
 */
function useTimerNow(pinned: number | undefined, running: boolean, fallback: number): number {
  const [tick, setTick] = useState(fallback);

  useEffect(() => {
    if (pinned !== undefined || !running) return undefined;
    // Seeded immediately so the first paint after mount reflects the real clock
    // rather than the demo-epoch fallback for a whole second.
    setTick(Date.now());
    const handle = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [pinned, running]);

  return resolveNow(pinned, tick);
}

export function LiveTimerWidget({ config, data, onEvent }: WidgetProps<LiveTimerConfig>) {
  const t = useMaybeT();
  const timer = useMemo(() => timerOf(config, data), [config, data]);
  const source = useMemo(() => opsBindingSourceOf(config.binding), [config.binding]);
  const now = useTimerNow(config.format?.referenceTime, timer?.running ?? false, OPS_DEMO_NOW_MS);

  if (timer === null) {
    return (
      <OpsEmpty
        title={config.emptyTitle ?? t('ui:widgets.domain.liveTimer.emptyTitle', 'No timer')}
        body={config.emptyBody ?? t('ui:widgets.domain.liveTimer.emptyBody', 'Bind a time-entry row with a task and a duration column.')}
      />
    );
  }

  return (
    <LiveTimerView
      timer={timer}
      now={now}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.startLabel === undefined ? {} : { startLabel: config.startLabel })}
      {...(config.stopLabel === undefined ? {} : { stopLabel: config.stopLabel })}
      {...(config.taskPlaceholder === undefined ? {} : { taskPlaceholder: config.taskPlaceholder })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      {...(source === null
        ? {}
        : {
            onStart: () =>
              void onEvent({
                type: 'mutate',
                intent: 'update',
                connectionId: source.connectionId,
                table: source.table,
                values: { [config.runningField]: true, [config.startedAtField]: now },
              }),
            /*
              The annex's "stop auto-creates a time entry" — an INSERT, not an
              update: the row this widget binds is the running stopwatch, and the
              entry it produces is a new record in the log.

              `minSeconds` (annex) discards a too-short run rather than saving it:
              a mis-click that logs a 2-second entry is noise a user then has to
              clean up. The stopwatch still resets — the intent below always
              clears the running flag — so a discarded run does not leave the
              timer stuck on.
            */
            onStop: (seconds: number) => {
              if (seconds >= config.minSeconds) {
                void onEvent({
                  type: 'mutate',
                  intent: 'insert',
                  connectionId: source.connectionId,
                  table: source.table,
                  values: {
                    [config.taskField]: timer.taskName,
                    ...(timer.project === undefined ? {} : { [config.projectField]: timer.project }),
                    [config.elapsedField]: seconds,
                    billable: config.defaultBillable,
                  },
                });
              }
              void onEvent({
                type: 'mutate',
                intent: 'update',
                connectionId: source.connectionId,
                table: source.table,
                values: { [config.runningField]: false, [config.elapsedField]: 0 },
              });
            },
          })}
    />
  );
}
