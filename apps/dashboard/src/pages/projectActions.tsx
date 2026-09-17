// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PROJECT ACTIONS: buttons a project's own code defines (`actions/*.ts`),
 * shown on the record page, in a table's row menu and, for `bulk` actions, in
 * the bulk bar.
 *
 * The server lists only the actions the signed-in person may run, and a
 * server that runs no project answers with none, so a page with no actions
 * draws exactly what it drew before. An action's label, question and message
 * are the project's own text and are shown as they are.
 *
 * Shapes mirror `apps/server/src/routes/project/index.ts`; change both
 * together.
 */

import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  IconButton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  pascalCaseIconName,
  type IconName,
} from '@adminium/ui';
import { Zap } from 'lucide-react';

import { api, ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';
import { useAppToasts } from './toasts.js';

export interface ProjectActionDto {
  id: string;
  label: string;
  /** A Lucide icon name in kebab case, such as `undo-2`. */
  icon: string | null;
  confirm: string | null;
  bulk: boolean;
  permission: 'read' | 'create' | 'update' | 'delete';
  database: string;
  connectionId: string;
  table: string;
}

export interface ProjectActionResult {
  message: string | null;
  refresh: boolean;
}

export const PROJECT_ACTIONS_QUERY_KEY = ['project', 'actions'] as const;

export function projectActionsQuery() {
  return queryOptions({
    queryKey: PROJECT_ACTIONS_QUERY_KEY,
    queryFn: async (): Promise<ProjectActionDto[]> => {
      try {
        const reply = await api.get<{ data: ProjectActionDto[] }>('/api/v1/project/actions');
        return reply.data;
      } catch (error) {
        // A server that runs no project has no `/project` routes.
        if (error instanceof ApiError && error.status === 404) return [];
        throw error;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export async function runProjectAction(
  action: ProjectActionDto,
  ids: readonly (string | number)[],
): Promise<ProjectActionResult> {
  const reply = await api.post<{ data: ProjectActionResult }>(
    `/api/v1/project/actions/${encodeURIComponent(action.id)}`,
    { database: action.database, table: action.table, ids },
  );
  return reply.data;
}

function ActionIcon({ name }: { name: string | null }) {
  if (name === null) return <Zap className="size-3.5" aria-hidden />;
  return <Icon name={pascalCaseIconName(name) as IconName} size={14} aria-hidden />;
}

interface PendingRun {
  action: ProjectActionDto;
  ids: readonly (string | number)[];
}

export interface ProjectActionsForTable {
  /** Actions for one record. */
  record: readonly ProjectActionDto[];
  /** Actions that also run on several selected records. */
  bulk: readonly ProjectActionDto[];
  /** Ask first when the action has a question, then run it. */
  start: (action: ProjectActionDto, ids: readonly (string | number)[]) => void;
  busy: boolean;
  /** The question dialog; render it once, anywhere on the page. */
  dialog: ReactNode;
}

/**
 * The project actions for one table, and everything needed to run them:
 * the question, the call, the toast, and a refresh of the page's data.
 */
export function useProjectActions(
  connectionId: string | null | undefined,
  table: string | null | undefined,
  onRefresh?: () => void,
): ProjectActionsForTable {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const { data } = useQuery({ ...projectActionsQuery(), enabled: connectionId != null && table != null });
  const [pending, setPending] = useState<PendingRun | null>(null);
  const [busy, setBusy] = useState(false);

  const record = useMemo(
    () => (data ?? []).filter((action) => action.connectionId === connectionId && action.table === table),
    [data, connectionId, table],
  );
  const bulk = useMemo(() => record.filter((action) => action.bulk), [record]);

  const run = useCallback(
    async ({ action, ids }: PendingRun): Promise<void> => {
      setBusy(true);
      try {
        const result = await runProjectAction(action, ids);
        toasts.push({
          variant: 'success',
          title: result.message ?? t('projectAction.done', '{label}: done', { label: action.label }),
        });
        if (result.refresh) {
          void queryClient.invalidateQueries({ queryKey: ['data', action.connectionId, action.table] });
          void queryClient.invalidateQueries({ queryKey: ['widget-data'] });
          onRefresh?.();
        }
      } catch (error) {
        toasts.push({
          variant: 'error',
          title: t('projectAction.failed', '{label} did not finish', { label: action.label }),
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setBusy(false);
      }
    },
    [queryClient, toasts, onRefresh],
  );

  const start = useCallback(
    (action: ProjectActionDto, ids: readonly (string | number)[]) => {
      if (ids.length === 0) return;
      if (action.confirm === null) {
        void run({ action, ids });
        return;
      }
      setPending({ action, ids });
    },
    [run],
  );

  const dialog =
    pending === null ? null : (
      <Modal
        open
        size="sm"
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <ModalHeader title={pending.action.label} closeLabel={t('common.close', 'Close')} />
        <ModalBody>
          <p className="text-body text-fg-muted">{pending.action.confirm}</p>
          {pending.ids.length > 1 ? (
            <p className="mt-2 text-caption text-fg-subtle">
              {t('projectAction.selected', '{count, plural, one {# record} other {# records}}', {
                count: pending.ids.length,
              })}
            </p>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setPending(null)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            data-testid="project-action-confirm"
            onClick={() => {
              const next = pending;
              setPending(null);
              void run(next);
            }}
          >
            {t('projectAction.run', 'Run')}
          </Button>
        </ModalFooter>
      </Modal>
    );

  return { record, bulk, start, busy, dialog };
}

/** One button per action, for the record page's action bar. */
export function ProjectActionButtons({
  actions,
  id,
}: {
  actions: ProjectActionsForTable;
  id: string | number;
}) {
  return (
    <>
      {actions.record.map((action) => (
        <Button
          key={action.id}
          size="sm"
          variant="secondary"
          iconLeft={<ActionIcon name={action.icon} />}
          disabled={actions.busy}
          data-testid={`project-action-${action.id}`}
          onClick={() => actions.start(action, [id])}
        >
          {action.label}
        </Button>
      ))}
    </>
  );
}

/** The project actions of one row, in a small menu beside the row's own controls. */
export function ProjectActionMenu({
  actions,
  id,
}: {
  actions: ProjectActionsForTable;
  id: string | number;
}) {
  if (actions.record.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" variant="ghost" label={t('projectAction.menu', 'Actions')} disabled={actions.busy}>
          <Zap className="size-3.5" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.record.map((action) => (
          <DropdownMenuItem
            key={action.id}
            icon={<ActionIcon name={action.icon} />}
            data-testid={`project-action-${action.id}`}
            onSelect={() => actions.start(action, [id])}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
