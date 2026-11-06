// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Workspaces card of Data connections (`Workspaces.dc.html`, its managing board): one row
 * per workspace (its tile, name, "{n} databases · their names", Save
 * workspace, Sender, Rename and Delete), "Other databases" last with its lock
 * line, and New workspace.
 *
 * Save workspace's "More choices" opens Save as app's own wizard over the
 * dialog, on that database, and hands its choices back to the dialog's row.
 *
 * Rows reorder by dragging the grip, or with the Up and Down arrow keys while
 * it has focus, as its label says. The order is the menu's, the link rule's
 * (which workspace a link opens in) and the sender rule's, so each move is
 * saved at once and read back to screen readers.
 *
 * With no workspace yet the card says what one is for and offers New
 * workspace: until then the menu is the one it always was.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Layers, Lock, Mail, Pencil, Plus, Trash2 } from 'lucide-react';
import { Suspense, lazy, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Badge, Button, Card, EmptyState, Modal, ModalBody, ModalHeader, MonoText, Spinner } from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { useAppToasts } from '../../pages/toasts.js';
import { initialsOf } from '../../shell/workspaces/model.js';
import { WorkspaceTile } from '../../shell/workspaces/WorkspaceTile.js';
import type { ConnectionDto } from '../api.js';
import type { SaveRequest } from '../apps/saveAppApi.js';
import { SaveWorkspaceButton, type OnMoreChoices } from '../apps/workspaceFiles/SaveWorkspaceDialog.js';
import type { WorkspaceAppRequest } from '../apps/workspaceFiles/workspaceFilesApi.js';
import { WorkspaceSenderSheet } from '../workspace-sender/WorkspaceSenderSheet.js';
import { DeleteWorkspaceModal, NewWorkspaceModal, RenameWorkspaceModal } from './WorkspaceDialogs.js';
import { WORKSPACES_QUERY_KEY, refreshWorkspaces, workspacesApi, type WorkspaceDto, type WorkspaceList } from './workspacesApi.js';

/* The wizard is Hosted apps' own screen: its code loads when "More choices" is pressed. */
const SaveAsAppFlow = lazy(async () => ({ default: (await import('../apps/SaveAsAppFlow.js')).SaveAsAppFlow }));

/** The wizard's request, as one app of a workspace save takes it (a workspace file has one label of its own). */
export function workspaceAppOf(request: SaveRequest): WorkspaceAppRequest {
  const answers = Object.fromEntries(Object.entries(request.answers ?? {}).filter((entry): entry is [string, string[]] => entry[1] !== undefined));
  return {
    connectionId: request.connectionId,
    key: request.key,
    name: request.name,
    ...(request.version === undefined ? {} : { version: request.version }),
    ...(request.description === undefined ? {} : { description: request.description }),
    ...(request.icon === undefined ? {} : { icon: request.icon }),
    ...(request.include === undefined ? {} : { include: { ...request.include } }),
    ...(request.rows === undefined ? {} : { rows: request.rows }),
    ...(request.answers === undefined ? {} : { answers }),
  };
}

/** "3 databases · fernhill, fernhill_archive, suppliers". */
function DatabasesLine({ ids, connections }: { ids: readonly string[]; connections: readonly ConnectionDto[] }) {
  const names = ids.map((id) => connections.find((connection) => connection.id === id)?.name).filter((name): name is string => name !== undefined);
  return (
    <div className="mt-px text-[12.5px] text-fg-muted">
      {t('workspaces.databases', '{count, plural, one {# database} other {# databases}}', { count: ids.length })}
      {names.length === 0 ? null : (
        <>
          {' · '}
          {names.map((name, index) => (
            <span key={name}>
              {index === 0 ? null : ', '}
              <MonoText>{name}</MonoText>
            </span>
          ))}
        </>
      )}
    </div>
  );
}

export function WorkspacesCard({ list, connections }: { list: WorkspaceList; connections: readonly ConnectionDto[] }) {
  const queryClient = useQueryClient();
  const toasts = useAppToasts();
  const [making, setMaking] = useState(false);
  const [renaming, setRenaming] = useState<WorkspaceDto | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceDto | null>(null);
  const [said, setSaid] = useState('');
  /** Save workspace's "More choices": one database's app, and where its choices go back to. */
  const [choosing, setChoosing] = useState<{ app: WorkspaceAppRequest; apply: (next: WorkspaceAppRequest) => void } | null>(null);
  const onMoreChoices: OnMoreChoices = (app, apply) => setChoosing({ app, apply });
  const choosingOn = choosing === null ? '' : (connections.find((connection) => connection.id === choosing.app.connectionId)?.name ?? choosing.app.connectionId);
  const dragged = useRef<string | null>(null);
  const workspaces = [...list.workspaces].sort((a, b) => a.position - b.position);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => workspacesApi.reorder(ids),
    onMutate: (ids) => {
      // Moved at once on screen; the reply (or a refetch on failure) settles it.
      queryClient.setQueryData<WorkspaceList>(WORKSPACES_QUERY_KEY, (prev) =>
        prev === undefined ? prev : { ...prev, workspaces: ids.map((id, position) => ({ ...prev.workspaces.find((w) => w.id === id)!, position })) },
      );
    },
    onError: () => toasts.push({ variant: 'error', title: t('studio:hub.workspaces.reorderFailed', 'The order could not be saved. Try again.') }),
    onSettled: () => refreshWorkspaces(queryClient),
  });

  const move = (id: string, to: number) => {
    const ids = workspaces.map((workspace) => workspace.id);
    const from = ids.indexOf(id);
    if (from === -1 || to < 0 || to >= ids.length || to === from) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    reorder.mutate(ids);
    const name = workspaces[from]!.name;
    setSaid(t('studio:hub.workspaces.moved', '{name} moved to {position} of {total}.', { name, position: to + 1, total: ids.length }));
  };

  const onGripKey = (event: KeyboardEvent<HTMLButtonElement>, id: string, index: number) => {
    const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
    if (to === null) return;
    event.preventDefault();
    move(id, to);
    // The row moved: its grip keeps the focus, so the next arrow moves it again.
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-grip="${CSS.escape(id)}"]`)?.focus());
  };

  const onDrop = (event: DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    if (dragged.current !== null) move(dragged.current, index);
    dragged.current = null;
  };

  return (
    <Card padded={false} className="overflow-hidden" data-testid="workspaces-card">
      <div className="flex flex-wrap items-center gap-2.5 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[14px] font-bold leading-[normal] text-fg">{t('studio:hub.workspaces.title', 'Workspaces')}</h2>
            <Badge tone="neutral" className="font-mono">
              {workspaces.length}
            </Badge>
          </div>
          <p className="mt-[3px] text-[12.5px] leading-[1.5] text-fg-muted">
            {t('studio:hub.workspaces.subtitle', 'Databases that serve one business share one menu. A database can be in several.')}
          </p>
        </div>
        <Button variant="secondary" size="sm" className="ms-auto" onClick={() => setMaking(true)} data-testid="workspace-new">
          <Plus aria-hidden className="size-[15px]" />
          {t('studio:hub.workspaces.new.title', 'New workspace')}
        </Button>
      </div>

      {workspaces.length === 0 ? (
        <div className="border-t border-border">
          <EmptyState
            icon={<Layers />}
            title={t('studio:hub.workspaces.empty.title', 'No workspaces yet')}
            body={t('studio:hub.workspaces.empty.body', 'Until there is one, everyone’s menu lists every database’s pages together.')}
          />
        </div>
      ) : (
        <ul className="m-0 list-none p-0">
          {workspaces.map((workspace, index) => (
            <li key={workspace.id}>
              <div
                className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-[13px]"
                data-testid={`workspace-row-${workspace.id}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => onDrop(event, index)}
              >
                <button
                  type="button"
                  draggable
                  data-grip={workspace.id}
                  onDragStart={() => (dragged.current = workspace.id)}
                  onKeyDown={(event) => onGripKey(event, workspace.id, index)}
                  aria-label={t('studio:hub.workspaces.move', 'Move {name}. Drag, or use the arrow keys.', { name: workspace.name })}
                  className="flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded-sm text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <GripVertical aria-hidden className="size-4" />
                </button>
                <WorkspaceTile group={{ kind: 'workspace', initials: initialsOf(workspace.name) }} size={32} />
                <div className="min-w-[180px] flex-1">
                  <div className="text-[13px] font-bold text-fg">{workspace.name}</div>
                  <DatabasesLine ids={workspace.connectionIds} connections={connections} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <SaveWorkspaceButton workspace={{ id: workspace.id, name: workspace.name, connectionIds: workspace.connectionIds }} onMoreChoices={onMoreChoices} />
                  <WorkspaceSenderSheet
                    workspace={{ id: workspace.id, name: workspace.name, sender: workspace.sender }}
                    onSaved={() => void refreshWorkspaces(queryClient)}
                    opener={(open) => (
                      <Button variant="secondary" size="sm" onClick={open}>
                        <Mail aria-hidden className="size-[15px]" />
                        {t('studio:hub.workspaces.sender', 'Sender')}
                      </Button>
                    )}
                  />
                  <Button variant="secondary" size="sm" onClick={() => setRenaming(workspace)}>
                    <Pencil aria-hidden className="size-[15px]" />
                    {t('studio:hub.workspaces.rename.save', 'Rename')}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeleting(workspace)}>
                    <Trash2 aria-hidden className="size-[15px]" />
                    {t('studio:hub.workspaces.delete.confirm', 'Delete')}
                  </Button>
                </div>
              </div>
            </li>
          ))}
          {list.otherDatabases === null ? null : (
            <li>
              <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-[13px]" data-testid="workspace-row-other">
                <span className="w-7 shrink-0" />
                <WorkspaceTile group={{ kind: 'other', initials: '' }} size={32} />
                <div className="min-w-[180px] flex-1">
                  <div className="text-[13px] font-bold text-fg">{t('nav.otherDatabases', 'Other databases')}</div>
                  <DatabasesLine ids={list.otherDatabases} connections={connections} />
                </div>
                <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-subtle">
                  <Lock aria-hidden className="size-3.5" />
                  {t('studio:hub.workspaces.otherLock', 'Always last. It can’t be renamed or deleted.')}
                </span>
              </div>
            </li>
          )}
        </ul>
      )}
      <p className="sr-only" aria-live="polite">
        {said}
      </p>

      {making ? <NewWorkspaceModal workspaces={workspaces} connections={connections} onClose={() => setMaking(false)} /> : null}
      {renaming === null ? null : <RenameWorkspaceModal workspace={renaming} workspaces={workspaces} onClose={() => setRenaming(null)} />}
      {deleting === null ? null : <DeleteWorkspaceModal workspace={deleting} onClose={() => setDeleting(null)} />}
      {choosing === null ? null : (
        // Over the Save workspace dialog, which keeps its rows meanwhile.
        <Modal open size="xl" onOpenChange={(next) => (next ? undefined : setChoosing(null))}>
          <ModalHeader title={t('studio:workspaceFiles.save.choicesTitle', 'More choices for {database}', { database: choosingOn })} closeLabel={t('common.close', 'Close')} />
          {/* No padding under the body: the wizard's footer sticks to its end. */}
          <ModalBody className="pb-0">
            <Suspense fallback={<Spinner size="sm" />}>
              <SaveAsAppFlow
                start={{
                  connectionId: choosing.app.connectionId,
                  mode: 'wizard',
                  prefill: { key: choosing.app.key, name: choosing.app.name, description: choosing.app.description ?? '', icon: choosing.app.icon ?? null, label: '', version: choosing.app.version ?? null },
                }}
                onApply={(request) => choosing.apply(workspaceAppOf(request))}
                onClose={() => setChoosing(null)}
              />
            </Suspense>
          </ModalBody>
        </Modal>
      )}
    </Card>
  );
}
