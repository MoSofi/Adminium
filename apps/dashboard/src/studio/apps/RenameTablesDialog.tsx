// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Renaming an old install's tables to its app's prefix, ported from
 * `Installed Apps.dc.html`'s Rename tables dialog.
 *
 * An install made before its app was prefixed keeps the plain names it made or
 * found (`menu_items`). This gives every one of them the prefix
 * (`pos_menu_items`), so the app can tell its own tables apart. The list is
 * every table the rename moves, read from the server — the comp draws a fixed
 * six, which the feature's own words ("every table") contradict.
 *
 * It is the schema editor's rename underneath, so what the server plans is
 * what runs: a refusal stops the button, and a database that changed since
 * the plan was read answers SCHEMA_DRIFT and the plan is read again.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MonoText,
  Spinner,
} from '@adminium/ui';
import { ArrowRight, Wand2 } from 'lucide-react';

import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import { connectionsQuery } from '../hub/ConnectionsHub.js';
import {
  APPS_QUERY_KEY,
  planRenameTables,
  renameTables,
  type InstalledApp,
} from './appsApi.js';
import { SURFACES_QUERY_KEY } from './hostedAppsApi.js';

export interface RenameTablesDialogProps {
  app: InstalledApp & { oldTableNames: { prefix: string; count: number } };
  onClose: () => void;
  /** Told once the tables have their new names. */
  onRenamed: (prefix: string) => void;
}

export function RenameTablesDialog({ app, onClose, onRenamed }: RenameTablesDialogProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ['app-rename-tables', app.key] as const,
    queryFn: () => planRenameTables(app.key),
    retry: false,
    // Always the database as it is now, never a plan read earlier.
    staleTime: 0,
    gcTime: 0,
  });
  const connections = useQuery(connectionsQuery());
  const connectionName =
    connections.data?.find((connection) => connection.id === app.connectionId)?.name ?? app.connectionId ?? '';

  const rename = useMutation({
    mutationFn: () => {
      if (preview.data === undefined) throw new Error('no plan');
      return renameTables(app.key, preview.data.plan.checksum);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: APPS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: SURFACES_QUERY_KEY });
      // The sidebar and pages read the tables by their new names.
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
      onRenamed(result.prefix);
    },
    onError: (cause: Error) => {
      setError(cause.message);
      // The plan on screen no longer describes the database: read it again.
      if (cause instanceof ApiError && cause.code === 'SCHEMA_DRIFT') void preview.refetch();
    },
  });

  const plan = preview.data?.plan;
  const refusals = plan?.refusals ?? [];
  const tables = preview.data?.tables ?? [];
  const prefix = app.oldTableNames.prefix;

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !rename.isPending) onClose();
      }}
    >
      <ModalHeader
        icon={<Wand2 />}
        title={t('studio:hostedApps.rename.title', 'Rename tables to {prefix}…', { prefix })}
        subtitle={t(
          'studio:hostedApps.rename.subtitle',
          '{count, plural, one {# table in {connection}} other {# tables in {connection}}}',
          { count: preview.data?.tables.length ?? app.oldTableNames.count, connection: connectionName },
        )}
        closeLabel={t('studio:hostedApps.rename.close', 'Close')}
      />
      <ModalBody>
        <div className="flex flex-col gap-3.5">
          <p className="text-[13px] leading-[1.55] text-fg-muted">
            {t(
              'studio:hostedApps.rename.body',
              'This install was made before prefixes. Renaming gives every table the app’s prefix, so {app} can recognise its own tables.',
              { app: app.key },
            )}
          </p>

          {preview.isPending ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : null}

          {preview.error === null ? null : (
            <Alert tone="danger" title={t('studio:hostedApps.rename.planFailed', 'The rename could not be planned')}>
              {preview.error.message}
            </Alert>
          )}

          {tables.length === 0 ? null : (
            <ul data-testid="rename-tables" className="overflow-hidden rounded-[12px] border border-border">
              {tables.map((table) => (
                <li
                  key={table.ref}
                  className="grid grid-cols-[minmax(0,1fr)_22px_minmax(0,1fr)] items-center gap-2.5 border-b border-border px-3.5 py-2.5 last:border-b-0"
                >
                  <MonoText className="truncate text-[12.5px] text-fg-muted">{table.from}</MonoText>
                  <ArrowRight aria-hidden className="size-[15px] text-fg-subtle rtl:-scale-x-100" />
                  <MonoText className="truncate text-[12.5px] font-bold">{table.to}</MonoText>
                </li>
              ))}
            </ul>
          )}

          {refusals.length === 0 ? null : (
            <Alert tone="danger" title={t('studio:hostedApps.rename.refused', 'These tables cannot be renamed here')}>
              <ul className="list-disc ps-5">
                {refusals.map((refusal) => (
                  <li key={`${refusal.code}:${refusal.table ?? ''}:${refusal.message}`}>{refusal.message}</li>
                ))}
              </ul>
            </Alert>
          )}

          {error === null ? null : (
            <Alert tone="danger" title={t('studio:hostedApps.rename.failed', 'The tables were not renamed')}>
              {error}
            </Alert>
          )}

          <div className="flex gap-[11px] rounded-[12px] bg-accent-soft px-[15px] py-[13px]">
            <Wand2 aria-hidden className="mt-px size-[17px] shrink-0 text-accent" />
            <p className="text-[12.5px] leading-[1.5] text-fg-muted">
              {t(
                'studio:hostedApps.rename.repair',
                'Adminium also updates its own pages and rules that point at the old names.',
              )}
            </p>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={rename.isPending} onClick={onClose}>
          {t('studio:hostedApps.rename.cancel', 'Cancel')}
        </Button>
        <Button
          disabled={plan === undefined || refusals.length > 0 || rename.isPending || preview.isFetching}
          onClick={() => {
            setError(null);
            rename.mutate();
          }}
        >
          {rename.isPending ? <Spinner size="sm" /> : <Wand2 aria-hidden className="size-4" />}
          {t('studio:hostedApps.rename.confirm', 'Rename tables')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
