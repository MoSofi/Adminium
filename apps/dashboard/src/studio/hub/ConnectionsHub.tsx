// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio` — the connections manager hub (M5-T05, 09 §8.1, ported from
 * `Data Connections.dc.html` per the §5 checklist): stat tiles over
 * the fleet, one health card per connection (engine badge, status pill driven
 * by the persisted test-connection results, last-introspected relative time,
 * included-table + generated-page counts) and the manage actions — test,
 * re-introspect (with diff feedback), open the remap editor, pause/resume
 * (meta wave 0019), and the type-to-confirm delete (server re-enforces
 * `confirmName`, §2.4).
 */
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleCheckBig, Database, FileCode2, LayoutGrid, Pause, Play, Plus, RefreshCw, Table2 } from 'lucide-react';
import { getFormatters } from '@adminium/i18n';
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  IconTile,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MonoText,
  StatusPill,
  Tooltip,
} from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { PageActions } from '../../shell/PageActionsProvider.js';
import { PageSurface } from '../../shell/PageSurface.js';
import { studioApi, type ConnectionDto, type IntrospectResult } from '../api.js';
import { RegionalSettingsModal } from './RegionalSettingsModal.js';
import { RenameConnectionModal } from './RenameConnectionModal.js';

export function connectionsQuery() {
  return queryOptions({
    queryKey: ['studio', 'connections'] as const,
    queryFn: () => studioApi.listConnections(),
  });
}

/** Locale-bound Intl formatters, test-safe (wizardState.ts precedent). */
function fmt() {
  return getFormatters(getI18nInstance()?.language ?? 'en-US');
}

function engineLabel(engine: string): string {
  switch (engine) {
    case 'postgres':
      return t('studio.source.engine.postgres', 'PostgreSQL');
    case 'mysql':
      return t('studio.source.engine.mysql', 'MySQL / MariaDB');
    case 'sqlite':
      return t('studio.source.engine.sqlite', 'SQLite');
    default:
      return engine;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'connected':
      return t('studio.hub.status.connected', 'Connected');
    case 'error':
      return t('studio.hub.status.error', 'Error');
    default:
      return t('studio.hub.status.unconfigured', 'Draft');
  }
}

/** An `intervalMs` sleep that gives up the moment `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Terminal poll of an async introspection job (202 path).
 *
 * `signal` is checked at the top of every iteration and inside the sleep, the
 * same shape `waitForHealth` uses in studio/api.ts — the flag is read at the
 * loop boundary rather than threaded into `fetch`, because `app/api.ts` takes
 * no signal and one in-flight GET is not what this is about. What it is about:
 * without it the loop kept polling for up to ~2 minutes after the hub was gone,
 * ending in a toast about a screen the user had left.
 *
 * `aborted` is a THIRD outcome, not folded into `failed`. The job it was
 * watching is a server job and carries on; only the watching stopped. Calling
 * that a failure would put "Introspection failed. Try again." in front of
 * someone whose introspection is, at that moment, succeeding.
 */
async function awaitIntrospectJob(
  jobId: string,
  intervalMs: number,
  signal: AbortSignal,
): Promise<'succeeded' | 'failed' | 'aborted'> {
  // Bounded: ~2 min at the default interval — introspection budget (05 §10).
  for (let i = 0; i < 100; i += 1) {
    if (signal.aborted) return 'aborted';
    const job = await studioApi.getJob(jobId);
    if (job.status === 'succeeded') return 'succeeded';
    if (job.status === 'failed' || job.status === 'cancelled') return 'failed';
    await sleep(intervalMs, signal);
  }
  return 'failed';
}

// --- delete (shared with the Studio settings danger zone) ---------------------

export interface DeleteConnectionModalProps {
  connection: Pick<ConnectionDto, 'id' | 'name'> | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful server-side delete. */
  onDeleted: () => void;
}

/**
 * Type-to-confirm connection delete (the Settings/Workspace Settings comp
 * keeper): the danger button unlocks only when the exact connection name is
 * typed; the server independently re-checks `confirmName` and 409s otherwise.
 */
export function DeleteConnectionModal({ connection, onOpenChange, onDeleted }: DeleteConnectionModalProps) {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();

  if (connection === null) return null;
  return (
    <ConfirmModal
      open
      onOpenChange={onOpenChange}
      title={t('studio.hub.delete.title', 'Delete connection')}
      body={t(
        'studio.hub.delete.body',
        'This deletes “{name}” and its generated pages. Your database itself is never touched.',
        { name: connection.name },
      )}
      confirmWord={connection.name}
      promptLabel={t('studio.hub.delete.prompt', 'Type {name} to confirm', { name: connection.name })}
      confirmLabel={t('studio.hub.delete.confirm', 'Delete connection')}
      cancelLabel={t('studio.hub.delete.cancel', 'Cancel')}
      closeLabel={t('studio.hub.delete.close', 'Close')}
      onConfirm={async () => {
        try {
          await studioApi.deleteConnection(connection.id, connection.name);
          toasts.push({
            variant: 'success',
            title: t('studio.hub.delete.success', 'Connection “{name}” deleted', {
              name: connection.name,
            }),
          });
          // Nav shrinks with the pruned pages — refresh both caches.
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['studio', 'connections'] }),
            queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
          ]);
          onDeleted();
        } catch {
          toasts.push({
            variant: 'error',
            title: t('studio.hub.delete.failed', 'Could not delete the connection. Try again.'),
          });
        }
      }}
    />
  );
}

// --- pause / resume ------------------------------------------------------------

/**
 * The consequence dialog shown before a PAUSE — never before a resume.
 *
 * Not `ConfirmModal`: that component gates on typing the connection's name,
 * which is the right friction for a delete and the wrong friction here. A
 * pause is undone by one click, and making it as ceremonious as deletion is
 * how an operator ends up deleting a connection they only meant to switch off
 * for an afternoon.
 *
 * It is still a dialog rather than a bare button, because the blast radius is
 * not visible from the button: every generated page over this source stops
 * loading, and so do its scheduled reports, exports and hosted app surfaces —
 * none of which are on this screen.
 */
function PauseConnectionModal({
  connection,
  busy,
  onCancel,
  onConfirm,
}: {
  connection: ConnectionDto;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open
      size="sm"
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <ModalHeader
        icon={<Pause />}
        tone="warn"
        title={t('studio.hub.pause.title', 'Pause this connection?')}
        closeLabel={t('common.close', 'Close')}
      />
      <ModalBody>
        <p className="text-body-sm text-fg-muted">
          {t(
            'studio.hub.pause.body',
            'Adminium stops opening any connection to “{name}”. Its {pages, plural, one {# page} other {# pages}}, scheduled reports and hosted apps stop loading data until you resume it.',
            { name: connection.name, pages: connection.pageCount },
          )}
        </p>
        <p className="mt-2 text-body-sm text-fg-muted">
          {/* The reassurance that makes this the alternative to Delete rather
              than a milder version of it. */}
          {t(
            'studio.hub.pause.keeps',
            'Nothing is deleted — the connection, its schema and its {pages, plural, one {# page} other {# pages}} are all kept, and one click brings them back.',
            { pages: connection.pageCount },
          )}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" loading={busy} onClick={onConfirm}>
          {t('studio.hub.pause.confirm', 'Pause connection')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * A secondary action that reaches the source database — disabled, with the
 * reason attached, while the connection is paused.
 *
 * The disabled `<Button>` is wrapped in a `<span>` for the same reason the
 * schema-file case above is: a disabled button fires no pointer events, so the
 * tooltip would never open on the one control that needs to explain itself.
 */
function PausableAction({
  paused,
  label,
  icon,
  loading,
  onClick,
}: {
  paused: boolean;
  label: string;
  icon?: ReactNode;
  loading: boolean;
  onClick: () => void;
}) {
  if (paused) {
    return (
      <Tooltip
        content={t(
          'studio.hub.action.pausedHint',
          'This connection is paused — resume it to reach the database.',
        )}
      >
        <span className="inline-flex">
          <Button size="sm" variant="secondary" disabled>
            {icon}
            {label}
          </Button>
        </span>
      </Tooltip>
    );
  }
  return (
    <Button size="sm" variant="secondary" loading={loading} onClick={onClick}>
      {icon}
      {label}
    </Button>
  );
}

// --- per-connection card -------------------------------------------------------

interface ConnectionCardProps {
  connection: ConnectionDto;
  onOpenRemap: (connectionId: string) => void;
  onDelete: (connection: ConnectionDto) => void;
  pollIntervalMs: number;
}

function MetaCell({ label, children, mono = true }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-micro uppercase text-fg-subtle">{label}</div>
      <div className="mt-0.5 text-body-sm font-bold text-fg">
        {mono ? <MonoText>{children}</MonoText> : children}
      </div>
    </div>
  );
}

function ConnectionCard({ connection, onOpenRemap, onDelete, pollIntervalMs }: ConnectionCardProps) {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();

  const test = useMutation({
    mutationFn: () => studioApi.testConnection(connection.id),
    onSuccess: (result) => {
      toasts.push(
        result.ok
          ? {
              variant: 'success',
              title: t('studio.hub.test.ok', 'Connection healthy · {latency, number} ms', {
                latency: result.latencyMs,
              }),
            }
          : {
              variant: 'error',
              title: t('studio.hub.test.failed', 'Connection test failed'),
              // The hint is the actionable half (e.g. "use the unpooled host"),
              // so append it rather than showing the driver message alone.
              ...(result.error === null
                ? {}
                : {
                    description:
                      result.error.hint === null
                        ? result.error.message
                        : `${result.error.message} — ${result.error.hint}`,
                  }),
            },
      );
    },
    onError: () => {
      toasts.push({ variant: 'error', title: t('studio.hub.test.failed', 'Connection test failed') });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['studio', 'connections'] });
    },
  });

  /**
   * Aborted when this card unmounts, which stops the 202-path poll below.
   * Created per run rather than once: an `AbortController` is single-use, so a
   * second introspect after a first was cancelled needs its own.
   */
  const pollAbort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pollAbort.current?.abort();
    },
    [],
  );

  const introspect = useMutation({
    mutationFn: async (): Promise<{ outcome: 'noop' | 'updated' | 'failed' | 'aborted'; masks: number }> => {
      const result: IntrospectResult = await studioApi.introspect(connection.id);
      if (result.kind === 'done') {
        return { outcome: result.noop ? 'noop' : 'updated', masks: result.proposedMasks };
      }
      pollAbort.current?.abort();
      const controller = new AbortController();
      pollAbort.current = controller;
      const status = await awaitIntrospectJob(result.jobId, pollIntervalMs, controller.signal);
      if (status === 'aborted') return { outcome: 'aborted', masks: 0 };
      return { outcome: status === 'succeeded' ? 'updated' : 'failed', masks: 0 };
    },
    onSuccess: ({ outcome, masks }) => {
      // Nobody is watching: the card that started this is gone, and a toast for
      // it would arrive with no context. `onSettled` still invalidates the
      // connections query, so the snapshot is fresh the next time the hub opens.
      if (outcome === 'aborted') return;
      // Diff feedback (§8.2 analyze step): no-op vs a new snapshot (+ masks).
      if (outcome === 'noop') {
        toasts.push({
          variant: 'info',
          title: t('studio.hub.introspect.noChanges', 'Schema unchanged — no new snapshot.'),
        });
      } else if (outcome === 'updated') {
        toasts.push({
          variant: 'success',
          title: t('studio.hub.introspect.updated', 'Schema re-introspected'),
          ...(masks > 0
            ? {
                description: t(
                  'studio.hub.introspect.masksProposed',
                  '{count, plural, one {# column} other {# columns}} proposed for masking — review in the remap editor.',
                  { count: masks },
                ),
              }
            : {}),
        });
      } else {
        toasts.push({
          variant: 'error',
          title: t('studio.hub.introspect.failed', 'Introspection failed. Try again.'),
        });
      }
    },
    onError: () => {
      toasts.push({
        variant: 'error',
        title: t('studio.hub.introspect.failed', 'Introspection failed. Try again.'),
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['studio', 'connections'] });
    },
  });

  const [editingRegional, setEditingRegional] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingPause, setConfirmingPause] = useState(false);

  const setDisabled = useMutation({
    mutationFn: (disabled: boolean) => studioApi.patchConnection(connection.id, { disabled }),
    onSuccess: (updated) => {
      setConfirmingPause(false);
      toasts.push({
        variant: 'success',
        title: updated.disabled
          ? t('studio.hub.pause.pausedToast', 'Connection “{name}” paused', { name: connection.name })
          : t('studio.hub.pause.resumedToast', 'Connection “{name}” resumed', { name: connection.name }),
      });
    },
    onError: () => {
      toasts.push({
        variant: 'error',
        title: connection.disabled
          ? t('studio.hub.pause.resumeFailed', 'Could not resume the connection. Try again.')
          : t('studio.hub.pause.pauseFailed', 'Could not pause the connection. Try again.'),
      });
    },
    onSettled: async () => {
      // The nav shrinks and grows with what a paused source can serve, so the
      // bootstrap cache is invalidated alongside the hub's own.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['studio', 'connections'] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ]);
    },
  });

  const numbers = fmt();
  const lastIntrospected =
    connection.snapshot === null
      ? t('studio.hub.card.never', 'Never')
      : numbers.relative(connection.snapshot.createdAt);
  const isFile = connection.sourceKind === 'schema-file';
  const pausedAt = connection.disabledAt === null ? null : numbers.relative(connection.disabledAt);
  const pillStatus = test.isPending ? 'syncing' : connection.disabled ? 'paused' : connection.status;

  return (
    <Card
      padded
      data-testid={`connection-card-${connection.id}`}
      data-paused={connection.disabled ? 'true' : undefined}
      // Dimmed, not hidden: a paused source is still yours to see, and a card
      // that looked identical to a live one is how a pause gets forgotten.
      className={`flex flex-col gap-3.5${connection.disabled ? ' opacity-70' : ''}`}
    >
      <div className="flex items-start gap-3">
        <IconTile tone="accent" size="lg" icon={isFile ? <FileCode2 /> : <Database />} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-body font-bold text-fg">{connection.name}</h3>
            <Badge tone="neutral">{engineLabel(connection.engine)}</Badge>
            {connection.readOnly ? (
              <Badge tone="info">{t('studio.hub.card.readOnly', 'Read-only')}</Badge>
            ) : null}
          </div>
          {connection.dsnMasked === null ? null : (
            <MonoText className="mt-0.5 block truncate text-caption text-fg-subtle">
              {connection.dsnMasked}
            </MonoText>
          )}
        </div>
        {/* The pause OUTRANKS the health reading in the pill, because it is
            what decides whether anything is being served right now — but it
            does not replace it: the stored `status` is still rendered below
            when it says `error`, so "paused, and it was failing when you
            paused it" stays visible in one glance. */}
        <StatusPill status={pillStatus}>
          {test.isPending
            ? t('studio.hub.status.testing', 'Testing…')
            : connection.disabled
              ? t('studio.hub.status.paused', 'Paused')
              : statusLabel(connection.status)}
        </StatusPill>
      </div>

      {connection.disabled ? (
        <p role="status" className="text-caption text-fg-muted">
          {pausedAt === null
            ? t(
                'studio.hub.card.paused',
                'Adminium is not connecting to this database. Its pages load again when you resume it.',
              )
            : t(
                'studio.hub.card.pausedSince',
                'Paused {when} — Adminium is not connecting to this database. Its pages load again when you resume it.',
                { when: pausedAt },
              )}
        </p>
      ) : null}

      {connection.status === 'error' && connection.lastError !== null ? (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-caption text-danger">{connection.lastError}</p>
          {/* The driver message says what broke; the hint says what to do. */}
          {connection.lastErrorHint === null ? null : (
            <p className="text-caption text-fg-subtle">{connection.lastErrorHint}</p>
          )}
        </div>
      ) : null}

      <div className="flex items-start gap-5 border-t border-border pt-3">
        <MetaCell label={t('studio.hub.card.tables', 'Tables')}>
          {connection.tableCount === null ? '—' : numbers.number(connection.tableCount)}
        </MetaCell>
        <MetaCell label={t('studio.hub.card.pages', 'Pages')}>
          {numbers.number(connection.pageCount)}
        </MetaCell>
        <MetaCell label={t('studio.hub.card.latency', 'Latency')}>
          {connection.lastLatencyMs === null
            ? '—'
            : t('studio.hub.card.latencyMs', '{latency, number} ms', {
                latency: connection.lastLatencyMs,
              })}
        </MetaCell>
        <MetaCell label={t('studio.hub.card.lastIntrospected', 'Last introspected')} mono={false}>
          {lastIntrospected}
        </MetaCell>
        {/* Shown on the card because every date a hosted app surface renders
            is drawn through it, and because it is the one field here that can
            be a value nobody chose; currency only affects formatting and lives
            in the modal alone. */}
        <MetaCell label={t('studio.hub.card.timezone', 'Timezone')}>
          {connection.timezone ?? '—'}
          {connection.timezone !== null && connection.timezoneSource === 'host' ? (
            <>
              {' · '}
              <span className="text-fg-muted">
                {t('studio.hub.card.timezoneGuessed', 'from this server')}
              </span>
            </>
          ) : null}
        </MetaCell>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {/* Test and Re-introspect are the two actions that DIAL the source, so
            the pause takes them away — the server refuses both anyway (503
            CONNECTION_DISABLED), and a button that only produces an error is
            worse than one that explains itself. Remap and Regional settings
            read nothing but the meta store and stay available: a pause is for
            the database, not for the mapping work you can still do offline. */}
        {isFile ? null : (
          <PausableAction
            paused={connection.disabled}
            label={t('studio.hub.action.test', 'Test')}
            loading={test.isPending}
            onClick={() => test.mutate()}
          />
        )}
        {isFile ? (
          <Tooltip
            content={t(
              'studio.hub.action.reintrospectFile',
              'Schema-file sources have no live database — re-upload the file instead.',
            )}
          >
            <span className="inline-flex">
              <Button size="sm" variant="secondary" disabled>
                <RefreshCw aria-hidden className="size-3.5" />
                {t('studio.hub.action.reintrospect', 'Re-introspect')}
              </Button>
            </span>
          </Tooltip>
        ) : (
          <PausableAction
            paused={connection.disabled}
            label={t('studio.hub.action.reintrospect', 'Re-introspect')}
            icon={<RefreshCw aria-hidden className="size-3.5" />}
            loading={introspect.isPending}
            onClick={() => introspect.mutate()}
          />
        )}
        <Button size="sm" variant="secondary" onClick={() => onOpenRemap(connection.id)}>
          {t('studio.hub.action.remap', 'Remap schema')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setRenaming(true)}>
          {t('studio.hub.action.rename', 'Rename')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setEditingRegional(true)}>
          {t('studio.hub.action.regional', 'Regional settings')}
        </Button>
        {/* Resume is immediate; pausing asks first (see PauseConnectionModal). */}
        <Button
          size="sm"
          variant="secondary"
          className="ms-auto"
          loading={setDisabled.isPending}
          onClick={() => {
            if (connection.disabled) setDisabled.mutate(false);
            else setConfirmingPause(true);
          }}
        >
          {connection.disabled ? (
            <Play aria-hidden className="size-3.5" />
          ) : (
            <Pause aria-hidden className="size-3.5" />
          )}
          {connection.disabled
            ? t('studio.hub.action.resume', 'Resume')
            : t('studio.hub.action.pause', 'Pause')}
        </Button>
        <Button size="sm" variant="ghost" className="text-danger" onClick={() => onDelete(connection)}>
          {t('studio.hub.action.delete', 'Delete')}
        </Button>
      </div>

      {confirmingPause ? (
        <PauseConnectionModal
          connection={connection}
          busy={setDisabled.isPending}
          onCancel={() => setConfirmingPause(false)}
          onConfirm={() => setDisabled.mutate(true)}
        />
      ) : null}

      {renaming ? (
        <RenameConnectionModal
          connection={connection}
          onClose={() => setRenaming(false)}
          onSaved={async () => {
            /*
             * BOTH caches. The card reads the connections query; the sidebar
             * group over this connection's pages reads `bootstrap`. Refreshing
             * one leaves the other showing the old name, which reads as the
             * rename having failed.
             */
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['studio', 'connections'] }),
              queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
            ]);
            setRenaming(false);
            toasts.push({
              variant: 'success',
              title: t('studio.hub.rename.saved', 'Connection renamed'),
            });
          }}
        />
      ) : null}

      {editingRegional ? (
        <RegionalSettingsModal
          connection={connection}
          onClose={() => setEditingRegional(false)}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['studio', 'connections'] });
            setEditingRegional(false);
            toasts.push({
              variant: 'success',
              title: t('studio.hub.regional.saved', 'Regional settings updated'),
            });
          }}
        />
      ) : null}
    </Card>
  );
}

// --- stat tiles ------------------------------------------------------------------

function StatTile({ icon, tone, value, label }: { icon: ReactNode; tone: 'accent' | 'pos' | 'warn' | 'info'; value: string; label: string }) {
  return (
    <Card padded className="flex items-center gap-3">
      <IconTile tone={tone} size="md" icon={icon} />
      <div className="min-w-0">
        <div className="text-section text-fg">
          <MonoText>{value}</MonoText>
        </div>
        <div className="mt-0.5 text-caption text-fg-muted">{label}</div>
      </div>
    </Card>
  );
}

// --- page -----------------------------------------------------------------------

export interface ConnectionsHubProps {
  /** Router-injected navigation (routes.tsx wires useNavigate). */
  onConnectNew: () => void;
  onOpenRemap: (connectionId: string) => void;
  /** Opens `/studio/apps` (29-T17); optional so bare mounts stay valid. */
  onOpenHostedApps?: (() => void) | undefined;
  /** Introspection-job poll interval; tests pass 0. */
  pollIntervalMs?: number | undefined;
}

export function ConnectionsHub({
  onConnectNew,
  onOpenRemap,
  onOpenHostedApps,
  pollIntervalMs = 1200,
}: ConnectionsHubProps) {
  const { data: connections } = useSuspenseQuery(connectionsQuery());
  const [deleting, setDeleting] = useState<ConnectionDto | null>(null);

  const numbers = fmt();
  // A paused source is not healthy — it is serving nothing at all — so it
  // leaves the numerator. Counting it would put "3 of 3 healthy" above three
  // cards one of which says Paused.
  const healthy = connections.filter((c) => c.status === 'connected' && !c.disabled).length;
  const paused = connections.filter((c) => c.disabled).length;
  const tables = connections.reduce((sum, c) => sum + (c.tableCount ?? 0), 0);
  const pages = connections.reduce((sum, c) => sum + c.pageCount, 0);

  return (
    <PageSurface width="page" className="flex flex-col gap-4">
      <PageActions
        title={t('studio.hub.title', 'Data connections')}
        subtitle={
          // The paused count only appears when there IS one: a permanent
          // "· 0 paused" trains people to stop reading the line that will one
          // day be the only warning that production has been off for a week.
          paused === 0
            ? t(
                'studio.hub.subtitle',
                '{healthy, number} of {total, plural, one {# connection} other {# connections}} healthy',
                { healthy, total: connections.length },
              )
            : t(
                'studio.hub.subtitlePaused',
                '{healthy, number} of {total, plural, one {# connection} other {# connections}} healthy · {paused, number} paused',
                { healthy, total: connections.length, paused },
              )
        }
      >
        {onOpenHostedApps !== undefined && (
          <Button variant="secondary" onClick={onOpenHostedApps}>
            {t('studio.hub.hostedApps', 'Hosted apps')}
          </Button>
        )}
        <Button onClick={onConnectNew}>
          <Plus aria-hidden className="size-4" />
          {t('studio.hub.connectNew', 'New connection')}
        </Button>
      </PageActions>

      {connections.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Database />}
            title={t('studio.hub.empty.title', 'No data sources yet')}
            body={t('studio.hub.empty.body', 'Connect a database and Adminium generates your admin panel from its schema.')}
            actions={
              <Button onClick={onConnectNew}>
                {t('studio.hub.empty.cta', 'Connect a database')}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatTile
              icon={<Database />}
              tone="accent"
              value={numbers.number(connections.length)}
              label={t('studio.hub.stats.connections', 'Connections')}
            />
            <StatTile
              icon={<CircleCheckBig />}
              tone="pos"
              value={numbers.number(healthy)}
              label={t('studio.hub.stats.healthy', 'Healthy')}
            />
            <StatTile
              icon={<Table2 />}
              tone="warn"
              value={numbers.number(tables)}
              label={t('studio.hub.stats.tables', 'Tables included')}
            />
            <StatTile
              icon={<LayoutGrid />}
              tone="info"
              value={numbers.number(pages)}
              label={t('studio.hub.stats.pages', 'Generated pages')}
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                onOpenRemap={onOpenRemap}
                onDelete={setDeleting}
                pollIntervalMs={pollIntervalMs}
              />
            ))}
          </div>
        </>
      )}

      <DeleteConnectionModal
        connection={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onDeleted={() => setDeleting(null)}
      />
    </PageSurface>
  );
}
