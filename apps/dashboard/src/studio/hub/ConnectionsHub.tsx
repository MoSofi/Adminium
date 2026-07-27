/**
 * `/studio` — the connections manager hub (M5-T05, 09 §8.1, ported from
 * `Data Connections.dc.html` per the §5 checklist): stat tiles over
 * the fleet, one health card per connection (engine badge, status pill driven
 * by the persisted test-connection results, last-introspected relative time,
 * included-table + generated-page counts) and the manage actions — test,
 * re-introspect (with diff feedback), open the remap editor, and the
 * type-to-confirm delete (server re-enforces `confirmName`, §2.4).
 */
import { queryOptions, useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { CircleCheckBig, Database, FileCode2, LayoutGrid, Plus, RefreshCw, Table2 } from 'lucide-react';
import { getFormatters } from '@adminium/i18n';
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  EmptyState,
  IconTile,
  MonoText,
  StatusPill,
  Tooltip,
} from '@adminium/ui';

import { getI18nInstance, t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { studioApi, type ConnectionDto, type IntrospectResult } from '../api.js';

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

/** Terminal poll of an async introspection job (202 path). */
async function awaitIntrospectJob(jobId: string, intervalMs: number): Promise<'succeeded' | 'failed'> {
  // Bounded: ~2 min at the default interval — introspection budget (05 §10).
  for (let i = 0; i < 100; i += 1) {
    const job = await studioApi.getJob(jobId);
    if (job.status === 'succeeded') return 'succeeded';
    if (job.status === 'failed' || job.status === 'cancelled') return 'failed';
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
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

  const introspect = useMutation({
    mutationFn: async (): Promise<{ outcome: 'noop' | 'updated' | 'failed'; masks: number }> => {
      const result: IntrospectResult = await studioApi.introspect(connection.id);
      if (result.kind === 'done') {
        return { outcome: result.noop ? 'noop' : 'updated', masks: result.proposedMasks };
      }
      const status = await awaitIntrospectJob(result.jobId, pollIntervalMs);
      return { outcome: status === 'succeeded' ? 'updated' : 'failed', masks: 0 };
    },
    onSuccess: ({ outcome, masks }) => {
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

  const numbers = fmt();
  const lastIntrospected =
    connection.snapshot === null
      ? t('studio.hub.card.never', 'Never')
      : numbers.relative(connection.snapshot.createdAt);
  const isFile = connection.sourceKind === 'schema-file';

  return (
    <Card padded data-testid={`connection-card-${connection.id}`} className="flex flex-col gap-3.5">
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
        <StatusPill status={test.isPending ? 'syncing' : connection.status}>
          {test.isPending ? t('studio.hub.status.testing', 'Testing…') : statusLabel(connection.status)}
        </StatusPill>
      </div>

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
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {isFile ? null : (
          <Button size="sm" variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
            {t('studio.hub.action.test', 'Test')}
          </Button>
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
          <Button
            size="sm"
            variant="secondary"
            loading={introspect.isPending}
            onClick={() => introspect.mutate()}
          >
            <RefreshCw aria-hidden className="size-3.5" />
            {t('studio.hub.action.reintrospect', 'Re-introspect')}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => onOpenRemap(connection.id)}>
          {t('studio.hub.action.remap', 'Remap schema')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto text-danger"
          onClick={() => onDelete(connection)}
        >
          {t('studio.hub.action.delete', 'Delete')}
        </Button>
      </div>
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
  /** Introspection-job poll interval; tests pass 0. */
  pollIntervalMs?: number | undefined;
}

export function ConnectionsHub({ onConnectNew, onOpenRemap, pollIntervalMs = 1200 }: ConnectionsHubProps) {
  const { data: connections } = useSuspenseQuery(connectionsQuery());
  const [deleting, setDeleting] = useState<ConnectionDto | null>(null);

  const numbers = fmt();
  const healthy = connections.filter((c) => c.status === 'connected').length;
  const tables = connections.reduce((sum, c) => sum + (c.tableCount ?? 0), 0);
  const pages = connections.reduce((sum, c) => sum + c.pageCount, 0);

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4 p-6">
      <header className="flex items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-page-title text-fg">{t('studio.hub.title', 'Data connections')}</h1>
          <p className="mt-0.5 text-body-sm text-fg-muted">
            {t(
              'studio.hub.subtitle',
              '{healthy, number} of {total, plural, one {# connection} other {# connections}} healthy',
              { healthy, total: connections.length },
            )}
          </p>
        </div>
        <Button className="ms-auto" onClick={onConnectNew}>
          <Plus aria-hidden className="size-4" />
          {t('studio.hub.connectNew', 'New connection')}
        </Button>
      </header>

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

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
    </div>
  );
}
